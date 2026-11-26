/*
 * The values Help's copy quotes whose owners rank above `editor`: the assistant's limits and
 * provider lists, which the offline edition answers with none, and the settings the Generate figures
 * show side by side. `editor/help/facts.ts` builds every other value and merges these over them.
 */
import {
  BETWEEN_EVENT_IDLE_MS, FIRST_EVENT_IDLE_MS, MAX_TURNS_DEFAULT, MAX_TURN_ATTEMPTS, SUBAGENT_MAX_TURNS,
} from '../../agent/limits';
import type { Locale } from '../../core/model/locale';
import { helpFacts } from '../../editor/help/facts';
import type { HelpFactsOf } from '../../editor/help/page-schema';
import { translatorFor } from '../../i18n/context';
import { joinList } from '../../i18n/locale-info';
import { layerNumeral } from '../../i18n/terms/layer-name';
import { providerName } from '../../i18n/terms/providers';
import { PROVIDER_IDS, providerBaseUrls } from './edition-help';
import { CONTRAST_SHOTS, HEIGHT_SHOTS, RELIEF_SHOTS, RICHNESS_SHOTS } from './figures/previews/generate-shots';

const cached = new Map<Locale, ReturnType<HelpFactsOf>>();

/** Derived once per session and locale, as the table below it is. */
export const helpFactsAbove: HelpFactsOf = (locale) => {
  const hit = cached.get(locale);
  if (hit) return hit;
  const t = translatorFor(locale);
  const agentIds = PROVIDER_IDS.filter((id) => id !== 'custom');
  const regionalAgentIds = agentIds.filter((id) => providerBaseUrls(id).length > 1);
  const facts: ReturnType<HelpFactsOf> = {
    agentMaxTurns: MAX_TURNS_DEFAULT,
    agentChildTurns: SUBAGENT_MAX_TURNS,
    agentTries: MAX_TURN_ATTEMPTS,
    agentFirstWaitMinutes: FIRST_EVENT_IDLE_MS / 60_000,
    agentBetweenWaitMinutes: BETWEEN_EVENT_IDLE_MS / 60_000,
    agentProviderCount: agentIds.length,
    agentProviders: joinList(locale, agentIds.map((id) => providerName(id, t))),
    regionalAgentProviders: joinList(locale, regionalAgentIds.map((id) => providerName(id, t))),
    richShots: joinList(locale, RICHNESS_SHOTS.map(String)),
    tallShotLayers: joinList(locale, HEIGHT_SHOTS.map(layerNumeral)),
    contrastShots: joinList(locale, CONTRAST_SHOTS.map((n) => t('generate.percent', { n }))),
    reliefShotLayers: joinList(locale, RELIEF_SHOTS.map(layerNumeral)),
  };
  cached.set(locale, facts);
  return facts;
};

/** Every value Help's copy quotes, as the Help window and its figures read them. */
export function readerFacts(locale: Locale): ReturnType<typeof helpFacts> {
  return helpFacts(locale, helpFactsAbove);
}
