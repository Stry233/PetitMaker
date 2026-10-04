import { forgetRosters } from './model-roster';
/*
 * Connection settings shared by setup and the runner. Secrets stay in a module keyring rather than
 * Zustand state, and persistence is delegated to the encrypted key-storage module. Hydration merges
 * synchronous settings and asynchronous sealed keys under live mutations; explicit revocations are
 * tracked separately because object merges cannot represent a deliberate absence.
 */
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { Oversight } from '../../agent/core/gates';
import {
  hydrateSealedKeys, loadAgentSettings, markKeysHydrated, saveAgentSettings,
  type AgentSettings,
} from '../../agent/security/key-storage';
import { sanitizeEndpointUrl } from '../../core/runtime/endpoint-url';
import { PROVIDER_IDS, QUIRKS, type ProviderId } from '../../agent/providers/defaults';

/** Provider secrets kept outside renderable or serializable store state. */
let keyring: Partial<Record<ProviderId, string>> = {};

/** Persisted regional host metadata consumed by `runnerSettings`. */
let carried: Pick<AgentSettings, 'regionBaseUrl'> = {};

/** Whether a pre-hydration mutation still needs to be persisted. */
let owedWrite = false;

/** Revocations retained until both hydration passes and any owed write have accounted for them. */
const forgotten = new Set<ProviderId>();

/** Runner stop callback used to abort live work before revoking its credential. */
let stopLiveJob: (() => void) | undefined;

/** Registers or clears the current runner stop callback. */
export function setLiveJobStop(stop: (() => void) | undefined): void {
  stopLiveJob = stop;
}

/** A keyring with this session's revocations taken back out of it. */
function dropForgotten(ring: Partial<Record<ProviderId, string>>): Partial<Record<ProviderId, string>> {
  if (forgotten.size === 0) return ring;
  const out = { ...ring };
  for (const id of forgotten) delete out[id];
  return out;
}

export interface AgentPanelSettingsState {
  provider: ProviderId;
  /** Per-provider model id, keyed like the stored record so switching providers keeps each pick. */
  model: Record<ProviderId, string>;
  oversight: Oversight;
  effort: Record<string, string>;
  /** The `custom` provider's endpoint, already sanitized. Empty means none configured. */
  customBaseUrl: string;
  customAuth: 'key' | 'none';
  /** Address whose latest completed verification failed, or empty; not persisted. */
  endpointDown: string;
  /** Model cleared by a failed endpoint check and offered after recovery; not persisted. */
  formerModel: string;
  /** Providers with a held key; secret values remain outside the store. */
  keyed: readonly ProviderId[];
  /** Whether the user explicitly selected the provider; transient setup-flow state. */
  providerPinned: boolean;
  /** Whether async sealed-key hydration is complete. */
  hydrated: boolean;

  /** Hydrates non-secret settings and sealed keys while preserving mutations made during the read. */
  hydrate(): Promise<void>;
  /** Files a provider credential; a blank custom key explicitly configures an unauthenticated endpoint. */
  connectKey(provider: ProviderId, key: string): void;
  /** Revokes a provider key and aborts work using the armed provider before removal. */
  forgetKey(provider?: ProviderId): void;
  setProvider(provider: ProviderId): void;
  /** Arms and pins an explicitly selected provider. */
  pinProvider(provider: ProviderId): void;
  clearProviderPin(): void;
  setProviderRegion(provider: ProviderId, region: 0 | 1): void;
  setModel(model: string): void;
  setOversight(oversight: Oversight): void;
  setEffort(effort: string): void;
  /** Sanitizes the endpoint and returns the stored value. */
  setCustomBaseUrl(raw: string): string;
  /** Records endpoint reachability; failure clears and remembers the custom model selection. */
  recordEndpointCheck(reachable: boolean): void;
}

/** Whether the provider has a credential or an explicitly configured unauthenticated endpoint. */
export function isConnected(state: AgentPanelSettingsState, provider?: ProviderId): boolean {
  const id = provider ?? state.provider;
  return state.keyed.includes(id) || (id === 'custom' && state.customAuth === 'none' && state.customBaseUrl !== '');
}

/** Missing request inputs in setup order: key, custom endpoint, then model. */
type ConnectionGap = 'key' | 'endpoint' | 'model';

