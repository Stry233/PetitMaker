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
import { TerrainType, type MacroCoord, type StencilPlan, type StencilWaterRole } from '../../../core/model/types';
import { declaredColorPalette, materialDeclaresColors, paletteItems, type ColorEntry, type StencilMaterial } from '../../../tools/generation/stencil';
import { sampleIconRGB } from '../../../canvas/icon-sampling';
import { iconUrl } from '../../../assets/icon-urls';
import { ensureGlyphFonts, rasterizeImage, rasterizeText, type StencilBox } from './stencil-raster';
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
  /** image kinds only, object fills: WHICH objects — the catalogue less the trees, the flowers, the
   *  trees, or the road surfaces. Absent is the catalogue less the trees. */
  material?: StencilMaterial;
  /** image kinds only: what stands at the picture's anchor points, over the primary result. Absent
   *  is none. `species` names the decoration's own material; `density` is a share of the picture's
   *  cells, capped by the generator. */
  decor?: { species: StencilMaterial; density?: number };
  /** image kinds only, terrain fills: what part water plays. */
  water?: StencilWaterRole;
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
 * The objects a picture may be built from, each with the colour it reads as, for one MATERIAL: the
 * whole one-cell catalogue, the flowers alone, the trees alone, or the road surfaces. Which items a
 * material offers is the engine's answer (`tools/generation/stencil/stencil-palette.ts`); what is done here
 * is the part that needs a browser, which is reading a sprite's dominant colour.
 *
 * Sampled ONCE PER MATERIAL and kept. Every card of every batch matches against the same palette, and
 * decoding 80 icons per press would be the slowest thing on the shelf; the sampler skips outline and
 * highlight pixels, so what comes back is the colour the item reads as rather than its average.
 */
const palettes = new Map<StencilMaterial, Promise<readonly ColorEntry[]>>();

export function objectColorPalette(material: StencilMaterial = 'mixed'): Promise<readonly ColorEntry[]> {
  const cached = palettes.get(material);
  if (cached) return cached;
  // A material whose items carry their own colour (the road surfaces) needs no sampling at all —
  // the catalog already says what each one draws in.
  const pending = materialDeclaresColors(material)
    ? Promise.resolve(declaredColorPalette(material))
    : samplePalette(material);
  palettes.set(material, pending);
  return pending;
}

function samplePalette(material: StencilMaterial): Promise<readonly ColorEntry[]> {
  return (async () => {
    const usable = paletteItems(material);
    const out: ColorEntry[] = [];
    await Promise.all(usable.map(async (item) => {
      // The item's own sprite. An item with no sprite has its colour declared instead, and that
      // material never reaches this path, so anything here that lacks one is simply skipped.
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
    // The faces first. A canvas does not wait for a font: name one that has not arrived and the text
    // is drawn in the platform fallback and read back as a different letter, with nothing to say so.
    await ensureGlyphFonts(sample.text);
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
      const objectPalette = inputs.objects ? await objectColorPalette(inputs.material ?? 'mixed') : [];
      const decorPalette = inputs.decor ? await objectColorPalette(inputs.decor.species) : [];
      return {
        read: 'color', stencil, origin, contrast: inputs.contrast ?? 1,
        water: inputs.water ?? 'none',
        ...(inputs.allow ? { allow: inputs.allow } : {}),
        ...(objectPalette.length ? { objectPalette } : {}),
        ...(decorPalette.length
          ? { decor: { palette: decorPalette, ...(inputs.decor?.density !== undefined ? { density: inputs.decor.density } : {}) } }
          : {}),
      };
    } catch {
      return null;   // an unreadable picture is one blank card, never a broken shelf
    }
  }

  return null;
}
