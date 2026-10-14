/**
 * The 3D placement preview stands where the click places: over a step, the ghost body takes the
 * placed object's own height (the snapped span's for a bridge or a ramp, the anchor's surface for
 * anything else), and the footprint wash lies on the terrain under each part of it, never at one
 * tier's height across another. A refused placement keeps its refusal tint and lies on the terrain
 * the same way, and so does the hover shadow over a placed span.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { OverlayLayer3D } from '../../../../view/map3d/layers/overlay-layer';
import { objectInstance } from '../../../../view/map3d/geometry/object-meshes';
import { DECAL_LIFT } from '../../../../view/map3d/geometry/overlay-decals';
import { surfaceHeightAt } from '../../../../view/map3d/geometry/pick';
import { ObjectPlacerTool } from '../../../../tools/pointer/objects/object-placer';
import { washColor } from '../../../../view/shared/overlay/preview-cell';
import { TerrainType, type GridState, type MacroCoord, type PlacedObject } from '../../../../core/model/types';
import { __setCatalogItem } from '../../../../state/catalog';
import { getPlacedObjectSize } from '../../../../state/object-geometry';
import { mapPoint } from '../../../../core/grid/grids';
import { makeState, setTerrain, makeExecutor } from '../../../_support/map-state';
import { makeToolCtx, objectsByCatalog } from '../../../_support/tool-ctx';
import { cell } from '../../../_support/grid';
import { ItemCategory } from '../../../../config/catalog/categories';

/** A large body with no flatness rule, so it may stand across a step. */
__setCatalogItem({
  id: 'preview-height-pad', category: ItemCategory.Building, name: { en: 'Preview Height Pad' },
  width: 4, height: 4, loadValue: 0, rotatable: false, placementMode: 'point', traits: [],
});

const S = 24;

/** Layer-1 mountain wherever `high` holds. */
function terraced(high: (x: number, y: number) => boolean): GridState {
  const s = makeState(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (high(x, y)) setTerrain(s, x, y, TerrainType.Mountain, 1);
  return s;
}

/** The overlay internals this reads: the body ghost and the footprint wash, and the hover shadow. */
interface OverlayParts {
  ghosts: {
    placementGhost: { mesh: THREE.Mesh } | null;
    ghost: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial } | null;
  };
  boxes: { hover: { mesh: THREE.Mesh } | null };
}

/** Hover the armed item at map point `at` through the real placer into a real 3D overlay. */
function preview(state: GridState, item: string, at: MacroCoord) {
  const executor = makeExecutor(state);
  const overlay = new OverlayLayer3D({ state: () => state, requestRender: () => {} });
  const ctx = makeToolCtx(state, executor, 1, 1, { armedItem: item });
  ctx.overlay = overlay;
  ctx.point = mapPoint(at);
  const tool = new ObjectPlacerTool();
  const c = cell<'object'>({ x: Math.floor(at.x), y: Math.floor(at.y) });
  tool.onPointerMove(c, ctx.point, ctx);
  overlay.flush();
  const inner = overlay as unknown as OverlayParts;
  const parts = {
    get ghost() { return inner.ghosts.ghost; }, get placementGhost() { return inner.ghosts.placementGhost; },
    get hover() { return inner.boxes.hover; },
  };
  return { overlay, parts, place: () => tool.onPointerDown(c, ctx.point!, ctx) };
}

/** Every vertex of the wash, each against the surface it lies on. A piece of a trimmed cell can sit
 *  on its edge, so each vertex is read just inside its own polygon, toward the polygon's centre. */
function washHeights(state: GridState, mesh: THREE.Mesh): Array<{ y: number; surface: number }> {
  const pos = mesh.geometry.getAttribute('position');
  const index = mesh.geometry.getIndex()!;
  const out: Array<{ y: number; surface: number }> = [];
  for (let t = 0; t < index.count; t += 3) {
    const ids = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
    const cx = ids.reduce((a, i) => a + pos.getX(i), 0) / 3, cz = ids.reduce((a, i) => a + pos.getZ(i), 0) / 3;
    out.push({ y: pos.getY(ids[0]!), surface: surfaceHeightAt(state, cx, cz) });
  }
  return out;
}

