// @vitest-environment jsdom
/**
 * The seam: `PanelShell` renders projections and calls verbs, and `PanelColumn` is the only
 * production caller supplying them. Every verb is optional, so a forgotten one type-checks and
 * leaves a drawn, translated, dead control; the list is the test, as in `runner-host.test.ts`.
 * `PanelShell` is replaced by a recorder, since the props handed across are what is under test.
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

// The writer, stubbed: jsdom has no `URL.createObjectURL`, so the real `downloadJSON` throws. What
// is under test is the source it is called with (corrupt bytes vs. the live log, and the filename),
// which is pure and belongs on this side of the seam; the DOM half stays honestly browser-only.
vi.mock('../../../io/export/download', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../io/export/download')>(),
  downloadJSON: vi.fn(),
}));

/** Every prop `PanelShell` is handed, as the last render saw them, flattened across its groups. */
let handed: FlatPanelProps | null = null;

// The component is what stands down; the module's constants are not stand-in-able — the column
// derives the least room the panel is worth standing in from the panel's own skeleton.
vi.mock('../../../ui/agent/PanelShell', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../ui/agent/PanelShell')>(),
  PanelShell: (props: PanelShellProps) => {
    handed = flatPanelProps(props);
    return <div data-testid="panel-shell-stub" />;
  },
}));

/**
 * A stub runner, for the two banner verbs that reach past the projection: `try-again` and
 * `export-log` are proven by what they hand to something outside this seam (the runner, the
 * downloader), not by a projection change, so a real runner (which would start an actual network
 * adapter) is the wrong tool here. `vi.hoisted` because the mock factory below needs it by
 * reference before the module it stands in for is ever imported.
 */
const { runnerMock } = vi.hoisted(() => ({
  runnerMock: {
    send: vi.fn(), stop: vi.fn(), pause: vi.fn(), resume: vi.fn(),
    setAside: vi.fn(), retryNow: vi.fn(), active: vi.fn(() => false),
    connection: () => undefined,
  },
}));
/** How many runners the column has built. One, for the app's life: see the describe below. */
const { runnerBuilds } = vi.hoisted(() => ({ runnerBuilds: { n: 0 } }));
vi.mock('../../../agent/exec/runner', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../agent/exec/runner')>(),
  createRunner: () => { runnerBuilds.n += 1; return runnerMock; },
}));

/** How many times the sketch analysis has actually run, for the quiet-gate test below. Wrapping
 *  the real function rather than stubbing it: what is under test is whether the call happens, not
 *  what it answers. */
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

/** A live map in the store, the way the shell has one: the column builds its runner on the first
 *  render that has a rule registry to give it. */
function installMap(): GridState {
  const gs = makeState(20, 20) as GridState;
  const bus = new EventBus<EditorEvents>();
  const executor = createExecutor(gs, createDefaultRegistry(), bus);
  useEditorStore.setState({ gridState: gs, commandExecutor: executor, eventBus: bus, region: [] });
  return gs;
}

/** Mounted inside `act`, and settled: the column reads the live undo depth off the editor's own
 *  events, so the first frame after mount carries an update of its own. */
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

// Unmounted explicitly: a column left standing re-renders on the next test's `clearSession`, which
// is a store write outside anyone's `act`.
afterEach(() => {
  cleanup();
  useEditorStore.setState({ gridState: null, commandExecutor: null, region: [] });
});

/**
 * The environment moves and the run does not notice.
 *
 * Zoom, the docked pin and the display language are the user's own room rather than the connection,
 * so they apply the instant they are asked for and must reach no job. The column's guarantee is
 * structural: One runner for its whole life, its config mutated rather than replaced, because a
 * rebuilt runner is a job in flight nobody can stop. Every one of these changes re-renders this
 * component, so this is the assertion that the re-render cannot cost a running job its stop.
 */
describe('the room can change under a job without touching it', () => {
  it('builds one runner for its whole life, whatever re-renders it', async () => {
    await mountColumn();
    expect(runnerBuilds.n).toBe(1);

    // The three environmental facts, each a store write this component subscribes to.
    await act(async () => { useEditorStore.getState().setAssistantPinned(true); });
    await act(async () => { useEditorStore.getState().setLocale('ja'); });
    await act(async () => { useEditorStore.setState({ region: [{ x: 2, y: 2 }] }); });

    expect(runnerBuilds.n, 'a rebuilt runner is a job nobody can stop').toBe(1);

    // Put the room back: the display language is a store fact for the whole module, and the file's
    // other assertions read English words.
    await act(async () => {
      useEditorStore.getState().setLocale('en');
      useEditorStore.getState().setAssistantPinned(false);
    });
  });
});

