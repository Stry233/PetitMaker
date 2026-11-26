// @vitest-environment jsdom
/**
 * The placement ghost shows the real thing, see-through, in both views: an item's own picture or
 * model, terrain blocks in their own colours at their planned layer, a thin outline round the
 * footprint; a refused placement tinted, washed and outlined in the loss red.
 */
import '../../../_support/pixi-env';
import { describe, expect } from 'vitest';
import * as THREE from 'three';
import { spec } from '../../../_support/spec';
import { OverlayLayer } from '../../../../view/map2d/layers/overlay-layer';
import { OverlayLayer3D } from '../../../../view/map3d/layers/overlay-layer';
import { overlayPart } from '../../../_support/overlay-parts';
import { GHOST_LOOK, GHOST_LOSS, ghostColor, ghostTint } from '../../../../view/shared/viewport/view-constants';
import { getTerrainColor, getZoneColor } from '../../../../view/map2d/draw/terrain-color';
import { SAND_ZONE } from '../../../../core/game/zones';
import { getCatalogItem } from '../../../../state/catalog';
import { iconUrl } from '../../../../assets/icon-urls';
import { mixedCellSet } from '../../../../core/grid/grids';
import { TerrainType, type GridState } from '../../../../core/model/types';
import { makeState } from '../../../_support/map-state';
import { layerToY } from '../../../../view/map3d/geometry/coords';

const TREE = 'tree-apple';
const frame = (): Promise<void> => new Promise((r) => { requestAnimationFrame(() => r()); });

interface Data { fillStyle?: { color: number; alpha: number; visible: boolean }; lineStyle?: { color: number; width: number; visible: boolean } }
const graphicsData = (overlay: OverlayLayer, field: string): Data[] =>
  overlayPart<{ geometry: { graphicsData: Data[] } }>(overlay, field).geometry.graphicsData;
const fills = (data: Data[]) => data.filter((d) => d.fillStyle?.visible).map((d) => d.fillStyle!);
const lines = (data: Data[]) => data.filter((d) => d.lineStyle?.visible && d.lineStyle.width > 0).map((d) => d.lineStyle!);

const blocks = [
  { x: 4, y: 4, terrain: { type: TerrainType.Mountain, elevation: 1 } },
  { x: 5, y: 4, terrain: { type: TerrainType.Mountain, elevation: 2 } },
];

describe('the 2D placement ghost', () => {
  spec('UI-69', 'an object shows its own picture at the ghost opacity, red-tinted when refused', () => {
    const overlay = new OverlayLayer(() => {});
    overlay.showPlacementGhost({ catalogId: TREE, x: 5, y: 5, rotation: 0, elevation: 0 }, true);
    const sprite = overlayPart<{ alpha: number; tint: number; texture: { baseTexture: { resource?: { url?: string } } } }>(overlay, 'placementGhost');
    expect(sprite.texture.baseTexture.resource?.url).toContain(iconUrl(getCatalogItem(TREE)!.icon!));
    expect(sprite.alpha).toBe(GHOST_LOOK.opacity);
    expect(sprite.tint).toBe(0xffffff);
    overlay.showPlacementGhost({ catalogId: TREE, x: 5, y: 5, rotation: 0, elevation: 0 }, false);
    expect(sprite.tint).toBe(ghostTint(false));
  });

  spec('UI-69', 'a valid footprint is only outlined; a refused one is washed and outlined in the loss red', async () => {
    const overlay = new OverlayLayer(() => {});
    overlay.showGhost(mixedCellSet('object', [{ x: 2, y: 2 }, { x: 3, y: 2 }]), { placement: true, valid: true });
    await frame();
    expect(fills(graphicsData(overlay, 'ghostGraphics'))).toEqual([]);
    expect(lines(graphicsData(overlay, 'ghostGraphics')).length).toBeGreaterThan(0);

    overlay.showGhost(mixedCellSet('object', [{ x: 2, y: 2 }, { x: 3, y: 2 }]), { placement: true, valid: false });
    await frame();
    const data = graphicsData(overlay, 'ghostGraphics');
    expect(fills(data).map((f) => [f.color, f.alpha])).toContainEqual([GHOST_LOSS, GHOST_LOOK.refusedWash]);
    expect(lines(data).every((l) => l.color === GHOST_LOSS)).toBe(true);
  });

  spec('UI-69', 'terrain blocks draw in their own layer colours, tinted when refused, see-through', async () => {
    const overlay = new OverlayLayer(() => {});
    overlay.showGhost(mixedCellSet('terrain', blocks), { placement: true, valid: true, blocks });
    await frame();
    const own = fills(graphicsData(overlay, 'blockGraphics')).map((f) => f.color);
    expect(own).toEqual(expect.arrayContaining(blocks.map((b) => getTerrainColor(b.terrain.type, b.terrain.elevation))));
    expect(overlayPart<{ alpha: number }>(overlay, 'laySlot').alpha).toBe(GHOST_LOOK.opacity);
    // A mountain's edge is drawn darker than its top.
    expect(lines(graphicsData(overlay, 'blockGraphics')).length).toBeGreaterThan(0);

    overlay.showGhost(mixedCellSet('terrain', blocks), { placement: true, valid: false, blocks });
    await frame();
    const refused = fills(graphicsData(overlay, 'blockGraphics')).map((f) => f.color);
    expect(refused).toEqual(expect.arrayContaining(blocks.map((b) => ghostColor(getTerrainColor(b.terrain.type, b.terrain.elevation), false))));
  });
});

