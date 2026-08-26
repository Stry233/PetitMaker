/*
 * window-skin.ts — the vocabulary the five menu windows are painted in.
 *
 * The windows are chrome rather than shell furniture: they stand over the map and place themselves,
 * so the paint lives here beside them. The colours are the design source's own (`ui/design/tokens`),
 * which is why this reads across instead of restating hexes — a plate is the same cream whether it
 * is a tool cell or a modal card, and a second copy of the value is a second thing to update.
 *
 * The drawing is flat: filled shapes, no gradient and not one stroke anywhere in the document. So a
 * surface here is a fill and a radius, and where two cream areas have to read apart they differ by
 * fill (`skin.inset`) or carry `skin.line`, never a border. The one exception is how a panel meets
 * the MAP: there it wears `PANEL_EDGE`, the hairline every unplated word and drawing wears, and
 * casts nothing.
 *
 * Two things the design source has no opinion on stay on the house tokens in `ui/design/styles.ts`: the
 * destructive reds (it draws no destructive state) and the springs. Both are behaviour the windows
 * already had.
 */
import type { CSSProperties } from 'react';
import { colors, cursors, font, radii } from './styles';
import { roleFont } from './text-weight';
import { ACTIVE, INK, INSET, LINE, ON_DARK, PANEL_EDGE, PLATE, PLATE_INK, TRACK } from './tokens';

/** The modal card: the cream plate a `ModalShell` (and the portrait guard) is drawn on. */
export const cozyPanel: CSSProperties = {
  background: colors.panelCream,
  borderRadius: radii.panel,
  border: PANEL_EDGE,
  boxShadow: 'none',
  color: colors.frameDark,
  fontFamily: font.family,
};

/** The window palette, named for the job each colour does in a window. */
export const skin = {
  /** Every glyph and heading. */
  ink: INK,
  /** The card itself. */
  plate: PLATE,
  /** Body text on the plate, a shade darker than the glyph ink so it reads at small sizes. */
  plateInk: PLATE_INK,
  /** Text on an ink or active fill. */
  onDark: ON_DARK,
  /** The chosen row, the armed control, the primary action. */
  active: ACTIVE,
  /**
   * Text that is secondary or deliberately receding: a note, a legend, a version line.
   *
   * The design source has no tone for this. Its one grey is the placeholder in an empty field, and
   * a grey second line on a warm cream plate reads as a page from another interface, so the windows
   * recede in a warm brown instead: About's version line, the keyboard legend and the import note
   * all take it from here.
   */
  muted: colors.brownText,
  /** A surface sitting ON the plate. */
  inset: INSET,
  /** A divider inside a plate. */
  line: LINE,
  /** The groove a switch knob or a segmented pill runs in. */
  track: TRACK,
} as const;

/** Which of the two cream levels a control is standing on. A `quiet` fill is one step off it, and
 *  since the ramp alternates that step is down from a plate and back up from an inset. */
export type WindowSurface = 'plate' | 'inset';

/** Spread into a window's `cardStyle` so the shared `ModalShell` card takes the window plate.
 *  `ModalShell` keeps its own radius, shadow and zoom. */
export const windowCard: CSSProperties = {
  background: skin.plate,
  color: skin.ink,
};

export const windowTitle: CSSProperties = {
  ...roleFont('title'),
  color: skin.ink,
  textAlign: 'center',
  fontFamily: font.family,
};

/** A settings-style row: label on the left, its control on the right. `flexWrap` lets a control
 *  that is wider than the room left by a long translation drop to its own line instead of
 *  overflowing the card.
 *
 *  The push to opposite ends is the LABEL's auto margin, not `space-between`: a control that has
 *  wrapped is alone on its line, and `space-between` puts a lone item at the START of it — so the
 *  Russian and French rows that wrap would left-align their control under a column of right-aligned
 *  ones. Ending the row at `flex-end` keeps every control on the same edge whether it wrapped or
 *  not, and the label's own `marginRight: auto` restores the single-line spread. */
export const windowRow: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  alignItems: 'center',
  flexWrap: 'wrap',
  rowGap: 8,
};

