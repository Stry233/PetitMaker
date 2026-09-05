/**
 * Layout data for chrome around the map. Asset rectangles describe design-space size only;
 * `units.ts` converts them to fixed CSS-pixel edge placement. Mode blocks share an ink baseline,
 * while the assistant occupies a second aligned row and is sized by its visible character art.
 */
import type { BuildMode } from '../../core/model/edit-mode';
import {
  BLOCK_W, BLOCK_W_ON, EDGE_LEFT, EDGE_RIGHT, EDGE_TOP, LABEL_INK_DEPTH, MODE, MODE_PLATE_W,
  MODE_SCALE, RAIL, RAIL_FLOOR,
} from './units';

import modeObject from '../../assets/shell/mode-object/icon.png';
import modeRoad from '../../assets/shell/mode-road/icon.png';
import modeMountain from '../../assets/shell/mode-mountain/icon.png';
import modeWater from '../../assets/shell/mode-water/icon.png';
import modeGenerate from '../../assets/shell/mode-generate/icon.png';
import modeObjectOn from '../../assets/shell/mode-object/icon-pressed.png';
import modeRoadOn from '../../assets/shell/mode-road/icon-pressed.png';
import modeMountainOn from '../../assets/shell/mode-mountain/icon-pressed.png';
import modeWaterOn from '../../assets/shell/mode-water/icon-pressed.png';
import modeGenerateOn from '../../assets/shell/mode-generate/icon-pressed.png';
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

/** A drawing: how big it is in design px, and what it is called. */
export interface FrameArt {
  id: string;
  /** The drawing's file. ABSENT for a control the frame draws itself, which today is the load disc:
   *  the design source's own ring is a thin one and the game's control is a fat translucent disc, so
   *  `LoadMeter` draws the shape rather than placing a picture of the wrong one. */
  src?: string;
  /** i18n key for the accessible name. */
  labelKey: string;
  w: number;
  h: number;
  /**
   * Design px between where the drawing's ink stops and the bottom of its own box, measured off a
   * raster of the file the same way `GlyphInk` is.
   *
   * Only the top-right cluster declares it, because only that cluster is placed by where its ink
   * ENDS. The two block rows are placed by theirs too, but every mode PNG is cropped to its ink on
   * all four sides, so for them the box bottom IS the drawing's and there is nothing to subtract.
   */
  botSlack?: number;
  /**
   * How big the drawing READS in its OWN design px: `apparentSize` over its alpha, measured off a
   * raster of the file.
   *
   * Only the top-right cluster declares it, and it is what that cluster is SIZED by. Three drawings
   * at one box height are three sizes to the eye — a solid disc, a shape that is mostly a notch and a
   * square filled corner to corner do not read alike — so each is given the height that puts this on
   * the frame's utility size (`units.ts:RAIL.topRight`).
   */
  apparent?: number;
  /**
   * What the EYE said about the size the formula arrived at, as a factor on it.
   *
   * `apparentSize` is a heuristic and this is where it is overruled, the way `FIT_TRIM` overrules it
   * for the fit icon. It works between drawings of comparable density and these three are not: it
   * discounts area, so an open shape is read as small and grown, which is exactly how the share
   * anchor came out plainly the biggest thing in the corner while the numbers said all three were
   * 49.3. Kept separate from `apparent` so the measurement stays a measurement.
   */
  trim?: number;
}

/** A block of the top-left row: its resting drawing, plus the heavier one the design draws for the
 *  selected state. The two are different pictures rather than one scaled, so each carries its own
 *  size. */
export interface BlockArt extends FrameArt {
  /** A block is always a picture, never something the frame draws. */
  src: string;
  selected: { src: string; w: number; h: number };
}

/** A build-mode block, named by the mode it arms. */
export interface ModeArt extends BlockArt {
  id: Exclude<BuildMode, null>;
}

/** A drawing at a chosen width, keeping the proportions it was drawn at. */
const atWidth = (drawn: { w: number; h: number }, w: number) => ({ w, h: (drawn.h * w) / drawn.w });

