/**
 * The generate shelf's batch against the live map, or the map a Help figure hands in: the samples a
 * picture kind deals from and its hand, which recipe a card stands for, its plan, candidate and picture built on
 * detached copies (restored from the caches where they answer, else after the settings settle), the
 * landing of one card at a time, and Clear. `createGenerateBatch` is the session's external store:
 * it reads the recipe, the painted region and the maze's ends itself, holds the pictures and flags
 * the shelf shows and writes the landed card to the store after the run lands. The live shelf's
 * batch is on show while it is open (`landCard`, `clearLastRun`); this module never renders.
 */
import { SUPPORTS_WORKERS } from '../../platform/build/edition';
import { BRAND_LOGO_URL } from '../../assets/brand-logo';
import { neighborPortraitUrl } from '../../assets/neighbor-urls';
import { NEIGHBORS } from '../../config/neighbors';
import type { LocalizedName } from '../../core/model/locale';
import { TERRAIN_GRID } from '../../core/game/profile';
import { cellSet } from '../../core/grid/grids';
import type { EditContext } from '../../core/commands/edit-context';
import type { GridState, MacroCoord, Rotation } from '../../core/model/types';
import {
  CANDIDATES, KIND_ENGINE, batchSeeds, kindConfig, regionFitsStencil, type GenerateKind, type KindSettings, type StencilKind,
} from '../../tools/generation/kinds';
import type { ResolvedMazeGates, StencilPlan } from '../../tools/generation/recipe';
import { scopeRequestFor } from '../../tools/generation/facts';
import {
  LETTER_SAMPLES, buildStencilPlan, ensureGlyphFonts, glyphFontsReady, peekStencilPlan, planInputsFor, regionAllow, stencilBoxFor,
  stencilFrame, textFitsBox, regionBox, type PlanInputs, type StencilBox, type StencilFillKind, type StencilSource,
} from '../../tools/generation/stencil';
import {
  defaultMazeGates, latticeField, mazeFootprint, onRing, resolveEnd, type MazeEnd, type MazeFootprint,
} from '../../tools/generation/maze';
import { focusFrame, renderThumbnail } from '../../view/map2d/capture/thumbnail';
import { clearGenerated, generateCandidate, generateMap, peekCandidate, type Candidate, type Outcome } from '../operations';
import { host } from '../host/host';
import { currentEditor } from '../session/context';
import { hasCustomCard } from './custom-card';
import { recipeElevation, type GenerateRecipeController } from './generate-recipe';
import { reportGenerate } from './generate-report';
import { holdEditInFlight } from '../../state/edits-in-flight';
import { regionOf } from '../../state/editing/region';
import { useEditorStore } from '../../state/store';
import { makeRng } from '../../core/base/rng';
import { createSignal } from '../../core/base/signal';

/** The visitor's own card, after the batch's dealt cards. */
const CUSTOM = CANDIDATES;
/** Wait for settings to settle before generating another batch, in milliseconds. */
const SETTLE_MS = 350;

/** A card's picture: a data URL, null for a card with no picture, undefined while it is being made. */
type Shot = string | null | undefined;
/** A slot the batch keeps across passes. */
interface Slot<T> { current: T }
type ShotFrame = ReturnType<typeof focusFrame>;
/** The batch's settings; each card adds its own seed. */
type BatchSettings = Omit<KindSettings, 'seed'>;
/** How a card is photographed: the long edge in device pixels and the picture slot's aspect. */
interface ShotSize { px: number; aspect: number }

/** What a picture kind builds from on the live map: the box it fills, whether the region fits it,
 *  the plan inputs, and whether a word fits the box (asked before any run). */
interface StencilInputs {
  box: StencilBox | null;
  fits: boolean;
  planInputs: PlanInputs | null;
  wordFits: (sample: StencilSource | null) => boolean;
}

interface StencilRecipe { kind: GenerateKind; fill: StencilFillKind; item: string | null; contrast: number; facing: Rotation }

/** `contrast` is the shelf's percentage. */
function stencilInputs(grid: GridState | null, region: readonly MacroCoord[], recipe: StencilRecipe): StencilInputs {
  const { input } = KIND_ENGINE[recipe.kind];
  const box = stencilBoxFor(grid, region);
  const planInputs = box
    ? planInputsFor(input ?? 'text', box, {
      fill: recipe.fill, item: recipe.item ?? '', contrast: recipe.contrast / 100, allow: regionAllow(grid, region), facing: recipe.facing,
    })
    : null;
  return {
    box, fits: regionFitsStencil(recipe.kind, box), planInputs,
    // A row of characters divides the region's width, so the floor scales with the word.
    wordFits: (sample) => input !== 'text' || !sample?.text || textFitsBox(sample.text, box && stencilFrame(box, recipe.facing), recipe.fill),
  };
}

