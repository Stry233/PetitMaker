/*
 * The brush bar's two tool glyphs, Place and Paint (EDIT-64), drawn in the tool row's ink on the shape
 * cells' 64 px grid and rounding at the tool row's stroke weight, since the design source draws no object
 * brush. Each ink box is measured off a 4x raster of the drawing, as the extracted cells' are.
 */
import type { Glyph } from '../../frame';
import { INK } from '../../../design/tokens';

const BOX = 64;

const svg = (body: string) => `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${BOX}" height="${BOX}" viewBox="0 0 ${BOX} ${BOX}">${body}</svg>`,
)}`;

const drawn = (src: string, ink: Glyph['ink']): Glyph => ({ w: BOX, h: BOX, ink, parts: [{ src, x: 0, y: 0, w: BOX, h: BOX }] });

const stroke = (d: string) => `<path d="${d}" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`;
const dot = (x: number, y: number, r: number) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${INK}"/>`;

/** One item set down: a single filled dot. */
const PLACE = drawn(svg(dot(32, 32, 15)),
  { x: 17, y: 17, w: 30, h: 30, gx: 32, gy: 32, area: 706.86 });

/** Items laid along a stroke: three dots riding over a soft wave. */
const PAINT = drawn(svg(
  stroke('M7 50C16.38 50 19.5 44 25.75 44S35.13 50 44.5 50S57 41 57 41')
  + dot(13, 25, 6.5) + dot(32, 17, 6.5) + dot(51, 25, 6.5),
), { x: 3.5, y: 10.5, w: 57, h: 43, gx: 32.61, gy: 35.14, area: 829.61 });

export const BRUSH_GLYPHS = { place: PLACE, paint: PAINT } as const;
