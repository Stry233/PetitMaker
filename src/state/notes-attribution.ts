/**
 * Which notes an image import keeps: the import's own title and description stay on the map until
 * its content has changed by the threshold, and undo re-evaluates the current map rather than
 * counting edits. `io/save/image-attribution.ts` captures and reads the record.
 */
import type { GridState, MapNotes } from '../core/model/types';
import { SQUARE_CORNERS } from '../core/model/corners';

const ATTRIBUTION_CHANGE_THRESHOLD = 0.3;

/** The map's content as units: each occupied terrain cell and each unlocked object is one unit.
 *  IDs, notes, annotations and camera settings do not count. The units are a persisted contract
 *  (version 1 of the record). */
export function attributionUnits(state: GridState): string[] {
  const units: string[] = [];
  for (let y = 0; y < state.template.height; y++) {
    for (let x = 0; x < state.template.width; x++) {
      const cell = state.cells[y]?.[x];
      const t = cell?.terrain;
      if (!t) continue;
      units.push(JSON.stringify(['t', x, y, t.type, t.elevation, t.corners ?? SQUARE_CORNERS, !!t.patchOnly, t.patchBase ?? 0]));
    }
  }
  for (const obj of state.objects.values()) {
    if (obj.locked) continue;
    units.push(JSON.stringify(['o', obj.position.x, obj.position.y, obj.catalogId, obj.rotation,
      obj.elevation, obj.spanLength ?? 0, obj.corners ?? SQUARE_CORNERS, !!obj.patchOnly]));
  }
  return units;
}

/** The share of units changed since the import; replacements count once. */
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
