/** How large a run of glyphs is drawn in its box, and what share of that its stems should take. */
import { scriptOf } from './stencil';
import { graphemes } from '../../../core/base/text';

/** The box a run of glyphs is drawn into, in cells. */
export interface GlyphBox { width: number; height: number }

function glyphCount(text: string): number {
  return Math.max(1, graphemes(text).length);
}

/** One glyph's extent in cells: the lesser of the box's height and its width shared among the
 *  glyphs, each less a cell, and never under one. */
export function glyphExtent(text: string, box: GlyphBox): number {
  const n = glyphCount(text);
  return Math.max(1, Math.min(box.height - 1, (box.width - 1) / n));
}

// Discrete shipped weights quantize this range; the stem floor still applies at small sizes.
const SHARE = {
  simple: { thin: 0.09, bold: 0.115 },
  dense: { thin: 0.06, bold: 0.13 },
  picture: { thin: 0, bold: 0 },
} as const;

const THIN_AT = 10;
const BOLD_AT = 48;

/** The share of a glyph's extent its stems should take, by script and size; 0 for a picture. */
export function strokeShare(text: string, box: GlyphBox): number {
  const script = scriptOf(text);
  if (script === 'picture') return 0;
  const { thin, bold } = SHARE[script];
  const t = Math.min(1, Math.max(0, (glyphExtent(text, box) - THIN_AT) / (BOLD_AT - THIN_AT)));
  return thin + (bold - thin) * t;
}
