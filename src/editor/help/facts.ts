/*
 * The numbers and names the help quotes but never owns.
 *
 * Everything here is read from the source that declares it (constants, the catalog, the live
 * i18n table), so a change there changes the help with no copy edit. Pages receive the whole
 * record as `{token}` params on every string; a string uses the tokens it needs. The values whose
 * owners rank above this layer (`page-schema.ts:HelpFactAbove`) come from the reader and are merged
 * here.
 */
import { illustrationProviderName, providerName } from '../../i18n/terms/providers';
import type { HelpFactsOf } from './page-schema';
import { NOTE_LIMITS } from '../../core/model/notes';
import { PLANET_PROFILE, CHUNK_LOAD_LIMIT, ELEVATION_MAX, BASE_SUPPORT, DOOR, LANDMARKS, layerNumber, type LayerNumber } from '../../core/game/profile';
import { hasGate } from '../../state/object-geometry';
import { ANNOTATION_COLORS } from '../../config/annotation-palette';
import { getAllItems, getCatalogItem, getPlaceableByRole, getPlaceableWhere } from '../../state/catalog';
import { AUTOSAVE_DEBOUNCE_MS } from '../../io/storage/facts';
import { CANDIDATES, DRAWN_SEED_MAX, MAZE_MAX_ELEVATION, RECIPE_RANGES, SEED_MAX, STENCIL_MIN_SIDE } from '../../tools/generation/facts';
import { BLUEPRINT_MAX_SIDE } from '../../tools/blueprint/facts';
import { BRUSH_SIZE, TERRAIN_THICKNESS } from '../../state/editing/edit-mode';
import { OBJECT_SPACING } from '../../state/editing/vocabulary';
import { RECENT_HISTORY_STEPS } from '../../io/export/facts';
import { TOUCH_UI_ZOOM_DEFAULT, TOUCH_WIDE_UI_ZOOM_DEFAULT, UI_SCALE_STEP, UI_ZOOM_DEFAULT, UI_ZOOM_MAX, UI_ZOOM_MIN, scaleLattice } from '../../platform/storage/facts';
import { MAX_SHOTS, MIN_SHOTS } from '../../state/shot-list';
import { CREEP_FACTOR, RUN_FACTOR } from '../../view/interaction/use-view-shortcuts';
import { CUSTOM_PROMPT_MAX, STYLIZE_PROVIDERS } from '../../pipelines/stylize/facts';
import { ruleToast } from '../../i18n/terms/rule-copy';
import { brandName } from '../../i18n/terms/brand';
import { searchExamples } from './search-examples';
import { formatNumber, localizedName, quantityParams, translateFor, translatorFor } from '../../i18n/context';
import type { Locale } from '../../core/model/locale';
import { joinList } from '../../i18n/locale-info';
import { findTrait, groundZonesOf, hasTrait, isBridge, isCoatingItem, isRamp, RAMP_UPPER_RUN } from '../../core/model/traits';

/** A fact ending in `Layer` is a layer number as the game counts it, made only by `layerNumber`; one
 *  ending in `Layers` lists them. Copy names a layer only through those (`__tests__/i18n/layer-name.test.ts`). */
interface HelpFacts {
  readonly [key: `${string}Layer`]: LayerNumber;
  readonly [key: string]: string | number;
}

const cached = new Map<Locale, HelpFacts>();
/** The table with a reader's values over it, per supplier and locale. */
const merged = new WeakMap<HelpFactsOf, Map<Locale, HelpFacts>>();

/** A cell count in the locale's own singular or plural form, a fraction written as the locale writes it. */
function cells(n: number, locale: Locale): string {
  return translateFor(locale, 'units.cells', quantityParams(locale, { n }));
}

/** Derived once per session and locale: the catalog is static data, and a live read per keystroke
 *  of the search field would rebuild these strings for nothing. `above` supplies the values whose
 *  owners rank above this layer; without it a string quoting one keeps its `{token}`. */
export function helpFacts(locale: Locale = 'en', above?: HelpFactsOf): HelpFacts {
  if (!above) return ownFacts(locale);
  let perLocale = merged.get(above);
  if (!perLocale) merged.set(above, perLocale = new Map());
  let facts = perLocale.get(locale);
  if (!facts) perLocale.set(locale, facts = { ...ownFacts(locale), ...above(locale) });
  return facts;
}

