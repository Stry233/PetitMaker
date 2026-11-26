/**
 * Generation-shelf options and geometry.
 * Labels determine control widths; candidate cards and sliders retain their drawn proportions through `SHELF_SCALE`.
 * Every limit and engine trait is generation's (`tools/generation/facts.ts`), read here in the shelf's units.
 */
import { forEdition, type EditionVariant } from '../../../../platform/build/edition';
import {
  CANDIDATES, KIND_ENGINE, RECIPE_RANGES, SEED_MAX, STENCIL_MIN_SIDE, fillTakesElevation, fillTakesItem, kindNeeds,
  type GenerateKind, type KindEngine, type StencilFillKind,
} from '../../../../tools/generation/facts';
import { hasCustomCard } from '../../../../editor/editing/custom-card';
import type { HelpPageId } from '../../../../editor/help/page-schema';
import { EDGE, EDGE_RIGHT, RAIL, SHELF_SCALE, SHELF_TABS } from '../../units';
import type { SliderShape } from '../BarSlider';
import type { I18nKey } from '../../../../i18n/keys';

export type { GenerateKind, StencilFillKind };
export { CANDIDATES, STENCIL_MIN_SIDE, fillTakesElevation, fillTakesItem, hasCustomCard };

/** How a kind is shown: its tab's name, its object material's name and its Help page. */
interface KindDisplay {
  readonly labelKey: I18nKey;
  /** The object material's name: one chosen item for a letter, a mixed composition for a picture. */
  readonly objectFillKey: I18nKey;
  /** The Help page the kind's tab opens. */
  readonly helpPage: HelpPageId;
}

const KIND_DISPLAY: Readonly<Record<GenerateKind, KindDisplay>> = {
  maze: { labelKey: 'generate.kind_maze', objectFillKey: 'generate.fill_object', helpPage: 'maze' },
  text: { labelKey: 'generate.kind_text', objectFillKey: 'generate.fill_object', helpPage: 'gen-letter' },
  image: { labelKey: 'generate.kind_image', objectFillKey: 'generate.fill_mixed', helpPage: 'gen-picture' },
  island: { labelKey: 'generate.kind_planet', objectFillKey: 'generate.fill_object', helpPage: 'gen-island' },
};

/** Everything the shelf, its strip and Help read about a kind, the engine's traits beside how it is
 *  shown; no surface tests a kind by name. */
export const GENERATE_KIND: Readonly<Record<GenerateKind, KindEngine & KindDisplay>> = {
  maze: { ...KIND_ENGINE.maze, ...KIND_DISPLAY.maze },
  text: { ...KIND_ENGINE.text, ...KIND_DISPLAY.text },
  image: { ...KIND_ENGINE.image, ...KIND_DISPLAY.image },
  island: { ...KIND_ENGINE.island, ...KIND_DISPLAY.island },
};

interface GenerateTab {
  id: GenerateKind;
  labelKey: I18nKey;
}

/** Display order, left to right. */
const ALL_TABS: readonly (GenerateTab & EditionVariant<GenerateTab>)[] = (['maze', 'text', 'image', 'island'] as const).map((id) => {
  const needs = kindNeeds(id);
  return { id, labelKey: GENERATE_KIND[id].labelKey, ...(needs ? { needs } : {}) };
});

export const TABS: readonly GenerateTab[] = forEdition(ALL_TABS);

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

/** The card plate's own box, inside its art's edge, as shares of the card's box per axis, and its
 *  corner per axis as a share of that box: where a plate drawn without the art stands. */
export const PLATE_BOX = {
  insetX: PLATE_INSET / CARD.w,
  insetY: PLATE_INSET / CARD.h,
  radiusX: CARD.radius / (CARD.w - 2 * PLATE_INSET),
  radiusY: CARD.radius / (CARD.h - 2 * PLATE_INSET),
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

/** Between the batch and clear controls, side by side or stacked: the card gap, so stacked the two
 *  share the card row's height rather than standing apart. */
export const PAIR_GAP = GAP.card;

/** Content padding; the right side reserves the rail while the backing remains full width. */
export const PAD = {
  top: 14, bottom: 12, side: SHELF_TABS.left, right: EDGE_RIGHT + RAIL.button + EDGE,
} as const;

/** Candidate-card height ceiling in CSS pixels. */
const CARD_MAX_H = CARD.h * SHELF_SCALE;

/** Candidate height under a shelf body whose top stands `tabsTop` above its foot
 *  (`frame-plan.ts:FrameLayout.bar`), after the settings strip and shelf spacing. */
export function cardHeight(tabsTop: number): number {
  return Math.min(CARD_MAX_H, tabsTop - PAD.bottom - STRIP.h - STRIP.gap - GAP.row);
}

/** The body's height under that top: its card and settings strip. */
export function bodyHeight(tabsTop: number): number {
  return cardHeight(tabsTop) + STRIP.gap + STRIP.h;
}

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
