// Browser-only export-preview rendering, split so typing in title/description never recaptures the
// map or the 3D stills: captureBaseMap / captureCard3dAngles are the expensive steps (run only when
// the map / resolution / 3D toggle / chosen shots change); paintPreview is cheap (a canvas draw + text) and re-runs on
// every keystroke. paintPreview draws the real Share-Image layout (map dominant + the real
// share-code band) so the preview matches the final export; while the code is still encoding the
// preview stays in its loading state — there is no placeholder band.
import { host } from '../host/host';
import { computeComposition } from '../../io/export/compose';
import { deviceCanvasLimits } from '../../io/export/canvas-limits';
import { CANVAS_LIMITS, mapNativePx } from '../../io/export/sizing';
import { layersFor } from '../../io/export/layer-preview';
import { getMapStats } from '../../state/map-stats';
import { paintComposition } from '../../io/export/paint';
import { aspectOf, capture3dStills, captureMapBase, compositionAssets, type BaseMapSource, type StylizedCompose } from '../../io/export/composition-assets';
import { exportComposition } from '../../io/export/render';
import { composeStylizedBaseMap } from '../../io/export/stylized-band';
import type { CameraAngle } from '../../state/view-camera';
import { translateFor } from '../../i18n/context';
import { shownPlanetName } from '../session/planet-names';
import type { ExportOptions } from '../../io/export/types';
import type { GridState } from '../../core/model/types';
import type { Locale } from '../../core/model/locale';
import type { MapProvenanceSummary } from '../../core/provenance/types';
import { selectedVersion } from '../../state/stylize-versions';
import { brandInfo } from './brand';
import { layerNumeral } from '../../i18n/terms/layer-name';

export { loadBrandLockup } from './brand';

const PREVIEW_W = 1440; // cap the preview canvas width; the chosen Size affects only the final export.

export type { BaseMapSource };

/** Live footer token values for a map (date and dims are filled in by the painter from the comp). */
export function footerTokenValues(state: GridState, options: ExportOptions, locale: Locale, summary: MapProvenanceSummary | null): Record<string, string> {
  const now = new Date();
  const peak = getMapStats(state).terrainTop;
  const seed = state.generation?.seed;
  return {
    name: shownPlanetName(state.template, locale),
    cells: `${state.template.width}×${state.template.height}`,
    layers: String(layersFor(state).length),
    objects: String(state.objects.size),
    title: options.title || '',
    brand: translateFor(locale, 'app.name'),
    time: now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }),
    weekday: now.toLocaleDateString(locale, { weekday: 'long' }),
    peak: peak > 0 ? `L${layerNumeral(peak)}` : '',
    seed: seed != null ? String(seed) : '',
    // Coverage is a real number even at zero: no AI/procedural content means 0%, not "unavailable".
    ai: `${summary?.aiTerrainPct ?? 0}%`,
    proc: `${summary?.proceduralAreaPct ?? 0}%`,
  };
}

const EMPTY_SUMMARY: MapProvenanceSummary = {
  exportDisclosure: 'human_created', containsAi: false, containsProcedural: false,
  aiEverUsed: false, aiUsedNoRemaining: false, aiTerrainPct: 0, aiObjectCount: 0, proceduralAreaPct: 0,
  humanAfterAi: false, aiAfterHuman: false,
};

/** The selected stylize version as the map band's picture, or null while the original map is
 *  chosen. Every model-drawn picture carries the disclosure `aiTag`, whether its model ran locally
 *  or remotely. */
export function selectedStylizedBase(aiTag: string): StylizedCompose | null {
  const version = selectedVersion();
  return version ? (ink, grid) => composeStylizedBaseMap(version.image, ink, version.kind === 'model' ? aiTag : '', grid) : null;
}

/** Expensive: the map band's picture at preview resolution, the stylized picture when a version
 *  is selected (cache by resolution in the caller). */
export function captureBaseMap(px = 720, includeGrid = false, annotations?: boolean, aiTag = ''): Promise<BaseMapSource | null> {
  return captureMapBase(host, { px, grid: includeGrid, annotations, stylized: selectedStylizedBase(aiTag) });
}

