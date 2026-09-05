/**
 * Settings persistence shares one record with the key vault. Writes merge only after hydration;
 * before then they are no-ops. `markKeysHydrated()` is module-global and irreversible for the
 * process, so tests that raise it cannot later assume an unhydrated vault.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  connectionGaps, connectionReady, isConnected, runnerSettings, setLiveJobStop, useAgentPanelSettings,
} from '../../../ui/agent/settings';
import { markKeysHydrated, loadAgentSettings } from '../../../agent/security/key-storage';
import { PREFS } from '../../../core/runtime/prefs';
import { PROVIDER_IDS, type ProviderId } from '../../../agent/providers/defaults';

const backing = new Map<string, string>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).localStorage = {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
};

const emptyModels = () =>
  Object.fromEntries(PROVIDER_IDS.map((id) => [id, ''])) as Record<ProviderId, string>;

const DEFAULTS = {
  provider: 'claude' as ProviderId, oversight: 'checkpoint' as const,
  customBaseUrl: '', endpointDown: '', formerModel: '', keyed: [] as readonly ProviderId[],
};

/**
 * The store as it stands the instant it is created: nothing read, nothing known.
 *
 * The keyring AND the revocation set are MODULE globals (deliberately — no component may select a
 * secret out of a store), so no test may inherit either from another, and the only way in is the
 * store's own verbs: forget every key, then hydrate against an EMPTY disk, which is what applies and
 * clears the revocations those forgets just recorded.
 */
async function unhydrated(): Promise<void> {
  useAgentPanelSettings.setState({ ...DEFAULTS, model: emptyModels(), hydrated: true });
  for (const id of PROVIDER_IDS) useAgentPanelSettings.getState().forgetKey(id);
  backing.clear();
  await useAgentPanelSettings.getState().hydrate();
  useAgentPanelSettings.setState({ ...DEFAULTS, model: emptyModels(), hydrated: false });
}

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

beforeEach(async () => {
  // `unhydrated` writes while it clears the keyring, so storage is emptied AFTER it, not before.
  await unhydrated();
  backing.clear();
});

describe('an unhydrated store never writes over a record it has not read', () => {
  /**
   * One press on the oversight row, from a panel store that has not hydrated, would otherwise
   * assemble the whole record from defaults: the sealed key blob dropped (because `keysHydrated`
   * is up and the save carries no keys), the provider back at claude, and both models emptied.
   */
  it('keeps the sealed key blob, the provider and the models through a setting pressed too early', () => {
    seedStoredRecord();
    markKeysHydrated(); // matches application boot after the vault has loaded

    useAgentPanelSettings.getState().setOversight('yolo');

    const after = storedRecord();
    expect(after.keysSealed).toEqual({ iv: 'AAAA', ct: 'BBBB' });
    expect(after.provider).toBe('deepseek');
    expect(after.model).toEqual({ deepseek: 'deepseek-chat', claude: 'claude-sonnet-4-5' });
    expect(after.oversight).toBe('strict');
    expect(after.customBaseUrl).toBe('https://gateway.example.com/v1');
  });

  it('writes nothing at all, rather than a partial record', () => {
    useAgentPanelSettings.getState().setOversight('strict');
    expect(backing.get(PREFS.agentSettings.key)).toBeUndefined();
  });

  /**
   * NOT EVEN A KEY. A save carrying keys makes `key-storage` re-seal rather than drop the blob, but
   * it re-seals only the keys that save CARRIES — and an unhydrated keyring holds at most the one
   * key just typed, so writing it would trade that key for every other provider's. It is held in
   * memory and owed, which loses nothing.
   */
  it('holds a key typed before hydration in memory rather than writing a partial keyring', async () => {
    seedStoredRecord();
    const before = backing.get(PREFS.agentSettings.key);
    useAgentPanelSettings.getState().connectKey('openai', 'sk-proj-abc');

    expect(backing.get(PREFS.agentSettings.key)).toBe(before);
    // The session has the key regardless: it is the disk that waits, not the panel.
    expect(useAgentPanelSettings.getState().keyed).toEqual(['openai']);

    // `hydrate` seeds every field from disk (its own contract says to call it first), and the
    // keyring is MERGED rather than replaced, so the typed key reaches the record while nothing the
    // user had is disturbed.
    await useAgentPanelSettings.getState().hydrate();
    const after = storedRecord();
    expect(Object.keys(after.keys as Record<string, string>)).toContain('openai');
    expect(useAgentPanelSettings.getState().keyed).toContain('openai');
    expect(after.provider).toBe('deepseek');
    expect(after.oversight).toBe('strict');
    expect(after.model).toMatchObject({ deepseek: 'deepseek-chat', claude: 'claude-sonnet-4-5' });
  });

  /** The real exposure is the VAULT'S OWN OPENING WINDOW: `hydrate` seeds the store synchronously
   *  and only then awaits the sealed keys, so a press inside that gap lands on a store that already
   *  holds the user's values but is not yet cleared to write. Declining it silently would lose it. */
  it('makes the write it declined once hydration lands', async () => {
    seedStoredRecord();
    const pending = useAgentPanelSettings.getState().hydrate();
    expect(useAgentPanelSettings.getState().hydrated).toBe(false);
    expect(useAgentPanelSettings.getState().oversight).toBe('strict'); // the sync seed has run

    useAgentPanelSettings.getState().setOversight('yolo');
    expect(storedRecord().oversight).toBe('strict'); // declined, not written

    await pending;
    expect(storedRecord().oversight).toBe('yolo');
    expect(useAgentPanelSettings.getState().oversight).toBe('yolo');
  });
});

