/**
 * Adapts font weight to rendered device-pixel size without changing layout. The shipped faces form
 * a Heavy/Bold/Medium ladder. Dense CJK glyphs receive a two-pixel threshold increase because their
 * counters close earlier at small sizes. UI roles below publish the resolved weights as custom
 * properties so call sites share one semantic type ladder.
 */
import type { CSSProperties } from 'react';
import type { Locale } from '../../core/model/types';

/** The weights the shipped faces draw, coarsest ladder first. */
export const HEAVY = 900;
export const BOLD = 700;
export const MEDIUM = 500;

/** Device pixels under which the Heavy faces stop resolving into strokes. */
export const HEAVY_MIN = 12;
/** Device pixels under which the Bold faces stop resolving into strokes. */
export const BOLD_MIN = 10;
/**
 * Added to both floors for a script whose glyphs fill their em rather than a cap-height, so the same
 * nominal size carries several times the stroke count. Measured on CJK; Thai is not covered, and
 * takes the Latin floors until it is.
 */
export const DENSE_BUMP = 2;

/** Locales written in a script that fills its em. */
const DENSE_LOCALES: readonly Locale[] = ['zh', 'ja'];

/**
 * Whether a surface should be judged against the dense floors. Read off the LOCALE, not the string:
 * a Chinese interface shows its version number in Latin and its shelf names in Chinese under one
 * declaration, and the locale is the side of that trade where an over-correction costs a Latin label
 * a weight it did not need rather than leaving a CJK label unreadable.
 */
export function isDenseScript(locale: Locale): boolean {
  return DENSE_LOCALES.includes(locale);
}

/**
 * The device pixels a run of text paints at. `zoom` is the css `zoom` the surface stands under —
 * `frameFit × uiZoom` for the chrome, that times `units.ts:ZOOM` inside the frame — and `dpr` the
 * display's own multiplier. Browser page zoom needs no term: it divides the css viewport and
 * multiplies `dpr` by the same factor, so it arrives through those two.
 */
export function textDevicePx(cssPx: number, zoom: number, dpr: number): number {
  return cssPx * zoom * dpr;
}

/**
 * The weight to draw `nominal` at when it will paint `devicePx` tall.
 *
 * One step per floor crossed, so a heavy label under both floors lands on Medium. That does flatten
 * a chip onto its body text's weight, which is the trade: at 11 device px the chip's emphasis is
 * carried by its fill and its ink, and a weight nobody can resolve carries nothing. Nothing is ever
 * pushed BELOW Medium, and a nominal already at or under it passes through — the fix for small text
 * is a lighter weight at the same size, never a lighter one than the design asked for.
 */
export function readableWeight(nominal: number, devicePx: number, dense = false): number {
  const bump = dense ? DENSE_BUMP : 0;
  if (nominal <= MEDIUM) return nominal;
  let w = nominal;
  if (w > BOLD && devicePx < HEAVY_MIN + bump) w = BOLD;
  if (w > MEDIUM && devicePx < BOLD_MIN + bump) w = MEDIUM;
  return w;
}

/**
 * The smallest size any chrome text is set at, and the rung every stray under it was lifted onto.
 *
 * It is the interface's small-print size in BOTH ladders — `shell/units.ts:TEXT.small` for the frame
 * and `styles.ts:font.caption` for the chrome — so the floor is a number the design already had
 * rather than a new one. Without it a modal reaches 10 px where the frame's own floor paints at 15
 * device px (the frame draws at `units.ts:ZOOM` 1.25 times the chrome's factor), so the frame reads
 * well while the modal text does not. Lifting the strays onto this rung closes most of that gap; the
 * rest is the 1.25 itself, which cannot move without re-laying every modal out.
 */
export const TEXT_FLOOR = 12;

/*
 * ── The roles, and the custom properties that carry them ──
 *
 * A weight adapts to a SIZE, and a design token is a static object that cannot read a hook. So the
 * type inventory is declared once here as (size, weight) pairs, a surface publishes one resolved
 * custom property per role, and every token and call site inside it inherits the answer by naming
 * its role. That is what keeps this out of a hundred call sites.
 *
 * Each entry's `px` is the size the tokens in `styles.ts` / `window-skin.ts` are actually authored
 * at; a site that draws a role at a different size takes `useReadableWeight` and passes its own.
 *
 * ONE RUNG PER SEMANTIC LEVEL, and the table is the whole inventory the chrome may draw at. A size
 * chosen at a call site is a decision nobody can find, and it is how a section heading came to be
 * set at six different numbers across the windows (12/700, 12.5/800, 13/900, 15/800, 15/900, 16/700)
 * — every one of them defensible where it was written and none of them the same rank as its
 * neighbour on the glass. `__tests__/ui/design/text-ladder.test.ts` fails the build on a raw
 * `fontSize` under `ui/` outside this table's homes, so a new surface names a rung.
 *
 * Where two rungs share a size they are told apart by WEIGHT, which is the only lever a heading has
 * left when it sits two px from its own rows: `body`/`field` 14 against `label` 14 and `menu` 14,
 * and `subhead` 13/900 against `chip` 13/800.
 *
 * `caption` and `small` share a size for the same reason, and `note` above them is the rung that
 * keeps PROSE off that pair: small print is a figure or an aside, a sentence is neither.
 */
