/*
 * panel-frame.ts — where the assistant's panel stands, in the frame's own css px.
 *
 * THE PANEL STANDS ON THE FRAME'S OWN GRID, and that is the invariant the rest of this file serves:
 * its left edge is the block rows' margin and its top edge is the row clearance below the mode row's
 * ink — the same line the assistant's own row hangs from — so the column lines up with everything
 * else in the frame rather than with whatever the character's box happens to be. Her seat inside it
 * is the desk's own (`ui/agent/DeskHeader.tsx`), at the plate's padding beside the dock band, and she
 * TRAVELS THE SHORT DISTANCE BETWEEN THE TWO when the panel opens (`SEAT_TRAVEL_MAX`).
 *
 * ITS WIDTH IS THE MODE ROW'S, and this file is where that number comes from: five blocks and the
 * four gaps between them. `ui/agent/tokens.ts:PANEL_WIDTH` re-exports it under the panel's own name,
 * so the column lines up with the row above it at both edges instead of merely standing near it.
 *
 * The FOOT is measured up from the window's bottom rather than down from the top: the bottom bars
 * hang off that edge, so the room a column has is the window's height less this margin and the bar
 * that is showing. Carried from the retired site log's own reserve, which was judged per bar (a row
 * of tool cells is a hand's width; the object shelf adds a row of names over its cards; the generate
 * shelf carries three candidates, a row of controls and two sliders) — one number for all five
 * either ends the panel halfway up an empty screen or lets the generate bar's tabs come up behind it.
 *
 * BOTH CLEARANCES YIELD RATHER THAN EMPTY THE PANEL, foot first and head after it — see
 * `panelTop`/`panelMaxHeight`, which is where the whole of that argument lives. And an UNANSWERED
 * QUESTION borrows on top of that (`panelMaxHeight`'s `borrow`): the courtesy to the bar below is
 * worth less than a question the user cannot read.
 */
import type { BuildMode } from '../../core/model/edit-mode';
import type { DockSide } from '../../core/runtime/prefs';
import { FIT_FLOOR, FIT_REF, frameFit } from '../design/scale';
import { ASSISTANT_BLOCK, ASSISTANT_ROW_TOP, MODE_ROW_BASE, MODES } from './frame';
import { LABEL_BOX_DEPTH, MODE, EDGE_LEFT, EDGE_TOP, MODE_SCALE, SCALE, ZOOM } from './units';

/** The panel's left edge: the block rows' own, so the three share one margin. */
export const PANEL_LEFT = EDGE_LEFT;

/** The column's width, from the row above it. */
export const PANEL_COLUMN_W = MODES.length * MODE.size + (MODES.length - 1) * MODE.gap;

/** The column's right edge, in frame px from the window's left. What the right-hand column has to
 *  keep clear of (`frame.ts:readoutPressLane`). */
export const PANEL_RIGHT = PANEL_LEFT + PANEL_COLUMN_W;

/** The panel plate's own inset, in frame px. Declared here beside the geometry that reads it (the
 *  desk's seat stands at it, on both axes); `ui/agent/tokens.ts:PANEL_PAD` re-exports it under the
 *  panel's own name, the same way `PANEL_WIDTH` re-exports the column's width. */
export const PANEL_PLATE_PAD = 14;

/** How far inside her seat she stands, in frame px: the box is her drawing grown by it, so a
 *  placement sets a width of `w - 2 * pad` and lets the art decide the height. */
const SEAT_PAD = 5;
const SEAT_W = ASSISTANT_BLOCK.w * MODE_SCALE + SEAT_PAD * 2;
const SEAT_H = ASSISTANT_BLOCK.h * MODE_SCALE + SEAT_PAD * 2;

/**
 * THE ONE LIVE CHARACTER'S BOX, in frame px: where she stands while the panel is folded away.
 *
 * She is the assistant's whole affordance — the block draws no art of its own — so this is the box
 * the press is made in, and the box her step to the desk starts from (`Shell.tsx:ENTRANCE_SLOT`).
 * The desk's seat is the same size, so one declaration sizes both ends of the travel.
 */
export const CHARACTER_SEAT = {
  pad: SEAT_PAD,
  w: SEAT_W,
  h: SEAT_H,
  /** Her box's left edge, in frame px from the window's left: centred on the block she stands in. */
  left: EDGE_LEFT + MODE.size / 2 - SEAT_W / 2,
  /** Her box's top edge. The drawing stands on the block row's baseline, so the box is measured up
   *  from it. */
  top: ASSISTANT_ROW_TOP + MODE.height + SEAT_PAD - SEAT_H,
} as const;

