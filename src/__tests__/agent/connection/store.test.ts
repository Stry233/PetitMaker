// @vitest-environment jsdom
/**
 * Settings persistence shares one record with the key vault. Writes merge only after hydration;
 * before then they are owed.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  connectionGaps, connectionReady, isConnected, providerForSavedKey, providerRegion, runnerSettings, setLiveJobStop, useAgentConnection,
  __resetAgentConnection,
} from '../../../agent/connection/store';
import { loadAgentSettings } from '../../../agent/security/settings-record';
import { PREFS } from '../../../platform/storage/prefs';
import { PROVIDER_IDS, type ProviderId } from '../../../agent/providers/defaults';

const backing = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
};

const emptyModels = () =>
  Object.fromEntries(PROVIDER_IDS.map((id) => [id, ''])) as Record<ProviderId, string>;


function storedRecord(): Record<string, unknown> {
  return JSON.parse(backing.get(PREFS.agentSettings.key) ?? 'null') as Record<string, unknown>;
}

/** A record as a returning user's disk holds it: a vault-sealed key, a provider, models. */
function seedStoredRecord(): void {
  backing.set(PREFS.agentSettings.key, JSON.stringify({
    provider: 'deepseek',
    model: { deepseek: 'deepseek-chat', claude: 'claude-sonnet-4-5' },
    keysSealed: { iv: 'AAAA', ct: 'BBBB' },
    oversight: 'strict',
    askBeforeEdits: true,
    customBaseUrl: 'https://gateway.example.com/v1',
  }));
}

beforeEach(() => {
  __resetAgentConnection();
  backing.clear();
});

describe('custom endpoint authentication', () => {
  it('requires an explicit endpoint before accepting a blank custom key', () => {
    const state = useAgentConnection.getState();
    state.connectKey('custom', '');
    state.connectKey('openai', '');
    expect(isConnected(useAgentConnection.getState(), 'custom')).toBe(false);
    expect(isConnected(useAgentConnection.getState(), 'openai')).toBe(false);
    state.setCustomBaseUrl('http://localhost:1234/v1');
    state.connectKey('custom', '');
    state.setModel('local-model');
    expect(connectionGaps(useAgentConnection.getState())).toEqual([]);
    expect(runnerSettings(useAgentConnection.getState())).toMatchObject({ apiKey: '', customBaseUrl: 'http://localhost:1234/v1', model: 'local-model' });
  });

  it('arms a built-in provider without the saved custom endpoint', () => {
    const state = useAgentConnection.getState();
    state.setCustomBaseUrl('https://gateway.example/v1');
    state.setProvider('openai');
    expect(runnerSettings(useAgentConnection.getState()).customBaseUrl).toBeUndefined();
  });

  it('persists the explicit unauthenticated choice without a placeholder key', async () => {
    await useAgentConnection.getState().hydrate();
    const state = useAgentConnection.getState();
    state.setCustomBaseUrl('http://localhost:1234/v1');
    state.connectKey('custom', 'old-key');
    state.setModel('local-model');
    state.connectKey('custom', '');
    expect(storedRecord().customAuth).toBe('none');
    expect(loadAgentSettings().keys.custom).toBeUndefined();
    expect(providerForSavedKey('old-key')).toBeNull();
    expect(useAgentConnection.getState().keyed).not.toContain('custom');
    await state.hydrate();
    expect(connectionReady(useAgentConnection.getState())).toBe(true);
    state.setProvider('openai');
    expect(connectionReady(useAgentConnection.getState())).toBe(false);
    state.setProvider('custom');
    expect(connectionReady(useAgentConnection.getState())).toBe(true);
    state.connectKey('custom', 'new/token==');
    expect(storedRecord().customAuth).toBeUndefined();
    expect(runnerSettings(useAgentConnection.getState()).apiKey).toBe('new/token==');
  });

  it('restores an unauthenticated connection without resurrecting an old saved key', async () => {
    backing.set(PREFS.agentSettings.key, JSON.stringify({
      provider: 'custom', model: { custom: 'local-model' }, oversight: 'checkpoint',
      customBaseUrl: 'http://localhost:1234/v1', customAuth: 'none', keys: { custom: btoa('old-key') },
    }));
    await useAgentConnection.getState().hydrate();
    expect(connectionReady(useAgentConnection.getState())).toBe(true);
    expect(runnerSettings(useAgentConnection.getState()).apiKey).toBe('');
    expect(useAgentConnection.getState().keyed).not.toContain('custom');
    useAgentConnection.getState().setOversight('strict');
    expect(loadAgentSettings().keys.custom).toBeUndefined();
  });

  it('keeps an unauthenticated choice made during hydration and disconnects it explicitly', async () => {
    backing.set(PREFS.agentSettings.key, JSON.stringify({
      provider: 'custom', model: { custom: 'local-model' }, oversight: 'checkpoint',
      customBaseUrl: 'http://localhost:1234/v1', keys: { custom: btoa('old-key') },
    }));
    const pending = useAgentConnection.getState().hydrate();
    useAgentConnection.getState().connectKey('custom', '');
    await pending;
    expect(connectionReady(useAgentConnection.getState())).toBe(true);
    expect(runnerSettings(useAgentConnection.getState()).apiKey).toBe('');
    const stop = vi.fn();
    setLiveJobStop(stop);
    try {
      useAgentConnection.getState().forgetKey('custom');
      expect(stop).toHaveBeenCalledOnce();
      expect(connectionGaps(useAgentConnection.getState())).toEqual(['key']);
      expect(storedRecord().customAuth).toBeUndefined();
    } finally { setLiveJobStop(undefined); }
  });
});

