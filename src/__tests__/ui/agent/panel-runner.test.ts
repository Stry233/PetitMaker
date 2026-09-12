/**
 * What the panel hands the runner, and the two ways it can be wrong without anything saying so.
 *
 * THE CONFIG IS MUTATED IN PLACE, because the runner holds the running job's abort handle and may not
 * be rebuilt. That makes FORGETTING a job of its own: `runnerSettings` omits `customBaseUrl` and
 * `region` when they do not apply, so a merge that copies only present keys leaves the last answer
 * standing — a Zhipu key resolved against the CN host keeps `region: 1` after a globally-keyed
 * provider is armed, and the next job goes to a host that never issued the key.
 *
 * THE TOOL DEPENDENCIES are all optional but the first three (a headless test wires none of them), so
 * dropping one from the panel's recipe type-checks and costs the agent a capability at run time. The
 * expected set is pinned by name here: a future drop fails this test rather than a user's job.
 */
import { describe, it, expect, afterEach } from 'vitest';

import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import type { EditorEvents, GridState } from '../../../core/model/types';
import { createDefaultRegistry } from '../../../rules';
import { roadLookup } from '../../../state/object-index';
import { useEditorStore } from '../../../state/store';
import { baseUrlFor } from '../../../agent/providers/defaults';
import { makePanelToolDeps, newRunnerConfig, refreshRunnerConfig } from '../../../ui/agent/panel-runner';
import { append } from '../../../agent/core/log';
import { useAgentSession } from '../../../agent/session/store';
import { executeToolCall } from '../../../agent/tools';
import { makeState } from '../../rules/_helpers';
import { useAgentPanelSettings } from '../../../ui/agent/settings';
import { PROVIDER_IDS, type ProviderId } from '../../../agent/providers/defaults';

/** Every provider id mapped to no model, the shape the settings store holds. */
function emptyModelMap(): Record<ProviderId, string> {
  return Object.fromEntries(PROVIDER_IDS.map((id) => [id, ''])) as Record<ProviderId, string>;
}

function live() {
  const registry = createDefaultRegistry();
  return { registry, makeToolDeps: () => makePanelToolDeps({ vision: false }), uiLocale: 'en' };
}

/** A live map in the store, the way the shell has one. */
function installMap(): GridState {
  const gs = makeState(20, 20) as GridState;
  const executor = new CommandExecutor(gs, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(gs));
  useEditorStore.setState({ gridState: gs, commandExecutor: executor, region: [{ x: 3, y: 4 }] });
  return gs;
}

afterEach(() => {
  useEditorStore.setState({ gridState: null, commandExecutor: null, region: [] });
});

describe('the runner config the panel keeps current', () => {
  it('forgets a region that no longer applies, so a global key is never sent to the CN host', () => {
    const L = live();
    // A Zhipu key resolved against the CN host: region 1 is what routes the adapter there.
    const cfg = newRunnerConfig({ providerId: 'zhipu', apiKey: 'cn-key', model: 'glm-4', oversight: 'checkpoint', region: 1 }, L);
    expect(baseUrlFor(cfg.providerId, cfg)).toBe(baseUrlFor('zhipu', { region: 1 }));

    // The user arms Qwen with a globally-issued key: `runnerSettings` reports no region at all.
    refreshRunnerConfig(cfg, { providerId: 'qwen', apiKey: 'global-key', model: 'qwen-max', oversight: 'checkpoint' }, L);
    expect(cfg.region).toBeUndefined();
    expect(baseUrlFor(cfg.providerId, cfg)).toBe(baseUrlFor('qwen', {}));
    expect(baseUrlFor(cfg.providerId, cfg)).not.toBe(baseUrlFor('qwen', { region: 1 }));
  });

  it('forgets a custom endpoint the user has cleared', () => {
    const L = live();
    const cfg = newRunnerConfig(
      { providerId: 'custom', apiKey: 'k', model: 'local', oversight: 'yolo', customBaseUrl: 'https://gateway.example/v1' }, L,
    );
    expect(cfg.customBaseUrl).toBe('https://gateway.example/v1');

    refreshRunnerConfig(cfg, { providerId: 'custom', apiKey: 'k', model: 'local', oversight: 'yolo' }, L);
    expect(cfg.customBaseUrl).toBeUndefined();
    expect(baseUrlFor(cfg.providerId, cfg)).toBeUndefined();
  });

  it('carries the rest of the armed connection, and the display language with it', () => {
    const L = live();
    const cfg = newRunnerConfig({ providerId: 'claude', apiKey: 'a', model: 'opus', oversight: 'strict' }, L);
    refreshRunnerConfig(cfg, { providerId: 'openai', apiKey: 'b', model: 'gpt-5.5', oversight: 'yolo' }, { ...L, uiLocale: 'zh' });
    expect(cfg).toMatchObject({ providerId: 'openai', apiKey: 'b', model: 'gpt-5.5', oversight: 'yolo', uiLocale: 'zh' });
  });
});

