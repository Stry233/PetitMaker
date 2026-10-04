import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../kit/host', () => ({
  host: { camera: { get2d: () => undefined, get3d: () => undefined } },
}));

import { scheduleAutosave, flushAutosave, readAutosave, readRestorableAutosave, clearAutosave, autosaveWorthy } from '../../io/autosave';
import { listPlanets } from '../../io/planet-library';
import { serializeTemplate } from '../../io/planet-codec';
import { decodeAutosave } from '../../io/autosave-codec';
import { createGridState } from '../../core/model/planet';
import { planetFixture } from '../fixtures/planet';
import { DEFAULT_MAP } from '../../config/maps';
import { CellZone, TerrainType } from '../../core/model/types';

const STORAGE_KEY = 'petit-planet-autosave';

class MemStorage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
}
const storage = new MemStorage();
Object.defineProperty(globalThis, 'localStorage', { value: storage, writable: true, configurable: true });

function paintedPlanet() {
  const state = createGridState(planetFixture());
  state.cells[8]![8]!.terrain = { type: TerrainType.Mountain, elevation: 1 };
  return state;
}

/** Makes the first `count` writes to the map key fail with a quota error. */
function failMapWrites(count: number) {
  const real = storage.setItem.bind(storage);
  let left = count;
  vi.spyOn(storage, 'setItem').mockImplementation((k: string, v: string) => {
    if (k === STORAGE_KEY && left > 0) {
      left--;
      throw new DOMException('full', 'QuotaExceededError');
    }
    real(k, v);
  });
}

const storedTemplate = () => (JSON.parse(decodeAutosave(storage.getItem(STORAGE_KEY)!)) as { template?: unknown }).template;

describe('autosave on a custom planet', () => {
  beforeEach(() => {
    storage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    clearAutosave();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('counts an empty custom planet as worth saving', () => {
    expect(autosaveWorthy(createGridState(planetFixture()))).toBe(true);
  });

  it('flushes an empty planet and restores it without a library', () => {
    const t = planetFixture();
    scheduleAutosave(createGridState(t));
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
    flushAutosave();
    expect(readAutosave()?.state.template.id).toBe(t.id);
  });

  it('adds nothing to the planet library while offering or declining a restore', () => {
    scheduleAutosave(createGridState(planetFixture()));
    flushAutosave();
    expect(readRestorableAutosave()).not.toBeNull();
    expect(readAutosave()).not.toBeNull();
    expect(listPlanets()).toEqual([]);
  });

  it('restores painted cells', () => {
    scheduleAutosave(paintedPlanet());
    flushAutosave();
    expect(readAutosave()?.state.cells[8]![8]!.terrain?.elevation).toBe(1);
  });

  it('keeps the template through each quota fallback step', () => {
    for (const failures of [2, 4]) {
      storage.clear();
      vi.restoreAllMocks();
      failMapWrites(failures);
      scheduleAutosave(paintedPlanet());
      flushAutosave();
      expect(storedTemplate()).toEqual(serializeTemplate(planetFixture()));
      expect(readAutosave()?.state.template.id).toBe(planetFixture().id);
    }
  });

  it('reads null for an invalid embedded template', () => {
    scheduleAutosave(paintedPlanet());
    flushAutosave();
    const raw = JSON.parse(decodeAutosave(storage.getItem(STORAGE_KEY)!));
    raw.template.zones = raw.template.zones.replace(/2/, '7');
    storage.setItem(STORAGE_KEY, JSON.stringify(raw));
    expect(readAutosave()).toBeNull();
  });

  it('restores a record without a template id on the default map', () => {
    const state = createGridState(DEFAULT_MAP);
    const spot = state.cells.flatMap((row, y) => row.map((c, x) => ({ c, x, y }))).find(({ c }) => c.zone === CellZone.Grass)!;
    spot.c.terrain = { type: TerrainType.Mountain, elevation: 1 };
    scheduleAutosave(state);
    flushAutosave();
    const raw = JSON.parse(decodeAutosave(storage.getItem(STORAGE_KEY)!));
    delete raw.templateId;
    storage.setItem(STORAGE_KEY, JSON.stringify(raw));
    expect(readAutosave()?.state.template.id).toBe(DEFAULT_MAP.id);
  });

  it('reads null for an unknown custom id without an embedded template', () => {
    scheduleAutosave(paintedPlanet());
    flushAutosave();
    const raw = JSON.parse(decodeAutosave(storage.getItem(STORAGE_KEY)!));
    delete raw.template;
    storage.setItem(STORAGE_KEY, JSON.stringify(raw));
    expect(readAutosave()).toBeNull();
  });
});
