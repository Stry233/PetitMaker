/*
 * Dragging a selection: the cost of one pointer move through the real pointer machine, the drag
 * session and the overlay seam, over a visitor's save of about 1,200 objects. Each sample lands on a
 * new cell (the session skips moves within a cell), so it measures the whole per-cell preview:
 * validity, ghost cells and member plans. `move` steps away from the grabbed cell, where a refusal
 * usually stops at the first member that refuses; `away-and-home` adds the step back, where the
 * whole group is accepted, so every member is judged. See `_harness.ts` for the gate.
 *
 * The commits of a selection that moves one cell right as a whole: `drop` is the release that
 * commits the move, then its `undo` and `redo`, a group `rotate` and a group `delete`. A listener
 * walks the selection on every `objects-changed`, as the selection ring does, and a drop must
 * announce its objects once: a 500-object move is 1,000 commands.
 *
 * The bound is a ratio on one machine, so it holds anywhere: `cold-probe` is one move plan that
 * rebuilds the lifted view (the object index and statistics of the map with one object off), and a
 * 500-object move must cost a bounded number of those, not one per member.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PERF, perfSuite } from './_harness';
import { parseSave } from '../../io/save/parse';
import { decodeSave } from '../../io/save/json-codec';
import { createDefaultRegistry } from '../../rules/index';
import { clearUnderLandmarks } from '../../state/landmark-clearance';
import { createExecutor } from '../../state/executor';
import { useEditorStore } from '../../state/store';
import { objectRect } from '../../state/object-geometry';
import { ToolType } from '../../state/editing/vocabulary';
import { ToolManager } from '../../tools/pointer/runtime/tool-manager';
import type { ActiveView } from '../../tools/pointer/runtime';
import { planObjectMove } from '../../tools/placement/probe';
import { deleteGroup, planGroupMove, rotateGroup } from '../../tools/objects/group-actions';
import { editorToolWiring } from '../../editor/session/tool-wiring';
import { registerToolManager, setActiveView } from '../../view/active-view';
import { installPointerMachine } from '../../view/interaction/pointer/machine';
import { __resetCursorController } from '../../view/interaction/cursor-controller';
import type { CommandExecutor } from '../../core/commands/command-executor';
import type { GridState, PlacedObject } from '../../core/model/types';
import { makeStubView } from '../_support/tool-manager';
import { setStoreState, armedEditMode } from '../_support/store';

const s = perfSuite('object-drag');

/** How many lifted-view rebuilds one accepted 500-object move may cost; a rebuild per member costs
 *  hundreds. */
const BOUND = 25;

const FILE = join(__dirname, '..', 'fixtures', 'saves', 'hexia-plaza-frame-1.5.557.json.gz');
/** Screen pixels per placement cell in the view below. */
const PX = 10;

interface Saved { state: GridState; executor: CommandExecutor }

function loadSave(): Saved {
  const parsed = parseSave(JSON.parse(gunzipSync(readFileSync(FILE)).toString('utf8')));
  const state = decodeSave(parsed);
  clearUnderLandmarks(state, createDefaultRegistry(), parsed.landmarksAsSaved);
  return { state, executor: createExecutor(state, createDefaultRegistry(), useEditorStore.getState().eventBus) };
}

/** The `n` objects nearest the map's centre that stand legally where they are (the save holds a few
 *  that do not): a compact group, as a band would catch, that its own place accepts. */
