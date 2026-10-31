/**
 * Where the frame's surfaces stand on one window, in css px local to the zoomed, dock-inset frame:
 * the mode row, the character's seat, the corner actions, the rail, the layer plate and the bottom
 * band. The art these positions are derived from lives in `frame.ts`.
 */
import type { InputMode } from '../../platform/device/input-mode';
import type { LayoutShape } from '../../platform/device/layout-shape';
import { pressable } from '../design/styles';
import {
  ASSISTANT_INK, HISTORY_BUTTONS, KIT_BUTTONS, MODES, MODE_ROW_LEFT, MODE_ROW_TOP, RAIL_TOP,
  TOP_RIGHT, TOP_RIGHT_H, TOP_RIGHT_TOP, TURN_BUTTONS, ZOOM_BUTTONS, cornerWidth, modeRowRight, railCell, railStack, viewKitCell,
  type FrameArt, type RailCell,
} from './frame';
import { CHARACTER_SEAT, PANEL_LEFT, PANEL_TOP, TOUCH_FRAME_REACH, modeRowSpan, uprightTopRow } from './panel-frame';
import { EDGE, EDGE_LEFT, EDGE_RIGHT, EDGE_TOP, LABEL_BOX_DEPTH, MODE, PLATE_BAND, RAIL, RAIL_FLOOR, SHELF_HEADING_HEIGHT, SHELF_TABS, UPRIGHT_SPACE, UPRIGHT_TOUCH_EDGE } from './units';

/** A group of `n` round buttons broken into `files` files, in css px of depth. */
const foldedHeight = (n: number, files: number) => railStack(Math.ceil(n / files));

/** Fold order for fitting the view kit, history pair, and optional layer panel into one lane. */
export const RAIL_FOLDS: readonly { kit: number; history: number }[] = [
  { kit: 1, history: 1 },
  { kit: 2, history: 1 },
  { kit: 2, history: 2 },
  { kit: 3, history: 2 },
  { kit: 4, history: 2 },
];
const MOST_FOLDED = RAIL_FOLDS[RAIL_FOLDS.length - 1]!;

/** Where the right-hand column's groups stand on one window, and where the open plate stands. */
export interface RailPlan {
  /** The buttons the view kit is placed for: its fullest complement on this plan. */
  kitButtons: number;
  /** Whether the kit carries the zoom pair and the 3D view's turns; in touch mode a pinch and a
   *  two-finger twist replace them. */
  steppers: boolean;
  /** How far left of the column's right edge history stands: 0 in the column, or past the kit where
   *  a short touch window has no room for it between the layer control and the kit. */
  historyInset: number;
  /** Files the view kit runs in. */
  kitFiles: number;
  /** Files the history pair runs in: one is the file it prefers, two is the 2x1 row a short window
   *  folds it into. */
  historyFiles: number;
  /** The kit's top, css px from the top of the window. */
  kitTop: number;
  /** The history pair's top. */
  historyTop: number;
  /** Whether the panel fits above history in the right lane. */
  plateInLane: boolean;
  /** The open plate's right edge, css px from the window's right edge. */
  plateRight: number;
  /** The deepest the open plate may draw before it scrolls inside itself. */
  plateMaxH: number;
  /** On an upright window with a panel open on the bar, how many of the kit's rows stand clear of it;
   *  the rows under it step aside. Absent, every row stands. */
  kitRows?: number;
}

/**
 * The least gap under the layer control in touch mode: its bottom step is half the plate tall and its
 * hit area grows downward to `TOUCH_TARGET` on screen, as far as `TOUCH_FRAME_REACH` at the least zoom.
 */
const TOUCH_LAYER_CLEARANCE = TOUCH_FRAME_REACH - RAIL.layer.h / 2;

/** What the input mode changes in the right-hand column, in either shape: touch drops the zoom pair
 *  and the turns from the view kit, since a pinch and a twist replace them, and keeps `layerClearance`
 *  under the layer control. */
