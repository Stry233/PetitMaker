/**
 * Every hand-run stroke group, pinned by what it leaves behind: the map, the undo stack, the events
 * it emits, the authorship its commands ran under and the authorship stack once it returns. Each
 * caller is driven through success, a refused command, a post-stroke violation and a throw part-way
 * through the stroke.
 */
import { describe, it, expect, afterEach, onTestFinished, vi } from 'vitest';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { CommandType, TerrainType, type Command, type GridState, type MacroCoord, type PlacedObject } from '../../../core/model/types';
import { type EditorEvents } from '../../../state/editing/events';
import { createDefaultRegistry } from '../../../rules/index';
import { mapFingerprint } from '../../../core/model/fingerprint';
import { landMacroRun, type MacroBuild } from '../../../tools/macros/run';
import { runStroke, runStrokeBody } from '../../../agent/tools/stroke';
import type { AgentToolDeps } from '../../../agent/tools';
import { clearGenerated, generateMap } from '../../../editor/operations/generate';
import { runCandidateOn } from '../../../tools/generation/run/generation-run';
import type { Candidate } from '../../../tools/generation/run/candidates';
import { createGridState, holdsTemplateTerrain } from '../../../core/model/template';
import { getMapTemplate } from '../../../config/maps';
import { removeObject, rotateObject, peelTerrain } from '../../../tools/objects/actions';
import { moveGroup } from '../../../tools/objects/group-actions';
import { EditorAPI } from '../../../editor/dev/editor-api';
import { buildTransfer } from '../../../tools/generation/transfer';
import { ProvSource } from '../../../core/provenance/types';
import { makeState } from '../../_support/map-state';
import { useEditorStore } from '../../../state/store';
import { newMap } from '../../../editor/operations/map';
import { editorPort } from '../../../editor/session/context';
import { enterPlanetSession, leavePlanetSession, rotateSessionLandmark } from '../../../editor/operations/planet-session';
import { placeSessionLandmark, removeSessionLandmark } from '../../_support/session-landmarks';
import { host } from '../../../editor/host/host';
import { CellZone } from '../../../core/game/zones';
import { ANCHOR_LANDMARK } from '../../_support/anchor';
import { createExecutor } from '../../../state/executor';
import { defaultConfig } from '../../../tools/generation/recipe';

const EVENTS = ['cells-changed', 'objects-changed', 'validation-failed', 'history-changed', 'history-applied'] as const;

/** A 20x20 open map, its executor, and a recorder of what the executor emits. */
function world(size = 20) {
  const state = makeState(size, size);
  const bus = new EventBus<EditorEvents>();
  const executor = createExecutor(state, createDefaultRegistry(), bus);
  const events: string[] = [];
  for (const name of EVENTS) bus.on(name, () => { events.push(name); });
  return { state, bus, executor, events };
}

/** Consecutive repeats folded to `name*n`, so a sequence reads at a glance. */
function runs(events: string[]): string {
  const out: string[] = [];
  for (let i = 0; i < events.length;) {
    let j = i;
    while (j < events.length && events[j] === events[i]) j++;
    out.push(j - i > 1 ? `${events[i]}*${j - i}` : events[i]!);
    i = j;
  }
  return out.join(' ');
}

const realExecute = CommandExecutor.prototype.execute;

/**
 * Records the authorship each executed command ran under and throws on the `throwAt`-th execute
 * (1-based), counted across every executor.
 */
function instrument(throwAt = 0): { sources: Set<string> } {
  const sources = new Set<string>();
  let n = 0;
  vi.spyOn(CommandExecutor.prototype, 'execute').mockImplementation(function (this: CommandExecutor, cmd: Command) {
    n++;
    if (n === throwAt) throw new Error('execute fault');
    sources.add(ProvSource[this.getAuthorship().currentSource().source]);
    return realExecute.call(this, cmd);
  });
  return { sources };
}

afterEach(() => { vi.restoreAllMocks(); });

