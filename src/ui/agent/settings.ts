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
  /** Files a key against a provider and arms that provider. The one way a key enters the app. */
  connectKey(provider: ProviderId, key: string): void;
  /** Revokes a provider key and aborts work using the armed provider before removal. */
  forgetKey(provider?: ProviderId): void;
  setProvider(provider: ProviderId): void;
  /** Arms and pins an explicitly selected provider. */
  pinProvider(provider: ProviderId): void;
  setModel(model: string): void;
  setOversight(oversight: Oversight): void;
  setEffort(effort: string): void;
  /** Sanitizes the endpoint and returns the stored value. */
  setCustomBaseUrl(raw: string): string;
  /** Records endpoint reachability; failure clears and remembers the custom model selection. */
  recordEndpointCheck(reachable: boolean): void;
}

/** Whether a key is held for the supplied provider, or the armed provider by default. */
export function isConnected(state: AgentPanelSettingsState, provider?: ProviderId): boolean {
  return state.keyed.includes(provider ?? state.provider);
}

/** Missing request inputs in setup order: key, custom endpoint, then model. */
export type ConnectionGap = 'key' | 'endpoint' | 'model';

export function connectionGaps(
  state: AgentPanelSettingsState, provider?: ProviderId,
): readonly ConnectionGap[] {
  const id = provider ?? state.provider;
  const gaps: ConnectionGap[] = [];
  if (!state.keyed.includes(id)) gaps.push('key');
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

/** Builds runner connection data and derives a regional-host index from persisted host metadata. */
export function runnerSettings(state: AgentPanelSettingsState): {
  providerId: ProviderId; apiKey: string; model: string; oversight: Oversight;
  customBaseUrl?: string; region?: 0 | 1; effort?: string;
} {
  const providerId = state.provider;
  const out: ReturnType<typeof runnerSettings> = {
    providerId,
    apiKey: keyring[providerId] ?? '',
    model: state.model[providerId] ?? '',
    oversight: state.oversight,
    effort: state.effort[effortKey(state)],
  };
  if (state.customBaseUrl) out.customBaseUrl = state.customBaseUrl;
  const host = carried.regionBaseUrl?.[providerId];
  const index = host ? (QUIRKS[providerId].baseUrls ?? []).indexOf(host) : -1;
  if (index === 1) out.region = 1;
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

  const record: AgentSettings = {
    ...stored, // Preserve fields this store does not model, including regional host metadata.
    provider: state.provider,
    model: state.model,
    keys,
    askBeforeEdits: state.oversight === 'strict',
    oversight: state.oversight,
    effort: state.effort,
  };
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
      endpointDown: '',
      formerModel: '',
      keyed: [],
      providerPinned: false,
      hydrated: false,

      hydrate: async () => {
        const stored = loadAgentSettings();
        // Live keys win over synchronous fallback keys; explicit revocations apply last.
        keyring = dropForgotten({ ...stored.keys, ...keyring });
        carried = stored.regionBaseUrl ? { regionBaseUrl: stored.regionBaseUrl } : {};
        set({
          provider: stored.provider,
          model: { ...emptyModels(), ...stored.model },
          oversight: stored.oversight,
          effort: stored.effort ?? {},
          customBaseUrl: stored.customBaseUrl ?? '',
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
        if (trimmed === '') return;
        forgotten.delete(provider);
        forgetRosters();
        keyring = { ...keyring, [provider]: trimmed };
        commit({ provider, keyed: keyedFrom(keyring) });
      },

      forgetKey: (provider) => {
        const id = provider ?? get().provider;
        // Before hydration, an absent live key may still exist in persisted storage.
        if (get().hydrated && keyring[id] === undefined) return;
        // Stop only work using the armed provider, before its key disappears.
        if (id === get().provider) stopLiveJob?.();
        forgotten.add(id);
        forgetRosters();
        const next = { ...keyring };
        delete next[id];
        keyring = next;
        // Revoking the armed key also releases its transient provider pin.
        commit({ keyed: keyedFrom(keyring), ...(id === get().provider ? { providerPinned: false } : {}) });
      },

      setProvider: (provider) => commit({ provider }),

      pinProvider: (provider) => commit({ provider, providerPinned: true }),

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