/** The values whose owners rank at or below this layer. */
function ownFacts(locale: Locale): HelpFacts {
  const hit = cached.get(locale);
  if (hit) return hit;
  const bridges = getPlaceableWhere(isBridge);
  const span = findTrait(bridges[0], 'waterSpan')!;
  const ramp = getPlaceableWhere(isRamp)[0]!;
  const drop = findTrait(ramp, 'heightDrop')!;
  const rampUpperRun = RAMP_UPPER_RUN;
  const trees = getPlaceableByRole('canopy');
  const roads = getPlaceableWhere(isCoatingItem);
  const spacing = findTrait(trees[0], 'exclusionRadius')!;
  const oneEach = getAllItems().filter((i) => i.maxCount === 1).length;
  const houseGap = findTrait(getAllItems().find(hasGate), 'exclusionRadius')!.radius;
  const sandNonHouses = getAllItems().filter((i) => !hasGate(i) && groundZonesOf(i).onSand);
  const narrowWidth = Math.min(...bridges.map((b) => b.width));
  const search = searchExamples(locale);
  const illustrationIds = STYLIZE_PROVIDERS.filter((provider) => provider.id !== 'custom');
  const coastLandmarks = LANDMARKS.filter((l) => l.editorPlaceable && l.ground === 'coast' && !l.anchor)
    .map((l) => getCatalogItem(l.id))
    .filter((item) => item !== undefined);
  const t = translatorFor(locale);
  const percent = (fraction: number) => Math.round(fraction * 100);
  const { richness, contrast, corridorWidth } = RECIPE_RANGES;
  const facts: HelpFacts = {
    app: brandName(locale),
    // `maxElev` and `mazeMaxElev` are counts of layers above the ground, not layer numbers.
    maxElev: ELEVATION_MAX,
    groundLayer: layerNumber(0),
    firstLayer: layerNumber(1),
    topLayer: layerNumber(ELEVATION_MAX),
    supportFreeLayer: layerNumber(BASE_SUPPORT.fromLayer - 1),
    supportFromLayer: layerNumber(BASE_SUPPORT.fromLayer),
    supportWindow: BASE_SUPPORT.window,
    supportReach: BASE_SUPPORT.reach,
    supportBaseLayer: layerNumber(BASE_SUPPORT.fromLayer - BASE_SUPPORT.reach),
    supportHighLayer: layerNumber(BASE_SUPPORT.fromLayer + BASE_SUPPORT.reach),
    chunkLimit: CHUNK_LOAD_LIMIT,
    planetMaxChunks: PLANET_PROFILE.maxChunks,
    coastLandmarks: joinList(locale, coastLandmarks.map((item) => localizedName(item.name, locale))),
    autosaveSeconds: AUTOSAVE_DEBOUNCE_MS / 1000,
    blueprintMaxSide: BLUEPRINT_MAX_SIDE,
    letterMinSide: STENCIL_MIN_SIDE.text,
    letterMaxChars: RECIPE_RANGES.textChars.max,
    pictureMinSide: STENCIL_MIN_SIDE.image,
    minLayer: layerNumber(RECIPE_RANGES.maxElevation.min),
    // Richness and contrast as their sliders read them: percent of the engine's fraction and factor.
    richMin: richness.min * 100,
    richMax: richness.max * 100,
    richDefault: percent(richness.default),
    contrastMin: percent(contrast.min),
    contrastMax: percent(contrast.max),
    contrastDefault: percent(contrast.default),
    corridorMin: corridorWidth.min,
    corridorMax: corridorWidth.max,
    mazeMaxElev: MAZE_MAX_ELEVATION,
    mazeTopLayer: layerNumber(MAZE_MAX_ELEVATION),
    candidates: CANDIDATES,
    seedDigits: String(SEED_MAX - 1).length,
    drawnSeedDigits: String(DRAWN_SEED_MAX - 1).length,
    brushMin: BRUSH_SIZE.min,
    brushMax: BRUSH_SIZE.max,
    thicknessMin: TERRAIN_THICKNESS.min,
    thicknessMax: TERRAIN_THICKNESS.max,
    objectSpacingMin: OBJECT_SPACING.min,
    objectSpacingMax: OBJECT_SPACING.max,
    recentSteps: RECENT_HISTORY_STEPS,
    uiScaleMin: percent(UI_ZOOM_MIN),
    uiScaleStep: percent(UI_SCALE_STEP),
    uiScaleDefault: percent(UI_ZOOM_DEFAULT),
    uiScaleTouchDefault: percent(TOUCH_UI_ZOOM_DEFAULT),
    uiScaleTouchWideDefault: percent(TOUCH_WIDE_UI_ZOOM_DEFAULT),
    uiScaleTouchMin: percent(scaleLattice(TOUCH_UI_ZOOM_DEFAULT, UI_ZOOM_MAX).lo),
    minShots: MIN_SHOTS,
    maxShots: MAX_SHOTS,
    customPromptMax: CUSTOM_PROMPT_MAX,
    runFactor: formatNumber(locale, RUN_FACTOR),
    creepFactor: formatNumber(locale, CREEP_FACTOR),
    baseRuleToast: ruleToast(t, 'error.need_base_support', { window: BASE_SUPPORT.window, reach: BASE_SUPPORT.reach }),
    waterRuleToast: ruleToast(t, 'error.water_uncapped'),
    noteColors: ANNOTATION_COLORS.length,
    titleLimit: NOTE_LIMITS.title,
    descriptionLimit: NOTE_LIMITS.description,
    rampDrop: drop.layers,
    rampRun: ramp.height,
    rampUpperRun,
    rampLowerRun: ramp.height - rampUpperRun,
    narrowBridge: joinList(locale, bridges.filter((b) => b.width === narrowWidth).map((b) => localizedName(b.name, locale))),
    narrowBridgeCells: cells(narrowWidth, locale),
    bridgeCells: cells(Math.max(...bridges.map((b) => b.width)), locale),
    searchItem: search.item,
    searchEnQuery: search.enQuery,
    searchTypo: search.typo,
    searchAliasItem: search.aliasItem,
    searchAlias: search.aliasQuery,
    searchAliasLatin: search.aliasLatin,
    searchWords: search.wordsQuery,
    searchWordA: search.wordsA,
    searchWordB: search.wordsB,
    bridgeMin: span.min,
    bridgeMax: span.max,
    treeGapCells: cells(spacing.radius, locale),
    houseGapCells: cells(houseGap, locale),
    doorDrop: formatNumber(locale, DOOR.dropDepth),
    doorRise: formatNumber(locale, DOOR.riseDepth),
    sandFacilities: joinList(locale, sandNonHouses.map((item) => localizedName(item.name, locale))),
    roadCount: roads.length,
    plantableRoads: joinList(locale, roads.filter((road) => hasTrait(road, 'plantable')).map((road) => localizedName(road.name, locale))),
    oneEachCount: oneEach,
    agentCustomProvider: providerName('custom', t),
    illustrationProviders: joinList(locale, illustrationIds.map(({ id }) => illustrationProviderName(id, t))),
  };
  cached.set(locale, facts);
  return facts;
}
