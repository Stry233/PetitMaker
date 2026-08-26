import type { SessionLog } from './log';
import { eventsOf } from './log';
import { DROPPED_STOPS } from './types';
import type { GateAnswer, SessionEvent } from './types';

export type ProviderMessage =
  | { role: 'user'; text: string; images?: string[] }
  | { role: 'assistant'; text: string; toolCalls: { callId: string; name: string; args: Record<string, unknown> }[]; raw?: unknown }
  | { role: 'tool'; results: { callId: string; name: string; content: string; isError: boolean; image?: string }[] };

export interface ProjectOptions {
  budgetTokens: number;
  estimate?: (text: string) => number;
  /** A caller-composed `(system) ...` note (a budget warning, an empty-turn nudge, the cap
   *  message): appended as one trailing user message, outside the budget window so it always
   *  reaches the next request regardless of how much history that request had room for. */
  appendSystemNote?: string;
}

const defaultEstimate = (s: string): number => Math.ceil(s.length / 4);

/** A denial must never read as a retryable error: `isError: false` tells the model the call
 *  simply didn't happen by the user's choice, so it moves on rather than treating this as
 *  transient tool failure worth another attempt. */
const SKIP_RESULT_MESSAGE = 'The user chose not to run this call. Continue without it, or ask what they would prefer.';

type ToolCall = { callId: string; name: string; args: Record<string, unknown> };
type ToolResultEntry = { callId: string; name: string; content: string; isError: boolean; image?: string };

/** A flat message plus whether it OPENS a new exchange group (an order, a delivered steer, or
 *  the compaction summary) versus continuing the group in progress. Every opener is a `user`-role
 *  message, so a surviving window (whole groups kept from the back) always starts on one. */
interface Tagged { message: ProviderMessage; opensGroup: boolean }

/** Projects the append-only log into the flat message list a provider call sends: replay hygiene
 *  (dropping aborted/error/length-truncated turns and their results), orphan repair (a call with
 *  no result gets a synthesized one), the compaction cutover, budget trimming by whole exchange,
 *  and single-image retention all happen here so every caller sees one already-legal wire shape. */
export function deriveMessages(log: SessionLog, opts: ProjectOptions): ProviderMessage[] {
  const tagged = buildTagged(eventsOf(log));
  const groups = groupBy(tagged);
  const windowed = applyBudget(groups, opts);
  const messages = keepLatestImageOnly(windowed);
  return opts.appendSystemNote === undefined
    ? messages
    : [...messages, { role: 'user', text: opts.appendSystemNote }];
}

/**
 * Whether every assistant turn whose provider `raw` this log holds was produced by `model` — the
 * one honest answer to an adapter's `sameModel` question, which is what licenses replaying those
 * bytes verbatim (see the gate in providers/anthropic.ts). A log outlives the armed model, so the
 * question cannot be answered from the connection alone.
 *
 * Deliberately conservative in two ways: a turn that carries `raw` without a `rawModel` (recorded
 * before the field existed, or by a path that does not report it) counts as NOT this model, and a
 * turn old enough that no request would replay it (dropped by `DROPPED_STOPS` or left behind a
 * compaction) still counts. Both err toward `false`, whose only cost is that an Anthropic history
 * is rebuilt from the neutral text/tool_use fields instead of echoed.
 */
export function rawIsAllFrom(log: SessionLog, model: string): boolean {
  return eventsOf(log).every((e) => e.kind !== 'assistant' || e.raw === undefined || e.rawModel === model);
}

/** A callId alone is not a stable key: a provider can reissue one across turns (a synthesized id
 *  colliding, or a real one a buggy gateway repeats), so every callId-keyed lookup below binds to
 *  the OCCURRENCE that minted it rather than the bare id. */
function occurrenceKey(callId: string, assistantSeq: number): string {
  return `${callId}#${assistantSeq}`;
}

