// @vitest-environment jsdom
/**
 * `PanelColumn` is the only production caller handing `PanelShell` its verbs and projections. Every
 * verb is optional, so a forgotten one type-checks and draws a dead control; `PanelShell` is replaced
 * by a recorder of the props handed across.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';

import { EventBus } from '../../../core/commands/event-bus';
import { setToastPresenter } from '../../../platform/channels/toast-bus';
import { CommandType, TerrainType, type GridState, type MapTemplate, type PaintTerrainCommand } from '../../../core/model/types';
import { type EditorEvents } from '../../../state/editing/events';
import { CellZone } from '../../../core/game/zones';
import { createGrid } from '../../../core/model/grid-model';
import { createDefaultRegistry } from '../../../rules';
import { useEditorStore } from '../../../state/store';
import { I18nProvider } from '../../../i18n/context';
import { append } from '../../../agent/core/log';
import { serializeLog } from '../../../agent/session/log-codec';
import { useAgentSession } from '../../../agent/session/store';
import type { PanelShellProps } from '../../../ui/agent/PanelShell';
import { flatPanelProps, type FlatPanelProps } from '../../_support/agent-panel';
import { useAgentConnection } from '../../../agent/connection/store';
import { PROVIDER_IDS, type ProviderId } from '../../../agent/providers/defaults';
import { downloadJSON } from '../../../io/export/download';
import { makeState } from '../../_support/map-state';
import { z } from '../../../ui/design/styles';
import { panelMaxHeight } from '../../../ui/shell/panel-frame';
import { GATE_BORROW, JOB_ZONE_FLOOR, PINNED_HEIGHT } from '../../../ui/agent/PanelShell';
import { createExecutor } from '../../../state/executor';

/** The column's own least room, derived the way it derives it. */
const PANEL_LEAST = PINNED_HEIGHT + JOB_ZONE_FLOOR;

// jsdom has no `URL.createObjectURL`, so the real `downloadJSON` throws; the tests read its arguments.
vi.mock('../../../io/export/download', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../io/export/download')>(),
  downloadJSON: vi.fn(),
}));

/** Every prop `PanelShell` is handed, as the last render saw them, flattened across its groups. */
let handed: FlatPanelProps | null = null;

// Only the component is replaced: the column derives its least room from the module's real constants.
vi.mock('../../../ui/agent/PanelShell', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../ui/agent/PanelShell')>(),
  PanelShell: (props: PanelShellProps) => {
    handed = flatPanelProps(props);
    return <div data-testid="panel-shell-stub" />;
  },
}));

/** A stub runner: the banner verbs are proven by what they hand the runner, and a real one would
 *  start a network adapter. Hoisted because the mock factory needs it before any import. */
const { runnerMock } = vi.hoisted(() => ({
  runnerMock: {
    send: vi.fn(), stop: vi.fn(), pause: vi.fn(), resume: vi.fn(),
    setAside: vi.fn(), retryNow: vi.fn(), active: vi.fn(() => false),
    connection: () => undefined,
  },
}));
/** How many runners the column has built. */
const { runnerBuilds } = vi.hoisted(() => ({ runnerBuilds: { n: 0 } }));
vi.mock('../../../agent/exec/runner', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../agent/exec/runner')>(),
  createRunner: () => { runnerBuilds.n += 1; return runnerMock; },
}));

/** How many times the real sketch analysis has run, for the quiet-gate test. */
let proposeCalls = 0;
vi.mock('../../../ui/agent/sketchbook/propose', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../ui/agent/sketchbook/propose')>();
  return {
    ...actual,
    proposeSketches: (...args: Parameters<typeof actual.proposeSketches>) => {
      proposeCalls += 1;
      return actual.proposeSketches(...args);
    },
  };
});

const backing = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
};

/** A live map in the store; the column builds its runner on the first render with a rule registry. */
function installMap(): GridState {
  const gs = makeState(20, 20) as GridState;
  const bus = new EventBus<EditorEvents>();
  const executor = createExecutor(gs, createDefaultRegistry(), bus);
  useEditorStore.setState({ gridState: gs, commandExecutor: executor, eventBus: bus, region: [] });
  return gs;
}

/** Mounts and waits a frame: the column reads the undo depth off editor events, which update after mount. */
async function mountColumn(): Promise<void> {
  const { default: PanelColumn } = await import('../../../ui/agent/PanelColumn');
  await act(async () => {
    render(
      <MotionConfig reducedMotion="always">
        <I18nProvider>
          <PanelColumn open />
        </I18nProvider>
      </MotionConfig>,
    );
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  });
}

