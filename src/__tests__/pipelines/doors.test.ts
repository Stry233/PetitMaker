/**
 * Callers outside a pipeline reach it through its documented entry points: its `index.ts`, its light
 * facts modules (a `facts.ts` or `<name>-facts.ts`), which carry constants without pulling the pipeline
 * into the eager bundle, and a `loaders.ts` of lazy loaders for the same reason. Files inside a
 * pipeline import its implementation files directly and are not checked. No pipeline imports another.
 */
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { SRC, allSpecifiers, resolveSpec, sourceFiles, srcRelative, subfolders } from '../_support/source-graph';

/** A pipeline whose doors are its `index.ts`, its facts modules and its loaders. */
const indexAndFacts = (pipeline: string) => (module: string): boolean =>
  module === pipeline || (module.startsWith(`${pipeline}/`) && /^(?:(?:[a-z]+-)?facts|loaders)$/.test(module.slice(pipeline.length + 1)));

/** Each pipeline, and whether a module path inside it is one of its doors. */
const PIPELINES: Readonly<Record<string, (module: string) => boolean>> = {
  'pipelines/moderation': indexAndFacts('pipelines/moderation'),
  'pipelines/planet-scan': indexAndFacts('pipelines/planet-scan'),
  'pipelines/stylize': indexAndFacts('pipelines/stylize'),
};

/** A resolved target as its module path: no extension, and a folder's index as the folder. */
const modulePath = (target: string): string => target.replace(/\.(?:tsx?|js|json)$/, '').replace(/\/index$/, '');

const pipelineOf = (path: string): string | undefined =>
  Object.keys(PIPELINES).find((pipeline) => path === pipeline || path.startsWith(`${pipeline}/`));

function bypasses(): string[] {
  const found = new Set<string>();
  for (const file of sourceFiles(SRC)) {
    const from = srcRelative(file);
    for (const spec of allSpecifiers(file)) {
      const target = resolveSpec(file, spec);
      if (target === null) continue;
      const module = modulePath(target);
      const pipeline = pipelineOf(module);
      if (pipeline && pipelineOf(from) !== pipeline && !PIPELINES[pipeline]!(module)) found.add(`${from} -> ${module}`);
    }
  }
  return [...found].sort();
}

/** Every pipeline: each folder of `src/pipelines`. */
const ALL_PIPELINES: readonly string[] = subfolders(join(SRC, 'pipelines'))
  .map((name) => `pipelines/${name}`);

/** Each import, type-only ones included, from one pipeline into another, as `importer -> target`. */
function crossings(): string[] {
  const of = (path: string): string | undefined => ALL_PIPELINES.find((pipeline) => path === pipeline || path.startsWith(`${pipeline}/`));
  const found = new Set<string>();
  for (const file of sourceFiles(join(SRC, 'pipelines'))) {
    const from = srcRelative(file);
    for (const spec of allSpecifiers(file)) {
      const target = resolveSpec(file, spec);
      const pipeline = target === null ? undefined : of(modulePath(target));
      if (pipeline && pipeline !== of(from)) found.add(`${from} -> ${modulePath(target!)}`);
    }
  }
  return [...found].sort();
}

describe('pipeline doors', () => {
  it('names the doors of every pipeline', () => {
    expect(Object.keys(PIPELINES).sort()).toEqual([...ALL_PIPELINES].sort());
  });

  it('no file outside a pipeline imports past its doors', () => {
    expect(bypasses(), 'import through the pipeline entry or its facts module').toEqual([]);
  });

  it('no pipeline imports another, even for a type', () => {
    expect(ALL_PIPELINES.length).toBeGreaterThan(1);
    expect(crossings(), 'what two pipelines share belongs in a layer below them').toEqual([]);
  });
});
