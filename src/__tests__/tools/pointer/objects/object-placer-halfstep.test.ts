/**
 * Half-step UX snapping. `planPlacementGhost` and
 * `ObjectPlacerTool.onPointerDown` route the hovered anchor through `snapAnchor` for the armed
 * item — a halfStep item probes/places at the pointer's nearest half-cell point
 * (the half-cell point nearest `ctx.point`), everything else keeps today's whole-cell
 * `coord` unaffected. Bridge/ramp span detection itself belongs to half-step-detection.test.ts;
 * these fixtures use a plain halfStep item so the anchor-resolution logic is exercised in
 * isolation.
 */
import { describe, it, expect } from 'vitest';
import { ObjectPlacerTool } from '../../../../tools/pointer/objects/object-placer';
import { ItemCategory } from '../../../../config/catalog/categories';
import { CellZone } from '../../../../core/game/zones';
import { makeState, setZone, makeExecutor } from '../../../_support/map-state';
import { __setCatalogItem } from '../../../../state/catalog';
import { makeToolCtx, placementHover } from '../../../_support/tool-ctx';
import { cell, point } from '../../../_support/grid';

__setCatalogItem({
  id: 'hs-ux-slab', category: ItemCategory.Facility, name: { en: 'HalfStep UX Slab' },
  width: 1, height: 1, loadValue: 0, rotatable: false, placementMode: 'point',
  traits: [{ type: 'halfStep' }],
});

const exec = (s: any) => makeExecutor(s);

function grassMap(size = 20) {
  const state = makeState(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) setZone(state, x, y, CellZone.Grass);
  return state;
}

describe('the placement hover: anchor resolution', () => {
  it('a halfStep item at pointer 7.3 probes the nearest half anchor (7.5); a tree probes the whole cell (7)', () => {
    const state = grassMap();
    const ctx = {
      ...makeToolCtx(state, exec(state)),
      point: point({ x: 7.3, y: 5 }), // the half-cell point nearest 7.3 is 7.5
    };
    const coord = { x: 7, y: 5 }; // the placement cell holding 7.3

    const half = placementHover('hs-ux-slab', coord, ctx);
    expect(half?.cells[0]).toEqual({ x: 7.5, y: 5 });
    expect(half?.valid).toBe(true);

    const tree = placementHover('tree-apple', coord, ctx);
    expect(tree?.cells[0]).toEqual({ x: 7, y: 5 });
  });

  it('falls back to the whole-cell coord with no pointer point on the context (headless)', () => {
    const state = grassMap();
    const ctx = makeToolCtx(state, exec(state)); // point left undefined
    const plan = placementHover('hs-ux-slab', { x: 7, y: 5 }, ctx);
    expect(plan?.cells[0]).toEqual({ x: 7, y: 5 });
  });

  it('canActAt agrees with the ghost at the same half anchor (probe/click parity)', () => {
    const state = grassMap();
    const ctx = {
      ...makeToolCtx(state, exec(state), 1, 1, { armedItem: 'hs-ux-slab', placementRotation: 0 }),
      point: point({ x: 7.3, y: 5 }),
    };
    const tool = new ObjectPlacerTool();
    expect(tool.canActAt!({ x: 7, y: 5 }, ctx)).toBe(true);
  });
});

describe('ObjectPlacerTool.onPointerDown: half anchor click', () => {
  it('places a halfStep item at the pointer\'s nearest half anchor, not the whole cell under it', () => {
    const state = grassMap();
    const executor = exec(state);
    const ctx = {
      ...makeToolCtx(state, executor, 1, 1, { armedItem: 'hs-ux-slab', placementRotation: 0 }),
      point: point({ x: 7.3, y: 5 }),
    };
    const tool = new ObjectPlacerTool();
    tool.onPointerDown(cell({ x: 7, y: 5 }), point({ x: 14, y: 10 }), ctx);
    const placed = [...state.objects.values()].find((o) => o.catalogId === 'hs-ux-slab');
    expect(placed?.position).toEqual({ x: 7.5, y: 5 });
  });

  it('places a non-halfStep item at the whole cell, ignoring the pointer half-cell position', () => {
    const state = grassMap();
    const executor = exec(state);
    const ctx = {
      ...makeToolCtx(state, executor, 1, 1, { armedItem: 'tree-apple', placementRotation: 0 }),
      point: point({ x: 7.3, y: 5 }),
    };
    const tool = new ObjectPlacerTool();
    tool.onPointerDown(cell({ x: 7, y: 5 }), point({ x: 14, y: 10 }), ctx);
    const placed = [...state.objects.values()].find((o) => o.catalogId === 'tree-apple');
    expect(placed?.position).toEqual({ x: 7, y: 5 });
  });
});
