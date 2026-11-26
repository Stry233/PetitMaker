/*
 * The connection card's reading of its endpoint: the typed custom address with its idle check, the
 * model list the armed connection answers with, and what the model picker may offer. An external
 * store, as the key reading is: the card draws its snapshot and calls its verbs, and an answer that
 * arrives after the connection moved on is dropped.
 */
import { createSignal } from '../../core/base/signal';
import { createModelDiscovery, type DiscoveryState, type ProbeAnswer } from '../../platform/async/model-discovery';
import { endpointUrlLooksUsable } from '../../platform/remote/endpoint-url';
import { QUIRKS, type ProviderId, type ProviderRegion } from '../providers/defaults';
import { ensureModelCatalog } from '../providers/model-catalog';
import { IDLE_MS } from './key-reading';
import { defaultListModels, endpointCheckVerdict, fileEndpoint, loadRoster, type ListModels, type RosterAsk } from './model-discovery';
import { connectionGaps, isConnected, runnerSettings, useAgentConnection } from './store';

interface EndpointReadingOptions {
  listModels: ListModels;
  /** A typed address was filed; the card says what that means for a job already running. */
  onFiled?: () => void;
}

interface EndpointReadingState {
  /** The address field's text: the stored address until the user types. */
  draft: string;
  /** The typed address was refused as unusable. */
  bad: boolean;
  /** The model listing. `failed` means no server answered, which proves nothing about generation. */
  status: 'idle' | 'loading' | 'ready' | 'failed';
  /** The models the connection lists; none while the custom provider has no address. */
  models: readonly string[];
  /** The verdict under the address field: the address is unusable, or nothing answered at it. */
  endpointNote: 'invalid' | 'unavailable' | null;
  /** The custom provider has no address yet, so no model can be chosen. */
  needsEndpoint: boolean;
  /** A model may be named by hand: nothing was listed, or the provider's list is never the whole answer. */
  allowManual: boolean;
}

interface EndpointReading {
  get(): EndpointReadingState;
  subscribe(listener: () => void): () => void;
  /** Starts hearing the connection and asks it what it runs; returns the stop, after which a late answer is dropped. */
  start(): () => void;
  /** The newest listing source and callback. */
  setOptions(options: EndpointReadingOptions): void;
  /** A typed address; once typing rests it is filed and checked, or refused in place. */
  edit(next: string): void;
  /** Files and checks the typed address now, or refuses it. */
  confirm(): void;
  /** Retires the remembered model list and asks again. */
  refresh(): void;
}

/** The listing's status by where its discovery stands: an endpoint that answered without a list is
 *  ready with none, and only silence fails it. */
const STATUS: Record<DiscoveryState, EndpointReadingState['status']> = {
  none: 'idle', loading: 'loading', ready: 'ready', unlisted: 'ready', refused: 'ready', unreachable: 'failed',
};

/** The connection a model list answers for. */
interface Asked {
  provider: ProviderId;
  customBaseUrl: string;
  apiKey: string;
  region: ProviderRegion | undefined;
  connected: boolean;
}

function connectionAsked(): Asked {
  const state = useAgentConnection.getState();
  const armed = runnerSettings(state);
  return { provider: state.provider, customBaseUrl: state.customBaseUrl, apiKey: armed.apiKey, region: armed.region, connected: isConnected(state) };
}

function sameAsked(a: Asked, b: Asked): boolean {
  return a.provider === b.provider && a.customBaseUrl === b.customBaseUrl && a.apiKey === b.apiKey && a.region === b.region && a.connected === b.connected;
}

