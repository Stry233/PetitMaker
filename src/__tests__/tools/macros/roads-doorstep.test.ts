/**
 * THE DOORSTEP ON A TERRACE EDGE, which is the layout the acceptance sweep found the press worst on
 * and the one shape none of the other road fixtures had. Every earlier pin stands its houses on open
 * ground surrounded by their own tier, so their doorsteps are level and the router's own mask covers
 * them. A person builds along a shore or a bench instead, and then a door faces water two cells away
 * or a step three.
 *
 * Two geometries, and the fixture asserts what makes each one hard before it presses anything:
 *
 * SEAWARD — the door opens onto the lagoon. Every one of the six gate-strip cells is refused, the
 * approach row by the `flat` trait and the water under it, the gate row by the house standing there.
 * No run can ever pave this doorstep, and the honest outcome is pavement as close to it as a tile can
 * legally stand plus a report naming the door.
 *
 * INLAND — the door faces an upland step three cells off. The approach row is perfectly legal, and
 * the press can still leave it bare: `analysis.open` closes the whole ring of dual-grid margin around
 * a standing house, `openDoorsteps` reopens the approach ALONE, and the walkability flood cannot enter
 * a one-cell island. Reading reach AT the doorstep therefore answers "not connected" for a house the
 * street is four cells from, so the terminal pass skips it and the street stops in bare grass.
 */
import { describe, expect, it } from 'vitest';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules';
import { cellKey, NEIGHBORS4 } from '../../../core/model/grid-model';
import { getObjectIndex, roadLookup } from '../../../state/object-index';
import { objectRect } from '../../../state/object-geometry';
import { objectPlacementCommand } from '../../../tools/objects/object-placer';
import { generateObjectId } from '../../../core/model/object-id';
import { applyMacro } from '../../../tools/macros';
import { buildingGate } from '../../../tools/placement/object';
import { gateTerminalCells } from '../../../tools/placement/route';
import { makeState, setTerrain } from '../../rules/_helpers';
import {
  CellZone, TerrainType,
  type EditorEvents, type GridState, type MacroCoord, type PlacedObject,
} from '../../../core/model/types';
import type { KitContext } from '../../../kit/context';

const SIZE = 45;
/** Where each house stands. The seaward three face the lagoon (rotation 90 = the door faces -x);
 *  the inland two face the upland step (rotation 270 = +x). */
const SEAWARD: readonly [string, number, number][] = [
  ['building-forest-cabin', 8, 5], ['building-sunset-cabin', 8, 12], ['building-wave-cabin', 8, 19],
];
const INLAND: readonly [string, number, number][] = [
  ['building-boat-cabin', 16, 6], ['building-starbay-cabin', 16, 18],
];

interface Kit extends KitContext { executor: CommandExecutor }

/**
 * A lagoon down the west edge, flat shore, and an upland step from x = 22 east. Three cabins stand
 * on the shore with their doors to the water and two on the flat with their doors to the step.
 */
function shoreBench(): { kit: Kit; seaward: PlacedObject[]; inland: PlacedObject[] } {
  const state = makeState(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    if (x < 2 || y < 2 || x >= SIZE - 2 || y >= SIZE - 2) state.cells[y]![x]!.zone = CellZone.Void;
  }
  const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
  const kit: Kit = { state, executor, registry: executor.getRegistry() };
  for (let y = 4; y < SIZE - 4; y++) for (let x = 3; x <= 7; x++) setTerrain(state, x, y, TerrainType.Water, 0);
  for (let y = 2; y < SIZE - 2; y++) for (let x = 22; x < SIZE - 2; x++) setTerrain(state, x, y, TerrainType.Mountain, 1);
  const put = (spec: readonly [string, number, number], rotation: 90 | 270): PlacedObject => {
    const [catalogId, x, y] = spec;
    const obj: PlacedObject = { id: generateObjectId(), catalogId, position: { x, y }, rotation, elevation: 0 };
    const r = executor.execute(objectPlacementCommand(obj));
    expect(r.success, `${catalogId}@${x},${y}: ${r.errors?.[0]?.message ?? ''}`).toBe(true);
    return obj;
  };
  return {
    kit,
    seaward: SEAWARD.map((s) => put(s, 90)),
    inland: INLAND.map((s) => put(s, 270)),
  };
}

const name = (o: PlacedObject): string => `${o.catalogId}@${o.position.x},${o.position.y}`;

/** What the rules say about a road tile at one cell, without placing one. */
function roadRefusals(kit: Kit, c: MacroCoord): string[] {
  const obj: PlacedObject = { id: generateObjectId(), catalogId: 'path-overgrown-dirt', position: c, rotation: 0, elevation: 0 };
  return kit.registry.validatePreCommand(objectPlacementCommand(obj), kit.state).map((e) => e.ruleId);
}