/** Everything one pass over the batch reads and writes. */
interface Pass {
  stencil: boolean;
  /** The dealt samples of a stencil batch, else the seeds. */
  dealt: readonly (StencilSource | number)[];
  base: number;
  settings: BatchSettings;
  scope: MacroCoord[] | null;
  planInputs: PlanInputs | null;
  wordFits: (sample: StencilSource | null) => boolean;
  shotFrame: ShotFrame;
  shotSize: ShotSize;
  plans: Slot<(StencilPlan | null)[]>;
  candidates: Slot<(Candidate | null)[]>;
  setShot: (i: number, shot: Shot) => void;
  dropped: () => boolean;
  /** The map the batch builds against. */
  editor: () => EditContext | null;
}

/** The frame a card's picture shows: the painted region's box, or the map. */
function shotFrameFor(region: readonly MacroCoord[], grid: GridState | null, aspect: number): ShotFrame {
  return focusFrame(regionBox(region), grid?.template ?? null, aspect);
}

/** A card's picture carries its map's notes: a candidate holds none, and landing it leaves them. */
const photo = (candidate: Candidate | null, frame: ShotFrame, size: ShotSize, kit: EditContext | null): Promise<Shot> =>
  candidate
    ? renderThumbnail(candidate.state, size.px, { aspect: size.aspect, frame, notes: kit?.state.annotations ?? null })
    : Promise.resolve(null);
const seedOf = (pass: Pass, i: number): number => (pass.stencil ? pass.base + i : (pass.dealt[i] as number));

/**
 * A batch already answered comes back at once: every card peeks the plan and candidate caches
 * (synchronous reads) and only the pictures are re-read. Null on the first miss, with nothing spent.
 */
function peekBatch(kit: EditContext, pass: Pass): { plans: (StencilPlan | null)[]; peeked: (Candidate | null)[] } | null {
  const plans: (StencilPlan | null)[] = Array(pass.dealt.length).fill(null);
  if (pass.stencil) {
    for (let i = 0; i < pass.dealt.length; i++) {
      const entry = pass.dealt[i] as StencilSource;
      if (!pass.wordFits(entry)) continue; // a refused card: no plan, a null picture, no candidate
      const plan = peekStencilPlan(entry, pass.planInputs!);
      if (plan === undefined) return null;
      plans[i] = plan;
    }
  }
  const peeked: (Candidate | null)[] = [];
  for (let i = 0; i < pass.dealt.length; i++) {
    if (pass.stencil && !plans[i]) { peeked.push(null); continue; }
    const hit = peekCandidate(kit, { config: kindConfig({ ...pass.settings, seed: seedOf(pass, i), stencilPlan: plans[i] }), region: pass.scope });
    if (!hit) return null;
    peeked.push(hit);
  }
  return { plans, peeked };
}

/** Builds one card's plan, candidate and picture; a refused card drops its plan with its picture,
 *  and a card whose build or picture throws goes blank the same way, leaving the others to finish. */
async function previewCard(kit: EditContext, pass: Pass, i: number, signal: AbortSignal): Promise<void> {
  try {
    await buildCard(kit, pass, i, signal);
  } catch {
    if (pass.dropped()) return;
    pass.plans.current[i] = null;
    pass.candidates.current[i] = null;
    pass.setShot(i, null);
  }
}

async function buildCard(kit: EditContext, pass: Pass, i: number, signal: AbortSignal): Promise<void> {
  const entry = pass.dealt[i]!;
  const plan = pass.stencil && pass.planInputs && pass.wordFits(entry as StencilSource)
    ? await buildStencilPlan(entry as StencilSource, pass.planInputs)
    : null;
  if (pass.dropped()) return;
  if (pass.stencil && !plan) { pass.plans.current[i] = null; pass.setShot(i, null); return; }
  pass.plans.current[i] = plan;
  const candidate = await generateCandidate(
    kit, { config: kindConfig({ ...pass.settings, seed: seedOf(pass, i), stencilPlan: plan }), region: pass.scope, signal },
  );
  if (pass.dropped()) return;
  pass.candidates.current[i] = candidate;
  // The picture waits on the map's icons decoding, so the batch may be dropped by the time it is back.
  const shot = await photo(candidate, pass.shotFrame, pass.shotSize, kit);
  if (!pass.dropped()) pass.setShot(i, shot);
}

/** Where one pass writes what it shows: the batch store's own fields. */
interface Sink {
  setShots: (next: Shot[] | ((prev: Shot[]) => Shot[])) => void;
  setPreviewing: (on: boolean) => void;
  setCustomShot: (shot: Shot) => void;
  setCustomPending: (on: boolean) => void;
  forgetApplied: () => void;
  clearFailed: () => void;
  /** The map the cards build against. */
  editor: () => EditContext | null;
}

/** What one pass over the batch's dealt cards is built from: a picture kind's `hand`, else the `seeds`. */
interface BatchInputs {
  stencil: boolean; fits: boolean;
  /** Whether a picture may be taken now: a map stands and no region is being painted. */
  ready: boolean;
  fontsReady: boolean;
  hand: readonly StencilSource[]; seeds: readonly number[]; base: number;
  settings: BatchSettings; scope: MacroCoord[] | null; planInputs: PlanInputs | null;
  wordFits: (sample: StencilSource | null) => boolean; shotFrame: ShotFrame;
}

