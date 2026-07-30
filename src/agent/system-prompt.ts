/**
 * Dynamic system prompt for the AI agent, built from the LIVE rule registry and
 * item catalog — new rules and catalog items flow in automatically.
 *
 * The per-rule guidance lives on each rule's own `agentHint` (see rules/index.ts
 * RULE_HINTS) — the single source of truth, colocated with the policy. A unit
 * test fails if a registered rule has no hint, and an unknown id still degrades
 * to an id-only listing at runtime, so rules are never silently omitted.
 *
 * The prompt is static per session (no timestamps/state) so the Anthropic
 * adapter's cache_control breakpoint keeps it cached across turns.
 *
 * Static prose lives in src/agent/prompts/*.md (imported via ?raw) so it can be
 * iterated without touching TS. Dynamic blocks (rules list, catalog digest) are
 * injected via {placeholder} substitution.
 */
import type { RuleDispatcher } from '../core/model/rule-dispatcher';
import { RULE_HINTS } from '../rules';
import { getAllItems } from '../state/catalog';
import type { CatalogItem, PlacementTrait } from '../core/model/types';
import { ELEVATION_MAX } from '../core/model/constants';
import { APP_NAME } from '../version';

import identity from './prompts/01-identity.md?raw';
import rulesSection from './prompts/02-rules.md?raw';
import traitsSection from './prompts/03-traits.md?raw';
import catalogSection from './prompts/04-catalog.md?raw';
import designPrinciples from './prompts/05-design-principles.md?raw';
import workflow from './prompts/06-workflow.md?raw';
import recipes from './prompts/07-recipes.md?raw';

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
  return `  ${i.id} (${i.width}x${i.height}, ${traits}${max}${rot})`;
}

/** Human names for the editor's display locales ({uiLanguage} fallback hint). */
const LOCALE_NAMES: Record<string, string> = {
  en: 'English', zh: 'Simplified Chinese', ja: 'Japanese', ru: 'Russian',
  th: 'Thai', id: 'Indonesian', fr: 'French',
};

export function buildSystemPrompt(registry: RuleDispatcher, opts?: { uiLocale?: string }): string {
  const byCat = new Map<string, CatalogItem[]>();
  for (const item of getAllItems()) {
    if (item.id.startsWith('__')) continue; // synthetic (the plaza)
    const list = byCat.get(item.category) ?? [];
    list.push(item);
    byCat.set(item.category, list);
  }
  const catalog = [...byCat.entries()]
    .map(([cat, items]) => `${cat.toUpperCase()}:\n${items.map(itemLine).join('\n')}`)
    .join('\n');

  const rules = registry
    .getRules()
    .map(({ id, phase }) => `- ${id} [${phase}]: ${RULE_HINTS[id] ?? '(no description — obey its error messages)'}`)
    .join('\n');

  const sections = [
    inject(identity, { elevMax: String(ELEVATION_MAX), app: APP_NAME, uiLanguage: LOCALE_NAMES[opts?.uiLocale ?? 'en'] ?? 'English' }),
    inject(rulesSection, { rules }),
    traitsSection,
    inject(catalogSection, { catalog }),
    designPrinciples,
    workflow,
    recipes,
  ];

  return sections.join('\n\n');
}
