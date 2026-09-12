/*
 * The Help Center's catalog held together: every page of the union present exactly once, every
 * cross-reference resolving, every referenced string present in the reference tables, and every
 * figure naming a scene or mock that exists. This is the test that makes the catalog a CONTRACT:
 * a descriptor cannot point at prose, a page or a drawing that is not there.
 */
import { describe, expect, it, vi } from 'vitest';

/** The catalog under test is the development one, which carries every help string. Sections a
 *  released build withholds are pinned in `custom-card-gate.test.ts`. */
vi.mock('../../../version', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../version')>();
  return { ...actual, IS_DEV_BUILD: true };
});
import { HELP_GROUPS, HELP_PAGES, HELP_PAGE_ORDER } from '../../../ui/chrome/modals/help/catalog';
import { HELP_SCENES, type DemoView, type HelpScene, type SceneStep } from '../../../ui/chrome/modals/help/figures/scenes';
import { DemoWorld } from '../../../ui/chrome/modals/help/figures/demo-world';
import { HELP_SURFACES } from '../../../ui/chrome/modals/help/figures/surfaces';
import type { HelpPage, HelpPageId } from '../../../ui/chrome/modals/help/page-schema';
import { pageForEditState } from '../../../ui/chrome/modals/help/targets';
import { HELP_TABLES } from '../../../i18n/locales/help';
import { translations } from '../../../i18n/translations';
import { helpFacts } from '../../../ui/chrome/modals/help/facts';
import { PROVIDER_IDS, PROVIDER_META, providerBaseUrls } from '../../../agent/providers/defaults';
import { STYLIZE_PROVIDERS } from '../../../io/stylize/providers';
import { AUTOSAVE_DEBOUNCE_MS } from '../../../io/autosave';
import { MAX_TURNS_DEFAULT, SUBAGENT_MAX_TURNS } from '../../../agent/core/governor';

const ALL_IDS: readonly HelpPageId[] = [
  'welcome', 'frame', 'camera', 'tour',
  'terrain', 'trim', 'objects', 'search', 'select', 'smart',
  'generate', 'gen-island', 'maze', 'gen-letter', 'gen-picture', 'candidates', 'region',
  'notes', 'layers', 'load', 'undo',
  'save', 'share', 'json', 'checklist', 'planet',
  'agent-intro', 'agent-setup', 'agent-run', 'agent-trail', 'agent-region', 'agent-trouble', 'agent-undo',
  'settings', 'shortcuts', 'faq',
];

/** A scene's steps come from its `run` factory over a fresh world (real commands and all), so the
 *  contract reads the same timeline the player runs. Memoized: building a world runs generators. */
const sceneSteps = new Map<string, SceneStep[]>();
const NO_VIEW: DemoView = {
  ghost: () => {}, clearGhost: () => {}, groupGhost: () => {}, selection: () => {},
  clearSelection: () => {}, band: () => {}, paintGhost: () => {}, region: () => {}, route: () => {},
  marks: () => {}, gauge: () => {}, plop: () => {}, poof: () => {}, annotations: () => {},
  spin: () => {}, groupSpin: () => {}, curveHandles: () => {},
};
function stepsOf(scene: HelpScene): SceneStep[] {
  const key = sceneKeyOf(scene);
  let steps = sceneSteps.get(key);
  if (!steps) {
    const world = new DemoWorld(scene.template);
    steps = scene.run({ world, view: NO_VIEW }, (k) => k);
    sceneSteps.set(key, steps);
  }
  return steps;
}
function sceneKeyOf(scene: HelpScene): string {
  return Object.entries(HELP_SCENES).find(([, s]) => s === scene)?.[0] ?? 'unknown';
}

function figureKeys(fig: NonNullable<HelpPage['figure']>): string[] {
  if (fig.kind === 'surface') return [fig.captionKey];
  if (fig.kind === 'demos') return fig.scenes.map((s) => s.labelKey);
  return [];
}

