/*
 * stencil-samples.ts — the pools the two picture kinds draw their batch from.
 *
 * A PICTURE KIND IS DETERMINISTIC: the input IS the recipe, and the same letter builds the same
 * island every time. So there is no seed to reroll — but the row still wants a batch and a way to
 * ask for another one, or these two kinds would be the odd ones out, with a control that refuses
 * where every other kind's works.
 *
 * A POOL ANSWERS BOTH. The batch is a seeded DRAW from the pool rather than a seeded generation, so
 * `New batch` deals another hand and every card is still exactly what it shows. The visitor's own
 * card is unaffected, the way it is everywhere else: it is the one thing on the shelf they authored.
 */
import { makeRng } from '../../../core/model/rng';
import { iconUrl } from '../../../assets/icon-urls';
import { getCatalogItem } from '../../../state/catalog';
import { localizedName } from '../../../i18n/context';
import type { Locale } from '../../../core/model/types';

/** One example on the row: a letter to build, or a picture to build from. */
export interface StencilSample {
  id: string;
  /** The text a letter sample rasterizes. */
  text?: string;
  /** The image a picture sample loads. */
  src?: string;
  /** The catalog item this picture IS, where it is one — so the card can show the item's own name
   *  instead of the file's. `flower-agapanthus` is a filename; "Agapanthus" is a picture. */
  itemId?: string;
}

/**
 * Letters worth showing, chosen for RANGE rather than as an alphabet: wide capitals, round
 * lowercase with bowls, one with a descender, marks that are nearly all outline, and emoji — which
 * are the case that proves the pipeline carries colour and multi-code-point input.
 */
export const TEXT_POOL: readonly StencilSample[] = [
  ...['A', 'B', 'E', 'G', 'K', 'M', 'R', 'S', 'W', 'Z'].map((c) => ({ id: c, text: c })),
  ...['a', 'e', 'g', 'k', 'm', 'q', 's'].map((c) => ({ id: c, text: c })),
  ...['&', '@', '?', '★', '☀', '❤', '♪'].map((c) => ({ id: c, text: c })),
  ...['🌳', '🏠', '🐟', '🌊', '⛰', '🍎', '🌙'].map((c) => ({ id: c, text: c })),
];

/**
 * Pictures to build from, all art this app already ships, so the mode can be tried with one press
 * and no file on hand.
 *
 * The logo comes from `public/` through BASE_URL, the same path `BrandLockup` and the favicon
 * resolve. The rest are CATALOG SPRITES, reached through the same `iconUrl` resolver the item cards
 * use: they are small, colourful and read at a glance, which is what a colour mode wants to show off.
 */
const PICTURE_ICONS = [
  'building-myhouse', 'building-plush-cabin', 'facility-pavilion', 'tree-apple',
  'flower-agapanthus', 'bridge-park-arch', 'facility-shop', 'tree-avocado',
];

export const IMAGE_POOL: readonly StencilSample[] = [
  { id: 'logo', src: `${import.meta.env.BASE_URL}logo-256.png` },
  ...PICTURE_ICONS.flatMap((name) => {
    const src = iconUrl(name);
    return src ? [{ id: name, src, itemId: name }] : [];
  }),
];

/**
 * What to call a sample on its card: the letters themselves, the catalog item's own localized name,
 * or the app's name for its own logo. Never the id, which is a filename.
 */
export function sampleName(sample: StencilSample, locale: Locale, appName: string): string {
  if (sample.text) return sample.text;
  if (sample.itemId) {
    const item = getCatalogItem(sample.itemId);
    if (item) return localizedName(item.name, locale);
  }
  return sample.id === 'logo' ? appName : sample.id;
}

/** The pool a kind draws from; empty for the kinds that generate their own recipes. */
export function poolFor(kind: string): readonly StencilSample[] {
  if (kind === 'text') return TEXT_POOL;
  if (kind === 'image') return IMAGE_POOL;
  return [];
}

/**
 * `count` samples from `pool`, drawn without replacement and decided entirely by `seed` — the same
 * batch seed the island kinds deal their recipe numbers from, so one control means one thing on
 * every kind and a batch is reproducible.
 *
 * A pool shorter than the hand simply deals all of it, in its own order: the alternative is
 * repeating a card, which would read as the shelf being broken rather than as a small pool.
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
