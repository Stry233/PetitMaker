// @vitest-environment jsdom
/**
 * Taking an assistant job back discards every later edit on the open map, so the verbs refuse by
 * themselves: while a job runs, for a record made on another map or on a map it cannot name, and
 * where nothing would come off.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TerrainType, type GridState } from '../../../core/model/types';
import type { CommandExecutor } from '../../../core/commands/command-executor';
import { createDefaultRegistry } from '../../../rules';
import { createExecutor } from '../../../state/executor';
import { useEditorStore } from '../../../state/store';
import { append } from '../../../agent/core/log';
import type { JobView } from '../../../agent/panel';
import { takeBackJob, takeBackTo } from '../../../agent/panel-runtime';
import { panelView, useAgentSession } from '../../../agent/session/store';
import { makeState, paintCmd } from '../../_support/map-state';

/** The open map's id, as `makeState` names its template. */
const HERE = 'test';

let executor: CommandExecutor;

/** Lays one undo entry on the open map. */
function edit(x: number): void {
  executor.execute(paintCmd([{ x, y: 2 }], TerrainType.Mountain, 1));
}

/** Files an order against `mapId` whose job checkpoints the stack as it stands, then edits twice. */
function startJob(mapId: string | undefined): void {
  const log = useAgentSession.getState().log;
  append(log, { kind: 'order', text: 'Raise a ridge', mapContext: '', ...(mapId !== undefined ? { mapId } : {}) });
  append(log, { kind: 'checkpoint', undoIndex: executor.historyDepth(), label: 'job' });
  edit(3);
  append(log, { kind: 'checkpoint', undoIndex: executor.historyDepth(), label: 'write' });
  edit(4);
}

function settleJob(): JobView {
  append(useAgentSession.getState().log, { kind: 'jobEnd', outcome: 'done', undoIndex: executor.historyDepth() });
  return panelView(useAgentSession.getState()).jobs.at(-1)!;
}

beforeEach(() => {
  localStorage.clear();
  useAgentSession.getState().clearSession();
  const map = makeState(20, 20) as GridState;
  executor = createExecutor(map, createDefaultRegistry());
  useEditorStore.setState({ gridState: map, commandExecutor: executor });
  edit(1);
});

afterEach(() => {
  useAgentSession.getState().clearSession();
  useEditorStore.setState({ gridState: null, commandExecutor: null });
});

describe('taking a job back', () => {
  it('[ASST-36] refuses while a job runs and leaves the map alone', () => {
    startJob(HERE);
    const running = panelView(useAgentSession.getState()).current!;
    const depth = executor.historyDepth();
    expect(takeBackJob(running)).toBe(false);
    expect(executor.historyDepth()).toBe(depth);
  });

  it('refuses a settled record while a later job runs', () => {
    startJob(HERE);
    const first = settleJob();
    startJob(HERE);
    const depth = executor.historyDepth();
    expect(takeBackJob(first)).toBe(false);
    expect(executor.historyDepth()).toBe(depth);
  });

  it('[ASST-36] refuses a record made on another map and leaves the map alone', () => {
    startJob('elsewhere');
    const job = settleJob();
    const depth = executor.historyDepth();
    expect(takeBackJob(job)).toBe(false);
    expect(executor.historyDepth()).toBe(depth);
  });

  it('refuses a record that names no map', () => {
    startJob(undefined);
    const job = settleJob();
    const depth = executor.historyDepth();
    expect(takeBackJob(job)).toBe(false);
    expect(executor.historyDepth()).toBe(depth);
  });

  it('rewinds this map to the job\'s first checkpoint, later edits included', () => {
    startJob(HERE);
    const job = settleJob();
    edit(6);
    expect(takeBackJob(job)).toBe(true);
    expect(executor.historyDepth()).toBe(1);
  });

  it('refuses a second press, since nothing is left to take back', () => {
    startJob(HERE);
    const job = settleJob();
    expect(takeBackJob(job)).toBe(true);
    expect(takeBackJob(job)).toBe(false);
    expect(executor.historyDepth()).toBe(1);
  });
});

describe('taking a job back to one of its checkpoints', () => {
  it('rewinds to that checkpoint and keeps the work before it', () => {
    startJob(HERE);
    const job = settleJob();
    expect(takeBackTo(job, 1)).toBe(true);
    expect(executor.historyDepth()).toBe(2);
  });

  it('refuses a checkpoint the job never recorded', () => {
    startJob(HERE);
    const job = settleJob();
    expect(takeBackTo(job, 7)).toBe(false);
    expect(executor.historyDepth()).toBe(3);
  });

  it('refuses while the job runs, and once it holds takes the stage back', () => {
    startJob(HERE);
    const log = useAgentSession.getState().log;
    expect(takeBackTo(panelView(useAgentSession.getState()).current!, 1)).toBe(false);
    expect(executor.historyDepth()).toBe(3);
    append(log, { kind: 'pauseRequested' });
    append(log, { kind: 'paused' });
    expect(takeBackTo(panelView(useAgentSession.getState()).current!, 1)).toBe(true);
    expect(executor.historyDepth()).toBe(2);
  });
});
