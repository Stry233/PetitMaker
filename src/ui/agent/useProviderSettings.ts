/*
 * useProviderSettings — provider / API-key / model handling for the Site Log.
 *
 * Owns the key-draft state, the detected-platform spinner, and the manual
 * provider chooser, plus the three handlers that drive them: saveKey (identify
 * the provider from the key format, else probe /models, else ask), commitKey
 * (file the key + switch + optionally collapse settings), and refreshModels.
 *
 * The provider/key/model VALUES live in the agent store; this hook only owns the
 * transient UI draft + detection state. `settingsOpen` is owned by the caller
 * (`SiteLogSection`) because the settings strip's open/closed height drives the chat
 * layout spring — but this hook flips it open when switching to a key-less
 * provider and closed when a key is committed, matching the original behaviour.
 *
 * `agent/providers` is reached by dynamic import, never statically: that module
 * carries the two LLM SDKs, and this hook renders a key field that a visitor with
 * no key never uses. Everything needed to DRAW the field is metadata
 * (`providers/defaults`); an adapter is needed only once a key is in hand, so the
 * weight arrives with the first call rather than with the panel.
 */
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useAgentStore } from '../../agent/store';
import { REGION_SPLIT, baseUrlFor, detectProviderFromKey, PROVIDER_META } from '../../agent/providers/defaults';
import type { ProviderId } from '../../agent/types';

/** The adapters, fetched once and shared. Two of the handlers below can be in flight at the same
 *  moment (the mount effect refreshes the model list while a pasted key is being identified), and
 *  one handle is what keeps that to a single request for the chunk. */
let adapters: Promise<typeof import('../../agent/providers')> | null = null;
function providers(): Promise<typeof import('../../agent/providers')> {
  adapters ??= import('../../agent/providers');
  return adapters;
}

export interface ProviderSettings {
  keyDraft: string;
  setKeyDraft: Dispatch<SetStateAction<string>>;
  detecting: boolean;
  chooserOpen: boolean;
  setChooserOpen: Dispatch<SetStateAction<boolean>>;
  saveKey: (collapseAfter?: boolean, keyOverride?: string) => Promise<void>;
  commitKey: (id: ProviderId, k: string, collapseAfter: boolean, baseUrl?: string) => void;
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
        const def = PROVIDER_META[provider].preferredModel;
        agent.setModel(provider, ids.includes(def) ? def : ids[0]!);
      }
    };
    try {
      const { PROVIDERS } = await providers();
      const ids = (await PROVIDERS[provider].create(apiKey, baseUrlFor(provider, agent.settings)).listModels())
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
    // The regional host resolves after the key is committed, and it changes which endpoint the
    // list comes from, so a resolution re-asks.
  }, [provider, apiKey, agent.settings.customBaseUrl, baseUrlFor(provider, agent.settings)]); // eslint-disable-line react-hooks/exhaustive-deps

  /** File the key under `id`, switch to it, optionally collapse settings.
   *  A custom provider without an endpoint URL keeps settings open — the URL
   *  row is the next thing the user must fill in. */
  const commitKey = (id: ProviderId, k: string, collapseAfter: boolean, baseUrl?: string) => {
    if (id !== provider) agent.setProvider(id);
    agent.setKey(id, k);
    if (baseUrl) agent.setRegionBaseUrl(id, baseUrl);
    setChooserOpen(false);
    setDetecting(false);
    const needsUrl = id === 'custom' && !useAgentStore.getState().settings.customBaseUrl;
    if (k && collapseAfter && !needsUrl) setSettingsOpen(false);
    // Which regional deployment issued the key is not in the key or the platform name, so the
    // hosts are asked. Runs after the commit: the answer only narrows an endpoint already in use.
    if (REGION_SPLIT.has(id) && !baseUrl && k) {
      void providers()
        .then((m) => m.resolveBaseUrl(id, k))
        .then((url) => { if (url) agent.setRegionBaseUrl(id, url); });
    }
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
    const { identifyProviderByProbe } = await providers();
    const probed = await identifyProviderByProbe(k, ctrl.signal, agent.settings.customBaseUrl);
    if (ctrl.signal.aborted) return;
    setDetecting(false);
    // no match: default to Custom
    commitKey(probed?.provider ?? 'custom', k, collapseAfter, probed?.baseUrl);
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
