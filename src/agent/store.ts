/**
 * Zustand store for the AI Agent settings surface: BYOK settings (persisted
 * via key-storage), the live per-provider model lists, and the provider-
 * neutral LLM message history for the current conversation. The visible
 * conversation itself lives in agent/session.ts (the Site Log).
 */
import { create } from 'zustand';
import type { AgentMessage, ProviderId } from './types';
import {
  loadAgentSettings, saveAgentSettings, hydrateSealedKeys, markKeysHydrated,
  sanitizeEndpointUrl, type AgentSettings, type Oversight,
} from './key-storage';

interface AgentStore {
  settings: AgentSettings;
  /** True once the async vault decryption settled (with or without keys). Screen
   *  decisions that depend on "does a key exist" must wait for this — the sync
   *  settings load deliberately carries no vault-sealed keys. */
  keysHydrated: boolean;
  /** Whether the agent panel shows the setup screen or the chat. Session-scoped so
   *  leaving and re-entering the panel returns to the same screen; null until the
   *  first decision (made once keys have hydrated). */
  setupOpen: boolean | null;
  setSetupOpen(v: boolean): void;
  setProvider(p: ProviderId): void;
  setModel(p: ProviderId, model: string): void;
  setKey(p: ProviderId, key: string): void;
  setAskBeforeEdits(v: boolean): void;
  setOversight(v: Oversight): void;
  setCustomBaseUrl(url: string): void;

  modelList: Partial<Record<ProviderId, string[]>>;
  setModelList(p: ProviderId, models: string[]): void;

  /** Neutral LLM-side history (the transcript the model sees), session-only. */
  history: AgentMessage[];
  setHistory(h: AgentMessage[]): void;
  /** Start fresh: clears the model-side conversation (the map is untouched). */
  clearChat(): void;
}

export const useAgentStore = create<AgentStore>((set) => ({
  settings: loadAgentSettings(),
  keysHydrated: false,
  setupOpen: null,
  setSetupOpen: (v) => set({ setupOpen: v }),
  setProvider: (p) =>
    set((s) => {
      const settings = { ...s.settings, provider: p };
      saveAgentSettings(settings);
      return { settings };
    }),
  setModel: (p, model) =>
    set((s) => {
      const settings = { ...s.settings, model: { ...s.settings.model, [p]: model } };
      saveAgentSettings(settings);
      return { settings };
    }),
  setKey: (p, key) =>
    set((s) => {
      const settings = { ...s.settings, keys: { ...s.settings.keys, [p]: key || undefined } };
      saveAgentSettings(settings);
      return { settings };
    }),
  // askBeforeEdits and oversight are mirrors of one policy: the legacy boolean
  // maps to strict/checkpoint, and any oversight choice updates the boolean
  // (saveAgentSettings persists the same mirror for old readers).
  setAskBeforeEdits: (v) =>
    set((s) => {
      const settings: AgentSettings = { ...s.settings, askBeforeEdits: v, oversight: v ? 'strict' : 'checkpoint' };
      saveAgentSettings(settings);
      return { settings };
    }),
  setOversight: (v) =>
    set((s) => {
      const settings: AgentSettings = { ...s.settings, oversight: v, askBeforeEdits: v === 'strict' };
      saveAgentSettings(settings);
      return { settings };
    }),
  setCustomBaseUrl: (url) =>
    set((s) => {
      // sanitize: add https where missing, upgrade non-loopback http (a key
      // must never travel in cleartext), reject non-http(s) schemes
      const settings = { ...s.settings, customBaseUrl: sanitizeEndpointUrl(url) || undefined };
      saveAgentSettings(settings);
      return { settings };
    }),

  modelList: {},
  setModelList: (p, models) => set((s) => ({ modelList: { ...s.modelList, [p]: models } })),

  history: [],
  setHistory: (history) => set({ history }),
  clearChat: () => set({ history: [] }),
}));

// Startup hydration: vault-sealed keys decrypt asynchronously (key-storage →
// vault). Keys the user typed THIS session take precedence over hydrated ones.
void hydrateSealedKeys()
  .then((keys) => {
    markKeysHydrated();
    if (!keys) {
      useAgentStore.setState({ keysHydrated: true });
      return;
    }
    useAgentStore.setState((s) => ({
      keysHydrated: true,
      settings: { ...s.settings, keys: { ...keys, ...s.settings.keys } },
    }));
  })
  .catch(() => {
    markKeysHydrated();
    useAgentStore.setState({ keysHydrated: true });
  });
