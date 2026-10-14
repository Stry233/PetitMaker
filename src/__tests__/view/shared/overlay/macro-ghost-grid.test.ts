// @vitest-environment jsdom
/**
 * A macro ghost draws each cell on the grid it names. A stream lays terrain cells, which render
 * half a cell up and left, while the road tiles it would cost and a bridge it would lay stand on
 * the object grid; both views draw those where the objects stand.
 */
import '../../../_support/pixi-env';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../view/shared/overlay/preview-cell-raster', () => ({
  HATCH_CELLS: 3,
  previewIconCanvas: () => null,
  previewHatchCanvas: () => null,
}));
import * as THREE from 'three';
import { OverlayLayer } from '../../../../view/map2d/layers/overlay-layer';
import { OverlayLayer3D } from '../../../../view/map3d/layers/overlay-layer';
import { mapCenterOffset } from '../../../../view/map3d/geometry/coords';
import { TILE_SIZE, TERRAIN_GRID_OFFSET_PX } from '../../../../view/map2d/geometry/world';
import { MACROS } from '../../../../tools/macros/run';
import type { MacroPreview } from '../../../../tools/macros/runtime/preview';
import { makeState } from '../../../_support/map-state';
import { mixedCellSet } from '../../../../core/grid/grids';
import { overlayPart } from '../../../_support/overlay-parts';

interface Shape { x: number; y: number; width?: number; height?: number }
interface Data { shape: Shape; fillStyle: { color: number; alpha: number } }

const frame = (): Promise<void> => new Promise((r) => { requestAnimationFrame(() => r()); });

/** A stream along row 20 through a road down column 20: its water, a bridge tile it lays and the
 *  road tile it replaces. */
const STREAM: MacroPreview = {
  valid: true,
  added: [...Array.from({ length: 9 }, (_, i) => ({ x: 16 + i, y: 20, grid: 'terrain' as const })), { x: 20, y: 19, grid: 'object' }],
  removed: [{ x: 20, y: 21, grid: 'object' }],
  blocked: [],
  offers: [],
};
const show = (overlay: { showGhost: OverlayLayer['showGhost'] }): void => {
  overlay.showGhost(mixedCellSet(MACROS.stream.grid, STREAM.added), { icon: null, valid: true }, undefined, [...STREAM.removed, ...STREAM.blocked]);
};

describe('a stream ghost through a road', () => {
  it('draws its object cells and losses where the objects stand in 2D', async () => {
    const overlay = new OverlayLayer(() => {});
    show(overlay);
    await frame();
    const rects = overlayPart<{ geometry: { graphicsData: Data[] } }>(overlay, 'ghostGraphics').geometry.graphicsData
      .map((d) => d.shape).filter((r) => typeof r.width === 'number' && r.height === TILE_SIZE);
    const at = (x: number, y: number) => rects.some((r) => r.x === x && r.y === y && r.width === TILE_SIZE);
    // The road tile it replaces and the bridge tile it lays, unshifted.
    expect(at(20 * TILE_SIZE, 21 * TILE_SIZE)).toBe(true);
    expect(at(20 * TILE_SIZE, 19 * TILE_SIZE)).toBe(true);
    // The water itself, on the terrain grid.
    expect(
      rects.some((r) => r.x === 16 * TILE_SIZE + TERRAIN_GRID_OFFSET_PX.x && r.y === 20 * TILE_SIZE + TERRAIN_GRID_OFFSET_PX.y && r.width === 9 * TILE_SIZE),
    ).toBe(true);
  });

  it('drapes its object cells and losses where the objects stand in 3D', () => {
    const state = makeState(40, 40);
    const overlay = new OverlayLayer3D({ state: () => state, requestRender: () => {} });
    show(overlay);
    overlay.flush();
    const off = mapCenterOffset(40, 40);
    const meshes = overlay.group.children.filter((c): c is THREE.Mesh => (c as THREE.Mesh).isMesh);
    const xz = (m: THREE.Mesh): string[] => {
      const p = m.geometry.getAttribute('position');
      const out: string[] = [];
      for (let i = 0; i < p.count; i++) out.push(`${+(p.getX(i) + off.x).toFixed(6)},${+(p.getZ(i) + off.z).toFixed(6)}`);
      return out;
    };
    const loss = meshes.find((m) => (m.material as THREE.MeshBasicMaterial).opacity === 0.4 && xz(m).includes('20,21'))!;
    // The lost road cell [20, 21) × [21, 22), draped on the four terrain cells under it.
    const lossPts = xz(loss).map((k) => k.split(',').map(Number) as [number, number]);
    expect(Math.min(...lossPts.map((q) => q[0]))).toBe(20);
    expect(Math.max(...lossPts.map((q) => q[0]))).toBe(21);
    expect(Math.min(...lossPts.map((q) => q[1]))).toBe(21);
    expect(Math.max(...lossPts.map((q) => q[1]))).toBe(22);
    const gain = new Set(meshes.flatMap(xz));
    for (const corner of ['20,19', '21,19', '21,20', '20,20']) expect(gain.has(corner)).toBe(true);
    expect(gain.has('15.5,19.5')).toBe(true);
  });
});
