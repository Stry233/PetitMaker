import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildModel, deckGeometry } from '../../../../view/map3d/models/build-model';
import { PERSISTENT_GROUND, addProximityFade, ensureFadeRadius } from '../../../../view/map3d/draw/proximity-fade';
import { archetypeGeometry } from '../../../../view/map3d/models/object-archetypes';
import { objectSlotInstances } from '../../../../view/map3d/geometry/object-meshes';
import { makeInstancedMesh } from '../../../../view/map3d/layers/object-layer';
import type { ArchetypeKey } from '../../../../view/map3d/geometry/types';
import { landmarkItem } from '../../../../state/catalog';
import { planetLandmarkObject } from '../../../../core/model/landmarks';
import { ANCHOR_LANDMARK } from '../../../_support/anchor';
import type { GridState } from '../../../../core/model/types';
import type { ModelPart } from '../../../../config/catalog/model-spec';
import { makeState } from '../../../_support/map-state';

const box = (x: number, group: string | false): ModelPart => ({ shape: 'box', size: [2, 4, 2], pos: [x, 1, 0], color: '#ffffff', proximityGroup: group });

describe('proximity fade groups', () => {
  it('keeps a building together while neighboring buildings and the floor have separate fade origins', () => {
    const geo = buildModel({ groundY: 1, parts: [box(-5, 'west'), box(-4, 'west'), box(5, 'east'), box(0, false)] });
    const fade = geo.getAttribute('aObjFade');
    expect(fade.count).toBe(geo.getAttribute('position').count);
    const groups = new Set(Array.from({ length: fade.count }, (_, i) => [fade.getX(i), fade.getY(i), fade.getZ(i), fade.getW(i)].join(',')));
    expect(groups.size).toBe(3);
    expect(fade.getX(0)).toBe(-4.5);
    expect(fade.getY(0)).toBe(2);
    expect(fade.getW(fade.count - 1)).toBe(-1);
    ensureFadeRadius(geo);
    expect(geo.getAttribute('aObjFade')).toBe(fade);
    geo.dispose();
  });

  it('uses full-detail group bounds at both rendering qualities', () => {
    const spec = { parts: [box(0, 'hall'), { ...box(3, 'hall'), fullOnly: true }], groundY: 1, heightInLayers: 3 };
    const full = buildModel(spec), lite = buildModel(spec, undefined, 'lite');
    expect([...full.getAttribute('aObjFade').array].slice(0, 4)).toEqual([...lite.getAttribute('aObjFade').array].slice(0, 4));
    full.dispose(); lite.dispose();
  });

  it('gives the landmark three independent buildings and a persistent courtyard at both qualities', () => {
    for (const quality of ['full', 'lite'] as const) {
      const geo = deckGeometry(landmarkItem().id, quality)!;
      const fade = geo.getAttribute('aObjFade');
      const groups = new Set(Array.from({ length: fade.count }, (_, i) => [fade.getX(i), fade.getY(i), fade.getZ(i), fade.getW(i)].join(',')));
      expect(groups.size).toBe(4);
      expect([...fade.array].every(Number.isFinite)).toBe(true);
      expect(Array.from({ length: fade.count }, (_, i) => fade.getW(i)).some(r => r < 0)).toBe(true);
    }
  });

  it('draws every part of the plaza through the faded materials, its structures fading and its floor persistent', () => {
    const plaza = planetLandmarkObject(ANCHOR_LANDMARK, { x: 20.5, y: 10.5 }, 0);
    const state = makeState(80, 80) as GridState;
    state.objects.set(plaza.id, plaza);
    const keys = objectSlotInstances(state, plaza).map((drawn) => drawn.groupKey);
    expect(keys).toEqual(['a:platform', `d:${landmarkItem().id}`]);

    const sharedMat = new THREE.MeshLambertMaterial(), modelMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    addProximityFade(sharedMat);
    addProximityFade(modelMat);
    const radii: number[] = [];
    for (const key of keys) {
      const geo = key.startsWith('d:') ? deckGeometry(key.slice(2))! : archetypeGeometry(key.slice(2) as ArchetypeKey);
      ensureFadeRadius(geo);
      const mesh = makeInstancedMesh(key, geo, 1, { sharedMat, modelMat });
      expect([sharedMat, modelMat], `${key} renders through a faded material`).toContain(mesh.material);
      const fade = geo.getAttribute('aObjFade');
      expect(fade.count).toBe(geo.getAttribute('position').count);
      for (let i = 0; i < fade.count; i++) radii.push(fade.getW(i));
    }
    expect(radii.some((r) => r > 0), 'the hall, the clock and the sculpture fade').toBe(true);
    expect(radii.filter((r) => r < 0).every((r) => r === PERSISTENT_GROUND), 'floors keep the persistent-ground marker').toBe(true);
    const platform = archetypeGeometry('platform').getAttribute('aObjFade');
    expect(Array.from({ length: platform.count }, (_, i) => platform.getW(i)).every((r) => r === PERSISTENT_GROUND)).toBe(true);
  });

  it('preserves the default object origin and nearest-surface radius for ungrouped geometry', () => {
    const geo = new THREE.BoxGeometry(2, 4, 2);
    ensureFadeRadius(geo);
    const fade = geo.getAttribute('aObjFade');
    expect(fade.getX(0)).toBe(0);
    expect(fade.getW(0)).toBeCloseTo(Math.sqrt(6));
    geo.dispose();
  });
});
