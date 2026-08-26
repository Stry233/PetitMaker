/**
 * A program three has already linked must not be linked again.
 *
 * three fetches a program's info logs synchronously the first time it is used, and it deletes the
 * program the moment its last referencing material is disposed. Both cost real time on a software
 * rasterizer — measured at roughly 1.9 seconds per program, over a second of it the logs — and both
 * were landing in front of the user: the overlay's hover box built and disposed its own materials
 * on every pointer move, so the outline shader was deleted and re-linked that often.
 *
 * These pin the two halves of that fix: the box paint is shared and outlives any one box, and the
 * shader diagnostics are a development-only cost.
 *
 * A third way to link one program twice needs no disposal at all. `WebGLRenderer.render` runs the
 * shadow pass BEFORE it sets the light state up, and a render state's light arrays start empty — so
 * a scene's FIRST render keys every shadow-depth program with zero lights, a count no later frame
 * repeats. The counts reach the program cache key but not the depth shader (its source never
 * mentions them), so the second bake links byte-identical programs again. With the shadow map
 * frozen after build, that second bake is the user's first edit. The last block pins the priming
 * render that keeps the first bake keyed the way every later one is.
 */
import { describe, it, expect } from 'vitest';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { Overlay3D } from '../../canvas/map3d/scene/overlay3d';
import { ThreeScene } from '../../canvas/map3d/scene/scene';
import type { GridState } from '../../core/model/types';
import { makeState } from '../rules/_helpers';

const overlayFor = (gs: GridState) => new Overlay3D(() => gs, () => {});

/** Every material the overlay group is currently drawing with, meshes and line segments alike. */
function materials(o: Overlay3D): THREE.Material[] {
  const out: THREE.Material[] = [];
  o.group.traverse((c) => {
    const m = (c as THREE.Mesh).material;
    if (m && !Array.isArray(m)) out.push(m as THREE.Material);
  });
  return out;
}

/** Count `dispose` events, which is what three listens for to release the program. */
function watchDisposals(mats: THREE.Material[]): () => number {
  let n = 0;
  for (const m of mats) m.addEventListener('dispose', () => { n++; });
  return () => n;
}

describe('overlay box paint is shared, not per box', () => {
  it('a re-hovered cell wears the same materials, and clearing disposes none of them', () => {
    const gs = makeState(12, 12);
    const o = overlayFor(gs);

    o.showHover(3, 3, 1, 1, true);
    const first = materials(o);
    expect(first).toHaveLength(2); // the fill and its outline
    const disposals = watchDisposals(first);

    o.clearHover();
    o.showHover(4, 3, 1, 1, true);
    const second = materials(o);

    expect(disposals(), 'a hover that moves must not delete the outline program').toBe(0);
    expect(second).toHaveLength(2);
    expect(second[0]).toBe(first[0]);
    expect(second[1]).toBe(first[1]);
    o.dispose();
  });

  it('caches per role, so the band and the hover do not end up the same colour', () => {
    const gs = makeState(12, 12);
    const o = overlayFor(gs);

    o.showHover(2, 2, 1, 1, false);
    const hover = materials(o);
    o.showBand({ x: 5, y: 5, w: 2, h: 2 });
    const both = materials(o);
    const band = both.filter((m) => !hover.includes(m));

    expect(band).toHaveLength(2);
    const hoverEdge = hover.find((m) => m instanceof THREE.LineBasicMaterial) as THREE.LineBasicMaterial;
    const bandEdge = band.find((m) => m instanceof THREE.LineBasicMaterial) as THREE.LineBasicMaterial;
    expect(hoverEdge.color.getHex()).not.toBe(bandEdge.color.getHex());
    o.dispose();
  });

  it('releases the cache when the overlay itself goes', () => {
    const gs = makeState(12, 12);
    const o = overlayFor(gs);
    o.showHover(1, 1, 1, 1, false);
    const mats = materials(o);
    const disposals = watchDisposals(mats);
    o.dispose();
    expect(disposals()).toBe(mats.length);
  });
});

describe('shader diagnostics', () => {
  const SOURCE = readFileSync('src/canvas/map3d/scene/scene.ts', 'utf8');

  it('are asked for in development only', () => {
    expect(SOURCE).toContain('this.renderer.debug.checkShaderErrors = import.meta.env.DEV;');
  });
});

describe('the light state is primed before the shadow map is baked', () => {
  /** The method reads only these four fields off the scene, so it can be driven on a stand-in —
   *  the real constructor needs a WebGL context, which no test environment here has. */
  const drive = (opts: { enabled: boolean; target: object | null }) => {
    const log: string[] = [];
    let needsUpdate = false;
    const fake = {
      scene: {}, camera: {}, msaaTarget: opts.target,
      renderer: {
        shadowMap: {
          enabled: opts.enabled,
          get needsUpdate() { return needsUpdate; },
          set needsUpdate(v: boolean) { needsUpdate = v; log.push(`needsUpdate=${v}`); },
        },
        setRenderTarget: (t: object | null) => log.push(t === opts.target ? 'bind:offscreen' : `bind:${t === null ? 'canvas' : 'other'}`),
        render: () => log.push('render'),
      },
    };
    const prime = (ThreeScene.prototype as unknown as Record<string, ((this: unknown) => void) | undefined>).primeLightState;
    expect(prime, 'ThreeScene must carry the priming render').toBeTypeOf('function');
    prime!.call(fake);
    return log;
  };

  it('renders once with the shadow pass off, offscreen, and hands the canvas back', () => {
    expect(drive({ enabled: true, target: {} })).toEqual([
      'needsUpdate=false', 'bind:offscreen', 'render', 'bind:canvas',
    ]);
  });

  it('does nothing on a profile without shadows', () => {
    expect(drive({ enabled: false, target: {} })).toEqual([]);
    expect(drive({ enabled: true, target: null })).toEqual([]);
  });

  it('is called between freezing the map and asking for the one bake', () => {
    const SOURCE = readFileSync('src/canvas/map3d/scene/scene.ts', 'utf8');
    const freeze = SOURCE.indexOf('this.renderer.shadowMap.autoUpdate = false;');
    const prime = SOURCE.indexOf('this.primeLightState();');
    const bake = SOURCE.indexOf('this.renderer.shadowMap.needsUpdate = true;', freeze);
    expect(freeze).toBeGreaterThan(-1);
    // Before the freeze the priming render would BE the bake; after the bake it primes nothing.
    expect(prime).toBeGreaterThan(freeze);
    expect(prime).toBeLessThan(bake);
  });
});
