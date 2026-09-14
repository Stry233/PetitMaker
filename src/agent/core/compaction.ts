/** Compaction as a logged summary: a `compaction` event replaces everything before it with one
 *  assistant-written recap. `deriveMessages` already starts its replay at the latest such event
 *  (project-messages.ts), so a second compaction summarizes forward from the first's boundary
 *  with no special-casing here: the request it builds naturally carries the prior summary. */
import { append, eventsOf, type SessionLog } from './log';
import { quotePromptData } from '../../core/runtime/prompt-data';
import SUMMARY_SYSTEM from '../prompts/09-summary.md?raw';
import { deriveMessages, messageText } from './project-messages';
import { withIdleTimeout } from './stream-idle';
import type { SessionEvent } from './types';
import type { Adapter, AdapterRequest } from '../providers/types';

/** Tokens held back so the reply to the turn that triggered compaction still has room to run.
 *  ADVISORY AND PROVIDER-AGNOSTIC, which is why it stays at 16000 rather than rising to match the
 *  Anthropic dialect's own 32000 output ceiling (providers/anthropic.ts:DEFAULT_MAX_TOKENS): the
 *  same number is what `loop.ts` subtracts to get `budgetTokens`, so a flat reserve as large as the
 *  biggest output cap would leave a small-context endpoint (a 32k local model behind the custom
 *  provider) with a history budget of zero. A reply that genuinely wants the whole 32000 is a long
 *  extended think, and the guard that belongs to it is the adapter clamping its own `max_tokens`
 *  against the room the request left, not a reserve every provider pays. */
export const COMPACTION_RESERVE = 16000;
/** Tail tokens kept verbatim behind the summary, rounded up to the nearest whole exchange group. */
export const KEEP_RECENT = 8000;



const UNBOUNDED = Number.MAX_SAFE_INTEGER;

export function needsCompaction(
  log: SessionLog,
  opts: { contextWindow: number; estimate: (s: string) => number },
): boolean {
  const messages = deriveMessages(log, { budgetTokens: UNBOUNDED, estimate: opts.estimate });
  const total = messages.reduce((sum, m) => sum + opts.estimate(messageText(m)), 0);
  return total > opts.contextWindow - COMPACTION_RESERVE;
}

function latestCompactionSeq(events: readonly SessionEvent[]): number {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e?.kind === 'compaction') return e.retainedFromSeq;
  }
  return 0;
}

/** What an event costs the REQUEST, which is the only cost a retention decision may weigh. A
 *  reasoning part contributes nothing: `deriveMessages` sends text and tool args only, so counting a
 *  thought here spends the KEEP_RECENT tail on bytes that never leave the browser — one extended
 *  think in the newest exchange was enough to collapse the tail to that exchange alone. */
function eventText(e: SessionEvent): string {
  if (e.kind === 'order') return e.mapContext + e.text;
  if (e.kind === 'assistant') {
    return e.parts.map((p) => {
      if (p.kind === 'tool') return JSON.stringify(p.input);
      return p.kind === 'reasoning' ? '' : p.text;
    }).join('');
  }
  if (e.kind === 'toolResult') return e.content;
  if (e.kind === 'steer') return e.text;
  return '';
}

/** Groups on the same openers `deriveMessages` treats as the start of an exchange (an order or a
 *  delivered steer). A call and its result are never separated by an opener in between, so they
 *  always land in the same group here too, and cutting at a group's own start seq can never split
 *  the pair even though this grouping is coarser than deriveMessages' own delivery semantics. */
function groupCosts(events: readonly SessionEvent[], estimate: (s: string) => number): { startSeq: number; cost: number }[] {
  const groups: { startSeq: number; cost: number }[] = [];
  for (const e of events) {
    const opens = e.kind === 'order' || e.kind === 'steerDelivered';
    if (opens || groups.length === 0) groups.push({ startSeq: e.seq, cost: 0 });
    const current = groups[groups.length - 1];
    if (current) current.cost += estimate(eventText(e));
  }
  return groups;
}

/** Walks exchange groups from the newest backwards, keeping whole groups until roughly
 *  `KEEP_RECENT` of tail is retained; returns the start seq of the oldest group kept. */
function tailBoundary(events: readonly SessionEvent[], estimate: (s: string) => number): number {
  const groups = groupCosts(events, estimate);
  let total = 0;
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    if (!g) continue;
    total += g.cost;
    if (total >= KEEP_RECENT || i === 0) return g.startSeq;
  }
  return events[0]?.seq ?? 0;
}

/** The cut to use when `tailBoundary` can only name the window's own first event, which is what a
 *  job of ONE exchange (an order and no delivered steer) always produces: the whole job is one
 *  group, so keeping whole groups frees nothing and the only other answer open to the caller is to
 *  settle the job as an overflow incident. Assistant seqs are the only other safe cut in the window — a call and its results
 *  follow their assistant event, so `deriveMessages` either keeps a pair whole or drops it whole,
 *  and the retained window still opens on the summary. The newest assistant is always eligible
 *  however large its own exchange: an oversized final turn is the retry ladder's problem, and
 *  refusing to cut at all is what loses the job. Returns undefined when the window holds no
 *  assistant event to cut at. */
