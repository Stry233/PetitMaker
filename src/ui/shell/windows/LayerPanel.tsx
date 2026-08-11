/*
 * LayerPanel.tsx — what the layer count opens: the WHOLE stack, every floor at once.
 *
 * The design source draws only the collapsed control, so the panel is drawn in the interface's own
 * language rather than traced: a filled cream plate, ink type, and the floor being built on marked
 * in the shared yellow.
 *
 * THE CONTROL COMES IN THREE SIZES AND THIS FILE DRAWS TWO OF THEM (`frame.ts:LAYER_MODES`). The
 * pill is the design's own dark stepper and lives in `Rail.tsx`; `column` is the stack in one file,
 * scrolling; `grid` is the square plate. They are ONE control at three sizes, not three panels: the
 * same nine floors, the same head, and one number decides how many of them stand on a row.
 *
 * A PRESS ON THE COUNT OPENS THE FILE, AT EVERY WINDOW. The three sizes are a LADDER and the count
 * is its bottom rung, so the way in is the way the arrows go: pill, file, square. Opening on
 * whichever of the two the window had room for made one press give two different panels — the
 * middle rung was skipped on a tall monitor and was the only rung on a laptop, and the file could
 * then only be reached by pressing BACK to it. What the window decides is where the plate STANDS
 * once it is open (`frame.ts:planRail`), which is a different question and is answered below.
 *
 * A TILE'S LAYOUT IS A FACT ABOUT ITS SIZE, because the two sizes are short of different things.
 * The square is three floors deep whatever a tile costs and has no width to spare, so its floors
 * keep the roomier THREE lines the panel was drawn with: the name, the count with the eye and the
 * lock, then the bar, at 80.5 css px a floor. The file's floors stand one above another, so depth
 * is the thing it pays nine times over and width is what it has: everything a floor says in words
 * shares ONE line there and the bar has the other, at 40 css px a floor. Giving the square the
 * file's crowded line so that one number could serve both took it from 415 css px wide to 622, which
 * is a third of the island behind an opaque plate to save a size that was not short of depth. Measured in the
 * browser over a generated island: the square is 415 x 323 and the file is 228 x 285.5.
 *
 * THE FILE IS SHORT AND IT SCROLLS, AND THAT IS ITS ORDINARY STATE. It draws FIVE of the nine
 * floors (`FILE_FLOORS`). Drawing all nine made the LOWER rung of the ladder the DEEPER plate — 470
 * against the square's 323 — so stepping up shrank the panel, and a plate that deep is in the
 * column's lane on no window at all. Where the lane can give less even than five floors, the plate
 * takes what it can give and scrolls inside that: the height follows the room rather than the room
 * being asked to follow the height. So the scrollbar is a fact about the SIZE now — the file has
 * something to scroll to everywhere, and the square only where the lane cannot hand it its 323.
 *
 * THE HEAD DOES NOT SCROLL WITH THE FLOORS. It carries the layer-numbers toggle and the two size
 * arrows, which are the panel's own controls rather than part of the stack, and a control that
 * leaves the plate as the visitor reads down it is a control they have to scroll back for. So the
 * plate is a column of two: the head, and a box that scrolls. It is NOT a sticky head — a sticky
 * element's offsets are measured from the scrollport's own edge, so it would pin over the plate's
 * padding and ride its rounded corner, and it would be inside the projection Framer scrolls when
 * the two sizes travel.
 *
 * ONE CONTROL AT EITHER END OF IT. The two things on the head are unrelated — what the MAP shows,
 * and what size THIS PANEL is — so the numbers toggle takes the left and the panel's own pair takes
 * the right, which is the end the plate hangs off and the end the way back walks toward. They are
 * drawn in one box: two controls at the two ends of a row read as a pair whatever they do, and the
 * `#` at its own narrower size read as the lesser of the two.
 *
 * EVERY FLOOR IS THERE, WHETHER OR NOT ANYTHING STANDS ON IT. The stack is `ELEVATION_MAX` floors
 * over the ground and that is a fact about the map, not about what has been built yet, so the panel
 * lists all of them and the panel is one size for the life of a session. A list that grew a row each
 * time a taller block was laid moved the rows under the pointer and told the visitor how high they
 * had built, which the counts already say.
 *
 * BOTH SIZES READ UPWARD, BY ONE RULE (`colsOf`). The rows are filled from the GROUND up and drawn
 * in reverse, so the bottom row is the bottom of the stack, every floor in a row stands above every
 * floor in the row under it, and each row itself reads left to right the way the language it is
 * written in does. Any floors left over land in the TOP row, where the stack runs out, which is
 * where the empty slots go. At three columns that is the square (nine floors over the ground is
 * exactly three by three); at one it is the stack read straight down. Two arrangements, no branch.
 *
 * The square costs one thing the file does not: two of its eight steps are a carriage return, up and
 * back to the left. It buys the whole stack under the eye at once, which is what the arrow into the
 * map is for.
 *
 * COUNTS ARE CUMULATIVE (`state/map-stats`): terrain at layer 3 is standing on layers 1 and 2, so it
 * is counted on all three. The panel does not say so in words. A line of copy explaining an
 * arithmetic that the bars beside it already draw is a line every visitor reads once and then reads
 * past forever, and it was the widest thing on the plate.
 *
 * IT IS ONE OF THE COLUMN'S OWN ELEMENTS AND IT IS PLACED WITH THEM. Where it stands is not decided
 * here: `frame.ts:planRail` lays out the whole right-hand side in one pass and hands this its right
 * edge and its depth, so the plate takes its turn in the lane the same way the pair and the view kit
 * do. It never stands over a button. A plate is opaque and covering six controls with it leaves six
 * controls nobody can press, whatever keys they also answer to.
 *
 * WHICH MEANS IT IS SOMETIMES IN THE LANE AND SOMETIMES BESIDE IT, and the arithmetic is worth
 * writing down because it is what rules the alternatives out. In the px the frame is laid out in:
 * the plate hangs from the layer control's top edge at 138 and the square stands `PLATE_DEPTH` (323)
 * deep. The column runs from there to the bottom shelf's plate, and the eight round buttons under it
 * come to 424 with their own separations. On a 1600x900 window that run is 489, so whatever is done
 * with the pair there leaves at most 47 px of room above it, which is a head with no stack under it
 * — and bottom-packing both groups at the view kit's shorter 2D height would buy 153, at the cost of
 * the kit's one screen position across a 2D/3D switch. The FILE joins the lane from about 933 device
 * px of window height and the square from about 980, each by folding the kit into two files up to
 * about 1197 and 1244 and by needing no fold above that; there the plate keeps the buttons' own
 * right edge and the pair steps down under it. Below that the plate steps out of the lane by one
 * file of buttons and a group's separation, which is 62 px and leaves the column exactly where it
 * was.
 *
 * WHAT IT WILL NOT DO IS STAND ON THE BOTTOM SHELF. The plate stops where the column stops
 * (`RAIL_FLOOR`) and draws inside that, which is the same edge the view kit hangs off. That bound
 * bites under about 645 device px of window height for the file and 692 for the square, and there
 * it is the plate's own height that gives.
 *
 * IT REPLACES THE CONTROL AND IT STAYS. Nothing closes it but the visitor: no outside click, no
 * escape. A stack you are working against is a thing to leave up beside the map, and a panel that
 * vanished when the pointer went to the map would be a panel you could not use.
 *
 * THE RIGHT ARROW IS THE WAY BACK, and it inherits everything that made the count findable. It is
 * the same filled yellow pill as the collapsed control, at the same size: the arrows are a size
 * ladder and the pill is its bottom rung. The active floor's name is not the control — that would
 * say twice what the marked tile on the plate already says. And whatever stands there has to look
 * pressable before it has to be anything else: styled as type, a way out is the way out nobody
 * finds.
 *
 * It is the RIGHT one because of where the panel is, not because of where it sits in the ladder.
 * The plate hangs off the window's right edge and grows leftward, so the arrow pointing into the
 * map is the one that opens it and the arrow pointing at the edge is the one that puts it away
 * (`SizeArrow`).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ELEVATION_COLORS, ELEVATION_MAX } from '../../../core/model/constants';
import { isBuildableZone } from '../../../core/model/grid-model';
import type { GridState } from '../../../core/model/types';
import { useT } from '../../../i18n/context';
import { getActiveLayers } from '../../../state/layer-utils';
import { subscribeMapStats } from '../../../state/map-stats';
import { useEditorStore } from '../../../state/store';
import { IconChevronLeft, IconChevronRight } from '../glyph-icons';
import { layerName } from '../layer-name';
import { iconUrl } from '../../primitives/icons';
import { useScrollFade } from '../../primitives/scroll-fade';
import { btnReset, cursors, pressable, pressOnly, springs, z } from '../../design/styles';
import { LAYER_PANEL_TOP, stepLayerMode, type LayerMode } from '../frame';
import { cssMotion, useMotion } from '../motion/use-motion';
import { frameZoomAttr } from '../motion/zoom-corrected-radius';
import { ACTIVE, INK, INSET, PANEL_EDGE, PANEL_EDGE_WIDTH, PLATE, PLATE_INK, TRACK } from '../../design/tokens';
import { TEXT } from '../units';
import { useFrameZoom, useZoomedLayoutTransform } from '../use-frame-zoom';

/** How long a refusal holds the tint on the locked tiles before it fades.
 *
 *  A brush dragged over a locked layer is refused dozens of times a second. The tint fades in on
 *  the first refusal and is EXTENDED by every one after it, so the drag shows one steady tint
 *  rather than restarting the fade at each refusal, which strobes. */
