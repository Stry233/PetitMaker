/*
 * The sizes the interface is laid out in. The chrome is authored in fixed css px under one page zoom (a
 * button is a button at any window size; the map takes the room), and `SCALE` lands the design source's
 * rects at interface size. A viewport unit inside the zoomed subtree divides `--shell-zoom` back out.
 */

/** Ratio between the frame and chrome scales; both use `design/scale.tsx:fittedUiScale`. */
export const ZOOM = 1.25;

/** A mode block's drawing width in design px, resting and selected; all five share it (`frame.ts:MODES`). */
export const BLOCK_W = 172;
export const BLOCK_W_ON = 207;

/** Design px → CSS px. Fixed by the mode block: its 172 design px is the 64 css px the row wants. */
export const SCALE = 64 / BLOCK_W;

/**
 * The block row's scale, a little under `SCALE` because an illustration reads bigger than a flat shape;
 * everything about a block uses it except its caption.
 */
export const MODE_SCALE = SCALE * 0.9;
const MODE_SIZE = Math.round(BLOCK_W * MODE_SCALE);

/** The splat under a chosen block, in design px (`frame.ts:MODE_PLATE` reads it from here). It lives
 *  with the margins because `EDGE_RIGHT` is derived from how far it overhangs. */
export const MODE_PLATE_W = 265;

/** How far the splat reaches past its block, one side, in css px. */
const PLATE_OVERHANG = (MODE_PLATE_W * MODE_SCALE - MODE_SIZE) / 2;

/**
 * The bottom shelves' art scale: pictures read bigger than plates, so cards draw under the frame's
 * `SCALE` while css-px text stays put. The terrain bar keeps `SCALE`.
 */
export const SHELF_SCALE = SCALE * 0.82;
/** The loading dot's diameter in design px, which a shelf or panel turns into css px at its own scale. */
export const LOADING_DOT = 15;

/** The air an edge-anchored cluster keeps from the window's bottom, and the unit the bottom bars are spaced by. */
export const EDGE = 16;

/** The left gutter in css px, the bottom shelf's own, so one gutter runs down the whole interface. */
const FRAME_MARGIN = 74;
export const EDGE_LEFT = FRAME_MARGIN;

/** The right gutter: the left less the splat's overhang, so both sides' outer ink lines up while a mode is armed. */
export const EDGE_RIGHT = FRAME_MARGIN - PLATE_OVERHANG;

/**
 * The margin above the mode row, measured to its tallest drawing; smaller than the sides because the rail
 * hangs its run from this line (`frame-margins.test.ts` holds the arithmetic).
 */
export const EDGE_TOP = 28;

/** The transform for a caption centred under a control at `centre` px from the frame's left, held inside the margin. */
export function captionShift(centre: number): string {
  return `translateX(max(-50%, ${EDGE_LEFT - centre}px))`;
}

/** The mode row: five blocks on one baseline, top-left. */
export const MODE = {
  /** The drawn block's width. */
  size: MODE_SIZE,
  /** Wide enough that the row reads as five separate blocks rather than one strip — the blocks are
   *  illustrations with their own overhangs. */
  gap: 22,
  /** Room above the baseline for the tallest block's art: the object block's selected drawing at
   *  212 design px, at the row's scale. */
  height: Math.round(212 * MODE_SCALE),
  /** The selected block's name at the design's proportion: the frame's type size, the row's gap under the splat. */
  label: { size: Math.round(51 * SCALE), weight: 800, gap: Math.round(34 * MODE_SCALE) },
  /** The air the assistant's drawing keeps under the row above, the one chosen number in the rows' separation. */
  rowClearance: 6,
} as const;

/** How far a caption's ink reaches below its line box top, as a share of type size, in both scripts. */
export const LABEL_INK_DEPTH = 0.758;

/**
 * How deep a caption's line box is, as a share of type size; a surface that must not touch a caption spaces
 * from the box, row spacing that only has to look even reads the ink.
 */
export const LABEL_BOX_DEPTH = 1.179;

const RAIL_BUTTON = 44;

/** How big a solid disc of diameter `d` reads by `frame.ts:apparentSize`. */
const discApparent = (d: number) => Math.sqrt(Math.hypot(d, d) * Math.sqrt((Math.PI * d * d) / 4));

/** The air between the corner's controls, as a share of how big one reads, so they stay three controls. */
export const TOP_RIGHT_GAP = Math.round(0.47 * discApparent(RAIL_BUTTON));

/**
 * The rail's three clusters: the layer control hangs from `RAIL_TOP`, the view kit from `RAIL_FLOOR`, and
 * history takes the middle, so their separations stay near equal at any height.
 */