const mountain = (x: number, y: number): Command => ({
  type: CommandType.PaintTerrain, cells: [{ x, y }], terrainType: TerrainType.Mountain, elevation: 1,
});
/** Water at layer 1 with nothing under it: legal to apply, a post-stroke violation once committed. */
const floatingWater = (x: number, y: number): Command => ({
  type: CommandType.PaintTerrain, cells: [{ x, y }], terrainType: TerrainType.Water, elevation: 1,
});
const lockedPlaza = (): PlacedObject => ({
  id: ANCHOR_LANDMARK.id, catalogId: ANCHOR_LANDMARK.id, position: { x: 14.5, y: 14.5 }, width: 3, height: 3,
  rotation: 0, elevation: 0, locked: true,
});
/** Removing the locked plaza: V-LOCK-02 refuses it. */
const refused = (): Command => ({
  type: CommandType.RemoveObject, objectId: ANCHOR_LANDMARK.id,
});
const house = (id: string, x: number, y: number): PlacedObject => ({
  id, catalogId: 'building-cabin', position: { x, y }, rotation: 0, elevation: 0,
});

/** What a stroke left behind. */
function after(w: ReturnType<typeof world>, sources?: Set<string>) {
  return {
    events: runs(w.events),
    undo: w.executor.historyDepth(),
    stack: ProvSource[w.executor.getAuthorship().currentSource().source],
    ...(sources ? { ran: [...sources].sort().join(',') } : {}),
  };
}

const terrainAt = (s: GridState, x: number, y: number) => s.cells[y]![x]!.terrain?.type ?? null;

type World = ReturnType<typeof world>;

const build = (commands: Command[]): MacroBuild => ({ run: { commands, base: '' } });
const land = (w: World, commands: Command[], atomic: boolean) =>
  landMacroRun(
    { state: w.state, executor: w.executor, registry: w.executor.getRegistry() },
    atomic ? 'stream' : 'raise', { seed: 1, ...(atomic ? { from: { x: 5, y: 5 }, at: { x: 8, y: 5 } } : {}) }, build(commands), { trustBase: true },
  );

const deps = (w: World, region: MacroCoord[] = []) => ({
  getState: () => w.state, getExecutor: () => w.executor, getRegion: () => region,
} as unknown as AgentToolDeps);

const ctx = (w: World) => ({ state: w.state, executor: w.executor, registry: w.executor.getRegistry() });
const candidate = (w: World, commands: Command[]): Candidate => ({
  state: w.state,
  outcome: { cells: [], placed: commands.length, removedCells: 0, removedObjects: 0, violations: [], cancelled: false },
  commands,
  config: defaultConfig('designed', { maxElevation: 4, seed: 1, richness: 1 }),
  region: null,
  base: mapFingerprint(w.state),
});
const replay = (w: World, commands: Command[]) =>
  generateMap(ctx(w), { config: candidate(w, []).config, region: null, candidate: candidate(w, commands) });

/** A mountain at (5, 5), then a second command; each caller runs that pair its own way. */
const PAIR = { mountain: mountain(5, 5), second: mountain(7, 7), floating: floatingWater(5, 8) };

describe('every caller, on a throw part-way through the stroke', () => {
  it.each<[string, (w: World) => unknown]>([
    ['landMacroRun', (w) => land(w, [PAIR.mountain, PAIR.second], false)],
    ['runStroke', (w) => runStroke(deps(w), [PAIR.mountain, PAIR.second], (n) => `ok ${n}`)],
    ['runStrokeBody', (w) => runStrokeBody(deps(w), 'the edit', () => { w.executor.execute(PAIR.mountain); w.executor.execute(PAIR.second); })],
    ['generateMap', (w) => replay(w, [PAIR.mountain, PAIR.second])],
  ])('%s rolls back and rethrows', async (_caller, run) => {
    const w = world();
    instrument(2);
    await expect((async () => run(w))()).rejects.toThrow('execute fault');
    expect(terrainAt(w.state, 5, 5)).toBeNull();
    expect(after(w)).toEqual({ events: 'cells-changed history-changed cells-changed history-changed', stack: 'Human', undo: 0 });
  });
});

