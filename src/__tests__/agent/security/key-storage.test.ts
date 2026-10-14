import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadAgentSettings, saveAgentSettings } from '../../../agent/security/settings-record';
import { newSealState, type SealState } from '../../../agent/security/key-storage';

// jsdom 25 under this node version exposes a localStorage descriptor that yields
// undefined, so back the global with a Map-based stub (same Storage surface).
const backing = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
});

describe('agent key storage', () => {
  beforeEach(() => backing.clear());

  it('round-trips and obfuscates keys (raw key not in storage)', () => {
    const s = loadAgentSettings();
    s.keys.openai = 'sk-test-123';
    s.provider = 'openai';
    saveAgentSettings(s, newSealState());
    expect([...backing.values()].join()).not.toContain('sk-test-123');
    expect(loadAgentSettings().keys.openai).toBe('sk-test-123');
    expect(loadAgentSettings().provider).toBe('openai');
  });
});

describe('sealed blob a locked vault could not open', () => {
  it('survives a keyless save (the keyring is empty because the vault declined, not because the user cleared it)', async () => {
    // jsdom has no IndexedDB, so `openSecret` declines exactly as it does in a private window or
    // on a profile carried to another machine: hydration finishes with nothing in hand while the
    // ciphertext is still on disk. A settings write must not take that as "cleared".
    vi.resetModules();
    const { loadAgentSettings, saveAgentSettings, hydrateSealedKeys } =
      { ...(await import('../../../agent/security/key-storage')), ...(await import('../../../agent/security/settings-record')) };
    backing.clear();
    const blob = { iv: 'AAAAAAAAAAAAAAAA', ct: 'ZmFrZS1jaXBoZXJ0ZXh0' };
    backing.set('petit-agent-settings-v1', JSON.stringify({ provider: 'openai', keysSealed: blob }));

    const seal = newSealState();
    expect(await hydrateSealedKeys(seal)).toBeNull();
    seal.hydrated = true;
    saveAgentSettings({ ...loadAgentSettings(), oversight: 'strict' }, seal);

    const rec = JSON.parse(backing.get('petit-agent-settings-v1') ?? 'null') as { keysSealed?: unknown };
    expect(rec.keysSealed).toEqual(blob);
  });
});

describe('sealed keys and the obfuscated fallback', () => {
  const SEALED = { iv: 'iv', ct: btoa(JSON.stringify({ openai: 'sk-live-1' })) };

  /** A readable vault: `openSecret` returns what `sealSecret` was given. */
  async function withFakeVault() {
    vi.resetModules();
    vi.doMock('../../../platform/storage/vault', () => ({
      sealSecret: (plain: string) => Promise.resolve({ iv: 'iv', ct: btoa(plain) }),
      openSecret: (blob: { ct: string }) => Promise.resolve(atob(blob.ct)),
    }));
    const mod = { ...(await import('../../../agent/security/key-storage')), ...(await import('../../../agent/security/settings-record')) };
    backing.clear();
    backing.set('petit-agent-settings-v1', JSON.stringify({ provider: 'openai', keysSealed: SEALED }));
    const seal = newSealState();
    expect(await mod.hydrateSealedKeys(seal)).toEqual({ openai: 'sk-live-1' });
    seal.hydrated = true;
    return { ...mod, seal };
  }

  function record(): { keys?: Record<string, string>; keysSealed?: unknown } {
    return JSON.parse(backing.get('petit-agent-settings-v1') ?? 'null') as { keys?: Record<string, string>; keysSealed?: unknown };
  }

  it('omits the obfuscated copy when the sealed blob already holds the same keys', async () => {
    const { loadAgentSettings, saveAgentSettings, seal } = await withFakeVault();
    const s = loadAgentSettings();
    saveAgentSettings({ ...s, keys: { openai: 'sk-live-1' }, model: { ...s.model, openai: 'gpt-4.1' } }, seal);

    expect(record().keys).toBeUndefined();
    expect(record().keysSealed).toEqual(SEALED);
    expect(backing.get('petit-agent-settings-v1')).not.toContain(btoa('sk-live-1'));
  });

  it('writes the obfuscated copy when the key set changed', async () => {
    const { loadAgentSettings, saveAgentSettings, seal } = await withFakeVault();
    const s = loadAgentSettings();
    saveAgentSettings({ ...s, keys: { openai: 'sk-live-2' } }, seal);

    expect(record().keys?.openai).toBeDefined();
  });

  it('writes the obfuscated copy when no sealed blob exists', async () => {
    vi.resetModules();
    const { loadAgentSettings, saveAgentSettings } = await import('../../../agent/security/settings-record');
    backing.clear();
    const s = loadAgentSettings();
    saveAgentSettings({ ...s, keys: { openai: 'sk-first' } }, newSealState());

    expect(record().keys?.openai).toBeDefined();
  });
});