/**
 * The five build modes, left to right as the design lays them out, at the sizes it DRAWS them.
 *
 * They are not laid out at these. Each is one grass cube with a different thing standing on it, so
 * the cube is the unit the row is read by, and a cube's size is its drawing's width — which makes
 * the row even when matching the boxes would not, since the boxes differ in height by up to 25
 * design px and none of that difference is the cube. Four of the five are drawn at the block width
 * and the generator's at 176 / 208, a cube 2.3% bigger than its neighbours' at rest, so `MODES`
 * brings every drawing to the one width rather than passing the export size through.
 */
const MODES_DRAWN: readonly {
  id: ModeArt['id'];
  src: string;
  on: string;
  labelKey: string;
  rest: { w: number; h: number };
  sel: { w: number; h: number };
}[] = [
  { id: 'object', src: modeObject, on: modeObjectOn, labelKey: 'mode.object',
    rest: { w: 172, h: 184 }, sel: { w: 207, h: 212 } },
  { id: 'road', src: modeRoad, on: modeRoadOn, labelKey: 'mode.road',
    rest: { w: 172, h: 190 }, sel: { w: 207, h: 200 } },
  { id: 'mountain', src: modeMountain, on: modeMountainOn, labelKey: 'mode.mountain',
    rest: { w: 172, h: 165 }, sel: { w: 207, h: 187 } },
  { id: 'water', src: modeWater, on: modeWaterOn, labelKey: 'mode.water',
    rest: { w: 172, h: 168 }, sel: { w: 207, h: 200 } },
  { id: 'generate', src: modeGenerate, on: modeGenerateOn, labelKey: 'mode.generate',
    rest: { w: 176, h: 174 }, sel: { w: 208, h: 180 } },
];

/** The five, every drawing at the row's own block width. */
export const MODES: readonly ModeArt[] = MODES_DRAWN.map((art) => ({
  id: art.id,
  src: art.src,
  labelKey: art.labelKey,
  ...atWidth(art.rest, BLOCK_W),
  selected: { src: art.on, ...atWidth(art.sel, BLOCK_W_ON) },
}));

/**
 * The splat that marks the selected mode, drawn behind its block.
 *
 * It is a top-level shape in the design source, wider and deeper than any one block, and `drop` is
 * how far below the shared baseline the design hangs it: the splat is ground the block stands on,
 * not a plate around it.
 */
export const MODE_PLATE = { src: modePlate, w: MODE_PLATE_W, h: 196, drop: 32 } as const;

/**
 * The name the five mode blocks give their splat, so Framer treats it as ONE element moving between
 * them rather than one appearing per block.
 *
 * Shared by exactly the five. The assistant's block wears the same splat but is not a mode, and two
 * elements carrying one `layoutId` at the same time have no single place to be.
 */
export const MODE_PLATE_ID = 'shell-mode-plate';

/** The character, at the size the design draws it: smaller than a mode block, and the same picture
 *  in both states, since the design has no pressed one. */
const CHARACTER = { w: 153, h: 150 };

/**
 * What the character's width is a fraction OF the block width, in each state.
 *
 * It is the one drawing of the six with no cube in it, so there is nothing to hold to the row's
 * shared width, and given that width it reads BIG: a solid animal covers 79% of its own box where a
 * diorama covers 58 to 66, so at one width the character carries a third more ink than the blocks it
 * stands under. `apparentSize` is the measure that sees that, and off a raster of the six drawings
 * it reads, each in its own design px:
 *
 *   resting    object 187.9  road 188.0  mountain 180.5  water 181.6  generate 183.1 | cat 191.0
 *   selected   object 223.3  road 205.9  mountain 208.4  water 210.0  generate 201.4 | cat 229.8
 *
 * So the character is drawn at the width that puts its own reading on the mean of the five — under
 * the block width in both states, and still well over the 153 the design exports it at. The two
 * states take different fractions because the design's pressed blocks are airier than its resting
 * ones while the character is one picture in both.
 */
