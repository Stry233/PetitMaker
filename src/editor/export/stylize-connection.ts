/*
 * The stylize window's connection: provider, key, address and model. The model list is probed off the
 * key after `PROBE_DEBOUNCE_MS` through `platform/async/model-discovery.ts` (none, loading, ready with
 * the first model picked, or a typed field where the endpoint will not list); a newer edit aborts the
 * probe in flight, and probing runs only while the connection page stands.
 */
import { createModelDiscovery, settledModel, type DiscoveryState, type ProbeAnswer } from '../../platform/async/model-discovery';
import { DEFAULT_STYLIZE_PROVIDER } from '../../io/storage/stylize-settings';
import type { StylizeProvider } from '../../pipelines/stylize';
import {
  connectionStatus, connectionTarget, defaultListModels, fileStylizeConnection, readStylizeConnection,
  type DialectConfig, type StylizeDialect, type StylizeListModels, type StylizeStatus,
} from './stylize';

export type { StylizeListModels };

/** How long the hands stay still before the key or the address is taken as settled. */
const PROBE_DEBOUNCE_MS = 600;

export type ModelsState = Exclude<DiscoveryState, 'refused'>;

export interface StylizeConnectionState {
  /** Whether the persisted settings and the sealed key have been read yet. */
  booted: boolean;
  /** A key and a model stood on disk: the window opens on the studio rather than the form. */
  connected: boolean;
  provider: StylizeProvider['id'];
  key: string;
  baseUrl: string;
  models: readonly string[];
  modelsState: ModelsState;
  model: string;
  verifying: boolean;
  /** The last refusal, in the permanent status slot's own vocabulary. */
  status: StylizeStatus | null;
  /** Bumped by a refusal, so the field it names can shake once per refusal rather than per render. */
  shakeNonce: number;
  /** Bumped as a list lands, so the model row can flash once for the arrival. */
  arrivedNonce: number;
  ready: boolean;
  dialect: StylizeDialect;
  cfg: DialectConfig;
}

export interface StylizeConnectionVerbs {
  setProvider: (id: StylizeProvider['id']) => void;
  setKey: (v: string) => void;
  setBaseUrl: (v: string) => void;
  setModel: (v: string) => void;
  /** Checks the connection and, on success, files it: settings written and the key sealed. */
  verify: () => Promise<boolean>;
}

export interface StylizeConnectionController extends StylizeConnectionVerbs {
  get(): StylizeConnectionState;
  subscribe(listener: () => void): () => void;
  /** Reads the stored connection once; the returned function drops a read still in flight. */
  boot(): () => void;
  /** Whether the connection page is the one standing, the only time the probe runs. */
  setProbing(probing: boolean): void;
}

interface Draft {
  booted: boolean; connected: boolean; probing: boolean; provider: StylizeProvider['id'];
  key: string; baseUrl: string; model: string; verifying: boolean; status: StylizeStatus | null;
}