function railMode(inputMode?: InputMode): { touch: boolean; kitButtons: number; layerClearance: number } {
  const touch = inputMode === 'touch';
  return { touch, kitButtons: touch ? KIT_BUTTONS - ZOOM_BUTTONS - TURN_BUTTONS : KIT_BUTTONS, layerClearance: touch ? TOUCH_LAYER_CLEARANCE : 0 };
}

/** Fold and lower the controls before yielding the right lane to a scrollable layer panel. */
export function planRail(vh: number, opts: { open: boolean; plateDepth: number; plateMinDepth?: number; top?: number; inputMode?: InputMode }): RailPlan {
  const top = opts.top ?? RAIL_TOP;
  const { touch, kitButtons, layerClearance } = railMode(opts.inputMode);
  const leastGap = Math.max(RAIL.gap, layerClearance);
  // The kit without its steppers fits one row of its own width.
  const folds = touch ? [...RAIL_FOLDS, { kit: kitButtons, history: MOST_FOLDED.history }] : RAIL_FOLDS;
  const mostFolded = folds[folds.length - 1]!;
  const layerBottom = top + RAIL.layer.h;
  const groupHeight = (fold: typeof RAIL_FOLDS[number]) =>
    foldedHeight(kitButtons, fold.kit) + foldedHeight(HISTORY_BUTTONS, fold.history);
  const fits = (fold: typeof RAIL_FOLDS[number], depth: number, floor: number) =>
    top + depth + 2 * RAIL.groupMin + groupHeight(fold) + floor <= vh;
  const restingFold = folds.find(fold => fits(fold, RAIL.layer.h, RAIL_FLOOR))
    ?? folds.find(fold => fits(fold, RAIL.layer.h, EDGE)) ?? mostFolded;
  const fold = opts.open
    ? folds.find(fold => fits(fold, opts.plateDepth, EDGE)) ?? mostFolded
    : restingFold;
  const gap = Math.max(leastGap, Math.min(RAIL.groupMin,
    (vh - EDGE - layerBottom - groupHeight(fold)) / 2));
  const floor = Math.max(EDGE, Math.min(RAIL_FLOOR,
    vh - top - (opts.open ? opts.plateDepth : RAIL.layer.h) - 2 * gap - groupHeight(fold)));
  const kitTop = vh - floor - foldedHeight(kitButtons, fold.kit);
  const historyH = foldedHeight(HISTORY_BUTTONS, fold.history);
  const yielded = kitTop - gap - historyH;
  const room = yielded - gap - top;
  const plateInLane = opts.open && room >= (opts.plateMinDepth ?? opts.plateDepth);
  const centred = (layerBottom + kitTop - historyH) / 2;
  const kitH = foldedHeight(kitButtons, fold.kit);
  // A squeezed touch rail keeps history between the layer step's hit area and the kit; where the
  // two cannot both hold, history stands beside the kit's last row instead.
  const between = Math.min(Math.max(centred, layerBottom + leastGap), kitTop - RAIL.gap - historyH);
  const beside = touch && !opts.open && between < layerBottom + leastGap;
  const resting = !touch ? centred : beside ? kitTop + kitH - historyH : between;
  const historyTop = opts.open
    ? plateInLane ? Math.max(resting, top + Math.min(opts.plateDepth, room) + gap) : yielded
    : resting;
  return {
    kitButtons, steppers: !touch,
    historyInset: beside ? railStack(fold.kit) + RAIL.groupMin : 0,
    kitFiles: fold.kit,
    historyFiles: fold.history,
    kitTop, historyTop, plateInLane,
    plateRight: plateInLane ? EDGE_RIGHT : EDGE_RIGHT + railStack(fold.kit) + gap,
    plateMaxH: plateInLane ? room : vh - top - EDGE,
  };
}