const LOCK_HOLD_MS = 550;
/** How strongly a locked tile is tinted while its paints are being refused. */
const LOCK_TINT = 0.42;
/** The red a refusal tints with, the same one the error toasts carry. */
const LOCK_RED = '#ff6b6b';

/**
 * The plate's own sizes, in css px, and they live with the panel. `units.ts` holds what more than
 * one part of the frame stands on; nothing outside this file reads a single one of these.
 *
 * THESE ARE THE PLATE'S AND NOT A TILE'S, which is why they are one set for both sizes: the head is
 * the same row of controls at either width and the air around the stack is the plate's own margin.
 * What differs between the two sizes is the tile, and that lives in `TILE` a size at a time.
 *
 * JUDGED AT SIZE against a generated island, which is the only state that shows the problem: on an
 * empty map every count is a single 0 and nothing is tight. A real ground floor carries five
 * figures, and it was those five that ran into the eye and the lock.
 */
const PANEL = {
  /** Inside the plate's own edge. */
  pad: 12,
  /** The plate's hairline, in css px. Counted in `plateDepth` because the plate is `border-box`:
   *  the edge comes out of the height the column hands it, not off the outside of it. */
  edge: PANEL_EDGE_WIDTH,
  /** The air between the head and the first floor. Its own number rather than `pad` again: the head
   *  is a row of controls and the floors are the subject, so what separates them is not the same
   *  thing as what holds the subject off the plate's edge. */
  headGap: 10,
  /** Above and below the mark on a head pill, and either side of it. Both head controls take them,
   *  so the two ends of the head are one drawn size and neither outweighs the other. */
  headPadY: 5,
  headPadX: 9,
  /** The mark inside one: a chevron's drawn box, which the `#` also holds as its minimum. The two
   *  controls are read as a pair standing at the two ends of one row, so the narrower GLYPH must
   *  not make the narrower BUTTON — measured in the browser, `#` came out 25 css px against the
   *  arrows' 33. */
  headGlyph: 15,
  /** Between the two size arrows, which are a PAIR and so stand closer to each other than either
   *  does to the layer-numbers toggle beside them. */
  arrowGap: 5,
  /** The plate's own corner, in the frame's px like every other length here. */
  radius: 20,
} as const;

/** What one floor's tile is built out of. Every length in css px. */
interface TileMetrics {
  padX: number;
  padY: number;
  /** Between two lines of one tile. */
  line: number;
  /** Between the band's chip and the floor's name, which is the chip's caption. */
  swatchGap: number;
  /** Between the count and whatever else shares its line: different kinds of thing, so they are
   *  separated by more than any one of them is internally. */
  readingGap: number;
  /** Between the eye and the lock, which ARE a pair and so sit closer than either does to the
   *  figure. */
  toggleGap: number;
  /** The band's colour, as a chip at the head of the tile. */
  swatch: number;
  /** Room for five figures, which is what a real island's ground floor carries, so the toggles hold
   *  their column across the whole stack and from one map to the next. */
  count: number;
  icon: number;
  /** The share bar's thickness, drawn the full width of the tile's content. */
  bar: number;
  radius: number;
  /** Between two tiles. Wide enough that the stack reads as separate floors, since a tile has no
   *  outline: the only thing marking one is that its own lines are closer together than the next
   *  tile is. So it follows the tile's depth rather than being one number for both sizes. */
  gap: number;
}