describe('every caller, on a post-stroke violation outside an atomic run', () => {
  it.each<[string, (w: World) => Promise<void> | void]>([
    ['landMacroRun', (w) => {
      expect(land(w, [PAIR.mountain, PAIR.floating], false)?.reason).toBe('post-stroke rules rolled part of the run back');
    }],
    ['runStroke, from inside afterApply', (w) => {
      let inside = -1;
      const res = runStroke(deps(w), [PAIR.mountain], (n) => `ok ${n}`, { afterApply: (exec) => {
        inside = exec.historyDepth();
        exec.execute(PAIR.floating);
      } });
      expect(inside, 'afterApply runs inside the stroke').toBe(1);
      expect(res.detail).toMatchObject({ reverted: true, partialRevert: true });
    }],
    ['generateMap', async (w) => {
      expect((await replay(w, [PAIR.mountain, PAIR.floating])).violations.length).toBeGreaterThan(0);
    }],
  ])('%s keeps what the revert spares', async (_caller, run) => {
    const w = world();
    await run(w);
    expect(terrainAt(w.state, 5, 5)).toBe(TerrainType.Mountain);
    expect(terrainAt(w.state, 5, 8)).toBeNull();
    expect(after(w)).toEqual({
      events: 'cells-changed history-changed cells-changed history-changed cells-changed history-changed', stack: 'Human', undo: 1,
    });
  });
});

describe('landMacroRun', () => {

  it('keeps the partial build when a command is refused outside an atomic run', () => {
    const w = world();
    w.state.objects.set(ANCHOR_LANDMARK.id, lockedPlaza());
    const { sources } = instrument();
    const out = land(w, [mountain(5, 5), refused(), mountain(7, 7)], false);
    expect(out?.changes).toBe(2);
    expect(terrainAt(w.state, 7, 7)).toBe(TerrainType.Mountain);
    expect(after(w, sources)).toMatchInlineSnapshot(`
      {
        "events": "cells-changed history-changed cells-changed history-changed",
        "ran": "Procedural",
        "stack": "Human",
        "undo": 1,
      }
    `);
  });

  it('rolls an atomic run back at its first refused command', () => {
    const w = world();
    w.state.objects.set(ANCHOR_LANDMARK.id, lockedPlaza());
    const { sources } = instrument();
    const out = land(w, [mountain(5, 5), refused(), mountain(7, 7)], true);
    expect(out?.changes).toBe(0);
    expect(terrainAt(w.state, 5, 5)).toBeNull();
    expect(after(w, sources)).toMatchInlineSnapshot(`
      {
        "events": "cells-changed history-changed cells-changed history-changed",
        "ran": "Procedural",
        "stack": "Human",
        "undo": 0,
      }
    `);
  });

  it('rolls an atomic run back whole on a post-stroke violation', () => {
    const w = world();
    const out = land(w, [mountain(5, 5), floatingWater(5, 8)], true);
    expect(out?.changes).toBe(0);
    expect(terrainAt(w.state, 5, 5)).toBeNull();
    expect(after(w)).toMatchInlineSnapshot(`
      {
        "events": "cells-changed history-changed cells-changed history-changed cells-changed history-changed cells-changed history-changed",
        "stack": "Human",
        "undo": 0,
      }
    `);
  });
});

