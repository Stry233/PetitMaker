/*
 * useProviderSettings — provider / API-key / model handling for AgentSection.
 *
 * Owns the key-draft state, the detected-platform spinner, and the manual
 * provider chooser, plus the three handlers that drive them: saveKey (identify
 * the provider from the key format, else probe /models, else ask), commitKey
 * (file the key + switch + optionally collapse settings), and refreshModels.
 *
 * The provider/key/model VALUES live in the agent store; this hook only owns the
 * transient UI draft + detection state. `settingsOpen` is owned by the caller
 * (AgentSection) because the settings strip's open/closed height drives the chat
 * layout spring — but this hook flips it open when switching to a key-less
 * provider and closed when a key is committed, matching the original behaviour.
 */
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useAgentStore } from '../../../agent/store';
import { PROVIDERS, identifyProviderByProbe } from '../../../agent/providers';
import { detectProviderFromKey, PROVIDER_META } from '../../../agent/providers/defaults';
import type { ProviderId } from '../../../agent/types';

export interface ProviderSettings {
  keyDraft: string;
  setKeyDraft: Dispatch<SetStateAction<string>>;
  detecting: boolean;
  chooserOpen: boolean;
  setChooserOpen: Dispatch<SetStateAction<boolean>>;
  saveKey: (collapseAfter?: boolean, keyOverride?: string) => Promise<void>;
  commitKey: (id: ProviderId, k: string, collapseAfter: boolean) => void;
  refreshModels: () => Promise<void>;
  /** Abort an in-flight probe and open the manual chooser immediately. */
  skipDetection: () => void;
}

export function useProviderSettings(
  setSettingsOpen: Dispatch<SetStateAction<boolean>>,
): ProviderSettings {
  const agent = useAgentStore();
  const provider = agent.settings.provider;
  const apiKey = agent.settings.keys[provider] ?? '';
  const keysHydrated = agent.keysHydrated;

  const [keyDraft, setKeyDraft] = useState(apiKey);
  const [detecting, setDetecting] = useState(false);
  const [chooserOpen, setChooserOpen] = useState(false);
  const detectCtrlRef = useRef<AbortController | null>(null);

  // key draft follows the provider switch; a provider without a key (or a custom
  // provider without an endpoint URL) needs its settings visible.
  //
  // Gate the auto-open on keysHydrated: saved keys decrypt asynchronously, so a
  // mount-time read sees "no key" for a user who actually has one — opening setup
  // here would flash the greeting, then flip to model-selection once hydration
  // lands. Before hydration the initial setup/chat decision belongs to the
  // hydration-gated owner (SiteLogSection); after it, real provider switches still
  // open settings for a genuinely key-less provider.
  useEffect(() => {
    const k = agent.settings.keys[provider] ?? '';
    setKeyDraft(k);
    if (keysHydrated && (!k || (provider === 'custom' && !agent.settings.customBaseUrl))) setSettingsOpen(true);
  }, [provider, keysHydrated]); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshModels = async () => {
    if (!apiKey) return;
    // Reconcile the selected model to the LIVE list: keep it only while it is
    // actually offered; otherwise pick a valid one, or clear it when the list is
    // empty (a wrong key / bad config), so a stale remembered model can't linger.
    const reconcile = (ids: string[]) => {
      const cur = useAgentStore.getState().settings.model[provider];
      if (ids.length === 0) {
        if (cur) agent.setModel(provider, '');
      } else if (!cur || !ids.includes(cur)) {
        const def = PROVIDER_META[provider].defaultModel;
        agent.setModel(provider, ids.includes(def) ? def : ids[0]!);
      }
    };
    try {
      const ids = (await PROVIDERS[provider].create(apiKey, agent.settings.customBaseUrl).listModels())
        .filter(PROVIDERS[provider].modelFilter);
      // Only the LIVE list is authoritative: on an empty result we store [] (never
      // a placeholder/fallback list), so a wrong key or bad config shows nothing.
      agent.setModelList(provider, ids);
      reconcile(ids);
    } catch {
      // Fetch failed (bad key / CORS / offline): clear the list AND the stale
      // selection. The dropdown's custom-model input still lets the user type one.
      agent.setModelList(provider, []);
      reconcile([]);
    }
  };
  useEffect(() => {
    // ?.length (not just presence): custom's fallback list is EMPTY, and it gets
    // stored before the endpoint URL exists — retry once the URL arrives.
    if (apiKey && !agent.modelList[provider]?.length) void refreshModels();
  }, [provider, apiKey, agent.settings.customBaseUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  /** File the key under `id`, switch to it, optionally collapse settings.
   *  A custom provider without an endpoint URL keeps settings open — the URL
   *  row is the next thing the user must fill in. */
  const commitKey = (id: ProviderId, k: string, collapseAfter: boolean) => {
    if (id !== provider) agent.setProvider(id);
    agent.setKey(id, k);
    setChooserOpen(false);
    setDetecting(false);
    const needsUrl = id === 'custom' && !useAgentStore.getState().settings.customBaseUrl;
    if (k && collapseAfter && !needsUrl) setSettingsOpen(false);
  };

  /** Pasting a key is the only required action: identify the provider from the
   *  key format; if the format is ambiguous, probe /models; if that fails, fall
   *  back to Custom so the user always lands on a working model-selection screen
   *  (from there they can change the platform by hand). */
  const saveKey = async (collapseAfter = true, keyOverride?: string) => {
    const k = (keyOverride ?? keyDraft).trim();
    if (!k) return;
    const fmt = detectProviderFromKey(k);
    if (fmt) { commitKey(fmt, k, collapseAfter); return; }
    setDetecting(true);
    setChooserOpen(false);
    const ctrl = new AbortController();
    detectCtrlRef.current?.abort();
    detectCtrlRef.current = ctrl;
    const probed = await identifyProviderByProbe(k, ctrl.signal, agent.settings.customBaseUrl);
    if (ctrl.signal.aborted) return;
    setDetecting(false);
    commitKey(probed ?? 'custom', k, collapseAfter); // no match: default to Custom
  };

  /** The user can bail out of probing (unreachable endpoints can eat the whole
   *  deadline) — abort and go straight to the manual chooser. */
  const skipDetection = () => {
    detectCtrlRef.current?.abort();
    setDetecting(false);
    setChooserOpen(true);
  };

  return { keyDraft, setKeyDraft, detecting, chooserOpen, setChooserOpen, saveKey, commitKey, refreshModels, skipDetection };
}
