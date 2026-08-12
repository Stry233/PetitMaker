/*
 * stencil-plan.ts — a sample (or something typed, or a file dropped in) turned into a runnable plan.
 *
 * This is the seam between what the shelf holds and what the generator takes: the shelf knows about
 * letters, pictures and a fill setting; the generator knows about a `Stencil` and where to put it.
 * Everything a browser is needed for happens here, once per plan.
 *
 * IMAGES ARE DECODED ONCE. A batch is five cards over the same pool and a slider moving re-asks for
 * all of them, so decoding per plan would re-fetch the same picture dozens of times; the cache is
 * keyed by source and holds the decoded bitmap.
 */
import { TerrainType, type CatalogItem, type MacroCoord, type StencilPlan } from '../../../core/model/types';
import { getAllItems } from '../../../state/catalog';
import { sampleIconRGB } from '../../../canvas/icon-sampling';
import { iconUrl } from '../../../assets/icon-urls';
import { tilesAShape } from '../../../tools/generation/stencil-generator';
import { rasterizeImage, rasterizeText, type StencilBox } from './stencil-raster';
import type { StencilSample } from './stencil-samples';

/** How a text plan should be built: the material, or the item to tile it with. */
export type StencilFill =
  | { kind: 'terrain'; terrain: TerrainType }
  | { kind: 'object'; catalogId: string };

export interface PlanInputs {
  box: StencilBox;
  /** image kinds only: whether the picture is TILED WITH OBJECTS or coloured in terrain. The palette
   *  is only sampled for the former, since sampling eighty icons for a plan that will not use them is
   *  the slowest thing on the shelf. */
  objects?: boolean;
  /** image kinds only, terrain fills: whether water may join the palette. */
  water?: boolean;
  /** The cells the run may write to, as flat indices — the region itself, not its box. */
  allow?: ReadonlySet<number>;
  /** text kinds only. */
  fill?: StencilFill;
  /** image kinds only, 0..2 with 1 leaving the picture alone. */
  contrast?: number;
}

const decoded = new Map<string, Promise<CanvasImageSource & { width: number; height: number }>>();

function loadImage(src: string): Promise<CanvasImageSource & { width: number; height: number }> {
  let pending = decoded.get(src);
  if (!pending) {
    pending = new Promise((resolve, reject) => {
      const img = new Image();
      // Everything offered is same-origin app art; a file the visitor supplies arrives as a blob or
      // data URL, which is same-origin too. Set anyway so a future remote source cannot taint the
      // canvas and make `getImageData` throw where the failure would be very hard to read.
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`stencil image failed: ${src}`));
      img.src = src;
    });
    decoded.set(src, pending);
  }
  return pending;
}

/**
 * The objects a picture may be built from, each with the colour its own icon reads as.
 *
 * ONE CELL EACH. An item with a bigger footprint would overlap its neighbour and be refused for it,
 * so a colour mosaic can only be tiled with 1x1 items — of which the catalogue has plenty, being
 * mostly flowers. Anything the rules cap is out for the same reason a letter cannot use it: the
 * second cell onward would be refused (`tilesAShape`).
 *
 * Sampled ONCE and kept. Every card of every batch matches against the same palette, and decoding 80
 * icons per press would be the slowest thing on the shelf; the sampler skips outline and highlight
 * pixels, so what comes back is the colour the item reads as rather than its average.
 */
let palette: Promise<readonly { catalogId: string; rgb: number }[]> | null = null;

export function objectColorPalette(): Promise<readonly { catalogId: string; rgb: number }[]> {
  if (palette) return palette;
  palette = (async () => {
    const usable = getAllItems().filter((i: CatalogItem) => tilesAShape(i) && i.width === 1 && i.height === 1);
    const out: { catalogId: string; rgb: number }[] = [];
    await Promise.all(usable.map(async (item) => {
      // The item's own sprite. A colour-only item (a road) has none, and `tilesAShape` has already
      // excluded those, so anything left here that lacks one is simply skipped.
      const url = item.icon ? iconUrl(item.icon) : undefined;
      if (!url) return;
      try {
        const img = await loadImage(url);
        const rgb = sampleIconRGB(img);
        if (rgb) out.push({ catalogId: item.id, rgb: ((rgb[0] << 16) | (rgb[1] << 8) | rgb[2]) >>> 0 });
      } catch { /* an icon that will not decode simply is not in the palette */ }
    }));
    return out;
  })();
  return palette;
}

/** Forget a decoded picture — for a file the visitor replaces, whose object URL is about to die. */
export function forgetStencilImage(src: string): void {
  decoded.delete(src);
}

/**
 * The plan a sample builds, or null when there is nothing to build from (an empty field, an image
 * that would not decode, a region with no room in it).
 *
 * A sample carrying TEXT is read as a shape and a sample carrying a SOURCE is read as colour, which
 * is what makes the two kinds one pipeline: the shelf never has to say which mode it is in.
 */
export async function buildStencilPlan(sample: StencilSample, inputs: PlanInputs): Promise<StencilPlan | null> {
  const { box } = inputs;
  const origin: MacroCoord = box.origin;

  if (sample.text) {
    const stencil = rasterizeText(sample.text, box);
    if (!stencil) return null;
    const fill = inputs.fill ?? { kind: 'terrain' as const, terrain: TerrainType.Mountain };
    return { read: 'shape', fill, stencil, origin, ...(inputs.allow ? { allow: inputs.allow } : {}) };
  }

  if (sample.src) {
    try {
      const img = await loadImage(sample.src);
      const stencil = rasterizeImage(img, img.width, img.height, box);
      if (!stencil) return null;
      // OBJECTS give a picture dozens of hues where the terrain ramp is eight greens and a blue, so
      // that is the mode that reproduces rather than paraphrases -- but it is the visitor's choice,
      // and asking for terrain has to GET terrain. An empty palette (no canvas, nothing decoded)
      // falls back to terrain colouring on its own.
      const objectPalette = inputs.objects ? await objectColorPalette() : [];
      return {
        read: 'color', stencil, origin, contrast: inputs.contrast ?? 1,
        water: inputs.water ?? false,
        ...(inputs.allow ? { allow: inputs.allow } : {}),
        ...(objectPalette.length ? { objectPalette } : {}),
      };
    } catch {
      return null;   // an unreadable picture is one blank card, never a broken shelf
    }
  }

  return null;
}