export const TEXT_ROLES = {
  /** A modal or window title. */
  title: { px: 24, weight: 900 },
  /** The one bigger line a panel gets. */
  lead: { px: 20, weight: 700 },
  /** A section heading, and a settings row's own label. */
  head: { px: 16, weight: 700 },
  /**
   * LONG-FORM PROSE READ AT LENGTH: the Help Center's sentences. `body` is a line or two inside a
   * control surface; a page someone sits down to read earns the next size up, and it ranks under
   * its own `head`ings by weight alone, the same size-sharing the 14px rungs already practice.
   */
  reading: { px: 16, weight: 500 },
  /** A footer or confirm button. */
  action: { px: 15, weight: 800 },
  /** The chosen row of a menu. */
  menu: { px: 14, weight: 800 },
  /** A row label beside a control. */
  label: { px: 14, weight: 700 },
  /**
   * A sentence of prose: a menu row's own words, a confirm question, a note that is not small print.
   *
   * The only rung that draws the MEDIUM file. A paragraph set in Bold is a paragraph shouting, so
   * anything on this rung that has to outrank its neighbours names `label` instead.
   */
  body: { px: 14, weight: 500 },
  /** The text inside an input, which the reader both reads and edits. */
  field: { px: 14, weight: 600 },
  /**
   * A SENTENCE IN THE RECEDING INK: what a surface says in its own voice rather than as a label —
   * the assistant's live line, a card's closing words, a note under a question, the detail behind
   * an op row.
   *
   * It is a rank of its own and not small print, which is exactly what it had become: with no home
   * for it, every prose site in the agent panel landed on `caption` — the rung reserved for a
   * TABULAR COUNT, and the ladder's own floor — so the panel's most-read text and its smallest
   * figures were drawn at one size and told apart by nothing. Half a pixel above `chip` rather than
   * a whole one because prose and a pill sit side by side in the same row and must not step.
   */
  note: { px: 13.5, weight: 700 },
  /** A pill naming a choice. */
  chip: { px: 13, weight: 800 },
  /**
   * A heading INSIDE a section: a card's own header, the cap over a group of controls.
   *
   * It ranks above its own rows on WEIGHT rather than on size, which is the only lever left once a
   * heading sits a couple of px from the rows under it — at 16 it would read as a second section.
   */
  subhead: { px: 13, weight: 900 },
  /** Small print in its quiet form: a caption, a note. */
  caption: { px: TEXT_FLOOR, weight: 700 },
  /** Small print carrying a figure: a count, a byte size, a reading. */
  small: { px: TEXT_FLOOR, weight: 800 },
} as const;

export type TextRole = keyof typeof TEXT_ROLES;

/** The custom property a role's resolved weight is published as. */
export function weightVar(role: TextRole): string {
  return `--fw-${role}`;
}

/**
 * `fontWeight` for a token, naming its role. The nominal weight rides along as the var's fallback,
 * so a token dropped on a surface that publishes nothing keeps exactly the weight it was authored
 * at.
 */
export function roleWeight(role: TextRole): string {
  return `var(${weightVar(role)}, ${TEXT_ROLES[role].weight})`;
}

/** A role's size and its adapting weight together, for a token that IS that role. Taking both from
 *  the table is what keeps the size the weight was measured against and the size on the glass the
 *  same number. */
export function roleFont(role: TextRole): { fontSize: number; fontWeight: string } {
  return { fontSize: TEXT_ROLES[role].px, fontWeight: roleWeight(role) };
}

/**
 * Every role resolved for one surface, as the custom properties its subtree inherits. Spread onto
 * the element that carries the surface's `zoom` (the modal card, the frame root), so the answers and
 * the zoom they were computed for can never come apart.
 */
export function weightVars(zoom: number, dpr: number, dense: boolean): CSSProperties {
  const vars: Record<string, string> = {};
  for (const role of Object.keys(TEXT_ROLES) as TextRole[]) {
    const { px, weight } = TEXT_ROLES[role];
    vars[weightVar(role)] = String(readableWeight(weight, textDevicePx(px, zoom, dpr), dense));
  }
  return vars as CSSProperties;
}
