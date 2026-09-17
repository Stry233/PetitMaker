/** The map's own title and description: one record shared by saves, the share code and every export. */
import type { MapNotes } from './types';

/** Character limits, counted in code points so a surrogate pair is never split. The share code
 *  spends up to four bytes per character on them; the export header shows the description in two lines. */
export const NOTE_LIMITS = { title: 48, description: 200 } as const;

function field(value: unknown, limit: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = [...value.trim()].slice(0, limit).join('');
  return text === '' ? undefined : text;
}

/** Untrusted notes (a save, a code, a form) reduced to the record the format carries; undefined when empty. */
export function clampNotes(raw: unknown): MapNotes | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const { title, description } = raw as Record<string, unknown>;
  const out: MapNotes = {};
  const t = field(title, NOTE_LIMITS.title), d = field(description, NOTE_LIMITS.description);
  if (t !== undefined) out.title = t;
  if (d !== undefined) out.description = d;
  return t === undefined && d === undefined ? undefined : out;
}

/** The record as typed, cut to the limits but keeping inner spaces mid-sentence; undefined once both fields are blank. */
export function limitNotes(raw: MapNotes): MapNotes | undefined {
  const title = [...(raw.title ?? '')].slice(0, NOTE_LIMITS.title).join('');
  const description = [...(raw.description ?? '')].slice(0, NOTE_LIMITS.description).join('');
  if (title.trim() === '' && description.trim() === '') return undefined;
  return { ...(title.trim() ? { title } : {}), ...(description.trim() ? { description } : {}) };
}