describe('saved key identification', () => {
  const key = 'sk-0123456789abcdef0123456789abcdef';

  it('matches the complete saved key without changing the active provider', () => {
    useAgentConnection.getState().connectKey('deepseek', key);
    useAgentConnection.getState().setProvider('claude');
    expect(providerForSavedKey(` ${key} `)).toBe('deepseek');
    expect(providerForSavedKey(key.slice(0, -1))).toBeNull();
    expect(providerForSavedKey('')).toBeNull();
    expect(useAgentConnection.getState().provider).toBe('claude');
  });

  it('leaves keys saved under multiple providers undecided', () => {
    useAgentConnection.getState().connectKey('deepseek', key);
    useAgentConnection.getState().connectKey('qwen', key);
    expect(providerForSavedKey(key)).toBe('ambiguous');
  });

  it.each([0, 1] as const)('requires a saved region before reusing a regional key on region %s', region => {
    const state = useAgentConnection.getState();
    state.connectKey('moonshot', key);
    expect(providerRegion(useAgentConnection.getState(), 'moonshot')).toBeUndefined();
    expect(providerForSavedKey(key)).toBe('ambiguous');
    state.setProviderRegion('moonshot', region);
    expect(providerForSavedKey(key)).toBe('moonshot');
    expect(providerRegion(useAgentConnection.getState(), 'moonshot')).toBe(region);
  });

  it('requires a custom endpoint and stops matching revoked keys', () => {
    const state = useAgentConnection.getState();
    state.connectKey('custom', key);
    expect(providerForSavedKey(key)).toBe('ambiguous');
    state.setCustomBaseUrl('https://gateway.example/v1');
    expect(providerForSavedKey(key)).toBe('custom');
    state.forgetKey('custom');
    expect(providerForSavedKey(key)).toBeNull();
  });
});