/**
 * Where the column's top edge sits, in css px from the window's top.
 *
 * IT CLEARS THE CAPTION'S BOX, not the caption's ink, and that is the one place this arithmetic
 * parts from the row spacing beside it (`frame.ts:MODE_ROW_INK_BOTTOM`, which the character's row
 * hangs from). A selected block's name is the one word saying what the map is armed with, and the
 * clearance those two share is measured to the glyphs: 6 frame px under the modelled ink left the
 * plate's own edge 2 frame px INSIDE the caption's line box at every window, close enough to the
 * outline stroke the map label wears that the two read as touching. What a surface must not crowd is
 * the box, so this is the box's depth plus the same clearance.
 */
export const PANEL_TOP = MODE_ROW_BASE + MODE.label.gap
  + LABEL_BOX_DEPTH * MODE.label.size + MODE.rowClearance;

/**
 * How far she may travel between her folded box and the desk's seat, in frame px.
 *
 * HER OWN BOX IS THE BOUND, and that is what makes the step read as one character crossing her desk
 * rather than as a second drawing appearing where the first one was: both ends are placed by the
 * frame (her box below the mode row, the seat at the plate's padding), so the distance is a
 * consequence of the grid rather than a number anyone picks, and this is the assertion that keeps the
 * two ends from drifting apart. The furthest either end moves is the column's own head clearance
 * yielding on a short window at a large UI zoom (`panelTop`).
 */
export const SEAT_TRAVEL_MAX = CHARACTER_SEAT.w;

/** Room to leave under the column so it clears the bottom bar, in css px measured up from the
 *  window's bottom edge. The design-px numbers the site log was judged at, at the frame's scale. */
export function footReserve(mode: BuildMode): number {
  if (mode === 'object') return 560 * SCALE;
  if (mode === 'generate') return 760 * SCALE;
  // The three terrain bars are one row of cells with a shortcut badge over each, and the smart
  // build's proposal puts one line of its own above them.
  return (mode === null ? 200 : 330) * SCALE;
}

/** The window's own height in the frame's px, which every other length here is already in: `100vh`
 *  inside the frame's zoomed subtree resolves against the REAL viewport and is then multiplied by
 *  the zoom, so the zoom is divided back out (`units.ts`'s own note on `--shell-zoom`). */
const WINDOW_H = '100vh / var(--shell-zoom, 1)';

/**
 * Where the column's top edge sits, given the LEAST height the panel can work in — its own pinned
 * skeleton plus a record worth the name, which only the panel knows and therefore hands in.
 *
 * IT YIELDS, in the extreme, and what makes that necessary is that the head clearance does not
 * shrink while the room does. Every length in the frame is drawn at `--shell-zoom`, which carries
 * the user's Ctrl +/-: at uiZoom 1.8 on the frame's own reference window the room between the
 * entrance block and the window's bottom edge is 157 frame px against a skeleton of 180, and the
 * panel stood as a plate carrying the dock and NOTHING else — record and composer clipped away by
 * its own overflow, a standing gate unanswerable, no order typeable. A clearance is a courtesy; a
 * panel with no controls in it is not a panel. So the column slides up under the row it hangs from
 * rather than emptying itself, and stops at the frame's own top margin.
 */
export function panelTop(least: number): string {
  return `clamp(${EDGE_TOP}px, calc(${WINDOW_H} - ${least}px), ${PANEL_TOP}px)`;
}

/**
 * A LITTLE OFF THE COURTEOUS CAP, in frame px: a taste tune, one step, and the only thing it changes
 * is how tall the panel stands where there is room for it to stand at its tallest. It is subtracted
 * from the courteous term alone, never from the least-workable floor — the floor exists to stop the
 * panel becoming a plate with no controls in it, and trimming that would be a different change.
 */
export const PANEL_CAP_TRIM = 24;

