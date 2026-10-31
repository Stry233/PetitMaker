/**
 * Frame art in design px and the fixed anchors derived from it; `units.ts` converts to fixed css px and
 * `frame-plan.ts` places the surfaces on a window from these.
 */
import { modesInSession, type BuildMode } from '../../state/editing/edit-mode';
import type { PlanetSession } from '../../state/slices/planet-session';
import type { ModalId } from '../../state/slices/shell';
import type { TourTargetId } from '../chrome/tour/steps';
import type { HelpPageId } from '../help/page-schema';
import {
  BLOCK_W, BLOCK_W_ON, EDGE_LEFT, EDGE_RIGHT, EDGE_TOP, LABEL_INK_DEPTH, MODE, MODE_PLATE_W, TOP_RIGHT_GAP,
  MODE_SCALE, RAIL,
} from './units';

import { MODE_ICONS } from '../design/mode-icons';
import modePlate from '../../assets/shell/mode-selected-plate.svg';
import assistantCharacter from '../../assets/shell/assistant/character.png';
import shareButton from '../../assets/shell/share/button.svg';
import menuButton from '../../assets/shell/menu/button.svg';
import railUndo from '../../assets/shell/rail/undo/shape.svg';
import railRotateBody from '../../assets/shell/rail/rotate/ellipse-2.svg';
import railRotateTip from '../../assets/shell/rail/rotate/roundrect.svg';
import railZoomInLens from '../../assets/shell/rail/zoom-in/ellipse-2.svg';
import railZoomInMark from '../../assets/shell/rail/zoom-in/roundrect.svg';
import railZoomOutLens from '../../assets/shell/rail/zoom-out/ellipse-2.svg';
import railZoomOutMark from '../../assets/shell/rail/zoom-out/roundrect.svg';
import railHideEye from '../../assets/shell/rail/hide-ui/ellipse-2.svg';
import layersStack from '../../assets/shell/rail/layers/polygon.svg';
import type { I18nKey } from '../../i18n/keys';

/** A drawing: how big it is in design px, and what it is called. */
export interface FrameArt {
  id: string;
  /** The drawing's file; absent for the load disc, which `LoadMeter` draws as the game's translucent disc. */
  src?: string;
  /** i18n key for the accessible name. */
  labelKey: I18nKey;
  w: number;
  h: number;
  /** Design px between the drawing's ink and the foot of its box (mode PNGs are cropped to their ink and declare none). */
  botSlack?: number;
  /** How big the drawing reads in its own design px (`apparentSize` over its alpha); the corner cluster is sized by it. */
  apparent?: number;
  /** The eye's correction on `apparent`, kept apart so the measurement stays a measurement. */
  trim?: number;
  /** What pressing the control opens: the menu sheet or a modal. Absent for a readout. */
  opens?: 'menu' | ModalId;
  /** The tour step that points at the control. Only controls that act are named. */
  tourTarget?: TourTargetId;
  /** The Help page the control teaches. */
  helpTarget?: HelpPageId;
  /** The focus ring's corner radius, for a drawing that is not the rounded rectangle
   *  `FOCUS_SHAPE_RADIUS` assumes. */
  focusRadius?: number;
  /** The control stays in the corner during a planet session. */
  inSession?: boolean;
}

/** A block of the top-left row: its resting drawing and the separate, heavier one drawn for selection. */
export interface BlockArt extends FrameArt {
  /** A block is always a picture, never something the frame draws. */
  src: string;
  selected: { src: string; w: number; h: number };
}

/** A build-mode block, named by the mode it arms. */
export interface ModeArt extends BlockArt {
  id: Exclude<BuildMode, null>;
  /** i18n key for the name inside a planet session, where the mode shapes the ground rather than
   *  mountains. Absent when the name is the same there. */
  sessionLabelKey?: I18nKey;
  /** The Help page the block teaches; the three terrain surfaces share one page. */
  helpTarget: HelpPageId;
}

/** A drawing at a chosen width, keeping the proportions it was drawn at. */
const atWidth = (drawn: { w: number; h: number }, w: number) => ({ w, h: (drawn.h * w) / drawn.w });

/**
 * The five build modes left to right at the sizes the design draws them; `MODES` brings each to one
 * block width, since the grass cube is the unit the row is read by.
 */