/** What one pass over the visitor's own card is built from. */
interface OwnInputs {
  stencil: boolean; fits: boolean; ready: boolean; ownFontsReady: boolean; ownSample: StencilSource | null;
  customSeed: number | null; base: number; settings: BatchSettings; scope: MacroCoord[] | null;
  planInputs: PlanInputs | null; wordFits: (sample: StencilSource | null) => boolean; shotFrame: ShotFrame;
}

/** The slots a batch keeps across its passes. */
interface Slots {
  plans: Slot<(StencilPlan | null)[]>;
  candidates: Slot<(Candidate | null)[]>;
  own: Slot<Candidate | null>;
}

/** One batch's previews: restored from the caches at once where they answer, else built after the
 *  settings settle. Returns the pass's disposer. */
function runBatch(o: BatchInputs, slots: Slots, sink: Sink, shotSize: ShotSize): (() => void) | undefined {
  const { stencil, fits, fontsReady, hand, seeds, base, settings, scope, planInputs, wordFits, shotFrame } = o;
  const { setShots, setPreviewing, forgetApplied, clearFailed } = sink;
  const plansRef = slots.plans, candidatesRef = slots.candidates;
  const blank = () => { candidatesRef.current = Array(CANDIDATES).fill(null); };
  // A picture kind with no room goes blank, plans included: a card that cannot show what it would build must not build.
  if (stencil && !fits) {
    setShots(Array(CANDIDATES).fill(null));
    blank();
    plansRef.current = Array(CANDIDATES + 1).fill(null);
    return undefined;
  }
  // Nothing is photographed while the region is painted: the next stroke would make every picture stale.
  if (!o.ready) return undefined;
  if (!fontsReady) {
    plansRef.current = [...Array(CANDIDATES).fill(null), plansRef.current[CUSTOM] ?? null];
    blank();
    setShots(Array(CANDIDATES).fill(undefined));
    setPreviewing(true);
    return () => { setPreviewing(false); };
  }
  let dropped = false;
  const controller = new AbortController();
  const { signal } = controller;
  const pass: Pass = {
    stencil, dealt: stencil ? hand : seeds, base, settings, scope, planInputs, wordFits, shotFrame, shotSize,
    plans: plansRef, candidates: candidatesRef, dropped: () => dropped, editor: sink.editor,
    setShot: (i, shot) => setShots((prev) => prev.map((s, j) => (j === i ? shot : s))),
  };
  const peekKit = pass.editor();
  const restored = peekKit && (!stencil || planInputs) ? peekBatch(peekKit, pass) : null;
  if (restored) {
    forgetApplied();
    clearFailed();
    candidatesRef.current = [...restored.peeked];
    plansRef.current = [...restored.plans, plansRef.current[CUSTOM] ?? null];
    // Cleared and repainted within one frame, so a card never shows another recipe's picture.
    setShots(Array(CANDIDATES).fill(undefined));
    void Promise.all(restored.peeked.map(async (candidate, i) => {
      const shot = await photo(candidate, shotFrame, shotSize, peekKit).catch((): Shot => null);
      if (!dropped) pass.setShot(i, shot);
    }));
    return () => { dropped = true; blank(); };
  }
  // Blank now rather than when the run starts, so the old pictures never stand under the new numbers.
  setShots(Array(CANDIDATES).fill(undefined));
  const run = async (): Promise<void> => {
    const kit = pass.editor();
    if (!kit) return;
    // What stands no longer answers this batch: the shelf lets go of it, and it stays on the map.
    forgetApplied();
    clearFailed();
    setPreviewing(true);
    try {
      // Without workers, one candidate finishes before the next is allocated; with them, the pool takes the batch at once.
      if (!SUPPORTS_WORKERS) {
        for (let i = 0; i < pass.dealt.length && !dropped; i++) await previewCard(kit, pass, i, signal);
      } else {
        await Promise.all(pass.dealt.map((_, i) => previewCard(kit, pass, i, signal)));
      }
    } finally {
      if (!dropped) setPreviewing(false);
    }
  };
  const timer = setTimeout(() => { void run(); }, SETTLE_MS);
  return () => {
    dropped = true;
    controller.abort();
    clearTimeout(timer);
    // A click in the gap before the next batch generates for real rather than landing a stale answer.
    blank();
  };
}

/** The visitor's own card: blank, waiting on its font, restored from the caches, or built after the
 *  settle. Returns the pass's disposer. */
