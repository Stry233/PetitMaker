import { clampNotes } from '../model/notes';
import { CellZone, type GridState, type MapNotes } from '../model/types';

export const ATTRIBUTION_CHANGE_THRESHOLD = 0.3;

/** An image import's original notes and content, independent of optional authorship disclosure. */
export interface ImageAttribution {
  version: 1;
  templateId: string;
  notes: MapNotes;
  units: string[];
}

const SQUARES = ['square', 'square', 'square', 'square'];

/** IDs, notes, annotations and camera settings do not contribute to map-content differences. */
export function attributionUnits(state: GridState): string[] {
  const units: string[] = [];
  for (let y = 0; y < state.template.height; y++) {
    for (let x = 0; x < state.template.width; x++) {
      const cell = state.cells[y]?.[x];
      const t = cell?.terrain;
      if (!t || cell.zone === CellZone.Plaza) continue;
      units.push(JSON.stringify(['t', x, y, t.type, t.elevation, t.corners ?? SQUARES, !!t.patchOnly, t.patchBase ?? 0]));
    }
  }
  for (const obj of state.objects.values()) {
    if (obj.locked) continue;
    units.push(JSON.stringify(['o', obj.position.x, obj.position.y, obj.catalogId, obj.rotation,
      obj.elevation, obj.spanLength ?? 0, obj.corners ?? SQUARES, !!obj.patchOnly]));
  }
  return units;
}

export function captureImageAttribution(state: GridState): ImageAttribution | undefined {
  const notes = clampNotes(state.notes);
  return notes ? { version: 1, templateId: state.template.id, notes, units: attributionUnits(state) } : undefined;
}

/** Each occupied terrain cell and placed object is one unit; replacements count once. */
export function imageChangeRatio(state: GridState): number {
  const original = state.imageAttribution;
  if (!original || original.templateId !== state.template.id) return 1;
  const current = attributionUnits(state);
  const remaining = new Map<string, number>();
  for (const unit of original.units) remaining.set(unit, (remaining.get(unit) ?? 0) + 1);
  let shared = 0;
  for (const unit of current) {
    const count = remaining.get(unit) ?? 0;
    if (count > 0) { shared++; remaining.set(unit, count - 1); }
  }
  const total = Math.max(original.units.length, current.length);
  return total === 0 ? 0 : (total - shared) / total;
}

export function protectedImageNotes(state: GridState): MapNotes | undefined {
  return state.imageAttribution && imageChangeRatio(state) < ATTRIBUTION_CHANGE_THRESHOLD
    ? state.imageAttribution.notes : undefined;
}

/** Preserve each nonempty original field while allowing empty fields to be filled. */
export function attributedNotes(state: GridState, notes: MapNotes | null | undefined = state.notes): MapNotes | undefined {
  const original = protectedImageNotes(state);
  return original ? { ...notes, ...original } : notes ?? undefined;
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
