import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../kit/host', () => ({
  host: { camera: { get2d: () => undefined, get3d: () => undefined } },
}));

import { scheduleAutosave, readAutosave, clearAutosave, hasAutosave, autosaveWorthy } from '../../io/autosave';
import { serialize } from '../../io/json-codec';
import { CURRENT_VERSION } from '../../io/save-format';
import { DEFAULT_MAP } from '../../config/maps';
import { createGrid } from '../../core/model/grid-model';
import { CellZone, CommandType, TerrainType, type EditorEvents, type GridState } from '../../core/model/types';
import { host } from '../../kit/host';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules/index';
import { roadLookup } from '../../state/object-index';
import { useEditorStore } from '../../state/store';

const STORAGE_KEY = 'petit-planet-autosave';

// Node's native localStorage is disabled in this runner and jsdom doesn't supply
// one (the app guards with `typeof localStorage`), so install a tiny in-memory shim.
class MemStorage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
}
Object.defineProperty(globalThis, 'localStorage', {
  value: new MemStorage(),
  writable: true,
  configurable: true,
});

/** A real working map (DEFAULT_MAP so its templateId resolves on restore), with a
 *  mountain painted on the first Grass cell so the round-trip carries content. */
function makeWorkingMap(): GridState {
  const cells = createGrid(DEFAULT_MAP);
  for (let y = 0; y < DEFAULT_MAP.height; y++) {
    for (let x = 0; x < DEFAULT_MAP.width; x++) {
      if (DEFAULT_MAP.zones[y]?.[x] === CellZone.Grass) {
        cells[y]![x] = { zone: CellZone.Grass, terrain: { type: TerrainType.Mountain, elevation: 3 } };
        return {
          template: DEFAULT_MAP,
          cells,
          objects: new Map(),
          lockedLayers: new Set(),
        };
      }
    }
  }
  throw new Error('no Grass cell in DEFAULT_MAP');
}

