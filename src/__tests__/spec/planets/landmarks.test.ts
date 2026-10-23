/** The built-in planets and the landmarks every map lays from its planet and locks. */
import { describe, expect } from 'vitest';
import { spec } from '../../_support/spec';
import { MAP_LIST } from '../../../config/maps';
import { templateTerrainAt } from '../../../core/model/template';
import { templateAnchor } from '../../../core/model/landmarks';
import { mapPoint } from '../../../core/grid/grids';
import { moveGroup } from '../../../tools/objects';
import { pointerTarget } from '../../../view/interaction/selection-hover';
import { TerrainType, rect, world } from '../_world';
import { builtMap, exportJson, preview } from '../files/_files';
import { landmarksOf } from './_planets';

describe('built-in planets and landmarks', () => {
  spec('PLAN-01', 'offers Hexia and Taffeh, a new map on either holding only the planet\'s ground, terrain and landmarks', () => {
    expect(MAP_LIST.map((t) => t.name.en)).toEqual(['Hexia', 'Taffeh']);
    for (const planet of MAP_LIST) {
      const { state } = world(planet.id);
      state.cells.forEach((row, y) => row.forEach((cell, x) => {
        expect(cell.zone, `${planet.id} ${x},${y}`).toBe(planet.zones[y]![x]);
        expect(cell.terrain, `${planet.id} ${x},${y}`).toEqual(templateTerrainAt(planet, x, y, cell.zone));
      }));
      const laid = landmarksOf(state);
      expect(laid.every(({ object }) => object?.locked)).toBe(true);
      expect(state.objects.size).toBe(laid.length);
    }
  });

  spec('PLAN-02', 'lays every landmark where the planet puts it and locked, whatever a map file places', async () => {
    const w = builtMap('tafa');
    const file = JSON.parse(exportJson(w.state)) as { objects: { catalogId: string }[] };
    const laid = landmarksOf(w.state);
    expect(file.objects.some((o) => laid.some(({ spec: l }) => l.id === o.catalogId))).toBe(false);

    const at = w.openGround(4, 4);
    for (const [i, { spec: l }] of laid.entries()) {
      (file.objects as unknown[]).push({ id: `placed-${i}`, catalogId: l.id, x: at.x, y: at.y, rotation: 0 });
    }
    const { preview: opened } = await preview(JSON.stringify(file));
    for (const { spec: l, object } of laid) {
      const copies = [...opened.state.objects.values()].filter((o) => o.catalogId === l.id);
      expect(copies, l.id).toHaveLength(1);
      expect(copies[0]).toMatchObject({ locked: true, position: object!.position, rotation: object!.rotation });
    }
  });

  spec('PLAN-03', 'lets a landmark be picked but never moved, turned, removed or built over, and a delete keeps it', () => {
    const w = world('hexia');
    const plaza = w.object(templateAnchor(w.state.template)!.id)!;
    const before = { ...plaza };
    const centre = { x: plaza.position.x + plaza.width! / 2, y: plaza.position.y + plaza.height! / 2 };
    expect(pointerTarget(w.state, mapPoint(centre)).hit?.id).toBe(plaza.id);

    for (const { object } of landmarksOf(w.state)) expect(w.remove(object!.id).ok).toBe(false);
    expect(moveGroup(w.sandbox.executor, w.state, [plaza.id], { dx: 1, dy: 0 }).moved).toBe(0);
    expect(w.sandbox.rotateObject(plaza, 90, { from: 0, to: 90 }).ok).toBe(false);
    const inside = { x: Math.ceil(plaza.position.x) + 4, y: Math.ceil(plaza.position.y) + 4 };
    expect(w.place('tree-apple', inside.x, inside.y).refusedBy).toContain('V-PLACE-OVERLAP');
    expect(w.stroke(rect(inside, 3, 3), TerrainType.Mountain, 2).refusedBy).toContain('V-PLACE-BLOCK');

    const at = w.openGround(2, 2);
    const tree = w.place('tree-apple', at.x, at.y);
    expect(w.sandbox.deleteGroup([tree.id!, plaza.id])).toMatchObject({ deleted: 1, kept: 1 });
    expect(w.object(tree.id!)).toBeUndefined();
    expect(w.object(plaza.id)).toEqual(before);
  });
});
