/**
 * Generation-shelf options and geometry.
 * Labels determine control widths; candidate cards and sliders retain their drawn proportions through `SHELF_SCALE`.
 * Engine constants supply behavioral ranges such as the elevation ceiling and stencil floor.
 */
import { ELEVATION_MAX } from '../../../core/model/constants';
import { STENCIL_MIN_SIDE, textMinBox, type StencilMaterial } from '../../../tools/generation/stencil';
import { glyphSurvives, gridTextFits, measuredTextMinimum } from './stencil-raster';
import type { StencilOutcome } from '../../../kit/operations/outcome';
import type { GenerateAlgorithm, GenerateConfig, MazeGates, StencilPlan, StencilWaterRole } from '../../../core/model/types';
import { EDGE, EDGE_RIGHT, RAIL, SHELF_SCALE, SHELF_TABS } from '../units';
import type { SliderShape } from './BarSlider';
import { DARK_PLATE } from '../../design/tokens';
import { IS_DEV_BUILD } from '../../../version';

/** User-selectable generation workflows. */
export type GenerateKind = 'island' | 'maze' | 'text' | 'image';

export interface GenerateTab {
  id: GenerateKind;
  labelKey: string;
}

/** Display order, left to right. */
export const TABS: readonly GenerateTab[] = [
  { id: 'maze', labelKey: 'generate.algo_maze' },
  { id: 'text', labelKey: 'gen.kind_text' },
  { id: 'image', labelKey: 'gen.kind_image' },
  { id: 'island', labelKey: 'gen.kind_island' },
];

/** Workflows whose own card ships in released builds. Development builds offer every card. */
const CUSTOM_CARD_RELEASED: Record<GenerateKind, boolean> = {
  maze: true, island: true, text: false, image: false,
};

/** Whether the shelf offers the visitor's own card for `kind`. */
export function hasCustomCard(kind: GenerateKind, devBuild: boolean = IS_DEV_BUILD): boolean {
  return devBuild || CUSTOM_CARD_RELEASED[kind];
}

/** Maps a UI workflow to its engine algorithm. */
export function algorithmFor(kind: GenerateKind): GenerateAlgorithm {
  if (kind === 'maze') return 'maze';
  if (kind === 'text' || kind === 'image') return 'stencil';
  return 'designed';
}


/** Workflows that consume a rasterized input. */
export function isStencilKind(kind: GenerateKind): boolean {
  return kind === 'text' || kind === 'image';
}

/** Minimum short-side region sizes, shared with the stencil engine. */
export { STENCIL_MIN_SIDE };

/** Material families available to text and image stencils. */
export type StencilFillKind = 'mountain' | 'water' | 'object' | 'flora' | 'trees' | 'road';
/**
 * Available materials by generated content kind. Text uses terrain, water, or one selected object.
 * Images additionally support separate flora, tree, and road palettes. All choices remain in one
 * stable row so switching material never shifts adjacent controls.
 */
export function fillKindsFor(kind: GenerateKind): readonly StencilFillKind[] {
  return kind === 'image'
    ? ['mountain', 'water', 'object', 'flora', 'trees', 'road']
    : ['mountain', 'water', 'object'];
}

/** Explicit keys keep every material visible to translation checks. */
export const FILL_KEY: Record<StencilFillKind, string> = {
  mountain: 'gen.fill_mountain',
  water: 'gen.fill_water',
  object: 'gen.fill_object',
  flora: 'gen.fill_flora',
  trees: 'gen.fill_trees',
  road: 'gen.fill_road',
};

/** Image mode labels its broad object composition as Mixed. */
export function fillLabelKey(kind: GenerateKind, fill: StencilFillKind): string {
  return kind === 'image' && fill === 'object' ? 'gen.fill_mixed' : FILL_KEY[fill];
}

/**
 * `tiles` selects a per-cell catalog palette, `decor` adds sparse anchor objects, and `water` defines water's terrain role.
 * Mixed uses terrain with palette water plus sparse non-tree objects; Water builds the figure itself from water.
 */
export interface PictureRecipe {
  tiles: StencilMaterial | null;
  decor: StencilMaterial | null;
  water: StencilWaterRole;
}

export function pictureRecipe(fill: StencilFillKind): PictureRecipe {
  if (fill === 'road') return { tiles: 'roads', decor: null, water: 'none' };
  if (fill === 'flora' || fill === 'trees') return { tiles: fill, decor: null, water: 'none' };
  if (fill === 'object') return { tiles: null, decor: 'mixed', water: 'palette' };
  return { tiles: null, decor: null, water: fill === 'water' ? 'primary' : 'none' };
}

/** Whether text mode needs the selected-item control. */
export function fillTakesItem(kind: GenerateKind, fill: StencilFillKind): boolean {
  return kind === 'text' && fill === 'object';
}