function runOwn(o: OwnInputs, slots: Slots, sink: Sink, shotSize: ShotSize): (() => void) | undefined {
  const { stencil, fits, ownFontsReady, ownSample, customSeed, base, settings, scope, planInputs, wordFits, shotFrame } = o;
  const { setCustomShot, setCustomPending } = sink;
  const plansRef = slots.plans, customRef = slots.own;
  if (!o.ready || (stencil && !fits) || (stencil ? !ownSample : customSeed === null)) {
    customRef.current = null;
    setCustomShot(null);
    setCustomPending(false);
    return undefined;
  }
  if (!ownFontsReady) {
    plansRef.current[CUSTOM] = null;
    customRef.current = null;
    setCustomShot(undefined);
    setCustomPending(true);
    return undefined;
  }
  let dropped = false;
  const controller = new AbortController();
  const { signal } = controller;
  const config = (plan: StencilPlan | null) => kindConfig({ ...settings, seed: customSeed ?? base, ...(plan ? { stencilPlan: plan } : {}) });
  const wantsPlan = stencil && ownSample && planInputs && wordFits(ownSample);
  const land = (plan: StencilPlan | null, candidate: Candidate | null) => {
    plansRef.current[CUSTOM] = plan;
    customRef.current = candidate;
  };
  setCustomShot(undefined);
  const peekKit = sink.editor();
  const peekedPlan = peekKit ? (wantsPlan ? peekStencilPlan(ownSample!, planInputs!) : null) : undefined;
  if (stencil && peekedPlan === null) {
    // The cached answer is the refusal: the card comes back blank as the slow path leaves it.
    land(null, null);
    setCustomShot(null);
    setCustomPending(false);
    return () => { dropped = true; customRef.current = null; };
  }
  const hit = peekKit && peekedPlan !== undefined ? peekCandidate(peekKit, { config: config(peekedPlan), region: scope }) : null;
  if (hit) {
    land(peekedPlan ?? null, hit);
    setCustomPending(false);
    void photo(hit, shotFrame, shotSize, peekKit).catch((): Shot => null).then((shot) => { if (!dropped) setCustomShot(shot); });
    return () => { dropped = true; customRef.current = null; };
  }
  const build = async (kit: EditContext): Promise<void> => {
    const plan = wantsPlan ? await buildStencilPlan(ownSample!, planInputs!) : null;
    if (dropped) return;
    if (stencil && !plan) { plansRef.current[CUSTOM] = null; setCustomShot(null); setCustomPending(false); return; }
    plansRef.current[CUSTOM] = plan;
    const candidate = await generateCandidate(
      kit, { config: kindConfig({ ...settings, seed: customSeed ?? base, stencilPlan: plan }), region: scope, signal },
    );
    if (dropped) return;
    customRef.current = candidate;
    const shot = await photo(candidate, shotFrame, shotSize, kit);
    if (dropped) return;
    setCustomShot(shot);
    setCustomPending(false);
  };
  const run = async (): Promise<void> => {
    const kit = sink.editor();
    if (!kit) return;
    setCustomPending(true);
    try {
      await build(kit);
    } catch {
      // A build or picture that throws leaves the card blank rather than pending.
      if (dropped) return;
      land(null, null);
      setCustomShot(null);
      setCustomPending(false);
    }
  };
  const timer = setTimeout(() => { void run(); }, SETTLE_MS);
  return () => {
    dropped = true;
    controller.abort();
    clearTimeout(timer);
    customRef.current = null;
  };
}

/** One card's candidate for a kind's settings on `kit`, built as the batch builds its cards. */
export function kindCandidate(kit: EditContext, settings: KindSettings, region: MacroCoord[] | null, signal?: AbortSignal): Promise<Candidate | null> {
  return generateCandidate(kit, { config: kindConfig(settings), region, ...(signal ? { signal } : {}) });
}

/** What a card's click asks for: the card and the batch it stands in. */
interface CardAsk {
  index: number;
  stencil: boolean;
  base: number;
  customSeed: number | null;
  seeds: readonly number[];
  /** A picture kind's plan for the card, which is its recipe. */
  plan: StencilPlan | null;
  /** Whether the region still fits a picture kind. */
  fits: boolean;
  /** Whether the card's preview is still being made. */
  pending: boolean;
  /** Whether the own card's input passed its check. */
  ownAllowed: boolean;
}

/** The seed and plan a card lands with, or null when it cannot land now: still being made, an own
 *  card whose input was not approved, a picture kind without its plan or its room, or no seed. */
function cardRecipe(ask: CardAsk): { seed: number | null; plan: StencilPlan | null } | null {
  if (ask.index === CUSTOM && !ask.ownAllowed) return null;
  const plan = ask.stencil ? ask.plan : null;
  const seed = ask.stencil ? ask.base + ask.index : ask.index === CUSTOM ? ask.customSeed : ask.seeds[ask.index] ?? null;
  // A picture kind's region must still fit it: the plan is dropped the moment it does not, and this is the second lock.
  if (ask.pending || (ask.stencil ? !plan || !ask.fits : seed === null)) return null;
  return { seed, plan };
}

interface LandingRequest {
  settings: BatchSettings;
  /** The card's recipe number, or null where it has none to land. */
  seed: number | null;
  /** A picture kind's plan, which is its recipe; the seed then rides along unused. */
  plan: StencilPlan | null;
  /** Settings moved out from under a standing run; such a run never replays the card's cached candidate. */
  over?: Partial<KindSettings>;
  candidate: Candidate | null;
  region: MacroCoord[] | null;
  stencil: StencilKind | null;
}