const MODES_DRAWN: readonly {
  id: ModeArt['id'];
  src: string;
  on: string;
  labelKey: I18nKey;
  sessionLabelKey?: I18nKey;
  helpTarget: HelpPageId;
  rest: { w: number; h: number };
  sel: { w: number; h: number };
}[] = [
  { id: 'object', src: MODE_ICONS.object.rest, on: MODE_ICONS.object.pressed, labelKey: 'mode.object', helpTarget: 'objects',
    rest: { w: 172, h: 184 }, sel: { w: 207, h: 212 } },
  { id: 'road', src: MODE_ICONS.road.rest, on: MODE_ICONS.road.pressed, labelKey: 'mode.road', helpTarget: 'terrain',
    rest: { w: 172, h: 190 }, sel: { w: 207, h: 200 } },
  { id: 'mountain', src: MODE_ICONS.mountain.rest, on: MODE_ICONS.mountain.pressed, labelKey: 'mode.mountain', sessionLabelKey: 'mode.terrain', helpTarget: 'terrain',
    rest: { w: 172, h: 165 }, sel: { w: 207, h: 187 } },
  { id: 'water', src: MODE_ICONS.water.rest, on: MODE_ICONS.water.pressed, labelKey: 'mode.water', helpTarget: 'terrain',
    rest: { w: 172, h: 168 }, sel: { w: 207, h: 200 } },
  { id: 'generate', src: MODE_ICONS.generate.rest, on: MODE_ICONS.generate.pressed, labelKey: 'mode.generate', helpTarget: 'generate',
    rest: { w: 176, h: 174 }, sel: { w: 208, h: 180 } },
];

/** The five, every drawing at the row's own block width. */
export const MODES: readonly ModeArt[] = MODES_DRAWN.map((art) => ({
  id: art.id,
  src: art.src,
  labelKey: art.labelKey,
  helpTarget: art.helpTarget,
  ...(art.sessionLabelKey ? { sessionLabelKey: art.sessionLabelKey } : {}),
  ...atWidth(art.rest, BLOCK_W),
  selected: { src: art.on, ...atWidth(art.sel, BLOCK_W_ON) },
}));

/** The mode row's modes: the planet session's or a hand repair's (`modesInSession`), every block outside them. */
export function sessionModes(planetSession: PlanetSession | null, repairing = false): BuildMode[] {
  return [...(modesInSession(planetSession, repairing) ?? MODES.map((art) => art.id))];
}

/** The i18n key naming mode `id`, inside a planet session or outside one. */
export function modeLabelKey(id: ModeArt['id'], inSession: boolean): I18nKey {
  const art = MODES.find((a) => a.id === id)!;
  return (inSession && art.sessionLabelKey) || art.labelKey;
}

/** The mode row's blocks for the session state, each carrying the name it wears there. */
export function sessionModeArt(planetSession: PlanetSession | null, repairing = false): ModeArt[] {
  return sessionModes(planetSession, repairing).map((id) => {
    const art = MODES.find((a) => a.id === id)!;
    return { ...art, labelKey: modeLabelKey(art.id, planetSession !== null) };
  });
}

/** The splat under the selected mode, wider than a block and hanging `drop` below the baseline it stands on. */
export const MODE_PLATE = { src: modePlate, w: MODE_PLATE_W, h: 196, drop: 32 } as const;

/** The splat's one identity across the five mode blocks, so a switch moves it rather than drawing another. */
export const MODE_PLATE_ID = 'shell-mode-plate';

/** The character, at the size the design draws it: smaller than a mode block, and the same picture
 *  in both states, since the design has no pressed one. */
const CHARACTER = { w: 153, h: 150 };

/**
 * The character's width as a fraction of the block width per state: a solid animal reads bigger than a
 * diorama at one width, so her `apparentSize` is held to the five blocks' mean.
 */
const CHARACTER_FIT = { rest: 184.22 / 190.96, selected: 209.81 / 229.82 };

/** The assistant's block: a block of the mode row's family, with its slot, splat and caption. */
export const ASSISTANT_BLOCK: BlockArt = {
  id: 'assistant',
  src: assistantCharacter,
  labelKey: 'mode.assistant',
  ...atWidth(CHARACTER, BLOCK_W * CHARACTER_FIT.rest),
  selected: { src: assistantCharacter, ...atWidth(CHARACTER, BLOCK_W_ON * CHARACTER_FIT.selected) },
};

/** The left margin both rows keep, wide enough that the first block's splat is not cut at the window. */
export const MODE_ROW_LEFT = EDGE_LEFT;

