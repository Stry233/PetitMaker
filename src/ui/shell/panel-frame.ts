/**
 * Assistant-panel geometry in the shell frame's CSS-pixel coordinate system.
 * The panel shares the mode row's left edge and width. Its available height reserves room for the
 * active bottom bar, then yields that reserve and top clearance when needed to keep controls usable.
 * A pending question may borrow additional vertical room.
 */
import type { BuildMode } from '../../state/editing/edit-mode';
import type { DockSide } from '../../platform/storage/prefs';
import { FIT_FLOOR, FIT_REF, fittedUiScale } from '../design/scale';
import { ASSISTANT_BLOCK, ASSISTANT_ROW_TOP, MODE_ROW_BASE, MODES } from './frame';
import { LABEL_BOX_DEPTH, MODE, EDGE_LEFT, EDGE_TOP, MODE_SCALE, SCALE, SHELF_HEADING_HEIGHT, SHELF_TABS, ZOOM } from './units';

/** The panel's left edge: the block rows' own, so the three share one margin. */
export const PANEL_LEFT = EDGE_LEFT;

/** The column's width, from the row above it. */
export const PANEL_COLUMN_W = MODES.length * MODE.size + (MODES.length - 1) * MODE.gap;

/** The column's right edge, in frame px from the window's left. What the right-hand column has to
 *  keep clear of (`frame.ts:readoutPressLane`). */
export const PANEL_RIGHT = PANEL_LEFT + PANEL_COLUMN_W;

/** The panel plate's inset in frame px, where the desk's seat stands; `ui/agent/panel-skin.ts:PANEL_PAD` re-exports it. */
export const PANEL_PLATE_PAD = 14;

/** How far inside her seat she stands, in frame px: the box is her drawing grown by it, so a
 *  placement sets a width of `w - 2 * pad` and lets the art decide the height. */
const SEAT_PAD = 5;
const SEAT_W = ASSISTANT_BLOCK.w * MODE_SCALE + SEAT_PAD * 2;
const SEAT_H = ASSISTANT_BLOCK.h * MODE_SCALE + SEAT_PAD * 2;

/**
 * The one live character's folded box in frame px: the press target and the start of her step to the
 * desk's seat, which is the same size.
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

/** The column's top edge in css px: it clears the selected caption's line box, not just its ink. */
export const PANEL_TOP = MODE_ROW_BASE + MODE.label.gap
  + LABEL_BOX_DEPTH * MODE.label.size + MODE.rowClearance;

/** Room below the panel for each bottom-bar layout, in CSS pixels at the frame scale. */
export function footReserve(mode: BuildMode): number {
  if (mode === 'object' || mode === 'generate') return SHELF_TABS.floor + SHELF_HEADING_HEIGHT;
  // The three terrain bars are one row of cells with a shortcut badge over each, and the smart
  // build's proposal puts one line of its own above them.
  return (mode === null ? 200 : 330) * SCALE;
}

/** The window's height in frame px, from the measured `--viewport-h` (`100vh` on mobile omits the bars). */
const WINDOW_H = 'var(--viewport-h, 100vh) / var(--shell-zoom, 1)';

/**
 * The column's top edge given the least height the panel can work in (handed in by the panel): it slides
 * up under the row it hangs from, down to the frame's top margin, rather than emptying itself.
 */
export function panelTop(least: number): string {
  return `clamp(${EDGE_TOP}px, calc(${WINDOW_H} - ${least}px), ${PANEL_TOP}px)`;
}

/** A taste trim on the courteous cap in frame px, never on the least-workable floor. */
const PANEL_CAP_TRIM = 24;

/**
 * The column's cap as a css length: the foot yields first, the head only after it. `borrow` is content
 * asking for the same yield, spent at the foot alone and still bounded by the window.
 */
export function panelMaxHeight(mode: BuildMode, least: number, borrow = 0): string {
  const room = `calc(${WINDOW_H} - ${panelTop(least)})`;
  return `max(calc(${room} - ${footReserve(mode)}px - ${PANEL_CAP_TRIM}px), min(${least + borrow}px, ${room}))`;
}

/*
 * The docked panel. It is the ground at a side edge (`z.ground`) and the map and frame are one sheet
 * slid aside over it, all scaled into the remaining window at one factor (`frameFit`'s `refWiden`).
 * Everything here mirrors for the right side except the two dock controls, which stay at the column's
 * right edge. The dock is the free column plus its control gutter, the window's full height.
 */

/** Which end of the window the dock stands at. Declared with the preference that persists it
 *  (`platform/storage/prefs.ts`), since that is the layer both the store and this file can reach. */
export type { DockSide };

/**
 * The dock's two controls stacked at the column's right edge in both modes, and the gutter they need;
 * only the desk band keeps clear of it.
 */
export const DOCK_CHROME = { size: 28, lane: 10, stack: 8 } as const;

/** What the gutter costs the column, in frame px. */
export const DOCK_CHROME_W = DOCK_CHROME.size + DOCK_CHROME.lane;

/** The two dock controls' file, top to bottom, in frame px, centred against the dock band. */
export const DOCK_CHROME_FILE_H = DOCK_CHROME.size * 2 + DOCK_CHROME.stack;

/** The docked column's own width in frame px: the free column plus the gutter its controls stand in.
 *  Below the dock band the content spans the whole of it. */
export const PINNED_COLUMN_W = PANEL_COLUMN_W + DOCK_CHROME_W;

/**
 * The dock's width in the fit's reference px (what `refWiden` measures), and in every chrome surface's own
 * units whatever the window (`--pin-dock-left`/`--pin-dock-right`).
 */
export const PINNED_DOCK_REF_W = PINNED_COLUMN_W * ZOOM;

/**
 * How far the ground drifts under the sliding sheet, as a share of the dock's width: a quarter is a visible
 * second plane, and a share under one keeps the uncovered strip covered.
 */
const DOCK_PARALLAX_SHARE = 1 / 4;

/** That share as a distance, in the frame's own px. */
export const DOCK_PARALLAX = PINNED_COLUMN_W * DOCK_PARALLAX_SHARE;

/**
 * The narrowest window the dock fits in, in css px: below it the frame beside the dock would shrink past
 * `FIT_FLOOR`. It scales with the UI zoom the dock is drawn at.
 */
function pinRoomFloor(uiZoom = 1): number {
  return FIT_FLOOR * (FIT_REF.w + PINNED_DOCK_REF_W * uiZoom);
}

/** Whether this window has room for the dock. */
export function hasPinRoom(vw: number, uiZoom = 1): boolean {
  return vw >= pinRoomFloor(uiZoom);
}

/**
 * The frame's zoom while the sheet stands `aside` of the way off the dock, as a pure function for the
 * per-frame writes outside a render (`use-dock.ts`).
 */
export function frameZoomAt(aside: number, vw: number, vh: number, uiZoom: number, floor = FIT_FLOOR): number {
  return ZOOM * fittedUiScale(vw, vh, uiZoom, aside * PINNED_DOCK_REF_W, floor);
}

/** The docked column's box in frame px: the window's top and bottom and the side the dock stands at. */
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

/** The sign of the sheet's travel off the ground: a left dock is revealed by a sheet moving right. */
export function dockTravelSign(side: DockSide): 1 | -1 {
  return side === 'left' ? 1 : -1;
}
