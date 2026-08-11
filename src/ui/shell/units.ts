/*
 * units.ts — the sizes the interface is laid out in.
 *
 * The chrome is authored in FIXED CSS PIXELS under one page-level `zoom`, deliberately NOT the menu
 * scale: that maps the design canvas onto viewport height, so a 1440p monitor would draw the same
 * button half again as big as a laptop. A game's frame does not do that — a button is a button at any
 * window size, and the map takes the extra room.
 *
 * `SCALE` converts a design coordinate to a css px: the drawn art still carries the design source's
 * own rects (`frame.ts`, `terrain-cells.ts`, the shelves), and this lands them at interface size.
 *
 * The GAPS are judged in the browser, not read off the design source: that canvas is 1.96:1 where a
 * screen is nearer 1.6, and its blocks are illustrations of differing heights.
 *
 * A viewport unit used inside the zoomed subtree must divide `ZOOM` back out (`100vh` resolves
 * against the real viewport, then gets multiplied by the zoom) — that is what `--shell-zoom` is for.
 */

/** The frame's own page zoom: part of the authored size, not a user preference. `uiZoom` (Ctrl +/-)
 *  multiplies it. */
export const ZOOM = 1.25;

/**
 * The window the fixed layout was judged in, and below which the whole frame scales DOWN
 * proportionally to the tighter axis. `FIT_FLOOR` keeps a control tappable where that factor would
 * take it under a fingertip.
 */
export const FIT_REF = { w: 1280, h: 800 } as const;
export const FIT_FLOOR = 0.6;

/** 1 at or above `FIT_REF`, the tighter axis's share below it, never under `FIT_FLOOR`. */
export function frameFit(vw: number, vh: number): number {
  return Math.max(FIT_FLOOR, Math.min(1, vw / FIT_REF.w, vh / FIT_REF.h));
}

/** A mode block's drawing width in design px, resting and selected. All five share one width
 *  (`frame.ts:MODES` brings them to it) because each is one grass cube with a different thing on it,
 *  and the cube is what the eye reads the row by. The selected pair is `物品图标`'s own footprint,
 *  which the side margins are also proportioned against. */
export const BLOCK_W = 172;
export const BLOCK_W_ON = 207;

/** Design px → CSS px. Fixed by the mode block: its 172 design px is the 64 css px the row wants. */
export const SCALE = 64 / BLOCK_W;

/** The block row's own scale. The blocks are the frame's only ILLUSTRATIONS, and an illustration
 *  reads bigger than a flat shape of the same width, so the row is drawn a little under `SCALE`.
 *  Everything about a block goes through this — drawing, splat, slot, box — except its caption, since
 *  type here is one size per role. */
export const MODE_SCALE = SCALE * 0.9;
const MODE_SIZE = Math.round(BLOCK_W * MODE_SCALE);

/** The splat under a chosen block, in design px (`frame.ts:MODE_PLATE` reads it from here). It lives
 *  with the margins because `EDGE_RIGHT` is derived from how far it overhangs. */
export const MODE_PLATE_W = 265;

/** How far the splat reaches past its block, one side, in css px. */
const PLATE_OVERHANG = (MODE_PLATE_W * MODE_SCALE - MODE_SIZE) / 2;

/**
 * The scale the two BOTTOM SHELVES draw their art at — the mode row's argument one floor down. Cards
 * and candidates are pictures, and at the frame's `SCALE` an item card came out 104 css square
 * against a 44 px rail button: the shelves read as a different interface pasted on.
 *
 * Applied through the shelves' own scale provider, so everything authored in design px comes down
 * together while nothing in css px moves — text is fixed and the drawing adapts around it. The
 * terrain bar keeps `SCALE`: its cells are plates with glyphs, like the rail and the mode row.
 */
export const SHELF_SCALE = SCALE * 0.82;

/** Distance an edge-anchored cluster keeps from the BOTTOM of the viewport, and the unit of air the
 *  bottom bars are spaced by. Smaller than the side gutter: what stands there is a full-width shelf
 *  running off the window, not a cluster held clear of an edge. */
export const EDGE = 16;

/**
 * The gutter the frame's LEFT-HAND content stands on, in css px — and it is THE BOTTOM SHELF'S OWN,
 * which is what makes it one gutter down the whole interface rather than one around the top of it.
 * (The design source's would land at 36 left and 22 right.)
 *
 * Checked in the browser at 1600x900 and 1280x800: the mark under a chosen shelf name starts its ink
 * at 74.4, the "B" of "Buildings" at 76.0, the difference being that letter's side bearing. The mark
 * is the drawn edge of the row, so 74 is the number. `SHELF_TABS.left` is derived back off it.
 */
export const FRAME_MARGIN = 74;
export const EDGE_LEFT = FRAME_MARGIN;