function expectWashOnTerrain(state: GridState, mesh: THREE.Mesh, lift = DECAL_LIFT): void {
  const heights = washHeights(state, mesh);
  expect(heights.length).toBeGreaterThan(0);
  for (const h of heights) expect(h.y).toBeCloseTo(h.surface + lift, 5);
  // Over a step the wash lies on both tiers.
  expect(new Set(heights.map((h) => h.y.toFixed(4))).size).toBeGreaterThan(1);
}

/** The wash's tint as the overlay stores it (linear colour from an sRGB hex). */
const tinted = (hex: number): number => new THREE.Color().setHex(hex).convertSRGBToLinear().getHex();

function placedBodyY(state: GridState, obj: PlacedObject): number {
  return objectInstance(state, obj)!.inst.y;
}

describe('the 3D placement preview over a step', () => {
  it('a bridge previews at the deck height it is placed at, its wash on the banks and in the gap', () => {
    const state = terraced((x) => x <= 6 || x >= 11);
    const { parts, place } = preview(state, 'bridge-iron', { x: 8.6, y: 10.3 });
    expect(parts.ghost!.mat.color.getHex()).toBe(tinted(washColor({ wash: 'placement', valid: true })));
    expectWashOnTerrain(state, parts.ghost!.mesh);
    const ghostY = parts.placementGhost!.mesh.position.y;
    place();
    const [bridge] = objectsByCatalog(state, 'bridge-iron');
    expect(bridge).toBeDefined();
    expect(ghostY).toBeCloseTo(placedBodyY(state, bridge), 6);
  });

  it('a ramp previews at the height it is placed at, its wash on both tiers it straddles', () => {
    const state = terraced((x) => x >= 10);
    const { overlay, parts, place } = preview(state, 'ramp-grassy', { x: 9.6, y: 10.2 });
    expectWashOnTerrain(state, parts.ghost!.mesh);
    const ghostY = parts.placementGhost!.mesh.position.y;
    place();
    const [ramp] = objectsByCatalog(state, 'ramp-grassy');
    expect(ramp).toBeDefined();
    expect(ghostY).toBeCloseTo(placedBodyY(state, ramp), 6);
    // Hovering the placed ramp with nothing armed: its footprint shadow lies on both tiers too.
    const size = getPlacedObjectSize(ramp);
    overlay.showHover({ x: ramp.position.x, y: ramp.position.y, w: size.w, h: size.h }, 'object');
    expectWashOnTerrain(state, parts.hover!.mesh, 2 * DECAL_LIFT);
  });

  it('a large object previews at the height it is placed at, its wash on both tiers', () => {
    const state = terraced((x) => x >= 10);
    const { parts, place } = preview(state, 'preview-height-pad', { x: 8.3, y: 8.3 });
    expectWashOnTerrain(state, parts.ghost!.mesh);
    const ghostY = parts.placementGhost!.mesh.position.y;
    place();
    const [pad] = objectsByCatalog(state, 'preview-height-pad');
    expect(pad).toBeDefined();
    expect(ghostY).toBeCloseTo(placedBodyY(state, pad), 6);
  });

  it('a refused large building keeps its refusal tint and its wash lies on the terrain', () => {
    const state = terraced((x) => x >= 10);
    const { parts, place } = preview(state, 'building-bamboo-cabin', { x: 7.3, y: 8.3 });
    expect(parts.ghost!.mat.color.getHex()).toBe(tinted(washColor({ wash: 'placement', valid: false })));
    expectWashOnTerrain(state, parts.ghost!.mesh);
    place();
    expect(objectsByCatalog(state, 'building-bamboo-cabin')).toHaveLength(0);
  });
});
