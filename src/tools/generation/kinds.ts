/**
 * The generation kinds a caller offers (a maze, a letter, a picture, a designed island) as the
 * engine reads them: the algorithm each runs, the input it reads ahead of the run, its ceiling and
 * materials, and the recipe a kind's settings make. Labels, Help pages and geometry stay with the
 * surface that shows them.
 */
import { RECIPE_RANGES, defaultConfig, type GenerateAlgorithm, type GenerateConfig, type MazeGates, type StencilPlan } from './recipe';
import { pictureRecipe, type StencilFillKind } from './stencil/fill-recipes';
import { STENCIL_MIN_SIDE } from './stencil/stencil';

/** User-selectable generation workflows. */
export type GenerateKind = 'island' | 'maze' | 'text' | 'image';

/** The picture kinds, whose runs read typed text or a picture ahead of the run. */
export type StencilKind = 'text' | 'image';

/** What the engine reads about a kind. */
export interface KindEngine {
  /** The engine algorithm the kind's recipes run. */
  readonly algorithm: GenerateAlgorithm;
  /** What a stencil kind reads ahead of the run, typed text or a picture; null for a kind that builds
   *  from its recipe alone. */
  readonly input: StencilKind | null;
  /** The tallest layer the kind may raise: a maze's walls stop below the layer that asks for a base. */
  readonly maxElevation: number;
  /** Stencil materials, in one stable row so switching material never shifts adjacent controls. */
  readonly fills: readonly StencilFillKind[];
  /** Whether a run carries entrance and exit marks. */
  readonly gates: boolean;
}

const TEXT_FILLS: readonly StencilFillKind[] = ['mountain', 'water', 'object', 'print'];
const IMAGE_FILLS: readonly StencilFillKind[] = ['mountain', 'water', 'object', 'flora', 'trees', 'road'];

export const KIND_ENGINE: Readonly<Record<GenerateKind, KindEngine>> = {
  maze: { algorithm: 'maze', input: null, maxElevation: RECIPE_RANGES.maxElevation.max.maze, fills: [], gates: true },
  text: { algorithm: 'stencil', input: 'text', maxElevation: RECIPE_RANGES.maxElevation.max.stencil, fills: TEXT_FILLS, gates: false },
  image: { algorithm: 'stencil', input: 'image', maxElevation: RECIPE_RANGES.maxElevation.max.stencil, fills: IMAGE_FILLS, gates: false },
  island: { algorithm: 'designed', input: null, maxElevation: RECIPE_RANGES.maxElevation.max.designed, fills: [], gates: false },
};

export function isStencilKind(kind: GenerateKind): boolean {
  return KIND_ENGINE[kind].input !== null;
}

/** Whether a picture material lays terrain (and so takes the height knob) rather than objects. */
export function fillLaysTerrain(fill: StencilFillKind): boolean {
  return pictureRecipe(fill).tiles === null;
}

/** Checks an explicit region against the workflow's minimum short side; null means the whole map. */
export function regionFitsStencil(kind: GenerateKind, box: { width: number; height: number } | null): boolean {
  const { input } = KIND_ENGINE[kind];
  if (!input || !box) return true;
  return Math.min(box.width, box.height) >= STENCIL_MIN_SIDE[input];
}

/** Generated choices in one batch, before the visitor's own card. */
export const CANDIDATES = 5;

/** Exclusive upper bound for the generator's seed. */
export const SEED_MAX = RECIPE_RANGES.seed.max + 1;

/** Exclusive upper bound of a drawn seed; manual input accepts the full seed range. */
export const DRAWN_SEED_MAX = RECIPE_RANGES.seed.drawnMax;

export function newSeed(random: () => number = Math.random): number {
  return Math.floor(random() * DRAWN_SEED_MAX);
}

/** Consecutive seeds make a batch reproducible from its first recipe number. */
export function batchSeeds(base: number): number[] {
  return Array.from({ length: CANDIDATES }, (_, i) => (base + i) % DRAWN_SEED_MAX);
}

/** A typed recipe number: its digits, within the seed range; null when it has none. */
export function parseSeed(raw: string): number | null {
  const digits = raw.replace(/\D/g, '');
  return digits ? Number(digits) % SEED_MAX : null;
}

/** Richness as a caller holds it: a percentage, the engine taking a 0..1 fraction. */
export const RICHNESS_PERCENT_MAX = RECIPE_RANGES.richness.max * 100;

export interface KindSettings {
  kind: GenerateKind;
  seed: number;
  /** 0..100, as the slider reads it. */
  richness: number;
  maxElevation: number;
  corridorWidth: number;
  gates: MazeGates | null;
  /** text/image only: the rasterized picture and how to read it. Absent until there is one. */
  stencilPlan?: StencilPlan | null;
}

/** Builds a kind's recipe; region scope belongs to the run and is not part of recipe identity. A
 *  picture kind needs its plan: a caller runs one only once the plan exists. */
export function kindConfig(s: KindSettings): GenerateConfig {
  const shared = { maxElevation: Math.min(s.maxElevation, KIND_ENGINE[s.kind].maxElevation), seed: s.seed, region: null };
  const algorithm = KIND_ENGINE[s.kind].algorithm;
  switch (algorithm) {
    // The one 0..1 style knob, as a fraction: the caller holds it as a percentage.
    case 'designed': return defaultConfig(algorithm, { ...shared, richness: s.richness / RICHNESS_PERCENT_MAX });
    case 'maze':
      return defaultConfig(algorithm, { ...shared, corridorWidth: s.corridorWidth, ...(s.gates ? { mazeGates: s.gates } : {}) });
    case 'stencil': {
      if (!s.stencilPlan) throw new TypeError(`kindConfig: the ${s.kind} kind runs only with its plan`);
      return defaultConfig(algorithm, { ...shared, stencilPlan: s.stencilPlan });
    }
  }
}
