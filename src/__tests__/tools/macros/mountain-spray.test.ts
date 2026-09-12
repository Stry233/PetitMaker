import { afterEach, describe, expect, it, vi } from 'vitest';
import { TerrainType } from '../../../core/model/types';
import { MacroTool } from '../../../tools/macros/macro-tool';
import * as previews from '../../../tools/macros/preview';
import { buildMacroRun, installMacroBuildRunner, type MacroBuild } from '../../../tools/macros/run';
import { mapFingerprint } from '../../../tools/macros/scratch';
import { makeToolCtx } from '../_tool-ctx';
import { makeExecutor, makeState, setTerrain } from '../../rules/_helpers';

const active: Array<() => void> = [];
function setup(size = 1) {
  const state = makeState(48, 48), executor = makeExecutor(state);
  const ctx = makeToolCtx(state, executor, size, 1, { brushSize: size, armedMacro: 'raise', armingEpoch: 1, region: [] });
  const tool = new MacroTool();
  const down = (x = 12, y = 24) => tool.onPointerDown({ x, y }, { x: x * 2, y: y * 2 }, ctx);
  const move = (x: number, y = 24) => tool.onPointerMove({ x, y }, { x: x * 2, y: y * 2 }, ctx);
  const up = (x = 12, y = 24) => tool.onPointerUp({ x, y }, { x: x * 2, y: y * 2 }, ctx);
  const peak = () => Math.max(...state.cells.flat().map(c => c.terrain?.elevation ?? 0));
  active.push(() => tool.onDeactivate(ctx));
  return { state, executor, ctx, tool, down, move, up, peak };
}
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
afterEach(() => {
  active.splice(0).forEach(stop => stop()); installMacroBuildRunner(null); vi.restoreAllMocks(); vi.useRealTimers();
});

describe('mountain spray', () => {
  it('a tap builds a local mound and leaves distant connected ground alone', () => {
    const s = setup(), before = mapFingerprint(s.state);
    s.down(); s.up();
    expect(s.peak()).toBe(2);
    expect(s.state.cells[24]![12]!.terrain?.elevation).toBe(2);
    expect(s.state.cells[24]![36]!.terrain).toBeNull();
    expect(s.state.cells[4]![4]!.terrain).toBeNull();
    expect(s.executor.getUndoStackSize()).toBe(1);
    expect(s.executor.getRegistry().validatePostStroke(s.state)).toEqual([]);
    const after = mapFingerprint(s.state);
    s.executor.undo(); expect(mapFingerprint(s.state)).toBe(before);
    s.executor.redo(); expect(mapFingerprint(s.state)).toBe(after);
  });

  it.each([1, 2, 3, 4, 5])('holding grows a legal terraced summit at brush size %s and release stops it', size => {
    vi.useFakeTimers(); const s = setup(size);
    s.down(); const first = s.peak();
    vi.advanceTimersByTime(2800); s.up();
    expect(s.peak()).toBeGreaterThan(first);
    expect(s.peak()).toBeLessThanOrEqual(8);
    expect(s.executor.getRegistry().validatePostStroke(s.state)).toEqual([]);
    expect(s.executor.getUndoStackSize()).toBe(1);
    const after = mapFingerprint(s.state);
    vi.advanceTimersByTime(5000); expect(mapFingerprint(s.state)).toBe(after);
  });

  it('interpolates a fast drag into a connected ridge and keeps it as one undo step', () => {
    const s = setup(), before = mapFingerprint(s.state);
    s.down(); s.move(36); s.up(36);
    for (let x = 12; x <= 36; x++) expect(s.state.cells[24]![x]!.terrain?.elevation).toBeGreaterThan(0);
    expect(s.executor.getUndoStackSize()).toBe(1);
    expect(s.executor.getRegistry().validatePostStroke(s.state)).toEqual([]);
    s.executor.undo(); expect(mapFingerprint(s.state)).toBe(before);
  });

  it('each new click adds a separately undoable mound on existing terrain', () => {
    const s = setup(3), peaks = [];
    for (let i = 0; i < 3; i++) { s.down(); s.up(); peaks.push(s.peak()); }
    expect(peaks[1]).toBeGreaterThan(peaks[0]!); expect(peaks[2]).toBeGreaterThan(peaks[1]!);
    expect(s.executor.getUndoStackSize()).toBe(3);
    s.executor.undo(); expect(s.peak()).toBe(peaks[1]);
  });

  it('keeps processing during synchronous pointer resampling from replay and history events', () => {
    const s = setup(), before = mapFingerprint(s.state);
    s.ctx.setDisplayLayer = () => s.move(36);
    const collapse = s.ctx.collapseHistory;
    s.ctx.collapseHistory = watermark => { collapse(watermark); s.move(36); };
    s.down(); s.up(36);
    expect(s.state.cells[24]![36]!.terrain?.elevation).toBeGreaterThan(0);
    expect(s.executor.getUndoStackSize()).toBe(1);
    s.executor.undo(); expect(mapFingerprint(s.state)).toBe(before);
  });

  it('keeps all terrain and supporting cells inside the painted region', () => {
    const s = setup(); s.ctx.region = [{ x: 11, y: 24 }, { x: 12, y: 24 }, { x: 13, y: 24 }];
    s.down(); s.up();
    const painted = s.state.cells.flat().filter(c => c.terrain);
    expect(painted.length).toBe(3);
    expect(s.state.cells[23]![12]!.terrain).toBeNull();
  });

  it('preserves water and object footprints while a held drag passes over them', () => {
    vi.useFakeTimers(); const s = setup();
    for (let y = 2; y < 46; y++) setTerrain(s.state, 24, y, TerrainType.Water, 0);
    const home = { id: 'home', catalogId: 'building-myhouse', position: { x: 10, y: 15 }, elevation: 0, rotation: 0 as const };
    s.state.objects.set(home.id, home);
    s.down(); vi.advanceTimersByTime(700); s.move(36); s.up(36);
    expect(s.state.objects.get(home.id)).toEqual(home);
    expect(s.state.cells[17]![12]!.terrain).toBeNull();
    for (let y = 2; y < 46; y++) expect(s.state.cells[y]![24]!.terrain?.type).toBe(TerrainType.Water);
    expect(s.executor.getRegistry().validatePostStroke(s.state)).toEqual([]);
  });

  it('does not paint a locked layer', () => {
    const s = setup(); s.state.lockedLayers.add(1);
    const before = mapFingerprint(s.state); s.down(); s.up();
    expect(mapFingerprint(s.state)).toBe(before); expect(s.executor.getUndoStackSize()).toBe(0);
  });

  it('changes the outline between clicks and reproduces it for the same seed', () => {
    const s = setup(3); s.down(); s.up(); const first = mapFingerprint(s.state);
    s.executor.undo(); s.down(); s.up(); expect(mapFingerprint(s.state)).not.toBe(first);
    const same = setup(3); same.down(); same.up(); expect(mapFingerprint(same.state)).toBe(first);
  });

  it('keeps the visible ghost when the pointer returns while another preview is pending', async () => {
    const s = setup(), show = vi.spyOn(s.ctx.overlay, 'showGhost');
    const answers: Array<(value: previews.MacroPreview) => void> = [];
    vi.spyOn(previews, 'previewMacroAsync').mockImplementation(() => new Promise(resolve => answers.push(resolve)));
    s.move(12);
    answers[0]!({ added: [{ x: 12, y: 24 }], removed: [], blocked: [], offers: [] }); await flush();
    s.move(36); s.move(12);
    answers[1]!({ added: [{ x: 36, y: 24 }], removed: [], blocked: [], offers: [] }); await flush();
    expect(show).toHaveBeenCalledTimes(1);
    expect(show.mock.calls[0]![0]).toEqual([{ x: 12, y: 24 }]);
  });

  it('discards an old hover preview and shows the latest local footprint', async () => {
    const s = setup(), show = vi.spyOn(s.ctx.overlay, 'showGhost');
    const answers: Array<(value: previews.MacroPreview) => void> = [];
    const worker = vi.spyOn(previews, 'previewMacroAsync').mockImplementation(() => new Promise(resolve => answers.push(resolve)));
    s.move(12); s.move(36);
    answers[0]!({ added: [{ x: 12, y: 24 }], removed: [], blocked: [], offers: [] }); await flush();
    expect(show).not.toHaveBeenCalled(); expect(worker).toHaveBeenCalledTimes(2);
    answers[1]!({ added: [{ x: 36, y: 24 }], removed: [], blocked: [], offers: [] }); await flush();
    expect(show.mock.calls[0]![0]).toEqual([{ x: 36, y: 24 }]);
  });
});