export function createEndpointReading(initial: EndpointReadingOptions): EndpointReading {
  let options = initial;
  /** The typed address, or null while the field follows the stored one. */
  let draft: string | null = null;
  let bad = false;
  /** The connection the listing answers for; null until asked and once stopped. */
  let asked: Asked | null = null;
  // A newer listing outdates and aborts the one in flight, so a late answer never lands.
  const discovery = createModelDiscovery<RosterAsk>(async (ask, signal, isCurrent): Promise<ProbeAnswer> => {
    try {
      return { models: await ask(signal, isCurrent) };
    } catch (err: unknown) {
      return endpointCheckVerdict(err) === 'no-list' ? 'unlisted' : 'unreachable';
    }
  });
  /** The draft the idle check is armed for, kept after it fires so the same text is not checked twice. */
  let idle: { key: string; timer: ReturnType<typeof setTimeout> | undefined } = { key: '', timer: undefined };
  let started = false;
  /** Depth of the action running now; connection news waits for its end. */
  let busy = 0;
  const published = createSignal();

  const text = (): string => draft ?? useAgentConnection.getState().customBaseUrl;

  function derive(): EndpointReadingState {
    const state = useAgentConnection.getState();
    const needsEndpoint = connectionGaps(state).includes('endpoint');
    const listing = discovery.get();
    const status = STATUS[listing.state];
    return {
      draft: text(), bad, status,
      models: needsEndpoint ? [] : listing.models,
      endpointNote: bad ? 'invalid' : status === 'failed' ? 'unavailable' : null,
      needsEndpoint,
      allowManual: !needsEndpoint
        && (listing.models.length === 0 || state.provider === 'custom' || QUIRKS[state.provider].listsModels === false),
    };
  }
  let snap = derive();

  /** Reads the list from the roster cache or asks the connection for it; `fresh` retires the cached answer. */
  function load(fresh: boolean): void {
    const cfg = connectionAsked();
    asked = cfg;
    if (!cfg.connected) { discovery.reset(); return; }
    const { region, connected: _connected, ...rest } = cfg;
    const answer = loadRoster({ ...rest, ...(region === undefined ? {} : { region }) }, options.listModels, fresh);
    if ('held' in answer) discovery.restore(answer.held);
    else discovery.probe(answer.ask);
  }

  /** Files the typed address and asks it what it runs. The sanitizer is the one authority on
   *  whether an address is usable, so an empty answer is the refusal. */
  function check(): void {
    const { stored, same } = fileEndpoint(text());
    if (stored === '') { bad = true; return; }
    draft = null;
    bad = false;
    // A changed address is asked as the connection changes; the same one is asked again here.
    if (same) load(true);
    options.onFiled?.();
  }

  const checkOrRefuse = (): void => { if (endpointUrlLooksUsable(text())) check(); else bad = true; };

  /** A changed custom address is checked once typing rests; an unchanged or empty draft arms nothing. */
  function armIdle(): void {
    const state = useAgentConnection.getState();
    const typed = text().trim();
    const key = started && state.provider === 'custom' && typed !== '' && typed !== state.customBaseUrl ? `${typed}|${state.customBaseUrl}` : '';
    if (key === idle.key) return;
    clearTimeout(idle.timer);
    idle = { key, timer: key ? setTimeout(() => { idle = { key, timer: undefined }; act(checkOrRefuse); }, IDLE_MS) : undefined };
  }

  /** Asks again where the connection changed, then publishes. */
  function settle(): void {
    if (started && (asked === null || !sameAsked(asked, connectionAsked()))) {
      busy += 1;
      try { load(false); } finally { busy -= 1; }
    }
    snap = derive();
    armIdle();
    published.emit();
  }

  /** Runs `change`, then settles once the outermost change ends. */
  function act(change: () => void): void {
    busy += 1;
    try { change(); } finally { busy -= 1; }
    if (busy === 0) settle();
  }

  discovery.subscribe(() => { if (busy === 0) settle(); });

  return {
    get: () => snap,
    subscribe: (listener) => published.subscribe(listener),
    start() {
      started = true;
      const off = useAgentConnection.subscribe(() => { if (busy === 0) settle(); });
      if (options.listModels === defaultListModels) void ensureModelCatalog();
      settle();
      return () => {
        started = false;
        off();
        discovery.supersede();
        asked = null;
        clearTimeout(idle.timer);
        idle = { key: '', timer: undefined };
      };
    },
    setOptions(next) { options = next; },
    edit: (next) => act(() => { draft = next; bad = false; }),
    confirm: () => act(checkOrRefuse),
    refresh: () => act(() => {
      if (options.listModels === defaultListModels) void ensureModelCatalog(true);
      load(true);
    }),
  };
}
