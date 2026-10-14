/**
 * A program three has already linked is not linked again. three deletes a program when its last
 * material is disposed and links it afresh on next use, which costs seconds on a software
 * rasterizer, so the overlay's box paint is shared and outlives any one box.
 *
 * The first render of a scene keys every shadow-depth program with zero lights, because three runs
 * the shadow pass before it sets the light state up; the next bake would then link byte-identical
 * programs again at the user's first edit. The presenter primes the light state with one offscreen
 * render without the shadow pass, pinned below; `scene-frames.test.ts` pins that the scene primes
 * between freezing the map and asking for the bake, and `render-scale.test.ts` that shader
 * diagnostics are a development-only cost.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { OverlayLayer3D } from '../../../../view/map3d/layers/overlay-layer';
import { Presenter } from '../../../../view/map3d/scene/presenter';
import type { GridState } from '../../../../core/model/types';
import { makeState } from '../../../_support/map-state';

const overlayFor = (gs: GridState) => new OverlayLayer3D({ state: () => gs, requestRender: () => {} });

/** Every material the overlay group is currently drawing with, meshes and line segments alike. */
function materials(o: OverlayLayer3D): THREE.Material[] {
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

    o.showHover({ x: 3, y: 3, w: 1, h: 1 }, 'terrain');
    const first = materials(o);
    expect(first).toHaveLength(2); // the fill and its outline
    const disposals = watchDisposals(first);

    o.clearHover();
    o.showHover({ x: 4, y: 3, w: 1, h: 1 }, 'terrain');
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

    o.showHover({ x: 2, y: 2, w: 1, h: 1 }, 'object');
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
    o.showHover({ x: 1, y: 1, w: 1, h: 1 }, 'object');
    const mats = materials(o);
    const disposals = watchDisposals(mats);
    o.dispose();
    expect(disposals()).toBe(mats.length);
  });
});

describe('the light state is primed before the shadow map is baked', () => {
  /** The method reads only the renderer and the target off the presenter, so it can be driven on a
   *  stand-in — the real constructor needs a WebGL context, which no test environment here has. */
  const drive = (opts: { enabled: boolean; target: object | null }) => {
    const log: string[] = [];
    let needsUpdate = false;
    const fake = {
      msaaTarget: opts.target,
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
    Presenter.prototype.primeLightState.call(fake as never, new THREE.Scene(), new THREE.PerspectiveCamera());
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
});
