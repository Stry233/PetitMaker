/**
 * A module imports from its own layer or one below it, in the order of `scripts/layers.mts:LAYERS`,
 * where an edge is a runtime import as `_support/source-graph.ts` defines it. A type-only import
 * that points up borrows a contract from a higher layer, so each is listed with its reason in
 * `repo/import-direction-allowlist.json`. Root entry files and `src/lite/` rank above every layer,
 * and a path `LEAF_RANKS` names ranks with the lower layer it gives.
 */
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import ts from 'typescript';
import { SRC, allSpecifiers, importEdges, resolveSpec, runtimeSpecifiers, sourceFiles, sourceText, srcRelative, subfolders } from '../_support/source-graph';
import allowlist from './import-direction-allowlist.json';
import { APART_LAYERS, LAYER_RANK as RANK, rankedLayer, type Layer } from '../../../scripts/layers.mts';

/** Upward type-only edges, keyed `importer -> target` by repository path (target without its
 *  extension), each with its reason. */
const TYPE_ONLY_UPWARD: Readonly<Record<string, string>> = allowlist.typeOnly;

/** The layer a src-relative path belongs to: its top-level folder (a bare folder name is the
 *  folder's index), or `entry` for a root file and for `lite/`. Null for a path in no layer. */
function layerOf(srcRel: string): Layer | null {
  const parts = srcRel.split('/');
  const top = parts[0] as Layer;
  if (RANK.has(top) && top !== 'entry') return rankedLayer(srcRel, top);
  return parts.length === 1 || parts[0] === 'lite' ? 'entry' : null;
}

interface Edge { file: string; layer: Layer; target: string; targetLayer: Layer }

const edgeKey = (e: Edge): string => `src/${e.file} -> src/${e.target}`;

function upwardEdges(typeOnly = false): Edge[] {
  const edges: Edge[] = [];
  for (const file of sourceFiles(SRC)) {
    const srcRel = srcRelative(file);
    const layer = layerOf(srcRel);
    if (!layer) continue;
    const specs = typeOnly ? importEdges(file).filter((e) => e.typeOnly).map((e) => e.spec) : runtimeSpecifiers(file);
    for (const spec of specs) {
      const resolved = resolveSpec(file, spec);
      if (resolved === null) continue;
      const targetLayer = layerOf(resolved);
      if (!targetLayer) continue;
      if (RANK.get(targetLayer)! > RANK.get(layer)!) {
        edges.push({ file: srcRel, layer, target: resolved.replace(/\.(?:tsx?|js)$/, ''), targetLayer });
      }
    }
  }
  return edges;
}

describe('layers kept apart', () => {
  it('joins no pair in APART_LAYERS by any import, type-only included', () => {
    const apart = (a: Layer, b: Layer): boolean => APART_LAYERS.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
    const joined: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const srcRel = srcRelative(file);
      const layer = layerOf(srcRel);
      if (!layer) continue;
      for (const spec of allSpecifiers(file)) {
        const resolved = resolveSpec(file, spec);
        const targetLayer = resolved === null ? null : layerOf(resolved);
        if (targetLayer && apart(layer, targetLayer)) joined.push(`src/${srcRel} -> src/${resolved} (${layer} -> ${targetLayer})`);
      }
    }
    expect(joined).toEqual([]);
  });
});

describe('layer imports point downward', () => {
  it('no source file imports from a layer above its own', () => {
    expect(upwardEdges().map((e) => `${edgeKey(e)} (${e.layer} -> ${e.targetLayer})`)).toEqual([]);
  });

  it('ranks a leaf path with the layer it is given', () => {
    // Paths no file holds, so this test names no source.
    expect(layerOf('i18n/keys.tsx')).toBe('config');
    expect(layerOf('i18n/locales/help/xx.ts')).toBe('config');
    expect(layerOf('i18n/keyring.ts')).toBe('i18n');
  });

  it('every type-only import that points up is listed with its reason', () => {
    const offenders = upwardEdges(true).filter((e) => !(edgeKey(e) in TYPE_ONLY_UPWARD));
    expect(offenders.map((e) => `${edgeKey(e)} (${e.layer} -> ${e.targetLayer})`)).toEqual([]);
  });

  it('every listed type-only edge is still real and has a reason', () => {
    const edges = new Set(upwardEdges(true).map(edgeKey));
    const stale = Object.entries(TYPE_ONLY_UPWARD).filter(([key, reason]) => !edges.has(key) || reason.trim().length < 20).map(([key]) => key);
    expect(stale).toEqual([]);
  });
});

/** The top-level folders of `src/` that are not layers: the Lite entry and the tests. */
const NON_LAYER_FOLDERS: ReadonlySet<string> = new Set(['lite', '__tests__']);

describe('top-level src folders are layers', () => {
  it('every top-level folder of src/ is ranked in LAYERS or is a named exception', () => {
    expect(subfolders(SRC).filter((name) => !NON_LAYER_FOLDERS.has(name) && !RANK.has(name as Layer))).toEqual([]);
  });
});

/**
 * `state` sits below `tools`, so the layer test allows a tool to import the store; but a store read
 * mid-stroke is a hidden argument that can differ between the cursor probe and the click. Tools get
 * the store's facts, toasts and held keys through `ToolContext` (`editor/session/tool-wiring.ts`).
 * `state/catalog`, `state/object-index` and `state/object-geometry` are pure, not the store.
 */
const STORE = 'state/store';
/** The tools, generation included. */
const TOOL_FILES: ReadonlyArray<string> = sourceFiles(join(SRC, 'tools'));

describe('tools reach the editor through ToolContext', () => {
  it('no tool imports the store', () => {
    const offenders: string[] = [];
    for (const file of TOOL_FILES) {
      const srcRel = srcRelative(file);
      for (const spec of allSpecifiers(file)) {
        if (resolveSpec(file, spec) === STORE) offenders.push(`${srcRel} -> ${STORE}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no tool posts a toast or reads a held key itself: both arrive through the host', () => {
    const channels = ['platform/channels/toast-bus', 'state/keymap/held', 'platform/input/held-keys'];
    const offenders: string[] = [];
    for (const file of TOOL_FILES) {
      const srcRel = srcRelative(file);
      for (const spec of runtimeSpecifiers(file)) {
        const target = resolveSpec(file, spec);
        if (target !== null && channels.includes(target)) offenders.push(`${srcRel} -> ${target}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no pointer tool keeps a module-level mutable binding: a page-wide slot is an argument no port carries', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(SRC, 'tools', 'pointer'))) {
      for (const name of mutableModuleBindings(sourceText(file))) offenders.push(`${srcRelative(file)}: ${name}`);
    }
    expect(offenders).toEqual([]);
  });
});

/** The names a module's top level binds with `let` or `var`. Module state a tool may keep is a `const`
 *  cache keyed by its source, which this does not read. */
function mutableModuleBindings(text: string): string[] {
  const source = ts.createSourceFile('module.ts', text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);
  return source.statements.flatMap((statement) => {
    if (!ts.isVariableStatement(statement) || (statement.declarationList.flags & ts.NodeFlags.Const) !== 0) return [];
    return statement.declarationList.declarations.map((d) => d.name.getText(source));
  });
}

describe('mutable module bindings', () => {
  it('reads let and var at the top level, not const or a binding inside a function', () => {
    const text = 'let a = 1;\nexport var b = 2;\nconst c = new Map();\nfunction f() { let d = 0; return d; }';
    expect(mutableModuleBindings(text)).toEqual(['a', 'b']);
  });
});