/**
 * The right gutter: the left LESS THE SPLAT, so the two sides' outermost ink lands on one line.
 *
 * The sides do not hold the same kind of thing. On the right stand plates, whose ink is their box, so
 * the seen gap is the margin. On the left the splat hangs `PLATE_OVERHANG` past its block, so the
 * seen gap is the margin less that — at one number the two measured 58.4 against 72.8.
 *
 * This squares up the state where a mode is IN FORCE, which is whenever anyone is working. At rest
 * the splat is gone and the left has ~15 px more; one number cannot answer both, and the resting
 * surplus is air beside illustrations rather than beside a control.
 */
export const EDGE_RIGHT = FRAME_MARGIN - PLATE_OVERHANG;

/**
 * The margin above the mode row, and it is NOT the side gutter: a side gutter costs width, which the
 * frame has to spare, but the TOP costs the right-hand column its run. That column hangs from the mode
 * row's line down to the bottom shelf, and its three groups take what is left — at the gutter's own 74
 * the separations come to a tenth of a pixel on a 1600x900 window. `frame-margins.test.ts` holds the
 * arithmetic so this cannot be quietly raised to match the sides.
 *
 * Measured to the row's TALLEST drawing, so choosing a mode cannot eat the margin by growing art up
 * out of the row. A resting row shows more — its shortest drawing stands about 44 down.
 */
export const EDGE_TOP = 28;

/**
 * The `transform` for a caption centred under a control whose centre stands `centre` px from the
 * frame's left edge — centred unless that would take it off the window. The first control sits at the
 * margin, so its caption would hang half its width into it ("Свободная кисть" by 25 px). Text size is
 * fixed, so what gives is where the caption sits.
 */
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
  /** Room above the baseline for the tallest block's art: the object block's SELECTED drawing at
   *  212 design px, at the row's scale. */
  height: Math.round(212 * MODE_SCALE),
  /** The name under the selected block, at the design source's proportion (a 51 design px em, top
   *  34 px below the baseline — just clear of the splat, which hangs 32). SIZE takes the frame's
   *  scale since type is one size per role; GAP takes the row's, being room under a picture. It is
   *  the biggest type after the shelf names because it answers "what am I building". */
  label: { size: Math.round(51 * SCALE), weight: 800, gap: Math.round(34 * MODE_SCALE) },
  /** Clearance the assistant's drawing keeps under the row above, and the only chosen number in the
   *  two rows' separation — the rest is derived (`frame.ts:ASSISTANT_ROW_TOP`) from the chain the eye
   *  sees: baseline, splat, name, then this. The name's slot is reserved whether or not a mode is
   *  naming itself, which is what stops the character moving when one does. */
  rowClearance: 6,
} as const;

/** How far a caption's INK reaches below the top of its line box, as a share of type size. Measured
 *  at `MODE.label.size` in both scripts: a cap-height plus the descender of a Latin 'j'. The box holds
 *  slack under that, so a row spaced by the box sits further from what follows than it looks. */
export const LABEL_INK_DEPTH = 0.758;

const RAIL_BUTTON = 44;

/** How big a solid disc of diameter `d` READS, by the measure the drawn glyphs are matched on
 *  (`frame.ts:apparentSize`). Here so the corner's drawings reach a rail button's size without either
 *  side holding a copy of the other's number. */
const discApparent = (d: number) => Math.sqrt(Math.hypot(d, d) * Math.sqrt((Math.PI * d * d) / 4));

/** Between two controls of the top-right cluster, as a share of how big one READS. Generous, because
 *  the three are not one control: packed at a button's own gap they read as a segmented strip. A share
 *  rather than a constant, since air is only judgeable against how big the things are. */
export const TOP_RIGHT_GAP = Math.round(0.47 * discApparent(RAIL_BUTTON));

/**
 * The right-hand groups: three clusters sharing an edge, not one column of buttons.
 *
 * Spaced by ONE decision. The column runs from under the top-right cluster (`frame.ts:RAIL_TOP`) down
 * to the bottom shelf's plate (`RAIL_FLOOR`); the layer control hangs from the top, the view kit from
 * the bottom, and the history pair takes the middle. So the three separations come out near enough
 * equal at any window height, with no number to nudge for one group and forget for the next.
 */
export const RAIL = {
  /** One round button, and the width of the cluster it stands in. */
  button: RAIL_BUTTON,
  /** How big the glyph on it READS (`frame.ts:apparentSize` turns this into a per-drawing scale).
   *  Small enough that the plate reads as a plate. */
  glyph: 21,
  /** The word ON the 2D/3D switch: a fifth of the plate's diameter, not a tenth, which is what makes
   *  it read as a labelled button rather than a plate with a mark on it. */
  viewLabel: 18.5,
  /** How big a top-right control READS — a RAIL BUTTON's reading, since the three in the corner and
   *  the ten down the column are one family. Sized by the BOX instead they read as three sizes among
   *  themselves (menu disc 62, anchor 54, load disc 65), because one is solid, one mostly a notch and
   *  one fills its square. `frame.ts:topRightHeight` gives each the height that lands its ink here. */
  topRight: discApparent(RAIL_BUTTON),
  /** The layer control: a tall dark plate carrying the two steps, with the count OUTSIDE it on the
   *  map. Proportioned from the drawing's 75 x 123 design px against the 118 px round buttons. */
  layer: { w: 28, h: 46, glyph: 34, gap: 8 },
  /** The pill a round button grows into on hover: air between its name and the far end of the plate.
   *  ONE padding — the other end is the button's own square, where a centred glyph already stands
   *  ~11 px clear. How wide it opens is the name's measured width in whatever language it is in. */
  namePad: 13,
  /** Between two buttons of the same cluster. */
  gap: 9,
  /** Between two GROUPS — the only thing that tells them apart, since the drawing has no outline to
   *  box one with. */
  groupGap: 30,
  /** The least a short window may squeeze that to: still twice `gap`, so three groups never read as
   *  one long strip. */
  groupMin: 18,
} as const;

