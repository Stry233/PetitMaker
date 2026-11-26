/**
 * The stored session envelope: a versioned copy of the log without provider raw blocks or result
 * images, reasoning kept as bounded digests, rule messages read under their current keys and a
 * loop-authored note marked as one.
 */
import { BASE_SUPPORT } from '../../core/game/profile';
import { deepFreeze, eventsOf, type SessionLog } from '../core/log';
import { NOTE_MARK } from '../core/nudges';
import { REASONING_EXCERPT_CHARS, type Part, type SessionEvent } from '../core/types';
import { validStoredEvents } from './validate-log';

/** The envelope version; the record marks stored beside the log carry it too. */
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

/** Rule message keys that 1.4 assistant logs stored under earlier names, with the params their
 *  current copy reads. */
const RENAMED_RULE_MESSAGES: Readonly<Record<string, { message: string; params?: Record<string, number> }>> = {
  'error.need_3x3_base': { message: 'error.need_base_support', params: { window: BASE_SUPPORT.window, reach: BASE_SUPPORT.reach } },
  'error.ground_under_plaza': { message: 'error.ground_under_object' },
  'error.tree_too_close': { message: 'error.too_close_same_kind' },
};

type Violation = NonNullable<NonNullable<Extract<SessionEvent, { kind: 'toolResult' }>['detail']>['violations']>[number];

function renameViolation(v: Violation): Violation {
  const renamed = RENAMED_RULE_MESSAGES[v.message];
  if (!renamed) return v;
  const params = renamed.params ? { ...renamed.params, ...v.params } : v.params;
  return { ruleId: v.ruleId, message: renamed.message, ...(params ? { params } : {}) };
}

/** A stored event with its rule messages under their current keys, and a failed result that was a
 *  loop-authored note carrying `detail.loopNote`, which results stored before that field lack. */
function upgradeStored(e: SessionEvent): SessionEvent {
  if (e.kind !== 'toolResult') return e;
  const violations = e.detail?.violations;
  const renamed = e.detail && violations?.some((v) => v.message in RENAMED_RULE_MESSAGES)
    ? { ...e, detail: { ...e.detail, violations: violations.map(renameViolation) } } : e;
  if (!renamed.isError || renamed.detail?.loopNote || !renamed.content.trimStart().startsWith(NOTE_MARK)) return renamed;
  return { ...renamed, detail: { ...renamed.detail, loopNote: true } };
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

/** The log a stored envelope holds, or null when it is unreadable, of another version or invalid. */
export function deserializeLog(raw: string | null, now: () => number = Date.now): SessionLog | null {
  if (raw === null) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!parsed || typeof parsed !== 'object') return null;
  const { v, events, nextSeq } = parsed as Partial<StoredEnvelope>;
  if (v !== LOG_VERSION || !validStoredEvents(events)) return null;
  const frozen = events.map((e) => deepFreeze(upgradeStored(e))) as SessionEvent[];
  const maxSeq = frozen.reduce((m, e) => Math.max(m, e.seq), 0);
  if (nextSeq !== undefined && (!Number.isSafeInteger(nextSeq) || nextSeq <= maxSeq)) return null;
  return { events: frozen, now, nextSeq: nextSeq ?? maxSeq + 1, listeners: new Set() };
}