const CHARACTER_FIT = { rest: 184.22 / 190.96, selected: 209.81 / 229.82 };

/**
 * The assistant's block.
 *
 * It is a block of the same family: the same slot, the same splat behind it when it is the active
 * thing and the same caption under it, growing with its plate as the five do rather than reading as
 * a guest among them.
 */
export const ASSISTANT_BLOCK: BlockArt = {
  id: 'assistant',
  src: assistantCharacter,
  labelKey: 'generate.algo_agent',
  ...atWidth(CHARACTER, BLOCK_W * CHARACTER_FIT.rest),
  selected: { src: assistantCharacter, ...atWidth(CHARACTER, BLOCK_W_ON * CHARACTER_FIT.selected) },
};

/**
 * The left margin both rows keep, in css px.
 *
 * It is the frame's left margin, measured to the DRAWING and not to the box: every block's art
 * fills its box edge to edge, so the two are the same here. That margin is wider than the right one
 * BECAUSE of this row: the splat behind a selected block is drawn wider than the block and centred
 * on it, so the first block's splat reaches into the margin, and a margin narrower than that
 * overhang cuts the splat off at the window (`frame-margins.test.ts`).
 */
export const MODE_ROW_LEFT = EDGE_LEFT;

/**
 * Where the mode row's BOX starts, in css px.
 *
 * The box is exactly as deep as the tallest drawing it holds — the object block's SELECTED art over
 * the shared baseline — so the box top IS that drawing's ink top and this is the margin directly.
 *
 * Measured on the ink that comes CLOSEST to the edge, which is the selected one. Placed on the
 * RESTING drawings instead, as it was, selecting a mode grew its art up out of the row and left 9 px
 * over it where every other cluster kept the frame's margin: the tightest gap in the whole frame,
 * and it only appeared once someone used the thing.
 */
export const MODE_ROW_TOP = EDGE_TOP;

/** The baseline the mode row's blocks stand on. */
export const MODE_ROW_BASE = MODE_ROW_TOP + MODE.height;

/**
 * How far the mode row's own ink reaches BELOW its baseline, in css px, when a mode is selected:
 * the splat that block stands on, and under that the block's name.
 *
 * The name's slot belongs to the row whether or not a mode is naming itself. Reserving it is what
 * keeps the character below from moving when one does, and it is most of the air under the row at
 * rest.
 */
const MODE_ROW_DEPTH = MODE.label.gap + LABEL_INK_DEPTH * MODE.label.size;

/** How far down the mode row's own ink reaches, in css px: the baseline plus the name under it.
 *  What anything standing below the row has to clear (`panel-frame.ts:PANEL_TOP`). */
export const MODE_ROW_INK_BOTTOM = MODE_ROW_BASE + MODE_ROW_DEPTH;

/**
 * Where the assistant's own row starts, in css px.
 *
 * DERIVED, and from the state where the two rows are tightest: a mode selected, so its name hangs
 * into the space between them, and the assistant open, so its drawing is the larger of the two it
 * has. In that state the character's ink stands `MODE.rowClearance` under the name's, and everything
 * else about the number falls out of the drawings' own sizes.
 *
 * It is the BOX this places, and the box is deeper than the character standing in it, so the last
 * term takes that slack back off. Setting the gap to the box, as a constant, is what made one number
 * mean two very different distances depending on which state the frame was in.
 */
export const ASSISTANT_ROW_TOP = MODE_ROW_INK_BOTTOM + MODE.rowClearance
  - (MODE.height - ASSISTANT_BLOCK.selected.h * MODE_SCALE);

