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
    const { wipeLocalData } = await import('../../io/local-reset');
    localStorage.setItem('petit-agent-settings-v1', '{"keys":{"claude":"c2stc2VjcmV0"}}');
    localStorage.setItem('petit-planet-autosave', '{"cells":[]}');
    localStorage.setItem('petit-planet-locale', 'en');
    localStorage.setItem('petit-planet-ui-zoom', '1.2');

    await wipeLocalData(); // deleteVault resolves even with no indexedDB (jsdom)

    expect(localStorage.getItem('petit-agent-settings-v1')).toBeNull();
    expect(localStorage.getItem('petit-planet-autosave')).toBeNull();
    expect(localStorage.getItem('petit-planet-locale')).toBeNull();
    expect(localStorage.getItem('petit-planet-ui-zoom')).toBeNull();
  });
});
