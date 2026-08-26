/*
 * GenerateShelf.tsx — the bottom bar for 生成 mode: the kinds of island as its row of names, the
 * candidates standing on the backing band, and the settings in the band under them.
 *
 * THREE BANDS. The names are on the map and carry nothing but the four kinds; the cards stand UP out
 * of the backing band (`units.ts:PLATE_BAND`) with the batch tile at their end; the settings sit
 * INSIDE the plate, in the room that runs to the bottom of the window and that only the object
 * shelf was using, for its scrollbar. There is no fourth thing: the names carry the kinds, the last
 * card carries the recipe number, the tile at the cards' end asks for another batch, and Clear is in
 * the menu, where the one destructive action here belongs.
 *
 * THE SHELF HAS NO TOTAL WIDTH. A control is as wide as its own label at a fixed type size, and the
 * cards give up width to whatever a language needs, which is the only way "Насыщенность" and
 * 丰富度 both read at full size in the same place.
 *
 * THE ROW OF NAMES CANNOT BE MOVED. It is `ShelfTabs`, the same element the object shelf is headed
 * with, hung from the same left edge AND standing on the same floor (`units.ts:shelfRowFloor`), so
 * switching between the two shelves moves nothing. The block under it is a DECLARED height
 * (`generate-shelf.ts:BODY_H`) — the cards, the strip and the room between them, all constants for a
 * given window — so neither a control that only one kind has nor a change of language can shift a
 * name.
 *
 * ITS HEIGHT IS A BUDGET, because it stands over the MAP and the map has to stay the biggest thing
 * on the screen. The design's own card height is `CARD_MAX_H`; on a window with no room for it the
 * floor comes down and the card takes what is left, keeping its shape, rather than the panel being
 * rearranged. Its content also steps clear of the right edge, where the rail's clusters are.
 *
 * A CANDIDATE IS DRAWN OFF THE MAP. `generateCandidate` builds the recipe on a detached copy of
 * the grid and `canvas/thumbnail` photographs that copy through the real 2D renderer, off the
 * stage, so a card shows the map the click produces and making, rerolling and browsing candidates
 * still cannot reach the live cells, objects, undo stack or Clear scope at all. The pictures are
 * re-made whenever a setting changes rather than left describing settings the user has moved on
 * from.
 *
 * CLICKING A CARD LANDS THE RUN IT ALREADY IS. The candidate is kept, not just its picture, and
 * `generateMap` replays its commands through the live executor instead of generating the recipe a
 * second time; a card that has been dropped (a setting moved, so its picture no longer answers)
 * generates for real. The bar does not decide which: it hands over what it has and `kit/operations`
 * checks whether the map underneath is still the map the run was built on.
 *
 * A CLICK IS THE ANSWER, AND THERE IS NO SECOND STEP. Clicking a card lands the map; undo is the way
 * back, the same way back every other edit in this editor has. A Keep button finalising what a click
 * had provisionally applied would make the click mean less than it looks like it means, and put the
 * difference nowhere a person could read it.
 *
 * AND EVERY CLICK IS ITS OWN EDIT. A second card does not swap the first out, it replaces the map
 * the way a generation replaces it, and the history says so: three cards clicked in a row leave
 * three steps to walk back through. Nothing is undone to make a candidate's fingerprint match:
 * `kit/operations/generate` clears the scope before it replays, which is what a generation does
 * anyway, so the numbers agree without taking anything back. Everything else LETS GO — moving a slider replaces the cards, and asking
 * another question is not retracting the answer given.
 *
 * THE SCOPE IS A CHIP AND A SCREEN. The chip is the first thing in the strip and says how many
 * cells are painted; pressing it puts the whole shelf away for `ScopeScreen`, and Done brings it
 * back with a fresh batch. It is a chip rather than a fifth tab because it keeps saying what the
 * scope is once the cards are back, where a tab would only say it while you were on it. A batch is
 * not built while that screen is up: every candidate is stale the moment the region changes.
 *
 * THE MAZE'S TWO ENDS ARE OPT-IN. Off — the default — the generator picks its own pair (in from
 * the edge, out at the square) and the map stays clear of marks; the "in and out" switch puts the
 * two draggable marks up as RECIPE SETTINGS: the carve grows out from the entrance, every
 * candidate is built with the pair, and a drop while a run stands re-runs it at its own seed
 * (`MazeEndpoints` draws them, this bar resolves them). What each end IS — a hole in the wall, or
 * a place inside to reach — is read from where it was dropped, so this bar never asks. The WAY
 * switch stands beside it in every state and refuses until the ends are chosen, since it answers
 * for that pair; it is a DRAPE, not an edit: a road's flat
 * sweep reaches the wall beside every corridor lane, so the answer cannot legally be paved — it is
 * drawn over the corridor floor instead, on the terrain grid the walls are shifted onto, and it
 * follows the maze through every regeneration while it is on.
 *
 * NOTHING NARRATES, AND THE CARDS CARRY WHAT A REPORT WOULD. One still being built shows so on its
 * own face; a row of finished cards is the finished message; a card being PUT ON THE MAP shows the
 * same waiting over its picture, because landing one is not instant and without the waiting it
 * reads as the app having stopped (a replay is about a tenth of a second, and a card landing on a map that already
 * carries an island runs for real, which is most of a second on a full map). And a click that did
 * NOT reach the map is said on the card that was clicked, since the run rolls itself back and
 * leaves the screen exactly as it was. There is no toast surface in this shell.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { motion, useReducedMotionConfig } from 'framer-motion';
import { setCursorBusy } from '../../../canvas/interaction/cursor-controller';
import { showToast } from '../../../core/runtime/toast-bus';
import { focusFrame, renderThumbnail } from '../../../canvas/thumbnail';
import { localizedName, useT } from '../../../i18n/context';
import { getCatalogItem } from '../../../state/catalog';
import { TerrainType } from '../../../core/model/types';
import type { GridState, MacroCoord, ResolvedMazeGates, StencilPlan } from '../../../core/model/types';
import { currentKit } from '../../../kit/context';
import { host } from '../../../kit/host';
import { clearGenerated, generateCandidate, generateMap, type Candidate } from '../../../kit/operations';
import { useEditorStore } from '../../../state/store';
import { useScrollFade } from '../../primitives/scroll-fade';
import type { GenSignal } from '../../../kit/operations/generate';
import {
  latticeField, mazeFootprint, onRing, resolveEnd, type MazeEnd, type MazeField,
} from '../../../tools/generation/maze';
import { layerName } from '../layer-name';
import { ScaleProvider, usePx } from '../../design/scale';
import { btnReset, buttonMotion, cursors, UNAVAILABLE, z } from '../../design/styles';
import { GLYPHS } from '../frame';
import { GlyphIcon } from '../GlyphIcon';
import { IconTrash } from '../glyph-icons';
import { DARK_GROOVE, MUTED_INK, ON_DARK, PLATE, PLATE_INK } from '../../design/tokens';
import { PLATE_BAND, SHELF_SCALE, SHELF_TABS, TEXT } from '../units';
import { MOTIONS } from '../motion/registry';
import { useMotion } from '../motion/use-motion';
import { BarSlider } from './BarSlider';
import { BarText } from './bar-atoms';
import { Switch } from '../../primitives/Switch';
import { SegmentedControl } from '../../primitives/SegmentedControl';
import { CandidateCard, CustomCard, ImportCard } from './CandidateCard';
import { MazeEndpoints, type EndId, type MazeEnds } from './MazeEndpoints';
import { ItemPickScreen } from './ItemPickScreen';
import { ScopeScreen } from './ScopeScreen';
import { SCOPE_TOOLS_FOR } from './scope-cells';
import { useFrameZoom, wheelGlider, wheelPush } from './row-scroll';
import { ShelfTabs, TAB_ROW } from './ShelfTabs';
import {
  BAR, BATCH, PAIR_GAP, BODY_H, CANDIDATES, CARD, CARD_H, CHOSEN, CORRIDOR, GAP, PAD, RICHNESS, SEED_MAX,
  STRIP, TABS, batchSeeds, maxElevationFor, minElevationFor, newSeed, shelfConfig, slidersFor,
  CONTRAST, fillKindsFor, fillLabelKey, fillTakesElevation, fillTakesItem,
  isStencilKind, pictureRecipe, regionFitsStencil, stencilNote, textFitsBox, textNeedsWidth, STENCIL_MIN_SIDE,
  type GenerateKind, type ShelfSettings, type StencilFillKind,
} from './generate-shelf';
import { drawSamples, poolFor, sampleName, type StencilSample } from './stencil-samples';
import { buildStencilPlan, forgetStencilImage, type StencilFill } from './stencil-plan';
import { islandBox, regionBox } from './stencil-raster';
import { isBuildableZone } from '../../../core/model/grid-model';

import sliderKnob from '../../../assets/shell/shelf-generate/slider-naturalness/ellipse-1.svg';
import sliderPip from '../../../assets/shell/shelf-generate/slider-naturalness/ellipse-2.svg';
import sliderTick from '../../../assets/shell/shelf-generate/slider-naturalness/ticks/ellipse-1.svg';

/**
 * No track art: the design's own (`slider-naturalness/roundrect.svg`) keeps its own aspect ratio,
 * and this track is as long as the row can spare it, so the groove is drawn instead — in the shade
 * a groove cut into the dark plate takes, since the strip stands INSIDE that plate rather than over
 * the map.
 */
