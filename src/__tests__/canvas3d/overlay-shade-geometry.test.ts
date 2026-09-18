/**
 * THE OVERLAY SHADE INVENTORY (3D) — the twin of __tests__/canvas/overlay-geometry.test.ts.
 *
 * The 3D view draws the same shades as surface-draped decals, so it owes the same contract: each
 * covers its body exactly, on the grid that body renders at (terrain −0.5 in world units, objects
 * unshifted). The hard cases are where a fractional anchor meets those two grids — the plaza's
 * 20×27 body at x.5/y.5, a halfStep bridge/ramp anchor — because a body that is not a whole number
 * of cells from the origin cannot be described by the cells it touches.
 *
 * Everything here is measured in MACRO units off the mesh's own vertices, so a shade that drifts
 * half a cell fails whatever the camera is doing.
 */
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { Overlay3D } from '../../canvas/map3d/scene/overlay3d';
import { mapCenterOffset } from '../../canvas/map3d/core/coords';
import type { GridState, Rect, ValidationError } from '../../core/model/types';
import { bodyEvidence } from '../../core/model/grid-model';
import { makeState } from '../rules/_helpers';

const MAP = 120;
const overlayFor = (gs: GridState) => new Overlay3D(() => gs, () => {});
const state = (): GridState => makeState(MAP, MAP) as GridState;

/** The macro-unit box a mesh covers, undoing the world offset and the grid shift. */
function macroExtent(gs: GridState, mesh: THREE.Mesh, micro: boolean): Rect {
  const off = mapCenterOffset(gs.template.width, gs.template.height);
  const shift = micro ? -0.5 : 0;
  const pos = mesh.geometry.getAttribute('position');
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + off.x - shift, z = pos.getZ(i) + off.z - shift;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x);
    z0 = Math.min(z0, z); z1 = Math.max(z1, z);
  }
  return { x: x0, y: z0, w: x1 - x0, h: z1 - z0 };
}

function expectCovers(actual: Rect, want: Rect): void {
  expect(actual.x).toBeCloseTo(want.x, 5);
  expect(actual.y).toBeCloseTo(want.y, 5);
  expect(actual.w).toBeCloseTo(want.w, 5);
  expect(actual.h).toBeCloseTo(want.h, 5);
}

/** The last mesh the overlay added (every shade here adds exactly one fill mesh). */
function lastFill(o: Overlay3D): THREE.Mesh {
  const meshes = o.group.children.filter((c): c is THREE.Mesh => (c as THREE.Mesh).isMesh);
  return meshes[meshes.length - 1]!;
}

const bodyErr = (rects: Rect[], grid: 'macro' | 'micro'): ValidationError =>
  ({ ruleId: 'T', message: 'test', ...bodyEvidence(rects), grid, severity: 'error' });

/** The same case list the 2D inventory carries, so the two tables can be read against each other. */
const BODIES: Array<{ name: string; body: Rect; micro: boolean }> = [
  { name: 'plain terrain cell', body: { x: 4, y: 5, w: 1, h: 1 }, micro: true },
  { name: 'terrain cell at the map corner', body: { x: 0, y: 0, w: 1, h: 1 }, micro: true },
  { name: 'macro object 2x3', body: { x: 4, y: 5, w: 2, h: 3 }, micro: false },
  { name: 'the plaza (fractional anchor)', body: { x: 76.5, y: 58.5, w: 20, h: 27 }, micro: false },
  { name: 'halfStep bridge anchor', body: { x: 10.5, y: 12.5, w: 4, h: 1 }, micro: false },
  { name: 'halfStep ramp anchor, rotated', body: { x: 3, y: 7.5, w: 1, h: 4 }, micro: false },
];

describe('3D shades: a box covers its body exactly', () => {
  for (const c of BODIES) {
    it(`selection box — ${c.name}`, () => {
      const gs = state();
      const o = overlayFor(gs);
      o.showSelection(c.body.x, c.body.y, c.body.w, c.body.h, undefined, c.micro);
      expectCovers(macroExtent(gs, lastFill(o), c.micro), c.body);
    });

    it(`hover box — ${c.name}`, () => {
      const gs = state();
      const o = overlayFor(gs);
      o.showHover(c.body.x, c.body.y, c.body.w, c.body.h, c.micro);
      expectCovers(macroExtent(gs, lastFill(o), c.micro), c.body);
    });
  }

  it('the rubber band covers the macro band rect (a band only ever selects objects)', () => {
    const gs = state();
    const o = overlayFor(gs);
    o.showBand({ x: 2.5, y: 3, w: 4, h: 1.5 });
    expectCovers(macroExtent(gs, lastFill(o), false), { x: 2.5, y: 3, w: 4, h: 1.5 });
  });
});

