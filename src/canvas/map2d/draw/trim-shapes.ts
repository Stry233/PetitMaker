import * as PIXI from 'pixi.js-legacy';
import { HALF_TILE } from '../../../core/model/grid-model';
import type { CornerTrim } from '../../../core/model/types';
import { CORNER_POS, type CornerPos } from '../../../core/edge-cut/corner-index';
import { roadShapePoints } from '../../../core/edge-cut/road-shape';
import type { RoadConnSide } from '../../../core/edge-cut/road-cut-states';

/**
 * Canonical per-corner quadrant pixel offsets within a macro cell, in the corner
 * order [TL, TR, BL, BR]: TL=(0,0), TR=(HALF_TILE,0), BL=(0,HALF_TILE),
 * BR=(HALF_TILE,HALF_TILE). Shared by every consumer that splits a cell into its
 * four half-tile quadrants (block trims, cut backing) so the table lives once.
 */
export const QUADRANT_OFFSETS: readonly [number, number][] = [
  [0, 0], [HALF_TILE, 0], [0, HALF_TILE], [HALF_TILE, HALF_TILE],
];

function drawTrimmedCorner(
  g: PIXI.Graphics,
  state: CornerTrim,
  corner: CornerPos,
  x: number, y: number,
  size: number,
  color: number,
  alpha: number,
  patchOnly = false,
): void {
  if (state === 'empty') return;
  if (state === 'square') {
    g.beginFill(color, alpha);
    g.drawRect(x, y, size, size);
    g.endFill();
    return;
  }
  g.beginFill(color, alpha);
  if (state === 'fan') {
    drawFanCorner(g, corner, x, y, size, patchOnly);
  } else {
    const pts = directedTriPoints(state, x, y, size);
    g.moveTo(pts[0]![0], pts[0]![1]);
    g.lineTo(pts[1]![0], pts[1]![1]);
    g.lineTo(pts[2]![0], pts[2]![1]);
    g.closePath();
  }
  g.endFill();
}

function directedTriPoints(
  tri: 'tri-NW' | 'tri-NE' | 'tri-SW' | 'tri-SE',
  x: number, y: number, s: number,
): [number, number][] {
  switch (tri) {
    case 'tri-NW': return [[x, y], [x + s, y], [x, y + s]];
    case 'tri-NE': return [[x, y], [x + s, y], [x + s, y + s]];
    case 'tri-SW': return [[x, y + s], [x, y], [x + s, y + s]];
    case 'tri-SE': return [[x + s, y], [x + s, y + s], [x, y + s]];
  }
}

function drawFanCorner(
  g: PIXI.Graphics, corner: CornerPos,
  x: number, y: number, s: number,
  inverted = false,
): void {
  const steps = 12;
  let cx: number, cy: number, startAngle: number;
  if (!inverted) {
    // Outer fan: center at OPPOSITE corner, straight edges face inward
    switch (corner) {
      case 'TL': cx = x + s; cy = y + s; startAngle = Math.PI; break;
      case 'TR': cx = x; cy = y + s; startAngle = -Math.PI / 2; break;
      case 'BL': cx = x + s; cy = y; startAngle = Math.PI / 2; break;
      case 'BR': cx = x; cy = y; startAngle = 0; break;
    }
  } else {
    // Inner fan (Γ-patch): center at SAME corner, straight edges face outward
    switch (corner) {
      case 'TL': cx = x; cy = y; startAngle = 0; break;
      case 'TR': cx = x + s; cy = y; startAngle = Math.PI / 2; break;
      case 'BL': cx = x; cy = y + s; startAngle = -Math.PI / 2; break;
      case 'BR': cx = x + s; cy = y + s; startAngle = Math.PI; break;
    }
  }
  g.moveTo(cx, cy);
  for (let i = 0; i <= steps; i++) {
    const angle = startAngle + (Math.PI / 2) * (i / steps);
    g.lineTo(cx + Math.cos(angle) * s, cy + Math.sin(angle) * s);
  }
  g.closePath();
}

/**
 * A road tile's top face. The five canonical cut states come from `core/edge-cut/road-shape` as a
 * point list — the same one the 3D mesher and both ghost previews build from — so a cut road's
 * silhouette is one derivation wherever it is drawn. A full square, and any corner set matching no
 * canonical state, is the whole cell: no state may leave a hole in the paved path.
 */
export function drawRoadShape(
  g: PIXI.Graphics,
  corners: [CornerTrim, CornerTrim, CornerTrim, CornerTrim] | undefined,
  connSide: RoadConnSide,
  x: number, y: number,
  w: number, h: number,
  color: number, alpha: number,
): void {
  const pts = corners && !corners.every((c) => c === 'square')
    ? roadShapePoints(corners, connSide, x, y, w, h)
    : null;

  g.beginFill(color, alpha);
  if (!pts) {
    g.drawRect(x, y, w, h);
  } else {
    g.moveTo(pts[0]![0], pts[0]![1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]![0], pts[i]![1]);
    g.closePath();
  }
  g.endFill();
}

export function drawTrimmedBlock(
  g: PIXI.Graphics,
  corners: [CornerTrim, CornerTrim, CornerTrim, CornerTrim] | undefined,
  bx: number, by: number,
  halfSize: number,
  color: number,
  alpha: number,
  patchOnly = false,
): void {
  const c = corners ?? ['square', 'square', 'square', 'square'];
  const positions = CORNER_POS;
  for (let i = 0; i < 4; i++) {
    drawTrimmedCorner(g, c[i]!, positions[i]!, bx + QUADRANT_OFFSETS[i]![0], by + QUADRANT_OFFSETS[i]![1], halfSize, color, alpha, patchOnly);
  }
}