export function createStylizeConnection(listModels: StylizeListModels = defaultListModels): StylizeConnectionController {
  let draft: Draft = {
    booted: false, connected: false, probing: false, provider: DEFAULT_STYLIZE_PROVIDER,
    key: '', baseUrl: '', model: '', verifying: false, status: null,
  };
  const listeners = new Set<() => void>();
  let snap: StylizeConnectionState;
  /** What the standing probe asked, so an edit that changes none of it never re-asks. */
  let asked = '';

  // The request settings are read as the debounce ends, so the model typed meanwhile goes with it.
  const discovery = createModelDiscovery<StylizeDialect>(
    async (dialect, signal, isCurrent): Promise<ProbeAnswer> => {
      try {
        const list = await listModels(dialect, target().cfg, signal);
        return list && list.length > 0 ? { models: list } : 'unlisted';
      } catch (err: unknown) {
        // A refused probe still leaves the typed field standing: an endpoint that would not answer
        // this request may well answer a generation, and the status slot says so.
        if (isCurrent()) draft = { ...draft, status: connectionStatus(err) };
        return 'unlisted';
      }
    },
  );

  const target = () => connectionTarget(draft.provider, draft);
  let cfg: DialectConfig = target().cfg;

  function project(): StylizeConnectionState {
    const { row, baseUrl: resolvedBaseUrl, dialect, cfg: next } = target();
    if (next.key !== cfg.key || next.baseUrl !== cfg.baseUrl || next.model !== cfg.model) cfg = next;
    const found = discovery.get();
    const modelsState: ModelsState = found.state === 'refused' ? 'none' : found.state;
    const ready = !!draft.key && !draft.verifying && (!row.needsBaseUrl || !!resolvedBaseUrl) && !!draft.model
      && (modelsState === 'ready' || modelsState === 'unlisted');
    return {
      booted: draft.booted, connected: draft.connected, provider: draft.provider, key: draft.key, baseUrl: draft.baseUrl,
      models: found.models, modelsState, model: draft.model, verifying: draft.verifying, status: draft.status,
      shakeNonce: found.refusals, arrivedNonce: found.arrivals, ready, dialect, cfg,
    };
  }
  const publish = () => {
    snap = project();
    for (const listener of [...listeners]) listener();
  };
  snap = project();

  /** Re-asks when what a probe would ask (provider, key, address) changed, so a model pick or a
   *  status change never re-runs it. */
  function reprobe(): void {
    const { row, baseUrl: resolvedBaseUrl, dialect } = target();
    const key = JSON.stringify([draft.booted, draft.probing, draft.provider, draft.key, resolvedBaseUrl]);
    if (key === asked) return;
    asked = key;
    if (!draft.booted || !draft.probing) { discovery.supersede(); return; }
    if (!draft.key || (row.needsBaseUrl && !resolvedBaseUrl)) { discovery.reset(); return; }
    discovery.probe(dialect, PROBE_DEBOUNCE_MS);
  }

  /** The answer the model was last settled against, so only a new answer moves it. */
  let settled = '';
  discovery.subscribe(() => {
    const found = discovery.get();
    const answer = `${found.state}|${found.arrivals}`;
    if (answer !== settled) {
      settled = answer;
      const model = settledModel(draft.model, found, target().row.defaultModel);
      if (model !== draft.model) draft = { ...draft, model };
    }
    publish();
  });

  const edit = (next: Partial<Draft>) => {
    draft = { ...draft, ...next };
    reprobe();
    publish();
  };

  return {
    get: () => snap,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    boot() {
      let alive = true;
      void readStylizeConnection().then((stored) => {
        if (!alive) return;
        if (stored.model) discovery.restore(null);
        edit({
          provider: stored.provider, baseUrl: stored.baseUrl, model: stored.model,
          ...(stored.key ? { key: stored.key } : {}),
          connected: !!stored.key && !!stored.model, booted: true,
        });
      });
      return () => { alive = false; };
    },
    setProbing: (probing) => { if (probing !== draft.probing) edit({ probing }); },
    setProvider(id) {
      // The model belonged to the provider being left; carrying it over would arm the form against a
      // name the new endpoint has never heard.
      discovery.reset();
      edit({ provider: id, model: '', status: null });
    },
    setKey: (key) => edit({ key, status: null }),
    setBaseUrl: (baseUrl) => edit({ baseUrl, status: null }),
    setModel: (model) => edit({ model }),
    async verify() {
      if (!snap.ready) return false;
      edit({ verifying: true, status: null });
      const abort = new AbortController();
      const { provider, model, baseUrl, key } = draft;
      try {
        // A key the provider turns away throws here.
        await fileStylizeConnection({ provider, model, baseUrl, key }, snap.dialect, snap.cfg, listModels, abort.signal);
        edit({ connected: true, verifying: false });
        return true;
      } catch (err: unknown) {
        draft = { ...draft, status: connectionStatus(err), verifying: false };
        discovery.noteRefusal();
        return false;
      }
    },
  };
}