/**
 * The column's cap as a css length.
 *
 * THE FOOT YIELDS FIRST AND THE HEAD ONLY AFTER IT, which is the order the two clearances are worth:
 * what stands below the panel is a bar the panel may stand OVER, while what stands above it is the
 * block the panel hangs FROM. So the cap is the courteous room wherever there is any, and the least
 * workable height where there is not — bounded by whatever `panelTop` has left below it, that end
 * having already given what it can.
 *
 * Generate mode is the case this was ruled on: its shelf reserve leaves ~159 frame px against the
 * same 180px skeleton at 1280x800, 1366x768, 1440x810 and 1280x700 alike, so the composer was sliced
 * off flush with the plate's bottom at every common laptop height and the record was a 2.5px band.
 * The panel now overlaps the shelf's top by what it needs and no more.
 *
 * `borrow` IS THE SAME YIELD ASKED FOR BY THE CONTENT rather than by the skeleton, and it is spent
 * at the FOOT alone: `panelTop` keeps reading the plain `least`, so a borrowing panel grows downward
 * over the bar and never climbs over the block row it hangs from. The window's own room still bounds
 * it, which is what keeps this a borrowing and not an overflow.
 */
export function panelMaxHeight(mode: BuildMode, least: number, borrow = 0): string {
  const room = `calc(${WINDOW_H} - ${panelTop(least)})`;
  return `max(calc(${room} - ${footReserve(mode)}px - ${PANEL_CAP_TRIM}px), min(${least + borrow}px, ${room}))`;
}

/*
 * ── THE PANEL DOCKED ────────────────────────────────────────────────────────────────────────────
 *
 * DOCKED, THE PANEL IS THE GROUND AND THE WHOLE INTERFACE IS A SHEET ON TOP OF IT. The dock stands
 * at one of the window's SIDE edges plus its top and bottom, and BENEATH everything
 * (`design/styles.ts:z.ground`); the map and the frame are one sheet, each on a plane inset from that
 * side by the dock's width (`Shell.tsx`), and docking slides that sheet aside to reveal the desk under
 * it. So the whole interface — the frame, the chrome that rides its fit, the dock itself — scales into
 * what is left of the window at ONE factor, which is what `design/scale.ts:frameFit`'s `refWiden`
 * solves for.
 *
 * WHICH SIDE IS PART OF THE REMEMBERED INTENT, and everything here is written from it rather than
 * from the left: the dock's near edge, the sheet's inset and the seam the outline survives on are all
 * one side's worth of arithmetic MIRRORED. Nothing about the layout is a second layout — the same
 * column, the same width, the same seam, at the other end of the window. THE TWO DOCK CONTROLS DO NOT
 * MIRROR: they stand at the column's right edge in both modes, so the hand finds them in one spot
 * whichever end the dock is at.
 *
 * NOTHING HERE IS A SECOND LAYOUT in the other sense either. The dock is the free column plus its
 * control gutter, with the room the two clearances were rationing handed to it whole:
 * `PINNED_PANEL.height` is the window, so the cap arithmetic above simply does not apply and the job
 * zone takes everything the furniture does not.
 */

/** Which end of the window the dock stands at. Declared with the preference that persists it
 *  (`core/runtime/prefs.ts`), since that is the layer both the store and this file can reach. */
export type { DockSide };

/**
 * THE DOCK CARRIES TWO CONTROLS AND BUYS THE ROOM FOR THEM, which is why the docked column is wider
 * than the free one: the dock/undock and the side switch stand stacked at the column's RIGHT edge in
 * both dock modes. THE GUTTER IS THE BUTTONS' SEAT ONLY WHERE THE BUTTONS ARE — the desk band alone
 * keeps clear of it (`ui/agent/PanelShell.tsx`'s `desk-band`), so the dock card is the same card at
 * the same width it has floating while everything below the band takes the docked column's whole
 * width. `size` is the house icon button; `lane` is the air between the gutter and the content;
 * `stack` is the air between the two buttons.
 */
export const DOCK_CHROME = { size: 28, lane: 10, stack: 8 } as const;

/** What the gutter costs the column, in frame px. */
export const DOCK_CHROME_W = DOCK_CHROME.size + DOCK_CHROME.lane;

/** The file of two, top to bottom, in frame px. What the pair is CENTRED against the dock band by
 *  (`ui/agent/PanelShell.tsx`), so the arithmetic reads one declaration rather than restating the
 *  stack. */
export const DOCK_CHROME_FILE_H = DOCK_CHROME.size * 2 + DOCK_CHROME.stack;

/** The docked column's own width in frame px: the free column plus the gutter its controls stand in.
 *  Below the dock band the content spans the whole of it. */
export const PINNED_COLUMN_W = PANEL_COLUMN_W + DOCK_CHROME_W;

/**
 * The dock's width in the FIT'S OWN REFERENCE PX — the docked column at the frame's page zoom, which
 * is what `frameFit`'s `refWiden` is measured in. Handed to `design/scale`'s dock context by `App`.
 *
 * It is also the offset a CHROME surface uses to stand over the frame's plane rather than over the
 * dock: chrome draws at the fit alone, so the dock's width in a chrome surface's own units is this
 * number whatever the window (`--pin-dock-left` / `--pin-dock-right`, published by `Shell`).
 */
