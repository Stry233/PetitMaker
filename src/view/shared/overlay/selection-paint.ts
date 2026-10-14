/*
 * Selection painters both views and the editor layer share: the selection outline for a set of blocks, and
 * the ring a single spin or a group turn carries through its animation.
 */
import type { GridState } from '../../../core/model/types';
import type { BlockRef } from '../../../state/selection';
import { getCell } from '../../../core/model/grid-model';
import { getPlacedObjectSize } from '../../../state/object-geometry';
import { getCatalogItem } from '../../../state/catalog';
import { isCoatingItem } from '../../../core/model/traits';
import { arcMotion, arcOffset } from '../motion/group-arc';
import type { GroupRotation } from '../../../tools/objects';
import type { ToolOverlay } from '../../../tools/pointer/runtime';
import { PLACEMENT_GRID, TERRAIN_GRID } from '../../../core/game/profile';

/**
 * Draw (or clear) the selection outline for the whole selection, resolving each
 * member's geometry from the grid. A single member draws a ring plus an optional
 * elevation label and an entrance pop (`append=false`). A group clears once then
 * draws one ring per member with `append=true`: no per-member clear, no label (one
 * label can't speak for N members at possibly different elevations), no pop (it
 * would replay N times). Terrain is never multi-selected, so `refs.length > 1` is
 * all objects by construction.
 *
 * Callers: the pointer machine and the selection view sync.
 */
export function paintSelection(
  overlay: ToolOverlay,
  gs: GridState,
  refs: readonly BlockRef[],
  showNumbers: boolean,
): void {
  if (refs.length === 0) { overlay.clearSelection(); return; }
  if (refs.length === 1) { paintOneBlock(overlay, gs, refs[0]!, showNumbers, false); return; }
  overlay.clearSelection();
  for (const block of refs) paintOneBlock(overlay, gs, block, showNumbers, true);
}

function paintOneBlock(
  overlay: ToolOverlay,
  gs: GridState,
  block: BlockRef,
  showNumbers: boolean,
  append: boolean,
): void {
  if (block.kind === 'object') {
    const obj = gs.objects.get(block.id);
    if (!obj) { if (!append) overlay.clearSelection(); return; }
    const size = getPlacedObjectSize(obj);
    // A lone road is flat and regular, so like terrain it gets its exact box in every view.
    const exact = !append && isCoatingItem(getCatalogItem(obj.catalogId));
    // A view that can bound the rendered body marks the body; the footprint
    // ring is the universal fallback (and the 2D behavior).
    if (overlay.showObjectSelection && !exact) {
      overlay.showObjectSelection(obj.id, append);
      return;
    }
    overlay.showSelection(
      { x: obj.position.x, y: obj.position.y, w: size.w, h: size.h }, PLACEMENT_GRID,
      { elevation: append || showNumbers ? undefined : obj.elevation, append, exact },
    );
  } else {
    const cell = getCell(gs.cells, block.x, block.y);
    overlay.showSelection(
      { x: block.x, y: block.y, w: 1, h: 1 }, TERRAIN_GRID,
      { elevation: append || showNumbers ? undefined : (cell?.terrain?.elevation ?? 0), append, exact: true },
    );
  }
}

/**
 * Repaint the selection ring at `eased` through a rotation's sweep, the same progress
 * `animateRotation`/`animateGroupRotation` applied, so the ring rides one clock
 * (`view/shared/motion/group-arc.ts`). `members` carries each ring's live centre offset in cells
 * (zero for a single spin). The ring's shape is the committed post-turn footprint, which the object
 * already shows since `objects-changed` rebuilt it before the tween began; only the centre travels.
 *
 * At `eased >= 1` it repaints through `paintSelection`, so a view with a body-bound box (3D's
 * `showObjectSelection`) gets that back.
 */
function paintRotationRing(
  overlay: ToolOverlay, gs: GridState, members: ReadonlyArray<{ id: string; dx: number; dy: number }>,
  eased: number, showNumbers: boolean,
): void {
  if (eased >= 1) {
    paintSelection(overlay, gs, members.map((m) => ({ kind: 'object', id: m.id }) as const), showNumbers);
    return;
  }
  const append = members.length > 1;
  overlay.clearSelection();
  for (const m of members) {
    const obj = gs.objects.get(m.id);
    if (!obj) continue; // a member can vanish mid-flight (undo, delete) — skip, don't abandon the rest
    const size = getPlacedObjectSize(obj);
    overlay.showSelection(
      { x: obj.position.x + m.dx, y: obj.position.y + m.dy, w: size.w, h: size.h }, PLACEMENT_GRID,
      { elevation: append || showNumbers ? undefined : obj.elevation, append },
    );
  }
}

/** `animateRotation`'s onFrame hook: a lone spin never moves or reshapes (see `paintRotationRing`),
 *  so this just keeps the ring painted through the same clock as the icon for API symmetry with the
 *  group hook below — there is nothing for a square item's ring to visibly do, and a non-square
 *  item's ring already holds its final (correct) shape throughout rather than tracking the icon's
 *  own still-turning visual angle. */
export function paintSpinRing(
  overlay: ToolOverlay, gs: GridState, id: string, eased: number, showNumbers: boolean,
): void {
  paintRotationRing(overlay, gs, [{ id, dx: 0, dy: 0 }], eased, showNumbers);
}

/** `animateGroupRotation`'s onFrame hook: every member's ring travels the same arc its wrapper does
 *  (see `paintRotationRing`), landing back on the plain selection exactly when the sprites do. */
export function paintGroupRotationArc(
  overlay: ToolOverlay, gs: GridState, turn: GroupRotation, eased: number, showNumbers: boolean,
): void {
  const sweepRad = (turn.sweepDeg * Math.PI) / 180;
  const members = turn.members.map((m) => {
    const { dx, dy } = arcOffset(arcMotion(turn.pivot, m.from), sweepRad, eased);
    return { id: m.id, dx, dy };
  });
  paintRotationRing(overlay, gs, members, eased, showNumbers);
}
