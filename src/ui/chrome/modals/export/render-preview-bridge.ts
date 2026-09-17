// render-preview-bridge.ts
// Browser-only export-preview rendering, split so typing in title/description never recaptures the
// map or the 3D stills: captureBaseMap / captureCard3dAngles are the EXPENSIVE steps (run only when
// the map / resolution / 3D toggle / chosen shots change); paintPreview is CHEAP (a canvas draw + text) and re-runs on
// every keystroke. paintPreview draws the real Share-Image layout (map dominant + the REAL
// share-code band) so the preview matches the final export; while the code is still encoding the
// preview stays in its loading state — there is no placeholder band.
import { host } from '../../../../kit/host';
import { computeComposition } from '../../../../io/export/compose';
import { deviceCanvasLimits } from '../../../../io/export/canvas-limits';
import { CANVAS_LIMITS } from '../../../../io/export/sizing';
import { layersFor, maxTerrainElevation } from '../../../../io/export/layer-preview';
import { paintComposition, CARD_3D_CELL_ASPECT } from '../../../../io/export/paint';
import { brandInfo } from './brand';
import { loadImage } from '../../../../io/export/canvas-helpers';
import { badgesFor } from '../../../../io/export/render';
import { captureMapStills, type CameraAngle } from '../../../../canvas/map3d/capture';
import { translateFor, localizedName } from '../../../../i18n/context';
import type { ExportOptions } from '../../../../io/export/types';
import { mapNativePx } from '../../../../io/share';
import type { GridState, Locale } from '../../../../core/model/types';
import type { MapProvenanceSummary } from '../../../../core/provenance/types';
import { selectedVersion } from './stylize/use-stylize-versions';
import { composeStylizedBaseMap } from './stylize/compose-stylized';

const MIN_3D_PX = 32;
const PREVIEW_W = 1440; // cap the preview canvas width; the chosen Size affects only the final export.

/** What either baseMap producer (a real capture, or a stylized composite) actually is — narrower
 *  than `CanvasImageSource` so `.width`/`.height` stay plain numbers downstream. */
export type BaseMapSource = HTMLImageElement | HTMLCanvasElement;

/** Live footer token values for a map (date and dims are filled in by the painter from the comp). */
export function footerTokenValues(state: GridState, options: ExportOptions, locale: Locale, summary: MapProvenanceSummary | null): Record<string, string> {
  const now = new Date();
  const peak = maxTerrainElevation(state);
  const seed = state.generation?.seed;
  return {
    name: localizedName(state.template.name, locale) || '',
    cells: `${state.template.width}×${state.template.height}`,
    layers: String(layersFor(state).length),
    objects: String(state.objects.size),
    title: options.title || '',
    brand: translateFor(locale, 'app.name'),
    time: now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }),
    weekday: now.toLocaleDateString(locale, { weekday: 'long' }),
    peak: peak > 0 ? `L${peak}` : '',
    seed: seed != null ? String(seed) : '',
    // Coverage is a real number even at zero: no AI/procedural content means 0%, NOT "unavailable".
    ai: `${summary?.aiAreaPct ?? 0}%`,
    proc: `${summary?.proceduralAreaPct ?? 0}%`,
  };
}

const EMPTY_SUMMARY: MapProvenanceSummary = {
  exportDisclosure: 'human_created', dominant: 'human_created', containsAi: false, containsProcedural: false,
  aiEverUsed: false, aiUsedNoRemaining: false, aiTerrainPct: 0, aiObjectCount: 0, aiAreaPct: 0, proceduralAreaPct: 0,
  humanAfterAi: false, aiAfterHuman: false, counts: { aiWrites: 0, aiAccepted: 0, proceduralRuns: 0, analysisOnlyCalls: 0 },
};

/** EXPENSIVE: capture the 2D map at preview resolution, OR — when a stylize version is selected —
 *  compose that version's picture with the user's own ink instead of capturing the map bitmap at
 *  all. Cache by resolution in the caller. includeGrid bakes the real 2D grid (sub + cell + chunk
 *  lines) into the capture; 原图 (no selection) keeps that plain path byte for byte. */