export function connectionGaps(
  state: AgentPanelSettingsState, provider?: ProviderId,
): readonly ConnectionGap[] {
  const id = provider ?? state.provider;
  const gaps: ConnectionGap[] = [];
  if (!isConnected(state, id)) gaps.push('key');
  if (id === 'custom'
    && (state.customBaseUrl === '' || (state.endpointDown !== '' && state.endpointDown === state.customBaseUrl))) {
    gaps.push('endpoint');
  }
  if ((state.model[id] ?? '') === '') gaps.push('model');
  return gaps;
}

/** Shared readiness test for setup completion, composer input and idle-panel selection. */
export function connectionReady(state: AgentPanelSettingsState, provider?: ProviderId): boolean {
  return connectionGaps(state, provider).length === 0;
}

/** A region is known only when its endpoint was explicitly saved. */
export function providerRegion(provider: ProviderId): 0 | 1 | undefined {
  const host = carried.regionBaseUrl?.[provider];
  const index = host ? (QUIRKS[provider].baseUrls ?? []).indexOf(host) : -1;
  return index === 0 || index === 1 ? index : undefined;
}

/** Exact local matches reuse one saved destination; duplicates and incomplete routes stay undecided. */
export function providerForSavedKey(raw: string): ProviderId | 'ambiguous' | null {
  const key = raw.trim();
  if (!key) return null;
  const matches = PROVIDER_IDS.filter(id => keyring[id] === key);
  if (matches.length > 1) return 'ambiguous';
  const id = matches[0];
  if (!id) return null;
  if (id === 'custom' && !useAgentPanelSettings.getState().customBaseUrl) return 'ambiguous';
  if ((QUIRKS[id].baseUrls?.length ?? 0) > 1 && providerRegion(id) === undefined) return 'ambiguous';
  return id;
}

/** Builds runner connection data and derives a regional-host index from persisted host metadata. */
export function runnerSettings(state: AgentPanelSettingsState): {
  providerId: ProviderId; apiKey: string; model: string; oversight: Oversight;
  customBaseUrl?: string; region?: 0 | 1; effort?: string;
} {
  const providerId = state.provider;
  const out: ReturnType<typeof runnerSettings> = {
    providerId,
    apiKey: providerId === 'custom' && state.customAuth === 'none' ? '' : keyring[providerId] ?? '',
    model: state.model[providerId] ?? '',
    oversight: state.oversight,
    effort: state.effort[effortKey(state)],
  };
  if (state.customBaseUrl) out.customBaseUrl = state.customBaseUrl;
  if (providerRegion(providerId) === 1) out.region = 1;
  return out;
}

function emptyModels(): Record<ProviderId, string> {
  return Object.fromEntries(PROVIDER_IDS.map((id) => [id, ''])) as Record<ProviderId, string>;
}

function keyedFrom(ring: Partial<Record<ProviderId, string>>): ProviderId[] {
  return PROVIDER_IDS.filter((id) => (ring[id] ?? '') !== '');
}

/**
 * Persists only after hydration to avoid overwriting unread settings or sealed keys. Live fields
 * merge over the stored record, preserving unmodeled metadata and removing explicit revocations.
 */
function persist(state: AgentPanelSettingsState): void {
  if (!state.hydrated) {
    owedWrite = true;
    return;
  }
  owedWrite = false;

  const stored = loadAgentSettings();
  // Preserve fallback keys for other providers, then apply explicit revocations.
  const keys = dropForgotten({ ...stored.keys, ...keyring });
  if (state.customAuth === 'none') delete keys.custom;

  const record: AgentSettings = {
    ...stored,
    ...carried,
    provider: state.provider,
    model: state.model,
    keys,
    askBeforeEdits: state.oversight === 'strict',
    oversight: state.oversight,
    effort: state.effort,
  };
  if (state.customAuth === 'none') record.customAuth = 'none';
  else delete record.customAuth;
  if (state.customBaseUrl) record.customBaseUrl = state.customBaseUrl;
  else delete record.customBaseUrl;
  saveAgentSettings(record);
}

