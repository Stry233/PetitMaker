/** Smart Build as the bar runs it: a press, a held spray, a dragged river or road, and its preview. */
import { afterEach, describe, expect, vi } from 'vitest';
import { spec } from '../../_support/spec';
import { world, type SpecWorld } from '../_world';
import { useEditorStore } from '../../../state/store';
import { cloneGridState } from '../../../core/model/grid-model';
import { objectRect } from '../../../state/object-geometry';
import { PLACEMENT_GRID, TERRAIN_GRID } from '../../../core/game/profile';
import { HEADLESS_OVERLAY } from '../../../tools/pointer/runtime/host';
import { MacroTool } from '../../../tools/pointer/macros/macro-tool';
import { EMPTY_KEY } from '../../../tools/macros/run';
import { HOLD_BURST_MS } from '../../../tools/macros/spray-size';
import { translateFor } from '../../../i18n/context';
import type { MacroPreview } from '../../../tools/macros';
import type { GridState, MacroCoord, PlacedObject } from '../../../core/model/types';
import { makeToolCtx, type ToolCtxOver } from '../../_support/tool-ctx';
import { cell, point } from '../../_support/grid';
import { endCurveSession, getCurveSession, moveCurveAnchor } from '../../_support/curve-session';
import { mapValue } from './_generation';

afterEach(() => { endCurveSession(); vi.useRealTimers(); });

/** The middle of an open square of `side` cells. */
function middle(w: SpecWorld, side: number): MacroCoord {
  const at = w.openGround(side, side);
  return { x: at.x + Math.floor(side / 2), y: at.y + Math.floor(side / 2) };
}

const footprintCells = (o: PlacedObject): string[] => {
  const r = objectRect(o);
  const out: string[] = [];
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) out.push(`${PLACEMENT_GRID}:${x},${y}`);
  return out;
};

/** What a press changed, cell by cell on the grid each lies on: terrain that differs, and the
 *  footprints of objects that arrived or left. */
function laid(before: GridState, after: GridState): { added: string[]; removed: string[] } {
  const added: string[] = [], removed: string[] = [];
  const { width, height } = after.template;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (JSON.stringify(before.cells[y]?.[x]?.terrain ?? null) !== JSON.stringify(after.cells[y]?.[x]?.terrain ?? null)) added.push(`${TERRAIN_GRID}:${x},${y}`);
  }
  for (const [id, o] of after.objects) if (!before.objects.has(id)) added.push(...footprintCells(o));
  for (const [id, o] of before.objects) if (!after.objects.has(id)) removed.push(...footprintCells(o));
  return { added: [...new Set(added)].sort(), removed: [...new Set(removed)].sort() };
}

const shown = (p: MacroPreview): { added: string[]; removed: string[] } => ({
  added: [...new Set(p.added.map((c) => `${c.grid}:${c.x},${c.y}`))].sort(),
  removed: [...new Set(p.removed.map((c) => `${c.grid}:${c.x},${c.y}`))].sort(),
});

/** The bar's Smart Build tool over the world, with `macro` armed, driven by pointer presses. */
function bar(w: SpecWorld, macro: string, ghosts: unknown[] = [], over: ToolCtxOver = {}) {
  const overlay = { ...HEADLESS_OVERLAY, showGhost: (cells: unknown) => { ghosts.push(cells); } };
  const ctx = makeToolCtx(w.state, w.sandbox.executor, 3, 1, { armedMacro: macro, armingEpoch: 1, layerPinned: true, overlay, ...over });
  const tool = new MacroTool();
  const at = (c: MacroCoord) => [cell(c), point({ x: c.x * 2, y: c.y * 2 })] as const;
  return {
    down: (c: MacroCoord) => tool.onPointerDown(...at(c), ctx),
    move: (c: MacroCoord) => tool.onPointerMove(...at(c), ctx),
    up: (c: MacroCoord) => tool.onPointerUp(...at(c), ctx),
    escape: () => tool.cancelPending(ctx),
  };
}

