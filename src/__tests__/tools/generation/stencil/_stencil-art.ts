/**
 * THE PICTURES THAT ARE OURS — fixed art the stencil measures are taken over, written here as
 * characters and a colour key so there is nothing to fetch and nothing borrowed.
 *
 * Three pieces of pixel art and one synthetic photograph, which is the pair the image path has to
 * serve at once: a drawing wants its few exact colours kept and a photograph wants its tones
 * averaged and diffused. Shared by `stencil-fidelity.test.ts`, `stencil-image.test.ts` and the
 * evaluation harness, so a fixture cannot drift between what a test asserts and what a log reports.
 */
import type { SourcePixels } from '../../../../tools/generation/stencil/stencil-sample';

/** A fixture: rows of colour keys, and what each key draws in. '.' is transparent. */
export interface Art { rows: string[]; key: Record<string, number> }

export const HEART: Art = {
  key: { r: 0xe2445c, p: 0xff9bb0, w: 0xffffff, d: 0x7a1f2e },
  rows: [
    '................',
    '..dddd....dddd..',
    '.drrrrd..drrrrd.',
    'drrppprd drrrrrd',
    'drppwpprdrrrrrrd',
    'drpppprrrrrrrrrd',
    'drrrrrrrrrrrrrrd',
    '.drrrrrrrrrrrrd.',
    '..drrrrrrrrrrd..',
    '...drrrrrrrrd...',
    '....drrrrrrd....',
    '.....drrrrd.....',
    '......drrd......',
    '.......dd.......',
    '................',
    '................',
  ],
};

export const FACE: Art = {
  key: { y: 0xf7d047, k: 0x2b2118, w: 0xffffff, o: 0xe8a33d },
  rows: [
    '.....oooooo.....',
    '...oooyyyyooo...',
    '..oyyyyyyyyyyo..',
    '.oyyyyyyyyyyyyo.',
    '.oyykkyyyykkyyo.',
    'oyyykwkyykwkyyyo',
    'oyyykkkyykkkyyyo',
    'oyyyyyyyyyyyyyyo',
    'oyyyyyyyyyyyyyyo',
    'oyykyyyyyyyykyyo',
    'oyyykyyyyyykyyyo',
    '.oyykkkkkkkkyyo.',
    '.oyyyyyyyyyyyyo.',
    '..oyyyyyyyyyyo..',
    '...oooyyyyooo...',
    '.....oooooo.....',
  ],
};

export const LETTER: Art = {
  key: { b: 0x2f4f8f, l: 0x7fa5e0, w: 0xf2f5fa },
  rows: [
    'wwwwwwwwwwwwwwww',
    'wwwwwwbbwwwwwwww',
    'wwwwwbbbbwwwwwww',
    'wwwwbbllbbwwwwww',
    'wwwwbbllbbwwwwww',
    'wwwbbllllbbwwwww',
    'wwwbbllllbbwwwww',
    'wwbbllllllbbwwww',
    'wwbbbbbbbbbbwwww',
    'wwbbllllllbbwwww',
    'wwwwbbllbbwwwwww',
    'wwwwbbllbbwwwwww',
    'wwwwbbllbbwwwwww',
    'wwwwbbllbbwwwwww',
    'wwwwbbbbbbwwwwww',
    'wwwwwwwwwwwwwwww',
  ],
};

/** A piece of art blown up `scale` times, as a decoded picture. */
export function pixels(art: Art, scale: number): SourcePixels {
  const h = art.rows.length, w = art.rows[0]!.length;
  const width = w * scale, height = h * scale;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ch = art.rows[(y / scale) | 0]![(x / scale) | 0]!;
      const i = (y * width + x) * 4;
      if (ch === '.' || ch === ' ') continue;
      const rgb = art.key[ch] ?? 0;
      data[i] = (rgb >> 16) & 0xff;
      data[i + 1] = (rgb >> 8) & 0xff;
      data[i + 2] = rgb & 0xff;
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

/**
 * A synthetic PHOTOGRAPH: continuous tone across the whole range, no colour repeated in any quantity
 * — three sinusoids at incommensurate periods, which is a gradient a palette genuinely cannot say
 * and the case error diffusion exists for.
 *
 * Deterministic by construction (no RNG), and it is what pins the classifier's other end: a picture
 * like this must NOT be read as a drawing.
 */
export function photograph(side = 128): SourcePixels {
  const data = new Uint8Array(side * side * 4);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const i = (y * side + x) * 4;
      data[i] = 128 + 110 * Math.sin(x / 13.0 + y / 47.0);
      data[i + 1] = 128 + 110 * Math.sin(y / 9.0 + x / 31.0);
      data[i + 2] = 128 + 110 * Math.cos((x + y) / 17.0);
      data[i + 3] = 255;
    }
  }
  return { data, width: side, height: side };
}

/** The synthetic half of the evaluation matrix. */
export function syntheticFixtures(): (SourcePixels & { name: string; what: string })[] {
  return [
    { ...pixels(HEART, 6), name: 'heart', what: 'synthetic pixel art, transparent backdrop' },
    { ...pixels(FACE, 6), name: 'face', what: 'synthetic pixel art, its own rim at the border' },
    { ...pixels(LETTER, 6), name: 'letter', what: 'synthetic pixel art, flat opaque backdrop' },
    { ...photograph(128), name: 'photo', what: 'synthetic continuous tone' },
  ];
}
