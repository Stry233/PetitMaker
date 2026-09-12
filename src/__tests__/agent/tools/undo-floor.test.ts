import { describe, expect, it } from 'vitest';
import type { CommandExecutor } from '../../../core/commands/command-executor';
import { append, createLog } from '../../../agent/core/log';
import { jobUndoFloor } from '../../../agent/core/loop';
import { WIDE_TOOLS } from '../../../agent/exec/executor';
import { executeToolCall, type AgentToolDeps } from '../../../agent/tools';

/** Counts undo/redo calls over a stack of `size` entries, without a map or a rule registry. */
function fakeExecutor(size: number) {
  let depth = size;
  let popped = 0;
  let undoCalls = 0;
  let redoCalls = 0;
  const exec = {
    getUndoStackSize: () => depth,
    undo: () => {
      if (depth === 0) return false;
      depth -= 1;
      popped += 1;
      undoCalls += 1;
      return true;
    },
    canRedo: () => popped > 0,
    redo: () => { popped -= 1; depth += 1; redoCalls += 1; },
  };
  return {
    exec: exec as unknown as CommandExecutor,
    undoCalls: () => undoCalls,
    redoCalls: () => redoCalls,
  };
}

function makeDeps(over: { exec: CommandExecutor; undoFloor?: () => number }): AgentToolDeps {
  return {
    getState: () => ({}) as never,
    getExecutor: () => over.exec,
    getRegion: () => [],
    ...(over.undoFloor ? { undoFloor: over.undoFloor } : {}),
  };
}

const call = (name: string, input: Record<string, unknown>) => ({ id: 'c1', name, input });

describe('agent undo floor', () => {
  it('undoes only the entries the job itself pushed', async () => {
    const { exec, undoCalls } = fakeExecutor(5);
    const deps = makeDeps({ exec, undoFloor: () => 3 });
    const r = await executeToolCall(call('undo', { steps: 10 }), deps);
    expect(undoCalls()).toBe(2);
    expect(r.isError).toBe(false);
    expect(r.content).toContain('2');
  });

  it('reports zero rather than an error when nothing sits above the floor', async () => {
    const { exec, undoCalls } = fakeExecutor(3);
    const deps = makeDeps({ exec, undoFloor: () => 3 });
    const r = await executeToolCall(call('undo', { steps: 1 }), deps);
    expect(undoCalls()).toBe(0);
    expect(r.isError).toBe(false);
    expect(r.content).toContain('0');
  });

  it('undoes the whole stack when no floor is wired', async () => {
    const { exec, undoCalls } = fakeExecutor(2);
    await executeToolCall(call('undo', { steps: 5 }), makeDeps({ exec }));
    expect(undoCalls()).toBe(2);
  });

  it('redo replays what undo popped', async () => {
    const { exec, redoCalls } = fakeExecutor(5);
    const deps = makeDeps({ exec, undoFloor: () => 3 });
    await executeToolCall(call('undo', { steps: 2 }), deps);
    const r = await executeToolCall(call('redo', { steps: 2 }), deps);
    expect(redoCalls()).toBe(2);
    expect(r.isError).toBe(false);
  });

  it('gates undo and redo as wide tools', () => {
    expect(WIDE_TOOLS.has('undo')).toBe(true);
    expect(WIDE_TOOLS.has('redo')).toBe(true);
  });
});

describe('jobUndoFloor', () => {
  it('is the undo index the running job checkpointed', () => {
    const log = createLog();
    append(log, { kind: 'order', text: 'build a village', mapContext: '' });
    expect(jobUndoFloor(log)).toBe(0);
    append(log, { kind: 'checkpoint', undoIndex: 4, label: 'job' });
    expect(jobUndoFloor(log)).toBe(4);
  });

  it('falls back to zero for a later job that has not written yet', () => {
    const log = createLog();
    append(log, { kind: 'order', text: 'first', mapContext: '' });
    append(log, { kind: 'checkpoint', undoIndex: 4, label: 'job' });
    append(log, { kind: 'jobEnd', outcome: 'done' });
    append(log, { kind: 'order', text: 'second', mapContext: '' });
    expect(jobUndoFloor(log)).toBe(0);
  });
});