describe('an unhydrated store never writes over a record it has not read', () => {
  /**
   * One press on the oversight row, from a panel store that has not hydrated, would otherwise
   * assemble the whole record from defaults: the sealed key blob dropped, the provider back at
   * claude, and both models emptied.
   */
  it('keeps the sealed key blob, the provider and the models through a setting pressed too early', () => {
    seedStoredRecord();

    useAgentConnection.getState().setOversight('yolo');

    const after = storedRecord();
    expect(after.keysSealed).toEqual({ iv: 'AAAA', ct: 'BBBB' });
    expect(after.provider).toBe('deepseek');
    expect(after.model).toEqual({ deepseek: 'deepseek-chat', claude: 'claude-sonnet-4-5' });
    expect(after.oversight).toBe('strict');
    expect(after.customBaseUrl).toBe('https://gateway.example.com/v1');
  });

  it('writes nothing at all, rather than a partial record', () => {
    useAgentConnection.getState().setOversight('strict');
    expect(backing.get(PREFS.agentSettings.key)).toBeUndefined();
  });

  /**
   * Not even a key. A save carrying keys makes `key-storage` re-seal rather than drop the blob, but
   * it re-seals only the keys that save carries — and an unhydrated keyring holds at most the one
   * key just typed, so writing it would trade that key for every other provider's. It is held in
   * memory and owed, which loses nothing.
   */
  it('holds a key typed before hydration in memory rather than writing a partial keyring', async () => {
    seedStoredRecord();
    const before = backing.get(PREFS.agentSettings.key);
    useAgentConnection.getState().connectKey('openai', 'sk-proj-abc');

    expect(backing.get(PREFS.agentSettings.key)).toBe(before);
    // The session has the key regardless: it is the disk that waits, not the panel.
    expect(useAgentConnection.getState().keyed).toEqual(['openai']);

    // `hydrate` seeds every field from disk (its own contract says to call it first), and the
    // keyring is merged rather than replaced, so the typed key reaches the record while nothing the
    // user had is disturbed.
    await useAgentConnection.getState().hydrate();
    const after = storedRecord();
    expect(Object.keys(after.keys as Record<string, string>)).toContain('openai');
    expect(useAgentConnection.getState().keyed).toContain('openai');
    expect(after.provider).toBe('deepseek');
    expect(after.oversight).toBe('strict');
    expect(after.model).toMatchObject({ deepseek: 'deepseek-chat', claude: 'claude-sonnet-4-5' });
  });

  /** The real exposure is the vault's own opening window: `hydrate` seeds the store synchronously
   *  and only then awaits the sealed keys, so a press inside that gap lands on a store that already
   *  holds the user's values but is not yet cleared to write. Declining it silently would lose it. */
  it('makes the write it declined once hydration lands', async () => {
    seedStoredRecord();
    const pending = useAgentConnection.getState().hydrate();
    expect(useAgentConnection.getState().hydrated).toBe(false);
    expect(useAgentConnection.getState().oversight).toBe('strict'); // the sync seed has run

    useAgentConnection.getState().setOversight('yolo');
    expect(storedRecord().oversight).toBe('strict'); // declined, not written

    await pending;
    expect(storedRecord().oversight).toBe('yolo');
    expect(useAgentConnection.getState().oversight).toBe('yolo');
  });
});

/**
 * A merge cannot express an absence, which is why a revocation travels as its own fact. Without it
 * `hydrate`'s `{...disk, ...keyring}` hands the deleted key straight back — it is not in the keyring
 * to win with — and the owed write then puts it back on disk as well.
 */
