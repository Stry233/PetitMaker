/* A generation recipe: which generator runs and the settings that generator reads, a union keyed on
 * the algorithm. The map records it opaquely (`core/model/types.ts:GenerationRecord`). */
import { fnv1aInts, hashJSON } from '../../core/base/hash';
import { BASE_SUPPORT, ELEVATION_MAX } from '../../core/game/profile';
import type { MacroCoord, TerrainType } from '../../core/model/types';

/**
 * What kind of picture a stencil was read from, which decides how it is read and how it is matched.
 *
 * `flat` is art drawn in a few solid colours — pixel art, an emoji, a sticker, a logo, a line
 * drawing. Its colours are already a palette, so a cell wants the colour most of it is rather than
 * the average of what it covers (averaging an outline with the ground behind it invents a colour the
 * picture never had), and spreading a quantisation error over its neighbours only lays noise across
 * an edge that was already exact.
 *
 * `photographic` is everything else: continuous tone, where averaging is the truth and error
 * diffusion is what lets a small palette say a gradient.
 */
export type StencilSourceNature = 'flat' | 'photographic';

/**
 * A picture to build from: how much of each cell it covers, and what colour it is there.
 *
 * It is data rather than a source, because turning a letter or a photograph into pixels needs a
 * canvas and the candidate pipeline runs in a browser-API-free worker. The shell rasterizes once and
 * passes this down; `tools/generation/stencil/stencil.ts` is everything that reads one.
 */
export interface Stencil {
  width: number;
  height: number;
  /** Shape only: grid-fitted edges need no smoothing or corner cuts. */
  cellAligned?: boolean;
  /** Connected single-line tiles, as N/E/S/W bits 1/2/4/8 per cell. */
  connections?: Uint8Array;
  /** Cells whose turns follow a curved or diagonal source stroke. */
  curves?: Uint8Array;
  /** Coverage 0..255 per cell, row-major. */
  coverage: Uint8Array;
  /** Packed 0xRRGGBB per cell, row-major; meaningful where coverage is non-zero. */
  color: Uint32Array;
  /**
   * Coverage 0..255 per quadrant of each cell, 4 per cell in corner order [TL, TR, BL, BR]
   * (`core/model/corners`), row-major by cell. The rasterizer draws at twice the cell
   * resolution, so this is the sub-cell detail the whole-cell threshold throws away — and it is what
   * lets the trim pass choose each corner's shape from the source rather than applying one mode
   * everywhere. Absent on a stencil built without it (a test's hand-drawn one); the trim then falls
   * back to the blanket mode.
   */
  quad?: Uint8Array;
  /** What the source was read as. Absent on a stencil built by hand or from a glyph, where there is
   *  no source picture to have a nature; the readers then take the photographic path. */
  nature?: StencilSourceNature;
}

/** How an object stencil met its regional load budget: `adapted` placed a sparser set that keeps
 *  the structure, `blocked` could not fit even the structural minimum and placed nothing. */
export type StencilBudgetOutcome = 'adapted' | 'blocked';

/** How a stencil is read onto the map. `shape` builds the covered cells (the text mode); `color`
 *  ignores the outline and matches each cell's colour to the terrain that draws in it (the image
 *  mode). `fill` names what `shape` builds with. */
export interface StencilPlan {
  read: 'shape' | 'color';
  /** Shape material: terrain, one repeated item, or connected centerline tiles. */
  fill?: { kind: 'terrain'; terrain: TerrainType } | { kind: 'object'; catalogId: string } | { kind: 'stroke' };
  stencil: Stencil;
  /** Where the stencil's top-left cell lands on the map. */
  origin: MacroCoord;
  /**
   * The cells the run may write to, as flat `y * mapWidth + x` indices, or absent for "anywhere
   * buildable". A stencil is fitted to the region's bounding box, which is not the region: a
   * free-painted blob's box covers cells the visitor did not paint, and only this keeps the picture
   * off them.
   */
  allow?: ReadonlySet<number>;
  /**
   * color only: how much of the picture's own tonal range is spread across the palette, 0..2 with 1
   * leaving it alone. Above 1 the window narrows and the extremes clip; below 1 it widens and the
   * result is gentler (`tools/generation/stencil/stencil.ts:narrowRange`).
   */
  contrast?: number;
  /** color only: what part water plays in the terrain reading. Absent is `none`. */
  water?: StencilWaterRole;
  /**
   * color only: the objects a picture may be built from, each with the colour it reads as. Present,
   * the picture is tiled with objects rather than coloured in terrain — which is what gives it a
   * real palette, since the catalogue carries dozens of hues where the terrain ramp is eight greens
   * and a blue. Sampled from the item icons on the main thread, because reading a picture's colours
   * needs a canvas and this plan crosses into a worker. The palette is the material — every flower,
   * the flowers alone, the trees alone, or the road surfaces (`tools/generation/stencil/stencil-palette.ts`).
   */
  objectPalette?: readonly { catalogId: string; rgb: number }[];
  /**
   * The decoration: objects placed at the picture's anchor points, over whatever the primary
   * material left standing — what says a bow, an eye or a red trim that one palette could not.
   *
   * Absent is none. `density` is a share of the picture's cells and is capped by the generator
   * whatever it asks for; the placements go through the rules like any other and a refusal simply
   * skips.
   */
  decor?: {
    palette: readonly { catalogId: string; rgb: number }[];
    density?: number;
  };
}