function keysOf(page: HelpPage): string[] {
  const keys = [page.titleKey, page.ledeKey];
  if (page.navKey) keys.push(page.navKey);
  if (page.figure) keys.push(...figureKeys(page.figure));
  if (page.action) keys.push(page.action.labelKey);
  for (const s of page.sections) {
    if (s.kind === 'callout') { keys.push(s.bodyKey); continue; }
    keys.push(s.titleKey);
    if (s.kind === 'prose') {
      keys.push(...s.bodyKeys);
      if (s.figure) keys.push(...figureKeys(s.figure));
    } else {
      keys.push(...s.rows.map((r) => r.doKey));
      keys.push(...(s.afterKeys ?? []));
    }
  }
  for (const qa of page.qa) keys.push(qa.qKey, qa.aKey);
  return keys;
}

describe('the help catalog', () => {
  it('holds every page of the union exactly once, grouped under a listed group', () => {
    expect([...HELP_PAGE_ORDER].sort()).toEqual([...ALL_IDS].sort());
    for (const id of ALL_IDS) {
      expect(HELP_PAGES[id]?.id).toBe(id);
      expect(HELP_GROUPS).toContain(HELP_PAGES[id]!.group);
    }
  });

  it('cross-references only pages that exist, never itself', () => {
    for (const id of HELP_PAGE_ORDER) {
      for (const ref of HELP_PAGES[id]!.seeAlso) {
        expect(HELP_PAGES[ref], `${id} → ${ref}`).toBeTruthy();
        expect(ref).not.toBe(id);
      }
    }
  });

  it('keeps section anchors unique within a page', () => {
    for (const id of HELP_PAGE_ORDER) {
      const anchors = HELP_PAGES[id]!.sections.flatMap((s) => (s.kind === 'callout' ? [] : [s.anchor]));
      expect(new Set(anchors).size, id).toBe(anchors.length);
    }
  });

  it('names only scenes and mocks that exist', () => {
    for (const id of HELP_PAGE_ORDER) {
      const fig = HELP_PAGES[id]!.figure;
      if (!fig) continue;
      if (fig.kind === 'demo') expect(HELP_SCENES[fig.scene], `${id} → ${fig.scene}`).toBeTruthy();
      else if (fig.kind === 'demos') for (const s of fig.scenes) expect(HELP_SCENES[s.scene], `${id} → ${s.scene}`).toBeTruthy();
      else expect(HELP_SURFACES[fig.surface], `${id} → ${fig.surface}`).toBeTruthy();
    }
  });

  it('references only strings the en and zh tables carry', () => {
    // A key a page reads that no table carries renders as the raw key. That is what this pins.
    // A page may also quote a MAIN-table string (the tour page's replay action reuses the
    // Settings row's own label), so either table answers.
    const missing: string[] = [];
    for (const id of HELP_PAGE_ORDER) {
      for (const key of keysOf(HELP_PAGES[id]!)) {
        if (!HELP_TABLES.en[key] && !translations.en[key]) missing.push(`en ${key}`);
        if (!HELP_TABLES.zh[key] && !translations.zh[key]) missing.push(`zh ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('quotes scene captions and toasts that the tables carry', () => {
    const missing: string[] = [];
    for (const [name, scene] of Object.entries(HELP_SCENES)) {
      for (const step of stepsOf(scene)) {
        for (const key of [step.capKey, step.toastKey]) {
          // A demo quotes either its own caption or a real app string (an `error.*` toast).
          if (key && !HELP_TABLES.en[key] && !translations.en[key]) missing.push(`${name} → ${key}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});


describe('the help tables (the overlay the main i18n suites do not see)', () => {
  const LOCALES = Object.keys(HELP_TABLES) as (keyof typeof HELP_TABLES)[];
  const enKeys = Object.keys(HELP_TABLES.en);
  const placeholders = (v: string) => (v.match(/\{[a-zA-Z0-9_]+\}/g) ?? []).sort();

  it('holds every locale to the en key set', () => {
    for (const locale of LOCALES) {
      expect(Object.keys(HELP_TABLES[locale]).sort(), locale as string).toEqual([...enKeys].sort());
    }
  });

  it('holds every value to the en placeholder set', () => {
    for (const locale of LOCALES) {
      for (const key of enKeys) {
        expect({ locale, key, tokens: placeholders(HELP_TABLES[locale][key]!) })
          .toEqual({ locale, key, tokens: placeholders(HELP_TABLES.en[key]!) });
      }
    }
  });

  it('carries the register: no em dashes, no middots, paired bold markers', () => {
    const offenders: string[] = [];
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(HELP_TABLES[locale])) {
        if (/[\u2014\u00b7\u2022]/.test(value)) offenders.push(`${locale as string} ${key} punctuation`);
        if ((value.split('**').length - 1) % 2 !== 0) offenders.push(`${locale as string} ${key} unpaired **`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('leaves no orphan: every en key is read by a descriptor, a scene or a mock', () => {
    const used = new Set<string>();
    for (const id of HELP_PAGE_ORDER) for (const key of keysOf(HELP_PAGES[id]!)) used.add(key);
    for (const scene of Object.values(HELP_SCENES)) {
      for (const step of stepsOf(scene)) {
        if (step.capKey) used.add(step.capKey);
        if (step.toastKey) used.add(step.toastKey);
      }
    }
    // The chrome strings the modal itself reads, the group headings, and the labels the mocks and
    // scenes resolve at draw time (textKey) are referenced from components rather than descriptors.
    const componentRead = (key: string) => key.startsWith('help.group.')
      || ['help.fig.plan_job', 'help.fig.plan_s1', 'help.fig.plan_s2', 'help.fig.plan_s3', 'help.fig.undo_job', 'help.fig.undo_job2', 'help.fig.steer_job', 'help.fig.steer_note', 'help.fig.trail_job', 'help.fig.pic_title', 'help.fig.pic_desc',
        'help.camera.fig_orbit', 'help.camera.fig_tilt', 'help.camera.fig_dolly', 'help.camera.fig_hturn', 'help.camera.fig_pan'].includes(key)
      || key === 'help.qa_title' || key === 'help.see_also' || key === 'help.search_placeholder'
      || key.startsWith('help.whats_this') || key === 'help.fig.built_title';
    const orphans = enKeys.filter((key) => !used.has(key) && !componentRead(key));
    expect(orphans).toEqual([]);
  });

  it('derives autosave timing and agent limits and interpolates them in every locale', () => {
    for (const locale of LOCALES) {
      const facts = helpFacts(locale);
      expect(facts.autosaveSeconds).toBe(AUTOSAVE_DEBOUNCE_MS / 1000);
      expect(facts.agentMaxTurns).toBe(MAX_TURNS_DEFAULT);
      expect(facts.agentChildTurns).toBe(SUBAGENT_MAX_TURNS);
      for (const key of ['help.welcome.resume_b1', 'help.save.when_b1', 'help.save.a1']) {
        expect(HELP_TABLES[locale][key]).toContain('{autosaveSeconds}');
      }
      expect(HELP_TABLES[locale]['help.agenttrouble.caps_b1']).toContain('{agentMaxTurns}');
      expect(HELP_TABLES[locale]['help.agenttrouble.caps_b1']).toContain('{agentChildTurns}');
    }
  });

  it('derives provider rosters and counts from their runtime registries', () => {
    const facts = helpFacts('en');
    const agentIds = PROVIDER_IDS.filter((id) => id !== 'custom');
    expect(facts.agentProviderCount).toBe(agentIds.length);
    for (const id of agentIds) expect(String(facts.agentProviders)).toContain(PROVIDER_META[id].name);
    for (const id of agentIds.filter((id) => providerBaseUrls(id).length > 1)) {
      expect(String(facts.regionalAgentProviders)).toContain(PROVIDER_META[id].name);
    }
    for (const provider of STYLIZE_PROVIDERS.filter(({ id }) => id !== 'custom')) {
      expect(String(facts.illustrationProviders)).toContain(translations.en[`stylize.provider_${provider.id}`]);
    }
  });
});

describe('the pick-mode fallback', () => {
  it('answers every edit state with a real page', () => {
    const modes = [null, 'object', 'road', 'mountain', 'water', 'generate', 'annotate'];
    const tools = ['brush', 'erase', 'trim', 'shape', 'smart', 'none'];
    for (const mode of modes) {
      for (const tool of tools) {
        const page = pageForEditState({ mode, tool });
        expect(HELP_PAGES[page], `${mode}/${tool} → ${page}`).toBeTruthy();
      }
    }
  });
});