export const windowLabel: CSSProperties = {
  ...roleFont('head'),
  color: skin.ink,
  fontFamily: font.family,
  marginRight: 'auto',
};

/** A recessed area on the plate: the keyboard page's detail strip, a confirm panel. */
export const windowInset: CSSProperties = {
  background: skin.inset,
  borderRadius: radii.lg,
};

export type PillVariant = 'quiet' | 'active' | 'danger';

/** The window pill: one shape, three fills. Pair with `buttonMotion` on the element. `on` is the
 *  surface it stands on, which only a `quiet` pill reads — the other two bring their own colour. */
export function windowPill(variant: PillVariant = 'quiet', disabled = false, on: WindowSurface = 'plate'): CSSProperties {
  const base: CSSProperties = {
    fontFamily: font.family,
    ...roleFont('chip'),
    padding: '7px 14px',
    borderRadius: radii.pill,
    border: 'none',
    whiteSpace: 'nowrap',
    cursor: disabled ? cursors.blocked : cursors.clickable,
    opacity: disabled ? 0.4 : 1,
  };
  if (variant === 'active') return { ...base, background: skin.active, color: skin.ink };
  if (variant === 'danger') return { ...base, background: colors.dangerBg, color: colors.dangerText };
  return { ...base, background: on === 'inset' ? skin.plate : skin.inset, color: skin.plateInk };
}

/** The window's confirming action (OK / done): the ink fill the design gives a pressed control. */
export const windowPrimary: CSSProperties = {
  background: skin.ink,
  color: skin.plate,
  border: 'none',
  borderRadius: 14,
  padding: '11px 30px',
  ...roleFont('action'),
  fontFamily: font.family,
  alignSelf: 'center',
};

/** The wide footer pair a working window ends on: the action that finishes it, and the way out.
 *  `windowPrimary` is the same ink fill at a narrower, centred geometry; these two stretch across
 *  the bottom of a column, which is what the export windows have always done. */
export const windowFooterPrimary: CSSProperties = {
  flex: 1,
  background: skin.ink,
  color: skin.plate,
  border: 'none',
  borderRadius: radii.md,
  padding: '12px 20px',
  fontFamily: font.family,
  ...roleFont('action'),
};

export const windowFooterGhost: CSSProperties = {
  background: skin.inset,
  color: skin.plateInk,
  border: 'none',
  borderRadius: radii.md,
  padding: '12px 20px',
  fontFamily: font.family,
  ...roleFont('action'),
};

/** A floating menu of choices (the language picker, the preset picker).
 *
 *  It takes the INSET fill, not the plate's. A menu opens OVER the card that carries its trigger,
 *  and a raised surface conventionally goes lighter than the one it floats above — but the plate
 *  is already at 0.95 luminance, so lighter is at most 1.047 away and the two read as one field
 *  with a shadow drawn on it. Depth here can only be spent downward, so the rule is the one every
 *  other control follows: a thing standing on a plate is one step off it, whether it lies flat on
 *  the plate or hovers over it.
 *
 *  What says WHICH is the hairline every panel here wears, not a shadow — a menu reads as the step
 *  down from the plate it opened over. */
export const windowMenu: CSSProperties = {
  background: skin.inset,
  borderRadius: radii.lg,
  border: PANEL_EDGE,
  boxShadow: 'none',
  padding: 6,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
};

export function windowMenuItem(active: boolean): CSSProperties {
  return {
    ...roleFont(active ? 'menu' : 'label'),
    fontFamily: font.family,
    border: 'none',
    cursor: cursors.clickable,
    textAlign: 'left',
    padding: '8px 14px',
    borderRadius: radii.md,
    // An inactive item matches the menu rather than being transparent, so the hover tint animates
    // from a colour instead of flashing in.
    background: active ? skin.active : skin.inset,
    color: active ? skin.ink : skin.plateInk,
    whiteSpace: 'nowrap',
  };
}

/** What a menu item's hover animates its background to: the plate cream, one step UP the ramp from
 *  the menu it sits in, so the row under the pointer comes forward. */
export function windowMenuItemHover(active: boolean): string {
  return active ? skin.active : skin.plate;
}