/**
 * What part water plays when a picture is coloured in terrain.
 *
 * `none` is the green ramp alone. `palette` adds the one blue as a ninth entry, so an area of the
 * picture that is genuinely blue becomes a real pond. `primary` is the water material: the picture
 * is built as a body of water with its darkest cells raised as the mountain that draws its outline —
 * because a palette that holds one blue among eight greens only ever spends it on a blue picture,
 * and a visitor who asked for water is asking for water.
 */
export type StencilWaterRole = 'none' | 'palette' | 'primary';

/** Requested maze gates, in map coordinates. Each is snapped to the nearest cell on the maze's
 *  border ring, so a coordinate may sit anywhere, including deep inside the maze. Either may be
 *  absent, and both absent means two openings on opposite sides. */
export interface MazeGates { entrance?: MacroCoord | null; exit?: MacroCoord | null }

/** Where the gates landed once snapped — what a caller pins its entrance/exit markers to. Null on
 *  a side no gate was carved on. */
export interface ResolvedMazeGates { entrance: MacroCoord | null; exit: MacroCoord | null }

/** The planet kinds the designer lays out: earth-led, water-led or both. */
export type PlanetKind = 'earth' | 'water' | 'mixed';

/** The scenery richness a recipe that names none generates at, and the generate shelf's starting value. */
export const DEFAULT_RICHNESS = 0.7;

/** The tallest a cell may stand with no base under it: the layers V-MTN-03 exempts. */
export const FLAT_SAFE_ELEVATION = BASE_SUPPORT.fromLayer - 1;

/** The tallest wall a maze raises: a one-cell wall off flat ground stops below the layer that asks for a base. */
export const MAZE_MAX_ELEVATION = FLAT_SAFE_ELEVATION;

/** What every recipe carries: the seed, the tallest layer it may raise, and the cells it may build
 *  on (null for the whole buildable planet). */
interface RecipeBase {
  seed: number;
  maxElevation: number;
  region: MacroCoord[] | null;
}

/** The planet generator (`tools/generation/designer/`), which the shelf's planet kinds run. */
export interface DesignedConfig extends RecipeBase {
  algorithm: 'designed';
  mode: PlanetKind;
  /**
   * The one 0..1 style knob: scenery richness, 0 a flat garden town and 1 a terraced planet with
   * water on every layer. It scales the planet generator's terrain drama, its water, its theme
   * count and its decoration together. Absent is `DEFAULT_RICHNESS`.
   */
  richness?: number;
}

/** A labyrinth carved into the buildable region. */
export interface MazeConfig extends RecipeBase {
  algorithm: 'maze';
  /** Corridor width in cells, within `RECIPE_RANGES.corridorWidth`. */
  corridorWidth: number;
  mazeGates?: MazeGates;
}

/** A picture read onto the map. */
export interface StencilConfig extends RecipeBase {
  algorithm: 'stencil';
  /** The picture, and how to read it. */
  stencilPlan: StencilPlan;
}

/** A recipe: one generator and the settings it reads. The recipe is informational in a share code;
 *  map reconstruction uses its cells and objects. */
export type GenerateConfig = DesignedConfig | MazeConfig | StencilConfig;

export type GenerateAlgorithm = GenerateConfig['algorithm'];

/** What a maze run reads from its recipe. */
export type MazeRecipe = Omit<MazeConfig, 'algorithm'>;

/** A recipe as a map records it: the settings without a stencil's picture, which is the source
 *  image rather than a setting. Read back from a file it is informational, and a recipe recorded by
 *  an earlier release may carry the settings of other algorithms too. */
export type RecordedRecipe = DesignedConfig | MazeConfig | Omit<StencilConfig, 'stencilPlan'>;

