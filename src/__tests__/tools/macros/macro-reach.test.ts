/**
 * Does a macro work on a map someone actually has?
 *
 * `macro-quality.test.ts` asks whether a macro's result is designed rather than computed, and it
 * asks it of a fixture built for the purpose: a clean cone with a shore all round. That is the
 * right shape for those questions and the wrong one for this: a macro that only works on the
 * fixture is a macro that works nowhere, and nothing here was measuring that.
 *
 * So this generates a real planet and asks each macro at every grass cell on a grid across it, then
 * counts how often it built anything. The number is the feature's reach, and a low one is not a
 * tuning matter: aiming at ground the macro silently declines is indistinguishable, from the other
 * side of the screen, from a button that does not work.
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
    // Terrain only: the planet generator furnishes what it builds, and this fixture is
    // about relief. What stands on it is the case's own subject, planted or laid below.
    clearAllObjects({ state, execute: (c: Command) => exec.execute(c) });
  });
  exec.beginStroke().commit();

  // A person's map has things standing on it, and for `roads` that is the whole question: it connects
  // what is there, so on bare terrain its honest answer is that there is nothing to connect. It used
  // to build on bare terrain anyway by spending its scenic-crossing budget — bridges and ramps at
  // fords nobody could reach — so the reach measured litter rather than the verb.
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

  /**
   * Every one of them lands almost everywhere it is asked. The floor sits below the observed 82 to
   * 100 per cent range and guards reachability rather than an exact generator rate.
   */
  it.each(['raise', 'roads', 'patch-tree', 'patch-flora'] as const)('%s builds nearly everywhere it is aimed', (id) => {
    expect(rates[id]).toBeGreaterThan(0.8);
  });
}, 300_000);
