/*
 * The panel's one runner and what keeps it current. The config object is built once and refreshed in
 * place, so a job or gate in flight reads the current connection without the runner being rebuilt;
 * provider, key, endpoint, model, region, locale and map dependencies are sampled at job launch, and
 * oversight stays live for each gate. The host also warms what the connection will need: the model
 * catalog, the provider's SDK adapter and the vision probe.
 */
import type { RuleDispatcher } from '../../core/model/rule-dispatcher';
import { setLiveJobStop, type ArmedConnection } from '../connection/store';
import { preloadAdapter } from '../providers/connect';
import { catalogVersion, ensureModelCatalog, subscribeCatalog } from '../providers/model-catalog';
import {
  ensureVisionVerdict, readsImages, subscribeVisionVerdicts, visionKey, visionVerdictsVersion,
} from '../providers/vision-verdict';
import { setToolFacts } from '../session/store';
import type { AgentToolDeps } from '../tools/deps';
import { TOOL_FACTS } from '../tools';
import { createRunner, type RunnerConfig } from './runner';
import { agentSessionPort } from './session-port';
import { makeToolDeps } from './tool-deps';

// The session projection and the hosted character read the tool facts once the panel's chunk loads.
setToolFacts(TOOL_FACTS);

export type PanelRunner = ReturnType<typeof createRunner>;

/** The live pieces the panel supplies alongside the armed connection. */
interface Live {
  registry: RuleDispatcher;
  makeToolDeps: () => AgentToolDeps;
  /** The editor's display language, the system prompt's `{uiLanguage}` fallback: which language to
   *  open in when the user has not typed anything readable yet. */
  uiLocale: string;
}

/** Overwrites optional fields as well, so cleared endpoint and region values cannot survive. */
function refreshRunnerConfig(cfg: RunnerConfig, armed: ArmedConnection, live: Live): void {
  cfg.providerId = armed.providerId;
  cfg.apiKey = armed.apiKey;
  cfg.model = armed.model;
  cfg.effort = armed.effort;
  cfg.oversight = armed.oversight;
  cfg.customBaseUrl = armed.customBaseUrl;
  cfg.region = armed.region;
  cfg.registry = live.registry;
  cfg.makeToolDeps = live.makeToolDeps;
  cfg.uiLocale = live.uiLocale;
}

/** The config object the runner is built with, assembled through the same fold that keeps it
 *  current, so a field can never be seeded one way and refreshed another. The runner reads the
 *  page's session through its port. */
function newRunnerConfig(armed: ArmedConnection, live: Live): RunnerConfig {
  const cfg = { ...armed, registry: live.registry, makeToolDeps: live.makeToolDeps, session: agentSessionPort };
  refreshRunnerConfig(cfg, armed, live);
  return cfg;
}

/** What the host is told each time the panel renders. `model` is the model the panel shows, which
 *  the vision probe asks about. */
export interface RunnerHostInputs {
  armed: ArmedConnection;
  model: string;
  connected: boolean;
  /** The live editor's command executor, absent until the editor mounts. */
  executor: { getRegistry(): RuleDispatcher } | null | undefined;
  uiLocale: string;
}

export interface RunnerHost {
  /** The runner, built on the first call that has a rule registry; null before. */
  runner(inputs: RunnerHostInputs): PanelRunner | null;
  /** Refreshes the config in place and starts the warm-ups a changed connection owes. */
  sync(inputs: RunnerHostInputs): void;
  /** Lets key revocation stop live work before the credential clears; returns the detach. */
  attach(): () => void;
  /** Fires when a capability answer (catalog or vision probe) may change what the runner reads. */
  subscribe(listener: () => void): () => void;
  /** Changes whenever `subscribe` fires. */
  version(): string;
}

/** `build` makes the runner from the config the host keeps current. */
export function createRunnerHost(build: (cfg: RunnerConfig) => PanelRunner = createRunner): RunnerHost {
  let cfg: RunnerConfig | null = null;
  let built: PanelRunner | null = null;
  /** The tool-deps factory, rebuilt only when vision support changes. */
  let deps: { vision: boolean; make: () => AgentToolDeps } | null = null;
  /** The last connection each warm-up ran for, so a re-render with nothing new starts nothing. */
  const warmed = { catalog: '', adapter: '', vision: '' };

  function live(inputs: RunnerHostInputs, registry: RuleDispatcher): Live {
    const { armed, model } = inputs;
    const vision = readsImages(armed.providerId, armed.customBaseUrl, model);
    if (deps?.vision !== vision) deps = { vision, make: () => makeToolDeps({ vision, session: agentSessionPort }) };
    return { registry, makeToolDeps: deps.make, uiLocale: inputs.uiLocale };
  }

  function runner(inputs: RunnerHostInputs): PanelRunner | null {
    const registry = inputs.executor?.getRegistry();
    if (cfg === null && registry) cfg = newRunnerConfig(inputs.armed, live(inputs, registry));
    // A single runner preserves the current abort controller and in-flight promise.
    if (!built && cfg) built = build(cfg);
    return built;
  }

  function warm({ armed, model, connected }: RunnerHostInputs): void {
    const once = (slot: keyof typeof warmed, key: string, run: () => void) => {
      const tagged = `${connected}|${key}`;
      if (warmed[slot] === tagged) return;
      warmed[slot] = tagged;
      if (connected) run();
    };
    once('catalog', `${armed.providerId}|${model}`, () => { void ensureModelCatalog(); });
    // The SDK adapter loads on first use; fetching it while the panel opens keeps it off the first order.
    once('adapter', armed.providerId, () => preloadAdapter(armed.providerId));
    // A provider probe may revoke optimistic vision support inferred from the model id. The probe
    // key carries provider, address and model without holding the credential.
    once('vision', visionKey(armed.providerId, armed.customBaseUrl, model), () => ensureVisionVerdict({ ...armed, model }));
  }

  return {
    runner,
    sync(inputs) {
      warm(inputs);
      const registry = inputs.executor?.getRegistry();
      if (cfg && registry) refreshRunnerConfig(cfg, inputs.armed, live(inputs, registry));
    },
    attach() {
      const stopping = built;
      setLiveJobStop(() => stopping?.stop());
      return () => setLiveJobStop(undefined);
    },
    subscribe(listener) {
      const offCatalog = subscribeCatalog(listener);
      const offVision = subscribeVisionVerdicts(listener);
      return () => { offCatalog(); offVision(); };
    },
    version: () => `${catalogVersion()}|${visionVerdictsVersion()}`,
  };
}