function nearestGroup({ state, executor }: Saved, n: number): PlacedObject[] {
  const cx = state.template.width / 2, cy = state.template.height / 2;
  const centre = (o: PlacedObject) => { const r = objectRect(o); return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; };
  return [...state.objects.values()]
    .filter((o) => !o.locked && planObjectMove(executor, state, o, o.position.x, o.position.y).errors.length === 0)
    .map((o) => ({ o, d: Math.hypot(centre(o).x - cx, centre(o).y - cy) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, n)
    .map((e) => e.o);
}

/** What the overlay was asked to draw, so a bench can check it measured real work. */
const drawn = { previews: 0, accepted: 0 };

function headlessView(): ActiveView {
  const noop = () => {};
  const showObjectMove = (_members: unknown, valid: boolean) => {
    drawn.previews++;
    if (valid) drawn.accepted++;
  };
  const overlay = new Proxy({}, { get: (_t, key) => (key === 'showObjectMove' ? showObjectMove : noop) });
  return {
    projection: {
      screenToPoint: (x: number, y: number) => ({ x: x / PX, y: y / PX }),
      cellToScreen: (x: number, y: number) => ({ x: x * PX, y: y * PX, scale: 1 }),
    },
    overlay,
    camera: { pan: noop, zoomStep: noop, zoomBy: noop },
    plopObject: noop,
  } as unknown as ActiveView;
}

const pointer = (type: string, init: MouseEventInit) => new MouseEvent(type, { bubbles: true, cancelable: true, ...init });

interface Rig {
  press(): void; move(): void; home(): void;
  /** The pointer `dx`, `dy` cells from the grabbed cell. */
  to(dx: number, dy: number): void;
  /** Released `dx`, `dy` cells from the grabbed cell; over it by default, which moves nothing. */
  release(dx?: number, dy?: number): void;
  uninstall(): void;
}

/** Mounts the pointer machine over the save with `group` selected and returns its driver. */
function rig({ state, executor }: Saved, group: PlacedObject[]): Rig {
  const tm = new ToolManager(makeStubView(), executor, state, editorToolWiring());
  setActiveView(headlessView());
  registerToolManager(tm);
  tm.setActiveTool(ToolType.Hand);
  setStoreState({
    gridState: state, commandExecutor: executor,
    selection: group.map((o) => ({ kind: 'object', id: o.id }) as const), selectingRegion: false,
    contextMenu: null, ...armedEditMode({ tool: ToolType.Hand, item: null }),
  });
  const el = document.createElement('div');
  document.body.appendChild(el);
  const uninstall = installPointerMachine(el);
  const anchor = group[0]!;
  const ax = (anchor.position.x + 0.5) * PX, ay = (anchor.position.y + 0.5) * PX;
  const at = (x: number) => window.dispatchEvent(pointer('pointermove', { buttons: 1, clientX: x, clientY: ay }));
  let step = 0;
  return {
    press: () => {
      step = 0;
      el.dispatchEvent(pointer('pointerdown', { button: 0, buttons: 1, clientX: ax, clientY: ay }));
    },
    // 1, 2, ..., 8, 7, ..., 1, 2, ... cells away: always a new cell, never the grabbed one.
    move: () => { step++; at(ax + (1 + Math.abs(((step + 7) % 14) - 7)) * PX); },
    home: () => at(ax),
    to: (dx, dy) => window.dispatchEvent(pointer('pointermove', { buttons: 1, clientX: ax + dx * PX, clientY: ay + dy * PX })),
    release: (dx = 0, dy = 0) => {
      window.dispatchEvent(pointer('pointerup', { button: 0, buttons: 0, clientX: ax + dx * PX, clientY: ay + dy * PX }));
    },
    uninstall: () => { uninstall(); el.remove(); },
  };
}

afterEach(() => {
  setActiveView(null);
  registerToolManager(null);
  __resetCursorController();
});

describe.runIf(PERF)('perf: object drag', () => {
  vi.setConfig({ testTimeout: 120_000 });
  const p50 = new Map<string, number>();
  for (const n of [1, 10, 100, 500]) {
    it(`one pointer move of a ${n}-object selection`, async () => {
      const saved = loadSave();
      const group = nearestGroup(saved, n);
      const meta = { objects: saved.state.objects.size, selected: group.length };
      const r = rig(saved, group);
      r.press();
      r.move(); // past the drag threshold
      await s.bench(`move/${n}`, () => r.move(), { budgetMs: 2000, maxSamples: 200, meta });
      drawn.accepted = 0;
      const home = await s.bench(`away-and-home/${n}`, () => { r.move(); r.home(); }, { budgetMs: 2000, maxSamples: 200, meta });
      p50.set(`away-and-home/${n}`, home.p50);
      r.home();
      r.release();
      r.uninstall();
      if (drawn.previews === 0 || drawn.accepted === 0) throw new Error('the drag never previewed an accepted move');
      drawn.previews = 0;
    });
  }

  /** Up to `n` objects nearest the centre that move one cell right together: each joins only if the
   *  group with it still moves, so the drop commits. */
  function movableGroup(saved: Saved, n: number): PlacedObject[] {
    const out: PlacedObject[] = [];
    for (const o of nearestGroup(saved, 4 * n)) {
      if (out.length === n) break;
      const ids = [...out, o].map((m) => m.id);
      if (planGroupMove(saved.executor, saved.state, ids, 1, 0).valid) out.push(o);
    }
    return out;
  }

  for (const n of [10, 100, 500]) {
    it(`the drop, undo, redo, turn and delete of a ${n}-object selection`, async () => {
      const saved = loadSave();
      const { executor: ex, state } = saved;
      const group = movableGroup(saved, n);
      const ids = group.map((o) => o.id);
      // The selection ring's share of a commit: a walk over the selection per announcement.
      let announced = 0;
      const ring = () => { announced++; for (const id of ids) state.objects.get(id); };
      const bus = useEditorStore.getState().eventBus;
      bus.on('objects-changed', ring);
      const meta = { objects: state.objects.size, selected: group.length };
      const r = rig(saved, group);
      const depth = ex.historyDepth();
      const back = () => { while (ex.historyDepth() > depth) ex.undo(); };
      await s.bench(`drop/${n}`, () => r.release(1, 0), {
        budgetMs: 2000, maxSamples: 60, meta,
        setup: () => { back(); r.press(); r.to(1, 0); },
      });
      expect(ex.historyDepth(), 'the drop committed one undo step').toBe(depth + 1);
      back();
      announced = 0;
      r.press(); r.to(1, 0); r.release(1, 0);
      expect(announced, 'a drop announces its objects once, not once per command').toBe(1);
      await s.bench(`undo/${n}`, () => ex.undo(), { budgetMs: 2000, maxSamples: 60, meta, setup: () => { if (ex.historyDepth() === depth) ex.redo(); } });
      await s.bench(`redo/${n}`, () => ex.redo(), { budgetMs: 2000, maxSamples: 60, meta, setup: back });
      back();
      r.uninstall();
      // A large turn usually refuses part-way, which applies and rewinds every member it reached.
      await s.bench(`rotate/${n}`, () => rotateGroup(ex, state, ids, 1), { budgetMs: 2000, maxSamples: 60, meta, setup: back });
      await s.bench(`delete/${n}`, () => deleteGroup(ex, state, ids), { budgetMs: 2000, maxSamples: 60, meta, setup: back });
      back();
      bus.off('objects-changed', ring);
    });
  }

  it('a 500-object move costs a bounded number of lifted-view rebuilds', async () => {
    const saved = loadSave();
    const [a, b] = nearestGroup(saved, 2) as [PlacedObject, PlacedObject];
    let flip = false;
    // Alternating objects misses the one-view probe cache every time, so each plan rebuilds.
    const cold = await s.bench('cold-probe', () => {
      flip = !flip;
      const o = flip ? a : b;
      planObjectMove(saved.executor, saved.state, o, o.position.x, o.position.y);
    }, { budgetMs: 1000, meta: { objects: saved.state.objects.size } });
    const move = p50.get('away-and-home/500');
    expect(move, 'the 500-object bench ran first').toBeDefined();
    expect(move! / cold.p50, 'an accepted 500-object move against one lifted-view rebuild').toBeLessThanOrEqual(BOUND);
  });
});
