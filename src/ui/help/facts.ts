/*
 * The numbers and names the help quotes but never owns.
 *
 * Everything here is read from the source that declares it (constants, the catalog, the live
 * i18n table), so a change there changes the help with no copy edit. Pages receive the whole
 * record as `{token}` params on every string; a string uses the tokens it needs.
 */
import { illustrationProviderName, providerName } from '../../i18n/terms/providers';
import { NOTE_LIMITS } from '../../core/model/notes';
import { PLANET_PROFILE, CHUNK_LOAD_LIMIT, ELEVATION_MAX, BASE_SUPPORT, DOOR, LANDMARKS, layerNumber, type LayerNumber } from '../../core/game/profile';
import { layerNumeral } from '../../i18n/terms/layer-name';
import { hasGate } from '../../state/object-geometry';
import { ANNOTATION_COLORS } from '../../config/annotation-palette';
import { ItemCategory } from '../../config/catalog/categories';
import { getAllItems, getCatalogItem, getPlaceableByCategory } from '../../state/catalog';
import { PROVIDER_IDS, providerBaseUrls } from './edition-help';
import { AUTOSAVE_DEBOUNCE_MS } from '../../io/storage/facts';
import {
  BETWEEN_EVENT_IDLE_MS, FIRST_EVENT_IDLE_MS, MAX_TURNS_DEFAULT, MAX_TURN_ATTEMPTS, SUBAGENT_MAX_TURNS,
} from '../../agent/limits';
import { CANDIDATES, CONTRAST, CORRIDOR, MIN_ELEVATION, RICHNESS, SEED_DIGITS, STENCIL_MIN_SIDE, TEXT_MAX_CHARS } from '../shell/bars/generate/generate-shelf';
import { DRAWN_SEED_MAX, MAZE_MAX_ELEVATION } from '../../tools/generation/facts';
import { BRUSH_SIZE } from '../../state/editing/edit-mode';
import { RECENT_HISTORY_STEPS } from '../../io/export/facts';
import { UI_ZOOM_DEFAULT, UI_ZOOM_MIN } from '../../platform/storage/prefs';
import { UI_SCALE_STEP } from '../chrome/modals/settings/UiScaleSlider';
import { MAX_SHOTS, MIN_SHOTS } from '../../view/map3d/capture/shot-list';
import { CREEP_FACTOR, RUN_FACTOR } from '../../view/interaction/use-view-shortcuts';
import { CUSTOM_PROMPT_MAX, STYLIZE_PROVIDERS } from '../../pipelines/stylize/facts';
import { ruleToast } from '../../i18n/terms/rule-copy';
import { CONTRAST_SHOTS, HEIGHT_SHOTS, RELIEF_SHOTS, RICHNESS_SHOTS } from './figures/previews/generate-shots';
import { brandName } from '../../i18n/terms/brand';
import { searchExamples } from './search-examples';
import { formatNumber, localizedName, quantityParams, translateFor, translatorFor } from '../../i18n/context';
import type { Locale } from '../../core/model/locale';
import { joinList } from '../../i18n/locale-info';
import { findTrait, groundZonesOf, hasTrait, RAMP_UPPER_RUN } from '../../core/model/traits';

/** A fact ending in `Layer` is a layer number as the game counts it, made only by `layerNumber`; one
 *  ending in `Layers` lists them. Copy names a layer only through those (`__tests__/i18n/layer-name.test.ts`). */
interface HelpFacts {
  readonly [key: `${string}Layer`]: LayerNumber;
  readonly [key: string]: string | number;
}

const cached = new Map<string, HelpFacts>();

/** A cell count in the locale's own singular or plural form, a fraction written as the locale writes it. */
function cells(n: number, locale: Locale): string {
  return translateFor(locale, 'units.cells', quantityParams(locale, { n }));
}

/** Derived once per session and locale: the catalog is static data, and a live read per keystroke
 *  of the search field would rebuild these strings for nothing. The locale carries the one
 *  locale-dependent fact, the product's display name (`{app}`). */