/** The mode row's box top, the selected object block's ink top, so a selection keeps the frame's margin. */
export const MODE_ROW_TOP = EDGE_TOP;

/** The baseline the mode row's blocks stand on. */
export const MODE_ROW_BASE = MODE_ROW_TOP + MODE.height;

/** How far the row's ink reaches below its baseline with a mode selected: the splat, then the name's reserved slot. */
const MODE_ROW_DEPTH = MODE.label.gap + LABEL_INK_DEPTH * MODE.label.size;

/** How far down the mode row's own ink reaches, in css px: the baseline plus the name under it.
 *  What anything standing below the row has to clear (`panel-frame.ts:PANEL_TOP`). */
export const MODE_ROW_INK_BOTTOM = MODE_ROW_BASE + MODE_ROW_DEPTH;

/**
 * The assistant row's top, derived from the tightest state (a mode named, the assistant open): her ink
 * stands `MODE.rowClearance` under the name's.
 */
export const ASSISTANT_ROW_TOP = MODE_ROW_INK_BOTTOM + MODE.rowClearance
  - (MODE.height - ASSISTANT_BLOCK.selected.h * MODE_SCALE);

/** Where a mode row stands across the window and the air between its blocks (`frame-plan.ts:FrameLayout.modeRow`). */
export interface RowSpan { left: number; gap: number }

/** The landscape row's span. */
const LANDSCAPE_SPAN: RowSpan = { left: MODE_ROW_LEFT, gap: MODE.gap };

/** The centre of the mode row's `i`th block, in css px from the window's left edge. */
export function blockCentre(i: number, row: RowSpan = LANDSCAPE_SPAN): number {
  return row.left + i * (MODE.size + row.gap) + MODE.size / 2;
}

/** The assistant block's own ink: where its drawing sits inside the box it is given. Its top is the
 *  panel's, since the design hangs the card off the character's shoulder. */
export const ASSISTANT_INK = {
  left: MODE_ROW_LEFT,
  right: MODE_ROW_LEFT + MODE.size,
  top: ASSISTANT_ROW_TOP + MODE.height - ASSISTANT_BLOCK.h * MODE_SCALE,
  h: ASSISTANT_BLOCK.h * MODE_SCALE,
} as const;

/**
 * The load disc, save-and-share and the menu, laid out from the top-right corner in this order. The
 * unequal `trim`s are judged by eye at rendered size against a rail disc (the disc needs none).
 */
export const TOP_RIGHT: readonly FrameArt[] = [
  { id: 'load', labelKey: 'hud.region_load', w: 157, h: 157, botSlack: 0, apparent: 175.7 },
  { id: 'share', src: shareButton, labelKey: 'a11y.save_share', w: 130, h: 136, botSlack: 3.8, apparent: 125.9, trim: 0.84,
    opens: 'share', tourTarget: 'share', helpTarget: 'share' },
  // A disc, so its focus ring is one too.
  { id: 'menu', src: menuButton, labelKey: 'a11y.open_menu', w: 131, h: 132, botSlack: 1, apparent: 140.5, trim: 0.95,
    opens: 'menu', tourTarget: 'menu', helpTarget: 'frame', focusRadius: 999, inSession: true },
];

/** A top-right drawing's height in css px: where its ink reads at a rail button's size, times `trim`. */
export function topRightHeight(art: FrameArt): number {
  return ((RAIL.topRight * art.h) / (art.apparent ?? art.h)) * (art.trim ?? 1);
}

/** How far that drawing's ink stops above the bottom of its box, at the height it is drawn. */
export function topRightSlack(art: FrameArt): number {
  return ((art.botSlack ?? 0) / art.h) * topRightHeight(art);
}

/** The top-right controls over a map, and the one a planet session keeps: the menu, whose rows
 *  follow the session (`MenuSheet.tsx:menuRows`). */
export function cornerArt(inSession: boolean): readonly FrameArt[] {
  return inSession ? SESSION_CORNER : TOP_RIGHT;
}
const SESSION_CORNER: readonly FrameArt[] = TOP_RIGHT.filter((art) => art.inSession);

/** How wide a corner cluster of these drawings stands, in css px. */
export function cornerWidth(arts: readonly FrameArt[]): number {
  return arts.reduce((sum, art) => sum + topRightHeight(art) * art.w / art.h, 0)
    + (arts.length - 1) * TOP_RIGHT_GAP;
}

