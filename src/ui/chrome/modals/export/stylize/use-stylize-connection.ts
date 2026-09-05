/*
 * use-stylize-connection.ts — the connection the whole window works against: which provider, which
 * key, which address, which model, and how far each of those has got.
 *
 * THE MODEL IS A LIST READ OFF THE KEY, never a field the user is asked to fill from memory. A key
 * or address edit settles for `PROBE_DEBOUNCE_MS` and then asks the dialect what it can run; the
 * row walks none -> loading -> ready (first model pre-picked) and falls back to a typed field only
 * where the endpoint declines to enumerate. A newer edit ABORTS the probe in flight, since a stale
 * answer would report the models of a key that is no longer in the field.
 *
 * The probe is a request, so it runs only while the connection page is the one standing
 * (`probing`): the studio already has everything it needs and a window opened straight onto it
 * costs no call at all.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DIALECTS,
  STYLIZE_PROVIDERS,
  StylizeError,
  loadStylizeKey,
  loadStylizeSettings,
  saveStylizeKey,
  saveStylizeSettings,
  type DialectConfig,
  type StylizeDialect,
  type StylizeProvider,
  type StylizeStatus,
} from '../../../../../io/stylize';
import { sanitizeEndpointUrl } from '../../../../../core/runtime/endpoint-url';

/** How long the hands stay still before the key or the address is taken as settled. */
export const PROBE_DEBOUNCE_MS = 600;

export type ModelsState = 'none' | 'loading' | 'ready' | 'unlisted';

/** The model-list request, injectable so a test drives the form without a network. `null` is an
 *  endpoint that will not enumerate. */
export type StylizeListModels = (
  dialect: StylizeDialect, cfg: DialectConfig, signal: AbortSignal,
) => Promise<string[] | null>;

export const defaultListModels: StylizeListModels = (dialect, cfg, signal) => dialect.listModels(cfg, signal);

export interface StylizeConnection {
  /** Whether the persisted settings and the sealed key have been read yet. */
  booted: boolean;
  /** A key AND a model stood on disk: the window opens on the studio rather than the form. */
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
  setProvider: (id: StylizeProvider['id']) => void;
  setKey: (v: string) => void;
  setBaseUrl: (v: string) => void;
  setModel: (v: string) => void;
  /** Checks the connection and, on success, files it: settings written and the key sealed. */
  verify: () => Promise<boolean>;
}

function statusOf(err: unknown): StylizeStatus {
  return err instanceof StylizeError ? err.status : 'network';
}

function providerRow(id: StylizeProvider['id']): StylizeProvider {
  return STYLIZE_PROVIDERS.find((p) => p.id === id) ?? STYLIZE_PROVIDERS[0]!;
}

