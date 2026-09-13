/**
 * Persists a versioned session envelope. Provider raw blocks and result images are omitted; reasoning
 * is stored as bounded digests. Record visibility marks live beside the log and share its lifecycle.
 */
import { PREFS, readPref, writePref } from '../../core/runtime/prefs';
import { append, deepFreeze, eventsOf, type SessionLog } from '../core/log';
import { isJobActive } from '../core/loop';
import { REASONING_EXCERPT_CHARS, type Part, type SessionEvent } from '../core/types';
import { validStoredEvents } from './validate-log';

export const LOG_VERSION = 3;

interface StoredEnvelope { v: number; events: SessionEvent[]; nextSeq?: number }

/** Stores a reasoning excerpt with its original length and marks the persisted part complete. */
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
  delete copy.rawModel; // Meaningful only with the omitted raw blocks.
  if (copy.kind === 'toolResult') delete copy.image;
  if (copy.kind === 'assistant') copy.parts = (copy.parts as Part[]).map(digestReasoning);
  return copy as unknown as SessionEvent;
}

export function serializeLog(log: SessionLog): string {
  const envelope: StoredEnvelope = { v: LOG_VERSION, events: eventsOf(log).map(stripForStorage), nextSeq: log.nextSeq };
  return JSON.stringify(envelope);
}

export function deserializeLog(raw: string | null, now: () => number = Date.now): SessionLog | null {
  if (raw === null) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!parsed || typeof parsed !== 'object') return null;
  const { v, events, nextSeq } = parsed as Partial<StoredEnvelope>;
  if (v !== LOG_VERSION || !validStoredEvents(events)) return null;
  const frozen = events.map((e) => deepFreeze(e)) as SessionEvent[];
  const maxSeq = frozen.reduce((m, e) => Math.max(m, e.seq), 0);
  if (nextSeq !== undefined && (!Number.isSafeInteger(nextSeq) || nextSeq <= maxSeq)) return null;
  return { events: frozen, now, nextSeq: nextSeq ?? maxSeq + 1, listeners: new Set() };
}

/** Keeps the latest compacted window plus the newest pre-window load of each active skill. */
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

/** Outcome of the normal write and its one quota-pruned retry. */
export type StorageHealth = 'saved' | 'pruned' | 'lost';

export function saveLog(log: SessionLog): StorageHealth {
  if (writePref('agentLogV3', serializeLog(log))) return 'saved';
  // Retry once with the compacted window if the full log cannot be stored.
  const pruned: SessionLog = { ...log, events: prunedBeforeLastCompaction(eventsOf(log)) };
  return writePref('agentLogV3', serializeLog(pruned)) ? 'pruned' : 'lost';
}

/** Settled record IDs filed out of the job zone or removed from history. */
export interface RecordMarks { filed: readonly number[]; cleared: readonly number[] }

export const NO_MARKS: RecordMarks = { filed: [], cleared: [] };

interface StoredMarks { v: number; filed: number[]; cleared: number[] }

const seqList = (value: unknown): number[] =>
  (Array.isArray(value) ? value.filter((n): n is number => typeof n === 'number') : []);

export function saveMarks(marks: RecordMarks): void {
  const envelope: StoredMarks = { v: LOG_VERSION, filed: [...marks.filed], cleared: [...marks.cleared] };
  writePref('agentMarksV3', JSON.stringify(envelope));
}

/** Reads matching-version marks, otherwise returns the empty set. */
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

/** Removes the marks envelope. */
export function clearMarks(): void {
  try { localStorage.removeItem(PREFS.agentMarksV3.key); } catch { /* storage is gone */ }
}

/** Reads the stored session and preserves unreadable source bytes for the recovery export. */
export function loadLog(): { log: SessionLog | null; corrupt: boolean; corruptRaw?: string } {
  const raw = readPref('agentLogV3');
  const log = deserializeLog(raw);
  if (!log) {
    return raw !== null ? { log: null, corrupt: true, corruptRaw: raw } : { log: null, corrupt: false };
  }
  if (isJobActive(log)) {
    const events = eventsOf(log);
    const last = events[events.length - 1];
    // An active restored job is held in a resumable paused state.
    if (last?.kind !== 'paused') {
      append(log, { kind: 'paused' });
    }
  }
  return { log, corrupt: false };
}