/**
 * One floor's tile, PER SIZE, because the two sizes are not short of the same thing.
 *
 * THE SQUARE HAS WIDTH TO SPARE AND DEPTH TO SPEND. It is three floors deep whatever the tile costs,
 * so a floor there gets the roomy three-line tile the panel was drawn with: its name, then its count
 * with the eye and the lock, then the bar, at the paddings that let three lines read as three.
 *
 * THE FILE IS THE NARROW ONE, and the one trade it can afford is depth for width. Its floors stand
 * one above another, so what a tile costs in depth it costs nine times over; it has room sideways
 * that the square does not need. So the name, the count, the eye and the lock share ONE line there
 * and the paddings come down with them, which is 40 css px a floor against the square's 80.5.
 *
 * The bar keeps its own line at BOTH sizes. It is the one thing on a tile that is a PICTURE of a
 * quantity rather than a statement of one, it is read down the stack as the island's profile, and a
 * bar squeezed into what a row of words leaves over is a bar too short to compare with the floor
 * above it.
 *
 * A tile is as wide as its widest line and they are all one width, so what sets a size's width is
 * its longest line: a floor's NAME in the current language, plus — in the file — the count and the
 * two toggles beside it.
 */
const TILE: Record<'grid' | 'column', TileMetrics> = {
  grid: {
    padX: 12, padY: 10, line: 8, swatchGap: 7, readingGap: 12, toggleGap: 5,
    swatch: 13, count: 38, icon: 22, bar: 8, radius: 14, gap: 10,
  },
  column: {
    padX: 11, padY: 5, line: 4, swatchGap: 6, readingGap: 10, toggleGap: 4,
    swatch: 12, count: 38, icon: 20, bar: 6, radius: 12, gap: 6,
  },
};

/** Which tile a size draws. The pill draws none, and takes the file's, since the file is what the
 *  count opens into. */
const tileOf = (mode: LayerMode): TileMetrics => (mode === 'grid' ? TILE.grid : TILE.column);

/** Every floor the map can hold, which is what both sizes list. */
const FLOORS = ELEVATION_MAX + 1;

/**
 * How many floors a row holds, per size.
 *
 * The square is the stack laid out as square as it goes: nine floors over the ground come out three
 * by three, which is what the plate is for. It is not written as three — the stack is `FLOORS` deep
 * and the grid follows that constant, so a taller map gets a bigger square rather than a row that
 * runs off the plate. The file is one, which is what makes it narrow enough to open on a window
 * that cannot afford the square.
 */
const GRID_COLS = Math.ceil(Math.sqrt(FLOORS));
const colsOf = (mode: LayerMode) => (mode === 'grid' ? GRID_COLS : 1);
/** Every row the whole stack takes at this size, showing or not. */
const rowsOf = (mode: LayerMode) => Math.ceil(FLOORS / colsOf(mode));

/** One tile's depth, which follows its LAYOUT and so follows the size: the square stacks the name,
 *  the count with its toggles and the bar; the file puts the words on one line and the bar on the
 *  other. A line is as tall as the tallest thing standing on it, which where a toggle stands is the
 *  toggle rather than the type. */
function tileDepth(mode: LayerMode): number {
  const tile = tileOf(mode);
  const words = mode === 'grid'
    ? TEXT.tab + tile.line + tile.icon
    : Math.max(tile.icon, TEXT.tab);
  return 2 * tile.padY + words + tile.line + tile.bar;
}

/** What a plate drawing `rows` rows of floors at this size comes to: the head, the rows, and the
 *  plate's own air and edge. */
function depthOf(mode: LayerMode, rows: number): number {
  return 2 * PANEL.edge + PANEL.pad + (2 * PANEL.headPadY + TEXT.head) + PANEL.headGap
    + rows * tileDepth(mode) + (rows - 1) * tileOf(mode).gap + PANEL.pad;
}

/** What the whole stack takes at this size, every floor showing. Deeper than the plate draws
 *  wherever `plateDepth` shows fewer rows than the stack has, which is what the file scrolls. */
function fullDepth(mode: LayerMode): number {
  return depthOf(mode, rowsOf(mode));
}

/** The square, which is three rows of three and shows all nine floors at once. */
const SQUARE_DEPTH = fullDepth('grid');

/**
 * HOW MANY FLOORS THE FILE SHOWS BEFORE IT SCROLLS, and it is derived rather than picked: as many
 * whole floors as stand inside the square's own depth.
 *
 * THE FILE MUST NOT BE THE DEEPER OF THE TWO SIZES. It is the lower rung of the ladder and it is
 * what a press on the count opens, so a file hanging further down the window than the square does
 * is a ladder that grows downward as it steps up. Showing every floor is what made it that: ten
 * two-row tiles and a head are 470 css px against the square's 323, and a plate that deep is in the
 * column's lane on no window at all.
 *
 * So the file SCROLLS as its normal state rather than as a short window's accident. The stack is
 * nine floors over the ground at both sizes and the file is a window onto it; what a shorter plate
 * costs is how much of the stack is under the eye at once, which is exactly what the square is one
 * press away for.
 */
function fileFloorsWithin(depth: number): number {
  let floors = 1;
  while (floors < FLOORS && depthOf('column', floors + 1) <= depth) floors++;
  return floors;
}
const FILE_FLOORS = fileFloorsWithin(SQUARE_DEPTH);

/** How many rows of floors a size actually draws: the square shows the whole stack, the file shows
 *  `FILE_FLOORS` of it. */
const shownRows = (mode: LayerMode) => (mode === 'grid' ? rowsOf(mode) : FILE_FLOORS);

/**
 * How deep a size draws, in css px, and it is DECLARED because the column has to place it.
 *
 * The rail plans the whole right-hand side against this (`frame.ts:planRail`), so it cannot be
 * measured off the rendered plate: where the plate stands is decided before there is one. It does
 * not vary with the language either — a longer floor name widens a tile's equal track, it does not
 * add a line to it — which is what makes one number honest for all seven.
 *
 * It is the size's NATURAL depth, the one it draws at when something can hold it, and for the file
 * that is already fewer floors than the stack has (`FILE_FLOORS`). The plan reads this, decides
 * whether the lane can hold it, and hands back the depth the window CAN give; the panel draws at
 * whichever is less and scrolls whatever does not fit.
 */
export function plateDepth(mode: LayerMode): number {
  return depthOf(mode, shownRows(mode));
}

