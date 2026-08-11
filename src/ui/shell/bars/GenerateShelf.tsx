/*
 * GenerateShelf.tsx — the bottom bar for 生成 mode: the kinds of island as its row of names, the
 * candidates standing on the backing band, and the settings in the band under them.
 *
 * THREE BANDS. The names are on the map and carry nothing but the four kinds; the cards stand UP out
 * of the backing band (`units.ts:PLATE_BAND`) with the batch tile at their end; the settings sit
 * INSIDE the plate, in the room that runs to the bottom of the window and that only the object
 * shelf was using, for its scrollbar. There is no fourth thing, and the shelf had eleven: the
 * earth/water/mixed toggle became the names, the seed field became the last card, New batch became
 * the tile, and Clear went to the menu, where the one destructive action here belongs.
 *
 * THE SHELF HAS NO TOTAL WIDTH. A control is as wide as its own label at a fixed type size, and the
 * cards give up width to whatever a language needs, which is the only way "Естественность" and
 * 自然度 both read at full size in the same place.
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
 * A CLICK IS THE ANSWER, AND THERE IS NO SECOND STEP. There was a Keep button that finalised what a
 * click had provisionally applied, which made the click mean less than it looked like it meant and
 * put the difference nowhere a person could read it. Clicking a card lands the map; undo is the way
 * back, the same way back every other edit in this editor has.
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
 * switch appears only once the ends are chosen (it answers for that pair, and the strip stays
 * shallow for everyone who never touches them), and it is a DRAPE, not an edit: a road's flat
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
import { renderThumbnail } from '../../../canvas/thumbnail';
import { useT } from '../../../i18n/context';
import type { GridState, MacroCoord, ResolvedMazeGates } from '../../../core/model/types';
import { currentKit } from '../../../kit/context';
import { host } from '../../../kit/host';
import { clearGenerated, generateCandidate, generateMap, type Candidate } from '../../../kit/operations';
import { useEditorStore } from '../../../state/store';
import { useScrollFade } from '../../primitives/scroll-fade';
import type { GenSignal } from '../../../tools/generation/placement';
import { latticeField, mazeFootprint } from '../../../tools/generation/maze-generator';
import {
  onRing, resolveEnd, type MazeEnd, type MazeField,
} from '../../../tools/generation/maze-endpoints';
import { layerName } from '../layer-name';
import { ScaleProvider, usePx } from '../../design/scale';
import { btnReset, buttonMotion, cursors, z } from '../../design/styles';
import { GLYPHS } from '../frame';
import { GlyphIcon } from '../GlyphIcon';
import { IconTrash } from '../glyph-icons';
import { DARK_GROOVE, MUTED_INK, ON_DARK, PLATE, PLATE_INK } from '../../design/tokens';
import { PLATE_BAND, SHELF_SCALE, SHELF_TABS, TEXT } from '../units';
import { BarSlider } from './BarSlider';
import { BarText } from './bar-atoms';
import { Switch } from '../../primitives/Switch';
import { CandidateCard, CustomCard } from './CandidateCard';
import { MazeEndpoints, type EndId, type MazeEnds } from './MazeEndpoints';
import { ScopeScreen } from './ScopeScreen';
import { useFrameZoom, wheelGlider, wheelPush } from './row-scroll';
import { ShelfTabs, TAB_ROW } from './ShelfTabs';
import {
  BAR, BATCH, PAIR_GAP, BODY_H, CANDIDATES, CARD, CARD_H, CHOSEN, CORRIDOR, GAP, NATURALNESS, PAD, SEED_MAX, SLIDERS,
  STRIP, TABS, batchSeeds, maxElevationFor, minElevationFor, newSeed, shelfConfig, type GenerateKind, type ShelfSettings,
} from './generate-shelf';

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
const READING_MIN = 52;

/** How long a setting has to stop moving before a batch is worth starting. A slider drag would
 *  otherwise queue a batch per frame it passes through. */
const SETTLE_MS = 350;

