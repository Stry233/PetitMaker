// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../editor/host/host', () => ({
  host: { camera: { get2d: () => undefined, get3d: () => undefined } },
}));

import { createAutosave, readAutosave, readRestorableAutosave } from '../../../io/storage/autosave';
import { AUTOSAVE_DEBOUNCE_MS, hasAutosave, autosaveWorthy } from '../../../io/storage/facts';
import { autosave } from '../../../editor/session/autosave';
import { gzipSync } from 'fflate';
import { serialize } from '../../../io/save/json-codec';
import { openSave } from '../../../io/import/open-save';
import { COMPRESS_RECORD_AT, encodeRecord } from '../../../io/storage/record-codec';
import { encodeHistory } from '../../../io/save/history-codec';
import { CURRENT_VERSION } from '../../../io/save/format';
import { DEFAULT_MAP } from '../../../config/maps';
import { createGrid } from '../../../core/model/grid-model';
import { createGridState } from '../../../core/model/template';
import { CommandType, TerrainType, type GridState } from '../../../core/model/types';
import { CellZone } from '../../../core/game/zones';
import { host } from '../../../editor/host/host';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { createDefaultRegistry } from '../../../rules/index';
import { useEditorStore } from '../../../state/store';
import { makeExecutor } from '../../_support/map-state';
import { createExecutor } from '../../../state/executor';

const STORAGE_KEY = 'petit-planet-autosave';

