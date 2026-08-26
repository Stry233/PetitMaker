/**
 * The 3D scene's road-trim mesh and icon-colour refinement each scan every object on the map
 * (`buildRoadTrimMeshes` walks `state.objects.values()`; `refineIconColors` walks every instanced
 * group). A road brush's own remove+add churn fires several `objects-changed` events per dab, so
 * rebuilding either whole-map artifact straight from the event handler pays for that scan once per
 * EVENT rather than once per rendered FRAME. `onObjects` therefore marks a dirty flag and
 * `flushObjectDirty` (called from `renderFrame`, mirroring the terrain chunk dirty pass beside it)
 * does the rebuild at most once per frame, however many events landed in it.
 *
 * `ThreeScene` needs a real WebGL context to construct (unlike the 2D Pixi layers, which run against
 * a jsdom canvas stub) — there is no headless harness for it anywhere in this repo, terrain's own
 * dirty-chunk coalescing included. This pins the SHAPE of the code by reading the source, which is
 * what the coalescing invariant actually is: onObjects never calls the rebuilds directly, and every
 * rendered frame flushes them if and only if something was marked dirty.
 *
 * The chrome nudge rides the same flush, and its cost is the larger of the two. `viewport-changed`
 * is the one map signal `usePointerInteraction` answers IMMEDIATELY rather than per frame — a
 * camera move must not lag the pointer by a frame — so emitting it per objects-changed turns every
 * command into a full pointer re-sample, and in 3D a re-sample is a heightfield ray-march. Measured
 * in a real browser on a generated island, one fast road stroke with auto-trim on fired 471 of them
 * for 305 commands and spent 139 ms inside `handlePointerMove` (31 ms in a single move); coalesced
 * to one per frame the same stroke fires 1 and spends 31 ms (5 ms worst move).
 */
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readFileSync } from 'node:fs';
// @ts-ignore - node:path is untyped here (no @types/node)
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

declare const __dirname: string;

const sceneSrc: string = readFileSync(resolve(__dirname, '../../canvas/map3d/scene/scene.ts'), 'utf8');

/** The body of the first `name = (...) => { ... };` arrow assigned in the source, brace-matched. */
function arrowBody(src: string, name: string): string {
  const start = src.indexOf(`const ${name} =`);
  expect(start, `${name} not found`).toBeGreaterThanOrEqual(0);
  const open = src.indexOf('{', start);
  let depth = 0, i = open;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(open, i + 1);
}

/** The body of the first `private name(...): ... { ... }` method, brace-matched. */
function methodBody(src: string, name: string): string {
  const sig = new RegExp(`private ${name}\\([^)]*\\)[^{]*\\{`);
  const m = sig.exec(src);
  expect(m, `${name} not found`).not.toBeNull();
  const open = m!.index + m![0].length - 1;
  let depth = 0, i = open;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(open, i + 1);
}

describe('scene.ts coalesces the road-trim/icon-colour rebuilds to one per frame', () => {
  it('onObjects marks dirty flags instead of rebuilding inline', () => {
    const onObjects = arrowBody(sceneSrc, 'onObjects');
    expect(onObjects).toMatch(/this\.roadTrimDirty\s*=\s*true/);
    expect(onObjects).toMatch(/this\.iconRefineDirty\s*=\s*true/);
    // The whole-map rebuilds themselves must not be reachable from this handler's body.
    expect(onObjects).not.toMatch(/this\.rebuildRoadTrim\(\)/);
    expect(onObjects).not.toMatch(/this\.refineIconColors\(\)/);
  });

  it('onObjects marks the chrome nudge dirty instead of emitting viewport-changed inline', () => {
    const onObjects = arrowBody(sceneSrc, 'onObjects');
    expect(onObjects).toMatch(/this\.chromeNudgeDirty\s*=\s*true/);
    expect(onObjects).not.toMatch(/viewport-changed/);
  });

  it('renderFrame flushes the dirty object rebuilds every frame', () => {
    const renderFrame = methodBody(sceneSrc, 'renderFrame');
    expect(renderFrame).toMatch(/this\.flushObjectDirty\(\)/);
  });

  it('flushObjectDirty runs each rebuild only when its own flag is set, and clears it', () => {
    const flush = methodBody(sceneSrc, 'flushObjectDirty');
    expect(flush).toMatch(/if\s*\(this\.roadTrimDirty\)[^]*?this\.roadTrimDirty\s*=\s*false[^]*?this\.rebuildRoadTrim\(\)/);
    expect(flush).toMatch(/if\s*\(this\.iconRefineDirty\)[^]*?this\.iconRefineDirty\s*=\s*false[^]*?this\.refineIconColors\(\)/);
    expect(flush).toMatch(/if\s*\(this\.chromeNudgeDirty\)[^]*?this\.chromeNudgeDirty\s*=\s*false[^]*?viewport-changed/);
  });
});
