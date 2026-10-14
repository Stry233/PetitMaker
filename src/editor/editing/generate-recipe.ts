/*
 * What the generate shelf asks the generator for: the kind, its knobs and the visitor's own card.
 * Each kind keeps its batch seed, its ceiling, its material and its own recipe number while another
 * is visited; the own card takes a letter's trimmed text or the other kinds' digits as a recipe
 * number, and a picture's object URL is released when replaced or when the shelf closes.
 */
import { KIND_ENGINE, RECIPE_RANGES, newSeed, parseSeed, type GenerateKind, type StencilFillKind } from '../../tools/generation/facts';
import { releaseStencilImage } from './generate-batch';

/** What each kind remembers for itself. */
interface KindMemory {
  base: number;
  maxElevation: number;
  fillKind: StencilFillKind;
  customSeed: number | null;
}

export interface RecipeState {
  kind: GenerateKind;
  byKind: Readonly<Record<GenerateKind, KindMemory>>;
  richness: number;
  corridorWidth: number;
  /** The item an object letter is tiled with: the generator's own setting, not the placer's arming. */
  fillItem: string | null;
  contrast: number;
  ownText: string | null;
  ownImage: { src: string; name: string } | null;
}

/** The knobs' starting values, in the shelf's own units. */
export interface RecipeDefaults { richness: number; corridorWidth: number; contrast: number }

export interface GenerateRecipeController {
  get(): RecipeState;
  subscribe(listener: () => void): () => void;
  setKind(kind: GenerateKind): void;
  /** A fresh batch seed for the current kind. */
  reroll(): void;
  setMaxElevation(elevation: number): void;
  setFillKind(fill: StencilFillKind): void;
  setRichness(value: number): void;
  setCorridorWidth(value: number): void;
  setFillItem(id: string | null): void;
  setContrast(value: number): void;
  /** Files the own card's typed text; whether the card's recipe changed. */
  commitCustom(raw: string): boolean;
  /** Takes a picture the visitor chose, letting the previous one's object URL and decode go. */
  takeImage(file: File): void;
  /** The shelf closed: the own picture is let go. */
  dispose(): void;
}

/** The ceiling a kind may raise, and the floor every kind raises at least. */
const recipeCeiling = (kind: GenerateKind): number => KIND_ENGINE[kind].maxElevation;
const RECIPE_FLOOR = RECIPE_RANGES.maxElevation.min;

/** The layer a recipe raises: the kind's remembered ceiling, held within the floor and the kind's own. */
export function recipeElevation(state: RecipeState): number {
  return Math.min(Math.max(state.byKind[state.kind].maxElevation, RECIPE_FLOOR), recipeCeiling(state.kind));
}

export function createGenerateRecipe(
  kinds: readonly GenerateKind[], initialKind: GenerateKind, defaults: RecipeDefaults,
): GenerateRecipeController {
  const firstSeed = newSeed();
  let state: RecipeState = {
    kind: initialKind,
    byKind: Object.fromEntries(kinds.map((kind) => [kind, {
      base: firstSeed, maxElevation: recipeCeiling(kind), fillKind: 'mountain', customSeed: null,
    } satisfies KindMemory])) as Record<GenerateKind, KindMemory>,
    richness: defaults.richness, corridorWidth: defaults.corridorWidth, fillItem: null, contrast: defaults.contrast,
    ownText: null, ownImage: null,
  };
  const listeners = new Set<() => void>();
  const set = (next: Partial<RecipeState>) => {
    state = { ...state, ...next };
    for (const listener of [...listeners]) listener();
  };
  const remember = (next: Partial<KindMemory>) =>
    set({ byKind: { ...state.byKind, [state.kind]: { ...state.byKind[state.kind], ...next } } });

  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    setKind: (kind) => set({ kind }),
    reroll: () => remember({ base: newSeed() }),
    setMaxElevation: (maxElevation) => remember({ maxElevation }),
    setFillKind: (fillKind) => remember({ fillKind }),
    setRichness: (richness) => set({ richness }),
    setCorridorWidth: (corridorWidth) => set({ corridorWidth }),
    setFillItem: (fillItem) => set({ fillItem }),
    setContrast: (contrast) => set({ contrast }),
    commitCustom(raw) {
      if (KIND_ENGINE[state.kind].input === 'text') {
        const next = raw.trim() || null;
        if (next === state.ownText) return false;
        set({ ownText: next });
        return true;
      }
      const next = parseSeed(raw);
      if (next === state.byKind[state.kind].customSeed) return false;
      remember({ customSeed: next });
      return true;
    },
    takeImage(file) {
      if (state.ownImage) releaseStencilImage(state.ownImage.src);
      set({ ownImage: { src: URL.createObjectURL(file), name: file.name } });
    },
    dispose() {
      if (state.ownImage) releaseStencilImage(state.ownImage.src);
      set({ ownImage: null });
    },
  };
}
