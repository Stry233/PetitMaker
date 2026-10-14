/*
 * The assistant panel's semantic names over the shared design layer. Every value resolves to
 * `ui/design/styles.ts`, `ui/design/tokens.ts` or a frame measurement; no hex is written here, and
 * `panel-skin.test.ts` enforces that under `ui/agent/` outside the character art.
 */
import { DANGER_DEEP, DANGER_INK, DANGER_SURFACE, INK, MUTED, PANEL_EDGE, PAUSED_TAUPE, PLATE_INK, REVERT_AMBER, STOPPED_TAUPE, SURFACE_SECONDARY, THINKING_PAPER, TILE_GREEN, TILE_PALE_YELLOW, rgbaOf } from '../design/tokens';
import { PANEL_COLUMN_W, PANEL_PLATE_PAD } from '../shell/panel-frame';

/**
 * The paper a status card, ticket or banner paints its background: the session's phase said as a surface
 * rather than as a word.
 */
export type PaperState = 'idle' | 'think' | 'work' | 'ask' | 'wait' | 'stop' | 'danger';

export const statePaper: Record<PaperState, string> = {
  /** Nothing asked, nothing owed. */
  idle: SURFACE_SECONDARY,
  /** The model is reasoning and no tool has run yet. */
  think: THINKING_PAPER,
  /** Tools are landing on the map. */
  work: TILE_GREEN,
  /** A gate is open and the user is owed an answer. */
  ask: TILE_PALE_YELLOW,
  /** Paused, or waiting on the provider. */
  wait: PAUSED_TAUPE,
  /** The run was aborted, which is not a wait: taupe alone would say the work may yet continue. */
  stop: STOPPED_TAUPE,
  /** A terminal error is being reported. */
  danger: DANGER_SURFACE,
};

/**
 * The ink an op's outcome mark is drawn in. A finished call is the quiet check in the house ink, not
 * a colour of its own: an op that did what it was asked has nothing to report but that it is done,
 * and only the two outcomes the user has to act on carry a hue.
 */
type TickOutcome = 'ok' | 'revert' | 'error';

export const tickInk: Record<TickOutcome, string> = {
  ok: INK,
  revert: REVERT_AMBER,
  error: DANGER_INK,
};

/**
 * The status card's meta deck in two tones: the fact in plate ink, the figures (datum, clock) in the
 * muted brown. On the danger paper the fact takes a softened danger ink so the word above still leads.
 */

export const metaInk = {
  fact: PLATE_INK,
  figure: MUTED,
  /** The fact's ink on the danger paper. */
  danger: rgbaOf(DANGER_DEEP, 0.72),
} as const;

/** The panel's one border treatment, everywhere a card or the panel itself is outlined. Already the
 *  shell's own panel edge. */
export const edge = PANEL_EDGE;

/** The panel's width. Derived, not authored: the column stands under the mode row and lines up with
 *  it at both edges, so the row's own width (`ui/shell/panel-frame.ts`) is the one number. */
export const PANEL_WIDTH = PANEL_COLUMN_W;

/** The height the panel wants when it has room — enough that a desk with one short job under it still
 *  reads as a column rather than a chip. It is a want and not a floor: `PanelShell` yields it to the
 *  room the frame actually has (see that file's cap). */
export const PANEL_MIN_HEIGHT = 430;

/** The panel's own padding, inside its plate. Derived like the width above it: the frame places the
 *  desk's reserved seat against this inset, so the two read one number. */
export const PANEL_PAD = PANEL_PLATE_PAD;

/** A card's padding inside the panel (`.face`, `.aticket`, `.apaper` all draw the same paper). */
export const CARD_PAD = 12;

/** The done receipt's hero picture in px; the width is the panel less its gutters, and it fixes the capture's resolution and aspect. */
export const POSTCARD = {
  width: PANEL_WIDTH - 2 * PANEL_PAD - 2 * CARD_PAD,
  height: 148,
} as const;

/* Motion lives in `ui/design/motion/registry.ts`; `motion-wiring.test.ts` rejects numbers at call sites. */

/**
 * How far the panel lets a mark recede, by what it says. Unavailable controls use `UNAVAILABLE`
 * instead: these marks are present and readable, only quieter than the words beside them.
 */
export const recede = {
  /** A glyph or quotation beside its own words. */
  near: 0.9,
  /** An aside on a line: the asks-off mark, a read glyph, the streaming caret. */
  aside: 0.75,
  /** A row that is not the live one: a stage not reached, a step a take-back would discard, a
   *  record from another map, an option that was not picked. */
  apart: 0.55,
  /** A mark that stands still: a held tape, the beta tag. */
  still: 0.45,
  /** A hairline rule inside model prose. */
  rule: 0.35,
} as const;

/** The ink tints the panel paints, each named for what wears it rather than for its alpha, derived
 *  from the ink so changing it reaches every tint. */
export const panelTint = {
  /** A chip plate on the status card's own paper: present, but not a second surface. */
  chip: rgbaOf(INK, 0.08),
  /** An unlit segment of the turn-budget meter, and any other empty groove on paper. */
  groove: rgbaOf(INK, 0.16),
  /** An attempt not yet made. */
  pending: rgbaOf(INK, 0.18),
  /** An attempt already spent. */
  spent: rgbaOf(INK, 0.55),
} as const;

