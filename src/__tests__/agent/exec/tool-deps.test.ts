/**
 * The tool dependencies the runner gets per job over the live editor. All but the first three are
 * optional, so dropping one still type-checks; the expected set is pinned by name instead.
 */
import { describe, it, expect, afterEach } from 'vitest';

import type { GridState } from '../../../core/model/types';
import { createDefaultRegistry } from '../../../rules';
import { useEditorStore } from '../../../state/store';
import { PROVIDER_IDS, type ProviderId } from '../../../agent/providers/defaults';
import { append } from '../../../agent/core/log';
import { useAgentConnection } from '../../../agent/connection/store';
import { agentSessionPort } from '../../../agent/exec/session-port';
import { makeToolDeps } from '../../../agent/exec/tool-deps';
import { useAgentSession } from '../../../agent/session/store';
import { executeToolCall } from '../../../agent/tools';
import { makeState } from '../../_support/map-state';
import { createExecutor } from '../../../state/executor';

/** Every provider id mapped to no model, the shape the connection store holds. */
function emptyModelMap(): Record<ProviderId, string> {
  return Object.fromEntries(PROVIDER_IDS.map((id) => [id, ''])) as Record<ProviderId, string>;
}

const depsFor = (vision: boolean) => makeToolDeps({ vision, session: agentSessionPort });

/** A live map in the store, the way the shell has one. */
function installMap(): GridState {
  const gs = makeState(20, 20) as GridState;
  const executor = createExecutor(gs, createDefaultRegistry());
  useEditorStore.setState({ gridState: gs, commandExecutor: executor, region: [{ x: 3, y: 4 }] });
  return gs;
}

afterEach(() => {
  useEditorStore.setState({ gridState: null, commandExecutor: null, region: [] });
});

describe('the tool dependencies built per job', () => {
  const EXPECTED = [
    'editAnnotations', 'getState', 'getExecutor', 'getRegion', 'getSelectedBlock', 'undoFloor',
    'onFlash', 'getProvenanceSource', 'requestExport', 'catalogName',
  ] as const;

  it('wires every one of them, and none as undefined', () => {
    installMap();
    const deps = depsFor(false);
    for (const key of EXPECTED) {
      expect(typeof (deps as unknown as Record<string, unknown>)[key], key).toBe('function');
    }
    // An extra member would mirror state the loop already keeps (the plan is log events).
    expect(Object.keys(deps).sort()).toEqual([...EXPECTED].sort());
  });

  it('reads the live map, executor and painted region through the store', () => {
    const gs = installMap();
    const deps = depsFor(false);
    expect(deps.getState()).toBe(gs);
    expect(deps.getExecutor()).toBe(useEditorStore.getState().commandExecutor);
    expect(deps.getRegion()).toEqual([{ x: 3, y: 4 }]);
  });

  /** Without them `view_map` degrades to the token grid. */
  it('wires both snapshotters only for a model that can read an image', () => {
    installMap();
    expect(depsFor(false).snapshot).toBeUndefined();
    expect(depsFor(false).snapshotRegion).toBeUndefined();
    expect(typeof depsFor(true).snapshot).toBe('function');
    expect(typeof depsFor(true).snapshotRegion).toBe('function');
  });

  /** `allow-always` is a standing session permission, not a human approving this edit. */
  it('reports the approval the log records for this call, and reads allow-always as a plain AI write', () => {
    installMap();
    const log = useAgentSession.getState().log;
    append(log, { kind: 'order', text: 'terrace the hillside', mapContext: 'Hexia' });
    append(log, { kind: 'gateAsked', gateId: 'gate-approved', scope: 'tool', callId: 'call-yes', summary: 'paint_terrain: …' });
    append(log, { kind: 'gateAnswered', gateId: 'gate-approved', answer: 'allow' });
    append(log, { kind: 'gateAsked', gateId: 'gate-always', scope: 'tool', callId: 'call-always', summary: 'place_object: …' });
    append(log, { kind: 'gateAnswered', gateId: 'gate-always', answer: 'allow-always' });

    const deps = depsFor(false);
    const src = (id?: string) => deps.getProvenanceSource!(id);
    expect(src('call-yes')).toMatchObject({ toolCallId: 'call-yes', userApproved: true });
    expect(src('call-always')).toMatchObject({ userApproved: false });
    // A call that was never gated (yolo, a narrow write under checkpoint) reports no approval, and
    // neither does a stroke with no call to name.
    expect(src('call-ungated').userApproved).toBe(false);
    expect(src().userApproved).toBe(false);
    expect(src().toolCallId).toBeUndefined();
  });

  /** The stroke runner is handed the dependencies and never the call, so this is the id's only route. */
  it('hands the executing call s own id to the provenance source', async () => {
    installMap();
    const seen: (string | undefined)[] = [];
    const deps = depsFor(false);
    const spied = { ...deps, getProvenanceSource: (id?: string) => { seen.push(id); return { userApproved: false }; } };
    await executeToolCall({ id: 'call-42', name: 'paint_terrain', input: { cells: [{ x: 4, y: 4 }], terrain: 'mountain', elevation: 1 } }, spied);
    expect(seen).toEqual(['call-42']);
  });

  /** The runner builds the set once at launch, so the captured pair is the one requests go out on. */
  it('files every edit of a job under the model that was armed when it launched', () => {
    installMap();
    useAgentConnection.setState({ provider: 'claude', model: { ...emptyModelMap(), claude: 'model-a' } });
    const deps = depsFor(false);

    // Another model is armed while the job is still running.
    useAgentConnection.setState({ model: { ...emptyModelMap(), claude: 'model-b' } });

    expect(deps.getProvenanceSource!('call-1')).toMatchObject({ provider: 'claude', model: 'model-a' });
    expect(depsFor(false).getProvenanceSource!('call-2'))
      .toMatchObject({ provider: 'claude', model: 'model-b' });
  });

  /** A repaint mid-run must not move the boundary the region lock enforces. */
  it('freezes the map and the painted region per job, so neither moves under a running one', () => {
    const first = installMap();
    const deps = depsFor(false);

    useEditorStore.setState({ region: [{ x: 9, y: 9 }] });
    const second = installMap();

    expect(deps.getState()).toBe(first);
    expect(deps.getRegion()).toEqual([{ x: 3, y: 4 }]);
    const next = depsFor(false);
    expect(next.getState()).toBe(second);
    expect(next.getRegion()).toEqual([{ x: 3, y: 4 }]);
  });

  it('refuses to build a half-set when there is no map, rather than letting a job discover it', () => {
    useEditorStore.setState({ gridState: null, commandExecutor: null });
    expect(() => depsFor(false)).toThrow(/no map/);
  });
});