export function helpFacts(locale: Locale = 'en'): HelpFacts {
  const hit = cached.get(locale);
  if (hit) return hit;
  const bridges = getPlaceableByCategory(ItemCategory.Bridge);
  const span = findTrait(bridges[0], 'waterSpan')!;
  const ramp = getPlaceableByCategory(ItemCategory.Ramp)[0]!;
  const drop = findTrait(ramp, 'heightDrop')!;
  const rampUpperRun = RAMP_UPPER_RUN;
  const trees = getPlaceableByCategory(ItemCategory.Tree);
  const spacing = findTrait(trees[0], 'exclusionRadius')!;
  const oneEach = getAllItems().filter((i) => i.maxCount === 1).length;
  const houseGap = findTrait(getAllItems().find(hasGate), 'exclusionRadius')!.radius;
  const sandNonHouses = getAllItems().filter((i) => !hasGate(i) && groundZonesOf(i).onSand);
  const narrowWidth = Math.min(...bridges.map((b) => b.width));
  const search = searchExamples(locale);
  const agentIds = PROVIDER_IDS.filter((id) => id !== 'custom');
  const regionalAgentIds = agentIds.filter((id) => providerBaseUrls(id).length > 1);
  const illustrationIds = STYLIZE_PROVIDERS.filter((provider) => provider.id !== 'custom');
  const coastLandmarks = LANDMARKS.filter((l) => l.editorPlaceable && l.ground === 'coast' && !l.anchor)
    .map((l) => getCatalogItem(l.id))
    .filter((item) => item !== undefined);
  const t = translatorFor(locale);
  const percent = (fraction: number) => Math.round(fraction * 100);
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
    agentMaxTurns: MAX_TURNS_DEFAULT,
    agentChildTurns: SUBAGENT_MAX_TURNS,
    agentTries: MAX_TURN_ATTEMPTS,
    agentFirstWaitMinutes: FIRST_EVENT_IDLE_MS / 60_000,
    agentBetweenWaitMinutes: BETWEEN_EVENT_IDLE_MS / 60_000,
    letterMinSide: STENCIL_MIN_SIDE.text,
    letterMaxChars: TEXT_MAX_CHARS,
    pictureMinSide: STENCIL_MIN_SIDE.image,
    minLayer: layerNumber(MIN_ELEVATION),
    richMin: RICHNESS.min,
    richMax: RICHNESS.max,
    richDefault: RICHNESS.default,
    richShots: joinList(locale, RICHNESS_SHOTS.map(String)),
    tallShotLayers: joinList(locale, HEIGHT_SHOTS.map(layerNumeral)),
    contrastMin: CONTRAST.min,
    contrastMax: CONTRAST.max,
    contrastDefault: CONTRAST.default,
    contrastShots: joinList(locale, CONTRAST_SHOTS.map((n) => t('generate.percent', { n }))),
    reliefShotLayers: joinList(locale, RELIEF_SHOTS.map(layerNumeral)),
    corridorMin: CORRIDOR.min,
    corridorMax: CORRIDOR.max,
    mazeMaxElev: MAZE_MAX_ELEVATION,
    mazeTopLayer: layerNumber(MAZE_MAX_ELEVATION),
    candidates: CANDIDATES,
    seedDigits: SEED_DIGITS,
    drawnSeedDigits: String(DRAWN_SEED_MAX - 1).length,
    brushMin: BRUSH_SIZE.min,
    brushMax: BRUSH_SIZE.max,
    recentSteps: RECENT_HISTORY_STEPS,
    uiScaleMin: percent(UI_ZOOM_MIN),
    uiScaleStep: percent(UI_SCALE_STEP),
    uiScaleDefault: percent(UI_ZOOM_DEFAULT),
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
    roadCount: getPlaceableByCategory(ItemCategory.Road).length,
    plantableRoads: joinList(locale, getPlaceableByCategory(ItemCategory.Road).filter((road) => hasTrait(road, 'plantable')).map((road) => localizedName(road.name, locale))),
    oneEachCount: oneEach,
    agentProviderCount: agentIds.length,
    agentProviders: joinList(locale, agentIds.map((id) => providerName(id, t))),
    regionalAgentProviders: joinList(locale, regionalAgentIds.map((id) => providerName(id, t))),
    agentCustomProvider: providerName('custom', t),
    illustrationProviders: joinList(locale, illustrationIds.map(({ id }) => illustrationProviderName(id, t))),
  };
  cached.set(locale, facts);
  return facts;
}
