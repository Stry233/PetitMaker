/** Shared UI weight limits use visible text size with a bounded allowance for display density. */
import type { CSSProperties } from 'react';
import type { Locale } from '../../core/model/locale';

/** The weights a heavier nominal steps down to, heaviest first. */
const BOLD = 700;
const MEDIUM = 500;
const REGULAR = 400;

/** Minimum rendered CSS-pixel sizes at 1× density, before the script-density adjustment. */
const HEAVY_MIN = 24;
const BOLD_MIN = 16;
const MEDIUM_MIN = 12;
/** Limit the extra weight allowed by denser rasterization while retaining visible size as the main limit. */
const MAX_DENSITY_GAIN = 1.4;
/** Dense CJK strokes and stacked Thai marks need more room between strokes. */
const DENSE_BUMP = 2;

/** Locales whose dense strokes or stacked marks need more spacing. */
const DENSE_LOCALES: readonly Locale[] = ['zh', 'ja', 'th'];

/**
 * Whether a surface should be judged against the dense floors. Read off the locale, not the string:
 * a Chinese interface shows its version number in Latin and its shelf names in Chinese under one
 * declaration, and the locale is the side of that trade where an over-correction costs a Latin label
 * a weight it did not need rather than leaving a CJK label unreadable.
 */
export function isDenseScript(locale: Locale): boolean {
  return DENSE_LOCALES.includes(locale);
}

/**
 * `screenPx` includes CSS zoom and any text-fitting transform. Density provides a bounded allowance;
 * browser zoom below 100% can further reduce the raster budget.
 */
export function readableWeight(nominal: number, screenPx: number, dense = false, dpr = 1): number {
  const pixels = screenPx * Math.min(MAX_DENSITY_GAIN, dpr);
  const bump = dense ? DENSE_BUMP : 0;
  let weight = nominal;
  if (weight > BOLD && pixels < HEAVY_MIN + bump) weight = BOLD;
  if (weight > MEDIUM && pixels < BOLD_MIN + bump) weight = MEDIUM;
  if (weight > REGULAR && pixels < MEDIUM_MIN + bump) weight = REGULAR;
  return weight;
}

/**
 * The smallest size any chrome text is set at, and the rung every stray under it was lifted onto.
 *
 * It is the interface's small-print size in both ladders — `shell/units.ts:TEXT.small` for the frame
 * and `styles.ts:font.caption` for the chrome — so the floor is a number the design already had
 * rather than a new one. Without it a modal reaches 10 px where the frame's own floor paints at 15
 * device px (the frame draws at `units.ts:ZOOM` 1.25 times the chrome's factor), so the frame reads
 * well while the modal text does not. Lifting the strays onto this rung closes most of that gap; the
 * rest is the 1.25 itself, which cannot move without re-laying every modal out.
 */
const TEXT_FLOOR = 12;

/*
 * ── The roles, and the custom properties that carry them ──
 *
 * A weight adapts to a size and a token cannot read a hook, so the type inventory is declared once
 * here as (size, weight) pairs; a surface publishes one resolved custom property per role and every
 * token inside it inherits by naming its role. Each `px` is the size the tokens are authored at; a
 * site drawing a role at another size uses `useReadableWeight`. This is the whole inventory
 * (`text-ladder.test.ts` fails a raw `fontSize` under `ui/` elsewhere). Rungs sharing a size differ
 * by weight (`body`/`field`/`label`/`menu` at 14, `subhead` 13/900 against `chip` 13/800); `note`
 * keeps prose off the `caption`/`small` pair, which is for figures and asides.
 */
export const TEXT_ROLES = {
  /** A modal or window title. */
  title: { px: 24, weight: 900 },
  /** The one bigger line a panel gets. */
  lead: { px: 20, weight: 700 },
  /** A section heading, and a settings row's own label. */
  head: { px: 16, weight: 700 },
  /**
   * Long-form prose read at length: the Help Center's sentences. `body` is a line or two inside a
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
   * Body copy starts at medium weight; stronger emphasis uses the label role.
   */
  body: { px: 14, weight: 500 },
  /** The text inside an input, which the reader both reads and edits. */
  field: { px: 14, weight: 600 },
  /**
   * A sentence in the receding ink: what a surface says in its own voice rather than as a label —
   * the assistant's live line, a card's closing words, a note under a question, the detail behind
   * an op row.
   *
   * It is a rank of its own and not small print, which is exactly what it had become: with no home
   * for it, every prose site in the agent panel landed on `caption` — the rung reserved for a
   * tabular count, and the ladder's own floor — so the panel's most-read text and its smallest
   * figures were drawn at one size and told apart by nothing. Half a pixel above `chip` rather than
   * a whole one because prose and a pill sit side by side in the same row and must not step.
   */
  note: { px: 13.5, weight: 700 },
  /** A pill naming a choice. */
  chip: { px: 13, weight: 800 },
  /**
   * A heading inside a section: a card's own header, the cap over a group of controls.
   *
   * It ranks above its own rows on weight rather than on size, which is the only lever left once a
   * heading sits a couple of px from the rows under it — at 16 it would read as a second section.
   */
  subhead: { px: 13, weight: 900 },
  /** Small print in its quiet form: a caption, a note. */
  caption: { px: TEXT_FLOOR, weight: 700 },
  /** Small print carrying a figure: a count, a byte size, a reading. */
  small: { px: TEXT_FLOOR, weight: 800 },
} as const;

export type TextRole = keyof typeof TEXT_ROLES;

/** Leading for text that wraps: `snug` for a heading or a short paragraph on a card. */
export const LINE_HEIGHT = { snug: 1.35 } as const;

/** The custom property a role's resolved weight is published as. */
function weightVar(role: TextRole): string {
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

/** A role's size and its adapting weight together, for a token that is that role. Taking both from
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
    vars[weightVar(role)] = String(readableWeight(weight, px * zoom, dense, dpr));
  }
  return vars as CSSProperties;
}
