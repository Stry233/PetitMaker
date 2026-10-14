/**
 * Persists the session envelope (`log-codec.ts`) under quota pressure and restores an interrupted
 * job as paused. Record visibility marks live beside the log and share its lifecycle.
 */
import { readPref, removePref, writePref } from '../../platform/storage/prefs';
import { append, eventsOf, type SessionLog } from '../core/log';
import { isJobActive } from '../core/job-reads';
import type { SessionEvent } from '../core/types';
import { deserializeLog, LOG_VERSION, serializeLog } from './log-codec';

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
interface RecordMarks { filed: readonly number[]; cleared: readonly number[] }

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
  removePref('agentMarksV3');
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