export const RAIL = {
  /** One round button, and the width of the cluster it stands in. */
  button: RAIL_BUTTON,
  /** How big the glyph on it reads (`frame.ts:apparentSize` turns this into a per-drawing scale).
   *  Small enough that the plate reads as a plate. */
  glyph: 21,
  /** The word on the 2D/3D switch: a fifth of the plate's diameter, not a tenth, which is what makes
   *  it read as a labelled button rather than a plate with a mark on it. */
  viewLabel: 18.5,
  /** How big a corner control reads: a rail button's reading, the corner and the rail being one family. */
  topRight: discApparent(RAIL_BUTTON),
  /** The layer control: a tall dark plate carrying the two steps, with the count outside it on the
   *  map. Proportioned from the drawing's 75 x 123 design px against the 118 px round buttons. */
  layer: { w: 28, h: 46, glyph: 34, gap: 8 },
  /** The air between a hover name and the far end of the plate it grows into. */
  namePad: 13,
  /** Between two buttons of the same cluster. */
  gap: 9,
  /** Between two groups — the only thing that tells them apart, since the drawing has no outline to
   *  box one with. */
  groupGap: 30,
  /** The least a short window may squeeze that to: still twice `gap`, so three groups never read as
   *  one long strip. */
  groupMin: 18,
} as const;

/** The tool row, bottom-left. `bottom` leaves room under it for the active tool's name. */
export const QUAD = { left: EDGE_LEFT, bottom: 44, gap: 14 } as const;

/**
 * The backing the bottom bars stand on: one shape running past the window's sides and foot, which cards
 * stand up out of with the names on the map above.
 */
export const PLATE_BAND = {
  /** Height of the visible band above the window's bottom edge, in css px. */
  top: 217 * SCALE,
  /** The drawing's own 300 px corner. The plate hangs this far below the window so only its top
   *  corners are ever on screen. */
  radius: 300 * SCALE,
  /** How far it reaches past each side edge, so its side corners fall outside the window too. */
  overhang: 84 * SCALE,
} as const;

/** Where the rail stops above the window's bottom, clear of the band whatever bar is open. */
export const RAIL_FLOOR = PLATE_BAND.top + 12;

/**
 * The row of names heading a bottom shelf: one row for both shelves, so a name keeps its place across a
 * switch; a tab is as wide as its word.
 */
const TAB_PAD_X = 18;
const SHELF_FIELD_TEXT = 20;

export const SHELF_TABS = {
  /** The row's box, set so the words land on the frame's gutter rather than the box doing so — a tab
   *  carries `padX` either side. The one place the gutter is arrived at from the inside out. */
  left: FRAME_MARGIN - TAB_PAD_X,
  padX: TAB_PAD_X,
  gap: 14,
  /** The mark's thickness, over the design's 16 design px so its stadium caps read at small sizes. */
  underline: 8,
  underlineGap: 7,
  /** The search capsule preserves the drawing's plate-to-text proportion. */
  fieldText: SHELF_FIELD_TEXT,
  field: Math.round(SHELF_FIELD_TEXT * 82 / 44.5),
  /**
   * The row's floor above the window's bottom, one number for both shelves so the names never jump on a
   * switch; judged against the card height it costs.
   */
  floor: 164,
} as const;

/** Where a shelf name's ink centre sits above its line box bottom, as a share of type size, in both scripts. */
const NAME_INK_MID = 0.593;

/** The margin-bottom that centres a control on the row's words rather than on their line box. */
export function standsInNameRow(h: number): number {
  return SHELF_TABS.underline + SHELF_TABS.underlineGap + NAME_INK_MID * TEXT.shelfTab - h / 2;
}

/** Type sizes. One constant size per role: a control is as wide as its own text needs, never text
 *  shrunk to a box (which is what makes a Russian label unreadable beside a Chinese one). */
export const TEXT = {
  /** Tabs, pills, and anything else naming a choice. */
  tab: 14.5,
  /** Categories lead the shelf while fields remain subordinate to them. */
  shelfTab: 24,
  /** A control's own caption: the tool under the row, a slider's name. Half the caption over a mode
   *  block — the two name different sizes of thing and are deliberately not one size. */
  label: Math.round(35 * SCALE),
  /** Small print: a reading, a count, a footprint. */
  small: 12,
  /** The one bigger line a panel gets. */
  head: 15.5,
  /** A figure read at a glance from across the window, with nothing beside it to compare against: the
   *  layer count on the right edge. */
  readout: 23,
} as const;

/** Both shelves reserve the same heading envelope, including a field centred beside the names. */
export const SHELF_HEADING_HEIGHT = Math.max(
  TEXT.shelfTab * LABEL_BOX_DEPTH + SHELF_TABS.underlineGap + SHELF_TABS.underline,
  SHELF_TABS.field + standsInNameRow(SHELF_TABS.field),
);