describe('the tool dependencies the panel builds per job', () => {
  /** Every member the panel is expected to wire. A name leaving this list is a capability the agent
   *  loses, so the list is the test. */
  const EXPECTED = [
    'getState', 'getExecutor', 'getRegion', 'getSelectedBlock', 'undoFloor',
    'onFlash', 'getProvenanceSource', 'requestExport',
  ] as const;

  it('wires every one of them, and none as undefined', () => {
    installMap();
    const deps = makePanelToolDeps({ vision: false });
    for (const key of EXPECTED) {
      expect(typeof (deps as unknown as Record<string, unknown>)[key], key).toBe('function');
    }
    // The set, not just its members: an EXTRA one is a mirror of state the loop already keeps (the
    // plan is log events), so it is worth failing on too.
    expect(Object.keys(deps).sort()).toEqual([...EXPECTED].sort());
  });

  it('reads the live map, executor and painted region through the store', () => {
    const gs = installMap();
    const deps = makePanelToolDeps({ vision: false });
    expect(deps.getState()).toBe(gs);
    expect(deps.getExecutor()).toBe(useEditorStore.getState().commandExecutor);
    expect(deps.getRegion()).toEqual([{ x: 3, y: 4 }]);
  });

  /** The snapshotters are the pair of dependencies that are CONDITIONAL: a model that cannot read
   *  an image must not be sent one, and `view_map` degrades to the token grid instead. They travel
   *  together — the region member is the look-closer half of the same capability. */
  it('wires both snapshotters only for a model that can read an image', () => {
    installMap();
    expect(makePanelToolDeps({ vision: false }).snapshot).toBeUndefined();
    expect(makePanelToolDeps({ vision: false }).snapshotRegion).toBeUndefined();
    expect(typeof makePanelToolDeps({ vision: true }).snapshot).toBe('function');
    expect(typeof makePanelToolDeps({ vision: true }).snapshotRegion).toBe('function');
  });

  /**
   * THE EXPORT DISCLOSURE HAS TO NAME WHAT A HUMAN APPROVED. `userApproved` was hardcoded `false`,
   * which made `ProvSource.AiAccepted` unreachable in the app and `counts.aiAccepted` permanently
   * zero — on a panel whose whole gate machinery exists to obtain that approval. The fact is read off
   * the log's own gate pair for THIS call, and `allow-always` is deliberately not one of them: it is
   * a standing session permission rather than a press about this edit.
   */
  it('reports the approval the log records for this call, and reads allow-always as a plain AI write', () => {
    installMap();
    const log = useAgentSession.getState().log;
    append(log, { kind: 'order', text: 'terrace the hillside', mapContext: 'Hexia' });
    append(log, { kind: 'gateAsked', gateId: 'gate-approved', scope: 'tool', callId: 'call-yes', summary: 'paint_terrain: …' });
    append(log, { kind: 'gateAnswered', gateId: 'gate-approved', answer: 'allow' });
    append(log, { kind: 'gateAsked', gateId: 'gate-always', scope: 'tool', callId: 'call-always', summary: 'place_object: …' });
    append(log, { kind: 'gateAnswered', gateId: 'gate-always', answer: 'allow-always' });

    const deps = makePanelToolDeps({ vision: false });
    const src = (id?: string) => deps.getProvenanceSource!(id);
    expect(src('call-yes')).toMatchObject({ toolCallId: 'call-yes', userApproved: true });
    expect(src('call-always')).toMatchObject({ userApproved: false });
    // A call that was never gated (yolo, a narrow write under checkpoint) reports no approval, and
    // neither does a stroke with no call to name.
    expect(src('call-ungated').userApproved).toBe(false);
    expect(src().userApproved).toBe(false);
    expect(src().toolCallId).toBeUndefined();
  });

  /** And the call's id reaches it, which is the only route it has: the stroke runner is handed the
   *  dependencies and never the call. */
  it('hands the executing call s own id to the provenance source', async () => {
    installMap();
    const seen: (string | undefined)[] = [];
    const deps = makePanelToolDeps({ vision: false });
    const spied = { ...deps, getProvenanceSource: (id?: string) => { seen.push(id); return { userApproved: false }; } };
    await executeToolCall({ id: 'call-42', name: 'paint_terrain', input: { cells: [{ x: 4, y: 4 }], terrain: 'mountain', elevation: 1 } }, spied);
    expect(seen).toEqual(['call-42']);
  });

  /**
   * THE AUTHOR IS THE CONNECTION THE JOB LAUNCHED WITH, frozen here rather than read per call.
   *
   * This function runs once per job (the runner asks at launch), so the pair it captures is the one
   * the requests actually go out on. Read live inside the source instead, a model armed mid-run was
   * filed as the author of edits the previous model had already made, which is a false attribution in
   * the export disclosure and unfalsifiable after the fact.
   */
  it('files every edit of a job under the model that was armed when it launched', () => {
    installMap();
    useAgentPanelSettings.setState({ provider: 'claude', model: { ...emptyModelMap(), claude: 'model-a' } });
    const deps = makePanelToolDeps({ vision: false });

    // The user arms another model while the job this dependency set belongs to is still running.
    useAgentPanelSettings.setState({ model: { ...emptyModelMap(), claude: 'model-b' } });

    expect(deps.getProvenanceSource!('call-1')).toMatchObject({ provider: 'claude', model: 'model-a' });
    // And the NEXT job, which asks for its own set, is filed under the model it will really use.
    expect(makePanelToolDeps({ vision: false }).getProvenanceSource!('call-2'))
      .toMatchObject({ provider: 'claude', model: 'model-b' });
  });

  /**
   * THE MAP AND THE PAINTED REGION ARE FROZEN AT LAUNCH TOO, by the same argument and in the same
   * call: a job's scope is what the user had painted when they gave the order, so a repaint mid-run
   * does not silently move the boundary the region lock is enforcing, and a map installed mid-run
   * does not become the thing a running job edits.
   */
  it('freezes the map and the painted region per job, so neither moves under a running one', () => {
    const first = installMap();
    const deps = makePanelToolDeps({ vision: false });

    useEditorStore.setState({ region: [{ x: 9, y: 9 }] });
    const second = installMap();

    expect(deps.getState()).toBe(first);
    expect(deps.getRegion()).toEqual([{ x: 3, y: 4 }]);
    // The next job reads the store as it now stands.
    const next = makePanelToolDeps({ vision: false });
    expect(next.getState()).toBe(second);
    expect(next.getRegion()).toEqual([{ x: 3, y: 4 }]);
  });

  it('refuses to build a half-set when there is no map, rather than letting a job discover it', () => {
    useEditorStore.setState({ gridState: null, commandExecutor: null });
    expect(() => makePanelToolDeps({ vision: false })).toThrow(/no map/);
  });
});
