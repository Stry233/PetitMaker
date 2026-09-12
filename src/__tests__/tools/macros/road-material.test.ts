/**
 * WHOSE SURFACE A ROAD MACRO LAYS, through the tool the two aimed gestures ship behind.
 *
 * `readRoadStyle` works out what a map is already paved with so a new lane comes out matching the
 * street it grows from, and a caller that always names a material never reaches it. The store seeds
 * `tileMaterial` with the catalog's first road because the tile brush needs something armed, so a shell
 * caller passing that seed as `material` overrides the map's own surface on every press with a decision
 * nobody made. The agent's `build_road_network` names no material at all, which is why it does reach the
 * feature.
 *
 * The rule this pins: a surface the CALLER named wins, and the map's own fills in when nobody
 * chose. `tileMaterialPicked` is the store's answer to which of the two is happening
 * (`state/slices/edit.ts`), and `MacroTool` reads it through the context seam.
 *
 * The whole-map press's own half of the same rule is pinned on the shell surface it runs from, in
 * `ui/shell/terrain-bar.test.tsx` — there is no tool under that gesture to drive.
 */
import { describe, expect, it } from 'vitest';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules';
import { categoryOf } from '../../../state/catalog';
import { roadLookup } from '../../../state/object-index';
import { objectPlacementCommand } from '../../../tools/objects/object-placer';
import { generateObjectId } from '../../../core/model/object-id';
import { MacroTool } from '../../../tools/macros/macro-tool';
import { makeState } from '../../rules/_helpers';
import { makeToolCtx } from '../_tool-ctx';
import type { ToolContext } from '../../../tools/runtime/types';
import {
  CellZone, ItemCategory,
  type EditorEvents, type GridState, type MacroCoord, type PlacedObject,
} from '../../../core/model/types';

const SIZE = 45;
const SHORE = 3;

interface Kit { state: GridState; executor: CommandExecutor; registry: ReturnType<CommandExecutor['getRegistry']> }

/** An open, flat, buildable map with a sea border, already paved with a PARK STONE street along
 *  y = 10: the surface a lane laid beside it should come out in. */
function stoneStreet(): Kit {
  const state = makeState(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    if (x < SHORE || y < SHORE || x >= SIZE - SHORE || y >= SIZE - SHORE) state.cells[y]![x]!.zone = CellZone.Void;
  }
  const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
  for (let x = 8; x <= 34; x++) {
    const obj: PlacedObject = {
      id: generateObjectId(), catalogId: 'path-park-stone', position: { x, y: 10 }, rotation: 0, elevation: 0,
    };
    expect(executor.execute(objectPlacementCommand(obj)).success).toBe(true);
  }
  return { state, executor, registry: executor.getRegistry() };
}

const settle = (): Promise<void> => new Promise((r) => { setTimeout(r, 0); });

/** The endpoint gesture as a hand makes it, on a tool armed with the given context. */
async function dragRoad(kit: Kit, over: Partial<ToolContext>, from: MacroCoord, to: MacroCoord): Promise<Set<string>> {
  const ctx = makeToolCtx(kit.state, kit.executor, 1, 1, { armedMacro: 'road-link', ...over });
  const tool = new MacroTool();
  tool.onActivate();
  const before = new Set(kit.state.objects.keys());
  tool.onPointerDown(from, from as never, ctx);
  tool.onPointerMove(to, to as never, ctx);
  await settle();
  tool.onPointerUp(to, to as never, ctx);
  const laid = new Set<string>();
  for (const [id, o] of kit.state.objects) {
    if (!before.has(id) && categoryOf(o) === ItemCategory.Road) laid.add(o.catalogId);
  }
  return laid;
}

describe('which surface a road macro lays', () => {
  it('matches the street already standing when nobody has picked one', async () => {
    const kit = stoneStreet();
    // The store's own fresh state: dirt armed for the tile brush, chosen by no one.
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