export interface FrameLayout {
  width: number;
  height: number;
  /** The arrangement the plan was made for. */
  shape: LayoutShape;
  /** The mode row's box: its top-left corner, the air between its blocks, the window edge it runs
   *  along, and `band`, how far above the window's foot the surface it stands on reaches (0 where it
   *  stands on the map). */
  modeRow: { left: number; top: number; gap: number; placement: 'top' | 'bottom'; band: number;
    /** On a wide window too narrow for the whole row beside the corner actions, the modes fold into one
     *  stack at the row's start (`controls/ModeRow.tsx:ModeTiles`); `open`, it stands unfolded. */
    folded?: true; open?: true };
  /** The character's folded seat box, top-left corner (`panel-frame.ts:CHARACTER_SEAT`). */
  character: { left: number; top: number };
  /** The free assistant panel's top-left corner, before it slides up for room (`panel-frame.ts:panelTop`). */
  panel: { left: number; top: number };
  /** The bottom band the shelves stand on: its bottom edge and visible height above the window's foot,
   *  and `tabsTop`, how far above the foot the shelves' row of names stands (the top of the shelf body).
   *  On an upright window, `room` is how tall a panel standing on the bar may grow: up to the foot of
   *  undo and redo, the view kit's rows under it stepping aside (`portraitRoom`); `reach` is how tall one
   *  a handle sizes may be drawn, over the column up to the top row. `tabsLeft`, on a wide window short
   *  enough that the character's seat reaches down to the shelves' names, is where the names start,
   *  past her seat; absent, they start at `SHELF_TABS.left`. */
  bar: { bottom: number; height: number; tabsTop: number; room?: number; reach?: number; tabsLeft?: number };
  /** On an upright window, the least height the frame can stand in, in its own px: the column down
   *  to the foot of undo and redo under the least top margin, the band, and the least depth of a panel
   *  open on the bar, so `bar.room` is never short of that panel at this height or above. 0 on a wide
   *  window. */
  leastHeight: number;
  /** The margin the frame keeps from the window's left edge: the wide gutter, or the upright one. */
  edgeLeft: number;
  edgeRight: number;
  /** The corner cluster's left edge, css px from the frame's left. */
  cornerLeft: number;
  cornerTop: number;
  railTop: number;
  plateTop: number;
  plateMaxWidth: number;
  compact: boolean;
  rail: RailPlan;
}

/** The landscape mode row, and what a surface drawn outside a frame (a Help picture) stands on. */
export const LANDSCAPE_MODE_ROW: Readonly<FrameLayout['modeRow']> = {
  left: MODE_ROW_LEFT, top: MODE_ROW_TOP, gap: MODE.gap, placement: 'top', band: 0,
};

/** The landscape bottom band, and what a surface drawn outside a frame stands on. */
export const LANDSCAPE_BAR: Readonly<FrameLayout['bar']> = { bottom: 0, height: PLATE_BAND.top, tabsTop: SHELF_TABS.floor };

/** The landscape free panel, hanging under the mode row from its left edge. */
export const LANDSCAPE_PANEL: Readonly<FrameLayout['panel']> = { left: PANEL_LEFT, top: PANEL_TOP };

/** The upright arrangement's margins before any narrowing: `UPRIGHT_TOUCH_EDGE` in touch mode, the wide
 *  arrangement's gutters and top for a mouse. */
function portraitBase(inputMode: InputMode | undefined): { left: number; right: number; top: number } {
  return inputMode === 'touch'
    ? { left: UPRIGHT_TOUCH_EDGE.side, right: UPRIGHT_TOUCH_EDGE.side, top: UPRIGHT_TOUCH_EDGE.top }
    : { left: EDGE_LEFT, right: EDGE_RIGHT, top: EDGE_TOP };
}