describe('agent stroke runners', () => {
  const region = (): MacroCoord[] => {
    const out: MacroCoord[] = [];
    for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) out.push({ x, y });
    return out;
  };

  it('runStroke keeps the accepted commands beside a refusal', () => {
    const w = world();
    w.state.objects.set(ANCHOR_LANDMARK.id, lockedPlaza());
    const { sources } = instrument();
    const res = runStroke(deps(w), [mountain(5, 5), refused(), mountain(7, 7)], (n) => `ok ${n}`);
    expect(res.isError).toBe(true);
    expect(terrainAt(w.state, 7, 7)).toBe(TerrainType.Mountain);
    expect(after(w, sources)).toMatchInlineSnapshot(`
      {
        "events": "cells-changed history-changed cells-changed history-changed",
        "ran": "AiWrite",
        "stack": "Human",
        "undo": 1,
      }
    `);
  });

  it('runStroke rolls the whole call back when a command leaves the region', () => {
    const w = world();
    const res = runStroke(deps(w, region()), [mountain(5, 5), mountain(15, 15), mountain(6, 6)], (n) => `ok ${n}`);
    expect(res.detail).toMatchObject({ regionBlocked: true });
    expect(terrainAt(w.state, 5, 5)).toBeNull();
    expect(after(w)).toMatchInlineSnapshot(`
      {
        "events": "cells-changed history-changed cells-changed history-changed cells-changed history-changed",
        "stack": "Human",
        "undo": 0,
      }
    `);
  });

  it('runStrokeBody keeps a refused command out and silences its toast', async () => {
    const w = world();
    w.state.objects.set(ANCHOR_LANDMARK.id, lockedPlaza());
    const { sources } = instrument();
    const res = await runStrokeBody(deps(w), 'the edit', () => {
      w.executor.execute(mountain(5, 5));
      w.executor.execute(refused());
      return 'done';
    });
    expect(res).toEqual({ result: 'done', detail: { cells: 1 } });
    expect(after(w, sources)).toMatchInlineSnapshot(`
      {
        "events": "cells-changed history-changed",
        "ran": "AiWrite",
        "stack": "Human",
        "undo": 1,
      }
    `);
  });

  it('runStrokeBody rolls back an out-of-region body', async () => {
    const w = world();
    const res = await runStrokeBody(deps(w, region()), 'the edit', async () => {
      w.executor.execute(mountain(5, 5));
      await Promise.resolve();
      w.executor.execute(mountain(15, 15));
    });
    expect('refusal' in res && res.refusal.detail?.regionBlocked).toBe(true);
    expect(terrainAt(w.state, 5, 5)).toBeNull();
    expect(after(w)).toMatchInlineSnapshot(`
      {
        "events": "cells-changed history-changed cells-changed history-changed cells-changed history-changed",
        "stack": "Human",
        "undo": 0,
      }
    `);
  });

  it('runStrokeBody reports a post-stroke revert', async () => {
    const w = world();
    const res = await runStrokeBody(deps(w), 'the edit', () => { w.executor.execute(floatingWater(5, 8)); });
    expect('refusal' in res && res.refusal.detail?.reverted).toBe(true);
    expect(after(w)).toMatchInlineSnapshot(`
      {
        "events": "cells-changed history-changed cells-changed history-changed",
        "stack": "Human",
        "undo": 0,
      }
    `);
  });
});

describe('generation landing and clearing', () => {
  it('generateMap replays a candidate, keeping the commands that land beside a refused one', async () => {
    const w = world();
    const { sources } = instrument();
    const out = await generateMap(
      ctx(w), { config: candidate(w, []).config, region: null, candidate: candidate(w, [mountain(5, 5), floatingWater(-3, -3), mountain(7, 7)]) },
    );
    expect(out.cancelled).toBe(false);
    expect(terrainAt(w.state, 7, 7)).toBe(TerrainType.Mountain);
    expect(after(w, sources)).toMatchInlineSnapshot(`
      {
        "events": "cells-changed history-changed cells-changed history-changed cells-changed history-changed",
        "ran": "Procedural",
        "stack": "Human",
        "undo": 1,
      }
    `);
  });

  it('clearGenerated takes procedural work and spares the person\'s', () => {
    const w = world();
    w.executor.transaction({ source: { source: ProvSource.Procedural } }, () => {
      const s = w.executor.beginStroke();
      w.executor.execute(mountain(5, 5));
      s.commit();
    });
    const s = w.executor.beginStroke();
    w.executor.execute(mountain(7, 7));
    s.commit();
    w.events.length = 0;
    const { sources } = instrument();
    const out = clearGenerated(ctx(w), { region: null });
    expect(out.removedCells).toBe(1);
    expect(terrainAt(w.state, 7, 7)).toBe(TerrainType.Mountain);
    expect(after(w, sources)).toMatchInlineSnapshot(`
      {
        "events": "cells-changed history-changed",
        "ran": "Procedural",
        "stack": "Human",
        "undo": 3,
      }
    `);
  });

  it('clearGenerated rolls back and rethrows when an erase throws', () => {
    const w = world();
    w.executor.transaction({ source: { source: ProvSource.Procedural } }, () => {
      const s = w.executor.beginStroke();
      w.executor.execute(mountain(5, 5));
      w.executor.execute({ type: CommandType.PlaceObject, object: house('h1', 10, 10) });
      s.commit();
    });
    w.events.length = 0;
    instrument(2);
    expect(() => clearGenerated(ctx(w), { region: null })).toThrow('execute fault');
    expect(w.state.objects.has('h1'), 'the object removal before the throw is taken back').toBe(true);
    expect(terrainAt(w.state, 5, 5)).toBe(TerrainType.Mountain);
    expect(after(w)).toMatchInlineSnapshot(`
      {
        "events": "objects-changed cells-changed history-changed objects-changed cells-changed history-changed",
        "stack": "Human",
        "undo": 1,
      }
    `);
  });
});