describe('queued mountain spray', () => {
  function delayed(s: ReturnType<typeof setup>) {
    const answers: Array<() => void> = [];
    installMacroBuildRunner((state, id, opts) => {
      const built = buildMacroRun({ ...s.ctx.macroContext, state }, id, opts);
      return new Promise<MacroBuild | null>(resolve => answers.push(() => resolve(built)));
    });
    return answers;
  }

  it('keeps rapid clicks in order, with separate undo steps', async () => {
    const s = setup(3), answers = delayed(s);
    s.down(); s.up(); s.down(); s.up(); s.down(); s.up();
    expect(answers).toHaveLength(1); expect(s.executor.getUndoStackSize()).toBe(0);
    let peak = 0;
    for (let i = 0; i < 3; i++) {
      answers[i]!(); await flush();
      expect(s.executor.getUndoStackSize()).toBe(i + 1); expect(s.peak()).toBeGreaterThan(peak); peak = s.peak();
    }
    expect(s.tool.hasPending()).toBe(false);
  });

  it('finishes every interpolated dab from a released drag as one undo step', async () => {
    const s = setup(), before = mapFingerprint(s.state), answers = delayed(s);
    s.down(); s.move(36); s.up(36);
    for (let i = 0; i < answers.length; i++) { answers[i]!(); await flush(); }
    for (let x = 12; x <= 36; x++) expect(s.state.cells[24]![x]!.terrain?.elevation).toBeGreaterThan(0);
    expect(s.executor.getUndoStackSize()).toBe(1);
    expect(s.tool.hasPending()).toBe(false);
    s.executor.undo(); expect(mapFingerprint(s.state)).toBe(before);
  });

  it.each(['Escape', 'tool change', 'map replacement', 'layer lock', 'undo'])('discards unfinished dabs after %s', async action => {
    const s = setup(); let answers = delayed(s);
    if (action === 'undo') { installMacroBuildRunner(null); s.down(36); s.up(36); answers = delayed(s); }
    s.down(); s.up(); s.down(); s.up();
    if (action === 'Escape') s.tool.cancelPending(s.ctx);
    if (action === 'tool change') { s.ctx.armingEpoch++; s.tool.onDeactivate(s.ctx); }
    if (action === 'map replacement') s.ctx.gridState = makeState(48, 48);
    if (action === 'layer lock') s.state.lockedLayers.add(1);
    if (action === 'undo') s.executor.undo();
    const before = mapFingerprint(s.state);
    answers[0]!(); await flush();
    expect(s.executor.getUndoStackSize()).toBe(0); expect(mapFingerprint(s.state)).toBe(before);
    expect(s.tool.hasPending()).toBe(false);
  });
});
