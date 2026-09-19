import { expect, it } from 'vitest';
import { objectRect } from '../../../state/object-geometry';
import { buildingGate } from '../../../tools/placement/object';
import { placeTileCell } from '../../../tools/paint/tile-coating';
import { makeExecutor, makeObject, makeState, placeCmd } from '../../rules/_helpers';
import { makeToolCtx } from '../_tool-ctx';

const cases = ['building-bamboo-cabin', 'building-plush-cabin'].flatMap(id =>
  ([0, 90, 180, 270] as const).map(rotation => ({ id, rotation })));

it.each(cases)('$id has a five-cell frontage, four-cell depth and a paveable doorstep at $rotation degrees', ({ id, rotation }) => {
  const state = makeState(24, 24);
  const executor = makeExecutor(state);
  const house = makeObject(id, 10, 10, rotation);
  expect(executor.execute(placeCmd(house)).success).toBe(true);
  const rect = objectRect(house);
  expect([rect.w, rect.h]).toEqual(rotation % 180 === 0 ? [5, 4] : [4, 5]);
  const { gate, approach } = buildingGate(rect, rotation);
  const ctx = makeToolCtx(state, executor);
  expect(placeTileCell(gate, ctx, new Set())).toBe(false);
  const start = executor.getUndoStackSize();
  expect(placeTileCell(approach, ctx, new Set())).toBe(true);
  expect(executor.commitStroke(start)).toEqual([]);
  expect(state.objects.get(house.id)).toEqual(house);
});
