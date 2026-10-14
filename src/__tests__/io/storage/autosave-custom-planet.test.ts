import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../editor/host/host', () => ({
  host: { camera: { get2d: () => undefined, get3d: () => undefined } },
}));

import { readAutosave, readRestorableAutosave } from '../../../io/storage/autosave';
import { autosaveWorthy } from '../../../io/storage/facts';
import { autosave } from '../../../editor/session/autosave';
import { listPlanets } from '../../../io/storage/planet-library';
import { serializeTemplate } from '../../../io/save/planet-codec';
import { decodeRecord } from '../../../io/storage/record-codec';
import { createGridState } from '../../../core/model/template';
import { planetFixture } from '../../_support/planet';
import { DEFAULT_MAP } from '../../../config/maps';
import { TerrainType } from '../../../core/model/types';
import { CellZone } from '../../../core/game/zones';

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

const storedTemplate = () => (JSON.parse(decodeRecord(storage.getItem(STORAGE_KEY)!)) as { template?: unknown }).template;

describe('autosave on a custom planet', () => {
  beforeEach(() => {
    storage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    autosave.clear();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('counts an empty custom planet as worth saving', () => {
    expect(autosaveWorthy(createGridState(planetFixture()))).toBe(true);
  });

  it('flushes an empty planet and restores it without a library', () => {
    const t = planetFixture();
    autosave.schedule(createGridState(t));
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
    autosave.flush();
    expect(readAutosave()?.state.template.id).toBe(t.id);
  });

  it('adds nothing to the planet library while offering or declining a restore', () => {
    autosave.schedule(createGridState(planetFixture()));
    autosave.flush();
    expect(readRestorableAutosave()).not.toBeNull();
    expect(readAutosave()).not.toBeNull();
    expect(listPlanets()).toEqual([]);
  });

  it('restores painted cells', () => {
    autosave.schedule(paintedPlanet());
    autosave.flush();
    expect(readAutosave()?.state.cells[8]![8]!.terrain?.elevation).toBe(1);
  });

  it('keeps the template through each quota fallback step', () => {
    for (const failures of [2, 4]) {
      storage.clear();
      vi.restoreAllMocks();
      failMapWrites(failures);
      autosave.schedule(paintedPlanet());
      autosave.flush();
      expect(storedTemplate()).toEqual(serializeTemplate(planetFixture()));
      expect(readAutosave()?.state.template.id).toBe(planetFixture().id);
    }
  });

  it('reads null for an invalid embedded template', () => {
    autosave.schedule(paintedPlanet());
    autosave.flush();
    const raw = JSON.parse(decodeRecord(storage.getItem(STORAGE_KEY)!));
    raw.template.zones = raw.template.zones.replace(/2/, '7');
    storage.setItem(STORAGE_KEY, JSON.stringify(raw));
    expect(readAutosave()).toBeNull();
  });

  it('restores a record without a template id on the default map', () => {
    const state = createGridState(DEFAULT_MAP);
    const spot = state.cells.flatMap((row, y) => row.map((c, x) => ({ c, x, y }))).find(({ c }) => c.zone === CellZone.Grass)!;
    spot.c.terrain = { type: TerrainType.Mountain, elevation: 1 };
    autosave.schedule(state);
    autosave.flush();
    const raw = JSON.parse(decodeRecord(storage.getItem(STORAGE_KEY)!));
    delete raw.templateId;
    storage.setItem(STORAGE_KEY, JSON.stringify(raw));
    expect(readAutosave()?.state.template.id).toBe(DEFAULT_MAP.id);
  });

  it('reads null for an unknown custom id without an embedded template', () => {
    autosave.schedule(paintedPlanet());
    autosave.flush();
    const raw = JSON.parse(decodeRecord(storage.getItem(STORAGE_KEY)!));
    delete raw.template;
    storage.setItem(STORAGE_KEY, JSON.stringify(raw));
    expect(readAutosave()).toBeNull();
  });
});
