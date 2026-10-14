/**
 * The share picture's export, from the map to an encoded PNG. The composition every device produces
 * is sized against desktop's constants; where this device cannot hold it in one canvas, or one
 * capture cannot hold the map, the Original is painted in tiles from a map captured region by region.
 * A selected stylize version replaces the map bitmap, so the map itself is never captured then.
 */
import type { CameraAngle } from '../../state/view-camera';
import type { GridState } from '../../core/model/types';
import type { MapProvenanceSummary } from '../../core/provenance/types';
import { seedShots } from '../../view/map3d/capture/shot-list';
import type { MapCapturer } from '../../view/map-capture';
import { needsBanding, renderBanded } from './banded';
import { aspectOf, capture3dStills, captureMapBase, compositionAssets, type BaseMapSource, type MapCaptureHost, type StylizedCompose } from './composition-assets';
import { CARD_3D_CELL_ASPECT } from './compose';
import { paintComposition, type CompositionAssets } from './paint';
import { exportComposition } from './render';
import { CANVAS_LIMITS, clampedCaptureRequestPx, mapNativePx, type CanvasLimits } from './sizing';
import { TiledMap } from './tiled-map';
import type { DroppedRows, ExportComposition, ExportOptions } from './types';
import type { I18nKey } from '../../i18n/keys';

/** The captures an image export reads, as the view host offers them. */
export type ImageExportHost = MapCaptureHost & Pick<MapCapturer, 'capture2d' | 'capture2dTextureCap' | 'capture3dStills'>;

/** The share code drawn at a band width: its canvas and a notice to show after the export, or null
 *  where the band cannot hold a legible code. Throws where the code could not be built. */
export type ShareCodeBand = (width: number) => Promise<{ canvas: HTMLCanvasElement; notice: I18nKey | null } | null>;

export interface ImageExportRequest {
  state: GridState;
  summary: MapProvenanceSummary;
  options: ExportOptions;
  stylized: StylizedCompose | null;
  /** The chosen 3D shots; smart angles stand in when none were chosen. */
  shots: CameraAngle[];
  footerTokens: Record<string, string>;
  brand: CompositionAssets['brand'];
  translate: CompositionAssets['translate'];
  shareCode: ShareCodeBand;
  /** What this device's canvas can allocate; a composition past it is a blank image, not a large one. */
  limits: CanvasLimits;
}

export type ImageExportResult =
  | { status: 'no-capture' }
  | { status: 'no-image' }
  | { status: 'done'; blob: Blob; carriesCode: boolean; codeTooSmall: boolean; codeFailed: boolean; codeNotice: I18nKey | null };

/** A non-tiled capture is bounded; the renderer clamps to its GPU texture size either way. */
const PRESET_CAPTURE_PX = 2400;
/** The largest tile a tiled export captures at once. */
const MAX_TILE_PX = 4096;
/** The stylized picture's grid and ink are captured at this size before they are laid over it. */
const STYLIZED_LAYER_PX = 2048;

