/**
 * DOES A MACRO WORK ON A MAP SOMEONE ACTUALLY HAS?
 *
 * `macro-quality.test.ts` asks whether a macro's RESULT is designed rather than computed, and it
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
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { makeState } from '../../rules/_helpers';
import { createDefaultRegistry } from '../../../rules';
import { roadLookup } from '../../../state/object-index';
import { clearAllObjects, generateTerrain } from '../../../tools/generation/terrain-generator';
import {
  CellZone, CommandType,
  type Command, type EditorEvents, type GenerateConfig, type MacroCoord,
} from '../../../core/model/types';
import { applyMacro, MACRO_IDS, type MacroId } from '../../../tools/macros';
import { generateObjectId } from '../../../core/model/object-id';
import { surfaceElevation } from '../../../core/edge-cut/terrain-silhouette';

const SIZE = 96;

function reach(seed: number, maxElevation: number): Record<MacroId, number> {
  const state = makeState(SIZE, SIZE);
  const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
  const config: GenerateConfig = { algorithm: 'designed', mode: 'mixed', corridorWidth: 1, maxElevation, seed, region: null };
  exec.runSilently(() => {
    generateTerrain(config, state, (c: Command) => exec.execute(c), exec.getRegistry());
    // TERRAIN ONLY: the planet generator furnishes what it builds, and this fixture is
    // about relief. What stands on it is the case's own subject, planted or laid below.
    clearAllObjects(state, (c: Command) => exec.execute(c));
  });
  exec.commitStrokeGroup(exec.getUndoStackSize());

  // A PERSON'S MAP HAS THINGS STANDING ON IT, and for `roads` that is the whole question: it connects
  // what is there, so on bare terrain its honest answer is that there is nothing to connect. It used
  // to build on bare terrain anyway by spending its scenic-crossing budget — bridges and ramps at
  // fords nobody could reach — so the reach measured litter rather than the verb.
  const stalls: MacroCoord[] = [];
  for (let y = 8; y < SIZE - 8 && stalls.length < 8; y += 11) {
    for (let x = 8; x < SIZE - 8 && stalls.length < 8; x += 11) {
      const cell = state.cells[y]![x]!;
      if (cell.zone !== CellZone.Grass || cell.terrain) continue;
      const obj = { id: generateObjectId(), catalogId: 'building-stall', position: { x, y }, rotation: 0 as const, elevation: 0 };
      if (exec.execute({ type: CommandType.PlaceObject, timestamp: 1, object: obj, loadValue: 0 }).success) stalls.push({ x, y });
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
      // A stream needs somewhere to fall FROM, so flat ground is not a fair place to ask it.
      const raised = surfaceElevation(cell.terrain) >= 1;
      for (const id of MACRO_IDS) {
        if (id === 'stream' && !raised) continue;
        tried[id]!++;
        const before = exec.getUndoStackSize();
        let changes = 0;
        try { changes = applyMacro(kit as never, id, { seed: tried[id]!, at: { x, y } }).changes; } catch { changes = 0; }
        if (changes > 0) built[id]!++;
        while (exec.getUndoStackSize() > before) exec.undo();
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
   *
   * THE STREAM IS THE ONE WHOSE RATE IS THE GROUND'S, not the macro's. Its honesty rule reverts a course
   * whole where it cannot walk downhill all the way to open water, because half a stream on a hillside is
   * worse than none: on organic relief that refuses about half of all aims, while the planet generator's
   * terraced plates step down to the coast, so from nearly anywhere on them there IS a way down.
   */
  it.each(['raise', 'stream', 'roads', 'patch-tree', 'patch-flora'] as const)('%s builds nearly everywhere it is aimed', (id) => {
    expect(rates[id]).toBeGreaterThan(0.8);
  });
}, 300_000);