/** Chebyshev distance from a house's gate to the nearest cell carrying a coating. */
function pavementGap(state: GridState, o: PlacedObject): number {
  const { roadByCell } = getObjectIndex(state);
  const { gate } = buildingGate(objectRect(o), o.rotation);
  let best = Infinity;
  for (const k of roadByCell.keys()) {
    const [x, y] = k.split(',').map(Number);
    best = Math.min(best, Math.max(Math.abs(x! - gate.x), Math.abs(y! - gate.y)));
  }
  return best;
}

const doorPaved = (state: GridState, o: PlacedObject): boolean => {
  const { roadByCell } = getObjectIndex(state);
  return gateTerminalCells(objectRect(o), o.rotation).some((c) => roadByCell.has(cellKey(c.x, c.y)));
};

/** The 4-connected piece each paved cell belongs to. */
function pavementComponents(state: GridState): Map<number, number> {
  const W = state.template.width;
  const { roadByCell } = getObjectIndex(state);
  const walk = new Set<number>();
  for (const k of roadByCell.keys()) {
    const [x, y] = k.split(',').map(Number);
    walk.add(y! * W + x!);
  }
  const comp = new Map<number, number>();
  let next = 0;
  for (const s of walk) {
    if (comp.has(s)) continue;
    const id = next++;
    comp.set(s, id);
    const queue = [s];
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q]!, x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of NEIGHBORS4) {
        const ni = (y + dy) * W + (x + dx);
        if (walk.has(ni) && !comp.has(ni)) { comp.set(ni, id); queue.push(ni); }
      }
    }
  }
  return comp;
}

describe('a doorstep on a terrace edge', () => {
  it('THE FIXTURE IS HARD: the seaward gate strips are refused outright, the inland ones are legal', () => {
    const { kit, seaward, inland } = shoreBench();
    for (const h of seaward) {
      const strip = gateTerminalCells(objectRect(h), h.rotation);
      for (const c of strip) {
        expect(roadRefusals(kit, c), `${name(h)} gate cell ${c.x},${c.y} should refuse a tile`).not.toEqual([]);
      }
    }
    for (const h of inland) {
      // gateTerminalCells orders the approach row first; the three after it are the gate row, which
      // is the house's own footprint and refused by V-PLACE-OVERLAP.
      const approach = gateTerminalCells(objectRect(h), h.rotation).slice(0, 3);
      for (const c of approach) {
        expect(roadRefusals(kit, c), `${name(h)} approach ${c.x},${c.y} should take a tile`).toEqual([]);
      }
    }
  });

  it('a door the rules WILL pave gets its street, joined to the network', () => {
    const { kit, inland } = shoreBench();
    const before = kit.executor.getUndoStackSize();
    applyMacro(kit, 'roads', { seed: 1, material: 'path-overgrown-dirt', width: 1, trim: 'off' });
    expect(kit.executor.getUndoStackSize(), 'one gesture, one undo entry').toBe(before + 1);

    const comp = pavementComponents(kit.state);
    const W = kit.state.template.width;
    const biggest = [...comp.values()].reduce((a, id) => {
      const size = [...comp.values()].filter((v) => v === id).length;
      return size > a.size ? { id, size } : a;
    }, { id: -1, size: 0 }).id;
    for (const h of inland) {
      expect(doorPaved(kit.state, h), `${name(h)}: no pavement at its door`).toBe(true);
      const strip = gateTerminalCells(objectRect(h), h.rotation);
      const terminal = strip.find((c) => comp.has(c.y * W + c.x))!;
      expect(comp.get(terminal.y * W + terminal.x), `${name(h)}: its doorstep tile is a lone tile, not a street`)
        .toBe(biggest);
    }
  });

  it('a door the rules will NOT pave gets the street beside it, and is named', () => {
    const { kit, seaward } = shoreBench();
    const out = applyMacro(kit, 'roads', { seed: 1, material: 'path-overgrown-dirt', width: 1, trim: 'off' });
    for (const h of seaward) {
      expect(doorPaved(kit.state, h), `${name(h)}: its doorstep is over water, nothing may pave it`).toBe(false);
      // 3 is the geometric floor here: the cabin is 4 deep, its own footprint refuses a coating and
      // the lagoon takes the whole west face, so the nearest legal cell is the corner past its end.
      expect(pavementGap(kit.state, h), `${name(h)}: the street stopped short of the house`).toBeLessThanOrEqual(3);
    }
    expect(out.code, 'a door no run can pave is named').toBe('door-unreachable');
    expect(out.at, 'and named AT the door').toBeDefined();
  });

  it('the press removes nothing that was standing', () => {
    const { kit } = shoreBench();
    const before = [...kit.state.objects.values()].map((o) => o.id);
    applyMacro(kit, 'roads', { seed: 1, material: 'path-overgrown-dirt', width: 1, trim: 'off' });
    for (const id of before) expect(kit.state.objects.has(id), `${id} was removed by the press`).toBe(true);
  });
});
