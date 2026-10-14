/**
 * The layer stack imports downward: a module imports from its own layer or a layer below it, in the
 * order of `scripts/layers.mts:LAYERS`. An edge is a runtime import as `_support/source-graph.ts`
 * defines it. A type-only import builds no edge, but one that points up is a contract a lower layer
 * borrows from a higher one, so each is listed with its reason.
 *
 * Every top-level folder of `src/` is a layer, except the Lite entry and the tests. The entry files
 * at the root of `src/` and the Lite entry under `src/lite/` rank above every layer: they compose
 * the app and nothing imports them. A path `LEAF_RANKS` names ranks with the lower layer it gives.
 * No runtime edge points up; the type-only edges that do are listed in
 * `repo/import-direction-allowlist.json`, keyed `importer -> target` by repository path.
 */
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { SRC, allSpecifiers, importEdges, resolveSpec, runtimeSpecifiers, sourceFiles, srcRelative, subfolders } from '../_support/source-graph';
import allowlist from './import-direction-allowlist.json';
import { APART_LAYERS, LAYER_RANK as RANK, rankedLayer, type Layer } from '../../../scripts/layers.mts';

/** Upward type-only edges, as `importer -> target` by repository path with the target without its
 *  extension, each with the reason the contract sits where it does. */
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
 * `ToolContext` is the seam. `state` sits below `tools`, so a tool importing the store points down
 * and the layer test above has nothing to say about it; a store read mid-stroke would be a hidden
 * argument, free to differ between the probe that draws the cursor and the click that acts. No file
 * under `tools/` knows the store, the toast channel or held keys: the editor hands the tool manager
 * an arming source and host channels (`editor/session/tool-wiring.ts`). `state/catalog`,
 * `state/object-index` and `state/object-geometry` are pure functions over map data, not the store.
 */
const STORE = 'state/store';
/** The tools, generation among them, which takes its editor facts the same way. */
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
});
