/**
 * Assistant-panel geometry in the shell frame's CSS-pixel coordinate system.
 * The panel shares the mode row's left edge and width. Its available height reserves room for the
 * active bottom bar, then yields that reserve and top clearance when needed to keep controls usable.
 * A pending question may borrow additional vertical room.
 */
import type { BuildMode } from '../../state/editing/edit-mode';
import type { DockSide } from '../../platform/storage/prefs';
import { TOUCH_TARGET, besideDock, uiScaleOf, type ArrangementRoom, type DockRef } from '../design/scale';
import { TOUCH_LINE, sideDockFits } from '../design/scale-model';
import { ASSISTANT_BLOCK, ASSISTANT_ROW_TOP, MODE_ROW_BASE, MODES, RAIL_TOP, TOP_RIGHT, cornerWidth } from './frame';
import { LABEL_BOX_DEPTH, MODE, EDGE, EDGE_LEFT, EDGE_TOP, MODE_SCALE, RAIL, SHELF_HEADING_HEIGHT, SHELF_TABS, ZOOM } from './units';
import { BAR_DEPTH, toolBarOf } from './bars/terrain-cells';
import { SEAM_HANDLE } from '../primitives/SeamHandle';

/** The panel's left edge: the block rows' own, so the three share one margin. */
export const PANEL_LEFT = EDGE_LEFT;

/** The width of a mode row of `count` blocks `gap` apart, in frame px. */
export const modeRowSpan = (count: number, gap: number) => count * MODE.size + (count - 1) * gap;

/** The column's width, from the row above it. */
export const PANEL_COLUMN_W = modeRowSpan(MODES.length, MODE.gap);

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

/** Room below the panel for the bar `mode` stands up, in CSS pixels at the frame scale: a tool bar's
 *  depth, a shelf's heading over `tabsTop`, the plan's shelf body top (`frame-plan.ts:FrameLayout.bar`),
 *  and none at rest, which shows no bar. */
export function footReserve(mode: BuildMode, tabsTop: number = SHELF_TABS.floor): number {
  const bar = toolBarOf(mode);
  if (bar) return BAR_DEPTH[bar];
  return mode === null ? 0 : tabsTop + SHELF_HEADING_HEIGHT;
}

/** The window's height in frame px, from the measured `--viewport-h` (`100vh` on mobile omits the bars). */
const WINDOW_H = 'var(--viewport-h, 100vh) / var(--shell-zoom, 1)';

/**
 * The column's top edge given the least height the panel can work in (handed in by the panel) and the
 * top the plan hangs it from (`frame-plan.ts:FrameLayout.panel`): it slides up under the row it hangs
 * from, down to the frame's top margin, rather than emptying itself.
 */
export function panelTop(least: number, top: number = PANEL_TOP): string {
  return `clamp(${EDGE_TOP}px, calc(${WINDOW_H} - ${least}px), ${top}px)`;
}

/** A taste trim on the courteous cap in frame px, never on the least-workable floor. */
const PANEL_CAP_TRIM = 24;

/**
 * The column's cap as a css length: the foot yields first, the head only after it. `borrow` is content
 * asking for the same yield, spent at the foot alone and still bounded by the window. `frame` is the
 * plan's panel top and shelf body top.
 */