const SLIDER_ART = { knob: sliderKnob, pip: sliderPip, tick: sliderTick };
/** The design draws three marks on a track, whatever the range behind it. */
const SLIDER_TICKS = 3;

/** A floor under a slider's reading, in css px. The number changes width as it counts (0% to 100%,
 *  Layer 1 to Layer 8) and would drag the track along with it; a longer language grows past this. */

/** How long a setting has to stop moving before a batch is worth starting. A slider drag would
 *  otherwise queue a batch per frame it passes through. */
const SETTLE_MS = 350;

/** How long a card says it did not build, in ms. Long enough to be read where the eye already is —
 *  on the card that was just clicked — and short enough that it is gone before the next click. */
const FAILED_MS = 4000;

/** The long side of a candidate picture, in device px. The card draws it at roughly a third of
 *  that, so this is headroom for a high-DPI screen and nothing more. */
const SHOT_PX = 640;

/** The shape of the picture slot on a card, which is the shape every candidate is photographed in. */
const SHOT_ASPECT = CARD.pic.w / CARD.pic.h;

/** How far the block under the names travels as it arrives, in css px: the object shelf's own
 *  category swap, since a change of kind here is the same event one shelf along. */
const SWAP_X = MOTIONS['shelf.category.swap'].amplitude ?? 0;

/** The cards and the tile at their end. It never wraps: the cards shrink together instead, since a
 *  candidate on a line of its own stops being one of the row to compare. */
const ROW: CSSProperties = {
  display: 'flex', alignItems: 'stretch', justifyContent: 'center', flexWrap: 'nowrap',
};


/**
 * A setting that stands in the strip as its own READING and opens a screen to change it: the scope,
 * and the item a letter is tiled with.
 *
 * Name then value, like the knobs beside it, because it is another setting in the same strip. And
 * the value STAYS on the strip once it has been answered, which is the whole reason this is a chip
 * rather than a press that opens a screen and leaves nothing behind: a choice you cannot see is a
 * choice you cannot change.
 */
function StripChip({ name, value, onOpen, testId, disabled, width }: {
  name: string; value: string; onOpen: () => void; testId: string;
  /** Standing but inapplicable in this state: dimmed and refusing, never taken away. */
  disabled?: boolean;
  /**
   * A FIXED width, for a chip standing among the knobs at the right of the strip.
   *
   * Its reading changes with the setting — an item's name, or the n/a of a state it cannot act in —
   * and a chip as wide as its own words would shove every control beside it each time. The scope
   * chip needs none of this: it stands BEFORE the strip's spacer, so its width comes out of the
   * spacer and nothing to its right moves. A reading too long for the box is ellipsized; the item
   * shelf is where the full name is read.
   */
  width?: number;
}) {
  return (
    <motion.button
      type="button"
      {...(disabled ? {} : buttonMotion)}
      aria-disabled={disabled}
      data-testid={testId}
      onClick={disabled ? undefined : onOpen}
      title={value}
      style={{
        ...btnReset, flex: '0 0 auto', pointerEvents: 'auto',
        cursor: disabled ? cursors.blocked : cursors.clickable,
        opacity: disabled ? UNAVAILABLE : 1,
        height: STRIP.h, padding: `0 ${STRIP.padX}px`, borderRadius: 999, background: PLATE,
        display: 'flex', alignItems: 'center', gap: 8, minWidth: 0,
        ...(width ? { width, boxSizing: 'border-box' as const } : {}),
      }}
    >
      <BarText size={TEXT.label} color={MUTED_INK}>{name}</BarText>
      <BarText size={TEXT.label} color={PLATE_INK} align="left" style={{ minWidth: 0, flex: '1 1 auto' }}>
        <span style={{ display: 'block', minWidth: 0, maxWidth: '100%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {value}
        </span>
      </BarText>
    </motion.button>
  );
}

/**
 * A switch with its name before it, the way the maze's own pair stand in this strip.
 *
 * Standing but inapplicable is DIMMED AND REFUSING, never taken away, exactly as the chip beside it
 * is: a control that comes and goes as its neighbour is pressed shoves every knob in the row. The
 * dimming is the switch's own — the name takes the same treatment, and nothing wraps both, since two
 * dimmings multiply and the pair goes past faint to invisible.
 */
function StripSwitch({ label, on, onToggle, testId, disabled }: {
  label: string; on: boolean; onToggle: () => void; testId: string; disabled?: boolean;
}) {
  return (
    <span
      data-testid={testId}
      style={{ display: 'flex', alignItems: 'center', gap: GAP.sliderPart, flex: '0 0 auto', pointerEvents: 'auto' }}
    >
      <BarText size={TEXT.label} color={ON_DARK} align="left" style={{ opacity: disabled ? UNAVAILABLE : 1 }}>
        {label}
      </BarText>
      <Switch on={on} onClick={onToggle} label={label} {...(disabled ? { disabled } : {})} />
    </span>
  );
}

/**
 * A slider with its name before it and its reading after it, over the groove this shelf draws for
 * it. Three things on one line inside the strip, since the two knobs stand side by side there and
 * have no column to share.
 */
/**
 * One slot in the strip: the setting's NAME, then its control.
 *
 * The name stands to the left, because two sliders on one strip are the same drawing and nothing
 * else says which is the corridor's width and which the tallest layer. The READING is the part that
 * moved to the knob's own bubble (`BarSlider`): a number that is always on screen is read once and
 * never again, where the name is what tells the two tracks apart every time.
 *
 * The groove behind a slider's track is the design's drawing of a groove; a control that draws its
 * own shape turns it off.
 */
function Knob({ label, control, groove = true }: {
  label?: string;
  control: ReactNode;
  groove?: boolean;
}) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: GAP.sliderPart, flex: '0 0 auto' }}>
      {label ? <BarText size={TEXT.label} color={ON_DARK} align="left">{label}</BarText> : null}
      {/* The slot stands at the strip's one control height; the drawn track centres inside it and
          the groove fills it, so the three kinds of control share one box. */}
      <span style={{ position: 'relative', display: 'flex', alignItems: 'center', height: STRIP.h }}>
        {groove ? (
          <span
            style={{
              position: 'absolute', inset: 0, borderRadius: 999,
              background: DARK_GROOVE, pointerEvents: 'none',
            }}
          />
        ) : null}
        {control}
      </span>
    </span>
  );
}

/**
 * The shelf, under its own scale.
 *
 * The candidates, their plates and the sliders' grooves and knobs are all drawn in design px through
 * `usePx`, so declaring the scale once here brings the whole shelf down a notch from the frame's.
 * It has to be a WRAPPER rather than a provider inside the body, because the body itself reads
 * `usePx` for the card row's own measurements.
 */
export function GenerateShelf() {
  return (
    <ScaleProvider value={SHELF_SCALE}>
      <GenerateShelfBody />
    </ScaleProvider>
  );
}