export function useStylizeConnection(opts: {
  listModels?: StylizeListModels;
  /** Whether the connection page is the one standing. */
  probing: boolean;
}): StylizeConnection {
  const listModels = opts.listModels ?? defaultListModels;
  const { probing } = opts;

  const [booted, setBooted] = useState(false);
  const [connected, setConnected] = useState(false);
  const [provider, setProviderState] = useState<StylizeProvider['id']>('gemini');
  const [key, setKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [models, setModels] = useState<readonly string[]>([]);
  const [modelsState, setModelsState] = useState<ModelsState>('none');
  const [model, setModel] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [status, setStatus] = useState<StylizeStatus | null>(null);
  const [shakeNonce, setShakeNonce] = useState(0);
  const [arrivedNonce, setArrivedNonce] = useState(0);

  const row = providerRow(provider);
  const resolvedBaseUrl = row.needsBaseUrl ? sanitizeEndpointUrl(baseUrl) : row.baseUrl;
  const dialect = DIALECTS[row.dialect];
  const cfg = useMemo<DialectConfig>(
    () => ({ key, baseUrl: resolvedBaseUrl, model }),
    [key, resolvedBaseUrl, model],
  );
  // Read by `verify`, which must not re-arm the probe effect every time the draft changes.
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;

  useEffect(() => {
    let alive = true;
    const stored = loadStylizeSettings();
    void loadStylizeKey().then((sealed) => {
      if (!alive) return;
      setProviderState(stored.provider);
      setBaseUrl(stored.customBaseUrl);
      setModel(stored.model);
      if (sealed) setKey(sealed);
      if (stored.model) setModelsState('unlisted');
      setConnected(!!sealed && !!stored.model);
      setBooted(true);
    });
    return () => { alive = false; };
  }, []);

  // The probe, and the only place the model row's state is decided. Keyed on what a probe would be
  // ASKED (provider, key, address), so a model pick or a status change never re-runs it.
  useEffect(() => {
    if (!booted || !probing) return undefined;
    if (!key || (row.needsBaseUrl && !resolvedBaseUrl)) {
      setModelsState('none');
      setModels([]);
      return undefined;
    }
    let live = true;
    const abort = new AbortController();
    setModelsState('loading');
    setModels([]);
    const timer = setTimeout(() => {
      listModels(dialect, cfgRef.current, abort.signal).then((list) => {
        if (!live) return;
        if (list && list.length > 0) {
          setModels(list);
          setModelsState('ready');
          setModel((current) => (list.includes(current) ? current : list[0]!));
          setArrivedNonce((n) => n + 1);
        } else {
          setModelsState('unlisted');
          // The endpoint would not enumerate; prefill the provider's own default rather than leave
          // the typed field blank, but never over text the user already typed in.
          setModel((current) => current || row.defaultModel || current);
        }
      }).catch((err: unknown) => {
        if (!live) return;
        // A refused probe still leaves the typed field standing: an endpoint that would not answer
        // this request may well answer a generation, and the status slot has already said so.
        setModelsState('unlisted');
        setModel((current) => current || row.defaultModel || current);
        setStatus(statusOf(err));
      });
    }, PROBE_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
      abort.abort();
    };
  }, [booted, probing, provider, key, resolvedBaseUrl, row.needsBaseUrl, dialect, listModels]);

  const setProvider = useCallback((id: StylizeProvider['id']) => {
    setProviderState(id);
    // The model belonged to the provider being left; carrying it over would arm the form against a
    // name the new endpoint has never heard.
    setModel('');
    setModels([]);
    setModelsState('none');
    setStatus(null);
  }, []);

  const onKey = useCallback((v: string) => { setKey(v); setStatus(null); }, []);
  const onBaseUrl = useCallback((v: string) => { setBaseUrl(v); setStatus(null); }, []);

  const ready = !!key
    && !verifying
    && (!row.needsBaseUrl || !!resolvedBaseUrl)
    && !!model
    && (modelsState === 'ready' || modelsState === 'unlisted');

  const verify = useCallback(async (): Promise<boolean> => {
    if (!ready) return false;
    setVerifying(true);
    setStatus(null);
    const abort = new AbortController();
    try {
      // Where the endpoint enumerates, the same request that read the list is what tests the key.
      // Where it does not, the typed model stands and the first generation is the test.
      if (modelsState === 'ready') await listModels(dialect, cfgRef.current, abort.signal);
      const stored = loadStylizeSettings();
      saveStylizeSettings({ ...stored, provider, model, customBaseUrl: baseUrl });
      await saveStylizeKey(key);
      setConnected(true);
      return true;
    } catch (err: unknown) {
      setStatus(statusOf(err));
      setShakeNonce((n) => n + 1);
      return false;
    } finally {
      setVerifying(false);
    }
  }, [ready, modelsState, listModels, dialect, provider, model, baseUrl, key]);

  return {
    booted, connected, provider, key, baseUrl, models, modelsState, model, verifying, status,
    shakeNonce, arrivedNonce, ready, dialect, cfg,
    setProvider, setKey: onKey, setBaseUrl: onBaseUrl, setModel, verify,
  };
}