describe('a ground ghost', () => {
  spec('UI-69', "draws the ground a planet stroke turns in its zone's colour, in both views", async () => {
    const ground = [{ x: 4, y: 4, zone: SAND_ZONE }, { x: 5, y: 4, zone: SAND_ZONE }];
    const flat = new OverlayLayer(() => {});
    flat.showGhost(mixedCellSet('terrain', ground), { placement: true, valid: true, ground });
    await frame();
    expect(fills(graphicsData(flat, 'blockGraphics')).map((f) => f.color)).toEqual([getZoneColor(SAND_ZONE)]);

    const o = new OverlayLayer3D({ state: () => makeState(24, 24) as GridState, requestRender: () => {} });
    o.showGhost(mixedCellSet('terrain', ground), { placement: true, valid: true, ground });
    o.flush();
    const slab = o.group.children.find((c): c is THREE.Mesh =>
      (c as THREE.Mesh).isMesh && ((c as THREE.Mesh).material as THREE.MeshLambertMaterial).vertexColors === true)!;
    expect(slab.geometry.getAttribute('position').count).toBe(8);
    expect((slab.material as THREE.Material).opacity).toBe(GHOST_LOOK.opacity);
    o.clearGhost();
    o.flush();
    expect(o.group.children.includes(slab)).toBe(false);
  });
});

describe('a refused road ghost in 2D', () => {
  spec('UI-69', 'wears the refused tint over its own surface', async () => {
    const { getRoadMaterials } = await import('../../../../state/catalog');
    const live = makeState(16, 16) as GridState;
    const overlay = new OverlayLayer(() => {}, () => live);
    const tile = { id: 'ghost', catalogId: getRoadMaterials()[0]!.id, position: { x: 6, y: 6 }, rotation: 0 as const, elevation: 0 };
    const tints = () => {
      const out: number[] = [];
      const walk = (n: { tint?: number; children?: unknown[] }) => {
        if (typeof n.tint === 'number' && !n.children?.length) out.push(n.tint);
        for (const c of n.children ?? []) walk(c as never);
      };
      walk(overlayPart<{ own: { slot: never } }>(overlay, 'roadLayers').own.slot);
      return out;
    };
    overlay.showGhost(mixedCellSet('object', [{ x: 6, y: 6 }]), { placement: true, valid: false, tiles: [tile] });
    await frame();
    expect(tints().length).toBeGreaterThan(0);
    expect(tints().every((t) => t === ghostTint(false))).toBe(true);
    overlay.showGhost(mixedCellSet('object', [{ x: 6, y: 6 }]), { placement: true, valid: true, tiles: [tile] });
    await frame();
    expect(tints().every((t) => t === 0xffffff)).toBe(true);
  });

  spec('UI-69', 'joining a road, tints only its own cell: the road it joins draws in its own colours', async () => {
    const { getRoadMaterials } = await import('../../../../state/catalog');
    const material = getRoadMaterials()[0]!.id;
    const live = makeState(16, 16) as GridState;
    live.objects.set('live', { id: 'live', catalogId: material, position: { x: 5, y: 6 }, rotation: 0, elevation: 0 });
    live.objectsVersion++;
    const overlay = new OverlayLayer(() => {}, () => live);
    const tile = { id: 'ghost', catalogId: material, position: { x: 6, y: 6 }, rotation: 0 as const, elevation: 0 };
    overlay.showGhost(mixedCellSet('object', [{ x: 6, y: 6 }]), { placement: true, valid: false, tiles: [tile] });
    await frame();
    type Layer = { slot: { visible: boolean; mask: { geometry: { graphicsData: { shape: { x: number; width: number } }[] } } | null } };
    const layers = overlayPart<{ own: Layer; beside: Layer }>(overlay, 'roadLayers');
    const maskX = (l: Layer) => l.slot.mask!.geometry.graphicsData.map((d) => [d.shape.x / 64, d.shape.width / 64]);
    expect(maskX(layers.own)).toEqual([[6, 1]]);
    expect(layers.beside.slot.visible).toBe(true);
    expect(maskX(layers.beside)).toEqual([[5, 1]]);
  });
});