const depth = (w: SpecWorld): number => w.sandbox.executor.historyDepth();
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('a Smart Build action', () => {
  spec('GEN-17', 'is one undo step that undo takes back whole and redo puts back', () => {
    const w = world();
    const centre = middle(w, 24);
    expect(w.place('building-myhouse', centre.x - 9, centre.y - 9).ok).toBe(true);
    expect(w.place('building-stall', centre.x + 5, centre.y + 5).ok).toBe(true);
    const actions = [
      () => w.sandbox.applyMacro('patch-tree', { seed: 3, at: centre, radius: 4 }),
      () => w.sandbox.applyMacro('raise', { seed: 4, at: centre, radius: 4, stage: 3 }),
      () => w.sandbox.applyMacro('roads', { seed: 5 }),
    ];
    for (const [i, act] of actions.entries()) {
      const before = mapValue(w.state), was = depth(w);
      expect(act().changes, `action ${i}`).toBeGreaterThan(0);
      expect(depth(w), `action ${i}`).toBe(was + 1);
      const after = mapValue(w.state);
      w.undo();
      expect(mapValue(w.state), `action ${i}`).toBe(before);
      w.redo();
      expect(mapValue(w.state), `action ${i}`).toBe(after);
      w.undo();
    }
  });

  spec('GEN-17', 'is one undo step for a whole held planting spray', async () => {
    const w = world();
    const centre = middle(w, 16);
    const before = mapValue(w.state);
    const spray = bar(w, 'patch-tree');
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    spray.down(centre);
    const firstBurst = w.state.objects.size;
    await vi.advanceTimersByTimeAsync(HOLD_BURST_MS * 5);
    spray.up(centre);
    await vi.advanceTimersByTimeAsync(HOLD_BURST_MS);
    expect(w.state.objects.size, 'the hold kept planting').toBeGreaterThan(firstBurst);
    expect(depth(w)).toBe(1);
    w.undo();
    expect(mapValue(w.state)).toBe(before);
  });

  spec('GEN-17', 'adds its own undo step when a river or a drawn road is adjusted afterwards', () => {
    for (const macro of ['stream', 'road-link']) {
      const w = world();
      const at = w.openGround(30, 12);
      const from = { x: at.x + 2, y: at.y + 6 }, to = { x: at.x + 27, y: at.y + 6 };
      const before = mapValue(w.state);
      const drag = bar(w, macro);
      drag.down(from);
      drag.move(to);
      drag.up(to);
      const drawn = mapValue(w.state);
      const session = getCurveSession()!;
      moveCurveAnchor(session.anchors.length - 1, to.x, to.y + 4, true);
      expect(depth(w), macro).toBe(2);
      w.undo();
      expect(mapValue(w.state), macro).toBe(drawn);
      w.undo();
      expect(mapValue(w.state), macro).toBe(before);
      endCurveSession();
    }
  });
});

describe('a Smart Build preview', () => {
  spec('GEN-18', 'shows exactly the cells an action changes, and writes nothing', () => {
    for (const [macro, opts] of [
      ['raise', { seed: 9, radius: 4, stage: 3 }],
      ['patch-tree', { seed: 5, radius: 5 }],
      ['patch-flora', { seed: 6, radius: 5 }],
    ] as const) {
      const seen = world();
      const at = middle(seen, 16);
      const before = mapValue(seen.state);
      const preview = seen.sandbox.previewMacro(macro, { ...opts, at });
      expect(mapValue(seen.state), macro).toBe(before);
      expect(depth(seen), macro).toBe(0);

      const pressed = world();
      const was = cloneGridState(pressed.state);
      expect(pressed.sandbox.applyMacro(macro, { ...opts, at }).changes, macro).toBeGreaterThan(0);
      expect(shown(preview), macro).toEqual(laid(was, pressed.state));
    }
  });

  spec('GEN-18', 'shows what an action would replace', () => {
    const lay = (w: SpecWorld, at: MacroCoord): void => {
      for (let x = at.x + 5; x <= at.x + 15; x++) expect(w.place('path-cobblestone', x, at.y + 10).ok).toBe(true);
    };
    const opts = (at: MacroCoord) => ({ seed: 1, from: { x: at.x + 10, y: at.y + 2 }, at: { x: at.x + 10, y: at.y + 18 }, width: 3, material: 'path-cobblestone' });
    const seen = world();
    const at = seen.openGround(20, 20);
    lay(seen, at);
    const preview = shown(seen.sandbox.previewMacro('road-link', opts(at)));
    expect(preview.removed.length, 'the road replaces part of the standing path').toBeGreaterThan(0);

    const pressed = world();
    lay(pressed, at);
    const was = cloneGridState(pressed.state);
    expect(pressed.sandbox.applyMacro('road-link', opts(at)).changes).toBeGreaterThan(0);
    expect(preview.removed).toEqual(laid(was, pressed.state).removed);
  });

  spec('GEN-18', 'shows a river or drawn road while it is dragged, builds it only on release, and Escape cancels it', async () => {
    for (const macro of ['stream', 'road-link']) {
      const w = world();
      const at = w.openGround(30, 12);
      const from = { x: at.x + 2, y: at.y + 6 }, to = { x: at.x + 27, y: at.y + 6 };
      const before = mapValue(w.state);
      const ghosts: unknown[] = [];
      const drag = bar(w, macro, ghosts);
      drag.down(from);
      drag.move(to);
      await settle();
      expect(ghosts.length, `${macro} ghost`).toBeGreaterThan(0);
      expect(mapValue(w.state), `${macro} mid-drag`).toBe(before);
      drag.up(to);
      expect(mapValue(w.state), `${macro} released`).not.toBe(before);
      endCurveSession();

      const cancelled = world();
      const untouched = mapValue(cancelled.state);
      const again = bar(cancelled, macro);
      again.down(from);
      again.move(to);
      expect(again.escape(), macro).toBe(true);
      again.up(to);
      expect(mapValue(cancelled.state), `${macro} after Escape`).toBe(untouched);
      expect(depth(cancelled), macro).toBe(0);
    }
  });
});