/** Text follows its base surface; image elevation applies only to terrain-colored recipes. */
export function fillTakesElevation(kind: GenerateKind, fill: StencilFillKind): boolean {
  if (kind === 'text') return false;
  if (kind !== 'image') return true;
  return pictureRecipe(fill).tiles === null;
}

/** The picture's contrast knob, as the slider reads it: percent, 100 leaving the image alone. */
export const CONTRAST = { min: 50, max: 250, def: 130 } as const;

/** Maximum user-perceived characters in a text stencil. */
export const TEXT_MAX_CHARS = 6;

/** Checks an explicit region against the workflow's minimum short side; null means the whole map. */
export function regionFitsStencil(kind: GenerateKind, box: { width: number; height: number } | null): boolean {
  if (!isStencilKind(kind)) return true;
  if (!box) return true;
  return Math.min(box.width, box.height) >= STENCIL_MIN_SIDE[kind as 'text' | 'image'];
}

/** Grid-fitted text uses its geometry verdict; native outlines retain the conservative bound. */
export function textFitsBox(text: string, box: { width: number; height: number } | null): boolean {
  if (!box) return true;
  const minimum = measuredTextMinimum(text);
  if (minimum && (box.width < minimum.width || box.height < minimum.height)) return false;
  const fitted = gridTextFits(text, box);
  if (fitted !== null) return fitted;
  const need = textMinBox(text);
  if (box.width >= need.width && box.height >= need.height) return true;
  return glyphSurvives(text, { origin: { x: 0, y: 0 }, width: box.width, height: box.height }).ok;
}

/**
 * Chooses one localized outcome: ceiling when nothing could be placed, otherwise the largest rejection bucket.
 * Ties follow off-base, unsupported, then ceiling order; every bucket carries singular and plural keys.
 */
export function stencilNote(
  kind: GenerateKind, s: StencilOutcome | undefined, placed: number,
): { key: string; n: number } | null {
  const nothing = kind === 'image' ? 'gen.picture_nothing_laid' : 'gen.text_nothing_laid';
  if (placed === 0 && !s) return { key: nothing, n: 0 };
  if (!s) return null;
  // Explicit singular and plural keys remain visible to translation checks.
  const ceiling: Bucket = ['gen.text_at_ceiling', 'gen.text_at_ceiling_one', s.atCeiling];
  if (placed === 0 && s.atCeiling > 0) return said(ceiling);
  const worst = ([
    ['gen.text_off_base', 'gen.text_off_base_one', s.offBase],
    ['gen.text_unsupported', 'gen.text_unsupported_one', s.unsupported],
    ceiling,
  ] as Bucket[]).reduce((a, b) => (b[2] > a[2] ? b : a));
  if (worst[2] > 0) return said(worst);
  return placed === 0 ? { key: nothing, n: 0 } : null;
}

/** One reason a word came up short: what to say of several cells, what to say of one, how many. */
type Bucket = [many: string, one: string, n: number];

const said = ([many, one, n]: Bucket): { key: string; n: number } => ({ key: n === 1 ? one : many, n });

/** New recipes use the generator's neutral water bias; imported recipes retain their stored mode. */
export function modeFor(_kind: GenerateKind): GenerateConfig['mode'] {
  return 'mixed';
}

/** Generated choices shown before the custom-recipe card. */
export const CANDIDATES = 5;

/** Candidate-card geometry in design pixels. */
export const CARD = {
  w: 660,
  h: 450,
  pic: { x: 45, y: 35, w: 568, h: 333, r: 50 },
  label: { y: 382, h: 57 },
  /** How far the selected marker stands out past the plate on every side. */
  ring: 10,
  /** Inner corner radius; the selection marker adds `ring` to stay concentric. */
  radius: 30,
} as const;

/** Selection-ring offsets and radii as box shares, preserving an even concentric band when cards scale. */
const PLATE_INSET = 2;
const RING_OUT = CARD.ring - PLATE_INSET;
export const CHOSEN = {
  /** How far the marker stands outside the card's box, per axis, as a share of that axis. */
  insetX: RING_OUT / CARD.w,
  insetY: RING_OUT / CARD.h,
  /** Its corner, per axis, as a share of the MARKER's own box: the plate's radius plus the band. */
  radiusX: (CARD.radius + CARD.ring) / (CARD.w + 2 * RING_OUT),
  radiusY: (CARD.radius + CARD.ring) / (CARD.h + 2 * RING_OUT),
} as const;

/** Tall, narrow batch-control geometry at the end of the candidate row. */
export const BATCH = { wide: 0.62, glyph: 30, radius: CARD.radius } as const;

/** Settings-strip height, card gap, label padding, and right alignment edge. */
export const STRIP = {
  h: 26, gap: 10, padX: 15, right: EDGE_RIGHT,
  /** Fixed CSS width; longer item names ellipsize. */
  chip: 160,
} as const;

