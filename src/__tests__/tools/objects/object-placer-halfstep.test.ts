/**
 * Half-step UX snapping. `planPlacementGhost` and
 * `ObjectPlacerTool.onPointerDown` route the hovered anchor through `snapAnchor` for the ARMED
 * item — a halfStep item probes/places at the pointer's nearest half-cell point
 * (`ctx.halfCoord`, from `ViewProjection.screenToHalf`), everything else keeps today's whole-cell
 * `coord` unaffected. Bridge/ramp SPAN detection itself belongs to half-step-detection.test.ts;
 * these fixtures use a plain halfStep item so the anchor-resolution logic is exercised in
 * isolation.
 */
import { describe, it, expect } from 'vitest';
import { planPlacementGhost, ObjectPlacerTool } from '../../../tools/objects/object-placer';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules/index';
import { CellZone, ItemCategory, type EditorEvents } from '../../../core/model/types';
import { makeState, setZone } from '../../rules/_helpers';
import { registerCatalogItem } from '../../../state/catalog';
import { roadLookup } from '../../../state/object-index';
import { makeToolCtx } from '../_tool-ctx';

registerCatalogItem({
  id: 'hs-ux-slab', category: ItemCategory.Facility, name: { en: 'HalfStep UX Slab' },
  width: 1, height: 1, loadValue: 0, rotatable: false, placementMode: 'point',
  traits: [{ type: 'halfStep' }],
});

const exec = (s: any) => new CommandExecutor(s, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(s));

function grassMap(size = 20) {
  const state = makeState(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) setZone(state, x, y, CellZone.Grass);
  return state;
}

describe('planPlacementGhost: hover anchor resolution', () => {
  it('a halfStep item at pointer 7.3 probes the nearest half anchor (7.5); a tree probes the whole cell (7)', () => {
    const state = grassMap();
    const ctx = {
      ...makeToolCtx(state, exec(state)),
      halfCoord: { x: 7.5, y: 5 }, // screenToHalf(pointer 7.3): round(7.3 * 2) / 2 = 7.5
    };
    const coord = { x: 7, y: 5 }; // screenToMacro(pointer 7.3): floor(7.3) = 7

    const half = planPlacementGhost('hs-ux-slab', coord, ctx);
    expect(half?.cells[0]).toEqual({ x: 7.5, y: 5 });
    expect(half?.valid).toBe(true);

    const tree = planPlacementGhost('tree-apple', coord, ctx);
    expect(tree?.cells[0]).toEqual({ x: 7, y: 5 });
  });

  it('falls back to the whole-cell coord with no halfCoord on the context (headless/mocked)', () => {
    const state = grassMap();
    const ctx = makeToolCtx(state, exec(state)); // halfCoord left undefined
    const plan = planPlacementGhost('hs-ux-slab', { x: 7, y: 5 }, ctx);
    expect(plan?.cells[0]).toEqual({ x: 7, y: 5 });
  });

  it('canActAt agrees with the ghost at the same half anchor (probe/click parity)', () => {
    const state = grassMap();
    const ctx = {
      ...makeToolCtx(state, exec(state), 1, 1, { armedItem: 'hs-ux-slab', placementRotation: 0 }),
      halfCoord: { x: 7.5, y: 5 },
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
      halfCoord: { x: 7.5, y: 5 },
    };
    const tool = new ObjectPlacerTool();
    tool.onPointerDown({ x: 7, y: 5 }, { x: 14, y: 10 }, ctx);
    const placed = [...state.objects.values()].find((o) => o.catalogId === 'hs-ux-slab');
    expect(placed?.position).toEqual({ x: 7.5, y: 5 });
  });

  it('places a non-halfStep item at the whole cell, ignoring halfCoord (unchanged)', () => {
    const state = grassMap();
    const executor = exec(state);
    const ctx = {
      ...makeToolCtx(state, executor, 1, 1, { armedItem: 'tree-apple', placementRotation: 0 }),
      halfCoord: { x: 7.5, y: 5 },
    };
    const tool = new ObjectPlacerTool();
    tool.onPointerDown({ x: 7, y: 5 }, { x: 14, y: 10 }, ctx);
    const placed = [...state.objects.values()].find((o) => o.catalogId === 'tree-apple');
    expect(placed?.position).toEqual({ x: 7, y: 5 });
  });
});
