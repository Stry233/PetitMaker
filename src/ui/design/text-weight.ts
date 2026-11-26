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
 * The interface's type sizes, in authored css px: the closed set every rendered size is drawn from.
 * Windows and menus draw them as written; the frame draws the same numbers under `shell/units.ts:ZOOM`,
 * so a role is one size on each surface and the two surfaces stay 1.25 apart. A kind of text that
 * needs more rank than its neighbours takes it from weight, never from a size between these.
 */
export const TYPE_SIZES = {
  title: 24,
  lead: 20,
  head: 16,
  label: 14,
  chip: 13,
  /** The floor: no interface text is set smaller. */
  small: 12,
} as const;

type TypeSize = (typeof TYPE_SIZES)[keyof typeof TYPE_SIZES];

/*
 * ── The roles, and the custom properties that carry them ──
 *
 * A weight adapts to a size and a token cannot read a hook, so the type inventory is declared once
 * here as (size, weight) pairs; a surface publishes one resolved custom property per role and every
 * token inside it inherits by naming its role. Each `px` is a `TYPE_SIZES` rung; a site drawing a role
 * under a zoom of its own uses `useReadableWeight`. This is the whole inventory: a type size under
 * `ui/` names a role (`__tests__/ui/design/type-sizes.test.ts`). Roles sharing a size differ by
 * weight (`label`/`action`/`menu`/`body`/`field` at 14, `subhead`/`chip`/`note` at 13,
 * `small`/`caption` at 12).
 */
export const TEXT_ROLES = {
  /** A window title, a shelf's category names, and the layer count read across the window. */
  title: { px: TYPE_SIZES.title, weight: 900 },
  /** The one bigger line a panel gets, and the chosen mode's name. */
  lead: { px: TYPE_SIZES.lead, weight: 700 },
  /** A section heading, and a settings row's own label. */
  head: { px: TYPE_SIZES.head, weight: 700 },
  /**
   * Long-form prose read at length: the Help Center's sentences. `body` is a line or two inside a
   * control surface; a page someone sits down to read earns the next size up, and it ranks under
   * its own `head`ings by weight alone, the same size-sharing the 14px rungs already practice.
   */
  reading: { px: TYPE_SIZES.head, weight: 500 },
  /** Every button's words: a window footer, a bar's action, a toast's or a notice's. */
  action: { px: TYPE_SIZES.label, weight: 800 },
  /** The chosen row of a menu. */
  menu: { px: TYPE_SIZES.label, weight: 800 },
  /** A row label beside a control, a field's caption, and a control's name shown on hover. */
  label: { px: TYPE_SIZES.label, weight: 700 },
  /**
   * A sentence of prose: a menu row's own words, a confirm question, a note that is not small print.
   *
   * Body copy starts at medium weight; stronger emphasis uses the label role.
   */
  body: { px: TYPE_SIZES.label, weight: 500 },
  /** The text inside an input, which the reader both reads and edits. */
  field: { px: TYPE_SIZES.label, weight: 600 },
  /**
   * A sentence in the receding ink, what a surface says in its own voice rather than as a label: a
   * hint line, the assistant's live line, a card's closing words, a note under a question.
   *
   * It is a rank of its own and not small print: `caption` and `small` are for asides and figures.
   * It shares `chip`'s size, because prose and a pill sit side by side in one row and must not step,
   * and ranks under it by weight.
   */
  note: { px: TYPE_SIZES.chip, weight: 700 },
  /** A pill naming a choice, and a control's caption on the frame. */
  chip: { px: TYPE_SIZES.chip, weight: 800 },
  /**
   * A heading inside a section: a card's own header, the cap over a group of controls.
   *
   * It ranks above its own rows on weight rather than on size, which is the only lever left once a
   * heading sits a couple of px from the rows under it — at 16 it would read as a second section.
   */
  subhead: { px: TYPE_SIZES.chip, weight: 900 },
  /** Small print in its quiet form: a tag, a credit, a key's legend. */
  caption: { px: TYPE_SIZES.small, weight: 700 },
  /** Small print carrying a figure: a count, a byte size, a reading, an item's name under its card. */
  small: { px: TYPE_SIZES.small, weight: 800 },
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

/** The least size an input may take: iOS Safari zooms the whole page in on focus for any input
 *  below 16 css px, so a field the reader never sees the type of still takes this. */
export const INPUT_NO_ZOOM = TYPE_SIZES.head;

/** A mark standing on the map grows and shrinks with the map rather than with the interface, so its
 *  word is drawn at this share of the mark's height (`markPx`, css px) instead of at a role. */
export function mapMarkSize(markPx: number): number {
  return markPx * 0.42;
}

/** A role's size in css px, for a site that sets the size alone or does arithmetic with it. */
export function roleSize(role: TextRole): TypeSize {
  return TEXT_ROLES[role].px;
}

/** A role's size and its adapting weight together, for a token that is that role. Taking both from
 *  the table is what keeps the size the weight was measured against and the size on the glass the
 *  same number. */
export function roleFont(role: TextRole): { fontSize: TypeSize; fontWeight: string } {
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