describe('autosave', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    host.camera.get2d = () => undefined;
    host.camera.get3d = () => undefined;
  });

  it('debounces, then persists a restorable map', () => {
    const state = makeWorkingMap();
    scheduleAutosave(state);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull(); // not yet — still debouncing
    vi.advanceTimersByTime(2000);

    expect(hasAutosave()).toBe(true);
    const restored = readAutosave();
    expect(restored).not.toBeNull();
    expect(restored!.state.template.id).toBe(DEFAULT_MAP.id);
    // Content survives the round-trip (compare encoded cells, ignoring timestamp).
    expect(JSON.parse(serialize(restored!.state)).cells).toBe(JSON.parse(serialize(state)).cells);
    // No camera was ever reported by either view this session — nothing to restore.
    expect(restored!.camera).toBeUndefined();
  });

  it('restores a half-cell anchor (it rides json-codec, so there is nothing of its own to do)', () => {
    const state = makeWorkingMap();
    state.objects.set('r', {
      id: 'r', catalogId: 'ramp-plank', position: { x: 12.5, y: 20 }, rotation: 0, elevation: 1,
    });
    scheduleAutosave(state);
    vi.advanceTimersByTime(2000);

    expect(readAutosave()!.state.objects.get('r')!.position).toEqual({ x: 12.5, y: 20 });
  });

  describe('camera (resume from last restores the view too)', () => {
    it('persists and restores the 2D and 3D cameras independently', () => {
      host.camera.get2d = () => ({ x: 111, y: -22, zoom: 1.4 });
      host.camera.get3d = () => ({ az: 30, el: 20, dist: 0.7, tx: 1, tz: -1 });
      scheduleAutosave(makeWorkingMap());
      vi.advanceTimersByTime(2000);

      const restored = readAutosave();
      expect(restored!.camera).toEqual({
        view2d: { x: 111, y: -22, zoom: 1.4 },
        view3d: { az: 30, el: 20, dist: 0.7, tx: 1, tz: -1 },
      });
    });

    it('persists only the view(s) actually reported — a view never opened this session is simply absent', () => {
      host.camera.get2d = () => ({ x: 5, y: 5, zoom: 1 });
      // host.camera.get3d left at its default undefined: the 3D editor was never opened.
      scheduleAutosave(makeWorkingMap());
      vi.advanceTimersByTime(2000);

      const restored = readAutosave();
      expect(restored!.camera).toEqual({ view2d: { x: 5, y: 5, zoom: 1 } });
    });

    it('a pre-camera autosave (written before this feature) restores the map and leaves the camera alone', () => {
      // Exactly what an older build's json-codec wrote: no `camera` key at all.
      localStorage.setItem(STORAGE_KEY, serialize(makeWorkingMap()));
      const restored = readAutosave();
      expect(restored).not.toBeNull();
      expect(restored!.state.template.id).toBe(DEFAULT_MAP.id); // the map itself loads fine
      expect(restored!.camera).toBeUndefined(); // nothing to apply — never touches the live camera
    });

    it('reads the camera LIVE at write time, not at schedule time — moving the camera between the ' +
      'schedule call and the debounced write does not add a write, and the write carries the latest pose', () => {
      host.camera.get2d = () => ({ x: 0, y: 0, zoom: 1 }); // pose at schedule time
      scheduleAutosave(makeWorkingMap());
      vi.advanceTimersByTime(1000); // still inside the debounce window — no write yet
      expect(hasAutosave()).toBe(false);

      // The user pans/zooms; nothing calls scheduleAutosave for this (a camera move must not create
      // a new write on its own — see io/autosave.ts's currentCamera doc).
      host.camera.get2d = () => ({ x: 999, y: 999, zoom: 2 });
      vi.advanceTimersByTime(1000); // the ORIGINAL debounce now fires

      expect(hasAutosave()).toBe(true); // exactly the one write the content edit scheduled
      expect(readAutosave()!.camera).toEqual({ view2d: { x: 999, y: 999, zoom: 2 } }); // the latest pose, not the stale one
    });
  });

  it('only the trailing call writes within the debounce window', () => {
    const state = makeWorkingMap();
    scheduleAutosave(state);
    vi.advanceTimersByTime(1000);
    scheduleAutosave(state); // resets the timer
    vi.advanceTimersByTime(1000);
    expect(hasAutosave()).toBe(false); // 1s after the second call — not fired yet
    vi.advanceTimersByTime(1000);
    expect(hasAutosave()).toBe(true);
  });

  it('returns null when there is nothing to restore', () => {
    expect(readAutosave()).toBeNull();
    expect(hasAutosave()).toBe(false);
  });

  it('returns null on a corrupt autosave', () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    expect(readAutosave()).toBeNull();
  });

  it('returns null on an autosave from a newer format version', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: CURRENT_VERSION + 1, templateId: DEFAULT_MAP.id, cells: '', objects: [], metadata: { savedAt: '' } }),
    );
    expect(readAutosave()).toBeNull();
  });

  it('clearAutosave forgets the saved map', () => {
    scheduleAutosave(makeWorkingMap());
    vi.advanceTimersByTime(2000);
    expect(hasAutosave()).toBe(true);
    clearAutosave();
    expect(hasAutosave()).toBe(false);
    expect(readAutosave()).toBeNull();
  });

  describe('undo history rides along', () => {
    /** A live executor over `state` with `steps` painted commands behind it, installed on the store
     *  the way the app has one — `currentHistory` reads it there, live, at write time. */
    function withHistory(state: GridState, steps: number): CommandExecutor {
      const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
      let laid = 0;
      for (let y = 0; y < DEFAULT_MAP.height && laid < steps; y++) {
        for (let x = 0; x < DEFAULT_MAP.width && laid < steps; x++) {
          if (DEFAULT_MAP.zones[y]?.[x] !== CellZone.Grass) continue;
          const before = exec.getUndoStackSize();
          exec.execute({
            type: CommandType.PaintTerrain, timestamp: 0,
            cells: [{ x, y }], terrainType: TerrainType.Mountain, elevation: 1,
          });
          if (exec.getUndoStackSize() > before) laid++;
        }
      }
      expect(exec.getUndoStackSize()).toBeGreaterThan(0);
      useEditorStore.setState({ commandExecutor: exec });
      return exec;
    }

    afterEach(() => { useEditorStore.setState({ commandExecutor: null }); });

    it('persists the undo stack beside the map and restores it', () => {
      const state = makeWorkingMap();
      const exec = withHistory(state, 5);
      scheduleAutosave(state);
      vi.advanceTimersByTime(2000);

      const restored = readAutosave();
      expect(restored!.history).toHaveLength(exec.getUndoStackSize());
      // Restorable onto a fresh executor, which is what the resume flow does.
      const fresh = new CommandExecutor(restored!.state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(restored!.state));
      expect(fresh.canUndo()).toBe(false);
      fresh.restoreHistory(restored!.history!);
      expect(fresh.canUndo()).toBe(true);
      expect(fresh.getUndoStackSize()).toBe(exec.getUndoStackSize());
    });

    it('keeps only the most recent HISTORY_STEPS entries', () => {
      const state = makeWorkingMap();
      const exec = withHistory(state, 70);
      expect(exec.getUndoStackSize()).toBeGreaterThan(60);
      scheduleAutosave(state);
      vi.advanceTimersByTime(2000);
      expect(readAutosave()!.history).toHaveLength(60);
    });

    it('a map with no history restores with none, not with the last map\'s', () => {
      const first = makeWorkingMap();
      withHistory(first, 3);
      scheduleAutosave(first);
      vi.advanceTimersByTime(2000);
      expect(readAutosave()!.history).toBeDefined();

      // A later save with an empty stack must take the old history down with it.
      useEditorStore.setState({ commandExecutor: null });
      scheduleAutosave(makeWorkingMap());
      vi.advanceTimersByTime(2000);
      expect(readAutosave()!.history).toBeUndefined();
    });

    it('clearAutosave forgets the history too', () => {
      const state = makeWorkingMap();
      withHistory(state, 3);
      scheduleAutosave(state);
      vi.advanceTimersByTime(2000);
      clearAutosave();
      expect(localStorage.getItem('petit-planet-autosave-history')).toBeNull();
    });

    it('drops a history that does not fit the map it would be replayed into', () => {
      const state = makeWorkingMap();
      withHistory(state, 3);
      scheduleAutosave(state);
      vi.advanceTimersByTime(2000);

      // A snapshot outside the grid: undo replays entries with no rule validation, so the decoder
      // is the gate and one bad coordinate drops the whole section.
      const saved = JSON.parse(localStorage.getItem('petit-planet-autosave-history')!);
      saved.entries[0].after[0].coord = { x: 9999, y: 9999 };
      localStorage.setItem('petit-planet-autosave-history', JSON.stringify(saved));
      expect(readAutosave()!.history).toBeUndefined();
    });
  });

  it('walks a grid with a sparse row instead of throwing', () => {
    // The first-launch tour check calls this before anything has drawn, so a hole in a row has to
    // read as "no terrain here", not take the app down on startup.
    const state = makeWorkingMap();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a hole is exactly what a typed array cannot express
    state.cells[0] = [undefined as any, ...state.cells[0]!.slice(1)];
    expect(() => autosaveWorthy(state)).not.toThrow();
    expect(autosaveWorthy(state)).toBe(true); // the painted mountain is still found

    const empty: GridState = { ...state, cells: [[undefined as unknown as never]], objects: new Map() };
    expect(autosaveWorthy(empty)).toBe(false);
  });
});