/** Whether any cell of `state` holds other terrain than its template lays there. */
const edited = (state: GridState): boolean =>
  state.cells.some((row, y) => row.some((c, x) => !holdsTemplateTerrain(state.template, x, y, c)));

describe('generation on its copy', () => {
  const config = defaultConfig('designed', { mode: 'mixed' as const, maxElevation: 4, seed: 3, richness: 1 });

  /** Runs `runCandidateOn` on a fresh island, holding on to the executor it builds and the events
   *  that executor's bus emits. */
  async function onCopy(signal: AbortSignal) {
    const state = createGridState(getMapTemplate('hexia'));
    let executor: CommandExecutor | null = null;
    const realTx = CommandExecutor.prototype.transactionAsync;
    vi.spyOn(CommandExecutor.prototype, 'transactionAsync').mockImplementation(function (this: CommandExecutor, opts, body) {
      executor = this;
      return realTx.call(this, opts, body);
    });
    const events: string[] = [];
    const realEmit = EventBus.prototype.emit;
    vi.spyOn(EventBus.prototype, 'emit').mockImplementation(function (this: EventBus<EditorEvents>, name, data) {
      if (executor && this === (executor as unknown as { eventBus: unknown }).eventBus) events.push(String(name));
      return realEmit.call(this, name, data);
    });
    const outcome = runCandidateOn(state, { config, region: null, rules: 'default', signal });
    return { state, outcome, executor: () => executor!, events };
  }

  it('rolls a cancelled run back whole, with nothing left to redo', async () => {
    const run = await onCopy(AbortSignal.abort());
    const { outcome, commands } = await run.outcome;
    const executor = run.executor();
    expect(outcome.cancelled).toBe(true);
    expect(commands).toEqual([]);
    expect(executor.historyDepth()).toBe(0);
    expect(executor.canRedo()).toBe(false);
    expect(ProvSource[executor.getAuthorship().currentSource().source]).toBe('Human');
    expect(run.events, 'no undo replays the half-built run').not.toContain('history-applied');
    expect(edited(run.state), 'the rollback took the build back').toBe(false);
  });

  it('rolls back and rethrows when a command throws mid-generation', async () => {
    instrument(40);
    const run = await onCopy(new AbortController().signal);
    await expect(run.outcome).rejects.toThrow('execute fault');
    const executor = run.executor();
    expect(executor.historyDepth()).toBe(0);
    expect(executor.canRedo()).toBe(false);
    expect(ProvSource[executor.getAuthorship().currentSource().source]).toBe('Human');
    expect(edited(run.state)).toBe(false);
    expect(run.events.slice(-2)).toEqual(['cells-changed', 'history-changed']);
  });
});

describe('single-object actions', () => {
  it('removeObject commits one step and refuses the locked plaza', () => {
    const w = world();
    w.state.objects.set('h1', house('h1', 6, 6));
    w.state.objects.set(ANCHOR_LANDMARK.id, lockedPlaza());
    const { sources } = instrument();
    expect(removeObject(w.executor, w.state.objects.get('h1')!).ok).toBe(true);
    expect(removeObject(w.executor, w.state.objects.get(ANCHOR_LANDMARK.id)!).ok).toBe(false);
    expect(after(w, sources)).toMatchInlineSnapshot(`
      {
        "events": "objects-changed cells-changed history-changed validation-failed",
        "ran": "Human",
        "stack": "Human",
        "undo": 1,
      }
    `);
  });

  it('rotateObject takes the removal back when the placement throws', () => {
    const w = world();
    const obj = house('h1', 6, 6);
    w.state.objects.set(obj.id, obj);
    instrument(2);
    expect(() => rotateObject(w.executor, w.state, obj, 90, { from: 0, to: 90 })).toThrow('execute fault');
    expect(w.state.objects.get('h1')?.rotation).toBe(0);
    expect(after(w)).toMatchInlineSnapshot(`
      {
        "events": "objects-changed cells-changed history-changed objects-changed cells-changed history-changed",
        "stack": "Human",
        "undo": 0,
      }
    `);
  });

  it('peelTerrain peels one layer as one step', () => {
    const w = world();
    const s = w.executor.beginStroke();
    w.executor.execute(mountain(5, 5));
    s.commit();
    w.events.length = 0;
    expect(peelTerrain(w.executor, 5, 5, w.state.cells[5]![5]!).ok).toBe(true);
    expect(terrainAt(w.state, 5, 5)).toBeNull();
    expect(after(w)).toMatchInlineSnapshot(`
      {
        "events": "cells-changed history-changed",
        "stack": "Human",
        "undo": 2,
      }
    `);
  });
});

