/**
 * The generate shelf's batch against the live map: which recipe a card stands for, its plan,
 * candidate and picture built on detached copies (restored from the caches where they answer, else
 * after the settings settle), the landing of one card, and Clear. The shelf holds the pictures and
 * flags as its own state and hands their setters in; this module never renders.
 */
import { SUPPORTS_WORKERS } from '../../platform/build/edition';
import { TERRAIN_GRID } from '../../core/game/profile';
import { cellSet } from '../../core/grid/grids';
import type { EditContext } from '../../core/commands/edit-context';
import type { GridState, MacroCoord } from '../../core/model/types';
import { CANDIDATES, KIND_ENGINE, kindConfig, regionFitsStencil, type GenerateKind, type KindSettings, type StencilKind } from '../../tools/generation/kinds';
import type { ResolvedMazeGates, StencilPlan } from '../../tools/generation/recipe';
import {
  buildStencilPlan, forgetStencilImage, peekStencilPlan, planInputsFor, regionAllow, stencilBoxFor, textFitsBox,
  regionBox, type PlanInputs, type StencilBox, type StencilFillKind, type StencilSource,
} from '../../tools/generation/stencil';
import {
  defaultMazeGates, latticeField, mazeFootprint, onRing, resolveEnd, type MazeEnd, type MazeFootprint,
} from '../../tools/generation/maze';
import { focusFrame, renderThumbnail } from '../../view/map2d/capture/thumbnail';
import { clearGenerated, generateCandidate, generateMap, peekCandidate, type Candidate, type Outcome } from '../operations';
import { host } from '../host/host';
import { currentEditor } from '../session/context';
import { reportGenerate } from './generate-report';

/** The visitor's own card, after the batch's dealt cards. */
const CUSTOM = CANDIDATES;
/** Wait for settings to settle before generating another batch, in milliseconds. */
const SETTLE_MS = 350;

/** A card's picture: a data URL, null for a card with no picture, undefined while it is being made. */
export type Shot = string | null | undefined;
/** A slot the shelf keeps across renders (a React ref fits). */
export interface Slot<T> { current: T }
type ShotFrame = ReturnType<typeof focusFrame>;
/** The batch's settings; each card adds its own seed. */
export type BatchSettings = Omit<KindSettings, 'seed'>;
/** How a card is photographed: the long edge in device pixels and the picture slot's aspect. */
export interface ShotSize { px: number; aspect: number }

/** What a picture kind builds from on the live map: the box it fills, whether the region fits it,
 *  the plan inputs, and whether a word fits the box (asked before any run). */
export interface StencilInputs {
  box: StencilBox | null;
  fits: boolean;
  planInputs: PlanInputs | null;
  wordFits: (sample: StencilSource | null) => boolean;
}

export interface StencilRecipe { kind: GenerateKind; fill: StencilFillKind; item: string | null; contrast: number }

/** `contrast` is the shelf's percentage. */
export function stencilInputs(grid: GridState | null, region: readonly MacroCoord[], recipe: StencilRecipe): StencilInputs {
  const { input } = KIND_ENGINE[recipe.kind];
  const box = stencilBoxFor(grid, region);
  const planInputs = box
    ? planInputsFor(input ?? 'text', box, { fill: recipe.fill, item: recipe.item ?? '', contrast: recipe.contrast / 100, allow: regionAllow(grid, region) })
    : null;
  return {
    box, fits: regionFitsStencil(recipe.kind, box), planInputs,
    // A row of characters divides the region's width, so the floor scales with the word.
    wordFits: (sample) => input !== 'text' || !sample?.text || textFitsBox(sample.text, box, recipe.fill),
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
}

/** The frame a card's picture shows: the painted region's box, or the map. */
export function shotFrameFor(region: readonly MacroCoord[], grid: GridState | null, aspect: number): ShotFrame {
  return focusFrame(regionBox(region), grid?.template ?? null, aspect);
}

const photo = (candidate: Candidate | null, frame: ShotFrame, size: ShotSize): Promise<Shot> =>
  candidate ? renderThumbnail(candidate.state, size.px, size.aspect, frame) : Promise.resolve(null);
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
  const shot = await photo(candidate, pass.shotFrame, pass.shotSize);
  if (!pass.dropped()) pass.setShot(i, shot);
}

export interface BatchPass {
  stencil: boolean; fits: boolean; ready: boolean; fontsReady: boolean;
  hand: readonly StencilSource[]; seeds: readonly number[]; base: number;
  settings: BatchSettings; scope: MacroCoord[] | null; planInputs: PlanInputs | null;
  wordFits: (sample: StencilSource | null) => boolean; shotFrame: ShotFrame; shotSize: ShotSize;
  plans: Slot<(StencilPlan | null)[]>; candidates: Slot<(Candidate | null)[]>;
  setShots: (next: Shot[] | ((prev: Shot[]) => Shot[])) => void; setPreviewing: (on: boolean) => void;
  forgetApplied: () => void; clearFailed: () => void;
}

/** One batch's previews: restored from the caches at once where they answer, else built after the
 *  settings settle. Returns the pass's disposer. */