beforeEach(() => {
  handed = null;
  proposeCalls = 0;
  backing.clear();
  installMap();
  useAgentSession.getState().clearSession();
  runnerMock.send.mockClear();
  runnerBuilds.n = 0;
  vi.mocked(downloadJSON).mockClear();
});

// A column left mounted would re-render on the next test's `clearSession`, outside `act`.
afterEach(() => {
  cleanup();
  useEditorStore.setState({ gridState: null, commandExecutor: null, region: [] });
});

/** The docked pin, the display language and the painted region apply at once and re-render the
 *  column, but it keeps one runner for its life: a rebuilt runner is a job nobody can stop. */
describe('the room can change under a job without touching it', () => {
  it('builds one runner for its whole life, whatever re-renders it', async () => {
    await mountColumn();
    expect(runnerBuilds.n).toBe(1);

    await act(async () => { useEditorStore.getState().setAssistantPinned(true); });
    await act(async () => { useEditorStore.getState().setLocale('ja'); });
    await act(async () => { useEditorStore.setState({ region: [{ x: 2, y: 2 }] }); });

    expect(runnerBuilds.n, 'a rebuilt runner is a job nobody can stop').toBe(1);

    // Restore: the locale is module-wide and the other tests read English.
    await act(async () => {
      useEditorStore.getState().setLocale('en');
      useEditorStore.getState().setAssistantPinned(false);
    });
  });
});

