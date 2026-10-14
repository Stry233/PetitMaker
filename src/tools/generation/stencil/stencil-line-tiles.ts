import type { Rotation } from '../../../core/model/types';
import type { CatalogEntry } from '../../../config/catalog/catalog-entry';
import type { Stencil } from '../recipe';

/** Clockwise rotation of N/E/S/W exits. */
function rotateStrokeConnections(mask: number, turns: number): number {
  return ((mask << turns) | (mask >> (4 - turns))) & 15;
}

/** Only catalog artwork with declared centerline exits can supply connected lettering. */
export function strokeTilePalette(items: readonly CatalogEntry[], curved = false): Map<number, { catalogId: string; rotation: Rotation }> {
  const palette = new Map<number, { catalogId: string; rotation: Rotation }>();
  const ordered = [...items].sort((a, b) => Number(!!a.strokeCurve !== curved) - Number(!!b.strokeCurve !== curved));
  for (const item of ordered) {
    if (!item.strokeConnections || !item.surfacePrint || item.disabled || item.ruleTBD || item.width !== 1 || item.height !== 1) continue;
    for (let turn = 0; turn < (item.rotatable ? 4 : 1); turn++) {
      const mask = rotateStrokeConnections(item.strokeConnections, turn);
      if (!palette.has(mask)) palette.set(mask, { catalogId: item.id, rotation: (turn * 90) as Rotation });
    }
  }
  return palette;
}

/** Open terminals use a straight tile; the catalog has no half-line endpoint piece. */
export function strokeTileMask(stencil: Stencil, index: number): number {
  const mask = stencil.connections?.[index] ?? 0;
  if (mask === 0) return 10;
  if ((mask & (mask - 1)) === 0) return mask | rotateStrokeConnections(mask, 2);
  return mask;
}