describe('3D shades: the error flash', () => {
  it('drapes the shade over the exact plaza body', () => {
    const gs = state();
    const o = overlayFor(gs);
    const plaza: Rect = { x: 76.5, y: 58.5, w: 20, h: 27 };
    o.flashErrors([bodyErr([plaza], 'macro')], true);
    expectCovers(macroExtent(gs, lastFill(o), false), plaza);
  });

  it('drapes evidence cells as unit cells on the error\'s own grid', () => {
    const gs = state();
    const o = overlayFor(gs);
    o.flashErrors([{ ruleId: 'T', message: 't', cells: [{ x: 4, y: 5 }], grid: 'micro', severity: 'error' }], false);
    expectCovers(macroExtent(gs, lastFill(o), true), { x: 4, y: 5, w: 1, h: 1 });
  });

  it('splits a mixed refusal into one drape per grid, each on its own form', () => {
    const gs = state();
    const o = overlayFor(gs);
    o.flashErrors([
      bodyErr([{ x: 10.5, y: 12.5, w: 4, h: 1 }], 'macro'),
      { ruleId: 'T', message: 't', cells: [{ x: 4, y: 5 }], grid: 'micro', severity: 'error' },
    ], true);
    const meshes = o.group.children.filter((c): c is THREE.Mesh => (c as THREE.Mesh).isMesh);
    expect(meshes).toHaveLength(2);
    expectCovers(macroExtent(gs, meshes[0]!, true), { x: 4, y: 5, w: 1, h: 1 });
    expectCovers(macroExtent(gs, meshes[1]!, false), { x: 10.5, y: 12.5, w: 4, h: 1 });
  });
});

describe('3D shades: the commit flash and the agent write acknowledgement', () => {
  it('a bare cell list falls back to the TERRAIN grid — the same default the 2D view states', () => {
    const gs = state();
    const o = overlayFor(gs);
    o.flashCommit([{ x: 4, y: 5 }]);
    expectCovers(macroExtent(gs, lastFill(o), true), { x: 4, y: 5, w: 1, h: 1 });
  });

  it('honours a per-cell grid: one write of terrain and a body drapes each where it stands', () => {
    // What `resolveCellsFlash` hands the host for an agent write that painted (1,1) and placed a
    // 2x1 body at (5,6).
    const gs = state();
    const o = overlayFor(gs);
    o.flashCommit([
      { x: 1, y: 1, micro: true },
      { x: 5, y: 6, micro: false }, { x: 6, y: 6, micro: false },
    ]);
    const meshes = o.group.children.filter((c): c is THREE.Mesh => (c as THREE.Mesh).isMesh);
    expect(meshes).toHaveLength(2); // one drape per grid
    expectCovers(macroExtent(gs, meshes[0]!, true), { x: 1, y: 1, w: 1, h: 1 });
    expectCovers(macroExtent(gs, meshes[1]!, false), { x: 5, y: 6, w: 2, h: 1 });
  });

  it('an explicit terrainMode still governs a list that carries no per-cell grid', () => {
    const gs = state();
    const o = overlayFor(gs);
    o.flashCommit([{ x: 4, y: 5 }], { terrainMode: false });
    expectCovers(macroExtent(gs, lastFill(o), false), { x: 4, y: 5, w: 1, h: 1 });
  });
});

describe('3D shades: cell-set drapes', () => {
  it('the ghost lays its cells on the grid it is given, half-cell anchors included', () => {
    const gs = state();
    const o = overlayFor(gs);
    o.showGhost([{ x: 10.5, y: 12.5 }, { x: 11.5, y: 12.5 }], 0x22c55e, false);
    o.flush();
    expectCovers(macroExtent(gs, lastFill(o), false), { x: 10.5, y: 12.5, w: 2, h: 1 });
  });

  it('the route drape is on the TERRAIN grid — the maze walls stand there', () => {
    const gs = state();
    const o = overlayFor(gs);
    o.showRoute([{ x: 6, y: 7 }]);
    expectCovers(macroExtent(gs, lastFill(o), true), { x: 6, y: 7, w: 1, h: 1 });
  });

  it('the buildable wash follows its caller\'s grid', () => {
    const gs = state();
    const o = overlayFor(gs);
    o.showBuildableRegion([{ x: 3, y: 4 }], true);
    expectCovers(macroExtent(gs, lastFill(o), true), { x: 3, y: 4, w: 1, h: 1 });
  });
});


describe('editable curve footprint', () => {
  it.each([true, false])('matches the selected grid with terrainGrid %s and survives hover clearing', terrainGrid => {
    const gs = state(), overlay = overlayFor(gs);
    overlay.showCurveFootprint([{ x: 4, y: 5 }, { x: 5, y: 5 }], terrainGrid);
    const mesh = overlay.group.getObjectByName('curve-footprint') as THREE.Mesh;
    expectCovers(macroExtent(gs, mesh, terrainGrid), { x: 4, y: 5, w: 2, h: 1 });
    const geometry = vi.spyOn(mesh.geometry, 'dispose');
    const material = vi.spyOn(mesh.material as THREE.Material, 'dispose');
    overlay.clearGhost(); overlay.flush();
    expect(overlay.group.getObjectByName('curve-footprint')).toBe(mesh);
    overlay.clearCurveFootprint();
    expect(geometry).toHaveBeenCalledOnce();
    expect(material).toHaveBeenCalledOnce();
    expect(overlay.group.getObjectByName('curve-footprint')).toBeUndefined();
    overlay.showCurveFootprint([{ x: 6, y: 5 }], terrainGrid);
    overlay.dispose();
    expect(overlay.group.getObjectByName('curve-footprint')).toBeUndefined();
  });
});
