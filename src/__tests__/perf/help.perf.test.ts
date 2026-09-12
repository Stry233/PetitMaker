/*
 * help.perf.test.ts — the Help Center's CPU-side costs, no renderer.
 *
 * Every Help figure is a real `DemoWorld` (a live `GridState` + `CommandExecutor` + full rule
 * registry) driven by a scene's `run(ctx, t)` timeline (`figures/scenes.ts`); a mounted page pays
 * one such world per figure, settled through the same `on`/`during(ctx,1)` calls the reduced-motion
 * player's `finishAll` makes. This suite times exactly that path with a no-op `DemoView` (matching
 * `__tests__/ui/help/catalog.test.ts`'s own stub) standing in for the overlay layer, plus the
 * search index, the page catalog's own string resolution, and the memoized facts record. See
 * `_harness.ts` for the gate and methodology.
 */
import { describe, it } from 'vitest';
import { PERF, perfSuite } from './_harness';
import { DemoWorld } from '../../ui/chrome/modals/help/figures/demo-world';
import { HELP_SCENES, type DemoCtx, type DemoView, type HelpScene } from '../../ui/chrome/modals/help/figures/scenes';
import { HELP_PAGES, HELP_PAGE_ORDER } from '../../ui/chrome/modals/help/catalog';
import { searchHelp, __resetHelpSearch } from '../../ui/chrome/modals/help/search';
import { helpFacts } from '../../ui/chrome/modals/help/facts';
import { ensureHelpStrings } from '../../i18n/locales/help';
import { translateFor } from '../../i18n/context';
import type { Locale } from '../../core/model/types';

ensureHelpStrings();

const s = perfSuite('help');

/** Every mark a no-op: the same stub `__tests__/ui/help/catalog.test.ts` runs every scene against
 *  to hold the catalog contract, standing in for the real overlay layer. */
const NO_VIEW: DemoView = {
  ghost: () => {}, clearGhost: () => {}, groupGhost: () => {}, selection: () => {},
  clearSelection: () => {}, band: () => {}, paintGhost: () => {}, region: () => {}, route: () => {},
  marks: () => {}, gauge: () => {}, plop: () => {}, poof: () => {}, annotations: () => {},
  spin: () => {}, groupSpin: () => {}, curveHandles: () => {},
};

const SCENES = Object.entries(HELP_SCENES);

/** One scene's timeline settled the way the reduced-motion player's `finishAll` does: every step's
 *  `on` fired in order, every `during` sampled at its end (`k = 1`). Returns the step count. */
function runScene(world: DemoWorld, run: HelpScene['run']): number {
  const ctx: DemoCtx = { world, view: NO_VIEW };
  const steps = run(ctx, (key) => key);
  for (const step of steps) {
    step.on?.(ctx);
    step.during?.(ctx, 1);
  }
  return steps.length;
}

