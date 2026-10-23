/** Where a saved provider key lives: on the device, sealed where the browser can seal it. */
import { afterEach, describe, expect, vi } from 'vitest';
import { spec } from '../../_support/spec';
import { loadAgentSettings, saveAgentSettings } from '../../../agent/security/settings-record';
import { newSealState } from '../../../agent/security/key-storage';
import { deleteVault } from '../../../platform/storage/vault';
import { memoryIndexedDB, memoryLocalStorage } from './_assistant';

const KEY = 'sk-ant-api03-livekey';

afterEach(async () => { await deleteVault(); vi.unstubAllGlobals(); });

/** Lets the save's sealing, which runs after the save returns, finish. */
async function settle(): Promise<void> {
  for (let i = 0; i < 50; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('a saved key', () => {
  spec('ASST-03', 'is sealed under a browser key that cannot be exported, and no copy of it stays readable', async () => {
    const local = memoryLocalStorage();
    const vault = memoryIndexedDB();
    vi.stubGlobal('localStorage', local.storage);
    vi.stubGlobal('indexedDB', vault.factory);
    await deleteVault();

    saveAgentSettings({ ...loadAgentSettings(), provider: 'claude', keys: { claude: KEY } }, newSealState());
    await settle();

    const written = local.written();
    expect(written).not.toContain(KEY);
    expect(written).not.toContain(btoa(KEY));
    expect(written).toContain('keysSealed');
    const keys = vault.values().filter((v): v is CryptoKey => v instanceof CryptoKey);
    expect(keys).toHaveLength(1);
    expect(keys[0]!.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', keys[0]!)).rejects.toThrow();
  });
});
