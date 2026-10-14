import type { Rect } from '../../core/grid/rect';
import type { I18nKey } from '../../i18n/keys';
/** The export sizes, smallest first, as the Size control offers them. */
export const RESOLUTION_KEYS = ['compact', 'standard', 'high', 'original'] as const;
export type ResolutionKey = typeof RESOLUTION_KEYS[number];
/** User-facing export preset (the primary control). `share` draws the PetitGlyph band that lets
 *  another editor rebuild the map; `plain` draws none. */
export const EXPORT_PRESETS = ['share', 'plain'] as const;
export type ExportPreset = typeof EXPORT_PRESETS[number];
export interface ExportOptions {
  title: string; description: string;
  preset: ExportPreset;
  // Appearance (advanced/Details):
  showBadge: boolean; layerPreview: boolean; card3d: boolean; grid: boolean; footer: boolean;
  /** Draw the plan-notes layer in the map band. PetitGlyph data is independent of this choice. */
  annotations: boolean;
  /** Footer line template: literal text + {tokens} + an optional {fill} that right-aligns the rest. */
  footerTemplate: string;
  resolution: ResolutionKey; // "Size"
}

/** Whether the export carries the PetitGlyph band, which only the share preset draws. */
export function isImportable(o: Pick<ExportOptions, 'preset'>): boolean {
  return o.preset === 'share';
}

/** Apply a preset onto the options (the other controls remain individually tweakable). */
export function applyPreset(o: ExportOptions, preset: ExportPreset): ExportOptions {
  return { ...o, preset };
}
/** Rows the export asked for but could not fill: a share code that failed to build or a 3D card
 *  with no still. The layout closes them as though they were never chosen. */
export interface DroppedRows { codeBand?: boolean; card3d?: boolean }
export interface Badge { label: I18nKey; color: string }
export interface ExportComposition {
  width: number; height: number;
  /** Scale factor: BASE_WIDTH → actual width. Multiply font sizes by this. */
  scale: number;
  map: Rect; header?: Rect; layerCol?: Rect; layerLabel?: Rect; card3d?: Rect; codeBand?: Rect; footer?: Rect;
  badges: Badge[];
  /** True when a share code was requested but the composition is too small to host one
   *  (below the codec's minimum module base) — the caller should toast export.code_too_small. */
  codeBandUnavailable?: boolean;
  /** Nothing was asked for but the map itself: the canvas is the map band — no card margins, no
   *  frame stroke, no corner rounding. See computeComposition. */
  bare?: boolean;
  /** The maker's band, always carrying the lockup and optionally the deployment's site mark. */
  brand: Rect;
}