// The runner needs an in-memory Web Storage implementation for persistence assertions.
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
  const state = createGridState(DEFAULT_MAP);
  for (let y = 0; y < DEFAULT_MAP.height; y++) {
    for (let x = 0; x < DEFAULT_MAP.width; x++) {
      if (DEFAULT_MAP.zones[y]?.[x] === CellZone.Grass) {
        state.cells[y]![x] = { zone: CellZone.Grass, terrain: { type: TerrainType.Mountain, elevation: 3 } };
        return state;
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
    autosave.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    host.camera.get2d = () => undefined;
    host.camera.get3d = () => undefined;
  });

  it('debounces, then persists a restorable map', () => {
    const state = makeWorkingMap();
    autosave.schedule(state);
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

  it.each(['terrain', 'object', 'annotation'] as const)('persists deletion of the final %s', kind => {
    const state = makeWorkingMap();
    if (kind !== 'terrain') state.cells = createGrid(DEFAULT_MAP);
    if (kind === 'object') state.objects.set('road', {
      id: 'road', catalogId: 'path-garden-stone', position: { x: 20, y: 20 }, rotation: 0, elevation: 0,
    });
    if (kind === 'annotation') state.annotations = {
      items: [{ kind: 'zone', id: 'zone', cells: [{ x: 20, y: 20 }], color: '#FF8A7A', tag: null, num: 1 }],
      visible: true, locked: false,
    };
    autosave.schedule(state);
    vi.advanceTimersByTime(2000);
    expect(readRestorableAutosave()).not.toBeNull();
    state.cells = createGrid(DEFAULT_MAP);
    state.objects.clear();
    state.annotations = undefined;
    autosave.schedule(state);
    vi.advanceTimersByTime(2000);
    expect(autosaveWorthy(readAutosave()!.state)).toBe(false);
    expect(readRestorableAutosave()).toBeNull();
  });

  it('protects a pending restore during empty initialization but persists an empty replacement', () => {
    const previous = serialize(makeWorkingMap());
    localStorage.setItem(STORAGE_KEY, previous);
    const empty = { ...makeWorkingMap(), cells: createGrid(DEFAULT_MAP) };
    autosave.schedule(empty, 'initialize');
    vi.advanceTimersByTime(2000);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(previous);
    autosave.schedule(empty);
    autosave.schedule(empty, 'initialize');
    vi.advanceTimersByTime(2000);
    expect(autosaveWorthy(readAutosave()!.state)).toBe(false);
  });

  it('offers an empty map with undo history and can undo its last deletion', () => {
    const state = { ...makeWorkingMap(), cells: createGrid(DEFAULT_MAP) };
    const object = { id: 'road', catalogId: 'path-garden-stone', position: { x: 20, y: 20 }, rotation: 0 as const, elevation: 0 };
    state.objects.set(object.id, object);
    const exec = makeExecutor(state);
    expect(exec.execute({ type: CommandType.RemoveObject, objectId: object.id }).success).toBe(true);
    useEditorStore.setState({ commandExecutor: exec });
    try {
      autosave.schedule(state);
      vi.advanceTimersByTime(2000);
      const restored = readRestorableAutosave();
      expect(restored).not.toBeNull();
      expect(autosaveWorthy(restored!.state)).toBe(false);
      const fresh = createExecutor(restored!.state, createDefaultRegistry());
      fresh.restoreHistory(restored!.history!);
      fresh.undo();
      expect(restored!.state.objects.get(object.id)).toEqual(object);
    } finally {
      useEditorStore.setState({ commandExecutor: null });
    }
  });

  it('restores both the print and its paved terrain background across repeated resumes', () => {
    let state = makeWorkingMap();
    const y = state.cells.findIndex(row => row.some(cell => cell.terrain));
    const x = state.cells[y]!.findIndex(cell => cell.terrain);
    for (const [id, catalogId] of [['pavement', 'path-garden-stone'], ['print', 'print-field-line']] as const) {
      state.objects.set(id, { id, catalogId, position: { x, y }, elevation: 3, rotation: 0 });
    }
    const terrain = structuredClone(state.cells[y]![x]!.terrain);
    for (let attempt = 0; attempt < 3; attempt++) {
      autosave.schedule(state);
      vi.advanceTimersByTime(2000);
      const restored = readAutosave();
      expect(restored).not.toBeNull();
      state = restored!.state;
      expect(state.objects.get('pavement')?.catalogId).toBe('path-garden-stone');
      expect(state.objects.get('print')?.catalogId).toBe('print-field-line');
      expect(state.cells[y]![x]!.terrain).toEqual(terrain);
    }
  });

  it('restores a half-cell anchor (it rides json-codec, so there is nothing of its own to do)', () => {
    const state = makeWorkingMap();
    state.objects.set('r', {
      id: 'r', catalogId: 'ramp-plank', position: { x: 12.5, y: 20 }, rotation: 0, elevation: 1,
    });
    autosave.schedule(state);
    vi.advanceTimersByTime(2000);

    expect(readAutosave()!.state.objects.get('r')!.position).toEqual({ x: 12.5, y: 20 });
  });

  describe('camera (resume from last restores the view too)', () => {
    it('persists and restores the 2D and 3D cameras independently', () => {
      host.camera.get2d = () => ({ x: 111, y: -22, zoom: 1.4 });
      host.camera.get3d = () => ({ az: 30, el: 20, dist: 0.7, tx: 1, tz: -1 });
      autosave.schedule(makeWorkingMap());
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
      autosave.schedule(makeWorkingMap());
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
      autosave.schedule(makeWorkingMap());
      vi.advanceTimersByTime(1000); // still inside the debounce window — no write yet
      expect(hasAutosave()).toBe(false);

      // The user pans/zooms; nothing schedules an autosave for this (a camera move must not create
      // a new write on its own — see io/storage/autosave.ts's currentCamera doc).
      host.camera.get2d = () => ({ x: 999, y: 999, zoom: 2 });
      vi.advanceTimersByTime(1000); // the original debounce now fires

      expect(hasAutosave()).toBe(true); // exactly the one write the content edit scheduled
      expect(readAutosave()!.camera).toEqual({ view2d: { x: 999, y: 999, zoom: 2 } }); // the latest pose, not the stale one
    });
  });

  it('only the trailing call writes within the debounce window', () => {
    const state = makeWorkingMap();
    autosave.schedule(state);
    vi.advanceTimersByTime(1000);
    autosave.schedule(state); // resets the timer
    vi.advanceTimersByTime(1000);
    expect(hasAutosave()).toBe(false); // 1s after the second call — not fired yet
    vi.advanceTimersByTime(1000);
    expect(hasAutosave()).toBe(true);
  });

  it('returns null when there is nothing to restore', () => {
    expect(readAutosave()).toBeNull();
    expect(hasAutosave()).toBe(false);
  });

  it('returns null on a corrupt autosave, as a refusal it does not log', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    localStorage.setItem(STORAGE_KEY, '{not json');
    expect(readAutosave()).toBeNull();
    expect(errors).not.toHaveBeenCalled();
  });

  it('returns null for a compressed record cut short anywhere', () => {
    const record = encodeRecord(serialize(makeWorkingMap()).padEnd(COMPRESS_RECORD_AT + 10, ' '));
    expect(record.startsWith('petit-autosave:1:')).toBe(true);
    // Base64 padding is optional to the decoder, so every cut removes at least one data character.
    const body = record.replace(/=+$/, '');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const cut of [18, 40, Math.floor(body.length / 2), body.length - 8, body.length - 1]) {
      localStorage.setItem(STORAGE_KEY, body.slice(0, cut));
      expect(readAutosave(), `cut at ${cut}`).toBeNull();
    }
    expect(errors).not.toHaveBeenCalled();
    localStorage.setItem(STORAGE_KEY, record);
    expect(readAutosave()).not.toBeNull();
  });

  it('returns null for an autosave whose cell list was cut mid-run', () => {
    const save = JSON.parse(serialize(makeWorkingMap())) as { cells: string };
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...save, autosave: 1, cells: save.cells.slice(0, save.cells.lastIndexOf(',')) }));
    expect(readAutosave()).toBeNull();
  });

  it('restores the map without undo when its history entry was cut short', () => {
    const state = makeWorkingMap();
    const save = JSON.parse(serialize(state)) as Record<string, unknown>;
    const history = encodeHistory([{
      cmd: { type: CommandType.PaintTerrain, cells: [{ x: 1, y: 1 }], terrainType: TerrainType.Mountain, elevation: 1 },
      before: [{ coord: { x: 1, y: 1 }, cell: { zone: CellZone.Grass, terrain: null } }],
      after: [],
    }], 'all');
    const { after: _after, ...cut } = history.entries[0]!;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...save, autosave: 1, history: { ...history, entries: [cut] } }));
    const restored = readAutosave();
    expect(restored).not.toBeNull();
    expect(restored!.history).toBeUndefined();
    expect(JSON.parse(serialize(restored!.state)).cells).toBe(save.cells);
  });

  it('returns null on an autosave from a newer format version', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: CURRENT_VERSION + 1, templateId: DEFAULT_MAP.id, cells: '', objects: [], metadata: { savedAt: '' } }),
    );
    expect(readAutosave()).toBeNull();
  });

  it('clearing forgets the saved map', () => {
    autosave.schedule(makeWorkingMap());
    vi.advanceTimersByTime(2000);
    expect(hasAutosave()).toBe(true);
    autosave.clear();
    expect(hasAutosave()).toBe(false);
    expect(readAutosave()).toBeNull();
  });

  describe('undo history rides along', () => {
    /** A live executor over `state` with `steps` painted commands behind it, installed on the store
     *  the way the app has one — `currentHistory` reads it there, live, at write time. */
    function withHistory(state: GridState, steps: number): CommandExecutor {
      const exec = makeExecutor(state);
      let laid = 0;
      for (let y = 0; y < DEFAULT_MAP.height && laid < steps; y++) {
        for (let x = 0; x < DEFAULT_MAP.width && laid < steps; x++) {
          if (DEFAULT_MAP.zones[y]?.[x] !== CellZone.Grass) continue;
          const before = exec.historyDepth();
          exec.execute({
            type: CommandType.PaintTerrain,             cells: [{ x, y }], terrainType: TerrainType.Mountain, elevation: 1,
          });
          if (exec.historyDepth() > before) laid++;
        }
      }
      expect(exec.historyDepth()).toBeGreaterThan(0);
      useEditorStore.setState({ commandExecutor: exec });
      return exec;
    }

    afterEach(() => { useEditorStore.setState({ commandExecutor: null }); });

    it('persists the undo stack beside the map and restores it', () => {
      const state = makeWorkingMap();
      const exec = withHistory(state, 5);
      autosave.schedule(state);
      vi.advanceTimersByTime(2000);

      const restored = readAutosave();
      expect(restored!.history).toHaveLength(exec.historyDepth());
      // Restorable onto a fresh executor, which is what the resume flow does.
      const fresh = createExecutor(restored!.state, createDefaultRegistry());
      expect(fresh.canUndo()).toBe(false);
      fresh.restoreHistory(restored!.history!);
      expect(fresh.canUndo()).toBe(true);
      expect(fresh.historyDepth()).toBe(exec.historyDepth());
    });

    it('restores legacy map and separate history records', () => {
      const state = makeWorkingMap();
      const executor = withHistory(state, 5);
      localStorage.setItem(STORAGE_KEY, serialize(state));
      localStorage.setItem('petit-planet-autosave-history', JSON.stringify(encodeHistory(executor.getUndoEntries(), 60)));
      expect(readAutosave()?.history).toHaveLength(executor.historyDepth());
    });

    it('keeps only the most recent HISTORY_STEPS entries', () => {
      const state = makeWorkingMap();
      const exec = withHistory(state, 70);
      expect(exec.historyDepth()).toBeGreaterThan(60);
      autosave.schedule(state);
      vi.advanceTimersByTime(2000);
      expect(readAutosave()!.history).toHaveLength(60);
    });

    it('a map with no history restores with none, not with the last map\'s', () => {
      const first = makeWorkingMap();
      withHistory(first, 3);
      autosave.schedule(first);
      vi.advanceTimersByTime(2000);
      expect(readAutosave()!.history).toBeDefined();

      // A later save with an empty stack must take the old history down with it.
      useEditorStore.setState({ commandExecutor: null });
      autosave.schedule(makeWorkingMap());
      vi.advanceTimersByTime(2000);
      expect(readAutosave()!.history).toBeUndefined();
    });

    it('clearing forgets the history too', () => {
      const state = makeWorkingMap();
      withHistory(state, 3);
      autosave.schedule(state);
      vi.advanceTimersByTime(2000);
      autosave.clear();
      expect(localStorage.getItem('petit-planet-autosave-history')).toBeNull();
    });

    it('drops a history that does not fit the map it would be replayed into', () => {
      const state = makeWorkingMap();
      withHistory(state, 3);
      autosave.schedule(state);
      vi.advanceTimersByTime(2000);

      // A snapshot outside the grid: undo replays entries with no rule validation, so the decoder
      // is the gate and one bad coordinate drops the whole section.
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
      saved.history.entries[0].after[0].coord = { x: 9999, y: 9999 };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
      expect(readAutosave()!.history).toBeUndefined();
    });
  });

  it('retries the current map immediately after reclaiming obsolete legacy history', () => {
    localStorage.setItem(STORAGE_KEY, serialize(makeWorkingMap()));
    localStorage.setItem('petit-planet-autosave-history', 'occupies remaining quota');
    const original = localStorage.setItem.bind(localStorage);
    vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
      if (key === STORAGE_KEY && localStorage.getItem('petit-planet-autosave-history')) throw new DOMException('Full', 'QuotaExceededError');
      original(key, value);
    });
    host.camera.get2d = () => ({ x: 99, y: 0, zoom: 1 });
    autosave.schedule(makeWorkingMap());
    vi.advanceTimersByTime(2000);
    expect(readAutosave()?.camera?.view2d?.x).toBe(99);
    expect(localStorage.getItem('petit-planet-autosave-history')).toBeNull();
  });

  it('keeps the previous map and history when every replacement exceeds quota', () => {
    const previous = serialize(makeWorkingMap());
    localStorage.setItem(STORAGE_KEY, previous);
    localStorage.setItem('petit-planet-autosave-history', 'old history');
    const original = localStorage.setItem.bind(localStorage);
    vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
      if (key === STORAGE_KEY) throw new DOMException('Full', 'QuotaExceededError');
      original(key, value);
    });
    autosave.schedule(makeWorkingMap());
    vi.advanceTimersByTime(2000);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(previous);
    expect(localStorage.getItem('petit-planet-autosave-history')).toBe('old history');
  });

  it('keeps an earlier empty map stored until a large map\'s compressed save lands, then restores the large map', async () => {
    vi.stubGlobal('Worker', class {
      onmessage?: (event: { data: Uint8Array }) => void;
      terminate() {}
      postMessage(input: Uint8Array) { const bytes = gzipSync(input, { level: 1 }); queueMicrotask(() => this.onmessage?.({ data: bytes })); }
    });
    autosave.schedule({ ...makeWorkingMap(), cells: createGrid(DEFAULT_MAP) });
    vi.advanceTimersByTime(2000);
    expect(hasAutosave()).toBe(true);
    expect(readRestorableAutosave()).toBeNull();

    const large: GridState = { ...makeWorkingMap(), cells: createGrid(DEFAULT_MAP), objects: new Map() };
    let painted = 0;
    for (let y = 0; y < DEFAULT_MAP.height; y++) for (let x = 0; x < DEFAULT_MAP.width; x++) {
      if (DEFAULT_MAP.zones[y]?.[x] !== CellZone.Grass) continue;
      if (painted % 2) large.objects.set(`road-${x}-${y}`, { id: `road-${x}-${y}`, catalogId: 'path-garden-stone', position: { x, y }, rotation: 0, elevation: 0 });
      else large.cells[y]![x] = { zone: CellZone.Grass, terrain: { type: TerrainType.Mountain, elevation: 1 + (painted / 2) % 3 } };
      painted++;
    }
    expect(serialize(large).length).toBeGreaterThan(COMPRESS_RECORD_AT);
    autosave.schedule(large);
    expect(hasAutosave()).toBe(true);
    expect(readRestorableAutosave()).toBeNull();
    vi.advanceTimersByTime(2000);
    expect(readRestorableAutosave()).toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    const restored = readRestorableAutosave();
    const loaded = openSave(serialize(large), DEFAULT_MAP);
    expect(localStorage.getItem(STORAGE_KEY)!.startsWith('petit-autosave:1:')).toBe(true);
    expect(JSON.parse(serialize(restored!.state)).cells === JSON.parse(serialize(loaded)).cells).toBe(true);
    expect(restored!.state.objects.size).toBe(loaded.objects.size);
    expect(loaded.objects.size).toBeGreaterThan(1000);
  });

  it('clearing a pending save prevents it from reappearing', () => {
    autosave.schedule(makeWorkingMap());
    autosave.clear();
    vi.advanceTimersByTime(4000);
    expect(hasAutosave()).toBe(false);
  });

  it('ignores unrelated legacy history when an atomic snapshot has none', () => {
    autosave.schedule(makeWorkingMap());
    vi.advanceTimersByTime(2000);
    localStorage.setItem('petit-planet-autosave-history', '{"v":1,"entries":[]}');
    expect(readAutosave()?.history).toBeUndefined();
  });

  describe('backgrounding the tab', () => {
    /** Report the page as hidden, as a phone browser does when the tab leaves the screen. */
    function hide(): void {
      const was = Object.getOwnPropertyDescriptor(document, 'visibilityState');
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      if (was) Object.defineProperty(document, 'visibilityState', was);
      else delete (document as unknown as Record<string, unknown>).visibilityState;
    }

    it('writes the pending save instead of losing it to the debounce', () => {
      // A phone can discard the tab before the 2 s debounce fires, taking the last edits with it.
      autosave.schedule(makeWorkingMap());
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
      hide();
      expect(hasAutosave()).toBe(true);
      expect(readAutosave()?.state.template.id).toBe(DEFAULT_MAP.id);
    });

    it('writes the pending save when the page is being unloaded', () => {
      autosave.schedule(makeWorkingMap());
      window.dispatchEvent(new Event('pagehide'));
      expect(hasAutosave()).toBe(true);
    });

    it('leaves the debounce alone while the page is still visible', () => {
      autosave.schedule(makeWorkingMap());
      document.dispatchEvent(new Event('visibilitychange'));
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
      vi.advanceTimersByTime(2000);
      expect(hasAutosave()).toBe(true);
    });

    it('does not write again for a save the debounce already made', () => {
      autosave.schedule(makeWorkingMap());
      vi.advanceTimersByTime(2000);
      const written = localStorage.getItem(STORAGE_KEY);
      const setItem = vi.spyOn(localStorage, 'setItem');
      hide();
      expect(setItem).not.toHaveBeenCalled();
      expect(localStorage.getItem(STORAGE_KEY)).toBe(written);
    });

    it('drops a cleared save rather than resurrecting it', () => {
      autosave.schedule(makeWorkingMap());
      autosave.clear();
      hide();
      expect(hasAutosave()).toBe(false);
    });
  });

  it('walks a grid with a sparse row instead of throwing', () => {
    // The first-launch tour check calls this before anything has drawn, so a hole in a row has to
    // read as "no terrain here", not take the app down on startup.
    const state = makeWorkingMap();
    // A hole is exactly what a typed array cannot express.
    state.cells[0] = [undefined as any, ...state.cells[0]!.slice(1)];
    expect(() => autosaveWorthy(state)).not.toThrow();
    expect(autosaveWorthy(state)).toBe(true); // the painted mountain is still found

    const empty: GridState = { ...state, cells: [[undefined as unknown as never]], objects: new Map() };
    expect(autosaveWorthy(empty)).toBe(false);
  });
});