export async function captureBaseMap(px = 720, includeGrid = false, annotations?: boolean, aiTag = ''): Promise<BaseMapSource | null> {
  const version = selectedVersion();
  if (version) {
    const inkUrl = annotations ? host.capture2dAnnotations(px) : null;
    const ink = inkUrl ? await loadImage(inkUrl).catch(() => null) : null;
    // The grid is a layer over the picture, as the ink is: the redrawn band carries none of its own.
    const gridUrl = includeGrid ? host.capture2dGrid(px) : null;
    const grid = gridUrl ? await loadImage(gridUrl).catch(() => null) : null;
    // Every model-drawn picture carries the disclosure, whether its model ran locally or remotely.
    return composeStylizedBaseMap(version.image, ink, version.kind === 'model' ? aiTag : '', grid);
  }
  const url = host.capture2d(px, includeGrid, annotations);
  return url ? loadImage(url).catch(() => null) : null;
}
/** EXPENSIVE: capture the 3D thumbnails for the export card. `angles` are the user's chosen export
 *  shots; when omitted, content-aware smart angles are derived. Empty array if 3D is unavailable. */
export async function captureCard3dAngles(state: GridState, angles?: CameraAngle[], maxPx = 360): Promise<HTMLImageElement[]> {
  const urls = await captureMapStills(state, angles, { maxPx, aspect: CARD_3D_CELL_ASPECT });
  const imgs = await Promise.all(urls.map((u) => (u ? loadImage(u).catch(() => null) : Promise.resolve(null))));
  return imgs.filter((im): im is HTMLImageElement => !!im && im.width >= MIN_3D_PX && im.height >= MIN_3D_PX);
}

/** CHEAP: paint the preview from already-captured assets. Returns a PNG data URL (or null).
 *  Always the SAME composed layout as the export (map dominant + optional restore-strip band),
 *  so the preview matches the final image and every appearance option stays visible. */
export interface PaintPreviewArgs {
  options: ExportOptions; summary: MapProvenanceSummary | null; state: GridState; locale: Locale;
  baseMap: BaseMapSource; card3dAngles: HTMLImageElement[];
  /** The REAL rendered share-code band (built async by the modal); the caller gates painting on
   *  it being ready, so null here only means "this export carries no code". */
  codeImg?: HTMLCanvasElement | null;
  /** The locale's logo lockup, preloaded by the caller (null = plain-text fallback). */
  brandLockup?: HTMLImageElement | null;
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
  const mapAspect = (baseMap.width / baseMap.height) || 1.2;
  const badges = options.showBadge ? badgesFor(sum) : [];
  // The code band's geometry is exact pixel math (moduleBaseFor of the composition width), so the
  // preview gets the TRUE band rect for free, and codeImg is the REAL encoded band (identical to
  // the export for the standard/high presets — same session createdAt).
  const limits = deviceCanvasLimits();
  const comp = computeComposition(options, mapAspect, badges, { layerCount: layersFor(state).length, mapPx: { w: baseMap.width, h: baseMap.height }, limits });
  if (options.card3d && card3dAngles.length === 0) comp.card3d = undefined;

  // Footer dimensions must report the FINAL export size. Presets fix their width, so the preview
  // composition already matches; Native is captured small for the preview, so compute its true
  // native composition size and show that instead.
  let footerDims: { w: number; h: number } | undefined;
  if (options.resolution === 'original') {
    const nativePx = mapNativePx(state.template);
    // The export composes the Original in tiles where one canvas cannot hold it, so its size does
    // not depend on this device's ceiling.
    const nativeComp = computeComposition(options, mapAspect, badges, { layerCount: layersFor(state).length, mapPx: nativePx, limits: CANVAS_LIMITS });
    footerDims = { w: nativeComp.width, h: nativeComp.height };
  }

  const scale = Math.min(1, PREVIEW_W / comp.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(comp.width * scale); canvas.height = Math.round(comp.height * scale);
  // The compositor copies these pixels immediately; avoid queuing thousands of thumbnail draws on the GPU.
  const ctx = canvas.getContext('2d', { willReadFrequently: true }); if (!ctx) return null;
  ctx.scale(scale, scale);
  paintComposition(ctx, comp, {
    baseMap, card3dAngles: options.card3d ? card3dAngles : [],
    codeImg: codeImg ?? null, grid: options.grid, footerDims,
    footerTemplate: options.footerTemplate, footerTokens: args.footerTokens ?? footerTokenValues(state, options, locale, sum),
    state, summary: sum, title: options.title, description: options.description,
    translate: (k, v) => translateFor(locale, k, v),
    brand: brandInfo(locale, options, args.brandLockup ?? null),
  });
  return { canvas, comp, scale };
}