describe('the 3D placement ghost', () => {
  const overlayFor = (gs: GridState) => new OverlayLayer3D({ state: () => gs, requestRender: () => {} });

  spec('UI-69', 'an object shows its own model colours at the ghost opacity, red-tinted when refused', () => {
    const o = overlayFor(makeState(24, 24) as GridState);
    o.showPlacementGhost({ catalogId: TREE, x: 6, y: 6, rotation: 0, elevation: 0 }, true);
    const body = o.group.children.find((c): c is THREE.Mesh => (c as THREE.Mesh).isMesh && c.children.length > 0)!;
    const valid = body.material as THREE.MeshLambertMaterial;
    expect(valid.vertexColors).toBe(true);
    expect(valid.opacity).toBe(GHOST_LOOK.opacity);
    expect(valid.color.getHex()).toBe(0xffffff);
    o.showPlacementGhost({ catalogId: TREE, x: 6, y: 6, rotation: 0, elevation: 0 }, false);
    const refused = body.material as THREE.MeshLambertMaterial;
    expect(refused.color.getHex()).toBe(new THREE.Color().setHex(ghostTint(false)).convertSRGBToLinear().getHex());
  });

  spec('UI-69', 'a refused footprint is washed in the loss red, its material shared across moves', () => {
    const o = overlayFor(makeState(24, 24) as GridState);
    const washOf = () => {
      o.flush();
      return o.group.children.find((c): c is THREE.Mesh =>
        (c as THREE.Mesh).isMesh && ((c as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity === GHOST_LOOK.refusedWash)!;
    };
    o.showGhost(mixedCellSet('object', [{ x: 4, y: 4 }]), { placement: true, valid: false });
    const first = washOf();
    o.showGhost(mixedCellSet('object', [{ x: 5, y: 4 }]), { placement: true, valid: false });
    const second = washOf();
    expect((first.material as THREE.MeshBasicMaterial).color.getHex()).toBe(new THREE.Color().setHex(GHOST_LOSS).convertSRGBToLinear().getHex());
    expect(second).not.toBe(first);
    expect(second.material).toBe(first.material);
  });

  spec('UI-69', 'terrain blocks stand at their planned layer through the terrain mesher, outlined round the footprint', () => {
    const o = overlayFor(makeState(24, 24) as GridState);
    o.showGhost(mixedCellSet('terrain', blocks), { placement: true, valid: true, blocks });
    o.flush();
    const meshes = o.group.children.filter((c): c is THREE.Mesh => (c as THREE.Mesh).isMesh);
    const solid = meshes.find((m) => (m.material as THREE.MeshLambertMaterial).vertexColors)!;
    solid.geometry.computeBoundingBox();
    expect(solid.geometry.boundingBox!.max.y).toBeCloseTo(layerToY(2));
    expect((solid.material as THREE.Material).opacity).toBe(GHOST_LOOK.opacity);
    // The outline rides the blocks' tops, not the bare ground under them.
    const outline = meshes.filter((m) => m !== solid);
    expect(outline.length).toBeGreaterThan(0);
    const ys = outline.flatMap((m) => Array.from({ length: m.geometry.getAttribute('position').count }, (_, i) => m.geometry.getAttribute('position').getY(i)));
    expect(Math.max(...ys)).toBeGreaterThan(layerToY(2));
  });
});

describe('a road ghost joining a road on the map', () => {
  spec('UI-69', 'draws the joining tile joined to the road, as the click will leave it, not as an end', async () => {
    const { getRoadMaterials } = await import('../../../../state/catalog');
    const { buildRoadTrimMeshes } = await import('../../../../view/map3d/geometry/road-mesh');
    const material = getRoadMaterials()[0]!.id;
    const tile = (id: string, x: number) => ({ id, catalogId: material, position: { x, y: 6 }, rotation: 0 as const, elevation: 0 });
    const live = makeState(16, 16) as GridState;
    live.objects.set('live', tile('live', 5));
    live.objectsVersion++;
    const ghost = tile('ghost', 6);
    // What the joined surface covers over the ghost's own cell, once laid.
    const laid = { ...live, objects: new Map([['live', tile('live', 5)], ['ghost', ghost]]), objectsVersion: 1000 };
    const area = (meshes: { positions: number[]; index: number[] }[]) => {
      let sum = 0;
      for (const m of meshes) for (let t = 0; t < m.index.length; t += 3) {
        const [a, b, c] = [m.index[t]!, m.index[t + 1]!, m.index[t + 2]!].map((i) => [m.positions[i * 3]!, m.positions[i * 3 + 2]!] as const);
        sum += Math.abs((b![0] - a![0]) * (c![1] - a![1]) - (c![0] - a![0]) * (b![1] - a![1])) / 2;
      }
      return sum;
    };
    const meshesOf = (s: GridState) => buildRoadTrimMeshes(s).map((p) => p.mesh);
    // The joined surface the click leaves, which the ghost draws over the road it joins.
    const want = area(meshesOf(laid));

    const o = new OverlayLayer3D({ state: () => live, requestRender: () => {} });
    o.showGhost(mixedCellSet('object', [{ x: 6, y: 6 }]), { placement: true, valid: true, tiles: [ghost] });
    o.flush();
    const drawn = o.group.children
      .filter((c): c is THREE.Mesh => (c as THREE.Mesh).isMesh && (c as THREE.Mesh).geometry.getAttribute('color')?.itemSize === 4)
      .map((m) => ({ positions: Array.from(m.geometry.getAttribute('position').array), index: Array.from(m.geometry.getIndex()!.array) }));
    expect(drawn.length).toBeGreaterThan(0);
    expect(area(drawn)).toBeCloseTo(want, 3);
  });
});

describe('a refused road ghost joining a road on the map', () => {
  spec('UI-69', 'tints only its own tiles: the road it joins keeps its colours', async () => {
    const { getRoadMaterials } = await import('../../../../state/catalog');
    const material = getRoadMaterials()[0]!.id;
    const live = makeState(16, 16) as GridState;
    live.objects.set('live', { id: 'live', catalogId: material, position: { x: 5, y: 6 }, rotation: 0, elevation: 0 });
    live.objectsVersion++;
    const ghost = { id: 'ghost', catalogId: material, position: { x: 6, y: 6 }, rotation: 0 as const, elevation: 0 };
    const o = new OverlayLayer3D({ state: () => live, requestRender: () => {} });
    o.showGhost(mixedCellSet('object', [{ x: 6, y: 6 }]), { placement: true, valid: false, tiles: [ghost] });
    o.flush();
    const roads = o.group.children.filter((c): c is THREE.Mesh =>
      (c as THREE.Mesh).isMesh && (c as THREE.Mesh).geometry.getAttribute('color')?.itemSize === 4);
    const tinted = new THREE.Color().setHex(ghostTint(false)).convertSRGBToLinear();
    const xs = (m: THREE.Mesh) => Array.from({ length: m.geometry.getAttribute('position').count }, (_, i) => m.geometry.getAttribute('position').getX(i));
    // On a 16-wide map the ghost's cell spans world x -2..-1 and the road it joins -3..-2.
    const red = roads.filter((m) => (m.material as THREE.MeshLambertMaterial).color.equals(tinted));
    const own = roads.filter((m) => !(m.material as THREE.MeshLambertMaterial).color.equals(tinted));
    expect(red.length).toBeGreaterThan(0);
    for (const m of red) for (const x of xs(m)) expect(x).toBeGreaterThanOrEqual(-2 - 1e-6);
    expect(own.flatMap(xs).some((x) => x < -2)).toBe(true);
    for (const m of own) for (const x of xs(m)) expect(x).toBeLessThanOrEqual(-2 + 1e-6);
  });
});
