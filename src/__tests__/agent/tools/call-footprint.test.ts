/** Pins the one reading of a call's geometry the panel frames its pictures on, and its place on the op rows. */
import { describe, it, expect } from 'vitest';
import { callFootprint, jobFootprint } from '../../../agent/tools/geometry';
import { append, createLog } from '../../../agent/core/log';
import { deriveView } from '../../../agent/core/project-view';
import { TOOL_FACTS } from '../../../agent/tools';

describe('the cells a gated call is about', () => {
  /** The four shapes the tool schemas actually speak. A shot framed on the wrong rectangle is a
   *  picture of somewhere else, which is worse than no picture at all. */
  it('reads a rect, a cell list, a path, a circle and a point', () => {
    expect(callFootprint({ x1: 4, y1: 6, x2: 9, y2: 8 }))
      .toEqual({ origin: { x: 4, y: 6 }, width: 6, height: 3 });
    expect(callFootprint({ rect: { x1: 9, y1: 8, x2: 4, y2: 6 } }))
      .toEqual({ origin: { x: 4, y: 6 }, width: 6, height: 3 });
    expect(callFootprint({ cells: [{ x: 3, y: 3 }, { x: 5, y: 7 }] }))
      .toEqual({ origin: { x: 3, y: 3 }, width: 3, height: 5 });
    expect(callFootprint({ path: [{ x: 10, y: 2 }, { x: 10, y: 6 }] }))
      .toEqual({ origin: { x: 10, y: 2 }, width: 1, height: 5 });
    expect(callFootprint({ cx: 10, cy: 10, r: 2 }))
      .toEqual({ origin: { x: 8, y: 8 }, width: 5, height: 5 });
    expect(callFootprint({ x: 7, y: 7 }))
      .toEqual({ origin: { x: 7, y: 7 }, width: 1, height: 1 });
  });

  it('names no rectangle where the arguments name no place, so the card shows no box', () => {
    expect(callFootprint(undefined)).toBeUndefined();
    expect(callFootprint({})).toBeUndefined();
    expect(callFootprint({ objectId: 'obj-3', rotation: 90 })).toBeUndefined();
    expect(callFootprint({ category: 'tree' })).toBeUndefined();
    expect(callFootprint({ cells: [] })).toBeUndefined();
    expect(callFootprint({ x: 'four', y: 6 })).toBeUndefined();
  });
});

describe('the footprint a record is framed on', () => {
  const write = (footprint: ReturnType<typeof callFootprint>) => ({ isRead: false, footprint });
  it('holds every write and ignores the reads and the calls that named none', () => {
    const ops = [write(callFootprint({ x: 2, y: 3 })), write(undefined), write(callFootprint({ x1: 5, y1: 1, x2: 6, y2: 2 })),
      { isRead: true, footprint: callFootprint({ x: 40, y: 40 }) }];
    expect(jobFootprint({ ops })).toEqual({ origin: { x: 2, y: 1 }, width: 5, height: 3 });
    expect(jobFootprint({ ops: [write(undefined)] })).toBeUndefined();
  });

  it('is the painted region where the job had one', () => {
    expect(jobFootprint({ region: { x1: 9, y1: 4, x2: 3, y2: 6 }, ops: [write(callFootprint({ x: 40, y: 40 }))] }))
      .toEqual({ origin: { x: 3, y: 4 }, width: 7, height: 3 });
  });
});

describe('the footprint on the projection', () => {
  it('stands on each op row whose arguments name a place, and on no other', () => {
    const log = createLog();
    append(log, { kind: 'order', text: 'Build and plant', mapContext: '' });
    append(log, { kind: 'assistant', stop: 'tool-calls', parts: [
      { kind: 'tool', callId: 'ground', name: 'paint_terrain', argsDone: true, input: { terrain: 'mountain', x1: 2, y1: 3, x2: 4, y2: 5 } },
      { kind: 'tool', callId: 'turn', name: 'rotate_object', argsDone: true, input: { objectId: 'obj-1', rotation: 90 } },
    ] });
    const ops = deriveView(log, { facts: TOOL_FACTS }).current!.ops;
    expect(ops.find((op) => op.callId === 'ground')!.footprint).toEqual({ origin: { x: 2, y: 3 }, width: 3, height: 3 });
    expect(ops.find((op) => op.callId === 'turn')!.footprint).toBeUndefined();
  });
});
