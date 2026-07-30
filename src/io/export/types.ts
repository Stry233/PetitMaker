export type ResolutionKey = 'compact' | 'standard' | 'high' | 'original';
/** User-facing export preset (the primary control). Maps directly to importability + size —
 *  the share code is a visible glyph band, so a map is importable iff the band is present. */
export type ExportPreset = 'share' | 'plain';
export interface ExportOptions {
  title: string; description: string;
  preset: ExportPreset;
  /** "Let others rebuild this map" — draws a PetitGlyph v2 share-code band into the image. */
  importable: boolean;
  // Appearance (advanced/Details):
  showBadge: boolean; layerPreview: boolean; card3d: boolean; grid: boolean; footer: boolean;
  /** Footer line template: literal text + {tokens} + an optional {fill} that right-aligns the rest. */
  footerTemplate: string;
  resolution: ResolutionKey; // "Size"
}

/** Whether the export should carry a share-code band. */
export function hasShareCode(o: ExportOptions): boolean {
  return o.importable;
}
/** Apply a preset's defaults onto the options (the controls remain individually tweakable). */
export function applyPreset(o: ExportOptions, preset: ExportPreset): ExportOptions {
  const base = { ...o, preset };
  if (preset === 'share') return { ...base, importable: true };
  return { ...base, importable: false }; // plain
}
export interface Rect { x: number; y: number; w: number; h: number }
export interface Badge { label: string; color: string }
export interface ExportComposition {
  width: number; height: number;
  /** Scale factor: BASE_WIDTH → actual width. Multiply font sizes by this. */
  scale: number;
  map: Rect; header?: Rect; layerCol?: Rect; layerLabel?: Rect; card3d?: Rect; codeBand?: Rect; footer?: Rect;
  badges: Badge[];
  /** True when a share code was requested but the composition is too small to host one
   *  (below the codec's minimum module base) — the caller should toast export.code_too_small. */
  codeBandUnavailable?: boolean;
}