export const PINNED_DOCK_REF_W = PINNED_COLUMN_W * ZOOM;

/**
 * HOW FAR THE GROUND DRIFTS UNDER THE SHEET, as a share of the dock's own width.
 *
 * The two planes part rather than one sliding over a still one: the sheet travels the dock's whole
 * width and the ground travels this fraction of it in the SAME direction, on the same clock, and the
 * two settle together.
 *
 * A QUARTER, AND THE SHARE IS WHAT A VIEWER CAN SEPARATE rather than a ratio borrowed from elsewhere.
 * The splash hand-off's own relationship (4 parts of 104) is 16 px on this object, and 16 px is not
 * the same event here as it is there: the splash's plane is the whole window and nothing else is
 * moving, while this drift runs under a sheet travelling 26 times as far and beside an interface
 * rescaling into the room the dock takes. Measured live at 1440 css px, the ground moved 20 real px
 * over 300 ms with the sheet's edge crossing 520 and the frame's own scale changing by a fifth, and
 * the drift was not visible at all. A quarter of the dock is a hundred-odd px of ground sliding in
 * under the departing sheet, which is unmistakably a second plane.
 *
 * THE SHARE IS BOUNDED BY ONE, and that bound is geometric: the strip the sheet has uncovered is
 * `aside` of the dock's width, and a ground trailing further behind than the sheet has travelled
 * would leave the far end of that strip showing the page. At a quarter the ground covers the strip
 * with three quarters of the dock's width to spare at every point of the slide.
 */
export const DOCK_PARALLAX_SHARE = 1 / 4;

/** That share as a distance, in the frame's own px. */
export const DOCK_PARALLAX = PINNED_COLUMN_W * DOCK_PARALLAX_SHARE;

/**
 * The narrowest window the dock fits in, in css px, and the reason it is a derivation rather than a
 * taste number: below it the interface beside the dock would have to shrink past `FIT_FLOOR`, the
 * floor that exists to keep a control under a fingertip. So the rule is the arithmetic's own — the
 * dock is offered exactly where the frame beside it can still stand at a size the app already
 * supports (the same fit a genuinely 1052px window gets today), and refused where it cannot.
 *
 * It moves with the user's UI zoom, since the dock is drawn at that zoom: at the pref's top of range
 * the same dock costs half again as much of the window.
 */
export function pinRoomFloor(uiZoom = 1): number {
  return FIT_FLOOR * (FIT_REF.w + PINNED_DOCK_REF_W * uiZoom);
}

/** Whether this window has room for the dock. */
export function hasPinRoom(vw: number, uiZoom = 1): boolean {
  return vw >= pinRoomFloor(uiZoom);
}

/**
 * The frame's zoom while the sheet stands `aside` of the way off the dock: the frame's own page zoom,
 * times the fit of the window less the strip the dock has taken so far, times the user's UI zoom.
 * The same reading `use-frame-zoom.ts:useFrameZoom` makes through the hooks, as a pure function of
 * the live fraction — the slide moves this every frame, and the per-frame writes go straight to the
 * DOM rather than through a render (`use-dock.ts`), so the arithmetic has to be callable outside one.
 */
export function frameZoomAt(aside: number, vw: number, vh: number, uiZoom: number): number {
  return ZOOM * frameFit(vw, vh, aside * PINNED_DOCK_REF_W * uiZoom) * uiZoom;
}

/**
 * The docked column's box, in the frame's own px: the window's own top and bottom edges plus the SIDE
 * edge the dock stands at. `edge` is that side's inset, which is the window's own corner either way —
 * the ground never moves, and what travels is the sheet over it.
 */
export const PINNED_PANEL = {
  edge: 0,
  top: 0,
  height: `calc(${WINDOW_H})`,
} as const;

/** Which css property places the docked column, and which one the sheet is inset by: the dock's own
 *  side. One reading, so no surface has to spell the mirror out for itself. */
export function dockEdge(side: DockSide): 'left' | 'right' {
  return side;
}

/** The direction the sheet travels as it slides OFF the ground, as a sign on the x axis: a dock at the
 *  left is revealed by a sheet moving right, and a dock at the right by one moving left. The ground's
 *  own parallax drift takes the same sign. */
export function dockTravelSign(side: DockSide): 1 | -1 {
  return side === 'left' ? 1 : -1;
}