/** The square plate's depth, which is what the column plans the whole right-hand side against. */
export const PLATE_DEPTH = plateDepth('grid');

/** The stack as the panel shows it: every floor, with how full of the map it is. */
interface Row {
  elevation: number;
  name: string;
  count: number;
  /** How much of the island this floor covers, 0..1. See `capacityOf`. */
  share: number;
}

/**
 * What a floor's bar is measured AGAINST: how many cells of this map could be built on at all.
 *
 * ABSOLUTE, not relative. A bar drawn against the biggest count on the map says nothing on its
 * own: on an island with one broad ground floor every bar above it is a sliver, on an empty map
 * all nine are equal, and the same floor of the same map draws differently depending on what was
 * built somewhere else. Against the map's own buildable area the
 * bars are one picture of the island's profile — how much of it is covered at each height — and one
 * floor's bar means the same thing on Monday as on Friday.
 *
 * It is the BUILDABLE cells and not `width × height`. Sea, beach, boundary and the plaza refuse
 * every edit (`isBuildableZone`, which is the one place that fact lives), so they are not capacity:
 * measured against the whole template a completely covered floor would still stop a third of the way
 * along its track, and the bar would be unable to say "full" at all.
 *
 * A TEMPLATE FACT, so this walks once per map: zones are fixed when the grid is built and no edit
 * touches them.
 */
function capacityOf(state: GridState): number {
  let cells = 0;
  for (const row of state.cells) for (const cell of row) if (isBuildableZone(cell.zone)) cells++;
  // A map with nothing buildable on it divides by one rather than by nothing; every count on such a
  // map is zero anyway, so the bars are empty either way.
  return Math.max(1, cells);
}

/** The eye and the lock, in their brown variants: the plate is cream, so the white ones a smoked
 *  card would take are not readable here. */
function TileToggle({ icon, label, testId, size, onPress }: {
  icon: string;
  label: string;
  testId: string;
  size: number;
  onPress: () => void;
}) {
  return (
    <motion.button
      type="button"
      {...pressable}
      aria-label={label}
      data-testid={testId}
      onClick={onPress}
      style={{
        ...btnReset,
        width: size, height: size, flex: 'none',
        // A soft square around a small drawing. The frame's own `FOCUS_SHAPE_RADIUS` clamps to half
        // a box this size, which would ring an eye and a lock as discs.
        borderRadius: 6,
        // The tile's own press target is the plate underneath, which the content lets through; a
        // toggle is the exception that takes its own press back.
        pointerEvents: 'auto',
        cursor: cursors.clickable, display: 'flex',
      }}
    >
      <img src={iconUrl(icon)} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
    </motion.button>
  );
}

/** A floor: what is on it, how much of the map that is, and whether it is shown and unlocked.
 *
 *  The plate under it is what selects the floor, drawn as a box of its own behind the content rather
 *  than around it, so the eye and the lock can sit INSIDE a press target without a button nested in
 *  a button.
 *
 *  IT TRAVELS BETWEEN THE TWO SIZES. The nine floors are the same nine floors in the file and in the
 *  square, only on a different number of rows and in a different tile, so each one animates from
 *  where it was to where it now is (`layout`). It re-measures on the SIZE and on nothing else
 *  (`layoutDependency`): the panel re-renders on every paint the map takes and on every step of a
 *  UI-zoom tween, and a tile that measured itself then would animate a change that is not a change.
 *
 *  A SHAPE CHANGES SHAPE; WHAT IS WRITTEN ON IT ONLY MOVES. Framer projects a layout animation as a
 *  SCALE on the box, which every child inherits, so a tile left with plain children stretches its
 *  name, its figure and its icons like a bitmap being resized — the two sizes are different widths
 *  and different depths, so the distortion is on both axes. The rule this file follows is the
 *  standard one: a box whose SHAPE changes carries `layout` and the content standing in it carries
 *  `layout="position"`, which corrects the inherited scale and leaves the child travelling. So the
 *  tile, the selection plate behind it, the content column and the bar's track all animate their
 *  own shape, and the name, the figure and the toggles are carried between the two arrangements at
 *  the size they are drawn at. */
