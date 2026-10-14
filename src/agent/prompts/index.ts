/**
 * Dynamic system prompt for the AI agent, built from the live rule registry and
 * item catalog — new rules and catalog items flow in automatically.
 *
 * The per-rule guidance is `tools/rule-hints.ts:RULE_HINTS`, keyed by rule id. A unit test fails
 * if a registered rule has no hint, and an unknown id still degrades to an id-only listing at
 * runtime, so rules are never silently omitted.
 *
 * The prompt is static per session (no timestamps/state) so the Anthropic
 * adapter's cache_control breakpoint keeps it cached across turns.
 *
 * Static prose lives in src/agent/prompts/*.md (imported via ?raw) so it can be
 * iterated without touching TS. Dynamic blocks (rules list, catalog digest) are
 * injected via {placeholder} substitution.
 */
import type { RuleDispatcher } from '../../core/model/rule-dispatcher';
import { ruleHint } from '../tools/rule-hints';
import { BANNERS } from '../tools/feedback';
import { getAllItems } from '../../state/catalog';
import type { CatalogItem, PlacementTrait } from '../../core/model/types';
import { APP_NAME } from '../../i18n/brand';
import { isLocale } from '../../core/model/locale';
import { LOCALE_INFO } from '../../i18n/locale-info';

import identity from './01-identity.md?raw';
import rulesSection from './02-rules.md?raw';
import traitsSection from './03-traits.md?raw';
import catalogSection from './04-catalog.md?raw';
import designPrinciples from './05-design-principles.md?raw';
import recipes from './06-recipes.md?raw';
import trust from './07-trust.md?raw';
import contentPolicy from './08-content-policy.md?raw';
import workflow from './09-workflow.md?raw';
import { BASE_SUPPORT, ELEVATION_MAX, GAME_NAME } from '../../core/game/profile';
import { RAMP_UPPER_RUN } from '../../core/model/traits';
import { BUILDABLE_ZONES, fixedFeatures } from '../tools/game-terms';

/** Replace all occurrences of {key} in template with the corresponding value. */
function inject(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (s, [k, v]) => s.split(`{${k}}`).join(v),
    template,
  );
}

function traitStr(t: PlacementTrait): string {
  switch (t.type) {
    case 'waterSpan': return `waterSpan ${t.min}-${t.max}`;
    case 'heightDrop': return `heightDrop ${t.layers}`;
    case 'exclusionRadius': return `exclusionRadius ${t.radius}`;
    default: return t.type;
  }
}

function itemLine(i: CatalogItem): string {
  const traits = i.traits.map(traitStr).join('+') || 'none';
  const max = i.maxCount !== undefined ? ` max=${i.maxCount}` : '';
  const rot = i.rotatable ? ' rotatable' : '';
  return `  ${i.id} (${i.width}x${i.height}, ${traits}${max}${rot}, load=${i.loadUnknown ? 'unknown (counted as 0)' : i.loadValue})`;
}

export function buildSystemPrompt(registry: RuleDispatcher, opts?: { uiLocale?: string }): string {
  const uiLocale = isLocale(opts?.uiLocale) ? opts.uiLocale : 'en';
  const byCat = new Map<string, CatalogItem[]>();
  for (const item of getAllItems()) {
    const list = byCat.get(item.category) ?? [];
    list.push(item);
    byCat.set(item.category, list);
  }
  const catalog = [...byCat.entries()]
    .map(([cat, items]) => `${cat.toUpperCase()}:\n${items.map(itemLine).join('\n')}`)
    .join('\n');

  const rules = registry
    .getRules()
    .map(({ id, phase }) => `- ${id} [${phase}]: ${ruleHint(id) ?? '(no description — obey its error messages)'}`)
    .join('\n');

  // Sections assemble in file-number order; 10 and 11 are the summarizer and reply-draft prompts.
  const sections = [
    inject(
      identity,
      { elevMax: String(ELEVATION_MAX), app: APP_NAME, game: GAME_NAME, buildable: BUILDABLE_ZONES, uiLanguage: LOCALE_INFO[uiLocale].englishName },
    ),
    inject(rulesSection, { rules, ...BANNERS }),
    inject(traitsSection, { rampUpperRun: String(RAMP_UPPER_RUN) }),
    inject(catalogSection, { catalog }),
    designPrinciples,
    inject(recipes, { supportWindow: String(BASE_SUPPORT.window), supportFrom: String(BASE_SUPPORT.fromLayer) }),
    trust,
    contentPolicy,
    // An elevation comfortably past the ceiling, for the example of an impossible request.
    inject(workflow, { elevBeyond: String(ELEVATION_MAX + 4), fixedFeatures: fixedFeatures() }),
  ];

  return sections.join('\n\n');
}
