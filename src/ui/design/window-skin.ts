/*
 * The vocabulary the five menu windows are painted in.
 *
 * The windows are chrome rather than shell furniture: they stand over the map and place themselves,
 * so the paint lives here beside them. The colours are the design source's own (`ui/design/tokens`),
 * which is why this reads across instead of restating hexes — a plate is the same cream whether it
 * is a tool cell or a modal card, and a second copy of the value is a second thing to update.
 *
 * The drawing is flat: filled shapes, no gradient and not one stroke anywhere in the document. So a
 * surface here is a fill and a radius, and where two cream areas have to read apart they differ by
 * fill (`skin.inset`) or carry `skin.line`, never a border. The one exception is how a panel meets
 * the map: there it wears `PANEL_EDGE`, the hairline every unplated word and drawing wears, and
 * casts nothing.
 *
 * Two things the design source has no opinion on stay on the house tokens in `ui/design/styles.ts`: the
 * destructive reds (it draws no destructive state) and the springs. Both are behaviour the windows
 * already had.
 */
import type { CSSProperties } from 'react';
import { cursors, font, radii, UNAVAILABLE } from './styles';
import { roleFont } from './text-weight';
import { ACTIVE, INK, INSET, LINE, ON_DARK, PANEL_EDGE, PLATE, PLATE_INK, TRACK, FRAME_INK, MUTED, DANGER_SURFACE, DANGER_INK } from './tokens';

/** The modal card: the cream plate a `ModalShell` (and the portrait guard) is drawn on. */
export const cozyPanel: CSSProperties = {
  background: PLATE,
  borderRadius: radii.panel,
  border: PANEL_EDGE,
  boxShadow: 'none',
  color: FRAME_INK,
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
  muted: MUTED,
  /** A surface sitting on the plate. */
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

/** A recessed area on the plate: the keyboard page's detail strip, a confirm panel. */
export const windowInset: CSSProperties = {
  background: skin.inset,
  borderRadius: radii.lg,
};

/** A one-line text field on the plate, rounded by itself (so it takes no field-wrap focus marker). */
export const windowField: CSSProperties = {
  fontFamily: font.family, ...roleFont('field'), color: skin.ink, background: skin.inset,
  border: `1.5px solid ${skin.line}`, borderRadius: radii.md, padding: '8px 10px',
  outline: 'none', width: '100%', boxSizing: 'border-box',
};

export type PillVariant = 'quiet' | 'active' | 'danger';

/** The window pill: one shape, three fills. Pair with `buttonMotion` on the element. `on` is the
 *  surface it stands on, which only a `quiet` pill reads — the other two bring their own colour. */
export function windowPill(variant: PillVariant = 'quiet', disabled = false, on: WindowSurface = 'plate'): CSSProperties {
  const base: CSSProperties = {
    fontFamily: font.family,
    ...roleFont('chip'),
    padding: '6px 14px',
    borderRadius: radii.pill,
    border: 'none',
    whiteSpace: 'nowrap',
    cursor: disabled ? cursors.blocked : cursors.clickable,
    opacity: disabled ? UNAVAILABLE : 1,
  };
  if (variant === 'active') return { ...base, background: skin.active, color: skin.ink };
  if (variant === 'danger') return { ...base, background: DANGER_SURFACE, color: DANGER_INK };
  return { ...base, background: on === 'inset' ? skin.plate : skin.inset, color: skin.plateInk };
}

/** A count or status tag in a window row: the pill's type at a resting size, one step off the cream
 *  it stands on. It does not press, so it takes no cursor and no motion. */
export function windowChip(on: WindowSurface = 'plate'): CSSProperties {
  return {
    fontFamily: font.family,
    ...roleFont('chip'),
    padding: '4px 12px',
    borderRadius: radii.pill,
    background: on === 'inset' ? skin.plate : skin.inset,
    color: skin.ink,
  };
}

/** A round icon control in a window header (Back): an inset disc with the glyph in ink. Pair with
 *  `interactionProfiles.tile` on the element. */
export const windowIconButton: CSSProperties = {
  width: 34,
  height: 34,
  flex: 'none',
  padding: 0,
  border: 'none',
  borderRadius: '50%',
  background: skin.inset,
  color: skin.ink,
  display: 'grid',
  placeItems: 'center',
  cursor: cursors.clickable,
  WebkitTapHighlightColor: 'transparent',
};

/** The window's confirming action (OK / done): the ink fill the design gives a pressed control. */
export const windowPrimary: CSSProperties = {
  background: skin.ink,
  color: skin.plate,
  border: 'none',
  borderRadius: radii.field,
  padding: '10px 28px',
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

export const windowFooterTertiary: CSSProperties = {
  ...windowFooterGhost,
  background: 'transparent',
};