function LayerTile({ row, mode, active, visible, locked, refused }: {
  row: Row;
  mode: LayerMode;
  active: boolean;
  visible: boolean;
  locked: boolean;
  refused: boolean;
}) {
  const t = useT();
  const resize = useMotion('layer.mode.resize');
  const zoomed = useZoomedLayoutTransform();
  const zoom = useFrameZoom();
  const selectLayer = useEditorStore((s) => s.selectLayer);
  const setLayerVisibility = useEditorStore((s) => s.setLayerVisibility);
  const setLayerLocked = useEditorStore((s) => s.setLayerLocked);
  const band = ELEVATION_COLORS[row.elevation] ?? ELEVATION_COLORS[0]!;
  const ink = active ? INK : PLATE_INK;
  const tile = tileOf(mode);
  const stacked = mode === 'grid';
  const behind: CSSProperties = { position: 'absolute', inset: 0, borderRadius: tile.radius };
  /** The shared props of every box on the tile whose SHAPE changes with the size. The zoom is
   *  declared for the same reason the transform template is applied: both are the frame's own px
   *  meeting a projection measured in the page's, one for the travel and one for the corner. */
  const shape = {
    layout: true as const, layoutDependency: mode, transition: resize, transformTemplate: zoomed,
    ...frameZoomAttr(zoom),
  };
  /** And of every piece of content standing in one, which travels at its own size. */
  const carried = { ...shape, layout: 'position' as const };

  const nameGroup = (
    <motion.div
      {...carried}
      style={{ display: 'flex', alignItems: 'center', gap: tile.swatchGap, ...(stacked ? {} : { flex: 1 }) }}
    >
      <span
        style={{
          width: tile.swatch, height: tile.swatch, borderRadius: 4, flex: 'none',
          background: band, opacity: visible ? 1 : 0.35,
        }}
      />
      <span style={{ fontSize: TEXT.tab, fontWeight: 800, color: ink }}>{row.name}</span>
    </motion.div>
  );
  const countFigure = (
    <motion.span
      {...carried}
      data-testid={`shell-layer-count-${row.elevation}`}
      style={{
        minWidth: tile.count,
        // In the square it stands at the head of its own line and takes the slack, so the toggles
        // hold the tile's right edge; in the file the name has taken it already, so the figure sits
        // against the toggles and is read off its right edge.
        ...(stacked ? { flex: 1 } : { textAlign: 'right' as const }),
        fontSize: TEXT.small, fontWeight: 800, color: ink, fontVariantNumeric: 'tabular-nums',
      }}
    >
      {row.count}
    </motion.span>
  );
  // The eye and the lock are a PAIR and sit closer to each other than either does to the figure,
  // which is a different kind of thing standing on the same line.
  const toggles = (
    <motion.div {...carried} style={{ display: 'flex', alignItems: 'center', gap: tile.toggleGap }}>
      <TileToggle
        icon={`${visible ? 'eye-open' : 'eye-closed'}-selected`}
        label={t('a11y.toggle_visibility')}
        testId={`shell-layer-eye-${row.elevation}`}
        size={tile.icon}
        onPress={() => setLayerVisibility(row.elevation, !visible)}
      />
      <TileToggle
        icon={`${locked ? 'lock' : 'unlock'}-selected`}
        label={t('a11y.toggle_lock')}
        testId={`shell-layer-lock-${row.elevation}`}
        size={tile.icon}
        onPress={() => setLayerLocked(row.elevation, !locked)}
      />
    </motion.div>
  );
  const lineStyle: CSSProperties = {
    display: 'flex', alignItems: 'center', gap: tile.readingGap, lineHeight: 1, whiteSpace: 'nowrap',
  };

  return (
    <motion.div
      {...shape}
      style={{ position: 'relative', padding: `${tile.padY}px ${tile.padX}px` }}
    >
      <motion.button
        {...shape}
        type="button"
        aria-label={row.name}
        aria-pressed={active}
        data-testid={`shell-layer-row-${row.elevation}`}
        // Pressing the pinned floor again lets go of it, and the water brush is free to follow the
        // ground again. The row that pins is the row that unpins: a pin nothing can release is a
        // trap, and this needs no second control to escape it.
        onClick={() => selectLayer(row.elevation)}
        onPointerEnter={(e) => { if (!active) e.currentTarget.style.background = INSET; }}
        onPointerLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
        style={{ ...btnReset, ...behind, background: active ? ACTIVE : 'transparent', cursor: cursors.clickable }}
      />
      {locked ? (
        <motion.span
          {...shape}
          aria-hidden
          data-testid={`shell-layer-refused-${row.elevation}`}
          style={{
            ...behind, background: LOCK_RED, pointerEvents: 'none',
            opacity: refused ? LOCK_TINT : 0,
            // Arrives fast and leaves slowly, so a drag along a locked layer shows one steady tint
            // and its end is still readable as an end. A plain CSS transition, which
            // `animations.css` collapses under the reduced-motion attribute with no work here.
            transition: `opacity ${refused ? 120 : 350}ms ease-out`,
          }}
        />
      ) : null}
      <motion.div
        {...shape}
        style={{
          position: 'relative', display: 'flex', flexDirection: 'column', gap: tile.line,
          // The plate behind takes the press; only the two toggles take it back.
          pointerEvents: 'none', userSelect: 'none',
        }}
      >
        {stacked ? (
          <>
            {/* THE SQUARE STACKS WHAT THE FLOOR SAYS: its name, then how much stands on it with the
                two toggles beside the figure. It has the depth for three lines and no width to
                spare, which is the opposite of the file's problem. */}
            <motion.div {...shape} data-testid={`shell-layer-line-${row.elevation}`} style={lineStyle}>
              {nameGroup}
            </motion.div>
            <motion.div {...shape} style={lineStyle}>
              {countFigure}
              {toggles}
            </motion.div>
          </>
        ) : (
          /* THE FILE PUTS ALL OF IT ON ONE LINE: the band's chip, the name, how much stands on it
             and the two toggles. Three groups rather than five items, since what is tight to what
             is the whole of the reading order here — the chip belongs to the name and the eye
             belongs to the lock, and the count belongs to neither pair. */
          <motion.div {...shape} data-testid={`shell-layer-line-${row.elevation}`} style={lineStyle}>
            {nameGroup}
            {countFigure}
            {toggles}
          </motion.div>
        )}
        <motion.span
          {...shape}
          style={{ height: tile.bar, borderRadius: tile.bar / 2, background: TRACK, overflow: 'hidden' }}
        >
          <span
            data-testid={`shell-layer-bar-${row.elevation}`}
            style={{
              display: 'block', height: '100%', borderRadius: tile.bar / 2, background: band,
              // A floor holding a handful of cells out of thousands is a fraction of a pixel, and a
              // bar that is not there reads as a count of nothing. An empty floor keeps an empty
              // track.
              width: row.count > 0 ? `max(4px, ${row.share * 100}%)` : 0,
            }}
          />
        </motion.span>
      </motion.div>
    </motion.div>
  );
}

/**
 * Bring a tinted tile into view, if the box the floors stand in is short enough to have hidden them
 * all.
 *
 * A tint nobody can see teaches nothing, which is the whole reason the refusal is reported here
 * rather than at the cell. Scrolling the floors is safe at exactly this moment and at no other: a
 * refusal comes from a stroke on the MAP, so the pointer is not over the tiles it moves. Nothing
 * happens when a tinted tile is already showing, so a stack of locked floors does not jump to
 * whichever one is first.
 *
 * It is asked of the SCROLLER and not of the plate, since the head does not travel with the
 * floors: the plate itself never scrolls, so a check made on it would find nothing hidden and
 * the reveal would be silently dead.
 */
function revealRefusal(plate: HTMLDivElement | null): void {
  if (!plate || plate.scrollHeight <= plate.clientHeight + 1) return;
  const tinted = [...plate.querySelectorAll('[data-testid^="shell-layer-refused-"]')];
  const view = plate.getBoundingClientRect();
  const shown = tinted.some((el) => {
    const box = el.getBoundingClientRect();
    return box.bottom > view.top && box.top < view.bottom;
  });
  if (!shown) tinted[0]?.scrollIntoView({ block: 'nearest' });
}