describe('the props the column hands across the seam', () => {
  /**
   * Every verb and selector the panel needs a caller for. A name leaving this list is a control the
   * user presses that does nothing.
   */
  const REQUIRED = [
    'onSend', 'onStop', 'onPause', 'onResume', 'onRetryNow',
    'onGateAnswer', 'onRecallSteer', 'onRewind', 'onRollBack', 'onCollapse',
    // The gate card's real map photograph. Only this column stands beside both the session log (for
    // the gated call's arguments) and the editor's renderer, so an unwired one is a gate card that
    // asks about a footprint it will not show.
    'gateThumb',
    // Clearing every record from the manage card.
    'onClearJobs',
    // File it away on a settled record. The store owns the marks (`fileAway`), so an unwired one is
    // a card that cannot be put away and a job zone that never comes back to rest.
    'onFileAway',
    // Clearing one opened past record.
    'onClearRecord',
    // The two take-backs a settled card offers: the whole job, from the receipt's back face or the
    // stop card, and the capped card's continue order.
    'onRewindAll', 'onKeepGoing',
    // The receipt's own photograph and the record's provenance stamp. Both need what only this
    // column stands beside (the renderer, and the clock the day is read against).
    'recordShot', 'recordStamp',
    // A pick ask's per-option photograph, the gate thumbnail one rung down.
    'optionThumb',
    // The region attachment. Only this column stands beside the editor's store, so an unwired
    // `onMarkRegion` is a frame button that never appears and an unwired `onClearRegion` is a chip
    // whose cross cannot detach the paint the write tools are still bound to. `regionShot` is the
    // vignette, the same picture seam every other card's is on.
    'onMarkRegion', 'onClearRegion', 'regionShot',
    // The repairs that reach past the panel (a retry, a dropped key, the exported log), from the desk
    // card, the banners and a held offer.
    'onRepair',
    // The storage notice's own answer, and the only way a standing one is ever put down.
    'onDismissStorage',
    // Putting a held job away, which is two verbs (settle, then file) and only this side has the
    // runner for the first: unwired, a held offer draws no set-aside at all.
    'onSetAside',
    // The dock. Only this column reads the preference and the window's room, and the panel draws no
    // dock control at all without the verb — so an unwired one is a headline feature with no way in.
    'onTogglePin',
  ] as const;

  /* Two props are legitimately conditional and are pinned by their own cases below rather than
   * listed here: `sketchbook` is absent for a map that proposes nothing (the whole point of the
   * card's honesty), and `fill` exists only after a press. */

  /** Non-verb facts the column is the only source for, checked by presence rather than by function
   *  type. `providerName` feeds the auth face's own act line ("whose key" on a nine-provider BYOK
   *  panel); dropping it silently blanks that datum rather than throwing. `connectionMeta` is the
   *  manage face's own meta line, and `open` lets the panel close its transient surfaces with it.
   *  `filed` is the store's own set of put-away records, and the panel defaults it to empty: a
   *  forgotten wiring is therefore a terminal card that comes back after every File it away.
   *  `bounds` is the live painted region and `marking` whether the map is holding the pencil: both
   *  are the editor store's, and a panel handed neither draws no chip over a region the agent's
   *  write tools are already confined to. `bounds` is legitimately null (nothing painted), which is
   *  why these are checked for presence rather than for truth. */
  const REQUIRED_FACTS = [
    'providerName', 'connectionMeta', 'open', 'filed', 'cleared', 'bounds', 'marking',
    // Whether the session came back from storage: the one fact that tells a held job the user is
    // standing in from one the session was found holding, and only the store knows it.
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

  /**
   * The idle dressing is the column's, because only this side of the seam stands beside the map: the
   * proposals are read off the live `GridState` and the card's ground is a real capture. An unwired
   * one is a rest state with no dressing at all — and a card handed down for a map with nothing to
   * propose would be the opposite fault, a promise about an island nobody analysed.
   */
  it('hands a card down for a map that offers something, and none for a map that offers nothing', async () => {
    // The dressing belongs to the connected rest (a keyless panel wears the dreaming office
    // instead), so the analysis runs only behind a filed key.
    const model = Object.fromEntries(PROVIDER_IDS.map((id) => [id, ''])) as Record<ProviderId, string>;
    model.claude = 'claude-sonnet-4-5';
    useAgentConnection.setState({
      provider: 'claude', model, oversight: 'checkpoint', customBaseUrl: '', hydrated: true,
    });
    useAgentConnection.getState().connectKey('claude', 'sk-ant-api03-panel-column-fixture');
    await mountColumn();
    expect(handed!.sketchbook, 'the real template proposes something').not.toBeUndefined();

    // An all-sea template offers nothing: no land, no analysis, no card.
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

  /**
   * The helper lane is the one panel fact that is not a projection. A delegate's child keeps its own
   * log, which dies with the call, so its progress is published on the store (`setChildLive`) rather
   * than folded into `panelView` — it bumps no epoch and a reload has no live child to show. That
   * makes it exactly the kind of prop this file exists to catch: a lane nobody passes is a helper
   * that works in silence for minutes.
   */
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

  it('hands over the session projection, the connection and the room the frame has', async () => {
    await mountColumn();
    expect(handed!.view.phase).toBe('idle');
    expect(typeof handed!.connected).toBe('boolean');
    expect(typeof handed!.running).toBe('boolean');
    expect(typeof handed!.maxHeight).toBe('string');
  });

  /**
   * `running` is the runner's answer, not a phase reading. `PanelShell`'s own fallback is
   * `!AT_REST.has(phase)`, which agrees in the ordinary case and not in the one that matters: a log
   * whose tail reads active with no runner behind it (an order orphaned by a reload) put a live Stop
   * on the composer, calling into an abort controller that does not exist.
   */
  it('reports a job as running only where a runner really has one', async () => {
    append(useAgentSession.getState().log, { kind: 'order', text: 'build a village', mapContext: '' });
    await mountColumn();
    expect(handed!.view.phase, 'the log reads active').toBe('thinking');
    expect(handed!.running, 'and nothing is running it').toBe(false);
  });

  /** The connection as one line, which is what the manage face says instead of a table of contents. */
  it('says the live connection as the manage face\'s meta', async () => {
    await mountColumn();
    expect(handed!.connectionMeta).toContain('Checkpoint');
  });

  /**
   * The rollback guard is the column's, because only it stands beside both the record and the live
   * map. It classifies each settled record three ways, and the two refusals must not be said as one:
   * a record naming another map is proven elsewhere, and a record naming none is merely unverifiable.
   */
  it('classifies each settled record against the open map, and refuses what it cannot prove', async () => {
    const log = useAgentSession.getState().log;
    // `installMap` stands the test template, whose id is `test`.
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

  /** With no map open there is nothing to compare against and nothing to roll back onto, so the
   *  guard publishes no set at all rather than condemning every record on a technicality. */
  it('publishes no guard set while no map is open', async () => {
    const log = useAgentSession.getState().log;
    append(log, { kind: 'order', text: 'here', mapContext: '', mapId: 'test' });
    append(log, { kind: 'jobEnd', outcome: 'done', summary: 'built' });
    useEditorStore.setState({ gridState: null });

    await mountColumn();
    expect(handed!.otherMap).toBeUndefined();
    expect(handed!.unknownMap).toBeUndefined();
  });

  /** `answerGate` throws on a stale or already-answered gateId, deliberately. Inside a click handler
   *  that is an uncaught error in the render tree rather than a refusal. */
  it('refuses a stale gate answer out loud instead of throwing', async () => {
    const said: string[] = [];
    const unregister = setToastPresenter((text) => said.push(text));
    try {
      await mountColumn();
      expect(() => handed!.onGateAnswer('no-such-gate', 'allow')).not.toThrow();
      expect(said).toHaveLength(1);
      expect(said[0]!.length).toBeGreaterThan(0);
      // An empty gateId is the shell's own "there is no gate" and says nothing.
      expect(() => handed!.onGateAnswer('', 'allow')).not.toThrow();
      expect(said).toHaveLength(1);
    } finally {
      unregister();
    }
  });

  /**
   * How big the call at the gate is. The dock's own second line, and only this column can measure it:
   * it needs the gated call's arguments (the log) and the live grid the write tools would resolve
   * them against. Read through the tool surface's own `resolveCells`, so the figure is the cells the
   * approval would touch.
   */
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

  /**
   * A gate can be standing before the map has finished opening (a session rehydrated at boot), and a
   * measurement taken against a grid that is not there yet must be retaken rather than remembered as
   * "nothing to say": a snapshot read inside the memo left the dock permanently silent on a state
   * whose count it could have said the moment the map arrived.
   */
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

/**
 * The quiet gate on the sketch analysis. `proposeSketches` reads the whole grid, and the column
 * re-renders once a frame while a stroke or a generate is landing, so analysing on every one of
 * those renders would spend the frame budget on a card that is not even moving. `MAP_QUIET_MS`
 * exists to make that impossible: the analysis waits for the map's version to stand still.
 */
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

    // 20 real commits, each through the executor (the same path a stroke takes: the undo stack
    // grows, `cells-changed` fires, the grid's own version bumps in place) and none given the
    // 400ms the gate asks for: a hand still moving the mouse, not a hand that has stopped.
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

/**
 * The two banner verbs the seam sweep above cannot reach: the `REQUIRED` list only pins that
 * `onRepair` is not undefined, never that pressing it with `try-again` or `export-log`
 * actually reaches anything.
 */
describe('the two banner verbs the seam sweep never drove', () => {
  /** `try-again` files the same order again by reaching straight for the runner: the ladder's own
   *  restart, not a projection change, is what proves this seam. */
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

  /** The pure half: which bytes and what name. The DOM half (the actual browser download) is
   *  untestable under jsdom by construction and stays that way. */
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

/**
 * The room an unanswered plan gate borrows, and the two halves of it that live
 * on this side of the seam: the cap the column asks the frame for, and the rung it stands at.
 *
 * The arithmetic itself is `__tests__/ui/shell/panel-room.test.tsx`, which resolves the css at every
 * judged window. What is under test here is the decision — which state borrows, and whether the
 * borrowed height is room the bar below can paint over anyway.
 */
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

  /** A borrowed height is only room if the bar it reaches into cannot paint over it, so the two move
   *  together: the cap carries the borrow and the column takes the rung a column stands over a bar
   *  at. Both give way again the moment the question is answered. */
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

  /** A tool gate is a summary and a pair of verbs and has always fitted, so it borrows nothing: the
   *  overlap is bought for the one card that could not otherwise be read, not for every question. */
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
