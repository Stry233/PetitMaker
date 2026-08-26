/**
 * Persists the session log under one versioned localStorage envelope
 * (`core/runtime/prefs.ts:agentLogV3`). A stored event drops `raw` (whatever kind carries one:
 * an opaque provider SDK object, not JSON-safe and potentially large) and a `toolResult`'s
 * `image` (a data URL that would bloat storage) — a reasoning/tool-call round trip that leans on
 * `raw` therefore does not survive a reload, by design. An assistant event's reasoning parts are
 * stored as digests rather than transcripts (`digestReasoning`).
 *
 * ONE THING IS STORED BESIDE THE LOG RATHER THAN IN IT: the LEAVE MARKS (`RecordMarks`, which
 * settled records the user has put away or removed). They are not events — nothing the model or the
 * record is folded from — and they name order seqs, which mean nothing outside the log they were
 * made against, so they live under their own key and are dropped whenever that log is.
 */
import { PREFS, readPref, writePref } from '../../core/runtime/prefs';
import { append, deepFreeze, eventsOf, type SessionLog } from '../core/log';
import { isJobActive } from '../core/loop';
import { REASONING_EXCERPT_CHARS, type Part, type SessionEvent } from '../core/types';

export const LOG_VERSION = 3;

interface StoredEnvelope { v: number; events: SessionEvent[] }

/** A stored thought is a DIGEST: a head of the text plus how long it really was. Nothing replays
 *  reasoning to a provider (`project-messages.ts` sends text and tool args only) and nothing reads
 *  it back at length, so the transcript would be quota spent for no reader — a single extended think
 *  runs to tens of KB against a localStorage budget shared with the map itself. `chars` is preserved
 *  when already set, so a load-then-save cycle cannot re-measure an excerpt as the whole thought.
 *  `done` stores true: whatever was still streaming when the log was written gets no further delta. */
function digestReasoning(p: Part): Part {
  if (p.kind !== 'reasoning') return p;
  return {
    kind: 'reasoning',
    text: p.text.slice(0, REASONING_EXCERPT_CHARS),
    done: true,
    chars: p.chars ?? p.text.length,
  };
}

function stripForStorage(e: SessionEvent): SessionEvent {
  const copy: Record<string, unknown> = { ...e };
  delete copy.raw;
  delete copy.rawModel; // rides with `raw` and only with it, across this boundary too
  if (copy.kind === 'toolResult') delete copy.image;
  if (copy.kind === 'assistant') copy.parts = (copy.parts as Part[]).map(digestReasoning);
  return copy as unknown as SessionEvent;
}

export function serializeLog(log: SessionLog): string {
  const envelope: StoredEnvelope = { v: LOG_VERSION, events: eventsOf(log).map(stripForStorage) };
  return JSON.stringify(envelope);
}

export function deserializeLog(raw: string | null, now: () => number = Date.now): SessionLog | null {
  if (raw === null) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!parsed || typeof parsed !== 'object') return null;
  const { v, events } = parsed as Partial<StoredEnvelope>;
  if (v !== LOG_VERSION || !Array.isArray(events)) return null;
  const frozen = events.map((e) => deepFreeze(e)) as SessionEvent[];
  const maxSeq = frozen.reduce((m, e) => Math.max(m, e.seq), 0);
  return { events: frozen, now, nextSeq: maxSeq + 1, listeners: new Set() };
}

/** The last `compaction` onward, which becomes the retry's new head, PLUS the playbook loads from
 *  before it that `deriveMessages` re-issues after the summary. Dropping those is a second eviction
 *  route to the same defect the re-issue exists to fix: the log would restore without the bodies and
 *  the model would carry on citing steps it can no longer see. Newest non-error load per skill name
 *  only, in seq order, so the stored array stays ascending and costs at most a few KB. */
function prunedBeforeLastCompaction(events: readonly SessionEvent[]): SessionEvent[] {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i]?.kind !== 'compaction') continue;
    const newestBySkill = new Map<string, SessionEvent>();
    for (const e of events.slice(0, i)) {
      if (e.kind === 'toolResult' && !e.isError && e.detail?.skill) newestBySkill.set(e.detail.skill.name, e);
    }
    const kept = [...newestBySkill.values()].sort((a, b) => a.seq - b.seq);
    return [...kept, ...events.slice(i)];
  }
  return [...events];
}