describe.runIf(PERF)('perf: help', () => {
  it('DemoWorld: construct one figure world (default template)', async () => {
    const template = new DemoWorld().state.template;
    await s.bench('world/construct', () => { new DemoWorld(); }, {
      meta: { template: template.id, width: template.width, height: template.height },
    });
  });

  it('DemoWorld: one world per distinct scene template in the catalog', async () => {
    const templates = new Set(SCENES.map(([, scene]) => scene.template));
    await s.bench('world/construct-all-scenes', () => {
      for (const tpl of templates) new DemoWorld(tpl);
    }, { meta: { worlds: templates.size } });
  });

  it('scenes: every catalog timeline, run headless against a fresh world each', async () => {
    let worlds: DemoWorld[] = [];
    const rebuild = () => { worlds = SCENES.map(([, scene]) => new DemoWorld(scene.template)); };
    rebuild();
    let totalSteps = 0;
    for (let i = 0; i < SCENES.length; i++) totalSteps += runScene(worlds[i]!, SCENES[i]![1].run);
    await s.bench('scenes/run-steps-all', () => {
      for (let i = 0; i < SCENES.length; i++) runScene(worlds[i]!, SCENES[i]![1].run);
    }, {
      setup: rebuild,
      minSamples: 3, maxSamples: 6, budgetMs: 8000,
      meta: { scenes: SCENES.length, steps: totalSteps },
    });
  });

  it('scenes: the single heaviest timeline, alone', async () => {
    // One untimed pass over every scene ranks them; the harness then benches the heaviest alone.
    let heaviestId = SCENES[0]![0];
    let heaviestMs = -1;
    for (const [id, scene] of SCENES) {
      const world = new DemoWorld(scene.template);
      const t0 = performance.now();
      runScene(world, scene.run);
      const dt = performance.now() - t0;
      if (dt > heaviestMs) { heaviestMs = dt; heaviestId = id; }
    }
    const scene = HELP_SCENES[heaviestId]!;
    let world = new DemoWorld(scene.template);
    await s.bench('scenes/single-heaviest', () => { runScene(world, scene.run); }, {
      setup: () => { world = new DemoWorld(scene.template); },
      meta: { scene: heaviestId },
    });
  });

  it('search: cold index build', async () => {
    await s.bench('search/build', () => { searchHelp('en', 'terrain'); }, {
      setup: () => { __resetHelpSearch(); },
      meta: { pages: HELP_PAGE_ORDER.length },
    });
  });

  it('search: 20 representative queries against the warm index', async () => {
    const queries = [
      'camera', 'terrain', 'trim', 'objects', 'generate', 'maze', 'undo', 'save', 'share', 'faq',
      'road', 'water', 'rotate', 'zoom', 'checklist', 'plaza',
      'why does placing', 'how do i undo', 'auto-save', '视角',
    ];
    await s.bench('search/query-20', () => {
      for (const q of queries) searchHelp('en', q);
    }, { meta: { queries: queries.length } });
  });

  it('catalog: resolve every page\'s own title, section and Q&A strings', async () => {
    // Mirrors `search.ts:buildIndex`'s own walk (title, lede, section title/body, qa) but for one
    // locale rather than the search blob's bilingual merge — the cost a full documentation crawl
    // pays, as distinct from the search index's own bench above.
    function resolveAllPages(locale: Locale): number {
      const facts = helpFacts(locale);
      let n = 0;
      for (const id of HELP_PAGE_ORDER) {
        const page = HELP_PAGES[id];
        translateFor(locale, page.titleKey, facts); n++;
        translateFor(locale, page.ledeKey, facts); n++;
        for (const sec of page.sections) {
          if (sec.kind === 'callout') { translateFor(locale, sec.bodyKey, facts); n++; continue; }
          translateFor(locale, sec.titleKey, facts); n++;
          if (sec.kind === 'prose') {
            for (const k of sec.bodyKeys) { translateFor(locale, k, facts); n++; }
          } else if (sec.kind === 'steps') {
            for (const k of sec.bodyKeys ?? []) { translateFor(locale, k, facts); n++; }
            for (const g of sec.groups) for (const k of g.stepKeys) { translateFor(locale, k, facts); n++; }
          } else {
            for (const r of sec.rows) { translateFor(locale, r.doKey, facts); n++; }
            for (const k of sec.afterKeys ?? []) { translateFor(locale, k, facts); n++; }
          }
        }
        for (const qa of page.qa) {
          translateFor(locale, qa.qKey, facts); n++;
          translateFor(locale, qa.aKey, facts); n++;
        }
      }
      return n;
    }
    const strings = resolveAllPages('en');
    await s.bench('catalog/pages-assemble', () => { resolveAllPages('en'); }, {
      meta: { pages: HELP_PAGE_ORDER.length, strings },
    });
  });

  it('facts: the memoized record every reader receives', async () => {
    // `helpFacts` caches per locale (facts.ts's module-level map): every call after the first for a
    // given locale is the map lookup this bench measures, which is what every subsequent reader pays.
    await s.bench('facts/help-facts-en', () => { helpFacts('en'); });
    await s.bench('facts/help-facts-zh', () => { helpFacts('zh'); });
  });
});