describe('a freshly sealed keyring', () => {
  it('stops mirroring the obfuscated copy once the vault upgrade has sealed it', async () => {
    vi.resetModules();
    vi.doMock('../../../platform/storage/vault', () => ({
      sealSecret: (plain: string) => Promise.resolve({ iv: 'iv', ct: btoa(plain) }),
      openSecret: (blob: { ct: string }) => Promise.resolve(atob(blob.ct)),
    }));
    const { loadAgentSettings, saveAgentSettings } = await import('../../../agent/security/settings-record');
    backing.clear();
    const seal: SealState = { ...newSealState(), hydrated: true };

    const first = loadAgentSettings();
    saveAgentSettings({ ...first, keys: { openai: 'sk-first' } }, seal);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    saveAgentSettings({ ...first, keys: { openai: 'sk-first' }, oversight: 'strict' }, seal);
    const rec = JSON.parse(backing.get('petit-agent-settings-v1') ?? 'null') as { keys?: unknown; keysSealed?: unknown };
    expect(rec.keys).toBeUndefined();
    expect(rec.keysSealed).toBeDefined();
  });
});

describe('storage that refuses to write', () => {
  it('reports the failure instead of throwing out of the save', async () => {
    // Safari private mode throws from `setItem`; the save runs inside a React handler.
    vi.resetModules();
    const { loadAgentSettings, saveAgentSettings } = await import('../../../agent/security/settings-record');
    backing.clear();
    const s = loadAgentSettings();
    const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new DOMException('quota'); });
    try {
      expect(saveAgentSettings({ ...s, provider: 'openai' }, newSealState())).toBe(false);
    } finally {
      setItem.mockRestore();
    }
    expect(saveAgentSettings({ ...s, provider: 'openai' }, newSealState())).toBe(true);
  });
});

describe('vault upgrade over refusing storage', () => {
  async function sealingModule() {
    vi.resetModules();
    vi.doMock('../../../platform/storage/vault', () => ({
      sealSecret: (plain: string) => Promise.resolve({ iv: 'iv', ct: btoa(plain) }),
      openSecret: (blob: { ct: string }) => Promise.resolve(atob(blob.ct)),
    }));
    const mod = { ...(await import('../../../agent/security/key-storage')), ...(await import('../../../agent/security/settings-record')) };
    backing.clear();
    return mod;
  }
  const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
  const stored = () => JSON.parse(backing.get('petit-agent-settings-v1') ?? 'null') as { keys?: Record<string, string>; keysSealed?: unknown };

  it('keeps mirroring the obfuscated keys when the sealed record could not be written', async () => {
    const { loadAgentSettings, saveAgentSettings } = await sealingModule();
    const seal: SealState = { ...newSealState(), hydrated: true };
    const s = loadAgentSettings();
    const setItem = vi.spyOn(localStorage, 'setItem');
    saveAgentSettings({ ...s, keys: { openai: 'sk-first' } }, seal);
    setItem.mockImplementation(() => { throw new DOMException('quota'); });
    await settle();
    setItem.mockRestore();
    expect(stored().keysSealed).toBeUndefined();

    saveAgentSettings({ ...s, keys: { openai: 'sk-first' }, oversight: 'strict' }, seal);
    expect(stored().keys?.openai).toBeDefined();
  });

  it('keeps an unread sealed blob through a hydration over denied storage', async () => {
    // A vault that cannot open the blob: the first hydration leaves it unread.
    vi.resetModules();
    vi.doMock('../../../platform/storage/vault', () => ({
      sealSecret: () => Promise.resolve(null),
      openSecret: () => Promise.resolve(null),
    }));
    const { hydrateSealedKeys, loadAgentSettings, saveAgentSettings } =
      { ...(await import('../../../agent/security/key-storage')), ...(await import('../../../agent/security/settings-record')) };
    backing.clear();
    const SEALED = { iv: 'iv', ct: 'unreadable' };
    backing.set('petit-agent-settings-v1', JSON.stringify({ provider: 'openai', keysSealed: SEALED }));
    const seal = newSealState();
    expect(await hydrateSealedKeys(seal)).toBeNull();

    // A second hydration cannot read storage at all, so it must not decide the blob is gone.
    const getItem = vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new DOMException('denied', 'SecurityError'); });
    try {
      expect(await hydrateSealedKeys(seal)).toBeNull();
    } finally {
      getItem.mockRestore();
    }
    seal.hydrated = true;
    saveAgentSettings({ ...loadAgentSettings(), keys: {} }, seal);
    expect(stored().keysSealed).toEqual(SEALED);
  });
});