describe('a key revoked before hydration stays revoked', () => {
  function seedObfuscatedKey(): void {
    // The obfuscated fallback (`key-storage`'s base64 path), which is what the synchronous read
    // returns and therefore what the merge would resurrect.
    backing.set(PREFS.agentSettings.key, JSON.stringify({
      provider: 'claude',
      model: emptyModels(),
      keys: { claude: btoa('sk-ant-api03-old') },
      oversight: 'checkpoint',
    }));
  }

  it('is gone from memory and from the disk once the read lands', async () => {
    seedObfuscatedKey();
    useAgentConnection.getState().forgetKey('claude');

    await useAgentConnection.getState().hydrate();

    expect(useAgentConnection.getState().keyed).toEqual([]);
    expect(isConnected(useAgentConnection.getState(), 'claude')).toBe(false);
    expect(loadAgentSettings().keys.claude).toBeUndefined();
    expect([...backing.values()].join()).not.toContain(btoa('sk-ant-api03-old'));
  });

  it('a key filed afterwards retracts the revocation rather than being dropped by it', async () => {
    seedObfuscatedKey();
    useAgentConnection.getState().forgetKey('claude');
    useAgentConnection.getState().connectKey('claude', 'sk-ant-api03-new');

    await useAgentConnection.getState().hydrate();

    expect(useAgentConnection.getState().keyed).toEqual(['claude']);
    expect(runnerSettings(useAgentConnection.getState()).apiKey).toBe('sk-ant-api03-new');
    expect(loadAgentSettings().keys.claude).toBe('sk-ant-api03-new');
  });

  it('revokes on the armed provider by default, and leaves the others alone', async () => {
    seedObfuscatedKey();
    await useAgentConnection.getState().hydrate();
    useAgentConnection.getState().connectKey('openai', 'sk-proj-other');

    useAgentConnection.getState().forgetKey(); // armed = openai, from the connect above
    expect(useAgentConnection.getState().keyed).toEqual(['claude']);
    expect(loadAgentSettings().keys.claude).toBe('sk-ant-api03-old');
  });
});

describe('a hydrated store is authoritative, and merges over the rest', () => {
  beforeEach(async () => {
    seedStoredRecord();
    await useAgentConnection.getState().hydrate();
  });

  it('reads the stored record into the store', () => {
    const state = useAgentConnection.getState();
    expect(state.provider).toBe('deepseek');
    expect(state.oversight).toBe('strict');
    expect(state.model.deepseek).toBe('deepseek-chat');
    expect(state.customBaseUrl).toBe('https://gateway.example.com/v1');
    expect(state.hydrated).toBe(true);
  });

  it('writes its own fields and keeps the ones it does not model', () => {
    backing.set(PREFS.agentSettings.key, JSON.stringify({
      ...storedRecord(),
      regionBaseUrl: { moonshot: 'https://api.moonshot.cn/v1' },
    }));
    useAgentConnection.getState().setOversight('checkpoint');

    const after = storedRecord();
    expect(after.oversight).toBe('checkpoint');
    expect(after.regionBaseUrl).toEqual({ moonshot: 'https://api.moonshot.cn/v1' });
    expect(after.model).toEqual({ ...emptyModels(), deepseek: 'deepseek-chat', claude: 'claude-sonnet-4-5' });
  });

  it('files a model against the armed provider only', () => {
    useAgentConnection.getState().setModel('deepseek-reasoner');
    const state = useAgentConnection.getState();
    expect(state.model.deepseek).toBe('deepseek-reasoner');
    expect(state.model.claude).toBe('claude-sonnet-4-5');
  });
});

describe('the key is not in the store', () => {
  it('reports only WHICH providers are keyed, and hands the secret out by call', () => {
    const store = useAgentConnection.getState();
    store.connectKey('claude', 'sk-ant-api03-secret');

    const state = useAgentConnection.getState();
    expect(state.keyed).toEqual(['claude']);
    expect(isConnected(state)).toBe(true);
    expect(JSON.stringify(state)).not.toContain('sk-ant-api03-secret');
    expect(runnerSettings(state).apiKey).toBe('sk-ant-api03-secret');
  });

  it('forgetting a key returns the panel to disconnected', () => {
    const store = useAgentConnection.getState();
    store.connectKey('claude', 'sk-ant-api03-secret');
    useAgentConnection.getState().forgetKey();

    const state = useAgentConnection.getState();
    expect(state.keyed).toEqual([]);
    expect(isConnected(state)).toBe(false);
    expect(runnerSettings(state).apiKey).toBe('');
  });

  it('never writes a raw key into storage', () => {
    useAgentConnection.getState().connectKey('claude', 'sk-ant-api03-secret');
    expect([...backing.values()].join()).not.toContain('sk-ant-api03-secret');
  });

  it('an unusable custom endpoint is refused rather than stored', async () => {
    await useAgentConnection.getState().hydrate();
    expect(useAgentConnection.getState().setCustomBaseUrl('ftp://')).toBe('');
    expect(useAgentConnection.getState().customBaseUrl).toBe('');
    expect(loadAgentSettings().customBaseUrl).toBeUndefined();
  });
});