/** What `saveLog` managed: `'saved'` on the plain write, `'pruned'` when the first write failed
 *  (quota, most likely) and the compaction-pruned retry landed, `'lost'` when both failed and the
 *  session will not offer a resume on the next load. The store surfaces this as the storage
 *  banner's notice rather than letting any of the three happen quietly. */
export type StorageHealth = 'saved' | 'pruned' | 'lost';

export function saveLog(log: SessionLog): StorageHealth {
  if (writePref('agentLogV3', serializeLog(log))) return 'saved';
  // Quota (or storage gone mid-session): prune back to the last compaction and retry once, the
  // whole recovery budget.
  const pruned: SessionLog = { ...log, events: prunedBeforeLastCompaction(eventsOf(log)) };
  return writePref('agentLogV3', serializeLog(pruned)) ? 'pruned' : 'lost';
}

/**
 * Which settled records the user has put away: `filed` (the card is off the job zone) and `cleared`
 * (the record itself is gone). Both are ORDER SEQS, which are unique only within one log — so these
 * are stored under their own key beside the envelope and are only ever read back for the log that
 * came WITH them. `store.ts` drops them whenever it adopts a log these seqs did not come from.
 */
export interface RecordMarks { filed: readonly number[]; cleared: readonly number[] }

export const NO_MARKS: RecordMarks = { filed: [], cleared: [] };

interface StoredMarks { v: number; filed: number[]; cleared: number[] }

const seqList = (value: unknown): number[] =>
  (Array.isArray(value) ? value.filter((n): n is number => typeof n === 'number') : []);

export function saveMarks(marks: RecordMarks): void {
  const envelope: StoredMarks = { v: LOG_VERSION, filed: [...marks.filed], cleared: [...marks.cleared] };
  writePref('agentMarksV3', JSON.stringify(envelope));
}

/** The stored marks, or none for anything absent, unparseable or written by another version — the
 *  same all-or-nothing reading `deserializeLog` gives the log they belong to. */
export function loadMarks(): RecordMarks {
  const raw = readPref('agentMarksV3');
  if (raw === null) return NO_MARKS;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return NO_MARKS; }
  if (!parsed || typeof parsed !== 'object') return NO_MARKS;
  const { v, filed, cleared } = parsed as Partial<StoredMarks>;
  if (v !== LOG_VERSION) return NO_MARKS;
  return { filed: seqList(filed), cleared: seqList(cleared) };
}

/** Removes the key outright rather than storing an empty envelope, the way `io/autosave` retires
 *  its own pair: absent and empty read the same here, and absent leaves nothing behind. */
export function clearMarks(): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.removeItem(PREFS.agentMarksV3.key); } catch { /* storage is gone */ }
}

/**
 * The stored session, and the two facts the caller needs about how it came back.
 *
 * `corruptRaw` IS THE EVIDENCE, and it is handed up because it is about to be destroyed: the store
 * adopts a fresh log after an unreadable read, and the very next save writes over the bytes that
 * failed. The notice says the session was "set aside", and keeping them is what makes that sentence
 * true — the corrupt banner's own Export writes exactly this out for a bug report. Nothing else may
 * read it: it is a discarded blob of unknown shape, never a log.
 */
export function loadLog(): { log: SessionLog | null; corrupt: boolean; corruptRaw?: string } {
  const raw = readPref('agentLogV3');
  const log = deserializeLog(raw);
  if (!log) {
    return raw !== null ? { log: null, corrupt: true, corruptRaw: raw } : { log: null, corrupt: false };
  }
  if (isJobActive(log)) {
    const events = eventsOf(log);
    const last = events[events.length - 1];
    // A trailing `pauseRequested` never finished pausing (the crash landed before the loop's own
    // `paused` append) and would otherwise strand the session in phase 'pausing' forever, with no
    // loop left to run and deliver the composer's steer into: it gets the synthetic `paused` tail
    // like any other active-but-not-yet-paused log. Only a trailing `paused` is already settled.
    if (last?.kind !== 'paused') {
      append(log, { kind: 'paused' });
    }
  }
  return { log, corrupt: false };
}