/**
 * The upright arrangement's margins at the window's sides, the one pair every upright surface keeps
 * (the top row, the column, the mode row, the panel on the bar, the band's notices): the base pair
 * (`portraitBase`), both narrowed alike toward `EDGE` only as far as the widest of its rows needs to
 * fit between them: the top row (the character's ink and the corner actions, with the least gap
 * between them) or the mode row at the wide row's gap.
 */
function portraitEdges(width: number, corner: number, modes: number, base: { left: number; right: number }): { left: number; right: number } {
  const widest = Math.max(uprightTopRow(corner), modeRowSpan(modes, MODE.gap));
  const share = Math.max(0, Math.min(1, (width - widest - 2 * EDGE) / (base.left + base.right - 2 * EDGE)));
  return { left: EDGE + share * (base.left - EDGE), right: EDGE + share * (base.right - EDGE) };
}

/**
 * The upright arrangement's top margin: the base `top`, yielding toward `EDGE` by as much as an open
 * panel's least stands past the room the column leaves it, so where a docked assistant has yielded as
 * far as it may the margin gives way before the panel scrolls.
 */
function portraitTop(height: number, band: number, edgeRight: number, top: number, opts: Parameters<typeof planFrame>[2]): number {
  const full = planPortraitRail(height, portraitRailTop(top), band + RAIL.groupMin, edgeRight, opts);
  const short = (opts.panelLeast ?? 0) - portraitRoom(height, band, full.historyTop + foldedHeight(HISTORY_BUTTONS, full.historyFiles));
  return Math.max(EDGE, top - Math.max(0, short));
}

/** The air above the tiles and below the selected tile's name inside the upright bar. */
const BAR_PAD = UPRIGHT_SPACE.band;

/** The upright bar's depth above the window's foot: the tiles, the room for the selected one's name
 *  under them, and the air around both. */
const PORTRAIT_BAR_H = BAR_PAD + MODE.height + MODE.label.gap + LABEL_BOX_DEPTH * MODE.label.size + BAR_PAD;

/**
 * The upright mode row across the bottom bar, between the side margins `edges`: its blocks spread
 * across them up to twice the landscape gap, then centred on the window while that keeps them inside
 * the margins. `EDGE` exceeds `PLATE_OVERHANG`, so the splat under an end block stays on screen.
 */
function portraitModeRow(width: number, height: number, count: number, edges: { left: number; right: number }): FrameLayout['modeRow'] {
  const n = Math.max(1, count);
  const room = width - edges.left - edges.right;
  const spread = n > 1 ? (room - n * MODE.size) / (n - 1) : 0;
  const gap = Math.max(0, Math.min(2 * MODE.gap, spread));
  const left = Math.max(edges.left, (width - modeRowSpan(n, gap)) / 2);
  return { left, top: height - PORTRAIT_BAR_H + BAR_PAD, gap, placement: 'bottom', band: PORTRAIT_BAR_H };
}

/** The gap under the upright column's layer control: wider in touch mode, where its bottom step's hit
 *  area reaches down into it. History and the kit keep `RAIL.groupGap` between them. */
const portraitRailGap = (inputMode?: InputMode) => Math.max(RAIL.groupGap, railMode(inputMode).layerClearance);

/** The upright column's top, under the corner actions standing `top` from the window's top. */
const portraitRailTop = (top: number) => top + TOP_RIGHT_H + RAIL.groupGap;

/** Where history and the kit stand in the upright column hanging from `top` under `fold`, and the foot
 *  of history, the last of the column a panel on the bar leaves clear. */
function portraitColumn(
  top: number, inputMode: InputMode | undefined, fold: typeof RAIL_FOLDS[number],
): { historyTop: number; historyFoot: number; kitTop: number } {
  const gap = portraitRailGap(inputMode);
  const historyTop = top + RAIL.layer.h + gap;
  const historyFoot = historyTop + foldedHeight(HISTORY_BUTTONS, fold.history);
  return { historyTop, historyFoot, kitTop: historyFoot + RAIL.groupGap };
}

