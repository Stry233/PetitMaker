/**
 * What the app downloads before anyone asks for anything.
 *
 * `agent/providers` carries the two LLM SDKs, and most visitors never open the assistant. Keeping
 * that weight off the first load is not a property of any one component: it holds only while NO
 * module in the app's static import graph names it, and a single ordinary-looking `import` anywhere
 * in that graph puts it back. The same is true of the 3D scene, which carries three.js.
 *
 * So this walks the graph the way a bundler does — from `main.tsx`, following STATIC specifiers only
 * — and names what it must not reach. A `import('…')` is what a lazy chunk is, so it is where the
 * walk stops; a `import type` is erased before the bundler sees it.
 */
import { describe, it, expect } from 'vitest';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { existsSync, readFileSync } from 'node:fs';
// @ts-ignore - node:path is untyped here (no @types/node)
import { dirname, relative, resolve } from 'node:path';

declare const __dirname: string;

const SRC = resolve(__dirname, '../..');

/** Modules no first load may reach, with what makes each one heavy. */
const MUST_STAY_LAZY: ReadonlyArray<readonly [string, string]> = [
  ['agent/providers/index.ts', 'the Anthropic and OpenAI SDKs'],
  ['canvas/map3d/scene/scene.ts', 'three.js'],
];

/** Static specifiers only: a dynamic import is the lazy boundary this test exists to protect. */
const STATIC_IMPORT_RE = /(?:\bfrom\s*|^\s*import\s+)['"]([^'"]+)['"]/gm;
const TYPE_ONLY_RE = /^\s*(?:import|export)\s+type\s/;

/** A specifier's src-relative file, or null when it names a package or an asset. */
function resolveSpec(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.') && !spec.startsWith('@/')) return null;
  const abs = spec.startsWith('@/') ? resolve(SRC, spec.slice(2)) : resolve(dirname(fromFile), spec);
  for (const candidate of [abs, `${abs}.ts`, `${abs}.tsx`, `${abs}/index.ts`, `${abs}/index.tsx`]) {
    if (/\.tsx?$/.test(candidate) && existsSync(candidate)) return candidate;
  }
  return null;
}

/** Every source file the entry reaches without awaiting anything, as src-relative paths. */
function eagerGraph(): Map<string, string[]> {
  const seen = new Map<string, string[]>(); // file -> the chain that reached it
  const walk = (file: string, chain: string[]): void => {
    const key = relative(SRC, file).replace(/\\/g, '/');
    if (seen.has(key)) return;
    const here = [...chain, key];
    seen.set(key, here);
    const text = readFileSync(file, 'utf8')
      .split('\n')
      .filter((line: string) => !TYPE_ONLY_RE.test(line))
      .join('\n');
    for (const m of text.matchAll(STATIC_IMPORT_RE)) {
      const next = resolveSpec(file, m[1]!);
      if (next) walk(next, here);
    }
  };
  walk(resolve(SRC, 'main.tsx'), []);
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

  it('walks a graph that is really there, so a rename cannot quietly pass it', () => {
    const graph = eagerGraph();
    expect(graph.has('ui/shell/Shell.tsx')).toBe(true);
    // The card that offers the key field is eager on purpose: the assistant is drawn open.
    expect(graph.has('ui/shell/assistant/IntroCard.tsx')).toBe(true);
  });
});