/** How long a card says it did not build, in ms. Long enough to be read where the eye already is —
 *  on the card that was just clicked — and short enough that it is gone before the next click. */
const FAILED_MS = 4000;

/** The long side of a candidate picture, in device px. The card draws it at roughly a third of
 *  that, so this is headroom for a high-DPI screen and nothing more. */
const SHOT_PX = 640;

/** The cards and the tile at their end. It never wraps: the cards shrink together instead, since a
 *  candidate on a line of its own stops being one of the row to compare. */
const ROW: CSSProperties = {
  display: 'flex', alignItems: 'stretch', justifyContent: 'center', flexWrap: 'nowrap',
};


/**
 * The scope chip: what a run will act on, and the way into the screen that paints it.
 *
 * Name then value, like the knobs beside it, because it is another setting in the same strip. Empty
 * is not "nothing": a region nobody has painted is the whole island, which is what it says.
 */
function ScopeChip({ what, onOpen }: { what: string; onOpen: () => void }) {
  const t = useT();
  return (
    <motion.button
      type="button"
      {...buttonMotion}
      data-testid="shell-gen-scope"
      onClick={onOpen}
      style={{
        ...btnReset, flex: '0 0 auto', pointerEvents: 'auto', cursor: cursors.clickable,
        height: STRIP.h, padding: `0 ${STRIP.padX}px`, borderRadius: 999, background: PLATE,
        display: 'flex', alignItems: 'center', gap: 8,
      }}
    >
      <BarText size={TEXT.label} color={MUTED_INK}>{t('gen.scope')}</BarText>
      <BarText size={TEXT.label} color={PLATE_INK}>{what}</BarText>
    </motion.button>
  );
}

/**
 * A slider with its name before it and its reading after it, over the groove this shelf draws for
 * it. Three things on one line inside the strip, since the two knobs stand side by side there and
 * have no column to share.
 */
