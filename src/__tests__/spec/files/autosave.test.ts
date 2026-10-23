// @vitest-environment jsdom
/** The session this browser keeps: written shortly after each edit, offered back at the next start. */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, vi } from 'vitest';
import { spec } from '../../_support/spec';
import { createAutosave } from '../../../io/storage/autosave';
import { AUTOSAVE_DEBOUNCE_MS } from '../../../io/storage/facts';
import { listPlanets } from '../../../io/storage/planet-library';
import { readRestoreOffer, restoreSession } from '../../../editor/session/restore';
import { useEditorStore } from '../../../state/store';
import { PREFS } from '../../../platform/storage/prefs';
import { CURRENT_VERSION } from '../../../io/save/format';
import { RETIRED_CATALOG_IDS } from '../../../config/catalog/retired-ids';
import { createGridState } from '../../../core/model/template';
import { placeObjectCommand } from '../../../core/model/command-build';
import { candidateObject } from '../../../tools/objects';
import { getCatalogItem } from '../../../state/catalog';
import { createExecutor } from '../../../state/executor';
import { createDefaultRegistry } from '../../../rules';
import type { GridState } from '../../../core/model/types';
import { planetFixture } from '../../_support/planet';
import { TerrainType, rect, type SpecWorld } from '../_world';
import { builtMap, seen } from './_files';

const CAMERA = { view2d: { x: 40, y: -12, zoom: 1.5 }, view3d: { az: 30, el: 25, dist: 0.6, tx: 2, tz: -3 } };
const stored = (): string | null => localStorage.getItem(PREFS.autosave.key);

/** The page's autosave over `w`: both views opened at `CAMERA`, the undo steps of `w`'s editor. */
const autosaveOf = (w: SpecWorld) => createAutosave({
  camera: () => CAMERA,
  history: (state) => (state === w.state ? w.sandbox.executor.getUndoEntries() : undefined),
});

/** Resumes the offered session as the start offer's Resume does; the editor it installs. */
function resume() {
  const offer = readRestoreOffer();
  if (!offer) throw new Error('no session offered');
  restoreSession(offer);
  const { gridState, commandExecutor } = useEditorStore.getState();
  return { offer, state: gridState!, executor: commandExecutor! };
}

/** The stored record as JSON, rewritten by `edit`. */
function rewrite(edit: (record: Record<string, unknown>) => void): void {
  const record = JSON.parse(stored()!) as Record<string, unknown>;
  edit(record);
  localStorage.setItem(PREFS.autosave.key, JSON.stringify(record));
}

function hide(): void {
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
  delete (document as unknown as Record<string, unknown>).visibilityState;
}

beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); localStorage.clear(); });