/** How tall a panel on the upright bar may grow on a frame `height` tall: up to the foot of undo and
 *  redo (`FrameLayout.bar.room`, before its clamp at zero), covering the view kit's rows, which step
 *  aside; the top row, the layer control and history are the least of the map a panel leaves. */
function portraitRoom(height: number, band: number, historyFoot: number): number {
  return height - band - historyFoot - RAIL.groupMin;
}

/**
 * The upright right-hand column, top down under the corner: the layer control, history, then the
 * view kit, folding only when the window is too short for one file. An open layer plate stands
 * beside the column rather than in it.
 */
function planPortraitRail(vh: number, top: number, floor: number, edgeRight: number, opts: { inputMode?: InputMode; panelDepth?: number }): RailPlan {
  const { touch, kitButtons } = railMode(opts.inputMode);
  const gap = portraitRailGap(opts.inputMode);
  const layerBottom = top + RAIL.layer.h;
  const bottom = vh - floor;
  const depth = (fold: typeof RAIL_FOLDS[number]) =>
    gap + foldedHeight(HISTORY_BUTTONS, fold.history) + RAIL.groupGap + foldedHeight(kitButtons, fold.kit);
  const fold = RAIL_FOLDS.find((f) => layerBottom + depth(f) <= bottom) ?? MOST_FOLDED;
  const { historyTop, historyFoot, kitTop } = portraitColumn(top, opts.inputMode, fold);
  // A panel open on the bar takes the room under the kit's rows that would stand on it, all of them
  // where it stands up to history. A panel a handle draws taller than that room covers the column
  // rather than re-planning it.
  const panelDepth = Math.min(opts.panelDepth ?? 0, Math.max(0, bottom - historyFoot - RAIL.groupMin));
  const clearBottom = bottom - panelDepth;
  const clearRows = Math.max(0, Math.floor((clearBottom - kitTop + RAIL.gap) / (RAIL.button + RAIL.gap)));
  const kitRows = Math.max(...Array.from({ length: kitButtons }, (_, i) => viewKitCell(i, kitButtons, fold.kit).row));
  return {
    kitButtons, steppers: !touch, historyInset: 0,
    kitFiles: fold.kit,
    historyFiles: fold.history,
    historyTop,
    kitTop,
    plateInLane: false,
    plateRight: edgeRight + railStack(fold.kit) + RAIL.groupMin,
    // An open layer plate stops short of a panel open on the bar, as the kit's rows do.
    plateMaxH: bottom - top - panelDepth,
    ...(panelDepth && clearRows < kitRows ? { kitRows: clearRows } : {}),
  };
}

/**
 * Dimensions are local to the zoomed, dock-inset frame; `modes` and `corner` are what shows (a planet
 * session draws fewer) and default to the full editor's. `shape` and `inputMode` default to the
 * landscape PC arrangement. Touch mode (`inputMode`) drops the zoom pair and the turns from the view
 * kit in either shape, since a pinch and a twist replace them, and widens the least gap under the layer control so its bottom
 * step's hit area clears what stands below it.
 */
