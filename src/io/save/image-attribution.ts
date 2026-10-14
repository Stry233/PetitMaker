/** The image-import attribution record as saves and share imports carry it. */
import { clampNotes } from '../../core/model/notes';
import type { GridState, ImageAttribution } from '../../core/model/types';
import { attributionUnits } from '../../state/notes-attribution';

/** The record for a map just made from an image: its notes and its content as units. */
export function captureImageAttribution(state: GridState): ImageAttribution | undefined {
  const notes = clampNotes(state.notes);
  return notes ? { version: 1, templateId: state.template.id, notes, units: attributionUnits(state) } : undefined;
}

/** Additive save data is bounded separately from the editable notes. */
export function readImageAttribution(raw: unknown, state: GridState, maxUnits: number): ImageAttribution | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Partial<ImageAttribution>;
  const notes = clampNotes(r.notes);
  if (r.version !== 1 || r.templateId !== state.template.id || !notes || !Array.isArray(r.units)
    || r.units.length > maxUnits || r.units.some(u => typeof u !== 'string' || u.length > 512)) return undefined;
  return { version: 1, templateId: r.templateId, notes, units: [...r.units] };
}