/* A key going away must not orphan a running job. Nothing here stops the loop, and every panel
 * surface reads a keyless store as "there is no session" — so the job went on writing to the map
 * behind a setup form, with the record and both controls gone. */
describe('revoking the armed key ends the job that was running on it', () => {
  beforeEach(() => setLiveJobStop(undefined));

  it('aborts BEFORE the key is cleared, so the abort can still be shown', async () => {
    await useAgentConnection.getState().hydrate();
    useAgentConnection.getState().connectKey('claude', 'sk-ant-api03-secret');

    const seen: readonly ProviderId[][] = [];
    setLiveJobStop(() => { (seen as ProviderId[][]).push([...useAgentConnection.getState().keyed]); });

    useAgentConnection.getState().forgetKey();

    expect(seen).toHaveLength(1);
    expect(seen[0], 'the key was still held when the job was aborted').toEqual(['claude']);
    expect(useAgentConnection.getState().keyed).toEqual([]);
  });

  it('leaves the job alone when the key dropped is not the one it runs on', async () => {
    await useAgentConnection.getState().hydrate();
    useAgentConnection.getState().connectKey('openai', 'sk-proj-other');
    useAgentConnection.getState().connectKey('claude', 'sk-ant-api03-secret'); // arms claude

    const stop = vi.fn();
    setLiveJobStop(stop);
    useAgentConnection.getState().forgetKey('openai');

    expect(stop).not.toHaveBeenCalled();
    expect(useAgentConnection.getState().keyed).toEqual(['claude']);
  });

  it('costs nothing where there is no key to revoke', async () => {
    await useAgentConnection.getState().hydrate();
    const stop = vi.fn();
    setLiveJobStop(stop);
    useAgentConnection.getState().forgetKey('claude');
    expect(stop).not.toHaveBeenCalled();
  });
});

/**
 * A key is not a connection. Three facts have to stand before a request can be built at all, and
 * `isConnected` answers for exactly one of them — which is why the panel asks this question too.
 */
describe('what a connection is still missing', () => {
  beforeEach(async () => {
    await useAgentConnection.getState().hydrate();
  });

  it('names the missing piece, in the order the connection screen asks for it', () => {
    const state = () => useAgentConnection.getState();
    expect(connectionGaps(state())).toEqual(['key', 'model']);

    state().connectKey('claude', 'sk-ant-api03-secret');
    expect(connectionGaps(state())).toEqual(['model']);
    expect(connectionReady(state())).toBe(false);

    state().setModel('claude-sonnet-4-5');
    expect(connectionGaps(state())).toEqual([]);
    expect(connectionReady(state())).toBe(true);
  });

  /** The user's own server owes an address. Without one there is no host to ask, and the SDK's own
   *  default would carry a gateway key to a platform it was never issued for. */
  it('holds a custom provider to its endpoint address', () => {
    const state = () => useAgentConnection.getState();
    state().pinProvider('custom');
    state().connectKey('custom', 'sk-9f2c0123456789abcdef0123456789ab');
    state().setModel('qwen3:32b');
    expect(connectionGaps(state())).toEqual(['endpoint']);
    expect(connectionReady(state())).toBe(false);

    state().setCustomBaseUrl('https://gateway.example/v1');
    expect(connectionReady(state())).toBe(true);
  });

  /** The question is about one provider, so a key and a model held for another are no answer: the
   *  request goes out against the armed one. */
  it('answers about the armed provider, or the one it is asked about', () => {
    const state = () => useAgentConnection.getState();
    state().connectKey('claude', 'sk-ant-api03-secret');
    state().setModel('claude-sonnet-4-5');
    expect(connectionReady(state())).toBe(true);
    expect(connectionGaps(state(), 'openai')).toEqual(['key', 'model']);

    state().setProvider('openai');
    expect(connectionReady(state())).toBe(false);
  });
});

