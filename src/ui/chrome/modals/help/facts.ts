import { providerName } from '../../../../i18n/providers';
/*
 * facts.ts — the numbers and names the help quotes but never owns.
 *
 * Everything here is READ from the source that declares it (constants, the catalog, the live
 * i18n table), so a change there changes the help with no copy edit. Pages receive the whole
 * record as `{token}` params on every string; a string uses the tokens it needs.
 */
import { CHUNK_LOAD_LIMIT, ELEVATION_MAX } from '../../../../core/model/constants';
import { ANNOTATION_COLORS } from '../../../../core/model/annotations';
import { ItemCategory, type PlacementTrait } from '../../../../core/model/types';
import { getAllItems, getPlaceableByCategory } from '../../../../state/catalog';
import { PROVIDER_IDS, providerBaseUrls } from './edition-help';
import { AUTOSAVE_DEBOUNCE_MS } from '../../../../io/autosave';
import { MAX_TURNS_DEFAULT, SUBAGENT_MAX_TURNS } from '../../../../agent/core/governor';
import { STYLIZE_PROVIDERS } from '../../../../io/stylize/providers';
import { brandName } from '../../../../version';
import { translateFor } from '../../../../i18n/context';
import type { Locale } from '../../../../core/model/types';

export interface HelpFacts {
  readonly [key: string]: string | number;
}

function trait<T extends PlacementTrait['type']>(traits: readonly PlacementTrait[] | undefined, type: T) {
  return traits?.find((t): t is Extract<PlacementTrait, { type: T }> => t.type === type);
}

const cached = new Map<string, HelpFacts>();

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
  const span = trait(bridges[0]?.traits, 'waterSpan');
  const trees = getPlaceableByCategory(ItemCategory.Tree);
  const spacing = trait(trees[0]?.traits, 'exclusionRadius');
  const oneEach = getAllItems().filter((i) => i.maxCount === 1).length;
  const agentIds = PROVIDER_IDS.filter((id) => id !== 'custom');
  const regionalAgentIds = agentIds.filter((id) => providerBaseUrls(id).length > 1);
  const illustrationIds = STYLIZE_PROVIDERS.filter((provider) => provider.id !== 'custom');
  const facts: HelpFacts = {
    app: brandName(locale),
    modeObject: translateFor(locale as Locale, 'mode.object'),
    modeRoad: translateFor(locale as Locale, 'mode.road'),
    modeMountain: translateFor(locale as Locale, 'mode.mountain'),
    modeWater: translateFor(locale as Locale, 'mode.water'),
    modeGenerate: translateFor(locale as Locale, 'mode.generate'),
    smartBuild: translateFor(locale, 'smart.build'),
    smartRaise: translateFor(locale as Locale, 'smart.raise'),
    smartStream: translateFor(locale as Locale, 'smart.stream'),
    smartRoad: translateFor(locale as Locale, 'smart.road_link'),
    maxElev: ELEVATION_MAX,
    chunkLimit: CHUNK_LOAD_LIMIT,
    autosaveSeconds: AUTOSAVE_DEBOUNCE_MS / 1000,
    agentMaxTurns: MAX_TURNS_DEFAULT,
    agentChildTurns: SUBAGENT_MAX_TURNS,
    noteColors: ANNOTATION_COLORS.length,
    bridgeMin: span?.min ?? 3,
    bridgeMax: span?.max ?? 6,
    treeGap: spacing?.radius ?? 1,
    roadCount: getPlaceableByCategory(ItemCategory.Road).length,
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
