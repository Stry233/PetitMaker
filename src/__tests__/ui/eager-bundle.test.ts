/**
 * What the app downloads before anyone asks for anything.
 *
 * `agent/providers/anthropic.ts` + `openai.ts` each carry one LLM SDK (the metadata in
 * `defaults.ts` stays SDK-free and reachable), and most visitors never open the assistant.
 * Keeping that weight off the first load is not a property of any one component: it holds only
 * while no module in the app's static import graph names it, and a single ordinary-looking
 * `import` anywhere in that graph puts it back. The same is true of the 3D scene, which carries
 * three.js, and of the panel's own column, which is what reaches the tool layer and the adapters.
 *
 * So this walks the graph the way a bundler does — from `main.tsx`, following static specifiers only
 * — and names what it must not reach. A `import('…')` is what a lazy chunk is, so it is where the
 * walk stops; a `import type` is erased before the bundler sees it.
 */
import { describe, it, expect } from 'vitest';
import { dirname, relative, resolve } from 'node:path';
import { LOCALES } from '../../core/model/locale';
import { SRC, posix, resolveModule, sourceFiles, sourceText, srcRelative, staticSpecifiers } from '../_support/source-graph';

/** Modules no first load may reach, with what makes each one heavy. */
const MUST_STAY_LAZY: ReadonlyArray<readonly [string, string]> = [
  ['agent/providers/anthropic.ts', 'the Anthropic SDK'],
  ['agent/providers/openai.ts', 'the OpenAI SDK'],
  ['ui/agent/PanelColumn.tsx', 'the tool layer and the provider adapters, behind the panel'],
  ['view/map3d/scene/map-renderer.ts', 'three.js'],
  ['config/catalog/models.ts', 'the 3D model table, most of the catalog by bytes, which travels with the scene'],
  ...LOCALES.filter((locale) => locale !== 'en').map((locale) =>
    [`i18n/locales/${locale}.ts`, 'a locale\'s interface table, fetched when the editor first shows that locale'] as const),
];

/** Every source file `entry` reaches without awaiting anything, as src-relative paths. Static
 *  specifiers only: a dynamic import is the lazy boundary this test exists to protect. */
function eagerGraph(entry = 'main.tsx'): Map<string, string[]> {
  const seen = new Map<string, string[]>(); // file -> the chain that reached it
  const walk = (file: string, chain: string[]): void => {
    const key = srcRelative(file);
    if (seen.has(key)) return;
    const here = [...chain, key];
    seen.set(key, here);
    for (const spec of staticSpecifiers(file)) {
      const next = resolveModule(file, spec);
      if (next) walk(next, here);
    }
  };
  walk(resolve(SRC, entry), []);
  return seen;
}

describe('the first load', () => {
  it('does not reach the modules that are meant to arrive later', () => {
    const graph = eagerGraph();
    const found = MUST_STAY_LAZY
      .filter(([path]) => graph.has(path))
      // The chain is the useful half of a failure: it names the import that has to become dynamic.
      .map(([path, why]) => `${path} (${why}) via ${graph.get(path)!.join(' -> ')}`);
    expect(found).toEqual([]);
  });

  it('reaches a pipeline only through its light doors, never its implementation', () => {
    const graph = eagerGraph();
    const doors = [
      ...sourceFiles(resolve(SRC, 'pipelines')).map(srcRelative).filter((path) => /^pipelines\/[a-z-]+\/(?:(?:[a-z]+-)?facts|loaders)\.ts$/.test(path)),
      // The content checks' entry starts each check's worker on first use, so it loads no matcher or model.
      'pipelines/moderation/index.ts',
    ];
    const light = new Set(doors.flatMap((door) => [...eagerGraph(door).keys()]));
    const found = [...graph.keys()]
      .filter((path) => path.startsWith('pipelines/') && !light.has(path))
      .map((path) => `${path} via ${graph.get(path)!.join(' -> ')}`);
    expect(graph.has('pipelines/stylize/facts.ts')).toBe(true);
    expect(found).toEqual([]);
  });

  it('walks a graph that is really there, so a rename cannot quietly pass it', () => {
    const graph = eagerGraph();
    expect(graph.has('ui/shell/Shell.tsx')).toBe(true);
    // The character is eager: it stands on the entrance plate before anyone opens anything, so the
    // walk reaching it is what proves the walk is really following the shell's own imports.
    expect(graph.has('ui/agent/character/CharacterHost.tsx')).toBe(true);
    expect(graph.has('ui/agent/character/Character.tsx')).toBe(true);
    // And the panel it opens is not: one lazy import stands between the two.
    expect(graph.has('ui/agent/PanelShell.tsx')).toBe(false);
  });
});

/** Every module worker entry the app spawns, read from its `new Worker(new URL(...))` sites. */
function workerEntries(): string[] {
  const out = new Set<string>();
  for (const path of sourceFiles()) {
    for (const m of sourceText(path).matchAll(/new Worker\(\s*new URL\(\s*['"]([^'"]+)['"]/g)) {
      out.add(posix(relative(SRC, resolve(dirname(path), m[1]!))));
    }
  }
  return [...out].sort();
}

describe('the workers', () => {
  it('never parse the 3D model table: each worker pays for every module it reaches', () => {
    const entries = workerEntries();
    expect(entries).toContain('tools/generation/run/candidate.worker.ts');
    const found = entries.flatMap((entry) => {
      const graph = eagerGraph(entry);
      return graph.has('config/catalog/models.ts') ? [`${entry} via ${graph.get('config/catalog/models.ts')!.join(' -> ')}`] : [];
    });
    expect(found).toEqual([]);
  });
});

describe('the assistant panel chunk', () => {
  it('loads neither SDK: a request fetches the one its provider speaks', () => {
    const graph = eagerGraph('ui/agent/PanelColumn.tsx');
    expect(graph.has('agent/exec/runner.ts')).toBe(true);
    const found = ['agent/providers/anthropic.ts', 'agent/providers/openai.ts']
      .filter((path) => graph.has(path))
      .map((path) => `${path} via ${graph.get(path)!.join(' -> ')}`);
    expect(found).toEqual([]);
  });
});