function GenerateShelfBody() {
  const { px } = usePx();
  const t = useT();
  const gridState = useEditorStore((s) => s.gridState);
  const region = useEditorStore((s) => s.region);
  const locale = useEditorStore((s) => s.locale);
  const selectingRegion = useEditorStore((s) => s.selectingRegion);
  const setSelectingRegion = useEditorStore((s) => s.setSelectingRegion);
  /** `[]` is "no region painted", which means the whole island: the run takes null for it. */
  const scope = region.length > 0 ? region : null;

  // The first tab, read from the row rather than named again here: the two drifted apart the
  // moment the order changed.
  const [kind, setKind] = useState<GenerateKind>(TABS[0]!.id);
  const [base, setBase] = useState(newSeed);
  const [richness, setRichness] = useState<number>(RICHNESS.default);
  /**
   * The tallest layer, REMEMBERED PER KIND and defaulted to that kind's own ceiling.
   *
   * ONE SHARED NUMBER LEAVES EVERY PICTURE THREE GREENS DEEP. A maze wall may not stand above layer 3
   * (`MAZE_MAX_ELEVATION`), the shelf opens on the maze, and a clamp that follows a kind change can
   * only raise the floor, never restore the ceiling the last kind took away — so a picture's ramp
   * arrives three entries long without anybody touching the knob, and a picture coloured in three
   * greens is a flat, sparse island. A ceiling belongs to the kind that has it, exactly as the
   * material choice does (`fillByKind`).
   */
  const [maxByKind, setMaxByKind] = useState<Record<GenerateKind, number>>(
    () => Object.fromEntries(TABS.map((tab) => [tab.id, maxElevationFor(tab.id)])) as Record<GenerateKind, number>,
  );
  const maxElevation = maxByKind[kind];
  const setMaxElevation = useCallback(
    (next: number) => setMaxByKind((prev) => ({ ...prev, [kind]: next })),
    [kind],
  );
  const [corridorWidth, setCorridorWidth] = useState<number>(CORRIDOR.min);
  /** Whether the visitor is choosing the ends at all. OFF by default: the generator picks its own
   *  pair (in from the edge, out at the square) and the map stays clear of marks; ON puts the two
   *  draggable marks up as recipe settings and offers the way switch beside them. */
  const [customEnds, setCustomEnds] = useState(false);
  /** The maze's two ends, as the visitor has placed them — null until touched, when the defaults
   *  below stand in. A RECIPE SETTING, not a property of a landed maze: the marks are draggable
   *  from the moment they are asked for, and every candidate is built with them. */
  const [gates, setGates] = useState<ResolvedMazeGates | null>(null);
  /** Whether the answer is draped over the landed maze. A view of the run, not part of the
   *  recipe: a road cannot legally sit in a corridor (its flat sweep reaches the wall), so the
   *  way is shown, never built. */
  const [showWay, setShowWay] = useState(false);

  /*
   * THE PICTURE KINDS. Letter and Picture have no random generator behind them — the input IS the
   * recipe — so what varies here is what the row is dealt from a pool, what the visitor typed or
   * imported, and how the shape is built.
   */
  /**
   * What each picture kind builds out of, REMEMBERED PER KIND: choosing objects for a picture and
   * then visiting the letter must not carry the choice across, since the two mean different things
   * by it (a letter's objects are a picked item, a picture's are matched by colour).
   */
  const [fillByKind, setFillByKind] = useState<Record<'text' | 'image', StencilFillKind>>({ text: 'mountain', image: 'mountain' });
  const fillKind = isStencilKind(kind) ? fillByKind[kind as 'text' | 'image'] : 'mountain';
  const setFillKind = useCallback((next: StencilFillKind) => {
    setFillByKind((prev) => (isStencilKind(kind) ? { ...prev, [kind]: next } : prev));
  }, [kind]);
  /** Whether the item shelf is standing in for this one while a letter's object is chosen. */
  const [pickingItem, setPickingItem] = useState(false);
  /**
   * Which item an OBJECT letter is tiled with. The GENERATOR'S OWN setting, not whatever the placer
   * is armed with: picking one is a trip through the item shelf (`ItemPickScreen`), and that trip
   * puts the placer's own arming back when it leaves, so the map is never left under a placement
   * cursor by having chosen a letter's material.
   */
  const [fillItem, setFillItem] = useState<string | null>(null);
  /** Picture: how hard the image is pushed off mid-grey before it is matched to the palette. */
  const [contrast, setContrast] = useState<number>(CONTRAST.def);
  /** What the visitor typed into their own card. Multi-character on purpose: the region decides how
   *  much room a word gets, and a short one in a wide region is perfectly legible. */
  const [ownText, setOwnText] = useState<string | null>(null);
  /** The picture they imported, as an object URL, and the name to show under the card. */
  const [ownImage, setOwnImage] = useState<{ src: string; name: string } | null>(null);

  /** One per drawn card: `undefined` until its picture has been taken, `null` where none could be. */
  const [shots, setShots] = useState<(string | null | undefined)[]>(() => Array(CANDIDATES).fill(undefined));
  /** The runs behind the pictures, so a click lands one instead of generating the recipe again. A
   *  ref rather than state: nothing renders from them, and a batch carries thousands of commands. */
  const candidatesRef = useRef<(Candidate | null)[]>(Array(CANDIDATES).fill(null));
  /** The plan behind each picture-kind card (custom included, at index CANDIDATES): what a click
   *  regenerates from when its cached candidate has gone stale. A number is the whole recipe for
   *  the island kinds; for these, the plan is. */
  const plansRef = useRef<(StencilPlan | null)[]>(Array(CANDIDATES + 1).fill(null));

  /*
   * The last card, which is the visitor's own. It keeps its number through a new batch — a batch
   * that overwrote something typed would lose the one thing on this shelf they authored — so it is
   * built by an effect of its own, on the settings without the batch's base.
   */
  const [customSeed, setCustomSeed] = useState<number | null>(null);
  /** Non-null only while the field is being typed in, so a half-typed number never becomes a seed. */
  const [customDraft, setCustomDraft] = useState<string | null>(null);
  const [customShot, setCustomShot] = useState<string | null | undefined>(null);
  const customRef = useRef<Candidate | null>(null);
  const [customPending, setCustomPending] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  /** Which card's click is on its way to the map, so the card that was pressed can say so. Null
   *  when nothing is landing. */
  const [landingIndex, setLandingIndex] = useState<number | null>(null);
  const [appliedIndex, setAppliedIndex] = useState<number | null>(null);
  /** Which card's own click did not reach the map, until it has been said. */
  const [failedIndex, setFailedIndex] = useState<number | null>(null);
  const failedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Where the last landed run OPENED its gates — kept for the ends switch to adopt, never shown
   *  as the marks: the marks are the visitor's own setting and no run may move them. */
  const [landedGates, setLandedGates] = useState<ResolvedMazeGates | null>(null);
  /** The landed run's own walk between its gates, over its own carved corridors — what the way
   *  drape shows. Reported by the generator, never recomputed: the finished map cannot tell a
   *  carved connector from a wall the coast refused, and a route recomputed over open ground can
   *  slip through such gaps and skirt the maze along its rim. */
  const [walk, setWalk] = useState<MacroCoord[] | null>(null);
  const [dragging, setDragging] = useState<{ which: EndId; end: MazeEnd } | null>(null);

  const seeds = batchSeeds(base);
  const ceiling = maxElevationFor(kind);
  const floor = minElevationFor(kind);
  const elevation = Math.min(Math.max(maxElevation, floor), ceiling);
  const busy = previewing || customPending || landingIndex !== null;

  /*
   * The maze's rectangle on THIS map, and the two ends' starting places in it: in at the middle of
   * the left wall, out at the centre. They exist from the moment the tab is chosen — the ends are
   * recipe inputs, so they cannot wait for a maze to exist first — and they are the exact cells a
   * run receives, never a suggestion the generator's own defaults would overrule.
   */
  const mazeSetup = useMemo(() => {
    if (kind !== 'maze' || !gridState) return null;
    const fp = mazeFootprint(gridState, scope, corridorWidth);
    if (!fp) return null;
    const { origin: o, dims: dm } = fp;
    // LATTICE-ALIGNED, so the run opens its gate exactly where the untouched mark stands: a room
    // row meets the ring every `step` cells, and a default off that grid would be re-snapped by
    // the first landing — a mark moving on its own, which the marks must never do.
    const align = (v: number, cells: number): number =>
      Math.min(cells - 1, Math.max(0, Math.round((v - 1) / dm.step))) * dm.step + 1;
    const defaults: ResolvedMazeGates = {
      entrance: { x: o.x, y: o.y + align(dm.mazeH >> 1, dm.cellsH) },
      exit: { x: o.x + align(dm.mazeW >> 1, dm.cellsW), y: o.y + align(dm.mazeH >> 1, dm.cellsH) },
    };
    return { fp, defaults };
  }, [kind, gridState, region, corridorWidth]);
  const effectiveGates = kind === 'maze' && customEnds ? (gates ?? mazeSetup?.defaults ?? null) : null;

  const settings = { kind, richness, maxElevation: elevation, corridorWidth, gates: effectiveGates };
  /** The last card's place in the row, which is one past the ones drawn for the visitor. */
  /** Clear's mark: the tool row's own eraser, so the shelf does not draw a second one. The road
 *  variant, since that row draws each tool once per surface and a generation is not a surface. */

const CUSTOM = CANDIDATES;
  const seedAt = (i: number): number | null => (i === CUSTOM ? customSeed : seeds[i] ?? null);
  const candidateAt = (i: number): Candidate | null => (
    i === CUSTOM ? customRef.current : candidatesRef.current[i] ?? null
  );

  /** The maze's LATTICE as a field: every carve opens every room, so snapping the marks against
   *  it is what lets a run open its gate EXACTLY where a mark stands — a drop, the defaults and
   *  the generator all speak this one skeleton, with or without a maze on the map. */
  const mazeField = useCallback((state: GridState): MazeField | null => {
    const fp = mazeFootprint(state, scope, corridorWidth);
    return fp ? latticeField(state, fp) : null;
  }, [scope, corridorWidth]);

  /** Put the failure away, and stop it arriving late over a card that has since been clicked. */
  const clearFailed = useCallback(() => {
    if (failedTimer.current) clearTimeout(failedTimer.current);
    failedTimer.current = null;
    setFailedIndex(null);
  }, []);
  useEffect(() => clearFailed, [clearFailed]);

  /**
   * Let go of our candidate and leave it standing.
   *
   * A CLICK ON A CARD IS THE ANSWER, so what it landed is the visitor's map from that moment: this
   * shelf stops pointing at it and never takes it back. Undo is the way back, the same way back
   * every other edit has.
   *
   * WHICH CARD IS OURS AND WHAT THE MAP HOLDS ARE TWO FACTS. This forgets the first only. The gates
   * a run opened and the walk between them describe the maze STANDING ON THE MAP, and moving a
   * slider does not touch it: dropped here, they leave the way switch with nothing to show and the
   * drape cannot go up until another card is clicked.
   */
  const forgetApplied = useCallback(() => {
    setAppliedIndex(null);
    setDragging(null);
  }, []);

  /** And what the map holds, for the one thing that takes the generation back. */
  const forgetLanded = useCallback(() => {
    setLandedGates(null);
    setWalk(null);
  }, []);


  // The map is unusable while the bar is driving the generator, on the pointer as well as here.
  useEffect(() => {
    setCursorBusy(busy);
    return () => setCursorBusy(false);
  }, [busy]);

  /*
   * The pictures. Every setting that reaches the generator is a dependency, because a picture that
   * outlived the setting it was made under would be a promise the click cannot keep.
   */
  /*
   * THE PICTURE KINDS' OWN TERMS.
   *
   * `box` is the region's bounding rectangle, which is the whole of the resolution question: a
   * stencil is exactly as many cells as the area it fills, so what was painted decides how legible
   * the result can be. `fits` is the floor under that — below it a letter stops being the letter.
   */
  /** The space a picture fills: what was painted, or the island itself when nothing was. */
  const box = useMemo(
    () => regionBox(region) ?? (gridState ? islandBox(gridState, isBuildableZone) : null),
    [region, gridState],
  );
  /**
   * What the pictures are FRAMED on: the painted region's own cells, or the whole map where none is
   * painted. A run bounded by a region writes only inside it, and framed on the island a change a
   * few cells across is a few pixels of the card.
   */
  const shotFrame = useMemo(
    () => focusFrame(regionBox(region), gridState?.template ?? null, SHOT_ASPECT),
    [region, gridState],
  );
  const fits = regionFitsStencil(kind, box);
  const stencil = isStencilKind(kind);
  /** The hand this batch was dealt from the kind's pool, by the same base seed the island kinds
   *  draw their recipe numbers from — so New batch means one thing on every kind. */
  const hand = useMemo(
    () => (stencil ? drawSamples(poolFor(kind), CANDIDATES, base) : []),
    [stencil, kind, base],
  );
  /** What the visitor's own card builds: what they typed, or the picture they imported. */
  const ownSample: StencilSample | null = kind === 'text'
    ? (ownText ? { id: 'own', text: ownText } : null)
    : kind === 'image'
      ? (ownImage ? { id: 'own', src: ownImage.src } : null)
      : null;
  /** The own card's input as one comparable value, for the effect that photographs it: committing
   *  text or importing a picture is what must re-run it. */
  const ownKey = ownSample ? ownSample.text ?? ownSample.src ?? null : null;
  const fill: StencilFill = fillKind === 'object'
    ? { kind: 'object', catalogId: fillItem ?? '' }
    : { kind: 'terrain', terrain: fillKind === 'water' ? TerrainType.Water : TerrainType.Mountain };
  /** The region ITSELF, as flat indices: a stencil is fitted to the bounding box, and everything
   *  outside the painted cells has to stay untouched. */
  const allow = useMemo(() => {
    if (!gridState || region.length === 0) return undefined;
    const w = gridState.template.width;
    return new Set(region.map((c) => c.y * w + c.x));
  }, [region, gridState]);
  /** What the chosen material actually builds: the palette every cell is matched against, what
   *  stands at the anchor points, and the part water plays. A LETTER is a shape and reads none of
   *  it — its own material is `fill`. */
  const recipe = kind === 'image' ? pictureRecipe(fillKind) : null;
  const planInputs = useMemo(
    () => (box
      ? {
        box, fill, contrast: contrast / 100,
        objects: recipe?.tiles != null,
        water: recipe?.water ?? 'none',
        ...(recipe?.tiles ? { material: recipe.tiles } : {}),
        ...(recipe?.decor ? { decor: { species: recipe.decor } } : {}),
        ...(allow ? { allow } : {}),
      }
      : null),
    // `fill` is rebuilt each render; its VALUE is what matters, so the parts are the dependencies.
    [box, kind, fillKind, fillItem, contrast, allow],
  );

  const takesElevation = fillTakesElevation(kind, fillKind);
  /** Whether the letter's item chip has anything to open. It stands either way. */
  const takesItem = fillTakesItem(kind, fillKind);
  /**
   * Whether this particular WORD has the room, which the region gate cannot answer: a row of
   * characters divides the region's width between them, so the floor scales with the word
   * (`generate-shelf.ts:textFitsBox`). Asked BEFORE anything is generated — a word too long for its
   * region rasterizes to a row of two-cell smudges and costs a full generation to find that out.
   */
  const wordFits = (sample: StencilSample | null): boolean =>
    kind !== 'text' || !sample?.text || textFitsBox(sample.text, box);
  /** Why a card has no picture, where there is a reason: the region has no room for the kind at
   *  all, or this word has no room in the region. */
  const cardNote = (sample: StencilSample | null): string | null => {
    if (!stencil) return null;
    if (!fits) return t('gen.region_too_small', { n: STENCIL_MIN_SIDE[kind as 'text' | 'image'] });
    if (wordFits(sample)) return null;
    // ONE LETTER AND A ROW OF THEM FAIL FOR DIFFERENT REASONS. A word runs out of width and the remedy
    // is fewer characters or a wider region; a single letter that will not fit has run out of room for
    // its own strokes, and telling someone to use fewer letters than one is nonsense.
    const glyphs = [...(sample!.text ?? '')].length;
    return t(glyphs > 1 ? 'gen.text_too_wide' : 'gen.text_needs_room', { n: textNeedsWidth(sample!.text!) });
  };

  const recipeKey = JSON.stringify([
    kind, richness, elevation, corridorWidth, kind === 'maze' ? effectiveGates : null,
    stencil ? [fillKind, fillItem, contrast, box] : null,
  ]);
  const previewKey = `${recipeKey}|${base}`;
  useEffect(() => {
    // Nothing is worth photographing while the region is being painted: the next stroke would make
    // every picture a promise the click cannot keep, and the cards are not on screen anyway.
    // A picture kind with no region to work in has nothing to photograph — and the cards must go
    // BLANK rather than keep the last kind's pictures, which leaves another generator's islands
    // standing under the letters.
    if (stencil && !fits) {
      setShots(Array(CANDIDATES).fill(null));
      candidatesRef.current = Array(CANDIDATES).fill(null);
      // AND THE PLANS WITH THEM. A candidate is dropped here but a plan is the RECIPE, and one left
      // standing is a card with no picture that still builds — the region shrank under it and the
      // click laid the picture the last region was fitted for. A card that cannot show what it
      // would do must not be able to do it.
      plansRef.current = Array(CANDIDATES + 1).fill(null);
      return undefined;
    }
    if (!gridState || selectingRegion) return undefined;
    let dropped = false;
    const signal: GenSignal = { cancelled: false };
    /*
     * THE CARDS GO BLANK NOW, NOT WHEN THE RUN STARTS. The seeds change with the recipe, and the
     * pass that photographs them waits `SETTLE_MS` for the settings to stop moving — so a batch
     * cleared inside `run` would leave the OLD batch's pictures standing under the NEW batch's
     * numbers for a third of a second, a card saying it is a recipe it is not a picture of. Pending is
     * the honest state, and it is the one the card already knows how to draw.
     */
    setShots(Array(CANDIDATES).fill(undefined));

    const run = async (): Promise<void> => {
      const kit = currentKit();
      if (!kit) return;
      // What stands was built from the settings that have just changed, so it no longer answers to
      // the batch about to be photographed, and the shelf lets go of it. It STAYS on the map:
      // moving a slider is asking another question, not retracting the answer already given, and a
      // click on a card was that answer. Neither does a card's report of its own failure survive:
      // these are about to be other recipes.
      forgetApplied();
      clearFailed();
      setPreviewing(true);
      // The whole batch is asked for at once: the worker pool builds two or three concurrently and
      // each card's picture lands the moment its own run is back, not behind five others. The
      // thumbnail queue (canvas/thumbnail) serializes the captures themselves.
      // A picture kind's cards are the hand it was dealt, not five seeds: the plan IS the recipe, so
      // the seed rides along unused and every card is exactly what it shows.
      const dealt = stencil ? hand : seeds;
      await Promise.all(dealt.map(async (entry, i) => {
        const seed = stencil ? base + i : (entry as number);
        const plan = stencil && planInputs && wordFits(entry as StencilSample)
          ? await buildStencilPlan(entry as StencilSample, planInputs)
          : null;
        if (dropped) return;
        // The card is refused, or its picture would not build. Its PLAN goes with its photograph, or
        // the one the last region left behind stays live and a click builds a letter fitted to a
        // region that is no longer painted.
        if (stencil && !plan) {
          plansRef.current[i] = null;
          setShots((prev) => prev.map((sh, j) => (j === i ? null : sh)));
          return;
        }
        plansRef.current[i] = plan;
        const candidate = await generateCandidate(kit, {
          config: shelfConfig({ ...settings, seed, stencilPlan: plan }),
          region: scope,
          signal,
        });
        if (dropped) return;
        candidatesRef.current[i] = candidate;
        // The picture waits on the map's own icons being decoded, so it is taken asynchronously and
        // the batch may have been dropped by the time it is back.
        const shot = candidate ? await renderThumbnail(candidate.state, SHOT_PX, SHOT_ASPECT, shotFrame) : null;
        if (dropped) return;
        setShots((prev) => prev.map((s, j) => (j === i ? shot : s)));
      }));
      if (!dropped) setPreviewing(false);
    };

    const timer = setTimeout(() => { void run(); }, SETTLE_MS);
    return () => {
      dropped = true;
      signal.cancelled = true;
      clearTimeout(timer);
      // The settings these were built under are the ones just left behind, so a click in the gap
      // before the next batch arrives generates for real rather than landing an answer to a
      // question the user has stopped asking.
      candidatesRef.current = Array(CANDIDATES).fill(null);
    };
  }, [previewKey, gridState, region, selectingRegion, forgetApplied, clearFailed]);

  /*
   * The visitor's own card, on the recipe WITHOUT the batch's base: a new batch draws five other
   * recipes and leaves this one exactly where it was, so it is only re-photographed when a setting
   * moves it — the same rule as the others, minus the one term it does not share.
   */
  useEffect(() => {
    // A picture kind's own card is driven by what was typed or imported rather than by a number.
    if (!gridState || selectingRegion || (stencil && !fits) || (stencil ? !ownSample : customSeed === null)) {
      customRef.current = null;
      setCustomShot(null);
      setCustomPending(false);
      return undefined;
    }
    let dropped = false;
    const signal: GenSignal = { cancelled: false };
    setCustomShot(undefined);

    const run = async (): Promise<void> => {
      const kit = currentKit();
      if (!kit) return;
      setCustomPending(true);
      const plan = stencil && ownSample && planInputs && wordFits(ownSample)
        ? await buildStencilPlan(ownSample, planInputs)
        : null;
      if (dropped) return;
      if (stencil && !plan) { plansRef.current[CUSTOM] = null; setCustomShot(null); setCustomPending(false); return; }
      plansRef.current[CUSTOM] = plan;
      const candidate = await generateCandidate(kit, {
        config: shelfConfig({ ...settings, seed: customSeed ?? base, stencilPlan: plan }),
        region: scope,
        signal,
      });
      if (dropped) return;
      customRef.current = candidate;
      const shot = candidate ? await renderThumbnail(candidate.state, SHOT_PX, SHOT_ASPECT, shotFrame) : null;
      if (dropped) return;
      setCustomShot(shot);
      setCustomPending(false);
    };

    const timer = setTimeout(() => { void run(); }, SETTLE_MS);
    return () => {
      dropped = true;
      signal.cancelled = true;
      clearTimeout(timer);
      customRef.current = null;
    };
    // `ownKey` and not `ownSample`: the sample is rebuilt each render, and an object identity in the
    // deps would re-photograph the card on every keystroke anywhere in the shelf.
  }, [recipeKey, customSeed, ownKey, gridState, region, selectingRegion]);

  /**
   * Land a card's run, or re-land it with a maze setting moved out from under it.
   *
   * `over` is how a dragged end or a flipped way-switch reaches the generator ahead of React's own
   * state turn: the ends and the way are hyper-parameters of the maze — the carve grows out from
   * the entrance — so moving one while a run stands is asking for ANOTHER maze at the same seed.
   * An overridden run never replays the card's cached candidate, which was built without it.
   *
   * A CARD IS ITS OWN. The batch is asked for all at once and each picture lands as its own run
   * comes back, so a finished card is a finished answer whatever the four beside it are still doing:
   * what refuses a click is this card's own run being unfinished, or another card already on its way
   * to the map — a map cannot take two landings at once.
   */
  const applyCandidate = useCallback(async (index: number, over?: Partial<ShelfSettings>) => {
    const kit = currentKit();
    // A picture kind's card carries its recipe as a PLAN; the seed rides along unused. The island
    // kinds' recipe is the number, and without one there is nothing to land.
    const plan = stencil ? plansRef.current[index] ?? null : null;
    const seed = stencil ? base + index : seedAt(index);
    const pending = index === CUSTOM ? customPending : previewing && shots[index] === undefined;
    if (!kit || landingIndex !== null || pending || (stencil ? !plan : seed === null)) return;
    // The region has to still be one this kind can work in. The plan is dropped the moment it is
    // not, so this is the second lock on the same door — and it is the one that holds if a future
    // path ever caches a plan somewhere else.
    if (stencil && !fits) return;
    forgetApplied();
    clearFailed();
    setLandingIndex(index);
    try {
      const outcome = await generateMap(kit, {
        config: shelfConfig({ ...settings, ...over, seed: seed ?? base, ...(plan ? { stencilPlan: plan } : {}) }),
        region: scope,
        candidate: over ? null : candidateAt(index),
      });
      host.resync();
      // THE SCOPE HIGHLIGHT STAYS UP after the run lands: the region is still the bound on every
      // next run, and the drape is what says so. It comes down in one place only — the scope
      // screen's own Clear (use-region-brush), where the region itself is emptied.
      host.feedback.flash(outcome.cells, { terrainMode: true });
      // WHAT THE WORD DID WITH THE GROUND IT WAS GIVEN. A letter stands one layer on the region's
      // own surface, so cells that cross a step, reach the edge of that ground or stand on the
      // tallest layer there is are left alone — and a word arriving shorter than it was typed says
      // why rather than going quietly missing. Nothing to say on a run that wrote all of it.
      // ONE LINE, NAMING THE LARGEST REASON, except that a run which wrote NOTHING against the
      // grid's ceiling always says so: `generate-shelf.ts:stencilNote` holds the rule and the
      // argument for it. A run that wrote none of the word is a warning; a short one is a note.
      const said = stencil ? stencilNote(kind, outcome.stencil, outcome.placed) : null;
      // THE GROUND'S OWN REASON COMES FIRST, and it outranks a word's: a region painted inside a tall
      // massif is ground the terrain around it stands on, so a run there hands every cell back and
      // builds nothing whatever it was asked to build. Naming the letters that did not fit would be
      // true and useless, since no letter could have fit. A region the run was free to build on and
      // put nothing in stays quiet, which is what it always was.
      if (outcome.scopeEmpty === 'reclaimed') showToast(t('gen.scope_reclaimed'), 'warning');
      else if (said) showToast(t(said.key, { n: said.n }), outcome.placed === 0 ? 'warning' : 'info');
      setAppliedIndex(index);
      // The run reports where its gates opened and its own walk between them. NOT the marks: those
      // are the visitor's setting, and a run answers them rather than moving them.
      setLandedGates(outcome.mazeGates ?? null);
      setWalk(outcome.mazeWalk ?? null);
    } catch {
      // A run that threw rolled itself back, so the map is as it was and the cards still stand:
      // nothing on the screen has changed, which is exactly why the card has to say so.
      setFailedIndex(index);
      failedTimer.current = setTimeout(() => { failedTimer.current = null; setFailedIndex(null); }, FAILED_MS);
    } finally {
      setLandingIndex(null);
    }
  }, [
    landingIndex, previewing, customPending, shots, clearFailed, forgetApplied,
    previewKey, customSeed, region, stencil, fits, base, t,
  ]);

  /*
   * The marks over the map: THE VISITOR'S OWN CELLS, always. A landed run never rewrites them —
   * it opens its gates AT them, which is what snapping every drop and default against the lattice
   * buys — so what they show is exactly what every run receives. A drag in progress shows where
   * it would land.
   */
  const marks: MazeEnds | null = (() => {
    if (kind !== 'maze' || !customEnds) return null;
    if (!mazeSetup || !effectiveGates || !gridState) return null;
    const field = latticeField(gridState, mazeSetup.fp);
    const endOf = (c: MacroCoord | null): MazeEnd | null =>
      c ? { cell: c, kind: onRing(field, c.x, c.y) ? 'hole' : 'target' } : null;
    return { entrance: endOf(effectiveGates.entrance), exit: endOf(effectiveGates.exit) };
  })();
  const shownEnds: MazeEnds | null = marks && dragging ? { ...marks, [dragging.which]: dragging.end } : marks;

  /**
   * Choosing the ends, or handing them back to the generator. Turning ON adopts the landed run's
   * own resolved pair when one stands, so the marks appear where the maze's ends already are
   * rather than jumping to the defaults; turning OFF puts the way switch away with the marks,
   * since the way it answers for is the pair being handed back.
   */
  const toggleEnds = useCallback(() => {
    if (customEnds) { setCustomEnds(false); setShowWay(false); return; }
    if (landedGates) setGates(landedGates);
    setCustomEnds(true);
  }, [customEnds, landedGates]);

  /*
   * The drape follows the switch AND the maze: whatever regenerates the maze (a card, a dropped
   * end) brings a new walk with its outcome, and the answer redraws itself over the new corridors
   * — or comes down when there is nothing landed to answer for. ON THE TERRAIN GRID: the walls
   * render at −HALF_TILE, so the corridor floor the drape must fill is the corridor cell's
   * terrain-shifted rect.
   */
  useEffect(() => {
    if (!showWay || !walk || walk.length === 0) { host.route.clear(); return undefined; }
    host.route.show(walk);
    return () => host.route.clear();
  }, [showWay, walk]);

  /**
   * A marker moved. While the drag runs this only moves the mark; the DROP writes the SETTING —
   * the ends are recipe inputs, draggable before any maze exists, and the batch is re-photographed
   * with them like any moved slider. While a run STANDS the drop also re-runs it at its own seed,
   * so the landed maze answers the move immediately: the carve grows out from the entrance, and
   * one drop is one generation and one undo entry, exactly as clicking the card again would be.
   */
  const onEndMove = useCallback((which: EndId, cell: MacroCoord, dropped: boolean) => {
    const kit = currentKit();
    if (!kit || !shownEnds) return;
    const field = mazeField(kit.state);
    if (!field) return;
    const to = resolveEnd(field, cell);
    if (!to) return;
    if (!dropped) { setDragging({ which, end: to }); return; }
    setDragging(null);
    const moved: ResolvedMazeGates = {
      entrance: which === 'entrance' ? to.cell : shownEnds.entrance?.cell ?? null,
      exit: which === 'exit' ? to.cell : shownEnds.exit?.cell ?? null,
    };
    setGates(moved);
    if (appliedIndex !== null) void applyCandidate(appliedIndex, { gates: moved });
  }, [shownEnds, appliedIndex, mazeField, applyCandidate]);

  /** Bounded by the LAST RUN's region and by the map's own authorship, exactly as the menu row was:
   *  a placement made by hand inside that region survives, which is what makes this safe enough to
   *  stand in the shelf rather than behind a confirmation. */
  const clearLastRun = useCallback(() => {
    const kit = currentKit();
    if (!kit) return;
    clearGenerated(kit, { region: null });
    host.resync();
    forgetApplied();
    forgetLanded();
  }, [forgetApplied, forgetLanded]);

  /*
   * The cards' own scroll. A card keeps one size, so a window or a language that cannot hold them
   * all scrolls rather than shrinking every picture — the count and the picture stop being the same
   * decision. The mechanism is the object shelf's, reused rather than rewritten, which is what
   * makes the wheel behave the same on both rows.
   */
  const cardsRef = useRef<HTMLDivElement>(null);
  const [, setCardsLeft] = useState(0);
  const zoom = useFrameZoom();
  // This row draws no scrollbar of its own (see the comment above): the fade is the only signal
  // that there is more to see, so it earns its keep here more than anywhere else in the shelf.
  const cardsFade = useScrollFade(cardsRef, 'x');
  const reducedMotion = useReducedMotionConfig() ?? false;
  const swapMotion = useMotion('shelf.category.swap');
  const cardsGlide = useRef(wheelGlider()).current;

  const reroll = useCallback(() => {
    if (busy) return;
    setBase(newSeed());
  }, [busy]);

  /** The typing has stopped: take the digits as a recipe number, or drop the card back to its
   *  question mark where there are none. No confirm, the way no other setting on this bar has one. */
  const commitCustom = useCallback(() => {
    const raw = customDraft ?? '';
    setCustomDraft(null);
    // A LETTER kind takes the text itself, trimmed of nothing but the ends: the spaces inside a
    // word are part of the shape it draws.
    if (kind === 'text') {
      const next = raw.trim() || null;
      if (next === ownText) return;
      setOwnText(next);
      if (appliedIndex === CUSTOM) forgetApplied();
      return;
    }
    const digits = raw.replace(/\D/g, '');
    const next = digits ? Number(digits) % SEED_MAX : null;
    if (next === customSeed) return;
    setCustomSeed(next);
    // The card is about to be another recipe, so it can no longer be the one standing on the map.
    if (appliedIndex === CUSTOM) forgetApplied();
  }, [appliedIndex, customDraft, customSeed, forgetApplied, CUSTOM, kind, ownText]);

  /**
   * Take a picture from the visitor's own files.
   *
   * A hidden `<input type=file>` clicked from here rather than a control of its own: the card IS the
   * affordance, and the browser will not open a picker except from a real press on a real input. The
   * previous object URL is revoked and its decode forgotten, or a session of trying pictures leaks
   * every one of them.
   */
  const pickImage = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      setOwnImage((prev) => {
        if (prev) { forgetStencilImage(prev.src); URL.revokeObjectURL(prev.src); }
        return { src: URL.createObjectURL(file), name: file.name };
      });
      if (appliedIndex === CUSTOM) forgetApplied();
    };
    input.click();
  }, [appliedIndex, forgetApplied, CUSTOM]);

  // The object URL outlives this component otherwise, and nothing else holds it.
  useEffect(() => () => {
    setOwnImage((prev) => { if (prev) { forgetStencilImage(prev.src); URL.revokeObjectURL(prev.src); } return null; });
  }, []);

  /** The upper track carries the knob the kind actually has: richness shapes an island and means
   *  nothing to a maze, which is turned by its corridor width instead. */
  interface UpperKnob {
    label: string;
    reading: string;
    min: number;
    max: number;
    value: number;
    set: (v: number) => void;
  }
  /**
   * The upper slot's content, which every kind names for itself. The SLOT is constant — one label,
   * one reading, one control, standing in the same place on every kind — and only what fills it
   * changes, so nothing appears or vanishes as the row of names is walked. The picture kinds fill
   * it with their material instead, and never read this.
   */
  /** The tracks this kind's row can spare, which is the design's own drawn length everywhere but the
   *  picture, where six material segments stand beside them. */
  const sliders = slidersFor(kind);
  const upper: UpperKnob = kind === 'maze'
    ? {
      label: t('generate.corridor'),
      reading: t(corridorWidth === 1 ? 'agent2.n_cells_one' : 'agent2.n_cells', { n: corridorWidth }),
      min: CORRIDOR.min, max: CORRIDOR.max, value: corridorWidth, set: setCorridorWidth,
    }
    : {
      label: t('generate.richness'), reading: t('gen.percent', { n: richness }),
      min: RICHNESS.min, max: RICHNESS.max, value: richness, set: setRichness,
    };

  // The room the row of names leaves over the window's bottom, capped at the drawn card height: a
  // 1918-tall design canvas assumes more screen than a screen has.
  const cardH = CARD_H;
  /** The card's width follows from the height it is allowed, since its shape is the drawing's. */
  const cardW = Math.min(px(CARD.w), (cardH * CARD.w) / CARD.h);
  /** How far the chosen card's plate stands past the card box, in css px — the room the scroll
   *  container has to concede on its clipping edges or the plate loses its top and bottom. */
  const chosenOut = Math.ceil(cardH * CHOSEN.insetY);
  /** The room over the block, which is whatever the row's own floor leaves: the names stand at one
   *  height in both shelves, and the block under them is not the same depth in the two. */
  const rowGap = SHELF_TABS.floor - PAD.bottom - BODY_H;


  /**
   * What the chip says the scope is — and, for the picture kinds, whether it is big enough.
   *
   * THE REFUSAL IS SAID BY THE CONTROL THAT CAUSES IT. A stencil is exactly as many cells as the
   * region it fills, so a small region is not a small run, it is an unreadable one; and the region
   * is the thing to change. Saying so on the chip that opens the region screen puts the reason and
   * the remedy in one place, and adds no element that exists only sometimes.
   */
  /** The visitor's own card refuses for the same reasons a dealt one does, and it is the card a
   *  word too long for its region will actually be typed into. */
  const ownNote = cardNote(ownSample);

  /** The item a letter is tiled with, by its own name. Null until one is chosen, and null again if
   *  the catalog has lost it, which the chip says as plainly as never having chosen. */
  const chosenItem = fillItem ? getCatalogItem(fillItem) : null;
  const itemName = chosenItem ? localizedName(chosenItem.name, locale) : null;

  const scopeSays = stencil && !fits
    ? t('gen.scope_too_small', { n: STENCIL_MIN_SIDE[kind as 'text' | 'image'] })
    : scope
      ? t(scope.length === 1 ? 'agent2.n_cells_one' : 'agent2.n_cells', { n: scope.length })
      : t('gen.scope_all');

  // A SCREEN, NOT A SWAP: the shelf goes away while a region is painted, because the return is a
  // regeneration — every candidate is stale the moment the region changes, and cards left standing
  // would be a promise the next stroke breaks.
  if (selectingRegion) {
    return (
      <ScopeScreen
        onDone={() => setSelectingRegion(false)}
        {...(SCOPE_TOOLS_FOR[kind] ? { tools: SCOPE_TOOLS_FOR[kind] } : {})}
        {...(isStencilKind(kind) ? { minSide: STENCIL_MIN_SIDE[kind as 'text' | 'image'] } : {})}
      />
    );
  }
  // Choosing what a letter is built out of is the ITEM SHELF standing in for this one, exactly as
  // painting a region is the scope screen standing in for it: the list already exists, already
  // scrolls and searches, and arming an item is the thing it does.
  if (pickingItem) {
    return (
      <ItemPickScreen
        current={fillItem}
        onPicked={(catalogId) => { setFillItem(catalogId); setPickingItem(false); }}
      />
    );
  }

  return (
    <>
      <MazeEndpoints ends={shownEnds} onMove={onEndMove} />

      <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, pointerEvents: 'none', zIndex: z.panel }}>
        <div style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
          {/* The backing, as the design draws it: a band at the bottom of the window that the
              candidates stand UP out of, and that the strip sits inside. See `units.ts:PLATE_BAND`. */}
          <div
            data-testid="bar-plate"
            style={{
              position: 'absolute',
              left: -PLATE_BAND.overhang, right: -PLATE_BAND.overhang,
              bottom: -PLATE_BAND.radius, height: PLATE_BAND.top + PLATE_BAND.radius,
              borderRadius: PLATE_BAND.radius, background: BAR.fill,
              // Solid: input over the visible dock belongs to the dock, never to the map under it.
              pointerEvents: 'auto',
            }}
          />

          <div
            style={{
              position: 'relative', width: '100%', boxSizing: 'border-box',
              padding: `${PAD.top}px ${PAD.right}px ${PAD.bottom}px ${PAD.side}px`,
              display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: rowGap,
            }}
          >
            {/* The shelf's heading, and the whole of it: the four kinds of island at the shelf's own
                left edge, on the MAP above the backing band. Nothing else stands in this row —
                anything more makes it hard to read. */}
            <div style={{ ...TAB_ROW, position: 'relative' }}>
              <ShelfTabs
                label={t('menu.generate')}
                tabs={TABS.map((entry) => ({ id: entry.id, label: t(entry.labelKey) }))}
                active={kind}
                onSelect={setKind}
              />
            </div>

            {/* The cards, and the strip inside the plate under them. Its height is DECLARED rather
                than taken from whatever is in it, so the names above stay put through a change of
                kind, of language and of report.

                A CHANGE OF KIND SWAPS THE WHOLE BLOCK, so it is keyed on the kind and arrives:
                other recipes, and the settings that belong to them. The names above do not move,
                which is what makes the motion readable as the block under them answering the press
                rather than the shelf being rebuilt. It is the object shelf's own category swap,
                same motion and same distance, since it is the same event one shelf along. */}
            <motion.div
              key={kind}
              data-testid="shell-gen-body"
              initial={{ opacity: 0, x: SWAP_X }}
              animate={{ opacity: 1, x: 0 }}
              transition={swapMotion}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'stretch',
                width: '100%', height: BODY_H, gap: STRIP.gap,
              }}
            >
              {/* One line: the scrolling recipes, then the two pinned actions. */}
              <div style={{ display: 'flex', alignItems: 'stretch', height: cardH, minWidth: 0 }}>
              {/*
                A CARD HAS ONE SIZE AND THE ROW SCROLLS. Cards sharing a run of width and shrinking
                together make the COUNT a layout decision: six makes every picture too small to
                read, three makes the row look empty, and neither is really about how many recipes a
                person wants. A card is drawn at its size at every window,
                in every language, and what does not fit is a scroll away — the same answer the
                object shelf already gives its own cards.

                The pair after them does NOT scroll: `New batch` and `Clear` are what you do to a
                whole batch, and a control you have to go looking for is one you cannot rely on.
              */}
              <div
                ref={cardsRef}
                className="pw-noscroll"
                data-testid="gen-cards-row"
                onScroll={(e) => setCardsLeft(e.currentTarget.scrollLeft)}
                onWheel={(e) => {
                  const push = wheelPush(e, e.currentTarget.clientWidth, zoom);
                  if (push) cardsGlide.wheel(e.currentTarget, push.by, reducedMotion);
                }}
                style={{
                  ...ROW, gap: GAP.card,
                  // Solid, gaps between cards included: a wheel between two cards glides the row
                  // rather than falling through to the map (the shelf's root is pointer-transparent).
                  pointerEvents: 'auto',
                  // Content-sized, shrinkable: the pair after this row stands beside the last card
                  // when the row has room to spare, and only reaches the window's edge when the
                  // cards themselves do (the row then scrolls under it).
                  flex: '0 1 auto', minWidth: 0,
                  justifyContent: 'flex-start',
                  overflowX: 'auto', overflowY: 'hidden',
                  // The chosen card's plate stands outside the card's box, and a scroll container
                  // clips at its own edge — so the box is grown by the plate's overhang on every
                  // side and pulled back by the same amount, leaving the layout where it was and
                  // the plate whole. The RIGHT needs it as much as the left: when the row scrolls,
                  // its padding edge is exactly where the last card's plate bleeds.
                  height: cardH + 2 * chosenOut,
                  margin: `${-chosenOut}px ${-chosenOut}px ${-chosenOut}px ${-chosenOut}px`,
                  padding: `${chosenOut}px ${chosenOut}px ${chosenOut}px ${chosenOut}px`,
                  ...cardsFade,
                }}
              >
                {/* A picture kind deals its cards from a pool, so what stands here is the hand; every
                    other kind deals recipe numbers. Same card, same click, same picture slot. */}
                {(stencil ? hand : seeds).map((entry, i) => {
                  const note = cardNote(stencil ? (entry as StencilSample) : null);
                  return (
                    <div
                      key={stencil ? (entry as StencilSample).id : (entry as number)}
                      // The chosen plate bleeds into the neighbours' boxes, and siblings paint in DOM
                      // order — without this the NEXT card covers the plate's right side, which read
                      // as the outline clipped.
                      style={{ flex: '0 0 auto', width: cardW, position: 'relative', zIndex: appliedIndex === i ? 1 : 0 }}
                    >
                      <CandidateCard
                        seed={stencil ? base + i : (entry as number)}
                        {...(stencil ? { name: sampleName(entry as StencilSample, locale) } : {})}
                        {...(note ? { note } : {})}
                        shot={shots[i]}
                        selected={appliedIndex === i}
                        failed={failedIndex === i}
                        landing={landingIndex === i}
                        onSelect={() => { void applyCandidate(i); }}
                      />
                    </div>
                  );
                })}

                {/* The last one is the visitor's own: a recipe they name, in the row with the ones
                    named for them, rather than a field and a confirm step somewhere else. It scrolls
                    with them because it IS one of them. */}
                <div style={{ flex: '0 0 auto', width: cardW, position: 'relative', zIndex: appliedIndex === CUSTOM ? 1 : 0 }}>
                  {kind === 'image' ? (
                    /* A picture has nothing to type, so its own card IMPORTS one. Everything else
                       about the card is the same card: the same plate, the same picture slot, the
                       same click that lands the run. */
                    <ImportCard
                      name={ownImage?.name ?? null}
                      shot={customShot}
                      selected={appliedIndex === CUSTOM}
                      failed={failedIndex === CUSTOM}
                      landing={landingIndex === CUSTOM}
                      onPick={pickImage}
                      onSelect={() => { void applyCandidate(CUSTOM); }}
                    />
                  ) : (
                    <CustomCard
                      field={kind === 'text' ? 'glyph' : 'number'}
                      {...(kind === 'text' ? { title: t('gen.custom_text') } : {})}
                      {...(ownNote ? { note: ownNote } : {})}
                      seed={customSeed}
                      glyph={ownText}
                      draft={customDraft}
                      shot={customShot}
                      selected={appliedIndex === CUSTOM}
                      failed={failedIndex === CUSTOM}
                      landing={landingIndex === CUSTOM}
                      onDraft={setCustomDraft}
                      onCommit={commitCustom}
                      onEdit={() => setCustomDraft(kind === 'text' ? (ownText ?? '') : String(customSeed ?? ''))}
                      onSelect={() => { void applyCandidate(CUSTOM); }}
                    />
                  )}
                </div>

              </div>

              {/* THE PAIR STANDS OUTSIDE THE SCROLL, right after the last card. A new batch and
                  taking the last one back are things you do to a whole generation rather than to
                  one candidate, so they are not cards — but they are the next thing along the row,
                  where the eye already is, not parked at the window's far edge across a gap. */}
              <div style={{ display: 'flex', alignItems: 'stretch', flex: '0 0 auto', marginLeft: GAP.card }}>
                {/* The batch, where the eye already is once every card has been turned down. */}
                <motion.button
                  type="button"
                  {...(busy ? {} : buttonMotion)}
                  aria-disabled={busy}
                  aria-label={t('gen.reroll')}
                  data-testid="shell-gen-batch"
                  onClick={() => { if (!busy) reroll(); }}
                  style={{
                    ...btnReset, flex: '0 0 auto', width: cardH * BATCH.wide, height: cardH,
                    pointerEvents: 'auto', cursor: busy ? cursors.blocked : cursors.clickable,
                    opacity: busy ? 0.45 : 1,
                    borderRadius: px(BATCH.radius), background: PLATE,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <GlyphIcon glyph={GLYPHS.rotate} size={BATCH.glyph} />
                </motion.button>

                {/* CLEAR, beside the batch, because the two are the same kind of thing: what you do
                    to a generation rather than to one candidate. It was in the app menu first, which
                    holds actions about the SESSION, and nobody undoing a generation hunts there.
                    Its own gap is wider than the row's, so the pair reads as two targets. */}
                <motion.button
                  type="button"
                  {...(busy ? {} : buttonMotion)}
                  aria-disabled={busy}
                  aria-label={t('gen.clear_generated')}
                  data-testid="shell-gen-clear"
                  onClick={() => { if (!busy) clearLastRun(); }}
                  style={{
                    ...btnReset, flex: '0 0 auto', width: cardH * BATCH.wide, height: cardH,
                    marginLeft: PAIR_GAP - GAP.card,
                    pointerEvents: 'auto', cursor: busy ? cursors.blocked : cursors.clickable,
                    opacity: busy ? 0.45 : 1,
                    borderRadius: px(BATCH.radius), background: PLATE,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  {/* A discard, so a trash can — the eraser glyph is a stroke you drag, and this
                      takes a whole generation back. */}
                  <span aria-hidden style={{ display: 'flex', color: PLATE_INK }}>
                    <IconTrash size={BATCH.glyph} />
                  </span>
                </motion.button>
              </div>
              </div>

              {/* The strip, INSIDE the plate: it costs no height, because the plate runs to the
                  bottom of the window and nothing else on this shelf reaches down there. */}
              <div
                data-testid="shell-gen-strip"
                style={{
                  display: 'flex', alignItems: 'center', flexWrap: 'nowrap',
                  height: STRIP.h, minWidth: 0, gap: GAP.strip, pointerEvents: 'auto',
                  // Out to the view kit's own edge: the knobs are the same control the terrain bar
                  // stands there, and the rail's buttons never reach this deep.
                  marginRight: -(PAD.right - STRIP.right),
                }}
              >
                <StripChip
                  testId="shell-gen-scope"
                  name={t('gen.scope')}
                  value={scopeSays}
                  onOpen={() => setSelectingRegion(true)}
                />
                <span style={{ flex: '1 1 auto', minWidth: 0 }} />
                {/* The maze's own pair of switches, at the right with its knobs. The ends first:
                    off, the generator picks the pair and the map stays clear of marks; on, the two
                    marks stand as recipe settings. The way answers FOR THAT PAIR, so it refuses
                    until they are chosen — dimmed and standing, since a switch that arrived when
                    its neighbour was pressed pushed that neighbour along the strip, and a control
                    that moves under the hand that just pressed it is the one thing a toggle must
                    never do. */}
                {kind === 'maze' ? (
                  <StripSwitch testId="shell-gen-ends" label={t('gen.ends')} on={customEnds} onToggle={toggleEnds} />
                ) : null}
                {kind === 'maze' ? (
                  <StripSwitch
                    testId="shell-gen-route" label={t('gen.way')} on={showWay}
                    onToggle={() => setShowWay(!showWay)} disabled={!customEnds}
                  />
                ) : null}
                {/* THE SAME SLOT ON EVERY KIND, holding one control. A picture kind's is its choice of
                    material, which is a segmented control and not a slider: there is no range between
                    water and a building. */}
                {stencil ? (
                  <Knob
                    groove={false}
                    control={(
                      // THE WORDS ON THE SEGMENTS SAY WHAT THE CHOICE IS, so the group's name is not
                      // drawn: it would repeat them, and the strip has no width to spend saying a
                      // thing twice. The sliders beside it keep their names because a track is not a
                      // word. It is still ANNOUNCED, since a reader arriving at unexplained words
                      // needs to know what they are a set of.
                      <span
                        role="group"
                        aria-label={t('gen.built_from')}
                        style={{ pointerEvents: 'auto', display: 'flex' }}
                        data-testid="shell-gen-fill"
                      >
                        <SegmentedControl
                          idPrefix="gen-fill"
                          height={STRIP.h}
                          value={fillKind}
                          options={fillKindsFor(kind)}
                          onChange={(next) => {
                            setFillKind(next);
                            // Choosing OBJECT for a LETTER with nothing chosen opens the shelf that
                            // chooses one. A PICTURE never does: it matches every cell against the
                            // catalogue's own colours, so its items pick themselves.
                            if (fillTakesItem(kind, next) && !fillItem) setPickingItem(true);
                          }}
                          render={(o) => t(fillLabelKey(kind, o))}
                          stretch={false}
                          fontSize={TEXT.label}
                        />
                      </span>
                    )}
                  />
                ) : (
                  <Knob
                    label={upper.label}
                    control={(
                      <BarSlider
                        art={SLIDER_ART} shape={sliders.upper} ticks={SLIDER_TICKS}
                        min={upper.min} max={upper.max}
                        value={upper.value} onChange={upper.set} label={upper.label}
                        valueText={upper.reading}
                      />
                    )}
                  />
                )}

                {/*
                  WHICH ITEM A LETTER IS TILED WITH: the chip both names it and is the way back to
                  the shelf that chooses it; without it, nothing on the strip says what was chosen
                  or offers another.

                  IT STANDS ON EVERY LETTER, dimmed and refusing while the letter is being raised as
                  terrain, because a control that comes and go as its neighbour is pressed shoves
                  every knob beside it and the visitor's aim with them. A picture names its own items
                  by colour, so it has no such question at all: that is a MODE difference, and a mode
                  swaps its whole row.
                */}
                {kind === 'text' ? (
                  <StripChip
                    testId="shell-gen-item"
                    name={t('gen.fill_item')}
                    value={takesItem ? itemName ?? t('gen.fill_pick') : t('gen.not_applicable')}
                    width={STRIP.chip}
                    disabled={!takesItem}
                    onOpen={() => setPickingItem(true)}
                  />
                ) : null}

                {/* A PICTURE'S CONTRAST decides how much of the palette it reaches, so it stands on
                    every picture whatever the picture is made of. */}
                {kind === 'image' ? (
                  <Knob
                    label={t('gen.contrast')}
                    control={(
                      <BarSlider
                        art={SLIDER_ART} shape={sliders.upper} ticks={SLIDER_TICKS}
                        min={CONTRAST.min} max={CONTRAST.max}
                        value={contrast} onChange={setContrast} label={t('gen.contrast')}
                        valueText={t('gen.percent', { n: contrast })}
                      />
                    )}
                  />
                ) : null}

                {/* THE TALLEST LAYER, on every kind that has one — which is every kind but the
                    LETTER, and that is a mode difference rather than a state: a letter stands exactly
                    one layer on the surface the region already holds, so the knob is not among the
                    controls that mode offers at all.

                    Within a mode it never moves. A PICTURE'S heights ARE its colours, so the knob is
                    the depth of the terrain ramp and means nothing once the picture is tiled with
                    items instead: there it stands dimmed and refusing, reading n/a, exactly as the
                    terrain bar's width slider does for the tools laid to their own size. */}
                {kind !== 'text' ? (
                  <Knob
                    label={t('gen.max_layer')}
                    control={(
                      // `BarSlider` wears the dimming itself when it refuses, so there is no wrapper
                      // here: two of them multiply and the knob goes past faint to invisible.
                      <BarSlider
                        art={SLIDER_ART} shape={sliders.maxLayer} ticks={SLIDER_TICKS}
                        min={floor} max={ceiling}
                        value={elevation} onChange={setMaxElevation} label={t('gen.max_layer')}
                        valueText={takesElevation ? layerName(t, elevation) : t('gen.not_applicable')}
                        disabled={!takesElevation}
                      />
                    )}
                  />
                ) : null}
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </>
  );
}