describe('a Smart Build press that builds nothing', () => {
  spec('GEN-21', 'leaves the map and its history alone and says why, and the next press works', () => {
    const w = world();
    const centre = middle(w, 16);
    const said: string[] = [];
    const press = bar(w, 'raise', [], { notify: (text) => { said.push(text); }, t: (key) => translateFor('en', key) });
    useEditorStore.setState({ gridState: w.state });
    useEditorStore.getState().setLayerLocked(1, true);
    const before = mapValue(w.state);
    press.down(centre);
    press.up(centre);
    expect(mapValue(w.state)).toBe(before);
    expect(depth(w)).toBe(0);
    expect(said).toEqual([translateFor('en', EMPTY_KEY['terrain-blocked'])]);

    useEditorStore.getState().setLayerLocked(1, false);
    press.down(centre);
    press.up(centre);
    expect(mapValue(w.state)).not.toBe(before);
    expect(depth(w)).toBe(1);
    useEditorStore.setState({ gridState: null });
  });
});

describe('a painted region', () => {
  /** A `side`-cell square region inside open ground, and its placement cells. */
  function painted(w: SpecWorld, side: number) {
    const at = w.openGround(side * 3, side * 3);
    const region: MacroCoord[] = [];
    for (let y = at.y + side; y < at.y + 2 * side; y++) for (let x = at.x + side; x < at.x + 2 * side; x++) region.push({ x, y });
    return { region, inside: new Set(region.map((c) => `${PLACEMENT_GRID}:${c.x},${c.y}`)), corner: { x: at.x + side, y: at.y + side } };
  }

  spec('GEN-20', 'keeps a planting press inside it, whole footprints included', () => {
    const w = world();
    const { region, inside, corner } = painted(w, 8);
    const was = cloneGridState(w.state);
    const press = bar(w, 'patch-tree', [], { region });
    press.down(corner);
    press.up(corner);
    const { added } = laid(was, w.state);
    expect(added.length, 'the press planted something inside the region').toBeGreaterThan(0);
    expect(added.filter((c) => !inside.has(c))).toEqual([]);
  });

  spec('GEN-20', 'keeps a held planting spray inside it', async () => {
    const w = world();
    const { region, inside, corner } = painted(w, 8);
    const was = cloneGridState(w.state);
    const spray = bar(w, 'patch-flora', [], { region });
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    spray.down(corner);
    await vi.advanceTimersByTimeAsync(HOLD_BURST_MS * 4);
    spray.up(corner);
    await vi.advanceTimersByTimeAsync(HOLD_BURST_MS);
    const { added } = laid(was, w.state);
    expect(added.length, 'the spray planted something inside the region').toBeGreaterThan(0);
    expect(added.filter((c) => !inside.has(c))).toEqual([]);
  });
});