/**
 * A MERGE CANNOT EXPRESS AN ABSENCE, which is why a revocation travels as its own fact. Without it
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
    useAgentPanelSettings.getState().forgetKey('claude');

    await useAgentPanelSettings.getState().hydrate();

    expect(useAgentPanelSettings.getState().keyed).toEqual([]);
    expect(isConnected(useAgentPanelSettings.getState(), 'claude')).toBe(false);
    expect(loadAgentSettings().keys.claude).toBeUndefined();
    expect([...backing.values()].join()).not.toContain(btoa('sk-ant-api03-old'));
  });

  it('a key filed afterwards retracts the revocation rather than being dropped by it', async () => {
    seedObfuscatedKey();
    useAgentPanelSettings.getState().forgetKey('claude');
    useAgentPanelSettings.getState().connectKey('claude', 'sk-ant-api03-new');

    await useAgentPanelSettings.getState().hydrate();

    expect(useAgentPanelSettings.getState().keyed).toEqual(['claude']);
    expect(runnerSettings(useAgentPanelSettings.getState()).apiKey).toBe('sk-ant-api03-new');
    expect(loadAgentSettings().keys.claude).toBe('sk-ant-api03-new');
  });

  it('revokes on the armed provider by default, and leaves the others alone', async () => {
    seedObfuscatedKey();
    await useAgentPanelSettings.getState().hydrate();
    useAgentPanelSettings.getState().connectKey('openai', 'sk-proj-other');

    useAgentPanelSettings.getState().forgetKey(); // armed = openai, from the connect above
    expect(useAgentPanelSettings.getState().keyed).toEqual(['claude']);
    expect(loadAgentSettings().keys.claude).toBe('sk-ant-api03-old');
  });
});

describe('a hydrated store is authoritative, and merges over the rest', () => {
  beforeEach(async () => {
    seedStoredRecord();
    await useAgentPanelSettings.getState().hydrate();
  });

  it('reads the stored record into the store', () => {
    const state = useAgentPanelSettings.getState();
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
    useAgentPanelSettings.getState().setOversight('checkpoint');

    const after = storedRecord();
    expect(after.oversight).toBe('checkpoint');
    expect(after.regionBaseUrl).toEqual({ moonshot: 'https://api.moonshot.cn/v1' });
    expect(after.model).toEqual({ ...emptyModels(), deepseek: 'deepseek-chat', claude: 'claude-sonnet-4-5' });
  });

  it('files a model against the armed provider only', () => {
    useAgentPanelSettings.getState().setModel('deepseek-reasoner');
    const state = useAgentPanelSettings.getState();
    expect(state.model.deepseek).toBe('deepseek-reasoner');
    expect(state.model.claude).toBe('claude-sonnet-4-5');
  });
});

describe('the key is not in the store', () => {
  it('reports only WHICH providers are keyed, and hands the secret out by call', () => {
    const store = useAgentPanelSettings.getState();
    store.connectKey('claude', 'sk-ant-api03-secret');

    const state = useAgentPanelSettings.getState();
    expect(state.keyed).toEqual(['claude']);
    expect(isConnected(state)).toBe(true);
    expect(JSON.stringify(state)).not.toContain('sk-ant-api03-secret');
    expect(runnerSettings(state).apiKey).toBe('sk-ant-api03-secret');
  });

  it('forgetting a key returns the panel to disconnected', () => {
    const store = useAgentPanelSettings.getState();
    store.connectKey('claude', 'sk-ant-api03-secret');
    useAgentPanelSettings.getState().forgetKey();

    const state = useAgentPanelSettings.getState();
    expect(state.keyed).toEqual([]);
    expect(isConnected(state)).toBe(false);
    expect(runnerSettings(state).apiKey).toBe('');
  });

  it('never writes a raw key into storage', () => {
    useAgentPanelSettings.getState().connectKey('claude', 'sk-ant-api03-secret');
    expect([...backing.values()].join()).not.toContain('sk-ant-api03-secret');
  });

  it('an unusable custom endpoint is refused rather than stored', async () => {
    await useAgentPanelSettings.getState().hydrate();
    expect(useAgentPanelSettings.getState().setCustomBaseUrl('ftp://')).toBe('');
    expect(useAgentPanelSettings.getState().customBaseUrl).toBe('');
    expect(loadAgentSettings().customBaseUrl).toBeUndefined();
  });
});

/* A KEY GOING AWAY MUST NOT ORPHAN A RUNNING JOB. Nothing here stops the loop, and every panel
 * surface reads a keyless store as "there is no session" — so the job went on writing to the map
 * behind a setup form, with the record and both controls gone. */