function assistantBoundary(events: readonly SessionEvent[], estimate: (s: string) => number): number | undefined {
  let cost = 0;
  let boundary: number | undefined;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (!e) continue;
    cost += estimate(eventText(e));
    if (e.kind !== 'assistant') continue;
    if (boundary !== undefined && cost > KEEP_RECENT) break;
    boundary = e.seq;
  }
  return boundary;
}

function lastOrderText(events: readonly SessionEvent[]): string {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e?.kind === 'order') return e.text;
  }
  return '';
}

/** Op count scoped to the current job (since the last order), matching governor.ts's `jobEvents`
 *  idiom exactly (slice from just AFTER the order, which it never counts as a toolResult anyway). */
function jobOpCount(events: readonly SessionEvent[]): number {
  const lastOrderIndex = events.reduce((found, e, i) => (e.kind === 'order' ? i : found), -1);
  const jobEvents = lastOrderIndex < 0 ? events : events.slice(lastOrderIndex + 1);
  return jobEvents.filter((e) => e.kind === 'toolResult').length;
}

/** Bounded exactly as the loop's own turn path is (`loop.ts:streamOnce`): a summarizer that accepts
 *  the connection and then stops speaking is the one failure the error/empty fallbacks below cannot
 *  see, and unwrapped it froze the job at the moment compaction was supposed to save it. The stream
 *  runs under its OWN controller linked to the job's, so the idle trip cancels the dead fetch
 *  without touching the job's signal — which is what keeps a genuine user abort distinguishable
 *  from a stall, since only the former suppresses the mechanical fallback. */
async function runSummaryTurn(adapter: Adapter, req: AdapterRequest, signal: AbortSignal): Promise<string | undefined> {
  let text = '';
  const turn = new AbortController();
  const onAbort = (): void => turn.abort();
  // An ALREADY-aborted signal never fires `abort` again, so a listener alone would hand the adapter
  // a live controller and stream a summary for a job the user has already stopped.
  if (signal.aborted) turn.abort();
  else signal.addEventListener('abort', onAbort, { once: true });
  try {
    const source = adapter.stream(req, turn.signal);
    for await (const ev of withIdleTimeout(source, { onIdle: () => turn.abort(), signal })) {
      if (ev.t === 'error') return undefined;
      if (ev.t === 'text') text += ev.delta;
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export async function compact(
  log: SessionLog,
  deps: { adapter: Adapter; model: string; signal: AbortSignal; estimate: (s: string) => number },
): Promise<boolean> {
  const events = eventsOf(log);
  const base = latestCompactionSeq(events);
  const window = events.filter((e) => e.seq >= base && e.kind !== 'compaction');
  if (window.length === 0) return false;

  const groupCut = tailBoundary(window, deps.estimate);
  // Nothing precedes the cut: the whole window is one exchange kept whole, so folding at a group
  // boundary would only ADD a message ahead of it, never remove one. Fall back to cutting inside
  // the exchange; if even that names the window's first event there is nothing to free, so bail
  // before spending the adapter call.
  const firstEligibleSeq = window[0]?.seq ?? 0;
  const retainedFromSeq = groupCut > firstEligibleSeq
    ? groupCut
    : assistantBoundary(window, deps.estimate) ?? firstEligibleSeq;
  if (retainedFromSeq <= firstEligibleSeq) return false;

  const ledger = `Last order: ${quotePromptData(lastOrderText(events))}. Tool calls so far this job: ${jobOpCount(events)}.`;
  const request: AdapterRequest = {
    system: SUMMARY_SYSTEM,
    messages: [
      ...deriveMessages(log, { budgetTokens: UNBOUNDED, estimate: deps.estimate }),
      { role: 'user', text: `(map ledger) ${ledger}` },
    ],
    tools: [],
    model: deps.model,
    // A summary is a fresh read of the transcript, not a continuation the origin provider's own
    // dialect owns, so raw provider blocks are never echoed back into this one-off request.
    sameModel: false,
  };

  // An unreachable or empty summarizer must not cost the whole job: the mechanical ledger stands in
  // as the summary, which is weaker prose but the same facts, and the fold happens either way. An
  // ABORT is the one case that appends nothing, since the user has already stopped the run.
  const summary = await runSummaryTurn(deps.adapter, request, deps.signal)
    ?? (deps.signal.aborted ? undefined : `(automatic summary) ${ledger}`);
  if (summary === undefined || deps.signal.aborted) return false;

  append(log, { kind: 'compaction', summary, retainedFromSeq });
  return true;
}
