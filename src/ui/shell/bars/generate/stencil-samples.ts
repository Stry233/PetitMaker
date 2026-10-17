/*
 * The pools the picture kinds deal their batch from: their input is the recipe, so New batch deals another
 * seeded hand from the pool; the visitor's own card is untouched.
 */
import { BRAND_LOGO_URL } from '../../../chrome/brand-logo';
import { makeRng } from '../../../../core/base/rng';
import { localizedName } from '../../../../i18n/context';
import { brandName } from '../../../../i18n/terms/brand';
import type { Locale, LocalizedName } from '../../../../core/model/locale';
import { NEIGHBORS } from '../../../../config/neighbors';
import type { StencilKind } from '../../../../tools/generation/facts';

/** One example on the row: a letter to build, or a picture to build from. */
export interface StencilSample {
  id: string;
  /** The text a letter sample rasterizes. */
  text?: string;
  /** The image a picture sample loads. */
  src?: string;
  /** What the picture is, in the visitor's own language — `yunguo-icon` is a filename, Yunguo is a
   *  neighbour. A sample carries its own name, since none of these pictures is a catalog item. */
  name?: LocalizedName;
}

/** Letters chosen for range: wide capitals, round lowercase, a descender, outline marks and colour emoji. */
export const TEXT_POOL: readonly StencilSample[] = [
  ...['A', 'B', 'E', 'G', 'K', 'M', 'R', 'S', 'W', 'Z'].map((c) => ({ id: c, text: c })),
  ...['a', 'e', 'g', 'k', 'm', 'q', 's'].map((c) => ({ id: c, text: c })),
  ...['&', '@', '?', '★', '☀', '❤', '♪'].map((c) => ({ id: c, text: c })),
  ...['🌳', '🏠', '🐟', '🌊', '⛰', '🍎', '🌙'].map((c) => ({ id: c, text: c })),
];

const portraits = import.meta.glob('../../../../assets/neighbors/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const portraitUrl: Record<string, string> = {};
for (const path in portraits) {
  portraitUrl[path.split('/').pop()!.replace('-icon.png', '')] = portraits[path]!;
}

export const IMAGE_POOL: readonly StencilSample[] = [
  { id: 'logo', src: BRAND_LOGO_URL },
  ...NEIGHBORS.flatMap(({ id, name }) => {
    const src = portraitUrl[id];
    return src ? [{ id, src, name }] : [];
  }),
];

const POOLS: Record<StencilKind, readonly StencilSample[]> = { text: TEXT_POOL, image: IMAGE_POOL };

/** A sample's name on its card: its letters, its picture's localized name, or the app's name for its own mark. */
export function sampleName(sample: StencilSample, locale: Locale): string {
  if (sample.text) return sample.text;
  if (sample.name) return localizedName(sample.name, locale);
  return sample.id === 'logo' ? brandName(locale) : sample.id;
}

/** The pool a stencil input draws from; empty for the kinds that generate their own recipes. */
export function poolFor(input: StencilKind | null): readonly StencilSample[] {
  return input ? POOLS[input] : [];
}

/**
 * `count` samples drawn from `pool` without replacement by `seed`, the batch seed the terrain kinds use; a
 * pool shorter than the hand deals all of it.
 */
export function drawSamples(pool: readonly StencilSample[], count: number, seed: number): StencilSample[] {
  if (pool.length <= count) return [...pool];
  const rng = makeRng(seed);
  const bag = [...pool];
  const out: StencilSample[] = [];
  for (let i = 0; i < count; i++) {
    out.push(...bag.splice(Math.floor(rng.float() * bag.length), 1));
  }
  return out;
}