/** Expensive: the 3D card's stills for the chosen shots, or smart angles; empty where 3D is unavailable. */
export function captureCard3dAngles(state: GridState, angles?: CameraAngle[], maxPx = 360): Promise<HTMLImageElement[]> {
  return capture3dStills(host, state, angles, maxPx);
}

/** Cheap: paint the preview from already-captured assets. Returns a PNG data URL (or null).
 *  Always the same composed layout as the export (map dominant + optional restore-strip band),
 *  so the preview matches the final image and every appearance option stays visible. */
interface PaintPreviewArgs {
  options: ExportOptions; summary: MapProvenanceSummary | null; state: GridState; locale: Locale;
  baseMap: BaseMapSource; card3dAngles: HTMLImageElement[];
  /** The real rendered share-code band (built async by the modal); the caller gates painting on
   *  it being ready, so null here only means "this export carries no code". */
  codeImg?: HTMLCanvasElement | null;
  /** The locale's logo lockup, preloaded by the caller (null = plain-text fallback). */
  brandLockup?: HTMLImageElement | null;
  /** The deployment's canonical origin, which the band names under the site mark. */
  site: string;
  /** Resolved values approved by the text check; do not substitute fresh map metadata afterward. */
  footerTokens?: Record<string, string>;
}

/** What a painted preview is made of: the picture, and the layout it was painted at, so a reader
 *  of one band (the Help Center's crops) can slice by the composition's own rects. `scale` maps
 *  the comp's coordinates onto the returned canvas's pixels. */
export interface PaintedPreview { url: string; comp: ReturnType<typeof computeComposition>; scale: number }

/** Interactive previews display pixels directly instead of synchronously encoding a PNG on every edit. */
export function paintPreview(args: PaintPreviewArgs): HTMLCanvasElement | null {
  return paintCanvasLayout(args)?.canvas ?? null;
}

export function paintPreviewLayout(args: PaintPreviewArgs): PaintedPreview | null {
  const painted = paintCanvasLayout(args);
  return painted ? { url: painted.canvas.toDataURL('image/png'), comp: painted.comp, scale: painted.scale } : null;
}

function paintCanvasLayout(args: PaintPreviewArgs): { canvas: HTMLCanvasElement; comp: ReturnType<typeof computeComposition>; scale: number } | null {
  const { options, summary, state, locale, baseMap, card3dAngles, codeImg } = args;
  const sum = summary ?? EMPTY_SUMMARY;
  const mapAspect = aspectOf(baseMap);
  // The code band's geometry is exact pixel math (moduleBaseFor of the composition width), so the
  // preview gets the true band rect for free, and codeImg is the real encoded band (identical to
  // the export for the standard/high presets — same session createdAt).
  const limits = deviceCanvasLimits();
  const dropped = { card3d: card3dAngles.length === 0 };
  const comp = exportComposition(options, state, sum, { aspect: mapAspect, px: { w: baseMap.width, h: baseMap.height } }, { limits, dropped });

  // Footer dimensions must report the final export size. Presets fix their width, so the preview
  // composition already matches; Native is captured small for the preview, so compute its true
  // native composition size and show that instead.
  let footerDims: { w: number; h: number } | undefined;
  if (options.resolution === 'original') {
    const nativePx = mapNativePx(state.template);
    // The export composes the Original in tiles where one canvas cannot hold it, so its size does
    // not depend on this device's ceiling.
    const nativeComp = exportComposition(options, state, sum, { aspect: mapAspect, px: nativePx }, { limits: CANVAS_LIMITS, dropped });
    footerDims = { w: nativeComp.width, h: nativeComp.height };
  }

  const scale = Math.min(1, PREVIEW_W / comp.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(comp.width * scale); canvas.height = Math.round(comp.height * scale);
  // The compositor copies these pixels immediately; avoid queuing thousands of thumbnail draws on the GPU.
  const ctx = canvas.getContext('2d', { willReadFrequently: true }); if (!ctx) return null;
  ctx.scale(scale, scale);
  paintComposition(ctx, comp, compositionAssets({
    options, state, summary: sum, baseMap, card3dAngles, codeImg: codeImg ?? null, footerDims,
    footerTokens: args.footerTokens ?? footerTokenValues(state, options, locale, sum),
    translate: (k, v) => translateFor(locale, k, v),
    brand: brandInfo(locale, options, args.brandLockup ?? null, args.site),
  }));
  return { canvas, comp, scale };
}
