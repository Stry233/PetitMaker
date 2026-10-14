/* Note text sizes in cells: the ink scale, the label size tables and the plate estimates hit testing reads. */
import { chipTextSize, type ChipNote, type ZoneNote } from '../annotations';

/** Scale annotations from the template's longest dimension; 36 cells maps to scale 1. */
export function annotationInkScale(template: { width: number; height: number }): number {
  return Math.max(1, Math.max(template.width, template.height) / 36);
}

/** Base annotation dimensions in cell units. Both views apply the shared ink scale and cell size. */
export const INK_CELLS = {
  text: { s: 0.66, m: 0.9, l: 1.2 } as Record<'s' | 'm' | 'l', number>,
  zoneLabel: { s: 0.56, m: 0.75, l: 1.0 } as Record<'s' | 'm' | 'l', number>,
  /** A route's reach for pointer hits, as half its target width. Every drawn line takes its width
   *  from the view (`view/shared/annotation/annotation-line.ts`). */
  route: 0.22,
} as const;

/** Route hit distance in cells, with a minimum target for pointer input. */
export function routeHitDistCells(inkScale: number): number {
  return Math.max(0.45, INK_CELLS.route * inkScale * 2);
}

/** Label units for width estimates: CJK characters count as one, Latin characters as 0.55. */
function labelUnits(label: string): number {
  let units = 0;
  for (const ch of label) units += ch.charCodeAt(0) > 0xff ? 1 : 0.55;
  return units;
}

/** Estimate a chip's plate width for shared hit testing. */
export function chipApproxWidthCells(note: ChipNote, label: string, inkScale = 1): number {
  const em = INK_CELLS.text[note.size]! * inkScale;
  return Math.max(1, (labelUnits(label) + 1.3) * em);
}

/** A chip's plate height in cells, from the same size table the width uses. */
export function chipApproxHeightCells(note: ChipNote, inkScale = 1): number {
  return INK_CELLS.text[note.size]! * inkScale * 1.6;
}

/** Estimate the selectable width of a zone's centered number-and-label caption. */
export function zoneLabelApproxWidthCells(zone: ZoneNote, label: string, inkScale = 1): number {
  const fs = INK_CELLS.zoneLabel[chipTextSize(zone.size ?? 'm')] * inkScale;
  const numR = zone.num > 0 ? fs * 0.62 : 0;
  return Math.max(fs, numR * 2 + (zone.num > 0 && label ? fs * 0.3 : 0) + labelUnits(label) * fs);
}

/** The caption's height in cells, matching the drawn number disc. */
export function zoneLabelApproxHeightCells(zone: ZoneNote, inkScale = 1): number {
  return INK_CELLS.zoneLabel[chipTextSize(zone.size ?? 'm')] * inkScale * 1.4;
}