/** How far right a mode row of `count` blocks reaches, in css px: the splat under its last block. */
export function modeRowRight(count: number, row: RowSpan = LANDSCAPE_SPAN): number {
  return blockCentre(count - 1, row) + MODE_PLATE_W * MODE_SCALE / 2;
}

/** The corner cluster's depth in css px: from its highest ink to the line the three stand on. */
export const TOP_RIGHT_H = Math.max(...TOP_RIGHT.map((art) => topRightHeight(art) - topRightSlack(art)));

/** The line through the middle of the resting mode blocks' ink, in css px from the window's top:
 *  what the top-right cluster and the planet session's nameplate centre on. */
export const MODE_ROW_INK_CENTRE = MODES.reduce(
  (sum, art) => sum + (MODE_ROW_BASE - (art.h * MODE_SCALE) / 2),
  0,
) / MODES.length;

/**
 * The corner cluster's box top: its ink centred on the resting mode blocks' mean ink centre, derived from
 * the art so a redrawn block moves it. The three share a bottom line with each other by their ink.
 */
export const TOP_RIGHT_TOP = MODE_ROW_INK_CENTRE - TOP_RIGHT_H / 2;

/** The rail's top, level with the resting character's ink across the window (`ASSISTANT_INK`). */
export const RAIL_TOP = ASSISTANT_INK.top;

/** The collapsed layer control's right offset: centred on the rail buttons, since both shapes' ink is their box. */
export const LAYER_STEP_RIGHT = EDGE_RIGHT + (RAIL.button - RAIL.layer.w) / 2;

/**
 * How much of the collapsed layer count still takes a press, in frame px from its right end, or `null` for
 * all of it: where the word stands over a free assistant panel, that part is the panel's to answer.
 */
export function readoutPressLane(
  box: { left: number; width: number },
  panelRight: number | null,
): number | null {
  if (panelRight === null || box.width === 0) return null;
  const covered = panelRight - box.left;
  if (covered <= 0) return null;
  return Math.max(0, box.width - covered);
}

/** A file of `n` round rail buttons, in css px, and equally the width of `n` files of them. */
export const railStack = (n: number) => n * RAIL.button + (n - 1) * RAIL.gap;

/** The view kit at its fullest: the five buttons both views carry, plus the yaw pair 3D adds. The
 *  kit is placed for this so that switching view does not move it. */
export const KIT_BUTTONS = 7;
/** Zoom in and zoom out, the kit's fourth and fifth buttons. */
export const ZOOM_BUTTONS = 2;
/** The yaw pair, the kit's last two buttons, which only the 3D view shows. */
export const TURN_BUTTONS = 2;
/** Undo and redo. */
export const HISTORY_BUTTONS = 2;

/** Where one button of a right-hand group stands in its grid. Both 1-based, as the grid is. */
export interface RailCell {
  column: number;
  row: number;
}

/**
 * The cell of the `i`th of `count` buttons in `files` files. A folded group fills from the right so the
 * shared right edge stays straight, and every button is placed so one leaving never reflows the rest.
 */
export function railCell(i: number, count: number, files: number): RailCell {
  const orphans = count % files;
  /** The buttons that fill whole rows; the rest are the short last row, right-aligned. */
  const full = count - orphans;
  if (i < full) return { column: (i % files) + 1, row: Math.floor(i / files) + 1 };
  return { column: files - orphans + 1 + (i - full), row: full / files + 1 };
}

/** Wider folds give the three view actions their own row, keeping zoom and yaw pairs together; a fold
 *  as wide as the kit runs it in one row. */
export function viewKitCell(i: number, count: number, files: number): RailCell {
  if (files < 3 || files >= count) return railCell(i, count, files);
  if (i < 3) return railCell(i, 3, files);
  const pairFiles = files === 3 ? 2 : files;
  const cell = railCell(i - 3, count - 3, pairFiles);
  return { column: cell.column + files - pairFiles, row: cell.row + 1 };
}

/** The layer control's three sizes, smallest first: the dark stepper, the one-file stack and the square plate. */
const LAYER_MODES = ['pill', 'column', 'grid'] as const;
export type LayerMode = (typeof LAYER_MODES)[number];

/** The next size along, clamped at both ends: the ladder has a smallest and a biggest rung and
 *  neither wraps, so a person pressing one arrow repeatedly arrives somewhere and stays. */
