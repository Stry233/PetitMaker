/**
 * Generation-shelf options and geometry.
 * Labels determine control widths; candidate cards and sliders retain their drawn proportions through `SHELF_SCALE`.
 * Every limit and engine trait is generation's (`tools/generation/facts.ts`), read here in the shelf's units.
 */
import { forEdition, type EditionVariant } from '../../../../platform/build/edition';
import {
  CANDIDATES, KIND_ENGINE, RECIPE_RANGES, SEED_MAX, STENCIL_MIN_SIDE, fillLaysTerrain,
  type GenerateKind, type KindEngine, type StencilFillKind,
} from '../../../../tools/generation/facts';
import type { HelpPageId } from '../../../help/page-schema';
import { EDGE, EDGE_RIGHT, RAIL, SHELF_SCALE, SHELF_TABS } from '../../units';
import type { SliderShape } from '../BarSlider';
import { IS_DEV_BUILD } from '../../../../platform/build/build-info';
import type { I18nKey } from '../../../../i18n/keys';

export type { GenerateKind, StencilFillKind };
export { CANDIDATES, STENCIL_MIN_SIDE };

/** Everything the shelf, its strip and Help read about a kind; no surface tests a kind by name. */
export interface KindTraits extends KindEngine {
  readonly labelKey: I18nKey;
  /** Whether released builds offer the visitor's own card. Development builds offer every card. */
  readonly customCardReleased: boolean;
  /** The object material's name: one chosen item for a letter, a mixed composition for a picture. */
  readonly objectFillKey: I18nKey;
  /** Whether the object material lays the one item the visitor picks. */
  readonly pickItem: boolean;
  /** Whether the strip's upper knob is the corridor width rather than richness. */
  readonly corridor: boolean;
  /** Whether the picture's contrast is a knob. */
  readonly contrast: boolean;
  /** Where the height knob applies: every material, terrain-coloured materials only, or none (a
   *  letter follows its base surface). */
  readonly elevation: 'always' | 'terrain' | 'none';
  /** The Help page the kind's tab opens. */
  readonly helpPage: HelpPageId;
}

const BUILT: Pick<KindTraits, 'pickItem' | 'contrast' | 'objectFillKey'> = {
  pickItem: false, contrast: false, objectFillKey: 'generate.fill_object',
};

export const GENERATE_KIND: Readonly<Record<GenerateKind, KindTraits>> = {
  maze: {
    ...KIND_ENGINE.maze, ...BUILT, labelKey: 'generate.kind_maze', customCardReleased: true,
    corridor: true, elevation: 'always', helpPage: 'maze',
  },
  text: {
    ...KIND_ENGINE.text, labelKey: 'generate.kind_text', customCardReleased: true,
    objectFillKey: 'generate.fill_object', pickItem: true, corridor: false, contrast: false,
    elevation: 'none', helpPage: 'gen-letter',
  },
  image: {
    ...KIND_ENGINE.image, labelKey: 'generate.kind_image', customCardReleased: false,
    objectFillKey: 'generate.fill_mixed', pickItem: false, corridor: false, contrast: true,
    elevation: 'terrain', helpPage: 'gen-picture',
  },
  island: {
    ...KIND_ENGINE.island, ...BUILT, labelKey: 'generate.kind_planet', customCardReleased: true,
    corridor: false, elevation: 'always', helpPage: 'gen-island',
  },
};

interface GenerateTab {
  id: GenerateKind;
  labelKey: I18nKey;
}

/** Display order, left to right; Lite offers the kinds that read no input. */
const ALL_TABS: readonly (GenerateTab & EditionVariant<GenerateTab>)[] = (['maze', 'text', 'image', 'island'] as const).map((id) => ({
  id, labelKey: GENERATE_KIND[id].labelKey, ...(GENERATE_KIND[id].input ? { lite: false as const } : {}),
}));

export const TABS: readonly GenerateTab[] = forEdition(ALL_TABS);

/** Whether the shelf offers the visitor's own card for `kind`. */
export function hasCustomCard(kind: GenerateKind, devBuild: boolean = IS_DEV_BUILD): boolean {
  return devBuild || GENERATE_KIND[kind].customCardReleased;
}

/** Available materials by generated content kind. */
export function fillKindsFor(kind: GenerateKind): readonly StencilFillKind[] {
  return GENERATE_KIND[kind].fills;
}

/** Explicit keys keep every material visible to translation checks. */
const FILL_KEY: Record<StencilFillKind, I18nKey> = {
  mountain: 'generate.fill_mountain',
  water: 'generate.fill_water',
  object: 'generate.fill_object',
  flora: 'generate.fill_flora',
  trees: 'generate.fill_trees',
  road: 'generate.fill_road',
  print: 'generate.fill_print',
};

export function fillLabelKey(kind: GenerateKind, fill: StencilFillKind): I18nKey {
  return fill === 'object' ? GENERATE_KIND[kind].objectFillKey : FILL_KEY[fill];
}

/** Whether the material needs the selected-item control. */
export function fillTakesItem(kind: GenerateKind, fill: StencilFillKind): boolean {
  return GENERATE_KIND[kind].pickItem && fill === 'object';
}

/** Whether the height knob applies to the kind's material. */
export function fillTakesElevation(kind: GenerateKind, fill: StencilFillKind): boolean {
  const { elevation } = GENERATE_KIND[kind];
  if (elevation === 'terrain') return fillLaysTerrain(fill);
  return elevation === 'always';
}

/** The picture's contrast knob, as the slider reads it: percent, 100 leaving the image alone. */
export const CONTRAST = {
  min: Math.round(RECIPE_RANGES.contrast.min * 100), max: Math.round(RECIPE_RANGES.contrast.max * 100),
  default: Math.round(RECIPE_RANGES.contrast.default * 100),
} as const;

/** Maximum user-perceived characters in a text stencil. */
export const TEXT_MAX_CHARS = RECIPE_RANGES.textChars.max;

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
  /** Its corner, per axis, as a share of the marker's own box: the plate's radius plus the band. */
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
const CARD_MAX_H = CARD.h * SHELF_SCALE;

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
export const RICHNESS = {
  min: RECIPE_RANGES.richness.min * 100, max: RECIPE_RANGES.richness.max * 100, default: Math.round(RECIPE_RANGES.richness.default * 100),
} as const;

/** Corridor width, the maze's own knob. */
export const CORRIDOR = RECIPE_RANGES.corridorWidth;

/** The tallest layer a kind may raise. */
export function maxElevationFor(kind: GenerateKind): number {
  return GENERATE_KIND[kind].maxElevation;
}

/** Every kind raises at least one layer; elevation zero clears terrain. */
export const MIN_ELEVATION = RECIPE_RANGES.maxElevation.min;

/** How wide the field lets a recipe number get, in digits. `SEED_MAX - 1` is ten of them. */
export const SEED_DIGITS = String(SEED_MAX - 1).length;
