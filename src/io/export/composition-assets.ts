/**
 * The pieces a share picture is painted from, gathered one way for the live preview and the export:
 * the map (a 2D capture, or a stylized picture with the user's grid and ink laid back over it), the
 * 3D card's stills, and the assets object `paintComposition` takes.
 */
import type { CameraAngle } from '../../state/view-camera';
import type { GridState } from '../../core/model/types';
import type { MapProvenanceSummary } from '../../core/provenance/types';
import type { MapCapturer } from '../../view/map-capture';
import { loadImage } from '../../platform/async/load-image';
import { CARD_3D_CELL_ASPECT, FALLBACK_MAP_ASPECT } from './compose';
import type { CompositionAssets } from './paint';
import type { ExportOptions } from './types';

/** What either map producer returns, narrower than `CanvasImageSource` so width and height are plain numbers. */
export type BaseMapSource = HTMLImageElement | HTMLCanvasElement;

/** The map captures an export reads, as the view host offers them. */
export type MapCaptureHost = Pick<MapCapturer, 'capture2dImage'>;

/** Draws a stylized picture with the map's own grid and ink over it, at the picture's size. */
export type StylizedCompose = (ink: HTMLImageElement | null, grid: HTMLImageElement | null) => HTMLCanvasElement;

/** A 3D still smaller than this on either side is a failed render, not a picture. */
const MIN_3D_PX = 32;

export const aspectOf = (img: { width: number; height: number }): number => (img.width / img.height) || FALLBACK_MAP_ASPECT;

/**
 * The map band's picture at `px`: a selected stylize version replaces the map bitmap (the map is never
 * captured) with the grid and ink laid back over it; otherwise the 2D capture, grid baked in on request.
 */
export async function captureMapBase(host: MapCaptureHost, { px, grid, annotations, stylized }: {
  /** Whether the user's plan notes are drawn; undefined follows their live visibility. */
  px: number; grid: boolean; annotations?: boolean; stylized: StylizedCompose | null;
}): Promise<BaseMapSource | null> {
  if (stylized) {
    const inkUrl = annotations ? host.capture2dImage({ content: 'notes', maxPx: px }) : null;
    const ink = inkUrl ? await loadImage(inkUrl).catch(() => null) : null;
    const gridUrl = grid ? host.capture2dImage({ content: 'grid', maxPx: px }) : null;
    const gridImg = gridUrl ? await loadImage(gridUrl).catch(() => null) : null;
    return stylized(ink, gridImg);
  }
  const url = host.capture2dImage({ maxPx: px, grid, annotations });
  return url ? loadImage(url).catch(() => null) : null;
}

/** The 3D card's stills for `shots` (smart angles when none), dropping any that failed to render. */
export async function capture3dStills(
  host: Pick<MapCapturer, 'capture3dStills'>, state: GridState, shots: CameraAngle[] | undefined, maxPx: number,
): Promise<HTMLImageElement[]> {
  const urls = await host.capture3dStills(state, shots, { maxPx, aspect: CARD_3D_CELL_ASPECT });
  const imgs = await Promise.all(urls.map((u) => (u ? loadImage(u).catch(() => null) : Promise.resolve(null))));
  return imgs.filter((im): im is HTMLImageElement => !!im && im.width >= MIN_3D_PX && im.height >= MIN_3D_PX);
}

/** Everything `paintComposition` needs besides the layout, from the export's own choices. */
export function compositionAssets({ options, state, summary, baseMap, card3dAngles, codeImg, footerTokens, footerDims, brand, translate }: {
  options: ExportOptions;
  state: GridState;
  summary: MapProvenanceSummary;
  baseMap: CompositionAssets['baseMap'];
  card3dAngles: CanvasImageSource[];
  codeImg: CanvasImageSource | null;
  footerTokens: Record<string, string>;
  footerDims?: { w: number; h: number };
  brand: CompositionAssets['brand'];
  translate: CompositionAssets['translate'];
}): CompositionAssets {
  return {
    baseMap,
    card3dAngles: options.card3d ? card3dAngles : [],
    codeImg,
    grid: options.grid,
    ...(footerDims ? { footerDims } : {}),
    footerTemplate: options.footerTemplate,
    footerTokens,
    state,
    summary,
    title: options.title,
    description: options.description,
    translate,
    brand,
  };
}
