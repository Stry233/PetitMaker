/*
 * The assistant's connection: provider, per-provider model, oversight, effort, custom endpoint and
 * saved regional hosts, shared by setup, the panel and the runner. Keys stay in the credential store,
 * outside Zustand state; that store owns hydration order, revocation and persistence, and this one
 * mirrors which providers are connected.
 */
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { Oversight } from '../core/gates';
import { endpointKey, isRegionSplit, PROVIDER_IDS, QUIRKS, type ProviderId, type ProviderRegion } from '../providers/defaults';
import { createCredentialStore, type CredentialStore } from '../security/credential-store';
import { sanitizeEndpointUrl } from '../../platform/remote/endpoint-url';
import { forgetRosters } from './model-roster';

/** The mounted runner's stop: one page-wide registration. */
let stopLiveJob: (() => void) | undefined;

/** Registers or clears the running job's stop callback. */
export function setLiveJobStop(stop: (() => void) | undefined): void {
  stopLiveJob = stop;
}

function newCredentials(): CredentialStore {
  return createCredentialStore({
    stopJob: () => stopLiveJob?.(),
    fields: () => {
      const state = useAgentConnection.getState();
      return {
        ...(state.regionBaseUrl ? { regionBaseUrl: state.regionBaseUrl } : {}),
        provider: state.provider,
        model: state.model,
        oversight: state.oversight,
        effort: state.effort,
        customBaseUrl: state.customBaseUrl || undefined,
      };
    },
  });
}

/** The page's credential store, replaced only by `__resetAgentConnection`. */
let credentials = newCredentials();

export interface AgentConnectionState {
  provider: ProviderId;
  /** Per-provider model id, keyed like the stored record so switching providers keeps each pick. */
  model: Record<ProviderId, string>;
  oversight: Oversight;
  effort: Record<string, string>;
  /** The `custom` provider's endpoint, already sanitized. Empty means none configured. */
  customBaseUrl: string;
  customAuth: 'key' | 'none';
  /** The explicitly saved host of each region-split provider; absent until one is saved. */
  regionBaseUrl: Partial<Record<ProviderId, string>> | undefined;
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
  /** Arms a connected provider, or pins one still owed a key; whether a key is owed. */
  chooseProvider(provider: ProviderId): 'armed' | 'needs-key';
  clearProviderPin(): void;
  setProviderRegion(provider: ProviderId, region: ProviderRegion): void;
  setModel(model: string): void;
  setOversight(oversight: Oversight): void;
  setEffort(effort: string): void;
  /** Sanitizes the endpoint and returns the stored value. */
  setCustomBaseUrl(raw: string): string;
}

/** Whether the provider has a credential or an explicitly configured unauthenticated endpoint. */
export function isConnected(state: AgentConnectionState, provider?: ProviderId): boolean {
  const id = provider ?? state.provider;
  return state.keyed.includes(id) || (id === 'custom' && state.customAuth === 'none' && state.customBaseUrl !== '');
}

/** Missing request inputs in setup order: key, custom endpoint, then model. */
type ConnectionGap = 'key' | 'endpoint' | 'model';

export function connectionGaps(
  state: AgentConnectionState, provider?: ProviderId,
): readonly ConnectionGap[] {
  const id = provider ?? state.provider;
  const gaps: ConnectionGap[] = [];
  if (!isConnected(state, id)) gaps.push('key');
  if (id === 'custom' && state.customBaseUrl === '') gaps.push('endpoint');
  if ((state.model[id] ?? '') === '') gaps.push('model');
  return gaps;
}

/** Shared readiness test for setup completion, composer input and idle-panel selection. */
export function connectionReady(state: AgentConnectionState, provider?: ProviderId): boolean {
  return connectionGaps(state, provider).length === 0;
}

/** A region is known only when its endpoint was explicitly saved. */
export function providerRegion(state: AgentConnectionState, provider: ProviderId): ProviderRegion | undefined {
  const host = state.regionBaseUrl?.[provider];
  const index = host ? (QUIRKS[provider].baseUrls ?? []).indexOf(host) : -1;
  return index === 0 || index === 1 ? index : undefined;
}

/** Exact local matches reuse one saved destination; duplicates and incomplete routes stay undecided. */
export function providerForSavedKey(raw: string): ProviderId | 'ambiguous' | null {
  const key = raw.trim();
  if (!key) return null;
  const matches = credentials.holding(key);
  if (matches.length > 1) return 'ambiguous';
  const id = matches[0];
  if (!id) return null;
  const state = useAgentConnection.getState();
  if (id === 'custom' && !state.customBaseUrl) return 'ambiguous';
  if (isRegionSplit(id) && providerRegion(state, id) === undefined) return 'ambiguous';
  return id;
}

