/*
 * The provider keys one settings store holds, outside any renderable or serializable state, and the
 * order in which they meet the stored record. A key revoked during the session stays out of both
 * hydration passes and any owed write, because object merges cannot represent a deliberate absence;
 * revocations clear once hydration and the owed write have accounted for them. An anonymous provider
 * (an endpoint the user explicitly runs without a key) is its own lasting fact: it holds no key, and
 * no stored key merges back in or is written for it.
 */
import { PROVIDER_IDS, type ProviderId } from '../providers/defaults';
import { hydrateSealedKeys, newSealState } from './key-storage';
import { loadAgentSettings, saveAgentSettings, type AgentSettings } from './settings-record';

type Keyring = Partial<Record<ProviderId, string>>;

/** The non-secret part of the record a write persists. */
export type SettingsFields = Omit<AgentSettings, 'keys' | 'customAuth'>;

export interface CredentialStoreOptions {
  /** Stops the running job; called before the armed provider's key disappears. */
  stopJob(): void;
  /** The non-secret fields to write, read at write time so an owed write carries the latest. */
  fields(): SettingsFields;
}

export interface CredentialStore {
  /** Whether stored and sealed keys have both been folded in; writes wait until then. */
  readonly hydrated: boolean;
  /**
   * Reads the stored record, folds its keys under the held ones, hands the record to `seed`, then
   * folds in the sealed keys, makes any write owed meanwhile and settles revocations.
   */
  hydrate(seed: (stored: AgentSettings) => void): Promise<void>;
  /** Files a key for `provider`, lifting any revocation or anonymity of it. */
  connect(provider: ProviderId, key: string): void;
  /** Marks `provider` as reached without a key, dropping any key held for it. */
  connectAnonymous(provider: ProviderId): void;
  /**
   * Revokes `provider`'s key or anonymity, stopping the running job first when it is `armed`.
   * Returns false when there was nothing to revoke.
   */
  forget(provider: ProviderId, armed: boolean): boolean;
  /** Writes the record with the held keys merged over the stored ones; owed until hydrated. */
  persist(): void;
  /** The key held for `provider`, if any. */
  key(provider: ProviderId): string | undefined;
  /** Providers with a non-empty held key, in roster order. */
  keyed(): ProviderId[];
  isAnonymous(provider: ProviderId): boolean;
  /** Every provider whose held key is exactly `key`. */
  holding(key: string): ProviderId[];
}

export function createCredentialStore(options: CredentialStoreOptions): CredentialStore {
  let keyring: Keyring = {};
  const revoked = new Set<ProviderId>();
  const anonymous = new Set<ProviderId>();
  const seal = newSealState();
  let hydrated = false;
  let owedWrite = false;

  /** `ring` without revoked or anonymous providers. */
  function filtered(ring: Keyring): Keyring {
    const out = { ...ring };
    for (const id of revoked) delete out[id];
    for (const id of anonymous) delete out[id];
    return out;
  }

  /** Folds keys read from storage under the held ones: held keys win, exclusions apply last. */
  function adopt(stored: Keyring | null | undefined): void {
    if (stored) keyring = filtered({ ...stored, ...keyring });
  }

  function drop(provider: ProviderId): void {
    const next = { ...keyring };
    delete next[provider];
    keyring = next;
  }

  function persist(): void {
    if (!hydrated) {
      owedWrite = true;
      return;
    }
    owedWrite = false;
    const stored = loadAgentSettings();
    const record: AgentSettings = { ...stored, ...options.fields(), keys: filtered({ ...stored.keys, ...keyring }) };
    if (anonymous.has('custom')) record.customAuth = 'none';
    else delete record.customAuth;
    saveAgentSettings(record, seal);
  }

  return {
    get hydrated() { return hydrated; },

    async hydrate(seed) {
      const stored = loadAgentSettings();
      // A choice made this session about the custom endpoint outranks the stored one.
      const touched = revoked.has('custom') || keyring.custom !== undefined || anonymous.has('custom');
      if (!touched && stored.customAuth === 'none') anonymous.add('custom');
      adopt(stored.keys);
      seed(stored);
      adopt(await hydrateSealedKeys(seal));
      seal.hydrated = true;
      hydrated = true;
      // Flush a write deferred while the vault was opening before clearing revocation marks.
      if (owedWrite) persist();
      revoked.clear();
    },

    connect(provider, key) {
      revoked.delete(provider);
      anonymous.delete(provider);
      keyring = { ...keyring, [provider]: key };
    },

    connectAnonymous(provider) {
      anonymous.add(provider);
      drop(provider);
    },

    forget(provider, armed) {
      // Before hydration, an absent live key may still exist in persisted storage.
      if (hydrated && keyring[provider] === undefined && !anonymous.has(provider)) return false;
      if (armed) options.stopJob();
      revoked.add(provider);
      anonymous.delete(provider);
      drop(provider);
      return true;
    },

    persist,

    key: (provider) => keyring[provider],
    keyed: () => PROVIDER_IDS.filter((id) => (keyring[id] ?? '') !== ''),
    isAnonymous: (provider) => anonymous.has(provider),
    holding: (key) => PROVIDER_IDS.filter((id) => keyring[id] === key),
  };
}
