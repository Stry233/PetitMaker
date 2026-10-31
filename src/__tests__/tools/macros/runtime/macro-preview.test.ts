/** A macro preview shows exactly what a press would do and writes nothing to the live map. */
import { placeObjectCommand } from '../../../../core/model/command-build';
import { describe, expect, it } from 'vitest';
import { makeState, makeExecutor } from '../../../_support/map-state';
import { type GridState } from '../../../../core/model/types';
import { CellZone } from '../../../../core/game/zones';
import { applyMacro } from '../../../../tools/macros';
import { generateObjectId } from '../../../../core/model/object-id';
import { previewMacro } from '../../../../tools/macros/runtime/preview';
import type { EditContext } from '../../../../core/commands/edit-context';

const SIZE = 40;

function kit(): EditContext {
  const state = makeState(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const cell = state.cells[y]![x]!;
    cell.zone = (x < 3 || y < 3 || x >= SIZE - 3 || y >= SIZE - 3) ? CellZone.Void : CellZone.Grass;
  }
  const executor = makeExecutor(state);
  return { state, executor, registry: executor.getRegistry() };
}

const fingerprint = (s: GridState): string => s.cells
  .map((row) => row.map((c) => `${c.terrain?.type ?? '-'}${c.terrain?.elevation ?? 0}`).join()).join('|');

describe('a macro preview', () => {
  it('distinguishes maps with matching version counters and invalidates when locks change', () => {
    const first = kit(), second = kit(), opts = { seed: 1, from: { x: 10, y: 20 }, at: { x: 30, y: 20 } };
    second.state.lockedLayers.add(0);
    expect(previewMacro(first, 'stream', opts).valid).toBe(true);
    expect(previewMacro(second, 'stream', opts).valid).toBe(false);
    first.state.lockedLayers.add(0);
    expect(previewMacro(first, 'stream', opts).valid).toBe(false);
    first.state.lockedLayers.clear();
    expect(previewMacro(first, 'stream', opts).valid).toBe(true);
  });

  it('names cells, and writes nothing to the map', () => {
    const ctx = kit();
    const before = fingerprint(ctx.state);
    const depth = ctx.executor.historyDepth();

    const cells = previewMacro(ctx, 'raise', { seed: 3, at: { x: 20, y: 20 } }).added;

    expect(cells.length).toBeGreaterThan(0);
    expect(fingerprint(ctx.state)).toBe(before);
    expect(ctx.executor.historyDepth()).toBe(depth);
  });

  /** The preview runs the committed macro (`applyMacro`) on a detached copy, so it cannot drift. */
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

  /** Post-stroke rules can revert commands that passed pre-command validation (a stream that never
   *  reaches water), so the preview counts cells that differ after the commit, not commands. */
  it.each(['raise', 'stream', 'patch-tree', 'patch-flora'] as const)('%s previews exactly what it lays', (id) => {
    const at = { x: 20, y: 20 };
    const shown = previewMacro(kit(), id, { seed: 5, at }).added;
    const laid = kit();
    const outcome = applyMacro(laid, id, { seed: 5, at });
    expect(shown.length).toBe(outcome.changes);
  });

  it('is empty for an aim macro with nowhere aimed', () => {
    expect(previewMacro(kit(), 'raise', { seed: 1 }).added).toEqual([]);
  });

  /** A road-link run widening over a standing road replaces its coating even at the same material
   *  (`widenRoads` strips, then places), and the preview's `removed` names those cells. */
  it('the preview reports what the press would replace', () => {
    const road = (state: GridState): void => {
      const executor = makeExecutor(state);
      for (let x = 15; x <= 25; x++) {
        const obj = { id: generateObjectId(), catalogId: 'path-cobblestone', position: { x, y: 15 }, rotation: 0 as const, elevation: 0 };
        expect(executor.execute(placeObjectCommand(obj)).success, `road tile @${x},15`).toBe(true);
      }
    };
    const opts = { seed: 1, from: { x: 20, y: 6 }, at: { x: 20, y: 32 }, width: 3, material: 'path-cobblestone' };
    const sortKey = (c: { x: number; y: number }): string => `${c.x},${c.y}`;

    const previewed = kit();
    road(previewed.state);
    const preview = previewMacro(previewed, 'road-link', opts);
    // Which cells are replaced is the router's choice; the preview and a real press must agree.
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
    expect(removedByPreview).toEqual(removedForReal);
  });

  it('names each cell on the grid it lies on', () => {
    const roads = (ctx: EditContext): void => {
      for (let y = 3; y < SIZE - 3; y++) {
        const obj = { id: generateObjectId(), catalogId: 'path-cobblestone', position: { x: 20, y }, rotation: 0 as const, elevation: 0 };
        expect(ctx.executor.execute(placeObjectCommand(obj)).success).toBe(true);
      }
    };
    const stream = previewMacro(kit(), 'stream', { seed: 1, from: { x: 10, y: 20 }, at: { x: 30, y: 20 } });
    expect(stream.added.length).toBeGreaterThan(0);
    expect(stream.added.every((c) => c.grid === 'terrain')).toBe(true);
    // A road across the whole map stops the stream; what refused it is named on the terrain grid.
    const walled = kit();
    roads(walled);
    const refused = previewMacro(walled, 'stream', { seed: 1, from: { x: 10, y: 20 }, at: { x: 30, y: 20 } });
    expect(refused.blocked.length).toBeGreaterThan(0);
    expect(refused.blocked.every((c) => c.grid === 'terrain')).toBe(true);
    // The road tiles a link replaces are named where they stand, on the object grid.
    const crossed = kit();
    for (let x = 15; x <= 25; x++) {
      const obj = { id: generateObjectId(), catalogId: 'path-cobblestone', position: { x, y: 15 }, rotation: 0 as const, elevation: 0 };
      expect(crossed.executor.execute(placeObjectCommand(obj)).success).toBe(true);
    }
    const link = previewMacro(crossed, 'road-link', { seed: 1, from: { x: 20, y: 6 }, at: { x: 20, y: 32 }, width: 3, material: 'path-cobblestone' });
    expect(link.removed.length).toBeGreaterThan(0);
    for (const c of link.removed) expect(c).toEqual({ x: c.x, y: 15, grid: 'object' });
  });
});
