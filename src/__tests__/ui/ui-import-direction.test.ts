/**
 * Inside `src/ui`, imports point down the ranks: `design` (tokens, scaling, motion), `primitives`
 * (generic parts and behaviour hooks), `session` (the live session's hooks and channels every surface
 * reads), then the owning surfaces `chrome` (windows and floating surfaces) < `shell` (the frame and
 * its bars) < `agent` (the assistant panel the frame docks) < `help` (the Help Center, which pictures the frame and
 * the panel with their own parts) < `app` (the edition roots) < `lite`.
 * Type-only imports express a contract and are exempt; `UPWARD` lists each reasoned exception.
 */
import { describe, it, expect } from 'vitest';
import { join, relative } from 'node:path';
import { SRC, importEdges, posix, resolveModule, resolveSpec, runtimeSpecifiers, sourceFiles, subfolders } from '../_support/source-graph';

const UI = join(SRC, 'ui');
const RANK: Record<string, number> = { design: 0, primitives: 1, session: 2, chrome: 3, shell: 4, agent: 5, help: 6, app: 7, lite: 8 };

/** A file or folder (trailing slash) that may import above its rank, and why. */
const UPWARD: Readonly<Record<string, string>> = {
  'shell/edition-surfaces.tsx': "the edition seam, replaced per edition at build (scripts/edition-build.mts); the web edition's copy mounts the assistant panel, and both hand the frame the Help Center",
};
const upwardEntry = (file: string): string | undefined =>
  Object.keys(UPWARD).find((entry) => (entry.endsWith('/') ? file.startsWith(entry) : file === entry));
const folderOf = (uiRelative: string): string => uiRelative.split('/')[0]!;

describe('ui folders import downward', () => {
  it('names a rank for every folder under src/ui', () => {
    expect(subfolders(UI).filter((f: string) => !(f in RANK))).toEqual([]);
  });

  it('never imports a folder ranked above the importer outside the listed exceptions, each still needed', () => {
    const offenders: string[] = [];
    const used = new Set<string>();
    for (const file of sourceFiles(UI)) {
      const from = posix(relative(UI, file));
      const rank = RANK[folderOf(from)];
      if (rank === undefined) continue;
      for (const spec of runtimeSpecifiers(file)) {
        const resolved = resolveSpec(file, spec);
        if (resolved === null || !resolved.startsWith('ui/')) continue;
        const target = resolved.slice('ui/'.length);
        const targetRank = RANK[folderOf(target)];
        if (targetRank === undefined || targetRank <= rank) continue;
        const entry = upwardEntry(from);
        if (entry) used.add(entry); else offenders.push(`${from} -> ${target}`);
      }
    }
    expect(offenders).toEqual([]);
    expect(Object.keys(UPWARD).filter((entry) => !used.has(entry))).toEqual([]);
  });
});

/** Each static import cycle that may remain, as its sorted member files, and why it is harmless: no
 *  member reads another's binding while the modules evaluate. */
const CYCLES: Readonly<Record<string, string>> = {
  'shell/edition-surfaces.tsx shell/planet/use-planet-session.ts shell/windows/EditorWindows.tsx shell/windows/Windows.tsx':
    "the edition seam re-exports the web windows, which read the seam's loaders and assistant state only inside closures and render",
};

/** Every strongly connected component of the static graph (runtime edges evaluated with the module,
 *  so neither type-only nor dynamic imports) that is a cycle, as its sorted `src/ui` paths. */
function staticCycles(): string[] {
  const files = sourceFiles(UI);
  const edges = new Map<string, string[]>();
  for (const file of files) {
    const out: string[] = [];
    for (const edge of importEdges(file)) {
      if (edge.typeOnly || edge.dynamic) continue;
      const target = resolveModule(file, edge.spec);
      if (target?.startsWith(`${UI}/`)) out.push(target);
    }
    edges.set(file, out);
  }
  // Tarjan's algorithm.
  const index = new Map<string, number>(), low = new Map<string, number>(), stack: string[] = [], onStack = new Set<string>();
  const cycles: string[] = [];
  const visit = (v: string): void => {
    index.set(v, index.size); low.set(v, index.get(v)!); stack.push(v); onStack.add(v);
    for (const w of edges.get(v) ?? []) {
      if (!index.has(w)) { visit(w); low.set(v, Math.min(low.get(v)!, low.get(w)!)); }
      else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!));
    }
    if (low.get(v) !== index.get(v)) return;
    const members: string[] = [];
    let w: string;
    do { w = stack.pop()!; onStack.delete(w); members.push(posix(relative(UI, w))); } while (w !== v);
    if (members.length > 1 || (edges.get(v) ?? []).includes(v)) cycles.push(members.sort().join(' '));
  };
  for (const file of files) if (!index.has(file)) visit(file);
  return cycles.sort();
}

describe('ui modules evaluate without import cycles', () => {
  // In a static cycle, whichever member a chunk or test entry reaches first evaluates while the
  // others' bindings are still undefined.
  it('forms no static import cycle outside the listed ones, each still present', () => {
    const found = staticCycles();
    expect(found.filter((cycle) => !(cycle in CYCLES))).toEqual([]);
    expect(Object.keys(CYCLES).filter((cycle) => !found.includes(cycle))).toEqual([]);
  });
});