describe('revoking the armed key ends the job that was running on it', () => {
  // Withdrawn FIRST: `unhydrated` forgets every key, which would otherwise reach a stop left
  // registered by the test before this one.
  beforeEach(async () => {
    setLiveJobStop(undefined);
    await unhydrated();
  });

  it('aborts BEFORE the key is cleared, so the abort can still be shown', async () => {
    await useAgentPanelSettings.getState().hydrate();
    useAgentPanelSettings.getState().connectKey('claude', 'sk-ant-api03-secret');

    const seen: readonly ProviderId[][] = [];
    setLiveJobStop(() => { (seen as ProviderId[][]).push([...useAgentPanelSettings.getState().keyed]); });

    useAgentPanelSettings.getState().forgetKey();

    expect(seen).toHaveLength(1);
    expect(seen[0], 'the key was still held when the job was aborted').toEqual(['claude']);
    expect(useAgentPanelSettings.getState().keyed).toEqual([]);
  });

  it('leaves the job alone when the key dropped is not the one it runs on', async () => {
    await useAgentPanelSettings.getState().hydrate();
    useAgentPanelSettings.getState().connectKey('openai', 'sk-proj-other');
    useAgentPanelSettings.getState().connectKey('claude', 'sk-ant-api03-secret'); // arms claude

    const stop = vi.fn();
    setLiveJobStop(stop);
    useAgentPanelSettings.getState().forgetKey('openai');

    expect(stop).not.toHaveBeenCalled();
    expect(useAgentPanelSettings.getState().keyed).toEqual(['claude']);
  });

  it('costs nothing where there is no key to revoke', async () => {
    await useAgentPanelSettings.getState().hydrate();
    const stop = vi.fn();
    setLiveJobStop(stop);
    useAgentPanelSettings.getState().forgetKey('claude');
    expect(stop).not.toHaveBeenCalled();
  });
});

/**
 * A KEY IS NOT A CONNECTION. Three facts have to stand before a request can be built at all, and
 * `isConnected` answers for exactly one of them — which is why the panel asks this question too.
 */