/** The tool row, bottom-left. `bottom` leaves room under it for the active tool's name. */
export const QUAD = { left: EDGE_LEFT, bottom: 44, gap: 14 } as const;

/** The bottom shelves, centred over the map. */
export const SHELF = { bottom: EDGE, pad: 12, gap: 9, radius: 22 } as const;

/**
 * The backing the bottom bars stand on, as the design draws it (`底边栏`).
 *
 * ONE shape, not a box around the rows: it runs past both side edges and well past the bottom of the
 * canvas. So content is not INSIDE the plate — cards and candidates stand up out of it, half on the
 * dark and half over the map, and the row of names is on the map. A plate around every row would turn
 * the shelf into a card.
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

/** How far above the window's bottom the right-hand column stops. The band is the only full-width
 *  thing down there, and a button standing on it would read as part of the shelf. It ends here
 *  whatever bar is open — the band is as deep as the deepest of them — so the kit does not move when
 *  the visitor changes mode. */
export const RAIL_FLOOR = PLATE_BAND.top + 12;

/**
 * The row of names heading a bottom shelf. ONE row in two modes, not two that resemble each other:
 * object categories and generator algorithms are drawn, spaced and anchored by these numbers alone, so
 * a name keeps its place when the visitor switches shelf.
 *
 * A tab is as wide as its own word at `TEXT.shelfTab`, so what is fixed here is the room around the
 * word and the mark under the chosen one.
 */
const TAB_PAD_X = 18;

export const SHELF_TABS = {
  /** The row's BOX, set so the WORDS land on the frame's gutter rather than the box doing so — a tab
   *  carries `padX` either side. The one place the gutter is arrived at from the inside out. */
  left: FRAME_MARGIN - TAB_PAD_X,
  padX: TAB_PAD_X,
  gap: 14,
  /** The mark's thickness, deliberately over the design source's 16 design px: the mark is a stadium,
   *  and at the drawn thickness its two caps come to under two device pixels each on a word-wide bar,
   *  so the whole thing reads as a rectangle. */
  underline: 8,
  underlineGap: 7,
  /** The plate a text field standing IN the row wears — the shelf's search and the generator's recipe
   *  field are one object. The drawing's 82 design px lands at 31 and reads SHORT beside 28 px names
   *  and 42 px pills, so this is judged at size instead. */
  field: 38,
  /**
   * How far the row's bottom edge stands above the window's bottom. ONE number for both shelves,
   * which is the point: the block under the row is a different depth in each, so a row placed by its
   * own content sits at two heights and the names jump on a mode switch.
   *
   * JUDGED between two bounds. Every px of floor is a px the CARDS give up on both shelves, so above
   * this the cost is empty map between names and cards — at the drawn card's full height that gap ran
   * to 56 and read as a heading floating on its own. Does not follow the window: the card was already
   * at its floor-derived height on a laptop.
   */
  floor: 164,
} as const;

/** Where the middle of a shelf name's INK sits, as a share of its type size, up from the bottom of its
 *  line box. Measured at `TEXT.shelfTab` in both scripts: a Chinese name spans 16.0–47.2 css px above
 *  the mark and a Latin one 19.0–44.2, so the centres agree at 31.6 over a box bottom at 15. The
 *  outline every name on the map wears is part of the ink and is in those numbers. */
const NAME_INK_MID = 0.593;

/** The margin-bottom a control takes to stand IN the row of names: centred on the WORDS, not hung off
 *  the box carrying them, since a line box holds slack under its ink. Centring is what the drawing
 *  does, and the only rule that still means something when the control is half again as tall as the
 *  words — which the action pills are and the search field is not. */
export function standsInNameRow(h: number): number {
  return SHELF_TABS.underline + SHELF_TABS.underlineGap + NAME_INK_MID * TEXT.shelfTab - h / 2;
}

/** Type sizes. One constant size per role: a control is as wide as its own text needs, never text
 *  shrunk to a box (which is what makes a Russian label unreadable beside a Chinese one). */
export const TEXT = {
  /** Tabs, pills, and anything else naming a choice. */
  tab: 14.5,
  /** The names above a bottom shelf. Drawn at 75.2 design px against a 217-deep band, roughly a third
   *  of it, which makes them the shelf's heading rather than a caption inside it. */
  shelfTab: Math.round(75.2 * SCALE),
  /** A control's own caption: the tool under the row, a slider's name. Half the caption over a MODE
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
