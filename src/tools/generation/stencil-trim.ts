/*
 * stencil-trim.ts — the corner chooser that reads the source picture.
 *
 * The stencil is rasterized at twice the cell resolution (`Stencil.quad`), so every corner of every
 * cell carries how much of it the source covers. Each candidate shape covers a known share of its
 * quadrant — a square corner all of it, a quarter-round fan π/4 ≈ 0.785, a 45° bevel 0.5; a Γ
 * fillet's concave fan piece 1 − π/4 ≈ 0.215, its bevel half — and each corner takes the shape whose
 * area is nearest the source's coverage there. A diagonal stroke's edge cells sit near half coverage
 * and come out bevelled or rounded; a flat-topped stroke sits near full and stays square.
 *
 * The chooser expresses preference. It is consulted at corners the cut validators have already
 * offered (`auto-edge-cut.ts`), so everything it asks for is legal by the manual tool's own rules.
 */
import type { MacroCoord, Stencil } from '../../core/model/types';
import type { CornerChooser } from '../edge-cut/auto-edge-cut';

/** Candidate areas as a share of one quadrant. */
const SQUARE = 1;
const FAN = Math.PI / 4;          // ≈ 0.785
const TRI = 0.5;
const FILLET_FAN = 1 - Math.PI / 4; // ≈ 0.215, the concave piece a Γ fan adds
const FILLET_TRI = 0.5;

/** Midpoints between neighbouring candidates: nearest-area choice as plain thresholds. */
const OUTER_KEEP = (SQUARE + FAN) / 2;   // above: the source fills the corner — keep it square
const OUTER_FAN = (FAN + TRI) / 2;       // above: fan; below: bevel
const INNER_TRI_AT = (FILLET_TRI + FILLET_FAN) / 2; // above: the bulge wants the bigger fill

/** An edge whose normal is tilted past ~22° reads as diagonal: min/max of the gradient components. */
const DIAG_AT = 0.4;

/**
 * The chooser for one placed stencil, or null when the stencil carries no quadrant detail (a
 * hand-built one) — the caller falls back to the blanket mode.
 *
 * A corner OUTSIDE the stencil is left alone (`null`): the pass sweeps a one-cell ring past what it
 * laid, and out there the picture has no opinion.
 */
export function stencilChooser(origin: MacroCoord, stencil: Stencil): CornerChooser | null {
  const { quad, width, height, coverage } = stencil;
  if (!quad) return null;

  // Which way the source's edge runs at a cell, from the coverage gradient (Sobel). A quantised
  // diagonal is a staircase, and on a staircase the BEVEL is the smooth choice: each step's chamfer
  // chains into one straight line, where a fan scallops and a mix of the two wobbles. An edge
  // running with the axes means the corner is a true corner of the drawing, and rounds.
  const cov = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= width || y >= height ? 0 : coverage[y * width + x]!;
  const onDiagonal = (x: number, y: number): boolean => {
    const gx = cov(x + 1, y - 1) + 2 * cov(x + 1, y) + cov(x + 1, y + 1)
      - cov(x - 1, y - 1) - 2 * cov(x - 1, y) - cov(x - 1, y + 1);
    const gy = cov(x - 1, y + 1) + 2 * cov(x, y + 1) + cov(x + 1, y + 1)
      - cov(x - 1, y - 1) - 2 * cov(x, y - 1) - cov(x + 1, y - 1);
    const ax = Math.abs(gx), ay = Math.abs(gy);
    return Math.min(ax, ay) > Math.max(ax, ay) * DIAG_AT;
  };

  return (x, y, corner, kind) => {
    const sx = x - origin.x, sy = y - origin.y;
    if (sx < 0 || sy < 0 || sx >= width || sy >= height) return null;
    const q = (quad[(sy * width + sx) * 4 + corner] ?? 0) / 255;
    if (kind === 'inner') {
      // The notch cell is OUTSIDE the glyph, so its quadrant is nearly inkless even at a genuinely
      // round concave corner — the curve's ink lives in the stroke cells beside it. A fillet adds
      // no mass, only smoothing, so an offered notch always fills. On a diagonal the half-quadrant
      // bevel continues the staircase's line; elsewhere the source decides how big the fill is.
      if (onDiagonal(sx, sy)) return 'tri';
      return q < INNER_TRI_AT ? 'fan' : 'tri';
    }
    // A convex corner of the shape (or of the ground an island cut reveals). On a diagonal every
    // offered corner is a staircase step and takes the chamfer; elsewhere cut only where the
    // source clips the corner, by nearest area.
    if (onDiagonal(sx, sy)) return 'tri';
    if (q >= OUTER_KEEP) return null;
    return q >= OUTER_FAN ? 'fan' : 'tri';
  };
}
