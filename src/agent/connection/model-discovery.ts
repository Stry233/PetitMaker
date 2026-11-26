/*
 * Asking a connection what it runs: the model list through the provider's own adapter under a
 * deadline, the key check behind setup (a refused key is forgotten), the roster a connection's
 * picker reads, and filing a custom endpoint. Each answer that arrives after its asker moved on is
 * dropped (`isCurrent`), so a late reply never touches the connection.
 */
import { classify } from '../core/errors';
import { buildAdapter } from '../providers/connect';
import { QUIRKS, type ProviderId, type ProviderRegion } from '../providers/defaults';
import { toRawFailure } from '../providers/http-failure';
import { withDeadline } from '../../platform/async/abort';
import { assistantModels, catalogProvider, ensureModelCatalog, suggestedModels } from '../providers/model-catalog';
import { forgetRoster, forgetRosters, rememberedRoster, rememberRoster, rosterKey } from './model-roster';
import { runnerSettings, useAgentConnection } from './store';

/** Maximum duration of a model-list request to the selected endpoint. */
const MODELS_DEADLINE_MS = 8000;
/** Longest a model listing waits for the live capability download; the bundled extract answers past it. */
const CATALOG_WAIT_MS = 2500;
const catalogSoon = (): Promise<void> => Promise.race([ensureModelCatalog(), new Promise<void>((resolve) => setTimeout(resolve, CATALOG_WAIT_MS))]);

/** Runs a model listing under the model-list deadline, linked to the asker's `signal`. It settles
 *  once either stops it, even where the request ignores its signal; the deadline's failure reads as
 *  the endpoint's silence, which is unreachable. */
async function withModelsDeadline<T>(run: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
  const deadline = withDeadline(MODELS_DEADLINE_MS, signal);
  const stopped = new Promise<never>((_resolve, reject) => {
    const stop = (): void => reject(signal?.aborted
      ? signal.reason
      : new Error(`The endpoint answered nothing in ${Math.round(MODELS_DEADLINE_MS / 1000)}s; the request timed out.`));
    if (deadline.signal.aborted) stop();
    else deadline.signal.addEventListener('abort', stop, { once: true });
  });
  // Promise.race attaches handlers to both, so neither late rejection goes unhandled.
  try {
    return await Promise.race([run(deadline.signal), stopped]);
  } finally {
    deadline.dispose();
  }
}

export interface ListModelsRequest { provider: ProviderId; apiKey: string; customBaseUrl?: string; region?: ProviderRegion }
/** Lists the models `cfg` can run; `signal` stops the request once its asker has moved on. */
export type ListModels = (cfg: ListModelsRequest, signal?: AbortSignal) => Promise<string[]>;

/** Lists models through the selected provider's own adapter, whose SDK loads on first use. */
export function defaultListModels(cfg: ListModelsRequest, signal?: AbortSignal): Promise<string[]> {
  // A platform with no model list a browser can read is answered from the capability catalog.
  if (QUIRKS[catalogProvider(cfg.provider, cfg.customBaseUrl)].listsModels === false) return catalogSoon().then(
    () => suggestedModels(cfg.provider, cfg.customBaseUrl),
  );
  return withModelsDeadline(async (bounded) => {
    const metadata = catalogSoon();
    const ids = await buildAdapter({
      providerId: cfg.provider, apiKey: cfg.apiKey,
      ...(cfg.region === undefined ? {} : { region: cfg.region }),
      ...(cfg.customBaseUrl ? { customBaseUrl: cfg.customBaseUrl } : {}),
    }).listModels(bounded);
    await metadata;
    return assistantModels(cfg.provider, ids, cfg.customBaseUrl);
  }, signal);
}

/** How a key check ended: no request made, the models listed (and remembered), the key refused
 *  (and forgotten), the listing failed otherwise (the endpoint stays usable, since a model can be
 *  entered by hand), or the asker moved on. */
type KeyCheck = 'skipped' | 'listed' | 'refused' | 'unlisted' | 'stale';

/**
 * Checks `apiKey` for `id` by listing its models, without choosing one. A custom provider's key is
 * never sent before its endpoint is explicit. A refused key is forgotten; an explicit provider
 * choice outlives it.
 */
export async function checkKey(id: ProviderId, apiKey: string, listModels: ListModels, isCurrent: () => boolean): Promise<KeyCheck> {
  const base = useAgentConnection.getState().customBaseUrl;
  if ((apiKey === '' && id !== 'custom') || (id === 'custom' && base === '')) return 'skipped';
  const region = runnerSettings(useAgentConnection.getState()).region;
  try {
    const ids = await listModels({ provider: id, apiKey, ...(region === undefined ? {} : { region }), ...(base ? { customBaseUrl: base } : {}) });
    if (!isCurrent()) return 'stale';
    rememberRoster(rosterKey(id, base), ids);
    return 'listed';
  } catch (err: unknown) {
    if (!isCurrent()) return 'stale';
    if (classify(toRawFailure(err, false)).cls !== 'auth') return 'unlisted';
    const state = useAgentConnection.getState();
    const explicit = state.providerPinned && state.provider === id;
    state.forgetKey(id);
    if (explicit) state.pinProvider(id);
    return 'refused';
  }
}

/** Asks for a connection's model list, remembering the answer while the asker is current. */
export type RosterAsk = (signal: AbortSignal, isCurrent: () => boolean) => Promise<readonly string[]>;

/**
 * The connection's model list: the remembered answer at once, else the request to make for it.
 * `fresh` retires the remembered answer first.
 */
export function loadRoster(
  cfg: ListModelsRequest & { customBaseUrl: string }, listModels: ListModels, fresh: boolean,
): { held: readonly string[] } | { ask: RosterAsk } {
  const key = rosterKey(cfg.provider, cfg.customBaseUrl);
  if (fresh) forgetRoster(key);
  const held = rememberedRoster(key);
  if (held) return { held };
  const { customBaseUrl, region, ...rest } = cfg;
  const request: ListModelsRequest = { ...rest, ...(region === undefined ? {} : { region }), ...(customBaseUrl ? { customBaseUrl } : {}) };
  return {
    ask: (signal, isCurrent) => listModels(request, signal).then((ids) => {
      if (isCurrent()) rememberRoster(key, ids);
      return ids;
    }),
  };
}

/** What a failed model listing says of its endpoint: `unreachable` when nothing answered or no
 *  request could be built, `no-list` when a server answered without a model catalog, which proves
 *  nothing about generation. */
export function endpointCheckVerdict(err: unknown): 'unreachable' | 'no-list' {
  const cls = classify(toRawFailure(err, false)).cls;
  return cls === 'network' || cls === 'cors' || cls === 'config' ? 'unreachable' : 'no-list';
}

/** Forgets `id`'s key and every remembered roster: what an endpoint can run is an answer about the
 *  credential that asked, and the next key deserves its own. */
export function forgetKeyAndRosters(id: ProviderId): void {
  forgetRosters();
  useAgentConnection.getState().forgetKey(id);
}

/** Files a typed custom endpoint, retiring its remembered roster. The stored address, empty when
 *  the sanitizer refused it, and whether it is the address already filed. */
export function fileEndpoint(raw: string): { stored: string; same: boolean } {
  const was = useAgentConnection.getState().customBaseUrl;
  const stored = useAgentConnection.getState().setCustomBaseUrl(raw);
  if (stored !== '') forgetRoster(rosterKey('custom', stored));
  return { stored, same: stored === was };
}