/** A landing on its way: `done` settles with the landed outcome, or null when it was cancelled or
 *  its report refused it; it rejects when the run threw (the run rolled itself back). */
interface Landing { done: Promise<Outcome | null>; abort: () => void }

/** Lands a card's run on the live map as one undo step; null with no live map. */
function landCandidate(ask: LandingRequest): Landing | null {
  const kit = currentEditor();
  if (!kit) return null;
  const controller = new AbortController();
  const { signal } = controller;
  const done = (async () => {
    const outcome = await generateMap(kit, {
      config: kindConfig({ ...ask.settings, ...ask.over, seed: ask.seed ?? 0, ...(ask.plan ? { stencilPlan: ask.plan } : {}) }),
      region: ask.region,
      signal,
      candidate: ask.over ? null : ask.candidate,
    });
    if (signal.aborted || outcome.cancelled) return null;
    host.resync();
    // The scope highlight stays up: the region still bounds the next run until the scope screen clears it.
    host.feedback.flash([cellSet(TERRAIN_GRID, outcome.cells)]);
    return reportGenerate(outcome, ask.stencil) ? outcome : null;
  })();
  const abort = (): void => controller.abort();
  // Held as landing until it settles, so whatever takes the map back cancels it first.
  const release = holdEditInFlight(abort, 'build');
  void done.then(release, release);
  return { done, abort };
}

/** One example a picture kind deals: a letter to build, or a picture to build from. */
export interface StencilSample extends StencilSource {
  id: string;
  /** What a picture is, where it is not the app's own mark: a neighbour's name, since none of these
   *  pictures is a catalog item. */
  name?: LocalizedName;
}

/** What a picture kind's batch is dealt from: its input is the recipe, so a pool's order is part of
 *  a hand's seed. Pictures are the app's own mark, then each neighbour whose portrait ships. */
const POOLS: Readonly<Record<StencilKind, readonly StencilSample[]>> = {
  text: LETTER_SAMPLES.map((text) => ({ id: text, text })),
  image: [
    { id: 'logo', src: BRAND_LOGO_URL },
    ...NEIGHBORS.flatMap(({ id, name }) => {
      const src = neighborPortraitUrl(id);
      return src ? [{ id, src, name }] : [];
    }),
  ],
};

/** The samples a picture kind deals its batch from. */
export function samplePool(input: StencilKind): readonly StencilSample[] {
  return POOLS[input];
}

/**
 * The hand a picture kind's batch is dealt: `CANDIDATES` samples drawn from `pool` without
 * replacement by `seed`, the batch seed the terrain kinds use; a pool shorter than the hand deals all
 * of it. New batch deals another seeded hand, and the visitor's own card is untouched.
 */
function dealHand<T>(pool: readonly T[], seed: number): T[] {
  if (pool.length <= CANDIDATES) return [...pool];
  const rng = makeRng(seed);
  const bag = [...pool];
  const out: T[] = [];
  for (let i = 0; i < CANDIDATES; i++) {
    out.push(...bag.splice(Math.floor(rng.float() * bag.length), 1));
  }
  return out;
}

interface BatchKeyParts {
  kind: GenerateKind; richness: number; maxElevation: number; corridorWidth: number;
  /** The maze's chosen ends, for a kind with gates. */
  gates: ResolvedMazeGates | null;
  /** A picture kind's material and knobs and the box it fills; null for the other kinds. */
  stencil: { fill: StencilFillKind; item: string | null; contrast: number; facing: Rotation; box: StencilBox | null } | null;
}

/** The batch's identity: every setting its cards are a function of, the seeds aside. */
function batchKey(p: BatchKeyParts): string {
  return JSON.stringify([
    p.kind, p.richness, p.maxElevation, p.corridorWidth, KIND_ENGINE[p.kind].gates ? p.gates : null,
    p.stencil ? [p.stencil.fill, p.stencil.item, p.stencil.contrast, p.stencil.box, p.stencil.facing] : null,
  ]);
}

/** What the shelf shows of its batch. */
interface BatchView {
  shots: readonly Shot[];
  customShot: Shot;
  customPending: boolean;
  previewing: boolean;
  /** The card whose run is on its way to the map; one lands at a time. */
  landingIndex: number | null;
  /** The card whose run threw and rolled itself back, said for `failedMs`. */
  failedIndex: number | null;
}

/** What only the page can tell the batch: whether the faces its letters draw in have arrived, and
 *  whether the own card's typed text passed its check. */
interface PageInputs { fontsReady: boolean; ownFontsReady: boolean; ownAllowed: boolean }

/** The maze's ends as the batch reads and tells them (`maze-ends.ts:createMazeEnds`). */
interface EndsSession {
  gates(inputs: { maze: boolean; gridState: GridState | null; scope: MacroCoord[] | null; corridorWidth: number }): ResolvedMazeGates | null;
  /** What a landed run reported (the maze reads its ends from it). */
  landed(outcome: Outcome): void;
  forgetLanded(): void;
  cancelDrag(): void;
}

