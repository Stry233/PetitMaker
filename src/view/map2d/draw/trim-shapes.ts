import * as PIXI from 'pixi.js-legacy';
import { QUADRANT_PX } from '../geometry/world';
import type { CornerTrim } from '../../../core/model/types';
import { CORNER_POS, SQUARE_CORNERS, isSquareCorners } from '../../../core/model/corners';
import { roadShapePoints } from '../../shared/road/shape';
import { cornerPolygon, type Quadrant } from '../../shared/terrain/quadrant-poly';
import type { RoadConnSide } from '../../../core/domain/edge-cut/road-cut-states';
import type { Rect } from '../../../core/grid/rect';

/**
 * Canonical per-corner quadrant pixel offsets within a macro cell, in the corner
 * order [TL, TR, BL, BR]: TL=(0,0), TR=(QUADRANT_PX,0), BL=(0,QUADRANT_PX),
 * BR=(QUADRANT_PX,QUADRANT_PX). Shared by every consumer that splits a cell into its
 * four half-tile quadrants (block trims, cut backing) so the table lives once.
 */
export const QUADRANT_OFFSETS: readonly [number, number][] = [
  [0, 0], [QUADRANT_PX, 0], [0, QUADRANT_PX], [QUADRANT_PX, QUADRANT_PX],
];

/** Arc subdivisions of a quarter fan in 2D, finer than the 3D meshes' because the map is seen flat at close zoom. */
const FAN_STEPS_2D = 12;

/** How a trimmed block fills: its colour and alpha, and whether its fans take the inner (fillet) winding. */
export interface TrimFill { color: number; alpha: number; patchOnly: boolean }

function drawTrimmedCorner(g: PIXI.Graphics, state: CornerTrim, quad: Quadrant, fill: TrimFill): void {
  if (state === 'empty') return;
  if (state === 'square') {
    g.beginFill(fill.color, fill.alpha);
    g.drawRect(quad.x, quad.z, quad.s, quad.s);
    g.endFill();
    return;
  }
  const pts = cornerPolygon(state, quad, fill.patchOnly, FAN_STEPS_2D)!;
  g.beginFill(fill.color, fill.alpha);
  g.moveTo(pts[0]![0], pts[0]![1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]![0], pts[i]![1]);
  g.closePath();
  g.endFill();
}

/**
 * A road tile's top face. The five canonical cut states come from `view/shared/road/shape` as a
 * point list — the same one the 3D mesher and both ghost previews build from — so a cut road's
 * silhouette is one derivation wherever it is drawn. A full square, and any corner set matching no
 * canonical state, is the whole cell: no state may leave a hole in the paved path.
 */
export function drawRoadShape(
  g: PIXI.Graphics,
  corners: [CornerTrim, CornerTrim, CornerTrim, CornerTrim] | undefined,
  connSide: RoadConnSide,
  box: Rect,
  fill: { color: number; alpha: number },
): void {
  const pts = corners && !isSquareCorners(corners)
    ? roadShapePoints(corners, connSide, box)
    : null;

  g.beginFill(fill.color, fill.alpha);
  if (!pts) {
    g.drawRect(box.x, box.y, box.w, box.h);
  } else {
    g.moveTo(pts[0]![0], pts[0]![1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]![0], pts[i]![1]);
    g.closePath();
  }
  g.endFill();
}

/** A block whose top-left pixel is (bx, by) and whose quadrants are `halfSize` square. */
export function drawTrimmedBlock(
  g: PIXI.Graphics,
  corners: [CornerTrim, CornerTrim, CornerTrim, CornerTrim] | undefined,
  block: { bx: number; by: number; halfSize: number },
  fill: TrimFill,
): void {
  const c = corners ?? SQUARE_CORNERS;
  const positions = CORNER_POS;
  for (let i = 0; i < 4; i++) {
    const quad = { x: block.bx + QUADRANT_OFFSETS[i]![0], z: block.by + QUADRANT_OFFSETS[i]![1], s: block.halfSize, pos: positions[i]! };
    drawTrimmedCorner(g, c[i]!, quad, fill);
  }
}
