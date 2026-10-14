/*
 * A sample (or something typed, or a file dropped in) turned into a runnable plan.
 *
 * This is the seam between what the shelf holds and what the generator takes: the shelf knows about
 * letters, pictures and a fill setting; the generator knows about a `Stencil` and where to put it.
 * Everything a browser is needed for happens here, once per plan.
 *
 * Images are decoded once. A batch is five cards over the same pool and a slider moving re-asks for
 * all of them, so decoding per plan would re-fetch the same picture dozens of times; the cache is
 * keyed by source and holds the decoded bitmap. A decode that fails is forgotten, and so is the
 * card it left blank, so the next ask decodes again.
 */
import { boundedMap } from '../../../core/base/bounded-map';
import { TerrainType, type MacroCoord } from '../../../core/model/types';
import { type StencilPlan, type StencilWaterRole } from '../recipe';
import { declaredColorPalette, type ColorEntry, type ObjectPaletteKind } from './stencil-palette';
import { ensureGlyphFonts, rasterizeImage, rasterizeText, rasterizeStrokeText, type StencilBox } from './stencil-raster';
import { stencilBrowser, type DecodedImage } from './stencil-browser';
import { fnv1aInts } from '../../../core/base/hash';

/** What a plan is built from: a word drawn as a shape, or a picture read as colour. */
export interface StencilSource { text?: string; src?: string }

/** How a text plan should be built: the material, or the item to tile it with. */
export type StencilFill = NonNullable<StencilPlan['fill']>;

export interface PlanInputs {
  box: StencilBox;
  /** image kinds only: whether the picture is tiled with objects or coloured in terrain. The palette
   *  is only sampled for the former, since sampling eighty icons for a plan that will not use them is
   *  the slowest thing on the shelf. */
  objects?: boolean;
  /** image kinds only, object fills: Which objects — the catalogue less the trees, the flowers, the
   *  trees, or the road surfaces. Absent is the catalogue less the trees. */
  material?: ObjectPaletteKind;
  /** image kinds only: what stands at the picture's anchor points, over the primary result. Absent
   *  is none. `species` names the decoration's own material; `density` is a share of the picture's
   *  cells, capped by the generator. */
  decor?: { species: ObjectPaletteKind; density?: number };
  /** image kinds only, terrain fills: what part water plays. */
  water?: StencilWaterRole;
  /** The cells the run may write to, as flat indices — the region itself, not its box. */
  allow?: ReadonlySet<number>;
  /** text kinds only. */
  fill?: StencilFill;
  /** image kinds only, 0..2 with 1 leaving the picture alone. */
  contrast?: number;
}

/** Decoded pictures kept, least recently asked for leaving first: a batch's pool and a few pasted files. */
const DECODED_MAX = 16;
const decoded = boundedMap<string, Promise<DecodedImage>>(DECODED_MAX);

/** A decode that fails leaves the cache, so the next ask decodes again. A hit refreshes recency. */
function loadImage(src: string): Promise<DecodedImage> {
  let pending = decoded.touch(src);
  if (pending) return pending;
  const browser = stencilBrowser();
  pending = browser ? browser.loadImage(src) : Promise.reject(new Error('no browser to decode stencil images'));
  decoded.set(src, pending);
  const settled = pending;
  settled.catch(() => { if (decoded.get(src) === settled) decoded.delete(src); });
  return pending;
}

/**
 * The objects a picture may be built from, each with the colour it reads as, for one material: the
 * whole one-cell catalogue, the flowers alone, the trees alone, or the road surfaces. Every item a
 * material offers declares its colour in the catalog (`color`, or the sprite's derived `iconColor`),
 * so the palette is read, never sampled, and lists the items in catalog order: a colour two items
 * match equally well goes to the first of them (`stencil.ts:nearestByColor`).
 */
const palettes = new Map<ObjectPaletteKind, readonly ColorEntry[]>();

function objectColorPalette(material: ObjectPaletteKind = 'mixed'): readonly ColorEntry[] {
  let palette = palettes.get(material);
  if (!palette) { palette = declaredColorPalette(material); palettes.set(material, palette); }
  return palette;
}

/** Forget a decoded picture — for a file the visitor replaces, whose object URL is about to die.
 *  The built plans go with it: they were rasterized from the picture being replaced, and an object
 *  URL can be minted again at the same address for different bytes. */
export function forgetStencilImage(src: string): void {
  decoded.delete(src);
  builtPlans.clear();
}

