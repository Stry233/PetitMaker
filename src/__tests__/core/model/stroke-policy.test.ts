/** The executor calls its stroke policy's hooks in one fixed order, and adds nothing without one. */
import { describe, it, expect } from 'vitest';
import { CommandType, TerrainType, type Command, type MacroCoord } from '../../../core/model/types';
import type { StrokePolicy } from '../../../core/model/stroke-policy';
import { bareExecutor } from '../../_support/kernel';
import { makeExecutor, makeState, paintCmd, placeCmd } from '../../_support/map-state';

const SLAB: MacroCoord[] = [{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 5, y: 6 }, { x: 6, y: 6 }];
const road = () => ({ id: 'road-5-5', catalogId: 'path-overgrown-dirt', position: { x: 5, y: 5 }, rotation: 0 as const, elevation: 0 });

/** A policy that logs each hook it is given and issues one repair from `afterCommand`. */
function recordingPolicy(log: string[]): StrokePolicy {
  return {
    afterCommand(kernel, cmd) {
      log.push(`afterCommand ${cmd.type}`);
      if (cmd.type === CommandType.PaintTerrain && cmd.cells[0]?.x === 1) kernel.execute(paintCmd([{ x: 2, y: 1 }], TerrainType.Mountain, 1));
    },
    pending: () => { log.push('pending'); return false; },
    beforeValidate: (_kernel, changed) => { log.push(`beforeValidate ${changed.length}`); },
    endStroke: () => { log.push('endStroke'); },
    afterValidate: (_kernel, changed) => { log.push(`afterValidate ${changed.length}`); },
  };
}

describe('stroke policy', () => {
  it('runs afterCommand once per command, never for its own repairs, then the commit hooks in order', () => {
    const log: string[] = [];
    const exec = bareExecutor(makeState(10, 10), { policy: recordingPolicy(log) });
    const whole = exec.beginStroke();
    exec.execute(paintCmd([{ x: 1, y: 1 }], TerrainType.Mountain, 1));
    expect(log).toEqual([`afterCommand ${CommandType.PaintTerrain}`]);
    log.length = 0;
    whole.commit();
    expect(log).toEqual(['beforeValidate 2', 'endStroke', 'afterValidate 2']);
    expect(exec.historyDepth()).toBe(1);
  });

  it('asks pending when the stroke changed no cell, and skips both passes without reconcile', () => {
    const log: string[] = [];
    const exec = bareExecutor(makeState(10, 10), { policy: recordingPolicy(log) });
    const whole = exec.beginStroke();
    exec.execute(paintCmd([], TerrainType.Mountain, 1));
    log.length = 0;
    whole.commit();
    expect(log).toEqual(['pending', 'endStroke']);

    const objectsOnly = exec.beginStroke();
    exec.execute(placeCmd(road()));
    exec.execute({ type: CommandType.RemoveObject, objectId: 'road-5-5' } as Command);
    log.length = 0;
    objectsOnly.commit({ reconcile: false });
    expect(log).toEqual(['endStroke']);
  });

  it('ends the stroke when it is rolled back, undone, redone or replaced', () => {
    const log: string[] = [];
    const exec = bareExecutor(makeState(10, 10), { policy: recordingPolicy(log) });
    const stroke = exec.beginStroke();
    exec.execute(paintCmd([{ x: 3, y: 3 }], TerrainType.Mountain, 1));
    log.length = 0;
    stroke.rollback();
    exec.execute(paintCmd([{ x: 3, y: 3 }], TerrainType.Mountain, 1));
    exec.undo();
    exec.redo();
    exec.restoreHistory([]);
    expect(log.filter((l) => l === 'endStroke')).toHaveLength(4);
  });

  it('hands the outer commit every cell of an inner group that collapsed first', () => {
    const seen: MacroCoord[][] = [];
    const policy: StrokePolicy = { beforeValidate: (_kernel, changed) => { seen.push(changed.flatMap((s): MacroCoord[] => [...s.cells])); } };
    const exec = bareExecutor(makeState(10, 10), { policy });
    const outer = exec.beginStroke();
    const inner = exec.beginStroke();
    exec.execute(paintCmd([{ x: 1, y: 1 }], TerrainType.Mountain, 1));
    exec.execute(paintCmd([{ x: 7, y: 7 }], TerrainType.Mountain, 1));
    exec.execute(placeCmd(road()));
    inner.collapse();
    outer.commit();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual(expect.arrayContaining([{ x: 1, y: 1 }, { x: 7, y: 7 }, { x: 5, y: 5 }]));
  });

  it('adds no repair without a policy: a road stays where its ground was raised', () => {
    const bare = makeState(10, 10);
    const kernel = bareExecutor(bare);
    kernel.execute(placeCmd(road()));
    const bareStroke = kernel.beginStroke();
    for (const c of SLAB) kernel.execute(paintCmd([c], TerrainType.Mountain, 1));
    bareStroke.commit();
    expect(bare.objects.get('road-5-5')?.elevation).toBe(0);

    const live = makeState(10, 10);
    const editor = makeExecutor(live);
    editor.execute(placeCmd(road()));
    const liveStroke = editor.beginStroke();
    for (const c of SLAB) editor.execute(paintCmd([c], TerrainType.Mountain, 1));
    liveStroke.commit();
    expect(live.objects.get('road-5-5')?.elevation).toBe(1);
  });
});
