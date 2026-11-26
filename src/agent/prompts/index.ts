/**
 * Dynamic system prompt for the AI agent, built from the live rule registry and
 * item catalog — new rules and catalog items flow in automatically.
 *
 * Each rule is listed with its own description and each trait with its own (`rules/define.ts`,
 * `rules/placement.ts:TRAIT_DESCRIPTIONS`), so a changed rule or a new trait reaches the prompt with
 * no edit here; the assistant adds only its advice on a trait (`tools/rule-hints.ts`).
 *
 * The prompt is static per session (no timestamps/state) so the Anthropic
 * adapter's cache_control breakpoint keeps it cached across turns.
 *
 * Static prose lives in src/agent/prompts/*.md (imported via ?raw) so it can be
 * iterated without touching TS. Dynamic blocks (rules list, catalog digest) are
 * injected via {placeholder} substitution.
 */
import type { RuleDispatcher } from '../../core/model/rule-dispatcher';
import { traitAdvice } from '../tools/rule-hints';
import { TRAIT_DESCRIPTIONS } from '../../rules/placement';
import { BANNERS } from '../tools/feedback';
import { getAllItems } from '../../state/catalog';
import { NEIGHBORS } from '../../config/neighbors';
import type { CatalogItem, PlacementTrait } from '../../core/model/types';
import { APP_NAME } from '../../i18n/terms/brand';
import { isLocale, type Locale } from '../../core/model/locale';
import { LOCALE_INFO } from '../../i18n/locale-info';
import { localizedName } from '../../i18n/context';

import identity from './01-identity.md?raw';
import rulesSection from './02-rules.md?raw';
import traitsSection from './03-traits.md?raw';
import catalogSection from './04-catalog.md?raw';
import designPrinciples from './05-design-principles.md?raw';
import recipes from './06-recipes.md?raw';
import trust from './07-trust.md?raw';
import contentPolicy from './08-content-policy.md?raw';
import workflow from './09-workflow.md?raw';
import placeBuilder from './12-place-builder.md?raw';
import districtLead from './13-district-lead.md?raw';
import { BASE_SUPPORT, CHUNK_LOAD_LIMIT, CHUNK_SIZE, ELEVATION_MAX, GAME_NAME, layerNumber } from '../../core/game/profile';
import { BUILDABLE_ZONES, fixedFeatures } from '../tools/game-terms';

/** Replace all occurrences of {key} in template with the corresponding value. */
function inject(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (s, [k, v]) => s.split(`{${k}}`).join(v),
    template,
  );
}

type TraitType = PlacementTrait['type'];

/** How CATALOG writes the fields of a trait that has any: `form` names them as TRAITS lists the
 *  trait, `of` writes one item's values. */
const TRAIT_FIELDS: { [K in TraitType]?: { form: string; of(t: Extract<PlacementTrait, { type: K }>): string } } = {
  waterSpan: { form: 'min-max', of: (t) => `${t.min}-${t.max}` },
  heightDrop: { form: 'layers', of: (t) => `${t.layers}` },
  exclusionRadius: { form: 'radius', of: (t) => `${t.radius}` },
  groundZones: {
    form: 'grass/sand/across',
    of: (t) => [t.onGrass && 'grass', t.onSand && 'sand', t.acrossBoundary && 'across'].filter(Boolean).join('/'),
  },
};

function traitStr(t: PlacementTrait): string {
  const fields = TRAIT_FIELDS[t.type] as { of(t: PlacementTrait): string } | undefined;
  return fields ? `${t.type} ${fields.of(t)}` : t.type;
}

/** One line per registered trait: the name as CATALOG writes it, the trait's own description, and
 *  the assistant's advice where it has any. */
function traitLines(): string {
  return [...TRAIT_DESCRIPTIONS]
    .map(([type, description]) => {
      const form = TRAIT_FIELDS[type]?.form;
      return `- ${form ? `${type} ${form}` : type}: ${description}${traitAdvice(type)}`;
    })
    .join('\n');
}

/** What items of one kind share: footprint, traits, cap and whether they turn. */
function itemKind(i: CatalogItem): string {
  const traits = i.traits.map(traitStr).join('+') || 'none';
  const max = i.maxCount !== undefined ? ` max=${i.maxCount}` : '';
  return `${i.width}x${i.height}, ${traits}${max}${i.rotatable ? ' rotatable' : ''}`;
}