export function previewBatch(o: BatchPass): (() => void) | undefined {
  const {
    stencil, fits, fontsReady, hand, seeds, base, settings, scope, planInputs, wordFits, shotFrame, shotSize, setShots, setPreviewing,
    forgetApplied, clearFailed,
  } = o;
  const plansRef = o.plans, candidatesRef = o.candidates;
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
    plans: plansRef, candidates: candidatesRef, dropped: () => dropped,
    setShot: (i, shot) => setShots((prev) => prev.map((s, j) => (j === i ? shot : s))),
  };
  const peekKit = currentEditor();
  const restored = peekKit && (!stencil || planInputs) ? peekBatch(peekKit, pass) : null;
  if (restored) {
    forgetApplied();
    clearFailed();
    candidatesRef.current = [...restored.peeked];
    plansRef.current = [...restored.plans, plansRef.current[CUSTOM] ?? null];
    // Cleared and repainted within one frame, so a card never shows another recipe's picture.
    setShots(Array(CANDIDATES).fill(undefined));
    void Promise.all(restored.peeked.map(async (candidate, i) => {
      const shot = await photo(candidate, shotFrame, shotSize).catch((): Shot => null);
      if (!dropped) pass.setShot(i, shot);
    }));
    return () => { dropped = true; blank(); };
  }
  // Blank now rather than when the run starts, so the old pictures never stand under the new numbers.
  setShots(Array(CANDIDATES).fill(undefined));
  const run = async (): Promise<void> => {
    const kit = currentEditor();
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

export interface OwnPass {
  stencil: boolean; fits: boolean; ready: boolean; ownFontsReady: boolean; ownSample: StencilSource | null;
  customSeed: number | null; base: number; settings: BatchSettings; scope: MacroCoord[] | null;
  planInputs: PlanInputs | null; wordFits: (sample: StencilSource | null) => boolean; shotFrame: ShotFrame; shotSize: ShotSize;
  plans: Slot<(StencilPlan | null)[]>; own: Slot<Candidate | null>;
  setCustomShot: (shot: Shot) => void; setCustomPending: (on: boolean) => void;
}

/** The visitor's own card: blank, waiting on its font, restored from the caches, or built after the
 *  settle. Returns the pass's disposer. */
export function previewOwn(o: OwnPass): (() => void) | undefined {
  const {
    stencil, fits, ownFontsReady, ownSample, customSeed, base, settings, scope, planInputs, wordFits, shotFrame, shotSize, setCustomShot,
    setCustomPending,
  } = o;
  const plansRef = o.plans, customRef = o.own;
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
  const peekKit = currentEditor();
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
    void photo(hit, shotFrame, shotSize).catch((): Shot => null).then((shot) => { if (!dropped) setCustomShot(shot); });
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
    const shot = await photo(candidate, shotFrame, shotSize);
    if (dropped) return;
    setCustomShot(shot);
    setCustomPending(false);
  };
  const run = async (): Promise<void> => {
    const kit = currentEditor();
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
export interface CardAsk {
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
export function cardRecipe(ask: CardAsk): { seed: number | null; plan: StencilPlan | null } | null {
  if (ask.index === CUSTOM && !ask.ownAllowed) return null;
  const plan = ask.stencil ? ask.plan : null;
  const seed = ask.stencil ? ask.base + ask.index : ask.index === CUSTOM ? ask.customSeed : ask.seeds[ask.index] ?? null;
  // A picture kind's region must still fit it: the plan is dropped the moment it does not, and this is the second lock.
  if (ask.pending || (ask.stencil ? !plan || !ask.fits : seed === null)) return null;
  return { seed, plan };
}

export interface LandingRequest {
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
export interface Landing { done: Promise<Outcome | null>; abort: () => void }

/** Lands a card's run on the live map as one undo step; null with no live map. */
export function landCandidate(ask: LandingRequest): Landing | null {
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
  return { done, abort: () => controller.abort() };
}

/** Clears the last run, bounded by its region and sparing placements made by hand there. False
 *  with no live map. */
export function clearLastRun(): boolean {
  const kit = currentEditor();
  if (!kit) return false;
  clearGenerated(kit, { region: null });
  host.resync();
  return true;
}

/** Lets go of a picture the visitor replaced: its decode, the plans built from it and its object URL. */
export function releaseStencilImage(src: string): void {
  forgetStencilImage(src);
  URL.revokeObjectURL(src);
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

export interface BatchKeyParts {
  kind: GenerateKind; richness: number; maxElevation: number; corridorWidth: number;
  /** The maze's chosen ends, for a kind with gates. */
  gates: ResolvedMazeGates | null;
  /** A picture kind's material and knobs and the box it fills; null for the other kinds. */
  stencil: { fill: StencilFillKind; item: string | null; contrast: number; box: StencilBox | null } | null;
}

/** The batch's identity: every setting its cards are a function of, the seeds aside. */
export function batchKey(p: BatchKeyParts): string {
  return JSON.stringify([
    p.kind, p.richness, p.maxElevation, p.corridorWidth, KIND_ENGINE[p.kind].gates ? p.gates : null,
    p.stencil ? [p.stencil.fill, p.stencil.item, p.stencil.contrast, p.stencil.box] : null,
  ]);
}
