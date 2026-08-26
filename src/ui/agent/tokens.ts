/*
 * tokens.ts — the agent panel's SEMANTIC MAP over the shared design layer, and nothing more.
 *
 * The panel is not a special module: it owns no palette, no radius and no curve of its own. Every
 * name below resolves to `ui/design/styles.ts` / `ui/design/tokens.ts`, to a measurement the frame
 * already derives, or to a derivation of one of those. A value with no house equivalent was ADDED
 * THERE (the reasoning paper, the abort tone, the revert ink) rather than declared here.
 *
 * So no hex is spelled out in this file, in code or in prose: a hex repeated in a provenance note is
 * a second place to read the value from, and the two drift the moment one is tuned. `__tests__/ui/
 * agent/tokens-ssot.test.ts` fails the build on one anywhere under `ui/agent/` bar the character art.
 */
import { ACTIVE, INK, PANEL_EDGE, PLATE_INK, TRACK } from '../design/tokens';
import { colors } from '../design/styles';
import { PANEL_COLUMN_W, PANEL_PLATE_PAD } from '../shell/panel-frame';

/**
 * The paper a dock, ticket or banner paints its background: the session's phase said as a surface
 * rather than as a word.
 */
export type PaperState = 'idle' | 'think' | 'work' | 'ask' | 'wait' | 'stop' | 'danger';

export const statePaper: Record<PaperState, string> = {
  /** Nothing asked, nothing owed. */
  idle: colors.surfaceSecondary,
  /** The model is reasoning and no tool has run yet. */
  think: colors.paperThink,
  /** Tools are landing on the map. */
  work: colors.tileGreen,
  /** A gate is open and the user is owed an answer. */
  ask: colors.tilePaleYellow,
  /** Paused, or waiting on the provider. */
  wait: colors.utilTaupe,
  /** The run was ABORTED, which is not a wait: taupe alone would say the work may yet continue. */
  stop: colors.stopTaupe,
  /** A terminal error is being reported. */
  danger: colors.dangerBg,
};

/**
 * The ink an op's outcome mark is drawn in. A finished call is the QUIET CHECK in the house ink, not
 * a colour of its own: an op that did what it was asked has nothing to report but that it is done,
 * and only the two outcomes the user has to act on carry a hue.
 */
export type TickOutcome = 'ok' | 'revert' | 'error';

export const tickInk: Record<TickOutcome, string> = {
  ok: INK,
  revert: colors.revertAmber,
  error: colors.dangerText,
};

/**
 * The construction-tape stripe: a 45-degree repeating diagonal of the house `ACTIVE` yellow and the
 * house `INK`. `stripeSize` is the tile the gradient repeats at (CSS `background-size`) — an 8px band
 * measured along the 45-degree axis is `8 * Math.SQRT2` px on each screen axis.
 */
export const tape = {
  /** The unfilled groove, the house one. */
  track: TRACK,
  stripeLight: ACTIVE,
  stripeDark: INK,
  /** px, `8 * Math.SQRT2`. */
  stripeSize: 11.3137,
} as const;

/**
 * THE DOCK'S META DECK IS TWO TONES, and which tone a word wears says what kind of thing it is.
 *
 * The state's own FACT (the meta line) is the darker of the two — the house's plate ink, a shade
 * under `INK` for exactly this case, a caption-sized line on a coloured paper. The FIGURES beside it
 * (the datum at the word's end, the elapsed clock) stay at the muted brown and recede. One tone over
 * both flattens the distinction and leaves the fact reading lighter than the numbers it explains.
 *
 * On the danger paper the fact takes the destructive emphasis ink, softened: at full strength a
 * 12px line in it competes with the word above, which is the one thing on that card that must lead.
 */
/** A 6-digit hex colour with an alpha channel appended, as a `#rrggbbaa` string. The byte is always
 *  TWO hex digits: an unpadded `toString(16)` drops the leading zero below 0x10 (alpha under ~0.063),
 *  which emits a 7-character string neither a 6- nor an 8-digit colour parses as. */
export function withAlpha(color: string, alpha: number): string {
  return `${color}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`;
}

export const metaInk = {
  fact: PLATE_INK,
  figure: colors.brownText,
  /** The fact's ink on the danger paper. */
  danger: withAlpha(colors.dangerDeep, 0.72),
} as const;

/** The panel's one border treatment, everywhere a card or the panel itself is outlined. Already the
 *  shell's own panel edge. */
export const edge = PANEL_EDGE;

/** The panel's width. DERIVED, not authored: the column stands under the mode row and lines up with
 *  it at both edges, so the row's own width (`ui/shell/panel-frame.ts`) is the one number. */
export const PANEL_WIDTH = PANEL_COLUMN_W;

/** The height the panel wants when it has room — enough that a desk with one short job under it still
 *  reads as a column rather than a chip. It is a WANT and not a floor: `PanelShell` yields it to the
 *  room the frame actually has (see that file's cap). */
export const PANEL_MIN_HEIGHT = 430;

/** The panel's own padding, inside its plate. DERIVED like the width above it: the frame places the
 *  desk's reserved seat against this inset, so the two read one number. */
export const PANEL_PAD = PANEL_PLATE_PAD;

/** A card's padding inside the panel (`.face`, `.aticket`, `.apaper` all draw the same paper). */
export const CARD_PAD = 12;

/**
 * The done receipt's hero picture, in px.
 *
 * The WIDTH is derived rather than authored, because a picture that reaches both edges of its card
 * is exactly the panel less the two gutters between it and the glass — a number written down here
 * would disagree with the layout the first time either padding moved. It is also a CAPTURE size: the
 * card paints the shot at 100% width, so what this fixes is the resolution and the aspect the map is
 * framed to.
 */
export const POSTCARD = {
  width: PANEL_WIDTH - 2 * PANEL_PAD - 2 * CARD_PAD,
  height: 148,
} as const;

/*
 * NO CURVE AND NO DURATION LIVES HERE. The panel's motion is declared in
 * `ui/shell/motion/registry.ts` and reached through `motion.ts`, which is what lets one file answer
 * "what moves, how long and why"; a bezier re-exported from the token table would be a second place
 * to get one from. `__tests__/ui/agent/motion-wiring.test.ts` fails on a number written at a call
 * site here.
 */

/**
 * A panel colour at partial alpha.
 *
 * Derived rather than written out, so changing the ink reaches every tint of it and the two cannot
 * drift into disagreeing about what the panel's brown is.
 */
function tintOf(hex: string, alpha: number): string {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(',');
  return `rgba(${channels},${alpha})`;
}

/** The ink tints the panel paints, each named for what wears it rather than for its alpha. */
export const inkTint = {
  /** A chip plate on the dock's own paper: present, but not a second surface. */
  chip: tintOf(INK, 0.08),
  /** An unlit segment of the turn-budget meter, and any other empty groove on paper. */
  groove: tintOf(INK, 0.16),
  /** An attempt not yet made. */
  pending: tintOf(INK, 0.18),
  /** An attempt already spent. */
  spent: tintOf(INK, 0.55),
} as const;