/** The armed connection a job launches with, its regional-host index derived from the saved host. */
export interface ArmedConnection {
  providerId: ProviderId; apiKey: string; model: string; oversight: Oversight;
  customBaseUrl?: string; region?: ProviderRegion; effort?: string;
}

/** Builds the runner's connection data, with the two situational fields absent when they do not apply. */
export function runnerSettings(state: AgentConnectionState): ArmedConnection {
  const providerId = state.provider;
  const out: ArmedConnection = {
    providerId,
    apiKey: credentials.key(providerId) ?? '',
    model: state.model[providerId] ?? '',
    oversight: state.oversight,
    effort: state.effort[effortKey(state)],
  };
  const endpoint = endpointKey(providerId, state.customBaseUrl);
  if (endpoint !== undefined) out.customBaseUrl = endpoint;
  if (providerRegion(state, providerId) === 1) out.region = 1;
  return out;
}

function emptyModels(): Record<ProviderId, string> {
  return Object.fromEntries(PROVIDER_IDS.map((id) => [id, ''])) as Record<ProviderId, string>;
}

/** The connection facts this store mirrors from the credential store. */
function credentialState(): Pick<AgentConnectionState, 'keyed' | 'customAuth' | 'hydrated'> {
  return {
    keyed: credentials.keyed(),
    customAuth: credentials.isAnonymous('custom') ? 'none' : 'key',
    hydrated: credentials.hydrated,
  };
}

const INITIAL = {
  provider: 'claude', oversight: 'checkpoint', effort: {}, customBaseUrl: '', customAuth: 'key',
  regionBaseUrl: undefined, keyed: [], providerPinned: false, hydrated: false,
} as const satisfies Partial<AgentConnectionState>;

export const useAgentConnection: UseBoundStore<StoreApi<AgentConnectionState>> =
  create<AgentConnectionState>((set, get) => {
    /** One mutation: fold the patch in, then write the whole record. */
    function commit(patch: Partial<AgentConnectionState>): void {
      set(patch);
      credentials.persist();
    }

    return {
      ...INITIAL,
      model: emptyModels(),

      hydrate: async () => {
        await credentials.hydrate((stored) => {
          set({
            provider: stored.provider,
            model: { ...emptyModels(), ...stored.model },
            oversight: stored.oversight,
            effort: stored.effort ?? {},
            customBaseUrl: stored.customBaseUrl ?? '',
            regionBaseUrl: stored.regionBaseUrl,
            ...credentialState(),
          });
        });
        set(credentialState());
      },

      connectKey: (provider, key) => {
        const trimmed = key.trim();
        if (trimmed === '') {
          if (provider !== 'custom' || get().customBaseUrl === '') return;
          credentials.connectAnonymous(provider);
        } else {
          credentials.connect(provider, trimmed);
        }
        forgetRosters();
        commit({ provider, ...credentialState() });
      },

      forgetKey: (provider) => {
        const id = provider ?? get().provider;
        const armed = id === get().provider;
        if (!credentials.forget(id, armed)) return;
        forgetRosters();
        // Revoking the armed key also releases its transient provider pin.
        commit({ ...credentialState(), ...(armed ? { providerPinned: false } : {}) });
      },

      setProvider: (provider) => commit({ provider, providerPinned: false }),

      pinProvider: (provider) => commit({ provider, providerPinned: true }),
      chooseProvider: (provider) => {
        const connected = isConnected(get(), provider);
        commit({ provider, providerPinned: !connected });
        return connected ? 'armed' : 'needs-key';
      },
      clearProviderPin: () => set({ providerPinned: false }),

      setProviderRegion: (provider, region) => {
        const url = QUIRKS[provider].baseUrls?.[region];
        if (!url) return;
        forgetRosters();
        commit({ regionBaseUrl: { ...get().regionBaseUrl, [provider]: url } });
      },

      setModel: (model) => commit({ model: { ...get().model, [get().provider]: model } }),

      setEffort: (effort) => commit({ effort: { ...get().effort, [effortKey(get())]: effort } }),
      setOversight: (oversight) => commit({ oversight }),

      setCustomBaseUrl: (raw) => {
        const url = sanitizeEndpointUrl(raw);
        commit({ customBaseUrl: url });
        return url;
      },
    };
  });

/** Restores the page's connection to its state before hydration, with an empty credential store. */
export function __resetAgentConnection(): void {
  credentials = newCredentials();
  useAgentConnection.setState({ ...INITIAL, model: emptyModels() });
}

/** Effort belongs to one provider, endpoint and model selection. */
export function effortKey(state: AgentConnectionState): string {
  return `${state.provider}|${state.provider === 'custom' ? state.customBaseUrl : ''}|${state.model[state.provider]}`;
}
