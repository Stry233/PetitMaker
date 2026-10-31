/**
 * A macro's reach on a generated planet rather than the clean cone of `macro-quality.test.ts`: each
 * macro is aimed at grass cells on a grid and the share that built anything is counted. Ground a
 * macro silently declines looks to a person like a button that does not work.
 */
import { describe, expect, it } from 'vitest';
import { makeState, makeExecutor } from '../../_support/map-state';
import { clearAllObjects } from '../../../tools/generation';
import { CommandType, type Command, type MacroCoord } from '../../../core/model/types';
import { defaultConfig, type GenerateConfig } from '../../../tools/generation/recipe';
import { CellZone } from '../../../core/game/zones';
import { applyMacro, MACRO_IDS, type MacroId } from '../../../tools/macros';
import { generateObjectId } from '../../../core/model/object-id';
import { generateWith } from '../../_support/generation';

const SIZE = 96;

function reach(seed: number, maxElevation: number): Record<MacroId, number> {
  const state = makeState(SIZE, SIZE);
  const exec = makeExecutor(state);
  const config: GenerateConfig = defaultConfig('designed', { maxElevation, seed });
  exec.transaction({ silent: true }, () => {
    generateWith(state, exec, config);
    // Terrain only: the objects are this case's own, placed below.
    clearAllObjects({ state, execute: (c: Command) => exec.execute(c) });
  });
  exec.beginStroke().commit();

  // `roads` connects what stands on the map, so bare terrain gives it nothing to connect.
  const stalls: MacroCoord[] = [];
  for (let y = 8; y < SIZE - 8 && stalls.length < 8; y += 11) {
    for (let x = 8; x < SIZE - 8 && stalls.length < 8; x += 11) {
      const cell = state.cells[y]![x]!;
      if (cell.zone !== CellZone.Grass || cell.terrain) continue;
      const obj = { id: generateObjectId(), catalogId: 'building-stall', position: { x, y }, rotation: 0 as const, elevation: 0 };
      if (exec.execute({ type: CommandType.PlaceObject, object: obj }).success) stalls.push({ x, y });
    }
  }
  expect(stalls.length, 'the planet had nowhere to stand a stall').toBeGreaterThan(2);

  const kit = { state, executor: exec, registry: exec.getRegistry() };
  const tried: Record<string, number> = {};
  const built: Record<string, number> = {};
  for (const id of MACRO_IDS) { tried[id] = 0; built[id] = 0; }

  for (let y = 6; y < SIZE - 6; y += 5) {
    for (let x = 6; x < SIZE - 6; x += 5) {
      const cell = state.cells[y]![x]!;
      if (cell.zone !== CellZone.Grass) continue;
      for (const id of MACRO_IDS) {
        // A river is a drag between two points (`landforms.test.ts`), not a press at one.
        if (id === 'stream') continue;
        tried[id]!++;
        const before = exec.historyDepth();
        let changes = 0;
        try { changes = applyMacro(kit as never, id, { seed: tried[id]!, at: { x, y } }).changes; } catch { changes = 0; }
        if (changes > 0) built[id]!++;
        while (exec.historyDepth() > before) exec.undo();
      }
    }
  }
  return Object.fromEntries(MACRO_IDS.map((id) => [id, tried[id] ? built[id]! / tried[id]! : 0])) as Record<MacroId, number>;
}

describe('a macro reaches the map a person has', () => {
  const rates = reach(7, 8);

  /** Observed rates run 82 to 100 per cent. */
  it.each(['raise', 'roads', 'patch-tree', 'patch-flora'] as const)('%s builds nearly everywhere it is aimed', (id) => {
    expect(rates[id]).toBeGreaterThan(0.8);
  });
}, 300_000);
