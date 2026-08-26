/**
 * A PREVIEW SHOWS WHAT A PRESS WOULD DO, AND DOES NOTHING.
 *
 * The two halves are equally load-bearing. If it showed the wrong shape, aiming would be worse than
 * not aiming; if it wrote to the live map, a pointer moving across the island would leave a trail
 * of half-built mounds nobody asked for.
 */
import { describe, expect, it } from 'vitest';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { makeState } from '../../rules/_helpers';
import { createDefaultRegistry } from '../../../rules';
import { roadLookup } from '../../../state/object-index';
import { CellZone, type EditorEvents, type GridState } from '../../../core/model/types';
import { applyMacro } from '../../../tools/macros';
import { objectPlacementCommand } from '../../../tools/objects/object-placer';
import { generateObjectId } from '../../../core/model/object-id';
import { previewMacro } from '../../../tools/macros/preview';
import type { KitContext } from '../../../kit/context';

const SIZE = 40;

function kit(): KitContext {
  const state = makeState(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const cell = state.cells[y]![x]!;
    cell.zone = (x < 3 || y < 3 || x >= SIZE - 3 || y >= SIZE - 3) ? CellZone.Void : CellZone.Grass;
  }
  const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
  return { state, executor, registry: executor.getRegistry() };
}

const fingerprint = (s: GridState): string => s.cells
  .map((row) => row.map((c) => `${c.terrain?.type ?? '-'}${c.terrain?.elevation ?? 0}`).join()).join('|');

describe('a macro preview', () => {
  it('names cells, and writes nothing to the map', () => {
    const ctx = kit();
    const before = fingerprint(ctx.state);
    const depth = ctx.executor.getUndoStackSize();

    const cells = previewMacro(ctx, 'raise', { seed: 3, at: { x: 20, y: 20 } }).added;

    expect(cells.length).toBeGreaterThan(0);
    // The live map is untouched: no cells, and no history for an undo to find.
    expect(fingerprint(ctx.state)).toBe(before);
    expect(ctx.executor.getUndoStackSize()).toBe(depth);
  });

  /** The whole point: the shape shown is the shape laid. A preview built from a second copy of the
   *  design would drift from it silently, which is why `buildMacro` is shared. */
  it('names the cells the press actually changes', () => {
    const seen = kit();
    const shown = new Set(previewMacro(seen, 'raise', { seed: 9, at: { x: 20, y: 20 } }).added.map((c) => `${c.x},${c.y}`));

    const laid = kit();
    applyMacro(laid, 'raise', { seed: 9, at: { x: 20, y: 20 } });
    const changed = new Set<string>();
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      if ((laid.state.cells[y]![x]!.terrain?.elevation ?? 0) > 0) changed.add(`${x},${y}`);
    }

    expect(changed.size).toBeGreaterThan(0);
    for (const key of changed) expect(`shown:${key}:${shown.has(key)}`).toBe(`shown:${key}:true`);
  });

  /**
   * THE STRONGEST FORM OF "the shape shown is the shape laid": for each macro, on the same map and
   * the same seed, the preview's cell count is what the press reports changing.
   *
   * It also catches the fidelity trap that this file's first version fell into. `runOnScratch`
   * returns the commands PRE-command validation accepted, and the post-stroke rules can revert all
   * of them afterwards — the stream's own rule reverts a course that never reaches water. Measuring
   * the preview from the commands drew shapes the press would not build; measuring it after the
   * commit, from the cells that actually differ, is what makes the two agree.
   */
  it.each(['raise', 'stream', 'patch-tree', 'patch-flora'] as const)('%s previews exactly what it lays', (id) => {
    const at = { x: 20, y: 20 };
    const shown = previewMacro(kit(), id, { seed: 5, at }).added;
    const laid = kit();
    const outcome = applyMacro(laid, id, { seed: 5, at });
    expect(shown.length).toBe(outcome.changes);
  });

  /** An aim macro with no aim is not previewable, and must not throw at a caller that asks. */
  it('is empty for an aim macro with nowhere aimed', () => {
    expect(previewMacro(kit(), 'raise', { seed: 1 }).added).toEqual([]);
  });

  /**
   * THE GHOST SHOWS LOSSES, NOT JUST GAINS. A road-link run that widens over a standing road
   * replaces its coating (`widenRoads` strips-then-places even where the material matches, since
   * two overlapping coatings can never legally be the same object): the preview's `removed` names
   * exactly those cells, and a real press removes exactly them.
   */
  it('the preview reports what the press would replace', () => {
    const road = (state: GridState): void => {
      const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
      for (let x = 15; x <= 25; x++) {
        const obj = { id: generateObjectId(), catalogId: 'path-cobblestone', position: { x, y: 15 }, rotation: 0 as const, elevation: 0 };
        expect(executor.execute(objectPlacementCommand(obj)).success, `road tile @${x},15`).toBe(true);
      }
    };
    const opts = { seed: 1, from: { x: 20, y: 6 }, at: { x: 20, y: 32 }, width: 3, material: 'path-cobblestone' };
    const sortKey = (c: { x: number; y: number }): string => `${c.x},${c.y}`;

    const previewed = kit();
    road(previewed.state);
    const preview = previewMacro(previewed, 'road-link', opts);
    // The route crosses the standing line and `width: 3` dilates over it, so widening REPLACES
    // (strips-then-places) some of what was already there, even at the same material — two
    // overlapping coatings can never legally be one object. Exactly which cells is the router's
    // own business (a route with the map's own street nearby may reasonably detour to reuse it);
    // what this pins is that the preview's `removed` and a real press's actual removal AGREE.
    expect(preview.removed.length, 'the run replaces at least one standing tile').toBeGreaterThan(0);
    const removedByPreview = [...preview.removed].map(sortKey).sort();

    const pressed = kit();
    road(pressed.state);
    const beforePositions = new Map([...pressed.state.objects].map(([id, o]) => [id, o.position]));
    const outcome = applyMacro(pressed, 'road-link', opts);
    expect(outcome.changes).toBeGreaterThan(0);
    const removedForReal = [...beforePositions]
      .filter(([id]) => !pressed.state.objects.has(id))
      .map(([, pos]) => sortKey(pos))
      .sort();
    // Both readings agree on WHICH original tiles vanished — the ghost's mirror walk is not a
    // second, drifting count.
    expect(removedByPreview).toEqual(removedForReal);
  });
});