/**
 * One step of the size ladder: the head's way up to the square, and its way down to the pill.
 *
 * WHICH ARROW POINTS WHICH WAY IS A FACT ABOUT WHERE THE PANEL IS, NOT ABOUT THE LADDER'S INDEX.
 * The plate hangs off the RIGHT edge of the window and grows leftward, into the map. So the arrow
 * that points into the map is the one that opens it and the arrow that points at the edge is the
 * one that puts it away: LEFT is bigger and RIGHT is smaller. Read off the ladder instead — smaller
 * first, so smaller on the left — they came out pointing the opposite way to the thing they move,
 * which is what this reverses. The mark is therefore chosen by the DIRECTION THE PLATE TRAVELS and
 * the pair is ordered to match, since an arrow that points away from what it does is worse than no
 * arrow at all.
 *
 * IT WEARS WHAT THE COUNT WORE. The filled yellow pill, the same height and the same press feedback
 * — everything that made the count findable belongs to the way back, not to any word written on
 * it. That inheritance follows the WAY BACK rather than a position, so it is the
 * right-hand arrow that carries it, wherever on the head the pair stands. A spent arrow dims rather
 * than disappearing, the way the pill's own two steps do at the ends of the stack, so the ladder
 * always shows both of its directions and a person can see which end they are at.
 */
function SizeArrow({ dir, mode, onMode }: {
  dir: -1 | 1;
  mode: LayerMode;
  onMode: (mode: LayerMode) => void;
}) {
  const t = useT();
  const next = stepLayerMode(mode, dir);
  const spent = next === mode;
  return (
    <motion.button
      type="button"
      {...(spent ? {} : pressable)}
      aria-label={t(dir < 0 ? 'a11y.layer_smaller' : 'a11y.layer_bigger')}
      title={t(dir < 0 ? 'a11y.layer_smaller' : 'a11y.layer_bigger')}
      data-testid={dir < 0 ? 'shell-layer-smaller' : 'shell-layer-bigger'}
      disabled={spent}
      onClick={() => onMode(next)}
      style={{
        ...btnReset, display: 'flex', alignItems: 'center',
        padding: `${PANEL.headPadY}px ${PANEL.headPadX}px`, borderRadius: 999,
        background: ACTIVE, color: INK,
        opacity: spent ? 0.35 : 1,
        cursor: spent ? cursors.blocked : cursors.clickable,
        // The head's own height is declared against this, so the arrow is as tall as the word that
        // stood here and the plate's depth is what `plateDepth` says it is.
        lineHeight: 1, height: TEXT.head, boxSizing: 'content-box',
      }}
    >
      {/* Bigger grows the plate leftward, so it points left; smaller folds it back toward the
          window's edge, so it points right. */}
      {dir < 0 ? <IconChevronRight size={PANEL.headGlyph} /> : <IconChevronLeft size={PANEL.headGlyph} />}
    </motion.button>
  );
}

export interface LayerPanelProps {
  /** Which of the three sizes the control is in. `pill` is the collapsed stepper, which `Rail.tsx`
   *  draws, so this panel is what the other two mean. */
  mode: LayerMode;
  onMode: (mode: LayerMode) => void;
  /** Where the plate's right edge stands, css px from the window's right edge, and how deep it may
   *  draw. Both come from the column's own plan (`frame.ts:planRail`): the plate is one of the
   *  things that plan places, not a thing dropped on top of what it placed. */
  right: number;
  maxHeight: number;
  /** Drawn and out of reach: the interface has been put away. `visibility` rather than an unmount,
   *  so the stack comes back at the size the visitor left it at. */
  veiled?: boolean;
}