/**
 * Built plans, keyed by everything a plan is a function of: the sample's own content, the box, and
 * each input the two raster paths read. A plan is deterministic over those — the fonts, the decoded
 * picture and the palettes are all module caches already — so re-asking (a kind left and returned
 * to, the same sample re-dealt) answers without rasterizing. Bounded; a hit refreshes recency.
 */
const BUILT_PLANS_MAX = 24;
const builtPlans = boundedMap<string, StencilPlan | null>(BUILT_PLANS_MAX);

function planKey(sample: StencilSource, inputs: PlanInputs): string {
  // The allow set is region cells; its content matters, its identity does not.
  let allow = '';
  if (inputs.allow) {
    allow = `${inputs.allow.size}:${fnv1aInts(inputs.allow)}`;
  }
  return JSON.stringify([
    sample.text ?? null, sample.src ?? null, inputs.box, inputs.fill ?? null, inputs.contrast ?? 1,
    inputs.objects ?? false, inputs.material ?? null, inputs.decor ?? null, inputs.water ?? null, allow,
  ]);
}

function fileBuiltPlan(key: string, plan: StencilPlan | null): void {
  builtPlans.set(key, plan);
}

/** The plan these inputs already built, `null` included (an unreadable picture stays one blank
 *  card) — or `undefined` where nothing is filed and only `buildStencilPlan` can answer. A
 *  synchronous read, so a caller can restore a whole batch without rasterizing anything. */
export function peekStencilPlan(sample: StencilSource, inputs: PlanInputs): StencilPlan | null | undefined {
  const key = planKey(sample, inputs);
  if (!builtPlans.has(key)) return undefined;
  const hit = builtPlans.get(key)!;
  builtPlans.delete(key);
  builtPlans.set(key, hit);
  return hit;
}

/**
 * The plan a sample builds, or null when there is nothing to build from (an empty field, an image
 * that would not decode, a region with no room in it).
 *
 * A sample carrying text is read as a shape and a sample carrying a source is read as colour, which
 * is what makes the two kinds one pipeline: the shelf never has to say which mode it is in.
 */
export async function buildStencilPlan(sample: StencilSource, inputs: PlanInputs): Promise<StencilPlan | null> {
  const key = planKey(sample, inputs);
  const seen = peekStencilPlan(sample, inputs);
  if (seen !== undefined) return seen;
  let built: StencilPlan | null;
  try {
    built = await buildStencilPlanUncached(sample, inputs);
  } catch {
    return null;   // an unreadable picture is one blank card, never a broken shelf, and asks again next time
  }
  fileBuiltPlan(key, built);
  return built;
}

async function buildStencilPlanUncached(sample: StencilSource, inputs: PlanInputs): Promise<StencilPlan | null> {
  const { box } = inputs;
  const origin: MacroCoord = box.origin;

  if (sample.text) {
    // The faces first. A canvas does not wait for a font: name one that has not arrived and the text
    // is drawn in the platform fallback and read back as a different letter, with nothing to say so.
    await ensureGlyphFonts(sample.text);
    const fill = inputs.fill ?? { kind: 'terrain' as const, terrain: TerrainType.Mountain };
    const stencil = fill.kind === 'stroke' ? rasterizeStrokeText(sample.text, box) : rasterizeText(sample.text, box);
    if (!stencil) return null;
    return { read: 'shape', fill, stencil, origin, ...(inputs.allow ? { allow: inputs.allow } : {}) };
  }

  if (sample.src) {
    const img = await loadImage(sample.src);
    const stencil = rasterizeImage(img, img.width, img.height, box);
    if (!stencil) return null;
    // Objects give a picture dozens of hues where the terrain ramp is eight greens and a blue, so
    // that is the mode that reproduces rather than paraphrases -- but it is the visitor's choice,
    // and asking for terrain has to GET terrain. An empty palette falls back to terrain
    // colouring on its own.
    const objectPalette = inputs.objects ? objectColorPalette(inputs.material ?? 'mixed') : [];
    const decorPalette = inputs.decor ? objectColorPalette(inputs.decor.species) : [];
    return {
      read: 'color', stencil, origin, contrast: inputs.contrast ?? 1,
      water: inputs.water ?? 'none',
      ...(inputs.allow ? { allow: inputs.allow } : {}),
      ...(objectPalette.length ? { objectPalette } : {}),
      ...(decorPalette.length
        ? { decor: { palette: decorPalette, ...(inputs.decor?.density !== undefined ? { density: inputs.decor.density } : {}) } }
        : {}),
    };
  }

  return null;
}
