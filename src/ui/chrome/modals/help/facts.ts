/*
 * The numbers and names the help quotes but never owns.
 *
 * Everything here is READ from the source that declares it (constants, the catalog, the live
 * i18n table), so a change there changes the help with no copy edit. Pages receive the whole
 * record as `{token}` params on every string; a string uses the tokens it needs.
 */
import { providerName } from '../../../../i18n/providers';
import { TILE_SIZE } from '../../../../core/model/constants';
import { HALF_TILE } from '../../../../core/model/grid-model';
import { NOTE_LIMITS } from '../../../../core/model/notes';
import { PLANET_PROFILE, CHUNK_LOAD_LIMIT, ELEVATION_MAX, BASE_SUPPORT } from '../../../../core/model/game-profile';
import { ANNOTATION_COLORS } from '../../../../core/model/annotations';
import { ItemCategory } from '../../../../core/model/types';
import { getAllItems, getPlaceableByCategory } from '../../../../state/catalog';
import { PROVIDER_IDS, providerBaseUrls } from './edition-help';
import { AUTOSAVE_DEBOUNCE_MS } from '../../../../io/autosave';
import { MAX_TURNS_DEFAULT, SUBAGENT_MAX_TURNS } from '../../../../agent/core/governor';
import { STYLIZE_PROVIDERS } from '../../../../io/stylize/providers';
import { brandName } from '../../../../version';
import { searchExamples } from './search-examples';
import { modeLabelKey } from '../../../shell/frame';
import { localizedName, translateFor } from '../../../../i18n/context';
import type { Locale } from '../../../../core/model/types';
import { findTrait, hasTrait } from '../../../../core/model/traits';

interface HelpFacts {
  readonly [key: string]: string | number;
}

const cached = new Map<string, HelpFacts>();

/** A cell count in the locale's own singular or plural form. */
function cells(n: number, locale: Locale): string {
  return translateFor(locale, n === 1 ? 'units.cells_one' : 'units.cells', { n });
}

const CONJUNCTION: Record<Exclude<Locale, 'zh' | 'ja'>, string> = {
  en: 'and',
  ru: 'и',
  th: 'และ',
  id: 'dan',
  fr: 'et',
};

/** Join registry names with the punctuation and conjunction of the active help locale. */
function naturalList(values: readonly string[], locale: Locale): string {
  if (values.length < 2) return values[0] ?? '';
  if (locale === 'zh' || locale === 'ja') return values.join('、');
  if (values.length === 2) return `${values[0]} ${CONJUNCTION[locale]} ${values[1]}`;
  return `${values.slice(0, -1).join(', ')} ${CONJUNCTION[locale]} ${values[values.length - 1]}`;
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
  const rampUpperRun = HALF_TILE / TILE_SIZE;
  const trees = getPlaceableByCategory(ItemCategory.Tree);
  const spacing = findTrait(trees[0], 'exclusionRadius')!;
  const oneEach = getAllItems().filter((i) => i.maxCount === 1).length;
  const narrowWidth = Math.min(...bridges.map((b) => b.width));
  const search = searchExamples(locale);
  const agentIds = PROVIDER_IDS.filter((id) => id !== 'custom');
  const regionalAgentIds = agentIds.filter((id) => providerBaseUrls(id).length > 1);
  const illustrationIds = STYLIZE_PROVIDERS.filter((provider) => provider.id !== 'custom');
  const facts: HelpFacts = {
    app: brandName(locale),
    modeObject: translateFor(locale as Locale, 'mode.object'),
    modeRoad: translateFor(locale as Locale, 'mode.road'),
    modeMountain: translateFor(locale as Locale, 'mode.mountain'),
    modeTerrain: translateFor(locale as Locale, modeLabelKey('mountain', true)),
    modeWater: translateFor(locale as Locale, 'mode.water'),
    modeGenerate: translateFor(locale as Locale, 'mode.generate'),
    smartBuild: translateFor(locale, 'smart.build'),
    smartRaise: translateFor(locale as Locale, 'smart.raise'),
    smartStream: translateFor(locale as Locale, 'smart.stream'),
    smartRoad: translateFor(locale as Locale, 'smart.road_link'),
    maxElev: ELEVATION_MAX,
    supportFree: BASE_SUPPORT.fromLayer - 1,
    supportFrom: BASE_SUPPORT.fromLayer,
    supportWindow: BASE_SUPPORT.window,
    supportReach: BASE_SUPPORT.reach,
    supportFromBase: BASE_SUPPORT.fromLayer - BASE_SUPPORT.reach,
    supportHigh: BASE_SUPPORT.fromLayer + BASE_SUPPORT.reach,
    chunkLimit: CHUNK_LOAD_LIMIT,
    planetMaxChunks: PLANET_PROFILE.maxChunks,
    autosaveSeconds: AUTOSAVE_DEBOUNCE_MS / 1000,
    agentMaxTurns: MAX_TURNS_DEFAULT,
    agentChildTurns: SUBAGENT_MAX_TURNS,
    noteColors: ANNOTATION_COLORS.length,
    titleLimit: NOTE_LIMITS.title,
    descriptionLimit: NOTE_LIMITS.description,
    measureTool: translateFor(locale, 'annot.measure'),
    flipMeasure: translateFor(locale, 'annot.flip'),
    immersiveMode: translateFor(locale, 'modal.settings_immersive'),
    notesName: translateFor(locale, 'annot.layer'),
    settingsName: translateFor(locale, 'modal.settings_title'),
    importName: translateFor(locale, 'import.title'),
    planetName: translateFor(locale, 'modal.new_title'),
    shareName: translateFor(locale, 'share.title'),
    keepName: translateFor(locale, 'share.tab_keep'),
    resumeName: translateFor(locale, 'restore.resume'),
    islandName: translateFor(locale, 'gen.kind_island'),
    mazeName: translateFor(locale, 'generate.algo_maze'),
    letterName: translateFor(locale, 'gen.kind_text'),
    pictureName: translateFor(locale, 'gen.kind_image'),
    rampDrop: drop.layers,
    rampRun: ramp.height,
    rampUpperRun,
    rampLowerRun: ramp.height - rampUpperRun,
    narrowBridge: naturalList(bridges.filter((b) => b.width === narrowWidth).map((b) => localizedName(b.name, locale)), locale),
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
    treeGap: spacing.radius,
    roadCount: getPlaceableByCategory(ItemCategory.Road).length,
    plantableRoads: naturalList(
      getPlaceableByCategory(ItemCategory.Road).filter((road) => hasTrait(road, 'plantable')).map((road) => localizedName(road.name, locale)),
      locale,
    ),
    oneEachCount: oneEach,
    agentProviderCount: agentIds.length,
    agentProviders: naturalList(agentIds.map((id) => providerName(id, (key) => translateFor(locale, key))), locale),
    regionalAgentProviders: naturalList(regionalAgentIds.map((id) => providerName(id, (key) => translateFor(locale, key))), locale),
    agentCustomProvider: providerName('custom', (key) => translateFor(locale, key)),
    illustrationProviders: naturalList(
      illustrationIds.map(({ id }) => translateFor(locale, `stylize.provider_${id}`)),
      locale,
    ),
  };
  cached.set(locale, facts);
  return facts;
}
