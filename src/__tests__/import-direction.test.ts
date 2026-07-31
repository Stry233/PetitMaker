/**
 * The layer stack imports DOWNWARD. A module may import from its own layer or a layer below it.
 *
 * The order below is the one `docs/ARCHITECTURE.md` documents. This test reads every source file's
 * import specifiers and fails on an edge that points up, which is what keeps the diagram describing
 * the code rather than an intention.
 *
 * `ALLOWED_UPWARD` names the edges that are accepted today. An entry is a promise to move the
 * imported module down, not a licence to add more: adding a line here needs the same argument that
 * moving the module would.
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
 *  store, so it follows `state`. `agent`, `io` and `api` are feature surfaces: they compose the
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
  ['agent', 'io', 'api'],
  ['ui', 'legal'],
] as const;
type Layer = (typeof LAYERS)[number][number];

const RANK = new Map<Layer, number>(
  LAYERS.flatMap((group, i) => group.map((l): [Layer, number] => [l, i])),
);

/** Edges that point up and are accepted for now, as `importer layer -> imported path prefix`.
 *  Each names a module that belongs lower than where it sits; recording one is a note to move it,
 *  and a new entry needs the same argument that moving the module would. */
const ALLOWED_UPWARD: ReadonlyArray<readonly [Layer, string]> = [
  // The 2D/3D views reach into presentation for design tokens, the menu's scale context, icon
  // components, the keymap, and the group-command helpers the pointer machine runs.
  ['canvas', 'ui/styles'],
  ['canvas', 'ui/useMotionEnabled'],
  ['canvas', 'ui/menu/scale'],
  ['canvas', 'ui/menu/icons'],
  ['canvas', 'ui/cursors/cursor-css'],
  ['canvas', 'ui/keybindings/commands'],
  ['canvas', 'ui/keybindings/store'],
  ['canvas', 'ui/chrome/group-actions'],
  // The canvas drives two feature surfaces directly: the agent's map snapshotter, and the export
  // painter behind the 3D shot editor.
  ['canvas', 'agent/snapshot'],
  ['canvas', 'io/'],
  // The road silhouette asks the object index which cells are paved.
  ['core', 'state/object-index'],
];

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
const IMPORT_RE = /(?:from|import)\s+'([^']+)'/g;
const TYPE_ONLY_RE = /^\s*(?:import|export)\s+type\s/;

interface Edge { file: string; layer: Layer; target: string; targetLayer: Layer }

function upwardEdges(): Edge[] {
  const edges: Edge[] = [];
  for (const file of sourceFiles(SRC)) {
    const srcRel = relative(SRC, file).replace(/\\/g, '/');
    const layer = layerOf(srcRel);
    if (!layer) continue;
    const text = readFileSync(file, 'utf8');
    for (const line of text.split('\n')) {
      if (TYPE_ONLY_RE.test(line)) continue;
      const m = IMPORT_RE.exec(line);
      IMPORT_RE.lastIndex = 0;
      if (!m) continue;
      const spec = m[1]!;
      if (!spec.startsWith('.')) continue; // a package, not one of ours
      const resolved = relative(SRC, resolve(dirname(file), spec)).replace(/\\/g, '/');
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