function Knob({ label, value, control }: {
  label: string;
  value: string;
  control: ReactNode;
}) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: GAP.sliderPart, flex: '0 0 auto' }}>
      <BarText size={TEXT.label} color={ON_DARK} align="left">{label}</BarText>
      {/* The reading stands BEFORE the track, which is where the terrain bar's brush reading stands
          and what leaves the TRACK as the last thing on the row: a slider in this interface ends on
          the view kit's own edge, and a reading after it would hold it that much short. Right
          aligned against a floor, so a number that grows as it counts cannot drag the track along. */}
      <BarText size={TEXT.label} color={ON_DARK} align="right" style={{ minWidth: READING_MIN }}>
        {value}
      </BarText>
      <span style={{ position: 'relative', display: 'flex' }}>
        <span
          style={{
            position: 'absolute', inset: 0, borderRadius: 999,
            background: DARK_GROOVE, pointerEvents: 'none',
          }}
        />
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
  const selectingRegion = useEditorStore((s) => s.selectingRegion);
  const setSelectingRegion = useEditorStore((s) => s.setSelectingRegion);
  /** `[]` is "no region painted", which means the whole island: the run takes null for it. */
  const scope = region.length > 0 ? region : null;

  const [kind, setKind] = useState<GenerateKind>('earth');
  const [base, setBase] = useState(newSeed);
  const [naturalness, setNaturalness] = useState<number>(NATURALNESS.max);
  const [maxElevation, setMaxElevation] = useState<number>(() => maxElevationFor('earth'));
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

  /** One per drawn card: `undefined` until its picture has been taken, `null` where none could be. */
  const [shots, setShots] = useState<(string | null | undefined)[]>(() => Array(CANDIDATES).fill(undefined));
  /** The runs behind the pictures, so a click lands one instead of generating the recipe again. A
   *  ref rather than state: nothing renders from them, and a batch carries thousands of commands. */
  const candidatesRef = useRef<(Candidate | null)[]>(Array(CANDIDATES).fill(null));

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

  const settings = { kind, naturalness, maxElevation: elevation, corridorWidth, gates: effectiveGates };
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
   */
  const forgetApplied = useCallback(() => {
    setAppliedIndex(null);
    setLandedGates(null);
    setWalk(null);
    setDragging(null);
  }, []);


  // The map is unusable while the bar is driving the generator, on the pointer as well as here.
  useEffect(() => {
    setCursorBusy(busy);
    return () => setCursorBusy(false);
  }, [busy]);

  // Both ends of this knob belong to the kind (water lies flat, a maze wall has nothing to stand on
  // above layer 3 and is not a wall at all on the ground), so a value outside them moves with a
  // switch rather than leaving the slider reading past its own end.
  useEffect(() => {
    setMaxElevation((v) => Math.min(Math.max(v, minElevationFor(kind)), maxElevationFor(kind)));
  }, [kind]);

  /*
   * The pictures. Every setting that reaches the generator is a dependency, because a picture that
   * outlived the setting it was made under would be a promise the click cannot keep.
   */
  const recipeKey = JSON.stringify([kind, naturalness, elevation, corridorWidth, kind === 'maze' ? effectiveGates : null]);
  const previewKey = `${recipeKey}|${base}`;
  useEffect(() => {
    // Nothing is worth photographing while the region is being painted: the next stroke would make
    // every picture a promise the click cannot keep, and the cards are not on screen anyway.
    if (!gridState || selectingRegion) return undefined;
    let dropped = false;
    const signal: GenSignal = { cancelled: false };
    /*
     * THE CARDS GO BLANK NOW, NOT WHEN THE RUN STARTS. The seeds change with the recipe, and the
     * pass that photographs them waits `SETTLE_MS` for the settings to stop moving — so a batch
     * cleared inside `run` left the OLD batch's pictures standing under the NEW batch's numbers for
     * a third of a second, which is a card saying it is a recipe it is not a picture of. Pending is
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
      await Promise.all(seeds.map(async (seed, i) => {
        const candidate = await generateCandidate(kit, {
          config: shelfConfig({ ...settings, seed }),
          region: scope,
          signal,
        });
        if (dropped) return;
        candidatesRef.current[i] = candidate;
        // The picture waits on the map's own icons being decoded, so it is taken asynchronously and
        // the batch may have been dropped by the time it is back.
        const shot = candidate ? await renderThumbnail(candidate.state, SHOT_PX, CARD.pic.w / CARD.pic.h) : null;
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
    if (!gridState || selectingRegion || customSeed === null) {
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
      const candidate = await generateCandidate(kit, {
        config: shelfConfig({ ...settings, seed: customSeed }),
        region: scope,
        signal,
      });
      if (dropped) return;
      customRef.current = candidate;
      const shot = candidate ? await renderThumbnail(candidate.state, SHOT_PX, CARD.pic.w / CARD.pic.h) : null;
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
  }, [recipeKey, customSeed, gridState, region, selectingRegion]);

  /**
   * Land a card's run, or re-land it with a maze setting moved out from under it.
   *
   * `over` is how a dragged end or a flipped way-switch reaches the generator ahead of React's own
   * state turn: the ends and the way are hyper-parameters of the maze — the carve grows out from
   * the entrance — so moving one while a run stands is asking for ANOTHER maze at the same seed.
   * An overridden run never replays the card's cached candidate, which was built without it.
   */
  const applyCandidate = useCallback(async (index: number, over?: Partial<ShelfSettings>) => {
    const kit = currentKit();
    const seed = seedAt(index);
    if (!kit || busy || seed === null) return;
    forgetApplied();
    clearFailed();
    setLandingIndex(index);
    try {
      const outcome = await generateMap(kit, {
        config: shelfConfig({ ...settings, ...over, seed }),
        region: scope,
        candidate: over ? null : candidateAt(index),
      });
      host.resync();
      // THE SCOPE HIGHLIGHT STAYS UP after the run lands: the region is still the bound on every
      // next run, and the drape is what says so. It comes down in one place only — the scope
      // screen's own Clear (use-region-brush), where the region itself is emptied.
      host.feedback.flash(outcome.cells, { terrainMode: true });
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
  }, [busy, clearFailed, forgetApplied, previewKey, customSeed, region]);

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
  }, [forgetApplied]);

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
  const cardsGlide = useRef(wheelGlider()).current;

  const reroll = useCallback(() => {
    if (busy) return;
    setBase(newSeed());
  }, [busy]);

  /** The typing has stopped: take the digits as a recipe number, or drop the card back to its
   *  question mark where there are none. No confirm, the way no other setting on this bar has one. */
  const commitCustom = useCallback(() => {
    const digits = (customDraft ?? '').replace(/\D/g, '');
    setCustomDraft(null);
    const next = digits ? Number(digits) % SEED_MAX : null;
    if (next === customSeed) return;
    setCustomSeed(next);
    // The card is about to be another recipe, so it can no longer be the one standing on the map.
    if (appliedIndex === CUSTOM) forgetApplied();
  }, [appliedIndex, customDraft, customSeed, forgetApplied, CUSTOM]);

  /** The upper track carries the knob the kind actually has: naturalness shapes an island and means
   *  nothing to a maze, which is turned by its corridor width instead. */
  interface UpperKnob {
    label: string;
    reading: string;
    min: number;
    max: number;
    value: number;
    set: (v: number) => void;
  }
  const upper: UpperKnob = kind === 'maze'
    ? {
      label: t('generate.corridor'),
      reading: t(corridorWidth === 1 ? 'agent2.n_cells_one' : 'agent2.n_cells', { n: corridorWidth }),
      min: CORRIDOR.min, max: CORRIDOR.max, value: corridorWidth, set: setCorridorWidth,
    }
    : {
      label: t('generate.naturalness'), reading: t('gen.percent', { n: naturalness }),
      min: NATURALNESS.min, max: NATURALNESS.max, value: naturalness, set: setNaturalness,
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


  /** What the chip says the scope is. */
  const scopeSays = scope
    ? t(scope.length === 1 ? 'agent2.n_cells_one' : 'agent2.n_cells', { n: scope.length })
    : t('gen.scope_all');

  // A SCREEN, NOT A SWAP: the shelf goes away while a region is painted, because the return is a
  // regeneration — every candidate is stale the moment the region changes, and cards left standing
  // would be a promise the next stroke breaks.
  if (selectingRegion) return <ScopeScreen onDone={() => setSelectingRegion(false)} />;

  return (
    <>
      <MazeEndpoints ends={shownEnds} onMove={onEndMove} />

      <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, pointerEvents: 'none', zIndex: z.panel }}>
        <div style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
          {/* The backing, as the design draws it: a band at the bottom of the window that the
              candidates stand UP out of, and that the strip sits inside. See `units.ts:PLATE_BAND`. */}
          <div
            style={{
              position: 'absolute',
              left: -PLATE_BAND.overhang, right: -PLATE_BAND.overhang,
              bottom: -PLATE_BAND.radius, height: PLATE_BAND.top + PLATE_BAND.radius,
              borderRadius: PLATE_BAND.radius, background: BAR.fill,
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
                kind, of language and of report. */}
            <div
              data-testid="shell-gen-body"
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
                onScroll={(e) => setCardsLeft(e.currentTarget.scrollLeft)}
                onWheel={(e) => {
                  const push = wheelPush(e, e.currentTarget.clientWidth, zoom);
                  if (push) cardsGlide.wheel(e.currentTarget, push.by, reducedMotion);
                }}
                style={{
                  ...ROW, gap: GAP.card,
                  // Content-sized, shrinkable: the pair after this row stands beside the last card
                  // when the row has room to spare, and only reaches the window's edge when the
                  // cards themselves do (the row then scrolls under it).
                  flex: '0 1 auto', minWidth: 0,
                  justifyContent: 'flex-start',
                  overflowX: 'auto', overflowY: 'hidden',
                  // The chosen card's plate stands outside the card's box, and a scroll container
                  // clips at its own edge — so the box is grown by the plate's overhang on every
                  // clipping side and pulled back by the same amount, leaving the layout where it
                  // was and the plate whole. `chosenOut` each side vertically and at the left edge;
                  // the right edge is the row's own gap to the pair, which is wider than the plate.
                  height: cardH + 2 * chosenOut,
                  margin: `${-chosenOut}px 0 ${-chosenOut}px ${-chosenOut}px`,
                  padding: `${chosenOut}px 0 ${chosenOut}px ${chosenOut}px`,
                  ...cardsFade,
                }}
              >
                {seeds.map((seed, i) => (
                  <div key={seed} style={{ flex: '0 0 auto', width: cardW }}>
                    <CandidateCard
                      seed={seed}
                      shot={shots[i]}
                      selected={appliedIndex === i}
                      failed={failedIndex === i}
                      landing={landingIndex === i}
                      onSelect={() => { void applyCandidate(i); }}
                    />
                  </div>
                ))}

                {/* The last one is the visitor's own: a recipe they name, in the row with the ones
                    named for them, rather than a field and a confirm step somewhere else. It scrolls
                    with them because it IS one of them. */}
                <div style={{ flex: '0 0 auto', width: cardW }}>
                  <CustomCard
                    seed={customSeed}
                    draft={customDraft}
                    shot={customShot}
                    selected={appliedIndex === CUSTOM}
                    failed={failedIndex === CUSTOM}
                    landing={landingIndex === CUSTOM}
                    onDraft={setCustomDraft}
                    onCommit={commitCustom}
                    onEdit={() => setCustomDraft(String(customSeed ?? ''))}
                    onSelect={() => { void applyCandidate(CUSTOM); }}
                  />
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
                <ScopeChip what={scopeSays} onOpen={() => setSelectingRegion(true)} />
                <span style={{ flex: '1 1 auto', minWidth: 0 }} />
                {/* The maze's own pair of switches, at the right with its knobs. The ends first:
                    off, the generator picks the pair and the map stays clear of marks; on, the two
                    marks stand as recipe settings. The way only APPEARS once the ends are chosen —
                    it answers for that pair, and a strip that carried it always would be one
                    control deeper for every visitor who never touches the ends. */}
                {kind === 'maze' ? (
                  <span
                    data-testid="shell-gen-ends"
                    style={{ display: 'flex', alignItems: 'center', gap: GAP.sliderPart, flex: '0 0 auto', pointerEvents: 'auto' }}
                  >
                    <BarText size={TEXT.label} color={ON_DARK} align="left">{t('gen.ends')}</BarText>
                    <Switch on={customEnds} onClick={toggleEnds} label={t('gen.ends')} />
                  </span>
                ) : null}
                {kind === 'maze' && customEnds ? (
                  <span
                    data-testid="shell-gen-route"
                    style={{ display: 'flex', alignItems: 'center', gap: GAP.sliderPart, flex: '0 0 auto', pointerEvents: 'auto' }}
                  >
                    <BarText size={TEXT.label} color={ON_DARK} align="left">{t('gen.way')}</BarText>
                    <Switch on={showWay} onClick={() => setShowWay(!showWay)} label={t('gen.way')} />
                  </span>
                ) : null}
                <Knob
                  label={upper.label}
                  value={upper.reading}
                  control={(
                    <BarSlider
                      art={SLIDER_ART} shape={SLIDERS.upper} ticks={SLIDER_TICKS}
                      min={upper.min} max={upper.max}
                      value={upper.value} onChange={upper.set} label={upper.label}
                    />
                  )}
                />
                <Knob
                  label={t('gen.max_layer')}
                  value={layerName(t, elevation)}
                  control={(
                    <BarSlider
                      art={SLIDER_ART} shape={SLIDERS.maxLayer} ticks={SLIDER_TICKS}
                      min={floor} max={ceiling}
                      value={elevation} onChange={setMaxElevation} label={t('gen.max_layer')}
                    />
                  )}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
