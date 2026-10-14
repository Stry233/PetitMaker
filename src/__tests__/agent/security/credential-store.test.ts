import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCredentialStore, type SettingsFields } from '../../../agent/security/credential-store';
import { loadAgentSettings } from '../../../agent/security/settings-record';
import { PREFS } from '../../../platform/storage/prefs';

const backing = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
});

function fields(): SettingsFields {
  const base = loadAgentSettings();
  return { provider: base.provider, model: base.model, oversight: 'strict' };
}

function seed(record: Record<string, unknown>): void {
  backing.set(PREFS.agentSettings.key, JSON.stringify({ provider: 'claude', oversight: 'checkpoint', ...record }));
}

function stored(): Record<string, unknown> {
  return JSON.parse(backing.get(PREFS.agentSettings.key) ?? 'null') as Record<string, unknown>;
}

beforeEach(() => backing.clear());

describe('the credential store', () => {
  it('defers writes until hydration and then makes the owed one', async () => {
    seed({ keys: { claude: btoa('sk-ant-old') } });
    const store = createCredentialStore({ stopJob: () => {}, fields });
    store.connect('openai', 'sk-proj-new');
    store.persist();
    expect(stored().oversight).toBe('checkpoint');

    await store.hydrate(() => {});
    expect(store.hydrated).toBe(true);
    expect(stored().oversight).toBe('strict');
    expect(loadAgentSettings().keys).toEqual({ claude: 'sk-ant-old', openai: 'sk-proj-new' });
  });

  it('keeps a key revoked before hydration out of memory and the disk', async () => {
    seed({ keys: { claude: btoa('sk-ant-old') } });
    const store = createCredentialStore({ stopJob: () => {}, fields });
    expect(store.forget('claude', false)).toBe(true);
    store.persist();
    await store.hydrate(() => {});
    expect(store.keyed()).toEqual([]);
    expect(loadAgentSettings().keys.claude).toBeUndefined();
  });

  it('hands the seed the stored record with the stored keys already folded in', async () => {
    seed({ provider: 'deepseek', keys: { deepseek: btoa('sk-ds') } });
    const store = createCredentialStore({ stopJob: () => {}, fields });
    const seen: string[] = [];
    await store.hydrate((record) => seen.push(record.provider, ...store.keyed()));
    expect(seen).toEqual(['deepseek', 'deepseek']);
  });

  it('stops the job before the armed key disappears, and only for the armed provider', async () => {
    const held: (string | undefined)[] = [];
    const store = createCredentialStore({ stopJob: () => held.push(store.key('claude')), fields });
    await store.hydrate(() => {});
    store.connect('claude', 'sk-ant-live');
    store.connect('openai', 'sk-proj-live');
    expect(store.forget('openai', false)).toBe(true);
    expect(held).toEqual([]);
    expect(store.forget('claude', true)).toBe(true);
    expect(held).toEqual(['sk-ant-live']);
    expect(store.forget('claude', true)).toBe(false);
  });

  it('keeps an anonymous endpoint keyless across restarts without treating it as a revocation', async () => {
    seed({ keys: { custom: btoa('old-key') } });
    const first = createCredentialStore({ stopJob: () => {}, fields });
    await first.hydrate(() => {});
    first.connectAnonymous('custom');
    first.persist();
    expect(stored().customAuth).toBe('none');
    expect(loadAgentSettings().keys.custom).toBeUndefined();

    seed({ ...stored(), keys: { custom: btoa('old-key') } });
    const second = createCredentialStore({ stopJob: () => {}, fields });
    await second.hydrate(() => {});
    expect(second.isAnonymous('custom')).toBe(true);
    expect(second.key('custom')).toBeUndefined();
    second.connect('custom', 'new-key');
    second.persist();
    expect(stored().customAuth).toBeUndefined();
    expect(loadAgentSettings().keys.custom).toBe('new-key');
  });
});