describe('the autosaved session', () => {
  spec('FILE-16', 'is written shortly after an edit, with the map, both cameras and the last 60 undo steps', () => {
    const w = builtMap();
    const at = w.openGround(13, 6);
    let afterFive = '';
    for (let i = 0; i < 65; i++) {
      expect(w.stroke([{ x: at.x + (i % 13), y: at.y + Math.floor(i / 13) }], TerrainType.Mountain, 1).ok).toBe(true);
      if (i === 4) afterFive = seen(w.state);
    }
    const autosave = autosaveOf(w);
    autosave.schedule(w.state);
    expect(stored()).toBeNull();
    vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
    expect(stored()).not.toBeNull();

    const { offer, state, executor } = resume();
    expect(seen(state)).toBe(seen(w.state));
    expect(offer.camera).toEqual(CAMERA);
    expect(offer.history).toHaveLength(60);
    for (let i = 0; i < 60; i++) expect(executor.undo()).toBe(true);
    expect(executor.canUndo()).toBe(false);
    expect(seen(state)).toBe(afterFive);
  });

  spec('FILE-16', 'is written at once when the tab is hidden or closed', () => {
    const w = builtMap();
    const autosave = autosaveOf(w);
    autosave.schedule(w.state);
    hide();
    expect(seen(readRestoreOffer()!.state)).toBe(seen(w.state));

    localStorage.clear();
    w.stroke(rect(w.openGround(3, 3), 3, 3), TerrainType.Mountain, 1);
    autosave.schedule(w.state);
    window.dispatchEvent(new Event('pagehide'));
    expect(seen(readRestoreOffer()!.state)).toBe(seen(w.state));
  });

  spec('FILE-17', 'is offered at start and resumes with its map, cameras and undo, never overwritten by the empty starting map', () => {
    expect(readRestoreOffer()).toBeNull();
    const w = builtMap();
    autosaveOf(w).schedule(w.state);
    vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
    const session = stored();

    // The next start opens on an empty map, which the editor's autosave sees first.
    const fresh = createGridState(w.state.template);
    const startup = createAutosave({ camera: () => undefined, history: () => undefined });
    startup.schedule(fresh, 'initialize');
    vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
    expect(stored()).toBe(session);

    const { offer, state, executor } = resume();
    expect(seen(state)).toBe(seen(w.state));
    expect(offer.camera).toEqual(CAMERA);
    expect(executor.canUndo()).toBe(true);
    while (executor.undo());
    expect(seen(state)).toBe(seen(fresh));
  });

  spec('FILE-18', 'offers nothing when damaged or written by a newer version, and restores without undo a history that is damaged or does not fit', () => {
    const w = builtMap();
    const save = () => { autosaveOf(w).schedule(w.state); vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS); };

    save();
    localStorage.setItem(PREFS.autosave.key, stored()!.slice(0, Math.floor(stored()!.length / 2)));
    expect(readRestoreOffer()).toBeNull();

    save();
    rewrite((record) => { record.version = CURRENT_VERSION + 1; });
    expect(readRestoreOffer()).toBeNull();

    save();
    rewrite((record) => {
      const { after: _after, ...cut } = (record.history as { entries: Record<string, unknown>[] }).entries[0]!;
      (record.history as { entries: unknown[] }).entries[0] = cut;
    });
    const damaged = readRestoreOffer()!;
    expect(seen(damaged.state)).toBe(seen(w.state));
    expect(damaged.history).toBeUndefined();

    save();
    rewrite((record) => {
      const entries = (record.history as { entries: { after: { coord: unknown }[] }[] }).entries;
      const step = entries.find((e) => e.after.length > 0)!;
      step.after[0]!.coord = { x: 9999, y: 9999 };
    });
    const misfit = readRestoreOffer()!;
    expect(seen(misfit.state)).toBe(seen(w.state));
    expect(misfit.history).toBeUndefined();
  });

  spec('FILE-19', 'keeps the session stored before when storage cannot hold a new one', () => {
    const w = builtMap();
    const autosave = autosaveOf(w);
    autosave.schedule(w.state);
    vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
    const before = seen(w.state);

    w.stroke(rect(w.openGround(3, 3), 3, 3), TerrainType.Mountain, 1);
    // jsdom reads a property set on its storage as a stored item, so the browser's quota is met on the prototype.
    const write = Storage.prototype.setItem;
    const full = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === PREFS.autosave.key) throw new DOMException('Full', 'QuotaExceededError');
      write.call(this, key, value);
    });
    autosave.schedule(w.state);
    vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
    full.mockRestore();
    expect(seen(readRestoreOffer()!.state)).toBe(before);
    expect(readRestoreOffer()!.history?.length).toBeGreaterThan(0);
  });

  spec('FILE-20', 'restores a session on a custom planet that My planets does not hold', () => {
    const planet = planetFixture();
    const state: GridState = createGridState(planet);
    const executor = createExecutor(state, createDefaultRegistry());
    const tree = candidateObject(getCatalogItem('tree-apple')!, { x: 38, y: 26 }, 0, state, { id: 'tree' });
    expect(executor.execute(placeObjectCommand(tree)).success).toBe(true);
    createAutosave({ camera: () => undefined, history: () => executor.getUndoEntries() }).schedule(state);
    vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);

    expect(listPlanets()).toEqual([]);
    const offer = readRestoreOffer()!;
    expect(offer.state.template.id).toBe(planet.id);
    expect(offer.state.template.zones).toEqual(planet.zones);
    expect(seen(offer.state)).toBe(seen(state));
  });

  spec('FILE-14', 'restores an autosave holding retired roads with the items that replaced them', () => {
    const text = gunzipSync(readFileSync('src/__tests__/fixtures/saves/release-0.4.149-tafa-complex.json.gz')).toString('utf8');
    localStorage.setItem(PREFS.autosave.key, text);
    const offer = readRestoreOffer()!;
    const objects = [...offer.state.objects.values(), ...(offer.cleared?.report?.objects ?? []).map((o) => o.object)];
    expect(objects.some((o) => Object.hasOwn(RETIRED_CATALOG_IDS, o.catalogId))).toBe(false);
    expect(objects.filter((o) => Object.values(RETIRED_CATALOG_IDS).includes(o.catalogId)).length).toBeGreaterThan(100);
  });
});
