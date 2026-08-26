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
import { localizedName } from '../../../i18n/context';
import { brandName } from '../../../version';
import type { Locale, LocalizedName } from '../../../core/model/types';

/** One example on the row: a letter to build, or a picture to build from. */
export interface StencilSample {
  id: string;
  /** The text a letter sample rasterizes. */
  text?: string;
  /** The image a picture sample loads. */
  src?: string;
  /** What the picture IS, in the visitor's own language — `yunguo-icon` is a filename, 云果 is a
   *  neighbour. A sample carries its own name, since none of these pictures is a catalog item. */
  name?: LocalizedName;
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
 * and no file on hand: the game's fourteen neighbours, plus the app's own mark.
 *
 * A portrait is what a colour mode wants to show off — a large flat-shaded face, a few strong hues
 * and a silhouette that survives being read at twenty cells, where a small sprite is mostly outline
 * and outline is the first thing a reduction loses. Scored with the image harness's own fidelity
 * metric (`__tests__/tools/_stencil-image.ts`) over both terrain materials at 20, 28 and 40 cells,
 * the set means 0.58 against 0.53 for the item sprites. The names are the game's own, in the
 * visitor's language where the game has one.
 *
 * The art is the game's, shipped verbatim under `src/assets/neighbors/`; it is not catalog sprites
 * and does not go through `iconUrl`, whose folder is this project's own item art.
 */
const NEIGHBORS: readonly { id: string; name: LocalizedName }[] = [
  { id: 'dorjelang', name: { en: 'Dorjelang', zh: '多杰朗' } },
  { id: 'elsasani', name: { en: 'Elsasani', zh: '艾莎莎尼' } },
  { id: 'frostia', name: { en: 'Frostia', zh: '幻雪' } },
  { id: 'glenn', name: { en: 'Glenn', zh: '格连' } },
  { id: 'harpeno', name: { en: 'Harpeno', zh: '哈佩诺' } },
  { id: 'isaki', name: { en: 'Isaki', zh: '伊佐奇' } },
  { id: 'medowlyn', name: { en: 'Medowlyn', zh: '绵朵莉' } },
  { id: 'mobai', name: { en: 'Mobai', zh: '莫白' } },
  { id: 'mors', name: { en: 'Mors', zh: '墨尔斯' } },
  { id: 'msafiri', name: { en: 'Msafiri', zh: '萨飞里' } },
  { id: 'nerina', name: { en: 'Nerina', zh: '纳蕾娜' } },
  { id: 'rebella', name: { en: 'Rebella', zh: '热贝尔' } },
  { id: 'trixie', name: { en: 'Trixie', zh: '鹊可' } },
  { id: 'yunguo', name: { en: 'Yunguo', zh: '云果' } },
];

const portraits = import.meta.glob('../../../assets/neighbors/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const portraitUrl: Record<string, string> = {};
for (const path in portraits) {
  portraitUrl[path.split('/').pop()!.replace('-icon.png', '')] = portraits[path]!;
}

export const IMAGE_POOL: readonly StencilSample[] = [
  // The logo comes from `public/` through BASE_URL, the same path `BrandLockup` and the favicon
  // resolve.
  { id: 'logo', src: `${import.meta.env.BASE_URL}logo-256.png` },
  ...NEIGHBORS.flatMap(({ id, name }) => {
    const src = portraitUrl[id];
    return src ? [{ id, src, name }] : [];
  }),
];

/**
 * What to call a sample on its card: the letters themselves, the picture's own localized name, or
 * the app's name for its own mark. Never the id, which is a filename.
 */
export function sampleName(sample: StencilSample, locale: Locale): string {
  if (sample.text) return sample.text;
  if (sample.name) return localizedName(sample.name, locale);
  return sample.id === 'logo' ? brandName(locale) : sample.id;
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