/** The centre of the mode row's `i`th block, in css px from the window's left edge. */
export function blockCentre(i: number): number {
  return MODE_ROW_LEFT + i * (MODE.size + MODE.gap) + MODE.size / 2;
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
 * The regional-load disc, save-and-share, and the menu that holds the windows. Sizes only: the
 * cluster is laid out against the top-right corner, in the order given. The disc has no file: it is
 * drawn edge to edge inside its square box, which is what makes it the cluster's deepest ink.
 *
 * THE THREE `trim`S ARE UNEQUAL ON PURPOSE, and bringing them back to one number would undo what
 * they are for. Each was judged by putting the three side by side at rendered size against a plain
 * rail disc and looking, not by evaluating anything:
 *
 *   load  — none. A translucent disc drawn edge to edge in its box, so `apparentSize` already reads
 *           it as a solid disc of that diameter and the formula lands it on a rail button exactly.
 *   menu  — 0.95. A cream disc with three holes punched in it is still a disc, and a person reads it
 *           by its diameter; the formula charges it for the missing area and grows it 5% past the
 *           plain plates it stands with, which shows against the rail directly below.
 *   share — 0.84. The open one, and the reason this field exists. Untrimmed it stands 53 css tall
 *           against 44 for the two discs. Walked down through 0.94 / 0.88 / 0.85 / 0.82: at 0.88
 *           the cradle is still wider than the menu disc and the arrow well over it, at 0.82 it has
 *           gone light. 0.84 puts its cradle at the disc's width and lets the arrow's spike sit a
 *           fraction proud, which is what a spike may do — an extremity carries less weight to the
 *           eye than an edge does.
 */
export const TOP_RIGHT: readonly FrameArt[] = [
  { id: 'load', labelKey: 'hud.region_load', w: 157, h: 157, botSlack: 0, apparent: 175.7 },
  { id: 'share', src: shareButton, labelKey: 'a11y.save_share', w: 130, h: 136, botSlack: 3.8, apparent: 125.9, trim: 0.84 },
  { id: 'menu', src: menuButton, labelKey: 'a11y.open_menu', w: 131, h: 132, botSlack: 1, apparent: 140.5, trim: 0.95 },
];

/** How tall a top-right drawing is rendered, in css px: the height at which its own ink reads the
 *  size a rail button does, times whatever the eye then said about it (`trim`). `apparentSize`
 *  scales with the drawing, so this is one division. */
export function topRightHeight(art: FrameArt): number {
  return ((RAIL.topRight * art.h) / (art.apparent ?? art.h)) * (art.trim ?? 1);
}

/** How far that drawing's ink stops above the bottom of its box, at the height it is drawn. */
export function topRightSlack(art: FrameArt): number {
  return ((art.botSlack ?? 0) / art.h) * topRightHeight(art);
}

/**
 * The corner cluster's own depth, in css px: from the highest ink in it down to the line the three
 * stand on. Each drawing is a different height now, so the box is the deepest of them.
 */
export const TOP_RIGHT_H = Math.max(...TOP_RIGHT.map((art) => topRightHeight(art) - topRightSlack(art)));

/**
 * Where the top-right cluster's box starts, in css px: its ink CENTRED ON THE INK it faces.
 *
 * ALIGN THE INK, NOT THE BOX, and this constant is the reason the rule is written down. The band
 * the mode row occupies is `MODE.height`, which is sized for the SELECTED drawing (212 design px,
 * the tallest thing the row must fit) — and no resting block is that tall. The five rest at 55.6 to
 * 64.1 css of ink, standing on `MODE_ROW_BASE`, so their ink centres land at 67.0 to 71.2. Centring
 * the cluster inside `MODE.height` put its own centre at 63.5: nearly 6 px above every block across
 * from it, which is what "the top right buttons look visually higher" was.
 *
 * Hanging it off the row's BASELINE instead is the other end of the same mistake and was tried
 * first: the cluster is 44 of ink against a block's 55 to 64, so sharing a bottom line drops its top
 * far below theirs and it reads low. Neither box edge is the answer, because the two groups do not
 * share a box — they share a LINE THROUGH THE MIDDLE of what is drawn.
 *
 * So the target is the mean of the resting blocks' own ink centres, and it is DERIVED rather than
 * written: the art's heights are in `MODES` and the row's scale is `MODE_SCALE`, so redrawing a
 * block or rescaling the row moves this with it instead of leaving a stale number behind.
 *
 * The three still share a bottom line with EACH OTHER, which is what makes them read as one group:
 * measured to the INK, per drawing, since each carries its own slack under its own art
 * (`Shell.tsx:Piece`).
 */
const RESTING_INK_CENTRE = MODES.reduce(
  (sum, art) => sum + (MODE_ROW_BASE - (art.h * MODE_SCALE) / 2),
  0,
) / MODES.length;

export const TOP_RIGHT_TOP = RESTING_INK_CENTRE - TOP_RIGHT_H / 2;

/**
 * Where the right-hand column starts: level with the ASSISTANT on the other side of the window.
 *
 * The two are the second row of the frame, one at each edge, and placed against whatever stands
 * above each of them they end up a group's gap apart vertically for no reason at all. Measured off a
 * screenshot diffed against the bare map, the layer plate's ink begins at 128.8 and the character's
 * at 137.6.
 *
 * Ink to ink, not box to box: the plate is a filled pill so its ink IS its box, and the character is
 * a drawing standing at the bottom of a taller slot, so its own top is what `ASSISTANT_INK` reports.
 * It is the RESTING drawing that is matched — the open one is bigger and reaches 7 px higher — since
 * that is the state the frame spends its life in and an open assistant has its whole panel out
 * beside it anyway.
 *
 * It costs the column: the three groups' separation at 1600x900 comes down to 18.7, which is a
 * whisker over the squeezed minimum they are allowed (`RAIL.groupMin`).
 */
export const RAIL_TOP = ASSISTANT_INK.top;

/** The layer stack, which stands where the collapsed control stands: it REPLACES that control
 *  rather than opening under it, so it takes its top edge. */
export const LAYER_PANEL_TOP = RAIL_TOP;

/**
 * Where the collapsed layer control stands, in css px from the window's right edge.
 *
 * CENTRED ON THE BUTTONS, not squared with their right edge. Both shapes are filled drawings whose
 * ink is their box — a 44 px disc fills its square, the stepper is a 28 px stadium — so what a
 * person compares down the column is the two shapes' middles, and squaring the right edges put the
 * narrower one 8 px off that line. The buttons still keep the frame's margin, since the pill now
 * stands entirely inside their span.
 */
export const LAYER_STEP_RIGHT = EDGE_RIGHT + (RAIL.button - RAIL.layer.w) / 2;

/**
 * How much of the collapsed layer count still takes a press, in frame px measured from its RIGHT end,
 * or `null` for the whole of it.
 *
 * The count hangs off the window's right edge and grows LEFTWARD with its word; the assistant's
 * column hangs off the left edge and grows RIGHTWARD with the frame's zoom. So on a window too narrow
 * for both the word is drawn over the panel, and standing at `z.column` over the panel's `z.panel` it
 * takes the presses that land there as well: at 1280x800 and uiZoom 1.8 it covered the panel's gear
 * whole, and the one door to the manage screen, the model and forget-key answered with the layer
 * stack instead.
 *
 * A word cannot move (it is anchored to the edge it reads from) and neither can the column (it is
 * anchored to the block that opens it), so what gives is the HIT TEST: the part of the count standing
 * over the panel is the panel's to answer, and the part clear of it is still the count's. `panelRight`
 * is `null` where no panel is open, and a box nothing has laid out yet (no width) has no collision to
 * settle.
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
/** Undo and redo. */
export const HISTORY_BUTTONS = 2;

/** A group of `n` round buttons broken into `files` files, in css px of depth. */
const foldedHeight = (n: number, files: number) => railStack(Math.ceil(n / files));

/** Where one button of a right-hand group stands in its grid. Both 1-based, as the grid is. */
export interface RailCell {
  column: number;
  row: number;
}

/**
 * Which cell the `i`th button of a group of `count` in `files` files stands in.
 *
 * A FOLDED GROUP FILLS FROM THE RIGHT, so the hole a partial row has is on its LEFT. Everything in
 * this column hangs off the window's right edge and shares it — the buttons, the pair, the layer
 * plate — and the eye tracks that edge straight down the frame. A button left alone in the LEFT cell
 * of its row puts a notch in that edge at the one place a straight line is being read, and the group
 * stops reading as one button short and starts reading as broken. Inside the group there is nothing
 * being lined up against, so that is where the gap belongs.
 *
 * It is a property of the ARRANGEMENT rather than of any one button: WHICH button ends up alone
 * falls out of the count, and the count changes whenever the group gains or loses one.
 *
 * EVERY BUTTON IS PLACED, rather than the odd one being pushed right and the rest left to flow. A
 * button on its way out is still mounted for the length of its exit and auto-placement counts it,
 * so the kit losing its two turns re-flows the row they stood in WHILE they leave: a turn mid-fade
 * jumps a row and a column on its way off. Placed, a button keeps its cell whatever else
 * is in the grid, the only one that moves is the one whose cell the new arrangement changed, and the
 * two may share a cell for the length of the fade — which is what one button leaving as another
 * arrives in its place should look like.
 */
export function railCell(i: number, count: number, files: number): RailCell {
  const orphans = count % files;
  /** The buttons that fill whole rows; the rest are the short last row, right-aligned. */
  const full = count - orphans;
  if (i < full) return { column: (i % files) + 1, row: Math.floor(i / files) + 1 };
  return { column: files - orphans + 1 + (i - full), row: full / files + 1 };
}

/** Fold order for fitting the view kit, history pair, and optional layer panel into one lane. */
export const RAIL_FOLDS: readonly { kit: number; history: number }[] = [
  { kit: 1, history: 1 },
  { kit: 2, history: 1 },
  { kit: 2, history: 2 },
];

/**
 * The three sizes the layer control comes in, smallest first, and the ladder the arrows walk.
 *
 * `pill` is the design source's own dark stepper, `column` is the whole stack in one file with a
 * scrollbar, and `grid` is the square plate. They are one control at three sizes rather than three
 * controls, which is what makes a left and a right arrow the whole of the switching.
 */
export const LAYER_MODES = ['pill', 'column', 'grid'] as const;
export type LayerMode = (typeof LAYER_MODES)[number];

/** The next size along, clamped at both ends: the ladder has a smallest and a biggest rung and
 *  neither wraps, so a person pressing one arrow repeatedly arrives somewhere and stays. */
export function stepLayerMode(mode: LayerMode, dir: -1 | 1): LayerMode {
  const i = LAYER_MODES.indexOf(mode) + dir;
  return LAYER_MODES[Math.min(LAYER_MODES.length - 1, Math.max(0, i))]!;
}

/** Where the right-hand column's groups stand on one window, and where the open plate stands. */
export interface RailPlan {
  /** Files the view kit runs in. */
  kitFiles: number;
  /** Files the history pair runs in: one is the file it prefers, two is the 2x1 row a short window
   *  folds it into. */
  historyFiles: number;
  /** The kit's top, css px from the top of the window. */
  kitTop: number;
  /** The history pair's top. */
  historyTop: number;
  /** Whether the open plate is standing in the column's own lane, which is also the one reason the
   *  pair is anywhere but its resting place. */
  plateInLane: boolean;
  /** The open plate's right edge, css px from the window's right edge. */
  plateRight: number;
  /** The deepest the open plate may draw before it scrolls inside itself. */
  plateMaxH: number;
}

/**
 * Place the right rail within the CSS-pixel run between `RAIL_TOP` and `RAIL_FLOOR`. The first fold
 * that fits the window is the baseline. An open layer panel may request later folds; if none leaves
 * enough lane, the panel moves one file toward the map. History moves only as far as the panel needs.
 */
export function planRail(vh: number, opts: { open: boolean; plateDepth: number }): RailPlan {
  const layerBottom = RAIL_TOP + RAIL.layer.h;
  /** What the two folding groups have to fit in: the run under the layer control, less the two
   *  separations that keep the three reading as three. */
  const run = vh - RAIL_FLOOR - layerBottom - 2 * RAIL.groupMin;
  const fitsRun = (f: { kit: number; history: number }) =>
    foldedHeight(KIT_BUTTONS, f.kit) + foldedHeight(HISTORY_BUTTONS, f.history) <= run;

  /** Where the two groups stand under one rung of the ladder. `yielded` is the lowest the pair may
   *  go, which is also the bottom of the room an open plate could take. */
  const under = (f: { kit: number; history: number }) => {
    const historyH = foldedHeight(HISTORY_BUTTONS, f.history);
    /** The lowest the kit may hang and still leave the pair its own place above it. */
    const kitFloor = layerBottom + 2 * RAIL.groupMin + historyH;
    const kitTop = Math.max(vh - RAIL_FLOOR - foldedHeight(KIT_BUTTONS, f.kit), kitFloor);
    return { historyH, kitTop, yielded: kitTop - RAIL.groupMin - historyH };
  };
  /** Whether the plate clears the pair by a group's separation with the pair as low as it goes.
   *  Asked of the plate's own depth, so a taller stack asks for more room rather than quietly
   *  standing over the pair. */
  const holdsPlate = (f: { kit: number; history: number }) =>
    RAIL_TOP + opts.plateDepth + RAIL.groupMin <= under(f).yielded;

  const required = RAIL_FOLDS.find(fitsRun) ?? RAIL_FOLDS[RAIL_FOLDS.length - 1]!;
  // A rung further down the ladder only for the plate, and only one that actually seats it: every
  // rung after `required` is shallower, so this is the least folding that answers the demand.
  const fold = opts.open
    ? RAIL_FOLDS.slice(RAIL_FOLDS.indexOf(required)).find(holdsPlate) ?? required
    : required;

  const kitFiles = fold.kit;
  const { historyH, kitTop, yielded } = under(fold);
  const resting = (layerBottom + kitTop) / 2 - historyH / 2;
  const plateInLane = opts.open && holdsPlate(fold);
  /** The lowest edge of the plate, plus the separation that keeps the two reading as two groups.
   *  The pair steps down TO THIS and no further: `yielded` is the bottom of the room it could give,
   *  which is what the plate is measured against, but it is not what the plate needs. Handing over
   *  the whole of it put the pair against the kit at every window that seats the plate — including
   *  a tall one with 150 px of slack still in the lane, where the two groups then read as one. */
  const cleared = RAIL_TOP + opts.plateDepth + RAIL.groupMin;

  return {
    kitFiles,
    historyFiles: fold.history,
    kitTop,
    historyTop: plateInLane ? Math.max(resting, cleared) : resting,
    plateInLane,
    plateRight: plateInLane ? EDGE_RIGHT : EDGE_RIGHT + railStack(kitFiles) + RAIL.groupMin,
    // In the lane, all the room the pair can yield; beside it, the run down to the column's own
    // floor. Where the pair actually stands is `historyTop`, which is this or less.
    plateMaxH: plateInLane ? yielded - RAIL.groupMin - RAIL_TOP : vh - RAIL_TOP - RAIL_FLOOR,
  };
}

/**
 * One glyph of the right-hand groups: the drawing WITHOUT the round plate the design source drew it
 * on, since here it sits on a round plate the group draws. Several are more than one shape,
 * so a glyph is a list of parts with a shared box: `x`/`y` are inside that box, in design px.
 */
export interface GlyphPart { src: string; x: number; y: number; w: number; h: number }
export interface Glyph { w: number; h: number; ink: GlyphInk; parts: readonly GlyphPart[] }

/**
 * Where a drawing's INK actually is, measured off a raster of the composed glyph rather than read
 * off its layer rects. A shape is rarely centred in the box it was drawn in and its box says
 * nothing about how much of it is filled, so a row sized and centred on boxes comes out with each
 * glyph a different apparent size, sitting a different distance from the middle of its button.
 *
 * All of it in the glyph's own design px. `area` is the alpha-weighted coverage, so a hollow ring
 * and a solid disc of the same span are not the same number.
 */
export interface GlyphInk {
  /** The ink's bounding box inside the glyph box. */
  x: number; y: number; w: number; h: number;
  /** The ink's centre of mass. */
  gx: number; gy: number;
  /** Covered area, design px squared. */
  area: number;
  /** What the EYE said about the size the formula arrived at, as a factor on it: `apparentSize`
   *  discounts area, so a sparse drawing beside dense neighbours comes out enlarged (lettering next
   *  to filled figures). Kept apart from the measurements so they stay measurements. */
  trim?: number;
}

/**
 * Where a drawing balances: halfway between the middle of its ink and the ink's centre of mass.
 *
 * The bounding box alone ignores which side the weight is on. The centre of mass alone over-corrects
 * for a long thin tail, which would shove the magnifier's lens off-centre to make room for a handle
 * that carries almost none of the drawing.
 */
export function opticalCentre(ink: GlyphInk): { x: number; y: number } {
  return { x: (ink.x + ink.w / 2 + ink.gx) / 2, y: (ink.y + ink.h / 2 + ink.gy) / 2 };
}

/**
 * How big a drawing READS, in the units its parts are given in: the geometric mean of the ink's
 * diagonal and the square root of its area.
 *
 * Extent alone lets a dense ring out-shout a sparse arrow of the same span; area alone shrinks an
 * open drawing to nothing. Normalising this across a family is what makes a row of glyphs look like
 * one set, where matching their box heights does not.
 */
export function apparentSize(ink: GlyphInk): number {
  return Math.sqrt(Math.hypot(ink.w, ink.h) * Math.sqrt(ink.area));
}

const glyph = (ink: GlyphInk, parts: readonly GlyphPart[]): Glyph => ({
  w: Math.max(...parts.map((p) => p.x + p.w)),
  h: Math.max(...parts.map((p) => p.y + p.h)),
  ink,
  parts,
});

/**
 * The rail's glyphs.
 *
 * There is no `redo`: the design source drew that arrow greyed out, at 73% over a light grey, which
 * is its spent state and not a glyph — used as one it puts a washed-out arrow beside a solid one.
 * The drawing is `undo` mirrored to within half a design px, so the pair is one drawing and cannot
 * come out at two weights.
 */
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
  /** The eye the design source draws for putting the interface away (`侧边栏/隐藏`). It is ONE
   *  shape — outline and pupil in a single even-odd path — so unlike its neighbours it has no parts
   *  to place. */
  hideUi: glyph(
    { x: 1, y: 2, w: 73, h: 46, gx: 37.82, gy: 25.09, area: 1691.1 },
    [{ src: railHideEye, x: 0, y: 0, w: 76, h: 50 }],
  ),
} as const;

/** The layer stack's drawing (the readout pill's own glyph). Exported here beside the GLYPHS so
 *  every picture of the control (the rail, the Help Center's inline art) draws the one file. */
export const LAYERS_STACK_SRC = layersStack;

/** The fit-to-view stroke icon's ink in its own 24-unit box, measured the same way, so the one
 *  glyph the design source never drew is sized and centred by the same rule as the four it did. */
export const FIT_BOX = 24;
export const FIT_INK: GlyphInk = { x: 2.75, y: 2.75, w: 18.5, h: 18.5, gx: 11.94, gy: 11.94, area: 109.9 };

/**
 * The fit icon's own correction, on top of the family rule.
 *
 * It is four corner brackets: a hollow square carrying a fifth of the ink the solid drawings beside
 * it do, over the same span. `apparentSize` weighs that area, reads the drawing as small, and scales
 * it UP — which is how the one glyph meant to match the rail came out the widest thing on it. An
 * open frame is read by its span alone, so this brings its span back to the family's, where the
 * area term would leave it a fifth over.
 */
export const FIT_TRIM = 0.82;