export function stepLayerMode(mode: LayerMode, dir: -1 | 1): LayerMode {
  const i = LAYER_MODES.indexOf(mode) + dir;
  return LAYER_MODES[Math.min(LAYER_MODES.length - 1, Math.max(0, i))]!;
}

/** One rail glyph without the design's round plate (the group draws its own), as parts in a shared design-px box. */
interface GlyphPart { src: string; x: number; y: number; w: number; h: number }
export interface Glyph { w: number; h: number; ink: GlyphInk; parts: readonly GlyphPart[] }

/** Where a glyph's ink is, measured off a raster, in its own design px; `area` is alpha-weighted coverage. */
export interface GlyphInk {
  /** The ink's bounding box inside the glyph box. */
  x: number; y: number; w: number; h: number;
  /** The ink's centre of mass. */
  gx: number; gy: number;
  /** Covered area, design px squared. */
  area: number;
  /** The eye's correction on `apparentSize`, which discounts area and enlarges sparse drawings beside dense ones. */
  trim?: number;
}

/** Where a drawing balances: halfway between its ink box's middle and its ink's centre of mass. */
export function opticalCentre(ink: GlyphInk): { x: number; y: number } {
  return { x: (ink.x + ink.w / 2 + ink.gx) / 2, y: (ink.y + ink.h / 2 + ink.gy) / 2 };
}

/** How big a drawing reads: the geometric mean of the ink's diagonal and the square root of its area. */
export function apparentSize(ink: GlyphInk): number {
  return Math.sqrt(Math.hypot(ink.w, ink.h) * Math.sqrt(ink.area));
}

const glyph = (ink: GlyphInk, parts: readonly GlyphPart[]): Glyph => ({
  w: Math.max(...parts.map((p) => p.x + p.w)),
  h: Math.max(...parts.map((p) => p.y + p.h)),
  ink,
  parts,
});

/** The rail's glyphs. Redo is undo mirrored: the design's own redo is its spent state, not a glyph. */
export const GLYPHS = {
  undo: glyph(
    { x: 1.25, y: 2, w: 62.62, h: 59.5, gx: 37.3, gy: 32.78, area: 1613.9 },
    [{ src: railUndo, x: 0, y: 0, w: 69, h: 63 }],
  ),
  rotate: glyph(
    { x: 2, y: 1, w: 65, h: 55, gx: 31.15, gy: 28.26, area: 2477.8 },
    [
      { src: railRotateBody, x: 0, y: 0, w: 71, h: 61 },
      { src: railRotateTip, x: 33, y: 13, w: 36, h: 27 },
    ],
  ),
  zoomIn: glyph(
    { x: 5.5, y: 5.25, w: 53.62, h: 74.12, gx: 33.9, gy: 35.56, area: 2491.4 },
    [
      { src: railZoomInLens, x: 0, y: 0, w: 64, h: 82 },
      { src: railZoomInMark, x: 15, y: 15, w: 34, h: 34 },
    ],
  ),
  zoomOut: glyph(
    { x: 5.5, y: 5.25, w: 53.62, h: 74.12, gx: 33.9, gy: 35.63, area: 2491.1 },
    [
      { src: railZoomOutLens, x: 0, y: 0, w: 64, h: 82 },
      { src: railZoomOutMark, x: 15, y: 21, w: 34, h: 21 },
    ],
  ),
  /** The eye the design draws for putting the interface away: one even-odd path, so it has no parts to place. */
  hideUi: glyph(
    { x: 1, y: 2, w: 73, h: 46, gx: 37.82, gy: 25.09, area: 1691.1 },
    [{ src: railHideEye, x: 0, y: 0, w: 76, h: 50 }],
  ),
} as const;

/** The layer stack's drawing (the readout pill's own glyph). Exported here beside the `GLYPHS` so
 *  every picture of the control (the rail, the Help Center's inline art) draws the one file. */
export const LAYERS_STACK_SRC = layersStack;

/** The fit-to-view stroke icon's ink in its own 24-unit box, measured the same way, so the one
 *  glyph the design source never drew is sized and centred by the same rule as the four it did. */
export const FIT_BOX = 24;
export const FIT_INK: GlyphInk = { x: 2.75, y: 2.75, w: 18.5, h: 18.5, gx: 11.94, gy: 11.94, area: 109.9 };

/** The fit icon's correction on the family rule: an open frame of brackets is read by its span alone. */
export const FIT_TRIM = 0.82;
