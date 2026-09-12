/** Pins rollback, queue recovery, and held-tool settlement when a main-thread landing rejects. */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules';
import { roadLookup } from '../../../state/object-index';
import { setToastPresenter, type ToastType } from '../../../core/runtime/toast-bus';
import { MacroTool } from '../../../tools/macros/macro-tool';
import {
  buildMacroRun, installMacroBuildRunner, type MacroBuild, type MacroId, type MacroOpts,
} from '../../../tools/macros';
import { __resetCurveSession, getCurveSession } from '../../../tools/paint/curve-session';
import { makeState } from '../../rules/_helpers';
import { makeToolCtx } from '../_tool-ctx';
import { CellZone, type EditorEvents, type GridState } from '../../../core/model/types';

const SIZE = 40;
const SHORE = 3;

/** The live editor the runner builds against, set per test. */
let live: { state: GridState; executor: CommandExecutor } | null = null;
/** Builds asked for and not yet answered, in order. */
let waiting: (() => void)[] = [];
/** Every toast the tool posted, in order. */
let toasts: { text: string; type: ToastType }[] = [];
let unpresent: (() => void) | null = null;
let errorSpy: ReturnType<typeof vi.spyOn>;

installMacroBuildRunner((state: GridState, id: MacroId, opts: MacroOpts): Promise<MacroBuild | null> =>
  new Promise((resolve) => {
    waiting.push(() => {
      const executor = live!.executor;
      resolve(buildMacroRun({ state, executor, registry: executor.getRegistry() }, id, opts));
    });
  }));

/** Answer every build the tool asks for until it stops asking, then let its queue settle. The
 *  request itself arrives a microtask late, so a synchronous sweep of `waiting` would find it
 *  empty. */
async function flush(): Promise<void> {
  for (let round = 0; round < 8; round++) {
    await new Promise((r) => { setTimeout(r, 0); });
    const answer = waiting;
    waiting = [];
    for (const a of answer) a();
  }
  await new Promise((r) => { setTimeout(r, 0); });
}

/** An open, flat, buildable map with a sea border. */
function makeMap(): { state: GridState; executor: CommandExecutor } {
  const state = makeState(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (x < SHORE || y < SHORE || x >= SIZE - SHORE || y >= SIZE - SHORE) state.cells[y]![x]!.zone = CellZone.Void;
    }
  }
  const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
  return { state, executor };
}

/**
 * The live executor with its stroke commit throwing for the first `faults` landings — a rule or
 * executor fault, the one thing `landMacroRun` rethrows rather than reporting. Everything else
 * delegates, so the rollback it performs on the way out is the real one.
 */
function faulty(real: CommandExecutor, faults: { left: number }): CommandExecutor {
  return new Proxy(real, {
    get(target, prop) {
      if (prop === 'commitStrokeGroup' && faults.left > 0) {
        return (): never => { faults.left -= 1; throw new Error('commit fault'); };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as CommandExecutor;
}

/** How much terrain stands on the map — what a raise adds and a rollback takes back. */
const raised = (state: GridState): number =>
  state.cells.flat().filter((c) => c.terrain !== null).length;

beforeEach(() => {
  waiting = [];
  toasts = [];
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  unpresent = setToastPresenter((text, type) => { toasts.push({ text, type }); });
});
afterEach(() => { errorSpy.mockRestore(); unpresent?.(); unpresent = null; live = null; __resetCurveSession(); });

describe('a macro landing that throws', () => {
  it('leaves the map alone, says the press built nothing, and lets the next press build', async () => {
    const { state, executor } = makeMap();
    live = { state, executor };
    const faults = { left: 1 };
    const ctx = makeToolCtx(state, executor, 1, 1, {
      armedMacro: 'raise',
      macroContext: { state, executor: faulty(executor, faults), registry: executor.getRegistry() },
    });
    const tool = new MacroTool();
    tool.onActivate();

    tool.onPointerDown({ x: 20, y: 20 }, { x: 20, y: 20 }, ctx);
    tool.onPointerUp({ x: 24, y: 24 }, { x: 24, y: 24 }, ctx);
    await flush();

    expect(faults.left, 'the fault was reached').toBe(0);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(raised(state), 'the faulted landing took its own work back').toBe(0);

    tool.onPointerDown({ x: 20, y: 20 }, { x: 20, y: 20 }, ctx);
    tool.onPointerUp({ x: 24, y: 24 }, { x: 24, y: 24 }, ctx);
    await flush();

    expect(raised(state), 'the next press still builds').toBeGreaterThan(0);
    expect(toasts.map((t) => t.text), 'the press that built nothing is reported').toContain('smart.terrain_blocked');
  });

  it('lets a held planting whose burst faulted settle, and keeps planting after it', async () => {
    const { state, executor } = makeMap();
    live = { state, executor };
    const faults = { left: 1 };
    const ctx = makeToolCtx(state, executor, 1, 1, {
      armedMacro: 'patch-tree',
      macroContext: { state, executor: faulty(executor, faults), registry: executor.getRegistry() },
    });
    const tool = new MacroTool();
    tool.onActivate();

    // The hold's one burst faults, and the release is waiting on it: without the burst's own
    // bookkeeping the hold never settles and the clock, which sprays only at zero, never fires again.
    tool.onPointerDown({ x: 20, y: 20 }, { x: 20, y: 20 }, ctx);
    tool.onPointerUp({ x: 20, y: 20 }, { x: 20, y: 20 }, ctx);
    await flush();

    expect(faults.left).toBe(0);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(state.objects.size, 'the faulted burst planted nothing').toBe(0);
    expect(toasts.map((t) => t.text), 'a hold that grew nothing is reported once').toEqual(['smart.empty']);

    tool.onPointerDown({ x: 12, y: 12 }, { x: 12, y: 12 }, ctx);
    tool.onPointerUp({ x: 12, y: 12 }, { x: 12, y: 12 }, ctx);
    await flush();

    expect(state.objects.size, 'the next hold plants').toBeGreaterThan(0);
  });

  it('opens no marks over a route that was never laid, and the next link still lays', async () => {
    const { state, executor } = makeMap();
    live = { state, executor };
    const faults = { left: 1 };
    const ctx = makeToolCtx(state, executor, 1, 1, {
      armedMacro: 'road-link',
      macroContext: { state, executor: faulty(executor, faults), registry: executor.getRegistry() },
    });
    const tool = new MacroTool();
    tool.onActivate();

    tool.onPointerDown({ x: 10, y: 10 }, { x: 10, y: 10 }, ctx);
    tool.onPointerUp({ x: 30, y: 10 }, { x: 30, y: 10 }, ctx);
    await flush();

    expect(faults.left).toBe(0);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(state.objects.size, 'the faulted commit paved nothing').toBe(0);
    expect(getCurveSession(), 'and nothing offers to nudge a route the map does not have').toBeNull();
    expect(toasts.map((t) => t.text), 'the commit reports its own refusal').toContain('smart.empty_link');

    tool.onPointerDown({ x: 10, y: 20 }, { x: 10, y: 20 }, ctx);
    tool.onPointerUp({ x: 30, y: 20 }, { x: 30, y: 20 }, ctx);
    await flush();

    expect(state.objects.size, 'the next link lays').toBeGreaterThan(0);
    expect(getCurveSession(), 'with its own marks standing').not.toBeNull();
  });
});
