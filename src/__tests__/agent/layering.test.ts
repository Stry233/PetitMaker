/**
 * The harness has four doors and an inner order. Outside `src/agent`, code reads the harness only
 * through `boot.ts` (what the frame's first load watches), `limits.ts` (its published limits, core
 * modules only), `panel.ts` (what the panel's chunk reads) or, from the panel's lazy boundary alone,
 * `panel-runtime.ts`. Inside, a folder imports only the
 * folders below it: core < providers < security < skills < tools < prompts < session < connection < exec < the facades.
 * Type-only imports count, so a contract lives in the lowest folder that names it; Markdown assets are
 * exempt and dynamic `import()` loads stay direct.
 */
import { describe, it, expect } from 'vitest';
import { join, relative } from 'node:path';
import { SRC, importEdges, resolveModule, sourceFiles as sources } from '../_support/source-graph';
import ALLOWLIST from './layering-allowlist.json';

const HARNESS = join(SRC, 'agent');

const ORDER = ['core', 'providers', 'security', 'skills', 'tools', 'prompts', 'session', 'connection', 'exec', 'boot', 'limits', 'panel', 'panel-runtime'] as const;
const FACADES = new Set(['boot', 'limits', 'panel', 'panel-runtime']);

/** The lazy boundary, the one place that runs the harness rather than reading it. */
const BOUNDARY = new Set(['ui/agent/PanelColumn.tsx', 'ui/agent/hooks/use-panel-runner.ts']);

/** Edges that break the rules today, each with its reason (`layering-allowlist.json`). */
const ALLOWED: ReadonlySet<string> = new Set(Object.keys(ALLOWLIST));

/** The source files a file imports statically, types included; a Markdown `?raw` asset resolves
 *  to no source file. */
const staticImports = (file: string): string[] => importEdges(file)
  .filter((e) => !e.dynamic && !e.spec.includes('?raw'))
  .flatMap((e) => resolveModule(file, e.spec) ?? []);

/** The top-level harness folder or facade a harness file belongs to. */
const unitOf = (file: string): string => relative(HARNESS, file).split('/')[0]!.replace(/\.tsx?$/, '');
const rank = (unit: string): number => ORDER.indexOf(unit as (typeof ORDER)[number]);

describe('the harness layering', () => {
  it('is entered from outside only through its facades', () => {
    const offenders: string[] = [];
    for (const file of sources(SRC)) {
      if (file.startsWith(HARNESS + '/')) continue;
      const from = relative(SRC, file);
      for (const target of staticImports(file)) {
        if (!target.startsWith(HARNESS + '/')) continue;
        const unit = unitOf(target);
        const ok = FACADES.has(unit) && relative(HARNESS, target).split('/').length === 1
          && (unit !== 'panel-runtime' || BOUNDARY.has(from));
        const edge = `${from} -> ${relative(SRC, target)}`;
        if (!ok && !ALLOWED.has(edge)) offenders.push(edge);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('imports only downward between its folders', () => {
    const offenders: string[] = [];
    for (const file of sources(HARNESS)) {
      const from = unitOf(file);
      if (rank(from) < 0) { offenders.push(`${relative(SRC, file)}: not in the harness order`); continue; }
      for (const target of staticImports(file)) {
        if (!target.startsWith(HARNESS + '/')) continue;
        const to = unitOf(target);
        if (to === from || rank(to) < rank(from)) continue;
        const edge = `${relative(SRC, file)} -> ${relative(SRC, target)}`;
        if (!ALLOWED.has(edge)) offenders.push(edge);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('names only edges that still exist', () => {
    const live = new Set<string>();
    for (const file of sources(SRC)) for (const target of staticImports(file)) live.add(`${relative(SRC, file)} -> ${relative(SRC, target)}`);
    expect([...ALLOWED].filter((edge) => !live.has(edge))).toEqual([]);
  });
});