/** Exports the share picture; null when `signal` aborted it. `progress` reports a tiled export's share done. */
export async function runImageExport(
  host: ImageExportHost, request: ImageExportRequest, signal: AbortSignal, progress: (fraction: number | null) => void,
): Promise<ImageExportResult | null> {
  const { state, summary, options, stylized, limits } = request;
  const nativePx = mapNativePx(state.template);
  const wide = options.resolution === 'original' && !stylized
    ? exportComposition(options, state, summary, { aspect: nativePx.w / nativePx.h, px: nativePx }, { limits: CANVAS_LIMITS })
    : null;
  // A GPU texture cap below the native size would otherwise shrink the Original.
  const tiled = wide !== null && (needsBanding(wide, limits) || Math.max(nativePx.w, nativePx.h) > host.capture2dTextureCap());

  let baseMap: BaseMapSource | TiledMap;
  let mapAspect: number;
  let mapPx: { w: number; h: number };
  if (tiled) {
    const tile = Math.min(MAX_TILE_PX, host.capture2dTextureCap());
    baseMap = new TiledMap(
      nativePx.w, nativePx.h, (region) => host.capture2d({ tile: { region, resolution: 1 }, grid: options.grid, annotations: options.annotations }),
      tile,
    );
    mapAspect = nativePx.w / nativePx.h;
    mapPx = nativePx;
  } else {
    // The Original asks for the largest native capture this device holds; presets a bounded one.
    const px = stylized ? STYLIZED_LAYER_PX : options.resolution === 'original' ? clampedCaptureRequestPx(state.template, limits) : PRESET_CAPTURE_PX;
    const captured = await captureMapBase(host, { px, grid: options.grid, annotations: options.annotations, stylized });
    if (!captured) return { status: 'no-capture' };
    baseMap = captured;
    mapAspect = aspectOf(captured);
    mapPx = { w: captured.width, h: captured.height };
  }
  if (signal.aborted) return null;

  // The layout is laid out again without any row its assets could not fill, so a dropped row
  // leaves no gap. The 3D stills come first: the code band is built at the width of the final layout.
  const dropped: DroppedRows = {};
  // A tiled Original is laid out against desktop's ceiling; its tiles keep each canvas inside this device's.
  const layout = (): ExportComposition =>
    exportComposition(options, state, summary, { aspect: mapAspect, px: mapPx }, { limits: tiled ? CANVAS_LIMITS : limits, dropped });
  let comp = layout();

  let card3dAngles: HTMLImageElement[] = [];
  if (comp.card3d) {
    const shots = request.shots.length ? request.shots : seedShots(state);
    card3dAngles = await capture3dStills(host, state, shots, Math.round(comp.card3d.h * CARD_3D_CELL_ASPECT));
    if (card3dAngles.length === 0) { dropped.card3d = true; comp = layout(); }
  }

  let codeImg: HTMLCanvasElement | null = null;
  let codeTooSmall = comp.codeBandUnavailable === true;
  let codeFailed = false;
  let codeNotice: I18nKey | null = null;
  if (comp.codeBand) {
    // The code is built at the exact width the composition reserved: encoding at canvas width clips it.
    try {
      const band = await request.shareCode(comp.codeBand.w);
      codeImg = band?.canvas ?? null;
      codeNotice = band?.notice ?? null;
      if (!codeImg) codeTooSmall = true;
    } catch (e) {
      // A failed code leaves the picture export available, with a warning after download.
      console.error('[export] share code build failed', e);
      codeFailed = true;
    }
    if (!codeImg) { dropped.codeBand = true; comp = layout(); }
  }
  const assets = compositionAssets({
    options, state, summary, baseMap, card3dAngles, codeImg,
    footerTokens: request.footerTokens, brand: request.brand, translate: request.translate,
  });

  let blob: Blob | null;
  if (tiled) {
    progress(0);
    const tiledComp = comp;
    blob = await renderBanded({
      width: tiledComp.width, height: tiledComp.height, limits, signal,
      paint: (ctx, window) => paintComposition(ctx, tiledComp, { ...assets, window }),
      onProgress: progress,
    });
  } else {
    const canvas = document.createElement('canvas');
    canvas.width = comp.width;
    canvas.height = comp.height;
    const ctx = canvas.getContext('2d');
    if (ctx) paintComposition(ctx, comp, assets);
    // The painted canvas is encoded as it stands; a round trip through ImageData would copy every pixel twice.
    blob = ctx ? await new Promise<Blob>((res, rej) => { canvas.toBlob((b) => { if (b) res(b); else rej(new Error('toBlob returned null')); }, 'image/png'); }) : null;
  }
  if (signal.aborted) return null;
  if (!blob) return { status: 'no-image' };
  return { status: 'done', blob, carriesCode: codeImg !== null, codeTooSmall, codeFailed, codeNotice };
}
