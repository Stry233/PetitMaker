/**
 * A road macro lays the surface the user picked, else the map's own (`readRoadStyle`). The store
 * arms a default `tileMaterial` for the tile brush, so `tileMaterialPicked` says whether anyone
 * chose it. The whole-map press is covered in `ui/shell/bars/terrain/terrain-bar.slow.test.tsx`.
 */
import { placeObjectCommand } from '../../../../core/model/command-build';
import { describe, expect, it } from 'vitest';
import { CommandExecutor } from '../../../../core/commands/command-executor';
import { categoryOf } from '../../../../state/catalog';
import { generateObjectId } from '../../../../core/model/object-id';
import { MacroTool } from '../../../../tools/pointer/macros/macro-tool';
import { makeState, makeExecutor } from '../../../_support/map-state';
import { makeToolCtx, type ToolCtxOver } from '../../../_support/tool-ctx';
import type { GridState, MacroCoord, PlacedObject } from '../../../../core/model/types';
import { CellZone } from '../../../../core/game/zones';
import { cell, point } from '../../../_support/grid';
import { ItemCategory } from '../../../../config/catalog/categories';

const SIZE = 45;
const SHORE = 3;

interface Kit { state: GridState; executor: CommandExecutor; registry: ReturnType<CommandExecutor['getRegistry']> }

/** A flat buildable map with a sea border and a park stone street along y = 10. */
function stoneStreet(): Kit {
  const state = makeState(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    if (x < SHORE || y < SHORE || x >= SIZE - SHORE || y >= SIZE - SHORE) state.cells[y]![x]!.zone = CellZone.Void;
  }
  const executor = makeExecutor(state);
  for (let x = 8; x <= 34; x++) {
    const obj: PlacedObject = {
      id: generateObjectId(), catalogId: 'path-park-stone', position: { x, y: 10 }, rotation: 0, elevation: 0,
    };
    expect(executor.execute(placeObjectCommand(obj)).success).toBe(true);
  }
  return { state, executor, registry: executor.getRegistry() };
}

const settle = (): Promise<void> => new Promise((r) => { setTimeout(r, 0); });

/** The endpoint gesture as a hand makes it, on a tool armed with the given context. */
async function dragRoad(kit: Kit, over: ToolCtxOver, from: MacroCoord, to: MacroCoord): Promise<Set<string>> {
  const ctx = makeToolCtx(kit.state, kit.executor, 1, 1, { armedMacro: 'road-link', ...over });
  const tool = new MacroTool();
  tool.onActivate();
  const before = new Set(kit.state.objects.keys());
  tool.onPointerDown(cell(from), point(from as never), ctx);
  tool.onPointerMove(cell(to), point(to as never), ctx);
  await settle();
  tool.onPointerUp(cell(to), point(to as never), ctx);
  const laid = new Set<string>();
  for (const [id, o] of kit.state.objects) {
    if (!before.has(id) && categoryOf(o) === ItemCategory.Road) laid.add(o.catalogId);
  }
  return laid;
}

describe('which surface a road macro lays', () => {
  it('matches the street already standing when nobody has picked one', async () => {
    const kit = stoneStreet();
    // The store's fresh state: dirt armed for the tile brush, not picked.
    const laid = await dragRoad(kit, { tileMaterial: 'path-overgrown-dirt', tileMaterialPicked: false }, { x: 12, y: 20 }, { x: 30, y: 20 });
    expect(laid.size, 'the route laid nothing to read a material off').toBeGreaterThan(0);
    expect([...laid]).toEqual(['path-park-stone']);
  });

  it('takes the bar\'s own surface once a hand has picked one', async () => {
    const kit = stoneStreet();
    const laid = await dragRoad(kit, { tileMaterial: 'path-simple-brick', tileMaterialPicked: true }, { x: 12, y: 20 }, { x: 30, y: 20 });
    expect([...laid]).toEqual(['path-simple-brick']);
  });
});
