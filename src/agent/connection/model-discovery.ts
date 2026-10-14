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
import { assistantModels, catalogProvider, ensureModelCatalog, suggestedModels } from '../providers/model-catalog';
import { forgetRoster, forgetRosters, rememberedRoster, rememberRoster, rosterKey } from './model-roster';
import { runnerSettings, useAgentConnection } from './store';

/** Maximum duration of a model-list request to the selected endpoint. */
const MODELS_DEADLINE_MS = 8000;
/** Longest a model listing waits for the live capability download; the bundled extract answers past it. */
const CATALOG_WAIT_MS = 2500;
const catalogSoon = (): Promise<void> => Promise.race([ensureModelCatalog(), new Promise<void>((resolve) => setTimeout(resolve, CATALOG_WAIT_MS))]);

/** Bounds model discovery with the model-list deadline and aborts a silent endpoint. */
function withModelsDeadline<T>(
  run: (signal: AbortSignal) => Promise<T>, deadlineMs: number = MODELS_DEADLINE_MS,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`The endpoint answered nothing in ${Math.round(deadlineMs / 1000)}s; the request timed out.`));
    }, deadlineMs);
  });
  // Promise.race attaches handlers to the request, so a late rejection cannot become unhandled.
  return Promise.race([run(controller.signal), deadline]).finally(() => { clearTimeout(timer); });
}

export interface ListModelsRequest { provider: ProviderId; apiKey: string; customBaseUrl?: string; region?: ProviderRegion }
export type ListModels = (cfg: ListModelsRequest) => Promise<string[]>;

/** Lists models through the selected provider's own adapter, whose SDK loads on first use. */
export function defaultListModels(cfg: ListModelsRequest): Promise<string[]> {
  // A platform with no model list a browser can read is answered from the capability catalog.
  if (QUIRKS[catalogProvider(cfg.provider, cfg.customBaseUrl)].listsModels === false) return catalogSoon().then(
    () => suggestedModels(cfg.provider, cfg.customBaseUrl),
  );
  return withModelsDeadline(async (signal) => {
    const metadata = catalogSoon();
    const ids = await buildAdapter({
      providerId: cfg.provider, apiKey: cfg.apiKey,
      ...(cfg.region === undefined ? {} : { region: cfg.region }),
      ...(cfg.customBaseUrl ? { customBaseUrl: cfg.customBaseUrl } : {}),
    }).listModels(signal);
    await metadata;
    return assistantModels(cfg.provider, ids, cfg.customBaseUrl);
  });
}

/** How a key check ended: no request made, the models listed (and remembered), the key refused
 *  (and forgotten), the listing failed otherwise (the endpoint stays usable, since a model can be
 *  entered by hand), or the asker moved on. */
export type KeyCheck = 'skipped' | 'listed' | 'refused' | 'unlisted' | 'stale';

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

/**
 * The connection's model list: the remembered answer at once, else a request whose answer is
 * remembered while its asker is current. `fresh` retires the remembered answer first.
 */
export function loadRoster(
  cfg: ListModelsRequest & { customBaseUrl: string }, listModels: ListModels, fresh: boolean, isCurrent: () => boolean,
): { held: readonly string[] } | { pending: Promise<readonly string[]> } {
  const key = rosterKey(cfg.provider, cfg.customBaseUrl);
  if (fresh) forgetRoster(key);
  const held = rememberedRoster(key);
  if (held) return { held };
  const { customBaseUrl, region, ...rest } = cfg;
  return {
    pending: listModels({ ...rest, ...(region === undefined ? {} : { region }), ...(customBaseUrl ? { customBaseUrl } : {}) }).then((ids) => {
      if (isCurrent()) rememberRoster(key, ids);
      return ids;
    }),
  };
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
