/**
 * The layer stack imports DOWNWARD. A module may import from its own layer or a layer below it.
 *
 * The order below is the one `docs/ARCHITECTURE.md` documents. This test reads every source file's
 * import specifiers and fails on an edge that points up, which is what keeps the diagram describing
 * the code rather than an intention.
 *
 * `ALLOWED_UPWARD` is empty: every import in `src/` points down. Adding a line there needs the same
 * argument that moving the module would.
 */
import { describe, it, expect } from 'vitest';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readFileSync, readdirSync, statSync } from 'node:fs';
// @ts-ignore - node:path is untyped here (no @types/node)
import { join, relative, resolve, dirname } from 'node:path';

declare const __dirname: string;

/** Bottom to top. A layer may import from itself and anything earlier.
 *
 *  `config` and `assets` are data typed by `core`, so they sit just above it. `i18n` reads the
 *  store, so it follows `state`. `kit` is the editor's verbs: operations the UI, the agent and the
 *  API all call, so it sits above `tools`+`canvas` (a verb needs generation and a view together)
 *  and below its three callers. `agent`, `io` and `api` are feature surfaces: they compose the
 *  engine below them and the UI drives them. `legal` renders with the design tokens and the UI
 *  renders its documents, so the two share a rank. */
const LAYERS = [
  ['core'],
  ['config', 'assets'],
  ['state'],
  ['rules'],
  ['i18n'],
  ['tools'],
  ['canvas'],
  ['kit'],
  ['agent', 'io', 'api'],
  ['ui', 'legal'],
] as const;
type Layer = (typeof LAYERS)[number][number];

const RANK = new Map<Layer, number>(
  LAYERS.flatMap((group, i) => group.map((l): [Layer, number] => [l, i])),
);

/** Edges that point up and are accepted, as `importer layer -> imported path prefix`. Empty, and an
 *  entry here names a module that belongs lower than where it sits. */
const ALLOWED_UPWARD: ReadonlyArray<readonly [Layer, string]> = [];

const SRC = resolve(__dirname, '..');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== '__tests__') sourceFiles(full, out);
    } else if (/\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/** The layer a src-relative path belongs to, or null for a root-level file (App.tsx, main.tsx). */
function layerOf(srcRelative: string): Layer | null {
  const top = srcRelative.split('/')[0] as Layer;
  return RANK.has(top) ? top : null;
}

// Type-only statements are erased at compile time: they express a contract, not runtime coupling
// (`tools` naming the view-projection interfaces is the seam working as designed), so they are not
// edges for this purpose.
//
// A specifier reaches a module three ways and all three are runtime coupling: `from '…'`, a bare
// side-effect `import '…'`, and a dynamic `import('…')`. The dynamic form is how the lazy chunks are
// loaded, so leaving it out would let any module reach any layer by awaiting it.
const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g;
const TYPE_ONLY_RE = /^\s*(?:import|export)\s+type\s/;

/** The `@/*` -> `src/*` alias, declared in both tsconfig.json and vite.config.ts. It addresses the
 *  same files a relative specifier does, so it has to resolve through the same layer rules. */
const SRC_ALIAS = '@/';

/** A specifier's src-relative path, or null when it names something outside `src/` (a package). */
function resolveSpec(fromFile: string, spec: string): string | null {
  const abs = spec.startsWith('.') ? resolve(dirname(fromFile), spec)
    : spec.startsWith(SRC_ALIAS) ? resolve(SRC, spec.slice(SRC_ALIAS.length))
    : null;
  return abs === null ? null : relative(SRC, abs).replace(/\\/g, '/');
}

interface Edge { file: string; layer: Layer; target: string; targetLayer: Layer }

function upwardEdges(): Edge[] {
  const edges: Edge[] = [];
  for (const file of sourceFiles(SRC)) {
    const srcRel = relative(SRC, file).replace(/\\/g, '/');
    const layer = layerOf(srcRel);
    if (!layer) continue;
    // Dropping the type-only lines rather than scanning line by line, so a specifier split across
    // lines (a wrapped dynamic import) is still one match.
    const text = readFileSync(file, 'utf8')
      .split('\n')
      .filter((line: string) => !TYPE_ONLY_RE.test(line))
      .join('\n');
    for (const m of text.matchAll(IMPORT_RE)) {
      const resolved = resolveSpec(file, m[1]!);
      if (resolved === null) continue;
      const targetLayer = layerOf(resolved);
      if (!targetLayer) continue;
      if (RANK.get(targetLayer)! > RANK.get(layer)!) {
        edges.push({ file: srcRel, layer, target: resolved, targetLayer });
      }
    }
  }
  return edges;
}

const isAllowed = (e: Edge): boolean =>
  ALLOWED_UPWARD.some(([layer, prefix]) => e.layer === layer && e.target.startsWith(prefix));

describe('layer imports point downward', () => {
  it('no source file imports from a layer above its own', () => {
    const offenders = upwardEdges().filter((e) => !isAllowed(e));
    expect(
      offenders.map((e) => `${e.file} (${e.layer}) -> ${e.target} (${e.targetLayer})`),
    ).toEqual([]);
  });

  it('every recorded exception is still a real edge', () => {
    const edges = upwardEdges();
    const unused = ALLOWED_UPWARD.filter(
      ([layer, prefix]) => !edges.some((e) => e.layer === layer && e.target.startsWith(prefix)),
    );
    expect(unused.map(([l, p]) => `${l} -> ${p}`)).toEqual([]);
  });
});

/**
 * `ToolContext` IS THE SEAM, NOT A SUGGESTION.
 *
 * `state` sits below `tools`, so a tool importing the store points DOWN and the layer test above
 * has nothing to say about it — which is how six files came to read `useEditorStore.getState()`
 * mid-stroke for facts the pointer machine could have handed them: hidden arguments, invisible in
 * the signature, and free to differ between the probe that draws the cursor and the click that acts.
 *
 * One file may know a store exists: the one that BUILDS the context. Everything else takes what it
 * is given. `state/catalog`, `state/object-index` and `state/object-geometry` are not the store —
 * they are pure functions over map data — and are deliberately not named here.
 */
const CONTEXT_WIRING: ReadonlyArray<string> = ['tools/runtime/tool-manager.ts'];
const STORE = 'state/store';

describe('tools reach the editor through ToolContext', () => {
  it('no tool imports the store', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(SRC, 'tools'))) {
      const srcRel = relative(SRC, file).replace(/\\/g, '/');
      if (CONTEXT_WIRING.includes(srcRel)) continue;
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(IMPORT_RE)) {
        if (resolveSpec(file, m[1]!) === STORE) offenders.push(`${srcRel} -> ${STORE}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the one exemption is still the file that builds the context', () => {
    // An exemption that stops being real is an exemption nobody is checking.
    for (const wiring of CONTEXT_WIRING) {
      const text = readFileSync(join(SRC, wiring), 'utf8');
      expect([...text.matchAll(IMPORT_RE)].some((m) => resolveSpec(join(SRC, wiring), m[1]!) === STORE), wiring).toBe(true);
    }
  });
});
