import * as PIXI from 'pixi.js-legacy';
import { HALF_TILE } from '../../../core/model/grid-model';
import type { CornerTrim } from '../../../core/model/types';
import { CORNER_POS, type CornerPos } from '../../../core/edge-cut/corner-index';

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

type ConnSide = 'left' | 'right' | 'top' | 'bottom';

function txPt(
  u: number, v: number, side: ConnSide,
  x: number, y: number, hw: number, hh: number,
): [number, number] {
  switch (side) {
    case 'left': return [x + u * hw, y + v * hh];
    case 'right': return [x + (2 - u) * hw, y + v * hh];
    case 'top': return [x + v * hw, y + u * hh];
    case 'bottom': return [x + (2 - v) * hw, y + (2 - u) * hh];
  }
}

function arcPts(
  cx: number, cy: number, r: number,
  startU: number, startV: number, endU: number, endV: number,
  side: ConnSide, x: number, y: number, hw: number, hh: number,
  steps: number,
): [number, number][] {
  const [pcx, pcy] = txPt(cx, cy, side, x, y, hw, hh);
  const [psx, psy] = txPt(startU, startV, side, x, y, hw, hh);
  const [pex, pey] = txPt(endU, endV, side, x, y, hw, hh);
  const startA = Math.atan2(psy - pcy, psx - pcx);
  const endA = Math.atan2(pey - pcy, pex - pcx);
  const pr = r * hw;
  const pts: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    let a = startA + t * ((endA - startA + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
    if (Math.abs(endA - startA) > Math.PI) {
      a = startA + t * (endA - startA > 0 ? endA - startA - 2 * Math.PI : endA - startA + 2 * Math.PI);
    }
    pts.push([pcx + Math.cos(a) * pr, pcy + Math.sin(a) * pr]);
  }
  return pts;
}

export function drawRoadShape(
  g: PIXI.Graphics,
  corners: [CornerTrim, CornerTrim, CornerTrim, CornerTrim] | undefined,
  connSide: ConnSide,
  x: number, y: number,
  w: number, h: number,
  color: number, alpha: number,
): void {
  const hw = w / 2, hh = h / 2;
  const steps = 16;
  const p = (u: number, v: number) => txPt(u, v, connSide, x, y, hw, hh);

  if (!corners || corners.every(c => c === 'square')) {
    // State 0: raw/uncut — a SQUARE full-cell tile (default look), so adjacent road
    // cells read as one continuous surface (no rounded end-caps between blocks).
    g.beginFill(color, alpha);
    g.drawRect(x, y, w, h);
    g.endFill();
    return;
  }

  const [tl, tr, bl, br] = corners;
  const filled = (s: CornerTrim) => s === 'square';

  g.beginFill(color, alpha);

  if (filled(tl) && filled(tr) && filled(bl) && !filled(br)) {
    // BR fan: quarter-circle curve at lower-right
    g.moveTo(...p(0, 0));
    g.lineTo(...p(2, 0));
    const arc1 = arcPts(0, 0, 2, 2, 0, 0, 2, connSide, x, y, hw, hh, steps);
    for (const pt of arc1) g.lineTo(...pt);
    g.closePath();
  } else if (filled(tl) && !filled(tr) && filled(bl) && filled(br)) {
    // TR fan: quarter-circle curve at upper-right
    g.moveTo(...p(0, 2));
    g.lineTo(...p(2, 2));
    const arc2 = arcPts(0, 2, 2, 2, 2, 0, 0, connSide, x, y, hw, hh, steps);
    for (const pt of arc2) g.lineTo(...pt);
    g.closePath();
  } else if (!filled(tl) && !filled(tr) && filled(bl) && filled(br)) {
    // State 3: diagonal \ — triangle (0,0)-(0,2)-(2,2)
    g.moveTo(...p(0, 0));
    g.lineTo(...p(0, 2));
    g.lineTo(...p(2, 2));
    g.closePath();
  } else if (filled(tl) && filled(tr) && !filled(bl) && !filled(br)) {
    // State 4: diagonal / — triangle (0,0)-(2,0)-(0,2)
    g.moveTo(...p(0, 0));
    g.lineTo(...p(2, 0));
    g.lineTo(...p(0, 2));
    g.closePath();
  } else if (filled(tl) && !filled(tr) && filled(bl) && !filled(br)) {
    // State 5: wedge — triangle (0,0)-(1,1)-(0,2)
    g.moveTo(...p(0, 0));
    g.lineTo(...p(1, 1));
    g.lineTo(...p(0, 2));
    g.closePath();
  } else {
    g.drawRect(x, y, w, h);
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