function buildTagged(events: readonly SessionEvent[]): Tagged[] {
  const compaction = latestCompaction(events);
  const retainedFromSeq = compaction?.retainedFromSeq ?? 0;
  const kept = events.filter((e) => e.seq >= retainedFromSeq && e.kind !== 'compaction');

  // `currentOccurrenceSeq` tracks, per callId, the seq of the nearest PRECEDING assistant event
  // that carries it — updated the instant an assistant event is visited, so a toolResult/gateAsked
  // logged right after binds to THAT occurrence. If an assistant event later reissues the same
  // callId, this map moves forward and every later result/gate binds to the NEW occurrence
  // instead, exactly as the spec asks: process in order, rebind on reissue.
  const currentOccurrenceSeq = new Map<string, number>();
  const resultsByOccurrence = new Map<string, Extract<SessionEvent, { kind: 'toolResult' }>>();
  // A STEER'S IDENTITY AND FATE ARE READ FROM THE WHOLE LOG, not the retained window, because a
  // `steer` is logged when the user types it and DELIVERED later: its own event therefore always
  // sits before a compaction cut that lands on the delivery, which is the boundary `compaction.ts`
  // deliberately prefers. Read from the window, the text lookup missed and the delivery emitted
  // nothing at all, silently dropping the user's steering words from the very exchange they opened.
  // The recall set widens with it and must: reading one half of the same fact from the whole log
  // and the other from the window is what would let a recalled steer be delivered after all.
  const steerTextBySeq = new Map<number, string>();
  const recalledSteerSeqs = new Set<number>();
  for (const e of events) {
    if (e.kind === 'steer') steerTextBySeq.set(e.seq, e.text);
    else if (e.kind === 'steerRecalled') recalledSteerSeqs.add(e.steerSeq);
  }
  const gateIdByOccurrence = new Map<string, string>();
  const answerByGateId = new Map<string, { answer: GateAnswer; words?: string }>();
  for (const e of kept) {
    if (e.kind === 'assistant') {
      for (const p of e.parts) {
        if (p.kind === 'tool') currentOccurrenceSeq.set(p.callId, e.seq);
      }
    } else if (e.kind === 'toolResult') {
      // The `?? e.seq` fallback only matters for a toolResult with no assistant event ever having
      // carried its callId (a malformed/synthetic log): it then keys to itself, which no real
      // lookup below can ever match, so it is read back exactly as "no result for this call".
      resultsByOccurrence.set(occurrenceKey(e.callId, currentOccurrenceSeq.get(e.callId) ?? e.seq), e);
    } else if (e.kind === 'gateAsked' && e.callId !== undefined) {
      gateIdByOccurrence.set(occurrenceKey(e.callId, currentOccurrenceSeq.get(e.callId) ?? e.seq), e.gateId);
    } else if (e.kind === 'gateAnswered') answerByGateId.set(e.gateId, { answer: e.answer, words: e.words });
  }

  const tagged: Tagged[] = [];
  if (compaction) {
    tagged.push({ message: { role: 'user', text: `(conversation summary) ${compaction.summary}` }, opensGroup: true });
    // A playbook the cut evicted is re-issued whole behind the summary: the model needs the STEPS,
    // not the name, and a summary that mentions neither leaves it citing steps it can no longer
    // see. Newest load per skill name only, and never a name the RETAINED window loads too (that
    // one replays natively, and re-issuing it would put the same body in the request twice). A
    // body is 280-1100 tokens, so the three loads the prompt asks for cost less than the ledger
    // sentence they replace.
    const newestBySkill = new Map<string, Extract<SessionEvent, { kind: 'toolResult' }>>();
    const reloaded = new Set<string>();
    for (const e of events) {
      if (e.kind !== 'toolResult' || e.isError || !e.detail?.skill) continue;
      if (e.seq < retainedFromSeq) newestBySkill.set(e.detail.skill.name, e);
      else reloaded.add(e.detail.skill.name);
    }
    for (const [name, r] of newestBySkill) {
      if (reloaded.has(name)) continue;
      const title = r.detail?.skill?.title ?? '';
      tagged.push({ message: { role: 'user', text: `(playbook still loaded: ${title})\n${r.content}` }, opensGroup: false });
    }
  }

  for (const e of kept) {
    if (e.kind === 'order') {
      const text = `<map_context>${e.mapContext}</map_context>\n${e.text}`;
      tagged.push({ message: { role: 'user', text }, opensGroup: true });
    } else if (e.kind === 'steerDelivered') {
      if (recalledSteerSeqs.has(e.steerSeq)) continue; // recalled: never delivered to the model
      const text = steerTextBySeq.get(e.steerSeq);
      if (text === undefined) continue; // no matching steer event: nothing to deliver
      tagged.push({ message: { role: 'user', text }, opensGroup: true });
    } else if (e.kind === 'systemNote') {
      // The loop's own between-turn note (a delivery or review nudge), replayed exactly where it landed.
      tagged.push({ message: { role: 'user', text: e.text }, opensGroup: true });
    } else if (e.kind === 'assistant') {
      // A turn the provider itself cut short cannot be replayed as a finished one, so it and
      // whatever results it produced are dropped together rather than resent. A 'length' stop is
      // included: the assembler's badCalls for that turn are truncation-poisoned and never
      // survive into the persisted event, so there is nothing here to tell a truncated call apart
      // from a clean one except the stop reason itself.
      if (DROPPED_STOPS.has(e.stop)) continue;
      const text = e.parts.filter((p) => p.kind === 'text').map((p) => p.text).join('');
      // A call whose args never parsed (`rawInput` set) replays with its PARTIAL input rather than
      // being dropped: the loop filed a reissue result for it, and only a replayed call carries a
      // result message. Dropped, the turn went back out as an empty assistant message, the
      // correction reached the model as nothing at all, and it reissued the same bad call forever.
      const toolCalls: ToolCall[] = e.parts
        .filter((p): p is Extract<typeof p, { kind: 'tool' }> => p.kind === 'tool' && p.argsDone)
        .map((p) => ({ callId: p.callId, name: p.name, args: p.input }));
      const assistantMessage: ProviderMessage = e.raw === undefined
        ? { role: 'assistant', text, toolCalls }
        : { role: 'assistant', text, toolCalls, raw: e.raw };
      tagged.push({ message: assistantMessage, opensGroup: false });

      if (toolCalls.length > 0) {
        const results: ToolResultEntry[] = toolCalls.map((call) => {
          const r = resultsByOccurrence.get(occurrenceKey(call.callId, e.seq));
          if (r === undefined) {
            // A skipped or words-declined gate reads as the user's own choice, never as a tool
            // failure: only a call with NO gate pair at all (or an allowed one, which should have
            // run and produced a real result) falls to the generic orphan message.
            const gateId = gateIdByOccurrence.get(occurrenceKey(call.callId, e.seq));
            const answer = gateId !== undefined ? answerByGateId.get(gateId) : undefined;
            if (answer?.answer === 'skip' || answer?.answer === 'words') {
              return { callId: call.callId, name: call.name, content: SKIP_RESULT_MESSAGE, isError: false };
            }
            return { callId: call.callId, name: call.name, content: 'No result recorded.', isError: true };
          }
          return r.image === undefined
            ? { callId: r.callId, name: r.name, content: r.content, isError: r.isError }
            : { callId: r.callId, name: r.name, content: r.content, isError: r.isError, image: r.image };
        });
        tagged.push({ message: { role: 'tool', results }, opensGroup: false });

        // The one gate answer with a message of its own: a 'words' answer echoes the steering words
        // back as a user turn right after the call's own result, wherever that result came from.
        for (const call of toolCalls) {
          const gateId = gateIdByOccurrence.get(occurrenceKey(call.callId, e.seq));
          const answer = gateId !== undefined ? answerByGateId.get(gateId) : undefined;
          if (answer?.answer === 'words' && answer.words !== undefined) {
            tagged.push({ message: { role: 'user', text: `(about your request) ${answer.words}` }, opensGroup: false });
          }
        }
      }
    }
    // toolResult/steer/steerRecalled/gateAsked/gateAnswered/plan/stage/checkpoint/pauseRequested/
    // paused/resumed/retry/incident/jobEnd carry no message of their own; they were folded into
    // the lookups above or are not provider-visible at all.
  }
  return tagged;
}