describe('group transform', () => {
  it('moves every member as one step with refusals silenced', () => {
    const w = world();
    w.state.objects.set('a', house('a', 4, 4));
    w.state.objects.set('b', house('b', 8, 4));
    const res = moveGroup(w.executor, w.state, ['a', 'b'], { dx: 0, dy: 4 });
    expect(res.moved).toBe(2);
    expect(after(w)).toMatchInlineSnapshot(`
      {
        "events": "objects-changed cells-changed history-changed objects-changed cells-changed history-changed objects-changed cells-changed history-changed objects-changed cells-changed history-changed",
        "stack": "Human",
        "undo": 1,
      }
    `);
  });

  it('rewinds the whole group on a refusal', () => {
    const w = world();
    w.state.objects.set('a', house('a', 4, 4));
    w.state.objects.set(ANCHOR_LANDMARK.id, lockedPlaza());
    const res = moveGroup(w.executor, w.state, ['a', ANCHOR_LANDMARK.id], { dx: 0, dy: 1 });
    expect(res.blockedBy).toBe(ANCHOR_LANDMARK.id);
    expect(w.state.objects.get('a')!.position).toEqual({ x: 4, y: 4 });
    expect(after(w)).toMatchInlineSnapshot(`
      {
        "events": "objects-changed cells-changed history-changed objects-changed cells-changed history-changed",
        "stack": "Human",
        "undo": 0,
      }
    `);
  });

  it('takes the applied removals back when a placement throws', () => {
    const w = world();
    w.state.objects.set('a', house('a', 4, 4));
    w.state.objects.set('b', house('b', 8, 4));
    instrument(3);
    expect(() => moveGroup(w.executor, w.state, ['a', 'b'], { dx: 0, dy: 4 })).toThrow('execute fault');
    expect(w.state.objects.get('a')!.position).toEqual({ x: 4, y: 4 });
    expect(w.state.objects.get('b')!.position).toEqual({ x: 8, y: 4 });
    expect(after(w)).toMatchInlineSnapshot(`
      {
        "events": "objects-changed cells-changed history-changed objects-changed cells-changed history-changed objects-changed*2 cells-changed history-changed",
        "stack": "Human",
        "undo": 0,
      }
    `);
    w.state.objects.set(ANCHOR_LANDMARK.id, lockedPlaza());
    w.executor.execute(refused());
    expect(runs(w.events).endsWith('validation-failed'), 'the silence lifted with the throw').toBe(true);
  });
});

describe('EditorAPI writes', () => {
  const api = (w: ReturnType<typeof world>) => new EditorAPI(() => w.state, () => w.executor);

  it('commits a write as one procedural step and reports a refusal unsilenced', () => {
    const w = world();
    w.state.objects.set(ANCHOR_LANDMARK.id, lockedPlaza());
    const { sources } = instrument();
    expect(api(w).paintTerrain([{ x: 5, y: 5 }], TerrainType.Mountain, 1).success).toBe(true);
    expect(api(w).removeObject(ANCHOR_LANDMARK.id).success).toBe(false);
    expect(after(w, sources)).toMatchInlineSnapshot(`
      {
        "events": "cells-changed history-changed validation-failed",
        "ran": "Procedural",
        "stack": "Human",
        "undo": 1,
      }
    `);
  });

  it('reports a post-stroke revert as a failure', () => {
    const w = world();
    expect(api(w).paintTerrain([{ x: 5, y: 8 }], TerrainType.Water, 1).success).toBe(false);
    expect(after(w)).toMatchInlineSnapshot(`
      {
        "events": "cells-changed history-changed cells-changed history-changed",
        "stack": "Human",
        "undo": 0,
      }
    `);
  });

  it('pops its source when the write throws', () => {
    const w = world();
    instrument(1);
    expect(() => api(w).paintTerrain([{ x: 5, y: 5 }], TerrainType.Mountain, 1)).toThrow('execute fault');
    expect(after(w)).toMatchInlineSnapshot(`
      {
        "events": "",
        "stack": "Human",
        "undo": 0,
      }
    `);
  });
});