/** An item's English name where it says more than its id ("Deep Blue Flight Route Print" for
 *  print-flight-blue-route), else nothing: most ids already read as their names. */
function nameBeyondId(i: CatalogItem): string {
  const idWords = new Set(i.id.toLowerCase().split('-'));
  const extra = i.name.en.toLowerCase().split(/[^a-z]+/).filter((w) => w && !idWords.has(w));
  return extra.length > 0 ? ` "${i.name.en}"` : '';
}

/** A category's items grouped by kind, one line per kind, each id with its load: most of a category
 *  shares one kind, so the kind is said once instead of once per item. */
function categoryLines(items: readonly CatalogItem[]): string {
  const kinds = new Map<string, string[]>();
  for (const i of items) {
    const ids = kinds.get(itemKind(i)) ?? [];
    ids.push(`${i.id}=${i.loadUnknown ? '?' : Math.round(i.loadValue)}${nameBeyondId(i)}`);
    kinds.set(itemKind(i), ids);
  }
  return [...kinds].map(([kind, ids]) => `  (${kind}): ${ids.join(' ')}`).join('\n');
}

/** Whose home each neighbour's house is, named in English and the interface language, so that a
 *  request naming a neighbour finds their house; their tastes stay in the neighbors skill. */
function neighborHomes(uiLocale: Locale): string {
  const homes = NEIGHBORS.flatMap(({ name, profile }) => {
    if (!profile) return [];
    return [`${profile.house} ${[...new Set([name.en, localizedName(name, uiLocale)])].join(' / ')}`];
  });
  return `NEIGHBOR HOMES (whose house each is; load the neighbors skill for what they love): ${homes.join('; ')}`;
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
    .map(([cat, items]) => `${cat.toUpperCase()}:\n${categoryLines(items)}`)
    .concat(neighborHomes(uiLocale))
    .join('\n');

  const rules = registry
    .getRules()
    // The requirement only: a refusal carries the assistant's advice at the moment it applies.
    .map(({ id, phase, description }) => `- ${id} [${phase}]: ${description}`)
    .join('\n');

  // Sections assemble in file-number order; 10 and 11 are the summarizer and reply-draft prompts.
  const sections = [
    inject(
      identity,
      {
        elevMax: String(ELEVATION_MAX), topLayer: String(layerNumber(ELEVATION_MAX)),
        app: APP_NAME, game: GAME_NAME, buildable: BUILDABLE_ZONES, uiLanguage: LOCALE_INFO[uiLocale].englishName,
      },
    ),
    inject(rulesSection, { rules, ...BANNERS }),
    inject(traitsSection, { traits: traitLines() }),
    inject(catalogSection, { catalog, chunk: String(CHUNK_SIZE), limit: String(CHUNK_LOAD_LIMIT) }),
    designPrinciples,
    inject(recipes, { supportWindow: String(BASE_SUPPORT.window), supportFrom: String(BASE_SUPPORT.fromLayer) }),
    trust,
    contentPolicy,
    // An elevation comfortably past the ceiling, for the example of an impossible request.
    inject(workflow, { elevBeyond: String(ELEVATION_MAX + 4), fixedFeatures: fixedFeatures() }),
  ];

  return sections.join('\n\n');
}

const headingOf = (section: string): string => section.split('\n')[0]!;

/** The lead's prompt without its recipes and workflow, which reach beyond what a district lead or a helper is offered (`tools/registry.ts`), closed by `role`'s own method. */
function rolePrompt(leadSystem: string, role: string): string {
  const dropped = new Set([headingOf(recipes), headingOf(workflow)]);
  const kept: string[] = [];
  let keep = true;
  for (const line of leadSystem.split('\n')) {
    if (line.startsWith('# ')) keep = !dropped.has(line);
    if (keep) kept.push(line);
  }
  return `${kept.join('\n').trimEnd()}\n\n${role.trimEnd()}`;
}

/** The system prompt a helper runs on, made from the lead's: the same world, rules, catalogue and principles, then how one place is built. */
export function helperSystemPrompt(leadSystem: string): string {
  return rolePrompt(leadSystem, placeBuilder);
}

/** The system prompt a district lead runs on, made from the lead's: the same world, rules, catalogue and principles, then how a district is led. */
export function districtSystemPrompt(leadSystem: string): string {
  return rolePrompt(leadSystem, districtLead);
}
