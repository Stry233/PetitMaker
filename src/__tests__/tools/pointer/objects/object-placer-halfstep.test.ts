/**
 * Half-step snapping. `planPlacementGhost` and `ObjectPlacerTool.onPointerDown` route the hovered
 * anchor through `snapAnchor`: a halfStep item probes and places with its footprint's centre on the
 * half-cell point nearest `ctx.point`, and every other item centres on its whole-cell `coord`. Bridge
 * and ramp span detection belongs to half-step-detection.test.ts; these fixtures use a plain halfStep
 * item.
 */
import { describe, it, expect } from 'vitest';
import { ObjectPlacerTool } from '../../../../tools/pointer/objects/object-placer';
import { ItemCategory } from '../../../../config/catalog/categories';
import { CellZone } from '../../../../core/game/zones';
import { makeState, setZone, makeExecutor } from '../../../_support/map-state';
import { __setCatalogItem, getCatalogItem } from '../../../../state/catalog';
import { hasHalfStep, snapsOwnPlacement } from '../../../../state/object-geometry';
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
  it('a 1x1 halfStep item at pointer 7.8 centres on the nearest half point (8), anchoring at 7.5; a tree takes the whole cell (7)', () => {
    const state = grassMap();
    const ctx = {
      ...makeToolCtx(state, exec(state)),
      point: point({ x: 7.8, y: 5.5 }), // the half-cell point nearest (7.8, 5.5) is (8, 5.5)
    };
    const coord = { x: 7, y: 5 }; // the placement cell holding the pointer

    const half = placementHover('hs-ux-slab', coord, ctx);
    expect(half?.cells[0]).toEqual({ x: 7.5, y: 5 });
    expect(half?.valid).toBe(true);

    const tree = placementHover('tree-apple', coord, ctx);
    expect(tree?.cells[0]).toEqual({ x: 7, y: 5 });
  });

  it('centres on the cell it is handed when the context carries no pointer point (headless)', () => {
    const state = grassMap();
    const ctx = makeToolCtx(state, exec(state)); // point left undefined
    const plan = placementHover('hs-ux-slab', { x: 7, y: 5 }, ctx);
    expect(plan?.cells[0]).toEqual({ x: 7, y: 5 });
  });

  it('centres a large halfStep item (the station) on the half point nearest the pointer', () => {
    const station = getCatalogItem('facility-station')!;
    expect(hasHalfStep(station) && !snapsOwnPlacement(station), 'the station is a halfStep item that does not snap').toBe(true);
    const state = grassMap(60);
    for (const at of [{ x: 30.2, y: 31.7 }, { x: 29.8, y: 30.1 }]) {
      const ctx = { ...makeToolCtx(state, exec(state)), point: point(at) };
      const plan = placementHover(station.id, { x: Math.floor(at.x), y: Math.floor(at.y) }, ctx)!;
      const anchor = plan.cells[0]!;
      expect({ x: anchor.x + station.width / 2, y: anchor.y + station.height / 2 }, `pointer at ${at.x}, ${at.y}`)
        .toEqual({ x: Math.round(at.x * 2) / 2, y: Math.round(at.y * 2) / 2 });
    }
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
  it('places a halfStep item centred on the pointer\'s nearest half point, not on the whole cell under it', () => {
    const state = grassMap();
    const executor = exec(state);
    const ctx = {
      ...makeToolCtx(state, executor, 1, 1, { armedItem: 'hs-ux-slab', placementRotation: 0 }),
      point: point({ x: 7.8, y: 5.5 }),
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
