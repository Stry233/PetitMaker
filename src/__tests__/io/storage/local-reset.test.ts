// @vitest-environment jsdom
/** Local-data reset: everything this origin persists must be gone after the wipe. */
import { describe, it, expect, vi } from 'vitest';

// jsdom's localStorage descriptor is flaky under some node versions (see
// key-storage.test.ts) — stub a plain in-memory implementation.
const mem = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
});
vi.stubGlobal('sessionStorage', {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {},
});

describe('wipeLocalData', () => {
  it('clears every persisted key and survives the missing IndexedDB vault', async () => {
    const { wipeLocalData } = await import('../../../io/storage/local-reset');
    const { autosave } = await import('../../../editor/session/autosave');
    localStorage.setItem('petit-agent-settings-v1', '{"keys":{"claude":"c2stc2VjcmV0"}}');
    localStorage.setItem('petit-planet-autosave', '{"cells":[]}');
    localStorage.setItem('petit-planet-locale', 'en');
    localStorage.setItem('petit-planet-ui-zoom', '1.2');

    await wipeLocalData(autosave); // deleteVault resolves even with no indexedDB (jsdom)

    expect(localStorage.getItem('petit-agent-settings-v1')).toBeNull();
    expect(localStorage.getItem('petit-planet-autosave')).toBeNull();
    expect(localStorage.getItem('petit-planet-locale')).toBeNull();
    expect(localStorage.getItem('petit-planet-ui-zoom')).toBeNull();
  });
});

describe('an autosave still owed when the wipe runs', () => {
  async function owedThenWiped() {
    const { autosave } = await import('../../../editor/session/autosave');
    const { wipeLocalData } = await import('../../../io/storage/local-reset');
    const { createGridState } = await import('../../../core/model/template');
    const { resolveTemplate } = await import('../../../config/maps/resolve');
    const { readStoredPref } = await import('../../../platform/storage/prefs');
    const { TerrainType } = await import('../../../core/model/types');
    mem.clear();
    const state = createGridState(resolveTemplate(undefined));
    state.cells[30]![30]!.terrain = { type: TerrainType.Mountain, elevation: 2 };
    autosave.schedule(state);
    await wipeLocalData(autosave);
    const stored = () => { const r = readStoredPref('autosave'); return r.available ? r.raw : null; };
    return { stored, isSuspended: autosave.isSuspended, setSuspended: autosave.setSuspended };
  }

  it('is not written by the reload\'s pagehide', async () => {
    const { stored, isSuspended, setSuspended } = await owedThenWiped();
    window.dispatchEvent(new Event('pagehide'));
    expect(stored()).toBeNull();
    expect(isSuspended()).toBe(true);
    setSuspended(false);
  });

  it('is not written when its debounce fires after the wipe', async () => {
    vi.useFakeTimers();
    try {
      const { stored, setSuspended } = await owedThenWiped();
      vi.advanceTimersByTime(10_000);
      expect(stored()).toBeNull();
      setSuspended(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