export function planFrame(
  width: number, height: number,
  opts: {
    open: boolean; plateDepth: number; plateMinDepth?: number; plateMinWidth?: number; modes?: number; corner?: readonly FrameArt[];
    shape?: LayoutShape; inputMode?: InputMode;
    /** How tall the panel open on an upright window's bar stands above it, 0 with none. */
    panelDepth?: number;
    /** The least depth that panel can work in, 0 with none. */
    panelLeast?: number;
    /** Whether a folded mode row stands unfolded (`FrameLayout.modeRow.open`). */
    rowOpen?: boolean;
  },
): FrameLayout {
  if (opts.shape === 'portrait') return planPortrait(width, height, opts);
  const edgeRight = opts.plateMinWidth === undefined ? EDGE_RIGHT : Math.max(EDGE, Math.min(EDGE_RIGHT,
    width - ASSISTANT_INK.right - 2 * RAIL.groupMin - railStack(MOST_FOLDED.kit) - opts.plateMinWidth));
  const corner = cornerWidth(opts.corner ?? TOP_RIGHT);
  // The mode row's selected caption ends where the free panel hangs.
  const modeBottom = PANEL_TOP;
  // A top row too narrow for the whole mode row beside the corner actions folds the modes into one
  // stack at the row's start, so the corner keeps its place; unfolded, the row passes over the corner,
  // which steps away until it folds again (`controls/CornerActions.tsx`).
  const count = opts.modes ?? MODES.length;
  const folded = width - edgeRight - corner < modeRowRight(count) + RAIL.groupMin;
  const open = folded && !!opts.rowOpen;
  const cornerTop = TOP_RIGHT_TOP;
  const railTop = Math.max(RAIL_TOP, cornerTop + TOP_RIGHT_H + RAIL.gap);
  let rail = planRail(height, { ...opts, top: railTop });
  const compact = rail.kitFiles > 2
    || rail.kitTop + foldedHeight(rail.kitButtons, rail.kitFiles) > height - RAIL_FLOOR + 0.5;
  const plateTop = rail.plateInLane ? railTop
    : Math.max(RAIL_TOP, modeBottom);
  if (!rail.plateInLane && plateTop < cornerTop + TOP_RIGHT_H + RAIL.gap) {
    rail = { ...rail, plateRight: Math.max(rail.plateRight, EDGE_RIGHT + corner + RAIL.gap) };
  }
  rail = { ...rail, plateRight: rail.plateRight + edgeRight - EDGE_RIGHT };
  // Keep the panel beside the assistant when their vertical spans meet, preserving the room above.
  const plateLeft = plateTop < ASSISTANT_INK.top + ASSISTANT_INK.h + RAIL.gap
    ? ASSISTANT_INK.right + RAIL.groupMin : EDGE_LEFT;
  const plateMaxWidth = width - rail.plateRight - plateLeft;
  rail = { ...rail, plateMaxH: rail.plateMaxH - (plateTop - railTop) };
  // The shelves' heading stands on the bar's floor; a short window brings it up beside her seat.
  const namesTop = height - LANDSCAPE_BAR.bottom - LANDSCAPE_BAR.tabsTop - SHELF_HEADING_HEIGHT;
  const besideSeat = CHARACTER_SEAT.top + CHARACTER_SEAT.h - CHARACTER_SEAT.pad > namesTop;
  return {
    width, height,
    shape: 'landscape',
    modeRow: folded ? { ...LANDSCAPE_MODE_ROW, folded: true, ...(open ? { open: true } : {}) } : LANDSCAPE_MODE_ROW,
    character: { left: CHARACTER_SEAT.left, top: CHARACTER_SEAT.top },
    panel: LANDSCAPE_PANEL,
    bar: besideSeat
      ? { ...LANDSCAPE_BAR, tabsLeft: CHARACTER_SEAT.left + CHARACTER_SEAT.w - CHARACTER_SEAT.pad + RAIL.groupMin - SHELF_TABS.padX }
      : LANDSCAPE_BAR,
    leastHeight: 0,
    edgeLeft: EDGE_LEFT, edgeRight, cornerLeft: width - edgeRight - corner, cornerTop, railTop, plateTop, plateMaxWidth, compact, rail,
  };
}

/**
 * The upright arrangement: the character top left, the corner actions top right with the column
 * under them, and the mode row in a bar across the window's foot that the shelves stand above.
 */