/** The settings' ranges a caller offers, which the generators read as they are. */
export const RECIPE_RANGES = {
  /** The seed, an unsigned 32-bit integer: the generators' random streams read it modulo 2^32. A
   *  drawn seed stays below `drawnMax` (five digits); a typed one may use the whole range. */
  seed: { min: 0, max: 0xffff_ffff, drawnMax: 100_000 },
  /** Maze corridor width in cells; the maze clamps to it. */
  corridorWidth: { min: 1, max: 3 },
  richness: { min: 0, max: 1, default: DEFAULT_RICHNESS },
  /** The tallest layer a run may raise, per algorithm. Every run raises at least one layer: zero
   *  clears terrain. */
  maxElevation: { min: 1, max: { designed: ELEVATION_MAX, maze: MAZE_MAX_ELEVATION, stencil: ELEVATION_MAX } },
  /** A picture stencil's contrast as the factor its colour read applies; 1 leaves the image alone. */
  contrast: { min: 0.5, max: 2.5, default: 1.3 },
  /** The longest text stencil, in user-perceived characters (grapheme clusters). */
  textChars: { max: 64 },
} as const;

type Settings<C extends GenerateConfig> = Partial<Omit<C, 'algorithm'>>;

/** A recipe for `algorithm` at its defaults, with `settings` over them. A stencil needs its plan. */
export function defaultConfig(algorithm: 'designed', settings?: Settings<DesignedConfig>): DesignedConfig;
export function defaultConfig(algorithm: 'maze', settings?: Settings<MazeConfig>): MazeConfig;
export function defaultConfig(
  algorithm: 'stencil', settings: Settings<StencilConfig> & Pick<StencilConfig, 'stencilPlan'>,
): StencilConfig;
export function defaultConfig(algorithm: GenerateAlgorithm, settings: Settings<GenerateConfig> = {}): GenerateConfig {
  const base = { maxElevation: RECIPE_RANGES.maxElevation.max[algorithm], seed: 0, region: null };
  switch (algorithm) {
    case 'designed':
      return { algorithm, mode: 'mixed', ...base, richness: DEFAULT_RICHNESS, ...settings } as DesignedConfig;
    case 'maze':
      return { algorithm, corridorWidth: RECIPE_RANGES.corridorWidth.min, ...base, ...settings } as MazeConfig;
    case 'stencil': {
      const config = { algorithm, ...base, ...settings } as StencilConfig;
      if (!config.stencilPlan) throw new TypeError('defaultConfig: a stencil recipe needs its plan');
      return config;
    }
    default:
      return unknownAlgorithm(algorithm);
  }
}

/** The end of an exhaustive switch over the algorithms (given the recipe or its algorithm), reached
 *  only by a recipe from outside the type system. */
export function unknownAlgorithm(value: never): never {
  const algorithm: unknown = typeof value === 'object' && value !== null ? (value as { algorithm?: unknown }).algorithm : value;
  throw new TypeError(`unknown generation algorithm: ${String(algorithm)}`);
}

/** `config` as a map records it: a stencil's picture left out. */
export function withoutPicture(config: GenerateConfig): RecordedRecipe {
  if (config.algorithm !== 'stencil') return config;
  const { stencilPlan: _plan, ...recipe } = config;
  return recipe;
}

/** A buffer as its length and FNV-1a content hash, or absent with the buffer. */
const bufferDigest = (values: ArrayLike<number> & Iterable<number> | undefined): string | undefined =>
  values ? `${values.length}:${fnv1aInts(values)}` : undefined;

/** A stencil plan as plain settings: each picture buffer and the allowed cells as a content digest,
 *  so a plan hashes in one pass over its buffers and two plans that differ anywhere differ here. */
function stencilPlanDigest(plan: StencilPlan): unknown {
  const { stencil, allow, ...settings } = plan;
  const { coverage, color, quad, connections, curves, ...shape } = stencil;
  return {
    ...settings,
    stencil: {
      ...shape,
      coverage: bufferDigest(coverage), color: bufferDigest(color), quad: bufferDigest(quad),
      connections: bufferDigest(connections), curves: bufferDigest(curves),
    },
    allow: allow ? bufferDigest([...allow].sort((a, b) => a - b)) : undefined,
  };
}

/** The version of what the generators lay for a recipe. One recipe on one template and catalog
 *  lays one map per version; a change that moves a generated map on purpose bumps it, together with
 *  the golden digests `generation-determinism.test.ts` holds. Not recorded in recipes or share codes. */
export const GENERATOR_VERSION = 6;

/** A run's identity: every setting of `config`, with a stencil's picture folded in by content. A
 *  recipe without a picture hashes as `hashJSON(config)`. The candidate cache and the provenance a
 *  run records key on it. */
export function recipeHash(config: GenerateConfig): string {
  return config.algorithm === 'stencil'
    ? hashJSON({ ...withoutPicture(config), stencilPlan: stencilPlanDigest(config.stencilPlan) })
    : hashJSON(config);
}
