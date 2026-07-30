import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { scheduleAutosave, readAutosave, clearAutosave, hasAutosave } from '../../io/autosave';
import { serialize } from '../../io/json-codec';
import { CURRENT_VERSION } from '../../io/save-format';
import { DEFAULT_MAP } from '../../config/maps';
import { createGrid } from '../../core/model/grid-model';
import { CellZone, TerrainType, type GridState } from '../../core/model/types';
import { petitWindow } from '../../core/runtime/window-bridge';

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
    delete petitWindow().__petitGetCamera;
    delete petitWindow().__petitGet3DCamera;
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

  describe('camera (resume from last restores the view too)', () => {
    it('persists and restores the 2D and 3D cameras independently', () => {
      petitWindow().__petitGetCamera = () => ({ x: 111, y: -22, zoom: 1.4 });
      petitWindow().__petitGet3DCamera = () => ({ az: 30, el: 20, dist: 0.7, tx: 1, tz: -1 });
      scheduleAutosave(makeWorkingMap());
      vi.advanceTimersByTime(2000);

      const restored = readAutosave();
      expect(restored!.camera).toEqual({
        view2d: { x: 111, y: -22, zoom: 1.4 },
        view3d: { az: 30, el: 20, dist: 0.7, tx: 1, tz: -1 },
      });
    });

    it('persists only the view(s) actually reported — a view never opened this session is simply absent', () => {
      petitWindow().__petitGetCamera = () => ({ x: 5, y: 5, zoom: 1 });
      // __petitGet3DCamera left unregistered: the 3D editor was never opened.
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
      petitWindow().__petitGetCamera = () => ({ x: 0, y: 0, zoom: 1 }); // pose at schedule time
      scheduleAutosave(makeWorkingMap());
      vi.advanceTimersByTime(1000); // still inside the debounce window — no write yet
      expect(hasAutosave()).toBe(false);

      // The user pans/zooms; nothing calls scheduleAutosave for this (a camera move must not create
      // a new write on its own — see io/autosave.ts's currentCamera doc).
      petitWindow().__petitGetCamera = () => ({ x: 999, y: 999, zoom: 2 });
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
});