function planPortrait(width: number, height: number, opts: Parameters<typeof planFrame>[2]): FrameLayout {
  const corner = cornerWidth(opts.corner ?? TOP_RIGHT);
  const modes = opts.modes ?? MODES.length;
  const base = portraitBase(opts.inputMode);
  const { left: edgeLeft, right: edgeRight } = portraitEdges(width, corner, modes, base);
  const modeRow = portraitModeRow(width, height, modes, { left: edgeLeft, right: edgeRight });
  const cornerTop = portraitTop(height, modeRow.band, edgeRight, base.top, opts);
  // Her drawing centres on the corner cluster's ink, so the top line reads as one row.
  const character = {
    left: edgeLeft - CHARACTER_SEAT.pad,
    top: cornerTop + TOP_RIGHT_H / 2 - CHARACTER_SEAT.h / 2,
  };
  const railTop = portraitRailTop(cornerTop);
  const rail = planPortraitRail(height, railTop, modeRow.band + RAIL.groupMin, edgeRight, opts);
  return {
    width, height,
    shape: 'portrait',
    modeRow,
    character,
    panel: { left: edgeLeft, top: character.top + CHARACTER_SEAT.h + RAIL.gap },
    bar: {
      bottom: modeRow.band, height: PLATE_BAND.top, tabsTop: SHELF_TABS.floor,
      room: Math.max(0, portraitRoom(height, modeRow.band, rail.historyTop + foldedHeight(HISTORY_BUTTONS, rail.historyFiles))),
      reach: Math.max(0, height - modeRow.band - (cornerTop + TOP_RIGHT_H + RAIL.groupGap)),
    },
    leastHeight: portraitLeastHeight(opts, modeRow.band),
    edgeLeft, edgeRight, cornerLeft: width - edgeRight - corner, cornerTop, railTop,
    plateTop: railTop,
    plateMaxWidth: width - rail.plateRight - edgeLeft,
    compact: rail.kitFiles > 2,
    rail,
  };
}

/**
 * The upright frame's least height (`FrameLayout.leastHeight`), with the top margin narrowed as far
 * as it goes (`portraitTop`), so a bottom dock yields only past what that narrowing gives a panel. It
 * takes history's foot under the fold that sets it lowest, whatever fold the plan picks at a given
 * height, so every height from this one up leaves `bar.room` at least `panelLeast`.
 */
function portraitLeastHeight(opts: { inputMode?: InputMode; panelLeast?: number }, band: number): number {
  const foot = Math.max(...RAIL_FOLDS.map((fold) => portraitColumn(portraitRailTop(EDGE), opts.inputMode, fold).historyFoot));
  // The height at which the room is exactly the panel's least, since the room grows with the height.
  return (opts.panelLeast ?? 0) - portraitRoom(0, band, foot);
}

/** Reserve only the rail cells that intersect this vertical band, in frame-local pixels. Upright it is
 *  0: a panel on the bar stands under the column's kit rows, which step aside, or over the column. */
export function railClearanceFor(layout: FrameLayout, bottom: number, height: number): number {
  if (layout.shape === 'portrait') return 0;
  const top = layout.height - bottom - height;
  const end = layout.height - bottom;
  let clearance = 0;
  const include = (cell: RailCell, groupTop: number, files: number, inset = 0) => {
    const y = groupTop + (cell.row - 1) * (RAIL.button + RAIL.gap);
    const overhang = RAIL.button * (pressable.whileHover.scale - 1) / 2;
    if (y < end + overhang && y + RAIL.button > top - overhang) {
      clearance = Math.max(clearance,
        inset + railStack(files - cell.column + 1) + RAIL.groupMin);
    }
  };
  for (let i = 0; i < layout.rail.kitButtons; i++) {
    include(viewKitCell(i, layout.rail.kitButtons, layout.rail.kitFiles), layout.rail.kitTop, layout.rail.kitFiles);
  }
  for (let i = 0; i < HISTORY_BUTTONS; i++) {
    include(railCell(i, HISTORY_BUTTONS, layout.rail.historyFiles), layout.rail.historyTop,
      layout.rail.historyFiles, layout.rail.historyInset);
  }
  return clearance;
}