describe('what a connection is still missing', () => {
  beforeEach(async () => {
    await unhydrated();
    useAgentPanelSettings.setState({ hydrated: true });
  });

  it('names the missing piece, in the order the connection screen asks for it', () => {
    const state = () => useAgentPanelSettings.getState();
    expect(connectionGaps(state())).toEqual(['key', 'model']);

    state().connectKey('claude', 'sk-ant-api03-secret');
    expect(connectionGaps(state())).toEqual(['model']);
    expect(connectionReady(state())).toBe(false);

    state().setModel('claude-sonnet-4-5');
    expect(connectionGaps(state())).toEqual([]);
    expect(connectionReady(state())).toBe(true);
  });

  /** THE USER'S OWN SERVER OWES AN ADDRESS. Without one there is no host to ask, and the SDK's own
   *  default would carry a gateway key to a platform it was never issued for. */
  it('holds a custom provider to its endpoint address', () => {
    const state = () => useAgentPanelSettings.getState();
    state().pinProvider('custom');
    state().connectKey('custom', 'sk-9f2c0123456789abcdef0123456789ab');
    state().setModel('qwen3:32b');
    expect(connectionGaps(state())).toEqual(['endpoint']);
    expect(connectionReady(state())).toBe(false);

    state().setCustomBaseUrl('https://gateway.example/v1');
    expect(connectionReady(state())).toBe(true);
  });

  /** THE QUESTION IS ABOUT ONE PROVIDER, so a key and a model held for another are no answer: the
   *  request goes out against the ARMED one. */
  it('answers about the armed provider, or the one it is asked about', () => {
    const state = () => useAgentPanelSettings.getState();
    state().connectKey('claude', 'sk-ant-api03-secret');
    state().setModel('claude-sonnet-4-5');
    expect(connectionReady(state())).toBe(true);
    expect(connectionGaps(state(), 'openai')).toEqual(['key', 'model']);

    state().setProvider('openai');
    expect(connectionReady(state())).toBe(false);
  });
});

/**
 * A FAILED ENDPOINT CHECK IS RECORDED AS FACT, and it takes readiness down: an address nothing
 * answered cannot stand behind a model, so the pick clears (into `formerModel`, to be offered back,
 * never restored) and the endpoint is the named gap. The verdict is keyed by the ADDRESS, which is
 * what makes filing a different one the re-arm: a new address is unverified, not condemned.
 */
describe('a failed endpoint check', () => {
  const armCustom = () => {
    const state = () => useAgentPanelSettings.getState();
    state().pinProvider('custom');
    state().connectKey('custom', 'sk-9f2c0123456789abcdef0123456789ab');
    state().setCustomBaseUrl('https://gateway.example/v1');
    state().setModel('qwen3:32b');
    return state;
  };

  beforeEach(async () => {
    await unhydrated();
    useAgentPanelSettings.setState({ hydrated: true });
  });

  it('clears the filed model into the offer and names the endpoint first among the gaps', () => {
    const state = armCustom();
    expect(connectionReady(state())).toBe(true);

    state().recordEndpointCheck(false);
    expect(state().model.custom, 'the pick is gone, not flagged').toBe('');
    expect(state().formerModel, 'and held to be offered back').toBe('qwen3:32b');
    expect(connectionGaps(state())).toEqual(['endpoint', 'model']);
    expect(connectionReady(state())).toBe(false);
  });

  it('writes the emptied pick to disk, so a reload cannot resurrect it', () => {
    const state = armCustom();
    state().recordEndpointCheck(false);
    expect((storedRecord().model as Record<string, string>).custom).toBe('');
  });

  it('keeps the first failure\'s offer through a second failure', () => {
    const state = armCustom();
    state().recordEndpointCheck(false);
    state().recordEndpointCheck(false);
    expect(state().formerModel).toBe('qwen3:32b');
  });

  it('retires the verdict when a later check reaches the address, and the row stays the user\'s to fill', () => {
    const state = armCustom();
    state().recordEndpointCheck(false);
    state().recordEndpointCheck(true);
    expect(state().endpointDown).toBe('');
    expect(state().model.custom, 'nothing is restored silently').toBe('');
    expect(connectionGaps(state()), 'the model is what is owed now').toEqual(['model']);

    state().setModel('qwen3:32b');
    expect(connectionReady(state())).toBe(true);
    expect(state().formerModel, 'a pick made answers the offer').toBe('');
  });

  it('re-arms on a different address by itself: the verdict is about one server', () => {
    const state = armCustom();
    state().recordEndpointCheck(false);
    expect(connectionGaps(state())).toEqual(['endpoint', 'model']);

    state().setCustomBaseUrl('https://fixed.example/v1');
    expect(connectionGaps(state()), 'the new address is unverified, not condemned').toEqual(['model']);
    // And re-filing the address that failed stands the verdict back up: nothing has answered there.
    state().setCustomBaseUrl('https://gateway.example/v1');
    expect(connectionGaps(state())).toEqual(['endpoint', 'model']);
  });
});
