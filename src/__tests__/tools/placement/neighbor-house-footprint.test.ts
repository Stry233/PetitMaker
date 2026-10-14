import { expect, it } from 'vitest';
import { objectRect } from '../../../state/object-geometry';
import { getCatalogItem } from '../../../state/catalog';
import { buildingGate } from '../../../tools/placement/object';
import { placeTileCell } from '../../../tools/pointer/paint/tile-coating';
import { makeExecutor, makeObject, makeState, placeCmd } from '../../_support/map-state';
import { makeToolCtx } from '../../_support/tool-ctx';

const cases = ['building-bamboo-cabin', 'building-plush-cabin'].flatMap(id =>
  ([0, 90, 180, 270] as const).map(rotation => ({ id, rotation })));

it.each(cases)('$id keeps its catalog footprint while paving beneath the house and its doorstep at $rotation degrees', ({ id, rotation }) => {
  const state = makeState(24, 24);
  const executor = makeExecutor(state);
  const house = makeObject(id, 10, 10, rotation);
  expect(executor.execute(placeCmd(house)).success).toBe(true);
  const rect = objectRect(house);
  const item = getCatalogItem(id)!;
  expect([rect.w, rect.h]).toEqual(rotation % 180 === 0 ? [item.width, item.height] : [item.height, item.width]);
  const { gate, approach } = buildingGate(rect, rotation);
  const ctx = makeToolCtx(state, executor);
  expect(placeTileCell(gate, ctx, new Set())).toBe(true);
  const start = executor.beginStroke();
  expect(placeTileCell(approach, ctx, new Set())).toBe(true);
  expect(start.commit()).toEqual([]);
  expect(state.objects.get(house.id)).toEqual(house);
});
