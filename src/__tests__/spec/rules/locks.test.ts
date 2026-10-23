/** Locked layers and locked objects stay as they are. */
import { describe, expect } from 'vitest';
import { spec } from '../../_support/spec';
import { rect, TerrainType, world } from '../_world';
import { build, move, peel, placed, run, setLayerLocked, turn } from './_rules';
import { eraseTerrainCommand, materialisePatchCommand, trimRoadCommand, trimTerrainCommand } from '../../../core/model/command-build';
import type { Corners } from '../../../core/model/types';

const M = TerrainType.Mountain;
const CUT: Corners = ['fan', 'square', 'square', 'square'];

describe('locked layers', () => {
  spec('V-LOCK-01', 'refuses painting at a locked layer and takes the layer below it', () => {
    const w = world();
    const c = w.openGround(3, 3);
    build(w, [[c], M, 1]);
    setLayerLocked(w, 2, true);
    const before = w.fingerprint();
    expect(w.stroke([c], M, 2).refusedBy).toContain('V-LOCK-01');
    expect(w.fingerprint()).toBe(before);
    expect(w.stroke([{ x: c.x + 1, y: c.y }], M, 1).ok).toBe(true);
  });

  spec('V-LOCK-01', 'refuses erasing or overwriting a cell whose terrain reaches a locked layer and takes one below it', () => {
    const w = world();
    const c = w.openGround(4, 3);
    const tall = c, short = { x: c.x + 2, y: c.y };
    build(w, [[tall, short], M, 1], [[tall], M, 2], [[tall], M, 3]);
    setLayerLocked(w, 2, true);
    const before = w.fingerprint();
    expect(peel(w, [tall]).refusedBy).toContain('V-LOCK-01');
    expect(run(w, eraseTerrainCommand([tall])).refusedBy).toContain('V-LOCK-01');
    expect(w.stroke([tall], TerrainType.Water, 3).refusedBy).toContain('V-LOCK-01');
    expect(w.fingerprint()).toBe(before);
    expect(peel(w, [short]).ok).toBe(true);
    expect(w.terrainAt(short)).toBeNull();
  });

  spec('V-LOCK-01', 'refuses cutting a corner of terrain standing on a locked layer and takes the cut with a higher layer locked', () => {
    const w = world();
    const c = w.openGround(3, 3);
    build(w, [[c], M, 1], [[c], M, 2]);
    setLayerLocked(w, 1, true);
    const before = w.fingerprint();
    expect(run(w, trimTerrainCommand(c.x, c.y, CUT)).refusedBy).toContain('V-LOCK-01');
    expect(w.fingerprint()).toBe(before);
    setLayerLocked(w, 1, false);
    setLayerLocked(w, 3, true);
    expect(run(w, trimTerrainCommand(c.x, c.y, CUT)).ok).toBe(true);
  });

  spec('V-LOCK-01', 'refuses cutting a corner of a road on a locked layer and takes it with another layer locked', () => {
    const w = world();
    const c = w.openGround(4, 4);
    build(w, [rect(c, 3, 3), M, 1]);
    const road = placed(w, 'path-blue-board', c.x + 1, c.y + 1, { elevation: 1 });
    setLayerLocked(w, 1, true);
    const before = w.fingerprint();
    expect(run(w, trimRoadCommand(road, road.position.x, road.position.y, CUT)).refusedBy).toContain('V-LOCK-01');
    expect(w.fingerprint()).toBe(before);
    setLayerLocked(w, 1, false);
    setLayerLocked(w, 2, true);
    expect(run(w, trimRoadCommand(road, road.position.x, road.position.y, CUT)).ok).toBe(true);
  });

  spec('V-LOCK-01', 'refuses a corner fillet rising through a locked layer and takes one that stops below it', () => {
    const w = world();
    const c = w.openGround(3, 3);
    setLayerLocked(w, 2, true);
    const before = w.fingerprint();
    expect(run(w, materialisePatchCommand(c.x, c.y, CUT, { terrainType: M, elevation: 3, patchBase: 0 })).refusedBy).toContain('V-LOCK-01');
    expect(w.fingerprint()).toBe(before);
    expect(run(w, materialisePatchCommand(c.x, c.y, CUT, { terrainType: M, elevation: 1, patchBase: 0 })).ok).toBe(true);
  });
});

describe('locked objects', () => {
  spec('V-LOCK-02', 'never removes, moves or turns a landmark that comes with the planet, and lets an ordinary object go', () => {
    const w = world();
    const landmark = [...w.state.objects.values()].find((o) => o.locked)!;
    const at = w.openGround(3, 3);
    const tree = placed(w, 'tree-apple', at.x, at.y);
    const before = w.fingerprint();
    expect(w.remove(landmark.id).refusedBy).toContain('V-LOCK-02');
    expect(move(w, landmark, landmark.position.x + 1, landmark.position.y).refusedBy).toContain('V-LOCK-02');
    expect(turn(w, landmark, 90).refusedBy).toContain('V-LOCK-02');
    expect(w.fingerprint()).toBe(before);
    expect(w.remove(tree.id).ok).toBe(true);
  });

  spec('V-LOCK-02', 'keeps a landmark through a bulk delete that takes the rest of the selection', () => {
    const w = world();
    const landmark = [...w.state.objects.values()].find((o) => o.locked)!;
    const at = w.openGround(3, 3);
    const tree = placed(w, 'tree-apple', at.x, at.y);
    const result = w.sandbox.deleteGroup([landmark.id, tree.id]);
    expect(result).toMatchObject({ deleted: 1, kept: 1 });
    expect(w.object(landmark.id)).toEqual(landmark);
    expect(w.object(tree.id)).toBeUndefined();
  });
});