/** Shelf backing fill; placement and corner geometry are shared through `PLATE_BAND`. */
export const BAR = { fill: DARK_PLATE } as const;

/** Gaps in CSS pixels. */
export const GAP = {
  /** Names to candidate block. */
  row: 12,
  /** Card to card, and the last card to the batch tile. */
  card: 13,
  /** Controls inside the settings strip. */
  strip: 16,
  /** A slider's name, its track and its reading. */
  sliderPart: 10,
} as const;

/** Extra separation between the batch and clear controls. */
export const PAIR_GAP = GAP.card * 2;

/** Content padding; the right side reserves the rail while the backing remains full width. */
export const PAD = {
  top: 14, bottom: 12, side: SHELF_TABS.left, right: EDGE_RIGHT + RAIL.button + EDGE,
} as const;

/** Candidate-card height ceiling in CSS pixels. */
export const CARD_MAX_H = CARD.h * SHELF_SCALE;

/** Available candidate height after the settings strip and shelf spacing. */
export const CARD_H = Math.min(
  CARD_MAX_H,
  SHELF_TABS.floor - PAD.bottom - STRIP.h - STRIP.gap - GAP.row,
);

/** Fixed body height derived from its card and settings-strip parts. */
export const BODY_H = CARD_H + STRIP.gap + STRIP.h;

/** Shared generator slider geometry, in design pixels. */
const sliderAt = (y: number): SliderShape => ({
  track: { x: 3038, y, w: 454, h: 79 },
  first: 3089,
  last: 3441,
  centreY: y + 39.5,
  tick: 22,
  knob: 96,
  pip: 31,
});

export const SLIDERS = {
  upper: sliderAt(1511),
  maxLayer: sliderAt(1612),
} as const;

/** Scenery richness as a UI percentage; the engine receives a 0..1 fraction. */
export const RICHNESS = { min: 0, max: 100, default: 70 } as const;

/** Corridor width, the maze's own knob. The generator clamps to this range itself. */
export const CORRIDOR = { min: 1, max: 3 } as const;

/**
 * A maze wall is at most `CORRIDOR.max` cells wide, and V-MTN-03 wants a 3x3 base under anything
 * above layer 3, so a taller maze would have most of its walls refused. The island has no such
 * limit and reaches the grid's own ceiling.
 */
export const MAZE_MAX_ELEVATION = 3;

export function maxElevationFor(kind: GenerateKind): number {
  return kind === 'maze' ? MAZE_MAX_ELEVATION : ELEVATION_MAX;
}

/** Every workflow needs at least one raised layer; elevation zero clears terrain. */
export function minElevationFor(_kind: GenerateKind): number {
  return 1;
}

/** Exclusive upper bound for the generator's unsigned 32-bit seed. */
export const SEED_MAX = 0x1_0000_0000;

/** How wide the field lets a recipe number get, in digits. `SEED_MAX - 1` is ten of them. */
export const SEED_DIGITS = String(SEED_MAX - 1).length;

/** Automatically drawn recipes stay at five digits; manual input accepts the full seed range. */
const DRAWN_SEED_MAX = 100000;

export function newSeed(random: () => number = Math.random): number {
  return Math.floor(random() * DRAWN_SEED_MAX);
}

/** Consecutive seeds make a batch reproducible from its first recipe number. */
export function batchSeeds(base: number): number[] {
  return Array.from({ length: CANDIDATES }, (_, i) => (base + i) % DRAWN_SEED_MAX);
}

export interface ShelfSettings {
  kind: GenerateKind;
  seed: number;
  /** 0..100, as the slider reads it. */
  richness: number;
  maxElevation: number;
  corridorWidth: number;
  gates: MazeGates | null;
  /** text/image only: the rasterized picture and how to read it. Absent until there is one, which
   *  is what the shelf shows an empty field for. */
  stencilPlan?: StencilPlan | null;
}

/** Builds a candidate recipe; region scope belongs to the run and is not part of recipe identity. */
export function shelfConfig(s: ShelfSettings): GenerateConfig {
  return {
    algorithm: algorithmFor(s.kind),
    mode: modeFor(s.kind),
    corridorWidth: s.corridorWidth,
    maxElevation: Math.min(s.maxElevation, maxElevationFor(s.kind)),
    seed: s.seed,
    region: null,
    // The one 0..1 style knob, as a fraction: the shelf holds it as a percentage.
    richness: s.richness / RICHNESS.max,
    ...(s.kind === 'maze' && s.gates ? { mazeGates: s.gates } : {}),
    ...(isStencilKind(s.kind) && s.stencilPlan ? { stencilPlan: s.stencilPlan } : {}),
  };
}