/** What the batch is built from now: the recipe, the map and its painted region, read together. */
interface BatchRead {
  kind: GenerateKind;
  /** What a picture kind reads ahead of the run; null for a kind built from its recipe alone. */
  input: StencilKind | null;
  /** The painted region, or null for the whole map: what a run takes. */
  scope: MacroCoord[] | null;
  /** Whether a picture may be taken now: a map stands and no region is being painted. */
  ready: boolean;
  settings: BatchSettings;
  base: number;
  seeds: readonly number[];
  customSeed: number | null;
  /** A picture kind's dealt samples. */
  hand: readonly StencilSample[];
  /** The own card's input, before its check. */
  ownSample: StencilSource | null;
  box: StencilBox | null;
  fits: boolean;
  planInputs: PlanInputs | null;
  wordFits: (sample: StencilSource | null) => boolean;
  shotFrame: ShotFrame;
  /** The batch's identity: every setting its cards are a function of, the seeds aside. */
  key: string;
}

/** What became of a card's press: `unavailable` for a card that cannot land now, `busy` while
 *  another lands, `closed` with no shelf open; `cancelled` covers a run its report refused. */
export type CardLanding = 'landed' | 'cancelled' | 'failed' | 'busy' | 'unavailable' | 'closed';

interface BatchOptions {
  /** How a card is photographed. */
  shotSize: ShotSize;
  /** How long a card says its run did not build, in ms. */
  failedMs: number;
  /** The recipe the cards are dealt from. */
  recipe: Pick<GenerateRecipeController, 'get'>;
  /** The maze's ends, where the surface lets the visitor choose them. */
  ends?: EndsSession;
  /** The map the cards build against where it is not the live editor's (a Help figure's sandbox);
   *  such a batch reads no painted region, lands nothing and leaves the store alone. */
  kit?: EditContext;
}

interface GenerateBatch {
  get(): BatchView;
  subscribe(listener: () => void): () => void;
  /** What the batch is built from now. */
  read(): BatchRead;
  /** The page says what only it knows; the next pass and the next landing read it. */
  publish(inputs: PageInputs): void;
  /** Starts a pass over the dealt cards; returns its disposer. */
  previewBatch(): (() => void) | undefined;
  /** Starts a pass over the visitor's own card; returns its disposer. */
  previewOwn(): (() => void) | undefined;
  candidateAt(index: number): Candidate | null;
  /** Lands card `index`'s run, unless one is on its way: its run stands as the landed card once it lands. */
  landCard(index: number): Promise<CardLanding>;
  /** A maze end was dropped: where a run stands, it lands again at its own seed as another maze
   *  with `gates`, one drop making one generation and one undo step. */
  relandStanding(gates: ResolvedMazeGates): void;
  /** The own card's recipe changed: it is let go if it is the card standing on the map. */
  ownChanged(): void;
  /** Puts a live batch on show, so a card's command lands on it; returns the take-down. */
  show(): () => void;
  /** The shelf closed: the landing on its way is cancelled and the landed card let go. */
  dispose(): void;
}

/** What a batch on show answers for. */
interface ShownBatch {
  landCard(index: number): Promise<CardLanding>;
  /** The last run left the map (Clear): the landed card and the maze's landed ends go with it. */
  runCleared(): void;
  /** The kind the shelf's recipe holds. */
  kind(): GenerateKind;
}

/** The live shelves' batches while they are open, the newest last: a Help page stands the shelf
 *  itself over the frame's. */
const onShow: ShownBatch[] = [];

const NO_REGION: MacroCoord[] = [];

/** Everything a picture kind's inputs are a function of. */
type StencilKey = readonly [GridState | null, MacroCoord[], GenerateKind, StencilFillKind, string | null, number, Rotation];

/** `make`'s answer for the key it was last asked with, its members compared by identity. */
function latest<K extends readonly unknown[], V>(make: (key: K) => V): (key: K) => V {
  let last: { key: K; value: V } | null = null;
  return (key) => {
    if (!last || last.key.some((v, i) => !Object.is(v, key[i]))) last = { key, value: make(key) };
    return last.value;
  };
}

