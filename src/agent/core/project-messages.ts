import { quotePromptData } from '../../core/runtime/prompt-data';
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
  /** Loop-authored note appended after budget trimming so it always reaches the next request. */
  appendSystemNote?: string;
}

const defaultEstimate = (s: string): number => Math.ceil(s.length / 4);

/** User-denied calls are successful control outcomes rather than retryable tool failures. */
const SKIP_RESULT_MESSAGE = 'The user chose not to run this call. Continue without it, or ask what they would prefer.';

type ToolCall = { callId: string; name: string; args: Record<string, unknown> };
type ToolResultEntry = { callId: string; name: string; content: string; isError: boolean; image?: string };

/** Provider message plus whether it starts an exchange group kept atomically during trimming. */
interface Tagged { message: ProviderMessage; opensGroup: boolean }

/** Projects the log into a replay-safe, compacted and budgeted provider message sequence. */
export function deriveMessages(log: SessionLog, opts: ProjectOptions): ProviderMessage[] {
  const tagged = buildTagged(eventsOf(log));
  const groups = groupBy(tagged);
  const windowed = applyBudget(groups, opts);
  const messages = keepLatestImageOnly(windowed);
  return opts.appendSystemNote === undefined
    ? messages
    : [...messages, { role: 'user', text: opts.appendSystemNote }];
}

/** True when every retained raw provider block identifies the requested model as its producer. */
export function rawIsAllFrom(log: SessionLog, model: string): boolean {
  return eventsOf(log).every((e) => e.kind !== 'assistant' || e.raw === undefined || e.rawModel === model);
}

/** Scopes a provider call ID to the assistant turn that emitted it. */
function occurrenceKey(callId: string, assistantSeq: number): string {
  return `${callId}#${assistantSeq}`;
}

function buildTagged(events: readonly SessionEvent[]): Tagged[] {
  const compaction = latestCompaction(events);
  const retainedFromSeq = compaction?.retainedFromSeq ?? 0;
  const kept = events.filter((e) => e.seq >= retainedFromSeq && e.kind !== 'compaction');

  // Rebind repeated call IDs to the nearest preceding assistant event during the forward scan.
  const currentOccurrenceSeq = new Map<string, number>();
  const resultsByOccurrence = new Map<string, Extract<SessionEvent, { kind: 'toolResult' }>>();
  // Steering text and recall state precede delivery and may sit before the compaction boundary.
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
      // Orphan results use their own sequence and therefore cannot bind to a real call occurrence.
      resultsByOccurrence.set(occurrenceKey(e.callId, currentOccurrenceSeq.get(e.callId) ?? e.seq), e);
    } else if (e.kind === 'gateAsked' && e.callId !== undefined) {
      gateIdByOccurrence.set(occurrenceKey(e.callId, currentOccurrenceSeq.get(e.callId) ?? e.seq), e.gateId);
    } else if (e.kind === 'gateAnswered') answerByGateId.set(e.gateId, { answer: e.answer, words: e.words });
  }

  const tagged: Tagged[] = [];
  if (compaction) {
    tagged.push({ message: { role: 'user', text: `(conversation summary, reference only) <summary_data>${quotePromptData(compaction.summary)}</summary_data>` }, opensGroup: true });
    // Reissue the newest evicted body for each skill unless the retained window loads it again.
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
      tagged.push({ message: { role: 'user', text: `(playbook still loaded: ${quotePromptData(title)})\n<playbook_data>${quotePromptData(r.content)}</playbook_data>` }, opensGroup: false });
    }
  }

  for (const e of kept) {
    if (e.kind === 'order') {
      const text = `<map_context>${quotePromptData(e.mapContext)}</map_context>\n${e.text}`;
      tagged.push({ message: { role: 'user', text }, opensGroup: true });
    } else if (e.kind === 'steerDelivered') {
      if (recalledSteerSeqs.has(e.steerSeq)) continue;
      const text = steerTextBySeq.get(e.steerSeq);
      if (text === undefined) continue;
      tagged.push({ message: { role: 'user', text }, opensGroup: true });
    } else if (e.kind === 'systemNote') {
      // Loop-authored notes replay in their original event position.
      tagged.push({ message: { role: 'user', text: e.text }, opensGroup: true });
    } else if (e.kind === 'assistant') {
      // Drop interrupted turns and their results rather than replaying partial output as complete.
      if (DROPPED_STOPS.has(e.stop)) continue;
      const text = e.parts.filter((p) => p.kind === 'text').map((p) => p.text).join('');
      // Parsed calls replay so their reissue results retain a matching assistant call.
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
            // A skipped or typed-answer gate is a user choice; other missing results are errors.
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

        // Typed gate answers replay as user context immediately after the call result.
        for (const call of toolCalls) {
          const gateId = gateIdByOccurrence.get(occurrenceKey(call.callId, e.seq));
          const answer = gateId !== undefined ? answerByGateId.get(gateId) : undefined;
          if (answer?.answer === 'words' && answer.words !== undefined) {
            tagged.push({ message: { role: 'user', text: `(about your request) ${answer.words}` }, opensGroup: false });
          }
        }
      }
    }
    // Remaining event kinds contribute through lookups or remain local-only.
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

export function messageText(m: ProviderMessage): string {
  if (m.role === 'user') return m.text;
  if (m.role === 'assistant') return m.text + m.toolCalls.map((c) => JSON.stringify(c.args)).join('');
  return m.results.map((r) => r.content).join('');
}

function applyBudget(groups: ProviderMessage[][], opts: ProjectOptions): ProviderMessage[] {
  const estimate = opts.estimate ?? defaultEstimate;
  const groupCost = (g: ProviderMessage[]): number => g.reduce((sum, m) => sum + estimate(messageText(m)), 0);

  const costs = groups.map(groupCost);
  let total = costs.reduce((sum, cost) => sum + cost, 0);
  let first = 0;
  // Keep the newest exchange intact; provider overflow handling owns a single oversized group.
  while (first < groups.length - 1 && total > opts.budgetTokens) {
    total -= costs[first]!;
    first++;
  }
  return groups.slice(first).flat();
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