function latestCompaction(events: readonly SessionEvent[]): Extract<SessionEvent, { kind: 'compaction' }> | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e?.kind === 'compaction') return e;
  }
  return undefined;
}

/** Partitions the tagged stream into exchange groups. Each group is atomic for budget purposes:
 *  it is kept or dropped whole, so a call is never split from its result. */
function groupBy(tagged: Tagged[]): ProviderMessage[][] {
  const groups: ProviderMessage[][] = [];
  for (const t of tagged) {
    if (t.opensGroup || groups.length === 0) groups.push([]);
    groups[groups.length - 1]?.push(t.message);
  }
  return groups;
}

function messageText(m: ProviderMessage): string {
  if (m.role === 'user') return m.text;
  if (m.role === 'assistant') return m.text + m.toolCalls.map((c) => JSON.stringify(c.args)).join('');
  return m.results.map((r) => r.content).join('');
}

function applyBudget(groups: ProviderMessage[][], opts: ProjectOptions): ProviderMessage[] {
  const estimate = opts.estimate ?? defaultEstimate;
  const groupCost = (g: ProviderMessage[]): number => g.reduce((sum, m) => sum + estimate(messageText(m)), 0);

  const remaining = groups.slice();
  let total = remaining.reduce((sum, g) => sum + groupCost(g), 0);
  // The newest exchange is never dropped, even if it alone exceeds the budget: what happens to a
  // single turn too big to fit is the retry/overflow ladder's call, not this projection's, and
  // shipping it whole over budget carries more information than answering with nothing at all.
  while (remaining.length > 1 && total > opts.budgetTokens) {
    const dropped = remaining.shift();
    if (dropped) total -= groupCost(dropped);
  }
  return remaining.flat();
}

function keepLatestImageOnly(messages: ProviderMessage[]): ProviderMessage[] {
  let lastImageIndex = -1;
  messages.forEach((m, i) => {
    if (m.role === 'tool' && m.results.some((r) => r.image !== undefined)) lastImageIndex = i;
  });
  if (lastImageIndex === -1) return messages;

  return messages.map((m, i) => {
    if (m.role !== 'tool' || i === lastImageIndex) return m;
    if (!m.results.some((r) => r.image !== undefined)) return m;
    return { role: 'tool', results: m.results.map(({ image: _image, ...rest }) => rest) };
  });
}