export function createGenerateBatch(options: BatchOptions): GenerateBatch {
  const { shotSize, failedMs, recipe, ends, kit } = options;
  let view: BatchView = {
    shots: Array(CANDIDATES).fill(undefined), customShot: null, customPending: false, previewing: false,
    landingIndex: null, failedIndex: null,
  };
  const published = createSignal();
  const set = (next: Partial<BatchView>): void => {
    view = { ...view, ...next };
    published.emit();
  };
  const slots: Slots = {
    plans: { current: Array(CANDIDATES + 1).fill(null) },
    candidates: { current: Array(CANDIDATES).fill(null) },
    own: { current: null },
  };
  let page: PageInputs = { fontsReady: true, ownFontsReady: true, ownAllowed: true };
  let failedTimer: ReturnType<typeof setTimeout> | null = null;
  let landing: Landing | null = null;

  const stencilOf = latest(([grid, region, kind, fill, item, contrast, facing]: StencilKey) =>
    stencilInputs(grid, region, { kind, fill, item, contrast, facing }));
  /** Dealt by the same base seed the terrain kinds draw from. */
  const handOf = latest(([input, base]: readonly [StencilKind | null, number]): readonly StencilSample[] => (input ? dealHand(samplePool(input), base) : []));
  const frameOf = latest(([region, grid]: readonly [MacroCoord[], GridState | null]) => shotFrameFor(region, grid, shotSize.aspect));

  const read = (): BatchRead => {
    const store = useEditorStore.getState();
    const grid = kit ? kit.state : store.gridState;
    const region = kit ? NO_REGION : regionOf(store, 'generator');
    const state = recipe.get();
    const { kind, richness, corridorWidth, fillItem, contrast, facing } = state;
    const { base, customSeed, fillKind } = state.byKind[kind];
    const { input, gates: gated } = KIND_ENGINE[kind];
    const fill = input ? fillKind : 'mountain';
    const scope = region.length > 0 ? region : null;
    const maxElevation = recipeElevation(state);
    const gates = ends?.gates({ maze: gated, gridState: grid, scope, corridorWidth }) ?? null;
    const { box, fits, planInputs, wordFits } = stencilOf([grid, region, kind, fill, fillItem, contrast, facing]);
    const ownSample = input === 'text'
      ? (state.ownText ? { text: state.ownText } : null)
      : input === 'image' ? (state.ownImage ? { src: state.ownImage.src } : null) : null;
    return {
      kind, input, scope, ready: !!grid && (!!kit || !store.selectingRegion),
      settings: { kind, richness, maxElevation, corridorWidth, gates },
      base, seeds: batchSeeds(base), customSeed, hand: handOf([input, base]), ownSample, box, fits, planInputs, wordFits,
      shotFrame: frameOf([region, grid]),
      key: batchKey({
        kind, richness, maxElevation, corridorWidth, gates,
        stencil: input ? { fill, item: fillItem, contrast, facing, box } : null,
      }),
    };
  };
  /** What both passes read alike. */
  const passInputs = (now: BatchRead) => ({
    stencil: now.input !== null, fits: now.fits, ready: now.ready, base: now.base, settings: now.settings,
    scope: now.scope, planInputs: now.planInputs, wordFits: now.wordFits, shotFrame: now.shotFrame,
  });

  const clearFailed = (): void => {
    if (failedTimer) clearTimeout(failedTimer);
    failedTimer = null;
    if (view.failedIndex !== null) set({ failedIndex: null });
  };
  const letGoStored = (): void => {
    const store = useEditorStore.getState();
    if (!kit && store.generateApplied) store.setGenerateApplied(null);
  };
  /** Lets go of the landed card and leaves its run standing: the click was the answer, and undo is
   *  the way back. A maze end's drag goes with it. */
  const forgetApplied = (): void => {
    ends?.cancelDrag();
    letGoStored();
  };
  const sink: Sink = {
    setShots: (next) => set({ shots: typeof next === 'function' ? next([...view.shots]) : next }),
    setPreviewing: (previewing) => set({ previewing }),
    setCustomShot: (customShot) => set({ customShot }),
    setCustomPending: (customPending) => set({ customPending }),
    forgetApplied, clearFailed,
    editor: () => kit ?? currentEditor(),
  };
  const candidateAt = (i: number): Candidate | null => (i === CUSTOM ? slots.own.current : slots.candidates.current[i] ?? null);

  const settle = async (index: number, run: Landing): Promise<CardLanding> => {
    try {
      const outcome = await run.done;
      if (!outcome) return 'cancelled';
      useEditorStore.getState().setGenerateApplied(index);
      ends?.landed(outcome);
      return 'landed';
    } catch {
      set({ failedIndex: index });
      failedTimer = setTimeout(() => { failedTimer = null; set({ failedIndex: null }); }, failedMs);
      return 'failed';
    } finally {
      if (landing === run) landing = null;
      set({ landingIndex: null });
    }
  };

  /** `over` holds settings moved out from under a standing run. */
  const landCard = (index: number, over?: Partial<KindSettings>): Promise<CardLanding> => {
    const now = read();
    const stencil = now.input !== null;
    // The own card lands only where the build offers it, and a picture kind's only what the visitor
    // gave it: its plan slot may still hold the other picture kind's.
    const ownMissing = index === CUSTOM && (!hasCustomCard(now.kind) || (stencil && !now.ownSample));
    if (kit || ownMissing) return Promise.resolve('unavailable');
    const card = cardRecipe({
      index, stencil, base: now.base, customSeed: now.customSeed, seeds: now.seeds,
      plan: stencil ? slots.plans.current[index] ?? null : null, fits: now.fits,
      pending: index === CUSTOM ? view.customPending : view.previewing && view.shots[index] === undefined,
      ownAllowed: page.ownAllowed,
    });
    if (!card) return Promise.resolve('unavailable');
    ends?.cancelDrag();
    if (view.landingIndex !== null) return Promise.resolve('busy');
    const run = landCandidate({
      settings: now.settings, seed: card.seed, plan: card.plan, ...(over ? { over } : {}), candidate: candidateAt(index),
      region: now.scope, stencil: now.input,
    });
    if (!run) return Promise.resolve('unavailable');
    letGoStored();
    clearFailed();
    landing = run;
    set({ landingIndex: index });
    return settle(index, run);
  };
  const shown: ShownBatch = {
    landCard: (index) => landCard(index),
    runCleared() {
      forgetApplied();
      ends?.forgetLanded();
    },
    kind: () => recipe.get().kind,
  };

  return {
    get: () => view,
    subscribe: (listener) => published.subscribe(listener),
    read,
    publish(inputs) { page = inputs; },
    previewBatch() {
      const now = read();
      return runBatch({ ...passInputs(now), fontsReady: page.fontsReady, hand: now.hand, seeds: now.seeds }, slots, sink, shotSize);
    },
    previewOwn() {
      const now = read();
      return runOwn({
        ...passInputs(now), ownFontsReady: page.ownFontsReady, ownSample: page.ownAllowed ? now.ownSample : null, customSeed: now.customSeed,
      }, slots, sink, shotSize);
    },
    candidateAt,
    landCard: shown.landCard,
    relandStanding(gates) {
      const standing = kit ? null : useEditorStore.getState().generateApplied?.card ?? null;
      if (standing !== null) void landCard(standing, { gates });
    },
    ownChanged() {
      if (!kit && useEditorStore.getState().generateApplied?.card === CUSTOM) forgetApplied();
    },
    show() {
      if (kit) return () => {};
      onShow.push(shown);
      return () => {
        const at = onShow.indexOf(shown);
        if (at >= 0) onShow.splice(at, 1);
      };
    },
    dispose() {
      clearFailed();
      landing?.abort();
      letGoStored();
    },
  };
}