export function panelMaxHeight(
  mode: BuildMode, least: number, borrow = 0,
  frame: { top: number; tabsTop: number } = { top: PANEL_TOP, tabsTop: SHELF_TABS.floor },
): string {
  const room = `calc(${WINDOW_H} - ${panelTop(least, frame.top)})`;
  return `max(calc(${room} - ${footReserve(mode, frame.tabsTop)}px - ${PANEL_CAP_TRIM}px), min(${least + borrow}px, ${room}))`;
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

/** Whether this window has room for the dock at `uiZoom` (`design/scale-model.ts:sideDockFits`). */
export function hasPinRoom(vw: number, uiZoom = 1): boolean {
  return sideDockFits(vw, PINNED_DOCK_REF_W, uiZoom);
}

/** The upright top row's least width in frame px: the character's ink and the corner actions
 *  `corner` wide, the least gap between them. */
export function uprightTopRow(corner: number): number {
  return CHARACTER_SEAT.w - 2 * CHARACTER_SEAT.pad + corner + RAIL.groupMin;
}

/** The narrowest frame the upright arrangement stands in, in its own px: its widest row, with the mode
 *  row's blocks abutting, between the least side margins (`frame-plan.ts:portraitEdges`). */
const UPRIGHT_LEAST_W = Math.max(uprightTopRow(cornerWidth(TOP_RIGHT)), modeRowSpan(MODES.length, 0)) + 2 * EDGE;

/** The touch frame's zoom at 100% where the touch line leads, which its controls stand a fingertip
 *  apart for; under it their hit areas shrink with them (`design/scale-model.ts:touchReachPx`). */
const TOUCH_FRAME_LEAST = ZOOM * TOUCH_LINE;

/** How far across, in its own px, a fingertip's `TOUCH_TARGET` reaches on the touch frame at most: at
 *  the zoom it is spaced for. Frame controls that must not cover each other's hit areas stand this far apart. */
export const TOUCH_FRAME_REACH = TOUCH_TARGET / TOUCH_FRAME_LEAST;

/** The shortest frame the wide touch arrangement stands in, in its own px, with the right-hand column
 *  at its most folded: the character's seat above the deepest terrain bar, and the layer control above
 *  history beside the view kit, each with its least gap. */
const WIDE_LEAST_H = Math.max(
  CHARACTER_SEAT.top + CHARACTER_SEAT.h + RAIL.gap + BAR_DEPTH.notes + EDGE,
  RAIL_TOP + RAIL.layer.h + (TOUCH_FRAME_REACH - RAIL.layer.h / 2) + RAIL.button + EDGE,
);

/** The frame's arrangement room in chrome terms (`design/scale-model.ts:ArrangementRoom`). */
export const ARRANGEMENT_ROOM: ArrangementRoom = { uprightLeastW: UPRIGHT_LEAST_W * ZOOM, wideLeastH: WIDE_LEAST_H * ZOOM };

/** How the frame is sized: at touch mode's sizes, and for the upright arrangement. */
interface FrameSizing { touch?: boolean; upright?: boolean }

/** The frame's zoom: `ZOOM` times the one scale (`design/scale-model.ts:uiScaleOf`) for a `vw` by
 *  `vh` window whose reference is widened by `refWiden`, at `sizing`. */
export function frameZoomFor(vw: number, vh: number, uiZoom: number, refWiden = 0, { touch = false, upright = false }: FrameSizing = {}): number {
  return ZOOM * uiScaleOf({ vw, vh, dock: { axis: 'x', size: refWiden }, touch, upright, uiZoom, room: touch ? ARRANGEMENT_ROOM : null });
}

/**
 * The strip a dock takes from a `vh`-high window with the sheet `aside` of the way off it, in css px: a
 * side dock's column at the reference zoom, or, given `depth`, a bottom dock's share of the height. The
 * one reading of the strip: the published `DockRef` (`use-dock.ts:useDockRefValue`) and every
 * per-frame write take it from here.
 */
export function dockStrip(aside: number, vh: number, depth?: number): DockRef {
  return depth === undefined
    ? { axis: 'x', size: aside * PINNED_DOCK_REF_W }
    : { axis: 'y', size: bottomDockPx(aside, depth, vh) };
}

/** The frame's zoom beside the dock strip `strip`, at `sizing`. */
function frameZoomBeside(vw: number, vh: number, uiZoom: number, strip: DockRef, sizing: FrameSizing = {}): number {
  const room = besideDock(vw, vh, strip);
  return frameZoomFor(room.vw, room.vh, uiZoom, room.widen, sizing);
}

/** The frame's room beside the dock strip `strip`, in its own px at `zoom`. */
export function frameRoomBeside(vw: number, vh: number, zoom: number, strip: DockRef): { width: number; height: number } {
  const room = besideDock(vw, vh, strip);
  return { width: room.vw / zoom - room.widen / ZOOM, height: room.vh / zoom };
}

/**
 * The frame's zoom while the sheet stands `aside` of the way off the dock, as a pure function for the
 * per-frame writes outside a render (`use-dock.ts`). `depth` is a bottom dock's share of the window's
 * height, absent for a side dock.
 */
export function frameZoomAt(
  aside: number, vw: number, vh: number, uiZoom: number,
  { depth, ...sizing }: FrameSizing & { depth?: number | undefined } = {},
): number {
  return frameZoomBeside(vw, vh, uiZoom, dockStrip(aside, vh, depth), sizing);
}

/**
 * The frame's room with the sheet `aside` of the way off a dock, in its own px at its zoom then
 * (`frameZoomAt`): the window less a side dock's column or a bottom dock's strip.
 */
export function frameRoomAt(
  aside: number, vw: number, vh: number, uiZoom: number,
  { depth, ...sizing }: FrameSizing & { depth?: number | undefined } = {},
): { zoom: number; width: number; height: number } {
  const strip = dockStrip(aside, vh, depth);
  const zoom = frameZoomBeside(vw, vh, uiZoom, strip, sizing);
  return { zoom, ...frameRoomBeside(vw, vh, zoom, strip) };
}

/** The docked column's box in frame px: the window's top and bottom and the side the dock stands at. */
export const PINNED_PANEL = {
  edge: 0,
  top: 0,
  height: `calc(${WINDOW_H})`,
} as const;

/*
 * On an upright window the dock stands at the window's foot instead: the panel spans the width, the
 * map and frame are the sheet slid up over it, and the handle on the seam sets how deep it reaches.
 */

/** The bottom dock's depth as a share of the window's height: where it opens, the least the handle
 *  keeps for the panel, the most it takes (the map keeps the rest above it), and the line a release
 *  under which closes the panel. */
export const BOTTOM_DOCK = { rest: 0.6, least: 0.4, most: 0.7, close: 0.15 } as const;

/** The edge a dock stands at: a side on a wide window, the foot on an upright one. */
export type DockEdge = DockSide | 'bottom';

/**
 * The deepest the bottom dock may reach, as a share of the window's height, when the frame above it
 * needs `leastHeight` frame px at `zoom` (`frame-plan.ts:FrameLayout.leastHeight`); 0 or less when the
 * window has no room for the dock at all.
 */
export function bottomDockCeiling(leastHeight: number, zoom: number, vh: number): number {
  return vh > 0 ? 1 - (leastHeight * zoom) / vh : 0;
}

/** The handle's `share` kept between the bottom dock's least and most. */
export function keptDockShare(share: number): number {
  return Math.min(BOTTOM_DOCK.most, Math.max(BOTTOM_DOCK.least, share));
}

/** The depth the bottom dock stands at: the handle's `share` kept between the panel's least and most,
 *  then yielding to the frame's `ceiling` as far as it must, past the least and the close line if need
 *  be, so an open mode's panel never scrolls; the ceiling keeps the dock's handle in sight. */
export function bottomDockDepth(share: number, ceiling: number): number {
  return Math.min(keptDockShare(share), ceiling);
}

/** The shallowest the bottom dock yields to, as a share of a `vh`-high window: its handle alone, drawn
 *  at `zoom`, so an open dock stays in sight however far it yields. */
export function bottomDockFloor(zoom: number, vh: number): number {
  return vh > 0 ? Math.min(1, (SEAM_HANDLE.h * zoom) / vh) : 0;
}

/** The bottom dock's height in css px with the sheet `aside` of the way off it. */
function bottomDockPx(aside: number, depth: number, vh: number): number {
  return aside * depth * vh;
}

/** The root custom property holding the bottom dock's depth as it stands, a share of the window's
 *  height: the settled depth, or the one a held seam handle drags it to, written on the drag's frames
 *  (`dock/use-dock-planes.ts`). */
export const DOCK_DEPTH_VAR = '--dock-depth';

/** The bottom dock's full height as a css length in frame px: as it stands, `depth` until a frame has
 *  written it. */
export function bottomDockHeight(depth: number): string {
  return `calc(${WINDOW_H} * var(${DOCK_DEPTH_VAR}, ${depth}))`;
}

/** The ground's drift under a sheet standing `aside` of the way off it, as a transform ('' at rest):
 *  it starts toward its own edge and settles as the sheet clears it. */
export function dockDrift(aside: number, edge: DockEdge): string {
  const d = (1 - aside) * DOCK_PARALLAX;
  if (d === 0) return '';
  return edge === 'bottom' ? `translateY(${d}px)` : `translateX(${-d * dockTravelSign(edge)}px)`;
}

/** Which css property places the docked column, and which one the sheet is inset by: the dock's own
 *  side. One reading, so no surface has to spell the mirror out for itself. */
export function dockEdge(side: DockSide): 'left' | 'right' {
  return side;
}

/** The sign of the sheet's travel off the ground: a left dock is revealed by a sheet moving right. */
function dockTravelSign(side: DockSide): 1 | -1 {
  return side === 'left' ? 1 : -1;
}