describe('buildTransfer', () => {
  it('lands the land and the build as imported work on a detached map', () => {
    const w = world();
    const s = w.executor.beginStroke();
    w.executor.execute(mountain(5, 5));
    w.executor.execute({ type: CommandType.PlaceObject, object: house('h1', 10, 10) });
    s.commit();
    const { sources } = instrument();
    const built = buildTransfer(w.state, w.state.template);
    expect(built.moved).toEqual({ cells: 1, objects: 1 });
    expect(built.violations).toEqual([]);
    expect([...sources].sort().join(',')).toMatchInlineSnapshot(`"Imported"`);
  });

  it('rethrows a fault and leaves the source map alone', () => {
    const w = world();
    const s = w.executor.beginStroke();
    w.executor.execute(mountain(5, 5));
    s.commit();
    const before = mapFingerprint(w.state);
    instrument(1);
    expect(() => buildTransfer(w.state, w.state.template)).toThrow('execute fault');
    expect(mapFingerprint(w.state)).toBe(before);
  });
});

describe('planet-session plaza edits', () => {
  const store = () => useEditorStore.getState();
  /** The live editor in a fresh planet session with open grass to stand the plaza on. */
  function session() {
    localStorage.clear();
    newMap(editorPort, 'hexia');
    enterPlanetSession(editorPort, null);
    const executor = store().commandExecutor!;
    const cells: MacroCoord[] = [];
    for (let y = 10; y < 70; y++) for (let x = 10; x < 70; x++) cells.push({ x, y });
    const s = executor.beginStroke();
    executor.execute({ type: CommandType.PaintTerrain, cells, terrainType: TerrainType.Mountain, elevation: 0, ground: CellZone.Grass });
    s.commit();
    const events: string[] = [];
    const bus = store().eventBus;
    const offs = EVENTS.map((name) => { const fn = () => { events.push(name); }; bus.on(name, fn); return () => bus.off(name, fn); });
    onTestFinished(() => { for (const off of offs) off(); });
    const base = executor.historyDepth();
    return { executor, events, base, state: () => store().gridState! };
  }
  const left = (w: ReturnType<typeof session>) => ({
    events: runs(w.events),
    undo: w.executor.historyDepth() - w.base,
    stack: ProvSource[w.executor.getAuthorship().currentSource().source],
  });
  afterEach(() => { leavePlanetSession(editorPort); host.camera.takeQueued(); });

  it('places, turns and removes the plaza one step each, and refuses a second', () => {
    const w = session();
    expect(placeSessionLandmark({ x: 20, y: 20 }, 0).success).toBe(true);
    expect(placeSessionLandmark({ x: 45, y: 20 }, 0).success).toBe(false);
    expect(rotateSessionLandmark(editorPort, 1).success).toBe(true);
    expect(removeSessionLandmark().success).toBe(true);
    expect(left(w)).toMatchInlineSnapshot(`
      {
        "events": "objects-changed cells-changed history-changed validation-failed objects-changed cells-changed history-changed objects-changed cells-changed history-changed objects-changed cells-changed history-changed",
        "stack": "Human",
        "undo": 3,
      }
    `);
  });

  it('takes the removal back when the turned placement throws', () => {
    const w = session();
    expect(placeSessionLandmark({ x: 20, y: 20 }, 0).success).toBe(true);
    w.events.length = 0;
    instrument(2);
    expect(() => rotateSessionLandmark(editorPort, 1)).toThrow('execute fault');
    expect(w.state().objects.get(ANCHOR_LANDMARK.id)?.rotation).toBe(0);
    expect(left(w)).toMatchInlineSnapshot(`
      {
        "events": "objects-changed cells-changed history-changed objects-changed cells-changed history-changed",
        "stack": "Human",
        "undo": 1,
      }
    `);
  });
});