/** Lands card `index` of the batch on show, the visitor's own card standing after the dealt ones. */
export function landCard(index: number): Promise<CardLanding> {
  const batch = onShow[onShow.length - 1];
  return batch ? batch.landCard(index) : Promise.resolve('closed');
}

/** Clears the last run, bounded by its region and sparing placements made by hand there, and tells
 *  the batches on show. False with no live map. */
export function clearLastRun(): boolean {
  const kit = currentEditor();
  if (!kit) return false;
  clearGenerated(kit, { region: null });
  host.resync();
  for (const batch of [...onShow]) batch.runCleared();
  return true;
}

/** Starts painting Generate's region as the shelf's scope chip does, with the brush the kind on show
 *  asks for (`scopeRequestFor`); false with no shelf open. */
export function paintGenerateScope(): boolean {
  const batch = onShow[onShow.length - 1];
  if (!batch) return false;
  useEditorStore.getState().setSelectingRegion(true, 'generator', scopeRequestFor(batch.kind()));
  return true;
}

/** Whether the shipped faces a letter card draws `text` in have arrived, so its picture shows the glyph it lays. */
export function stencilFontsReady(text: string): boolean {
  return glyphFontsReady(text);
}

/** Fetches the faces a letter card draws `text` in; resolves once each arrived or failed. */
export function loadStencilFonts(text: string): Promise<void> {
  return ensureGlyphFonts(text);
}

/** The maze's two marks over the map, each a hole on the outer ring or a target inside. */
export interface MazeMarks { entrance: MazeEnd | null; exit: MazeEnd | null }

/** Where a maze over `scope` lays its lattice; null where none fits. */
export function mazeFootprintOn(grid: GridState | null, scope: MacroCoord[] | null, corridorWidth: number): MazeFootprint | null {
  return grid ? mazeFootprint(grid, scope, corridorWidth) : null;
}

/** The pair a maze opens by default on its footprint. */
export function defaultGatesOn(footprint: MazeFootprint): ResolvedMazeGates {
  return defaultMazeGates(footprint);
}

/** The marks `gates` stand at on the footprint. */
export function mazeMarks(grid: GridState, footprint: MazeFootprint, gates: ResolvedMazeGates): MazeMarks {
  const field = latticeField(grid, footprint);
  const endOf = (c: MacroCoord | null): MazeEnd | null => (c ? { cell: c, kind: onRing(field, c.x, c.y) ? 'hole' : 'target' } : null);
  return { entrance: endOf(gates.entrance), exit: endOf(gates.exit) };
}

/** Where a mark dragged to `cell` snaps on the live map's lattice; null where it cannot stand. */
export function snapMazeEnd(scope: MacroCoord[] | null, corridorWidth: number, cell: MacroCoord): MazeEnd | null {
  const kit = currentEditor();
  if (!kit) return null;
  const fp = mazeFootprint(kit.state, scope, corridorWidth);
  return fp ? resolveEnd(latticeField(kit.state, fp), cell) : null;
}