export const useAgentPanelSettings: UseBoundStore<StoreApi<AgentPanelSettingsState>> =
  create<AgentPanelSettingsState>((set, get) => {
    /** One mutation: fold the patch in, then write the whole record. */
    function commit(patch: Partial<AgentPanelSettingsState>): void {
      set(patch);
      persist(get());
    }

    return {
      provider: 'claude',
      model: emptyModels(),
      oversight: 'checkpoint',
      effort: {},
      customBaseUrl: '',
      customAuth: 'key',
      endpointDown: '',
      formerModel: '',
      keyed: [],
      providerPinned: false,
      hydrated: false,

      hydrate: async () => {
        const stored = loadAgentSettings();
        const customAuth = forgotten.has('custom') || keyring.custom !== undefined
          ? get().customAuth : stored.customAuth ?? 'key';
        if (customAuth === 'none') forgotten.add('custom');
        // Live keys win over synchronous fallback keys; explicit revocations apply last.
        keyring = dropForgotten({ ...stored.keys, ...keyring });
        carried = stored.regionBaseUrl ? { regionBaseUrl: stored.regionBaseUrl } : {};
        set({
          provider: stored.provider,
          model: { ...emptyModels(), ...stored.model },
          oversight: stored.oversight,
          effort: stored.effort ?? {},
          customBaseUrl: stored.customBaseUrl ?? '',
          customAuth,
          keyed: keyedFrom(keyring),
        });

        const sealed = await hydrateSealedKeys();
        // Live keys win over the sealed snapshot; explicit revocations apply to both sources.
        if (sealed) keyring = dropForgotten({ ...sealed, ...keyring });
        markKeysHydrated();
        set({ keyed: keyedFrom(keyring), hydrated: true });
        // Flush mutations deferred while the vault was opening before clearing revocation markers.
        if (owedWrite) persist(get());
        forgotten.clear();
      },

      connectKey: (provider, key) => {
        const trimmed = key.trim();
        if (trimmed === '') {
          if (provider !== 'custom' || get().customBaseUrl === '') return;
          forgotten.add('custom');
          const next = { ...keyring };
          delete next.custom;
          keyring = next;
          forgetRosters();
          commit({ provider, customAuth: 'none', keyed: keyedFrom(keyring) });
          return;
        }
        forgotten.delete(provider);
        forgetRosters();
        keyring = { ...keyring, [provider]: trimmed };
        commit({ provider, keyed: keyedFrom(keyring), ...(provider === 'custom' ? { customAuth: 'key' } : {}) });
      },

      forgetKey: (provider) => {
        const id = provider ?? get().provider;
        // Before hydration, an absent live key may still exist in persisted storage.
        if (get().hydrated && keyring[id] === undefined && !(id === 'custom' && get().customAuth === 'none')) return;
        // Stop only work using the armed provider, before its key disappears.
        if (id === get().provider) stopLiveJob?.();
        forgotten.add(id);
        forgetRosters();
        const next = { ...keyring };
        delete next[id];
        keyring = next;
        // Revoking the armed key also releases its transient provider pin.
        commit({ keyed: keyedFrom(keyring), ...(id === 'custom' ? { customAuth: 'key' } : {}), ...(id === get().provider ? { providerPinned: false } : {}) });
      },

      setProvider: (provider) => commit({ provider, providerPinned: false }),

      pinProvider: (provider) => commit({ provider, providerPinned: true }),
      clearProviderPin: () => set({ providerPinned: false }),

      setProviderRegion: (provider, region) => {
        const url = QUIRKS[provider].baseUrls?.[region];
        if (!url) return;
        carried = { regionBaseUrl: { ...carried.regionBaseUrl, [provider]: url } };
        forgetRosters();
        commit({});
      },

      setModel: (model) => commit({
        model: { ...get().model, [get().provider]: model },
        // A new custom-model pick retires the recovered-model offer.
        ...(model !== '' && get().provider === 'custom' ? { formerModel: '' } : {}),
      }),

      setEffort: (effort) => commit({ effort: { ...get().effort, [effortKey(get())]: effort } }),
      setOversight: (oversight) => commit({ oversight }),

      setCustomBaseUrl: (raw) => {
        const url = sanitizeEndpointUrl(raw);
        commit({ customBaseUrl: url });
        return url;
      },

      recordEndpointCheck: (reachable) => {
        if (reachable) {
          if (get().endpointDown !== '') set({ endpointDown: '' });
          return;
        }
        const was = get().model.custom ?? '';
        commit({
          endpointDown: get().customBaseUrl,
          model: { ...get().model, custom: '' },
          // Repeated failures keep the last non-empty model selection.
          ...(was !== '' ? { formerModel: was } : {}),
        });
      },
    };
  });

/** Effort belongs to one provider, endpoint and model selection. */
export function effortKey(state: AgentPanelSettingsState): string {
  return `${state.provider}|${state.provider === 'custom' ? state.customBaseUrl : ''}|${state.model[state.provider]}`;
}