describe('autosave restore faults', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.doUnmock('../../../io/import/open-save');
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('logs a fault in the restore path and offers nothing', async () => {
    vi.resetModules();
    const bug = new TypeError('decoder bug');
    vi.doMock('../../../io/import/open-save', () => ({ loadParsedSave: () => { throw bug; } }));
    const fresh = await import('../../../io/storage/autosave');
    localStorage.setItem(STORAGE_KEY, serialize(makeWorkingMap()));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(fresh.readAutosave()).toBeNull();
    expect(errors).toHaveBeenCalledWith('[autosave] restore failed', bug);
  });
});

describe('createAutosave', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('writes the camera and undo stack its sources report at write time', () => {
    const state = makeWorkingMap();
    const executor = makeExecutor(state);
    const own = createAutosave({ camera: () => camera, history: (s) => (s === state ? executor.getUndoEntries() : undefined) });
    let camera: { view2d: { x: number; y: number; zoom: number } } | undefined;
    own.schedule(state);
    const grass = DEFAULT_MAP.zones.flatMap((row, y) => row.map((zone, x) => ({ x, y, zone }))).filter((c) => c.zone === CellZone.Grass);
    for (const c of grass) {
      if (executor.execute(
        { type: CommandType.PaintTerrain, cells: [{ x: c.x, y: c.y }], terrainType: TerrainType.Mountain, elevation: 1 },
      ).success && executor.getUndoEntries().length) break;
    }
    expect(executor.getUndoEntries().length).toBeGreaterThan(0);
    camera = { view2d: { x: 3, y: 4, zoom: 2 } };
    vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
    const restored = readAutosave();
    expect(restored?.camera).toEqual(camera);
    expect(restored?.history?.length ?? 0).toBe(executor.getUndoEntries().length);
    own.clear();
    expect(hasAutosave()).toBe(false);
  });
});