export function LayerPanel({ mode, onMode, right, maxHeight, veiled }: LayerPanelProps) {
  const t = useT();
  const open = mode !== 'pill';
  const cols = colsOf(mode);
  const resize = useMotion('layer.mode.resize');
  const reachName = useMotion('rail.name.reach');
  const veilFade = useMotion(veiled ? 'frame.veil' : 'frame.unveil');
  const zoomed = useZoomedLayoutTransform();
  const zoom = useFrameZoom();
  // The layer-numbers toggle's pill: the button's own box, and its name's laid-out width. Measured
  // rather than chosen, so a language that spells it longer gets the room it needs.
  const numbersRef = useRef<HTMLButtonElement>(null);
  const numbersNameRef = useRef<HTMLSpanElement>(null);
  const [numbersReached, setNumbersReached] = useState(false);
  const [numbers, setNumbers] = useState({ box: 0, name: 0 });
  useLayoutEffect(() => {
    const box = numbersRef.current?.offsetWidth ?? 0;
    const name = numbersNameRef.current?.scrollWidth ?? 0;
    // Same object unless something moved: a fresh one every pass is a render loop.
    setNumbers((was) => (was.box === box && was.name === name ? was : { box, name }));
  });
  const eventBus = useEditorStore((s) => s.eventBus);
  const gridState = useEditorStore((s) => s.gridState);
  const activeLayer = useEditorStore((s) => s.activeLayer);
  const displayLayer = useEditorStore((s) => s.displayLayer);
  const layerVisibility = useEditorStore((s) => s.layerVisibility);
  const layerLocked = useEditorStore((s) => s.layerLocked);
  const showLayerNumbers = useEditorStore((s) => s.showLayerNumbers);
  const setShowLayerNumbers = useEditorStore((s) => s.setShowLayerNumbers);
  const locale = useEditorStore((s) => s.locale);
  const highlight = displayLayer ?? activeLayer;
  // HOW DEEP IT ACTUALLY DRAWS: its own natural depth, or the room the column can give it, whichever
  // is less. The lane is the harder bound of the two — a plate that ran past it would stand on the
  // bottom shelf or over the buttons — so the size gives, and the stack scrolls inside what is left.
  const drawn = Math.min(plateDepth(mode), maxHeight);
  // Whether the whole stack fits in that, which both sides of are declared numbers: there is nothing
  // to measure, so the scrollbar is right on the first frame. The file is short by design, so this
  // is its ordinary state rather than a short window's accident.
  const scrolls = open && fullDepth(mode) > drawn;

  // Cells and objects are mutated IN PLACE, so `gridState`'s identity says nothing about the
  // counts: the shared subscription is what reports a change, rAF-coalesced to once a frame so a
  // stroke of dozens of commands re-renders the panel once.
  //
  // It runs only while the panel is up, which is why OPENING is a dependency of the rows below and
  // not just a change of state. This component is mounted for the app's life and gates itself on
  // `open`, so with the panel closed nothing the tiles watch moves: a map generated in the meantime
  // left them reading whatever the map held at mount, which on a fresh one is every floor at zero.
  const [statsTick, setStatsTick] = useState(0);
  useEffect(() => {
    if (!open) return undefined;
    return subscribeMapStats(eventBus, () => useEditorStore.getState().gridState, () => setStatsTick((n) => n + 1));
  }, [open, eventBus]);

  const capacity = useMemo(() => (gridState ? capacityOf(gridState) : 1), [gridState]);

  const rows = useMemo<Row[]>(() => {
    if (!gridState) return [];
    // Every floor, always: asking for the top one is what makes the list the whole stack rather
    // than the part of it that has been built on.
    return getActiveLayers(gridState, ELEVATION_MAX).map((l) => ({
      elevation: l.elevation,
      name: layerName(t, l.elevation),
      count: l.cellCount,
      // CLAMPED, because the count is not purely a count of cells: it is the cells this floor
      // reaches plus the objects standing ON it, and an object is one whichever way its footprint
      // covers the ground under it. A floor built out to the coast and then decorated can therefore
      // total more than the island has cells, and a bar longer than its own track is a worse reading
      // than a relative one. Full is where the bar stops.
      share: Math.min(1, l.cellCount / capacity),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- statsTick stands in for the in-place cell/object mutations; locale for the names `t` returns
  }, [open, gridState, statsTick, locale, capacity]);

  // The stack in rows of `cols`, filled from the GROUND up, so the leftover floors are the topmost
  // ones and the empty slots land where the stack runs out. Drawn in reverse (below), which is what
  // puts the ground row at the bottom of the plate. At one column that is simply the stack read
  // downward, which is the same rule and needs no branch.
  const bands = useMemo(() => {
    const out: Row[][] = [];
    for (let i = 0; i < rows.length; i += cols) out.push(rows.slice(i, i + cols));
    return out.reverse();
  }, [rows, cols]);

  // Why a paint was refused is off-screen at the cell it was refused on, so the layer that refused
  // it says so here.
  const [refused, setRefused] = useState(false);
  const holdTimer = useRef<number | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const floorsFade = useScrollFade(scroller, 'y');
  useEffect(() => {
    const onFail = (data: { errors: { ruleId: string }[] }) => {
      if (!data.errors.some((e) => e.ruleId === 'V-LOCK-01')) return;
      setRefused(true);
      revealRefusal(scroller.current);
      // ONE tracked timer, so a later refusal extends the tint instead of an older timer cutting a
      // newer one short.
      if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
      holdTimer.current = window.setTimeout(() => { holdTimer.current = null; setRefused(false); }, LOCK_HOLD_MS);
    };
    eventBus.on('validation-failed', onFail);
    return () => {
      eventBus.off('validation-failed', onFail);
      if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
    };
  }, [eventBus]);

  const tile = (row: Row) => (
    <LayerTile
      key={row.elevation}
      row={row}
      mode={mode}
      active={row.elevation === highlight}
      visible={layerVisibility[row.elevation] !== false}
      locked={layerLocked[row.elevation] === true}
      refused={refused}
    />
  );

  return (
    <AnimatePresence>
      {open && (
          <motion.div
            key="shell-layer-panel"
            data-testid="shell-layer-panel"
            role="group"
            aria-label={t('layer.title')}
            initial={{ opacity: 0, scale: 0.9, y: -6 }}
            // The veil rides this element's own opacity because Framer owns that property here: a
            // value in `animate` is written over whatever the style prop says, so the frame's fade
            // has to be expressed as the panel's own or it does not happen at all.
            animate={{ opacity: veiled ? 0 : 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: -6 }}
            transition={{ ...springs.stiff, layout: resize, opacity: veilFade }}
            // The plate's own box is what the tiles rearrange INSIDE, so it grows and shrinks with
            // them under one motion rather than snapping to the new size while they travel.
            layout
            layoutDependency={mode}
            transformTemplate={zoomed}
            // What this plate's own px are worth in the page's, which is the one fact Framer's
            // corner arithmetic is missing (`motion/zoom-corrected-radius.ts`).
            {...frameZoomAttr(zoom)}
            style={{
              position: 'fixed',
              top: LAYER_PANEL_TOP,
              right,
              padding: PANEL.pad,
              boxSizing: 'border-box',
              background: PLATE,
              // A HAIRLINE INSTEAD OF A SHADOW. The plate stands on the island and needs one dark
              // pixel between its cream and whatever is under it; a shadow would be a second
              // treatment for that job, and this frame has none.
              border: PANEL_EDGE,
              // ONE NUMBER, IN THE FRAME'S OWN PX, WHATEVER IS HAPPENING TO THE BOX. Framer rewrites
              // it as a percentage of the box while a layout animation projects this plate, and it
              // measures that box in page px; the attribute above is what makes that conversion
              // land in the same unit this is authored in, so the corner is the same physical
              // corner at rest and mid-resize and there is no frame on which it changes.
              borderRadius: PANEL.radius,
              // It grows out of the count standing at that corner.
              transformOrigin: 'top right',
              maxHeight: drawn,
              // Only `visibility` here: the opacity beside it is Framer's. Discrete, and it
              // interpolates as visible until the end, so the plate leaves hit-testing once it has
              // finished fading rather than the instant it starts.
              visibility: veiled ? 'hidden' : 'visible',
              transition: cssMotion(veiled ? 'frame.veil' : 'frame.unveil', 'visibility'),
              // A COLUMN OF TWO, and that is the whole of how the head stays put: the head is the
              // first item and the floors are the second, so only the second scrolls. The plate
              // itself does not, which is why its own overflow is hidden rather than auto.
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
              // Over the rail: the panel is what the count just opened, so it cannot be the thing
              // the control it belongs to covers.
              zIndex: z.opened,
            }}
          >
            {/* The controls the panel has of its own, side by side at its head. Pushed to
                opposite ends of a plate this wide the last one reads as a stray character rather
                than as a button. */}
            {/* The head's own height is DECLARED rather than left to the pills standing in it, since
                `plateDepth` counts on it and the column places the plate by that number. */}
            {/* IT TRAVELS TOO, and that is what `layout` on it is for rather than any motion of its
                own: the plate's own box is being scaled between two widths, and a child without a
                projection of its own is scaled with it — the two pills would squash to a third of
                their width and spring back over the length of the resize. The head's own children
                take `layout="position"` for the same reason one level down: the head is the box
                changing shape, and the pills standing in it only move. */}
            {/* AND IT STAYS PUT WHILE THE FLOORS MOVE, which is what standing OUTSIDE the scrolling
                box below buys and what `position: sticky` would not: a sticky element's offsets are
                measured from the scrollport's own edge, so it would pin over the plate's padding
                and ride the rounded corner, and it would still be inside the box whose scroll the
                size travel has to project through. */}
            <motion.div
              data-testid="shell-layer-head"
              layout
              layoutDependency={mode}
              transition={resize}
              transformTemplate={zoomed}
              style={{
                flex: 'none',
                // ONE CONTROL AT EITHER END. The head carries two unrelated things — what the map
                // shows, and what size this panel is — so they stand apart rather than side by side
                // at one end with the whole plate empty beside them.
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                // Squared with the tiles under it, so the head's pills line up with a floor's name.
                padding: `0 ${tileOf(mode).padX}px ${PANEL.headGap}px`,
                height: 2 * PANEL.headPadY + TEXT.head, boxSizing: 'content-box',
              }}
            >
              {/* WHAT THE MAP SHOWS, at the head's left: the layer numbers over the island are a
                  fact about the map rather than about this panel, so they take the end the panel's
                  own controls are not at. Drawn in the arrows' box exactly, since two controls at
                  the two ends of one row are read as a pair whatever they do, and one of them a
                  different size reads as the lesser. */}
              {/* IT GROWS RIGHT, where every other named button in the frame grows left. Direction
                  is positional and not a style: the rail's buttons hang off the window's right edge
                  so leftward is into the map, and this one stands at the LEFT end of its own row,
                  where leftward is into the plate's edge and rightward is the row's own free space.

                  The plate that carries the name is absolute and the button keeps the box it had, so
                  the arrows at the other end of the head do not move when this introduces itself. */}
              <motion.button
                ref={numbersRef}
                type="button"
                {...pressOnly}
                layout="position"
                layoutDependency={mode}
                transformTemplate={zoomed}
                aria-label={t('a11y.toggle_layer_numbers')}
                aria-pressed={showLayerNumbers}
                data-testid="shell-layer-numbers"
                onClick={() => setShowLayerNumbers(!showLayerNumbers)}
                onPointerEnter={() => setNumbersReached(true)}
                onPointerLeave={() => setNumbersReached(false)}
                style={{
                  ...btnReset, position: 'relative',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  padding: `${PANEL.headPadY}px ${PANEL.headPadX}px`, borderRadius: 999,
                  minWidth: PANEL.headGlyph,
                  fontSize: TEXT.small, fontWeight: 900, color: showLayerNumbers ? INK : PLATE_INK,
                  lineHeight: 1, height: TEXT.head, boxSizing: 'content-box',
                  transformOrigin: 'left center',
                  cursor: cursors.clickable,
                }}
              >
                {/* The mark in the flow is what SIZES the button; the one that is seen rides the
                    plate over it. Without a sizer the button would have no box of its own, since
                    everything drawn in it is absolute. */}
                <span style={{ visibility: 'hidden' }}>#</span>
                <motion.span
                  aria-hidden
                  initial={false}
                  animate={{ width: numbers.box + (numbersReached ? numbers.name + PANEL.headPadX : 0) }}
                  transition={reachName}
                  style={{
                    position: 'absolute', left: 0, top: 0, height: '100%', borderRadius: 999,
                    background: showLayerNumbers ? ACTIVE : INSET,
                    display: 'flex', alignItems: 'center', overflow: 'hidden',
                  }}
                >
                  <span style={{ width: numbers.box, flex: 'none', textAlign: 'center' }}>#</span>
                  <span
                    ref={numbersNameRef}
                    style={{
                      flex: 'none', whiteSpace: 'nowrap', fontWeight: 800,
                      paddingRight: PANEL.headPadX,
                    }}
                  >
                    {t('a11y.toggle_layer_numbers')}
                  </span>
                </motion.span>
              </motion.button>
              {/* THE ARROWS ARE THE WAY BETWEEN THE SIZES, and the RIGHT one is the way back: the
                  plate hangs off the window's right edge and grows leftward, so the arrow pointing
                  into the map opens it and the one pointing at the edge puts it away. What stood
                  here was the active floor's name, which the plate already marks on the floor's own
                  tile — the one thing on it said twice. The pair takes over its plate and its size,
                  since being findable was the whole argument for how it looked and none of that
                  argument was about the word. They stand at the head's RIGHT, which is the end the
                  count itself hangs off and the end the way back walks toward. */}
              <motion.div
                layout="position"
                layoutDependency={mode}
                transition={resize}
                transformTemplate={zoomed}
                style={{ display: 'flex', alignItems: 'center', gap: PANEL.arrowGap }}
              >
                <SizeArrow dir={1} mode={mode} onMode={onMode} />
                <SizeArrow dir={-1} mode={mode} onMode={onMode} />
              </motion.div>
            </motion.div>

            {/* THE FLOORS, AND THE ONLY THING ON THE PLATE THAT SCROLLS.
                A scrollbar only where there is something to scroll to: the depth both sizes draw at
                is DECLARED (`plateDepth`) and the room the column gives them is handed in, so
                whether this box overflows is arithmetic rather than a measurement, and a bar
                standing on a stack that is all showing says there is more when there is not. At two
                rows a floor the file overflows only on a short window. When it does show, it is the
                app's own thin cozy bar (`animations.css`) and it keeps its lane, so the tiles do
                not shift sideways as the stack is scrolled. */}
            <motion.div
              ref={scroller}
              data-testid="shell-layer-floors"
              className={scrolls ? undefined : 'pw-noscroll'}
              layout
              layoutDependency={mode}
              transition={resize}
              transformTemplate={zoomed}
              // It scrolls, and a layout projection has to be told: an element measured inside a
              // scrolled box is otherwise placed by a rect the scroll has already moved.
              layoutScroll
              style={{
                minHeight: 0,
                overflowY: 'auto',
                scrollbarGutter: scrolls ? 'stable' : 'auto',
                display: 'grid',
                // Equal tracks, so every floor is drawn in the same box however short its name is
                // in the language showing. One track is the file, three is the square, and the
                // tiles themselves come out the same width either way, since a track is sized by
                // the widest tile's own content in both.
                gridTemplateColumns: `repeat(${cols}, 1fr)`,
                gap: tileOf(mode).gap,
                alignContent: 'start',
                ...floorsFade,
              }}
            >
              {/* ONE FLAT LIST, KEYED BY FLOOR. A band-level key is its first floor, which is 6 in
                  the square and 8 in the file — unstable across a size change, so React would
                  remount every tile, and a new element has no place it came from to travel. Flat
                  per-floor keys keep each tile's identity, so the size change animates. */}
              {bands.flatMap((band, i) => [
                ...band.map(tile),
                ...Array.from({ length: cols - band.length }, (_, j) => (
                  <span key={`gap-${i}-${j}`} aria-hidden />
                )),
              ])}
            </motion.div>
          </motion.div>
      )}
    </AnimatePresence>
  );
}
