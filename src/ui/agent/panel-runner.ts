/**
 * Supplies the panel runner with its connection and live editor dependencies.
 * Provider, key, endpoint, model, region, locale, and map dependencies are sampled at job launch;
 * oversight remains live for each gate. The config object is updated in place so the runner retains
 * ownership of the active job and its abort controller.
 */
import { callApproved } from '../../agent/core/gates';
import type { RunnerConfig } from '../../agent/exec/runner';
import { takeMapRegionSnapshot, takeMapSnapshot } from '../../agent/snapshot';
import type { AgentToolDeps } from '../../agent/tools/tools';
import type { RuleDispatcher } from '../../core/model/rule-dispatcher';
import { host } from '../../kit/host';
import { singleSelection } from '../../state/selection';
import { useEditorStore } from '../../state/store';
import { useAgentSession } from '../../agent/session/store';
import { useAgentPanelSettings } from './settings';

/** The armed connection as `settings.ts:runnerSettings` reports it: `RunnerConfig`'s data half, with
 *  the two situational fields ABSENT rather than undefined when they do not apply. */
type Armed = Pick<RunnerConfig, 'providerId' | 'apiKey' | 'model' | 'oversight' | 'customBaseUrl' | 'region'>;

/** The live pieces the panel supplies alongside the armed connection. */
interface Live {
  registry: RuleDispatcher;
  makeToolDeps: () => AgentToolDeps;
  /** The editor's display language, the system prompt's `{uiLanguage}` fallback: which language to
   *  open in when the user has not typed anything readable yet. */
  uiLocale: string;
}

/** Overwrites optional fields as well, so cleared endpoint and region values cannot survive. */
export function refreshRunnerConfig(cfg: RunnerConfig, armed: Armed, live: Live): void {
  cfg.providerId = armed.providerId;
  cfg.apiKey = armed.apiKey;
  cfg.model = armed.model;
  cfg.oversight = armed.oversight;
  cfg.customBaseUrl = armed.customBaseUrl;
  cfg.region = armed.region;
  cfg.registry = live.registry;
  cfg.makeToolDeps = live.makeToolDeps;
  cfg.uiLocale = live.uiLocale;
}

/** The config object the runner is built with, assembled through the same fold that keeps it
 *  current, so a field can never be seeded one way and refreshed another. */
export function newRunnerConfig(armed: Armed, live: Live): RunnerConfig {
  const cfg = { ...armed, registry: live.registry, makeToolDeps: live.makeToolDeps };
  refreshRunnerConfig(cfg, armed, live);
  return cfg;
}

/**
 * The live map, executor, region and UI hooks as the tool layer wants them. Called PER JOB (the
 * runner asks when it launches one), so a job can never edit a `GridState` that was current when the
 * panel opened — and, for the same reason, never one installed after it started.
 *
 * EVERY OPTIONAL MEMBER HERE IS A TOOL. `AgentToolDeps` declares all but the first three optional
 * because a headless test wires none of them, which means dropping one from this recipe compiles
 * green and silently costs the agent a capability at run time: no `snapshot` and `view_map` sends no
 * picture, no `requestExport` and `export_map` reports itself unwired, no `onFlash` and a write lands
 * with no acknowledgement on the map, no `getProvenanceSource` and every edit is filed as an
 * anonymous AI write. `__tests__/ui/agent/panel-runner.test.ts` pins the set by name.
 *
 * `setPlan`/`getPlan` are deliberately NOT wired: the v3 loop intercepts `update_plan` itself and
 * keeps the plan as log events, so a mirror here would be a second copy nothing reads.
 */
export function makePanelToolDeps(opts: { vision: boolean }): AgentToolDeps {
  const { gridState, commandExecutor, region } = useEditorStore.getState();
  // THE AUTHOR OF EVERY EDIT THIS JOB MAKES, read once here rather than per tool call. This function
  // runs at launch, so the pair is the connection the requests actually go out on; reading the store
  // inside `getProvenanceSource` instead filed a mid-run model change against edits the previous
  // model had already authored, which is a false attribution in the export disclosure.
  const { provider, model } = useAgentPanelSettings.getState();
  const authorModel = model[provider] ?? '';
  if (!gridState || !commandExecutor) {
    // Unreachable in the app (the shell only ever stands over a live map), and worth failing loudly
    // rather than handing the loop a half-built dependency set to discover mid-job.
    throw new Error('the assistant has no map to work on');
  }
  const deps: AgentToolDeps = {
    getState: () => gridState,
    getExecutor: () => commandExecutor,
    // The painted region, read from the store: a job's scope is whatever the user has painted when
    // it starts, not what a render happened to hand the panel.
    getRegion: () => region,
    // The tool surface describes ONE clicked block ("this/it"); it has no vocabulary for a group, so
    // a plural selection reads as none rather than as an arbitrary member.
    getSelectedBlock: () => singleSelection(useEditorStore.getState().selection),
    onFlash: (cells) => host.feedback.flash(cells),
    // THE APPROVAL IS A FACT ABOUT THIS CALL, read off the log's own gate pair rather than assumed.
    // It was hardcoded `false`, which made `ProvSource.AiAccepted` unreachable and the export
    // disclosure permanently report zero AI-accepted edits — on a panel whose whole oversight
    // machinery exists to obtain that approval. `allow-always` still reads as an AI write: it is a
    // standing session permission, not a press about this edit (`core/gates.ts:callApproved`).
    getProvenanceSource: (toolCallId) => {
      return {
        provider,
        model: authorModel,
        ...(toolCallId !== undefined ? { toolCallId } : {}),
        userApproved: toolCallId !== undefined
          && callApproved(useAgentSession.getState().log, toolCallId),
      };
    },
    requestExport: (kind) => {
      useEditorStore.getState().setModal(kind === 'json' ? 'exportJson' : 'export', true);
    },
  };
  // Wired ONLY where the armed model can read an image; without them `view_map` degrades to the
  // token grid rather than sending a picture to a model that will refuse it. The pair travels
  // together: the region member is the look-closer half of the same capability.
  if (opts.vision) {
    deps.snapshot = takeMapSnapshot;
    deps.snapshotRegion = takeMapRegionSnapshot;
  }
  return deps;
}
