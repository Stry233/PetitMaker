/*
 * assistant-frame.ts — where the assistant's panel stands, as data.
 *
 * Every SIZE is in the 3754 x 1918 design space, read from the design source's own layer bounds:
 * the art manifest carries the shapes, and the type layers' boxes (the intro line, the placeholder,
 * the button label) were read off the document, which the manifest does not record.
 *
 * WHERE it stands is derived, not read: the design source hangs the bubble off the character's
 * shoulder, and the character is a BLOCK now (`frame.ts:ASSISTANT_INK`), placed by the frame's own
 * margins rather than by a design coordinate. So the plate keeps the design's RELATIONSHIP to it —
 * beside it, tops level, the same 44 px between them, a tail from the block to the plate — and
 * `design()` is what carries the block's css-px box back into the design px the rest of this file
 * is written in.
 *
 * The plate is drawn rather than placed as art. The design source has no gradient, no stroke and no
 * layer effect anywhere (see tokens.ts), so the bubble IS a filled rounded rectangle plus a
 * triangle, and drawing it means it can take the two sizes the interface needs. It needs two: the
 * design draws only the NOT-CONNECTED state, 372 tall, and a session needs a column. Building it
 * from the same fill and the same 50 radius is what keeps the two the same plate.
 *
 * The column's FOOT is measured from the viewport's bottom rather than from a design y: the bottom
 * bars hang off that edge (see bar-atoms `fromBottom`), so a design-y foot would collide with them
 * on exactly the viewports where the canvas is taller than the window.
 */
import type { BuildMode } from '../../../core/model/edit-mode';
import { ASSISTANT_INK } from '../frame';
import { SCALE } from '../units';

/** A css-px frame coordinate in the design px this file is written in. */
const design = (css: number): number => css / SCALE;

/** Between the character and the bubble beside it, in design px: the design source's own 312 - 268. */
const SHOULDER_GAP = 44;

/** The plate: the drawn bubble's own body box, its corner radius, and the height the design draws
 *  it at (which the not-connected face reaches exactly in the Chinese it was drawn in). */
export const PLATE_BOX = {
  x: design(ASSISTANT_INK.right) + SHOULDER_GAP,
  y: design(ASSISTANT_INK.top),
  w: 703,
  radius: 50,
  drawnH: 372,
} as const;

/**
 * The tail, in design px: a triangle whose tip touches the character and whose base stands inside
 * the plate. The design's own proportions — the tip 5 px inside the character's edge at the middle
 * of its height, the base 59 px into the plate and 124 px tall — measured against wherever the
 * block now is.
 */
const TIP_Y = design(ASSISTANT_INK.top + ASSISTANT_INK.h / 2);
export const TAIL: readonly (readonly [number, number])[] = [
  [PLATE_BOX.x + 59, TIP_Y + 62],
  [design(ASSISTANT_INK.right) - 5, TIP_Y],
  [PLATE_BOX.x + 59, TIP_Y - 62],
];

/**
 * The width the not-connected card takes when the drawn one leaves it taller than the room.
 *
 * A window 720 px tall gives the plate about 250 of its own px, and the introduction runs to eight
 * lines of Russian in the drawn 703 — three more than the Chinese it was measured in. Text size is
 * fixed, so the LINE COUNT is the only thing that can give, and a line count is a width: at this
 * width the same sentence is six lines and the card fits without scrolling. It is a second width,
 * not a range, because a range would resize the card as the window moved.
 */
export const PLATE_WIDE_W = 1000;

/** Room the wide card keeps from the window's right edge, in design px. It is the map's, and the
 *  card is a card rather than a half-screen panel. */
export const WIDE_GUTTER = 700;

/**
 * Room to leave under the column so it clears the bottom bar, in design px measured up from the
 * window's bottom edge.
 *
 * It is the BAR'S, not one number: the five modes put bars of very different heights there. A row
 * of tool cells is a hand's width; the object shelf adds a row of names over its cards; the
 * generate shelf carries three candidates, a row of controls and two sliders, and that row wraps in
 * a language whose verbs are longer than the Chinese the drawing was measured in. One reserve for
 * all of them either has the panel end halfway up an empty screen or has the generate bar's tabs
 * come up behind it.
 */
export function footReserve(mode: BuildMode): number {
  if (mode === 'object') return 560;
  if (mode === 'generate') return 760;
  // The three terrain bars are one row of cells with a shortcut badge over each, and the smart
  // build's proposal puts one line of its own above them.
  return mode === null ? 200 : 330;
}

/**
 * The not-connected face as a column of drawn boxes and the gaps between them, so the design's own
 * Chinese lands exactly where it is drawn and a language that needs more lines pushes the plate
 * taller instead of being clipped inside it.
 *
 * Read off the drawing: the intro plate's top sits 28 under the bubble's, its text 26/25/16 inside
 * it, then 16 to the key plate, 10 to the button, and 17 under the button to the bubble's foot.
 */
export const INTRO = {
  padTop: 28,
  padBottom: 17,
  /** Both white plates start here; they run to `padRight` short of the bubble's other edge, which
   *  is the 637 the design draws them at on the 703 plate. */
  x: 34,
  w: 637,
  padRight: 32,
  radius: 25,
  textPad: { top: 26, x: 25, bottom: 16 },
  textSize: 28,
  gapToKey: 16,
  keyH: 50,
  gapToButton: 10,
} as const;

/** The 连接 button. */
export const CONNECT = { w: 131, h: 81, size: 28 } as const;

/** What the site log gets inside the column: the white plates' own left edge and width, so the two
 *  faces of the panel put their content in the same place. */
export const PAD_X = INTRO.x;
export const CONTENT_W = INTRO.w;

/** Design px between the composer's top and the section's foot, the rhythm the Site Log's zone
 *  components were authored to (composer at 946 in a 1100-tall section). */
export const COMPOSER_FOOT = 154;