describe('the props the column hands across the seam', () => {
  /** Every verb and selector the panel needs a caller for. */
  const REQUIRED = [
    'onSend', 'onStop', 'onPause', 'onResume', 'onRetryNow',
    'onGateAnswer', 'onRecallSteer', 'onRewind', 'onRollBack', 'onCollapse',
    // The gate card's map photograph, which needs both the session log and the renderer.
    'gateThumb',
    'onClearJobs',
    'onFileAway',
    'onClearRecord',
    'onRewindAll', 'onKeepGoing',
    'recordShot', 'recordStamp',
    'optionThumb',
    'onMarkRegion', 'onClearRegion', 'regionShot',
    // Repairs that reach past the panel: a retry, a dropped key, the exported log.
    'onRepair',
    'onDismissStorage',
    'onSetAside',
    'onTogglePin',
  ] as const;

  // `sketchbook` and `fill` are conditional and have their own cases below.

  /** Non-verb facts only the column supplies, checked for presence since some are legitimately null
   *  (`bounds` with nothing painted). A missing one fails silently: `filed` defaults to empty, so a
   *  filed card would come back. */
  const REQUIRED_FACTS = [
    'providerName', 'connectionMeta', 'open', 'filed', 'cleared', 'bounds', 'marking',
    // Whether the session was restored from storage, telling a job held this visit from one found held.
    'restored',
  ] as const;

  it('wires every verb it is the only caller for, and none as undefined', async () => {
    await mountColumn();
    expect(handed).not.toBeNull();
    for (const key of REQUIRED) {
      expect(typeof (handed as unknown as Record<string, unknown>)[key], key).toBe('function');
    }
    for (const key of REQUIRED_FACTS) {
      expect((handed as unknown as Record<string, unknown>)[key], key).not.toBeUndefined();
    }
  });

  /** The sketch card is read off the live map, so only the column can supply it. */
  it('hands a card down for a map that offers something, and none for a map that offers nothing', async () => {
    // The analysis runs only behind a filed key.
    const model = Object.fromEntries(PROVIDER_IDS.map((id) => [id, ''])) as Record<ProviderId, string>;
    model.claude = 'claude-sonnet-4-5';
    useAgentConnection.setState({
      provider: 'claude', model, oversight: 'checkpoint', customBaseUrl: '', hydrated: true,
    });
    useAgentConnection.getState().connectKey('claude', 'sk-ant-api03-panel-column-fixture');
    await mountColumn();
    expect(handed!.sketchbook, 'the real template proposes something').not.toBeUndefined();

    const sea: MapTemplate = {
      id: 'sea', name: { en: 'Open sea' }, width: 24, height: 24,
      zones: Array.from({ length: 24 }, () => Array.from({ length: 24 }, () => CellZone.Void)),
      landmarks: [],
    };
    await act(async () => {
      useEditorStore.setState({
        gridState: { template: sea, cells: createGrid(sea), objects: new Map(), objectsVersion: 0, cellsVersion: 0, lockedLayers: new Set() },
      });
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
    expect(handed!.sketchbook, 'nothing to propose, nothing to dress').toBeUndefined();
  });

  /** The helper lane is not a projection: a delegate's child keeps its own log, so its progress is
   *  published on the store (`setChildLive`) and only the column passes it on. */
  it('folds the live child into a lane, and hands none while no helper is working', async () => {
    await mountColumn();
    expect(handed!.lane, 'no child in flight').toBeUndefined();

    await act(async () => {
      useAgentSession.getState().setChildLive({ task: 'plant the grove', opName: 'plant_forest', ops: 3 });
    });
    expect(handed!.lane).toEqual({ task: 'plant the grove', opName: 'plant_forest', ops: 3 });

    await act(async () => { useAgentSession.getState().setChildLive(null); });
    expect(handed!.lane).toBeUndefined();
  });

  /** `running` is the runner's answer, not the phase: a log orphaned by a reload reads active with
   *  no runner, and a Stop there would call an abort controller that does not exist. */
  it('reports a job as running only where a runner really has one', async () => {
    append(useAgentSession.getState().log, { kind: 'order', text: 'build a village', mapContext: '' });
    await mountColumn();
    expect(handed!.view.phase, 'the log reads active').toBe('thinking');
    expect(handed!.running, 'and nothing is running it').toBe(false);
  });

  it('says the live connection as the manage face\'s meta', async () => {
    await mountColumn();
    expect(handed!.connectionMeta).toContain('Checkpoint');
  });

  /** A record naming another map and a record naming none are two different refusals. */
  it('classifies each settled record against the open map, and refuses what it cannot prove', async () => {
    const log = useAgentSession.getState().log;
    // `installMap` uses the template id `test`.
    append(log, { kind: 'order', text: 'here', mapContext: '', mapId: 'test' });
    append(log, { kind: 'jobEnd', outcome: 'done', summary: 'built' });
    append(log, { kind: 'order', text: 'elsewhere', mapContext: '', mapId: 'hexia' });
    append(log, { kind: 'jobEnd', outcome: 'done', summary: 'built' });
    append(log, { kind: 'order', text: 'unrecorded', mapContext: '' });
    append(log, { kind: 'jobEnd', outcome: 'done', summary: 'built' });

    await mountColumn();
    const seqs = handed!.view.jobs.map((job) => job.orderSeq);
    expect(handed!.otherMap && [...handed!.otherMap]).toEqual([seqs[1]]);
    expect(handed!.unknownMap && [...handed!.unknownMap]).toEqual([seqs[2]]);
  });

  /** With no map open there is nothing to compare against, so no record is condemned. */
  it('publishes no guard set while no map is open', async () => {
    const log = useAgentSession.getState().log;
    append(log, { kind: 'order', text: 'here', mapContext: '', mapId: 'test' });
    append(log, { kind: 'jobEnd', outcome: 'done', summary: 'built' });
    useEditorStore.setState({ gridState: null });

    await mountColumn();
    expect(handed!.otherMap).toBeUndefined();
    expect(handed!.unknownMap).toBeUndefined();
  });

  /** `answerGate` throws on a stale or answered gateId; inside a click handler that would be uncaught. */
  it('refuses a stale gate answer out loud instead of throwing', async () => {
    const said: string[] = [];
    const unregister = setToastPresenter((text) => said.push(text));
    try {
      await mountColumn();
      expect(() => handed!.onGateAnswer('no-such-gate', 'allow')).not.toThrow();
      expect(said).toHaveLength(1);
      expect(said[0]!.length).toBeGreaterThan(0);
      // An empty gateId means no gate and says nothing.
      expect(() => handed!.onGateAnswer('', 'allow')).not.toThrow();
      expect(said).toHaveLength(1);
    } finally {
      unregister();
    }
  });

  /** The gated call's size, measured against the live grid with the tools' own `resolveCells`, so it
   *  is the cells the approval would touch. */
  it('measures the open gate\'s call in cells, and withholds a count of one', async () => {
    const log = useAgentSession.getState().log;
    append(log, { kind: 'order', text: 'pave the shore', mapContext: '' });
    append(log, {
      kind: 'assistant', stop: 'tool-calls',
      parts: [{ kind: 'tool', callId: 'c1', name: 'build_road', input: { line: { x1: 2, y1: 4, x2: 2, y2: 9 } }, argsDone: true }],
    });
    append(log, { kind: 'gateAsked', gateId: 'g1', scope: 'tool', callId: 'c1', summary: 'pave' });
    await mountColumn();
    expect(handed!.gateCells).toBe(6);

    cleanup();
    useAgentSession.getState().clearSession();
    const one = useAgentSession.getState().log;
    append(one, { kind: 'order', text: 'a lamp', mapContext: '' });
    append(one, {
      kind: 'assistant', stop: 'tool-calls',
      parts: [{ kind: 'tool', callId: 'c2', name: 'place_object', input: { x: 3, y: 3, catalogId: 'lamp' }, argsDone: true }],
    });
    append(one, { kind: 'gateAsked', gateId: 'g2', scope: 'tool', callId: 'c2', summary: 'place' });
    await mountColumn();
    expect(handed!.gateCells).toBeUndefined();
  });

  /** A session rehydrated at boot can stand at a gate before the map opens; the count is retaken
   *  when the map arrives. */
  it('measures the gate once the map arrives, not only if it was already there', async () => {
    useEditorStore.setState({ gridState: null, commandExecutor: null });
    const log = useAgentSession.getState().log;
    append(log, { kind: 'order', text: 'pave the shore', mapContext: '' });
    append(log, {
      kind: 'assistant', stop: 'tool-calls',
      parts: [{ kind: 'tool', callId: 'c1', name: 'build_road', input: { line: { x1: 2, y1: 4, x2: 2, y2: 9 } }, argsDone: true }],
    });
    append(log, { kind: 'gateAsked', gateId: 'g1', scope: 'tool', callId: 'c1', summary: 'pave' });
    await mountColumn();
    expect(handed!.gateCells).toBeUndefined();

    await act(async () => {
      installMap();
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
    expect(handed!.gateCells).toBe(6);
  });
});

/** `proposeSketches` reads the whole grid and the column re-renders every frame while a stroke lands,
 *  so the analysis waits `MAP_QUIET_MS` for the map's version to stand still. */
describe('the quiet gate on the sketch analysis', () => {
  function connect(): void {
    const model = Object.fromEntries(PROVIDER_IDS.map((id) => [id, ''])) as Record<ProviderId, string>;
    model.claude = 'claude-sonnet-4-5';
    useAgentConnection.setState({
      provider: 'claude', model, oversight: 'checkpoint', customBaseUrl: '', hydrated: true,
    });
    useAgentConnection.getState().connectKey('claude', 'sk-ant-api03-panel-column-quiet-gate');
  }

  it('runs no fresh analysis while the map keeps moving, and exactly one once it settles', async () => {
    connect();
    await mountColumn();
    const baseline = proposeCalls;
    expect(baseline, 'the mount itself is one reading').toBeGreaterThan(0);

    // 20 commits through the executor, a frame apart, never giving the gate its 400ms of quiet.
    const { commandExecutor } = useEditorStore.getState();
    for (let x = 0; x < 20; x++) {
      const cmd: PaintTerrainCommand = {
        type: CommandType.PaintTerrain,         cells: [{ x, y: 19 }], terrainType: TerrainType.Mountain, elevation: 1,
      };
      await act(async () => {
        commandExecutor!.execute(cmd);
        await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
      });
    }
    expect(proposeCalls, 'no analysis mid-stroke').toBe(baseline);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
    });
    expect(proposeCalls, 'exactly one, once the map has been quiet').toBe(baseline + 1);
  });
});

/** `REQUIRED` only proves `onRepair` exists; these drive its `try-again` and `export-log` actions. */
describe('the two banner verbs the seam sweep never drove', () => {
  /** `try-again` sends the last order's text to the runner again. */
  it('resends the last order\'s own text to the runner', async () => {
    const log = useAgentSession.getState().log;
    append(log, { kind: 'order', text: 'build a village', mapContext: '' });
    append(log, { kind: 'incident', error: { cls: 'network', detail: 'offline' } });
    await mountColumn();

    await act(async () => { handed!.onRepair!('try-again'); });
    expect(runnerMock.send).toHaveBeenCalledWith('build a village');
  });

  /** A send while a job runs would be read as steering, so a retry files nothing then. */
  it('files nothing while a job is still running', async () => {
    const log = useAgentSession.getState().log;
    append(log, { kind: 'order', text: 'build a village', mapContext: '' });
    append(log, { kind: 'incident', error: { cls: 'network', detail: 'offline' } });
    await mountColumn();
    runnerMock.send.mockClear();
    runnerMock.active.mockReturnValue(true);
    try {
      await act(async () => { handed!.onRepair!('try-again'); });
      expect(runnerMock.send).not.toHaveBeenCalled();
    } finally {
      runnerMock.active.mockReturnValue(false);
    }
  });

  /** Which bytes and what name; the browser download itself is out of jsdom's reach. */
  it('writes the corrupt bytes while a corrupt notice stands, and the live log otherwise', async () => {
    await mountColumn();

    await act(async () => { handed!.onRepair!('export-log'); });
    expect(downloadJSON).toHaveBeenLastCalledWith(
      serializeLog(useAgentSession.getState().log),
      expect.stringMatching(/^petitmaker-agent-log-\d+\.json$/),
    );

    useAgentSession.setState({ corruptRaw: '{not json' });
    await act(async () => { handed!.onRepair!('export-log'); });
    expect(downloadJSON).toHaveBeenLastCalledWith(
      '{not json',
      expect.stringMatching(/^petitmaker-agent-log-\d+\.json$/),
    );
  });
});

/** Which state borrows room for an unanswered plan gate: the height cap and the z rung move together.
 *  The arithmetic is `panel-room.test.tsx`'s. */
describe('the column borrows room while a plan gate stands', () => {
  const wrapper = () => document.querySelector<HTMLElement>('[data-testid="shell-assistant-panel"]')!;

  /** A plan gate published and answerable, the way the projection publishes one. */
  function askPlan(): void {
    const log = useAgentSession.getState().log;
    append(log, { kind: 'order', text: 'Build a hillside village', mapContext: '' });
    append(log, {
      kind: 'assistant',
      stop: 'tool-calls',
      parts: [{
        kind: 'tool',
        callId: 'plan-1',
        name: 'update_plan',
        input: { stages: [{ label: 'Shape the ridge' }, { label: 'Carve the stream' }] },
        argsDone: true,
      }],
    });
    append(log, {
      kind: 'gateAsked', gateId: 'gate-plan', scope: 'plan', callId: 'plan-1',
      summary: '2 stages: Shape the ridge, Carve the stream',
    });
  }

  it('stands at the panel rung and asks for no borrow while nothing is being asked', async () => {
    append(useAgentSession.getState().log, { kind: 'order', text: 'build a village', mapContext: '' });
    await mountColumn();
    expect(handed!.view.gate).toBeUndefined();
    expect(wrapper().style.zIndex).toBe(String(z.panel));
    expect(handed!.maxHeight).toBe(panelMaxHeight(null, PANEL_LEAST));
  });

  /** Borrowed height is room only if the bar below cannot paint over it, so the column also takes the
   *  higher rung, and gives both back once the question is answered. */
  it('takes the borrow and the column rung while the gate is unanswered, and gives both back', async () => {
    askPlan();
    await mountColumn();
    expect(handed!.view.gate?.scope).toBe('plan');
    expect(handed!.maxHeight).toBe(panelMaxHeight(null, PANEL_LEAST, GATE_BORROW));
    expect(handed!.maxHeight).not.toBe(panelMaxHeight(null, PANEL_LEAST));
    expect(wrapper().style.zIndex).toBe(String(z.column));

    await act(async () => { handed!.onGateAnswer('gate-plan', 'allow'); });
    expect(handed!.view.gate, 'the question is answered').toBeUndefined();
    expect(handed!.maxHeight).toBe(panelMaxHeight(null, PANEL_LEAST));
    expect(wrapper().style.zIndex).toBe(String(z.panel));
  });

  /** A tool gate is a summary and two verbs, which always fit. */
  it('borrows nothing for a tool gate', async () => {
    const log = useAgentSession.getState().log;
    append(log, { kind: 'order', text: 'Pave the lane', mapContext: '' });
    append(log, {
      kind: 'assistant',
      stop: 'tool-calls',
      parts: [{ kind: 'tool', callId: 'road-1', name: 'build_road', input: {}, argsDone: true }],
    });
    append(log, {
      kind: 'gateAsked', gateId: 'gate-road', scope: 'tool', callId: 'road-1',
      summary: 'Pave a stone road from the plaza to the mill',
    });
    await mountColumn();
    expect(handed!.view.gate?.scope).toBe('tool');
    expect(handed!.maxHeight).toBe(panelMaxHeight(null, PANEL_LEAST));
    expect(wrapper().style.zIndex).toBe(String(z.panel));
  });
});
