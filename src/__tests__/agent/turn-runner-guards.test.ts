/**
 * Concurrency and oversight guarantees of the Site Log turn runner: only one
 * run at a time (the gate windows where `running` is false are still inside
 * the run), the oversight gate covers delegated helpers, a user denial never
 * wears revert copy, and the sign-off mute covers exactly one message.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  runSiteLogTurn, answerGate, answerBlueprintGate, isRunActive, type RunnerCtx,
} from '../../agent/turn-runner';
import { useAgentSession } from '../../agent/session';
import type { AgentToolDeps } from '../../agent/tools';
import type { AssistantTurn, ProviderAdapter, ToolCall, ToolResult } from '../../agent/types';
import { translateFor } from '../../i18n/context';

const S = () => useAgentSession.getState();
// The real English table: these tests assert the copy a user reads, so a key that
// no locale defines must not pass as if it were a sentence.
const t = (k: string, p?: Record<string, string | number>) => translateFor('en', k, p);

function fakeAdapter(turns: AssistantTurn[]): ProviderAdapter {
  let i = 0;
  return {
    listModels: async () => [],
    stream: async (_req, cb) => {
      const turn = turns[Math.min(i++, turns.length - 1)]!;
      if (turn.text) cb.onTextDelta(turn.text);
      for (const tc of turn.toolCalls) cb.onToolCallStart?.(tc.name);
      return turn;
    },
  };
}

function fakeWorld() {
  let undoStack = 0;
  const deps = {
    getState: () => ({}),
    getExecutor: () => ({
      getUndoStackSize: () => undoStack,
      undo: () => { if (undoStack > 0) { undoStack--; return true; } return false; },
      noteAnalysisOnly: () => {},
    }),
    getRegion: () => [],
  } as unknown as AgentToolDeps;
  const executed: string[] = [];
  const execToolImpl = async (call: ToolCall): Promise<ToolResult> => {
    executed.push(call.name);
    undoStack++;
    return { toolCallId: call.id, isError: false, content: 'ok' };
  };
  return { deps, execToolImpl, executed };
}

function ctx(partial: Partial<RunnerCtx>): RunnerCtx {
  return {
    model: 'm', system: 'S', tools: [], history: [], userText: 'do it', mapContext: 'CTX',
    oversight: 'checkpoint', signal: new AbortController().signal, t,
    ...partial,
  } as RunnerCtx;
}

const waitFor = async (cond: () => boolean) => {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(cond()).toBe(true);
};

beforeEach(() => {
  localStorage.clear();
  S().clearLog();
  useAgentSession.setState({ running: false, thinking: false, gate: null, vitals: { water: 0, tree: 0, build: 0, flower: 0 } });
});

describe('one run at a time', () => {
  it('a run parked on the blueprint gate still counts as active; a second run is refused; Go still works', async () => {
    const w = fakeWorld();
    const adapter = fakeAdapter([
      { text: 'Planning.', toolCalls: [{ id: '1', name: 'update_plan', input: { stages: [{ title: 'A', status: 'active' }] } }] },
      { text: 'Building.', toolCalls: [{ id: '2', name: 'paint_terrain', input: {} }] },
      { text: 'Done.', toolCalls: [] },
    ]);
    const first = runSiteLogTurn(ctx({ adapter, deps: w.deps, execToolImpl: w.execToolImpl }));

    await waitFor(() => S().log.some((e) => e.kind === 'bp' && e.draft) && !S().running);
    expect(isRunActive()).toBe(true);

    await expect(
      runSiteLogTurn(ctx({ adapter, deps: w.deps, execToolImpl: w.execToolImpl })),
    ).rejects.toThrow(/already active/);

    answerBlueprintGate(true);
    await first; // the parked run resumes and completes
    expect(isRunActive()).toBe(false);
    expect(w.executed).toContain('paint_terrain');
  });
});

describe('oversight covers delegation', () => {
  it('strict mode gates delegate_task before the helper runs', async () => {
    const w = fakeWorld();
    let delegated = 0;
    const adapter = fakeAdapter([
      { text: 'Handing this off.', toolCalls: [{ id: '1', name: 'delegate_task', input: { task: 'plant a forest' } }] },
      { text: 'Done.', toolCalls: [] },
    ]);
    const run = runSiteLogTurn(ctx({
      adapter, deps: w.deps, execToolImpl: w.execToolImpl, oversight: 'strict',
      runDelegate: async () => { delegated++; return 'helper report'; },
    }));

    await waitFor(() => S().gate !== null);
    expect(delegated).toBe(0); // nothing ran before the user's answer
    expect(S().gate?.sub).toContain('plant a forest');

    answerGate('deny');
    await run;
    expect(delegated).toBe(0); // denial means the helper never runs
  });

  it('an allowed delegate runs the helper', async () => {
    const w = fakeWorld();
    let delegated = 0;
    const adapter = fakeAdapter([
      { text: 'Handing this off.', toolCalls: [{ id: '1', name: 'delegate_task', input: { task: 'plant a forest' } }] },
      { text: 'Done.', toolCalls: [] },
    ]);
    const run = runSiteLogTurn(ctx({
      adapter, deps: w.deps, execToolImpl: w.execToolImpl, oversight: 'strict',
      runDelegate: async () => { delegated++; return 'helper report'; },
    }));
    await waitFor(() => S().gate !== null);
    answerGate('allow');
    await run;
    expect(delegated).toBe(1);
  });
});

describe('denial copy', () => {
  it('a user-denied write reads as skipped, not as an undo', async () => {
    const w = fakeWorld();
    const adapter = fakeAdapter([
      { text: 'Painting.', toolCalls: [{ id: '1', name: 'paint_terrain', input: {} }] },
      { text: 'Understood.', toolCalls: [] },
    ]);
    const run = runSiteLogTurn(ctx({ adapter, deps: w.deps, execToolImpl: w.execToolImpl, oversight: 'strict' }));
    await waitFor(() => S().gate !== null);
    answerGate('deny');
    await run;
    const ticket = S().log.find((e) => e.kind === 'ticket');
    expect(ticket?.kind).toBe('ticket');
    if (ticket?.kind === 'ticket') {
      expect(ticket.revertnote).toBe('Skipped at your request.');
      expect(ticket.revertnote).not.toContain('Undid');
    }
  });
});

describe('sign-off mute', () => {
  it('mutes exactly one message: a model that keeps working stays audible', async () => {
    const w = fakeWorld();
    const adapter = fakeAdapter([
      { text: 'Building.', toolCalls: [{ id: '1', name: 'paint_terrain', input: {} }] },
      { text: 'Done here.', toolCalls: [] },          // sign-off attempt → suggest nudge (mute on)
      { text: 'Actually, one more thing.', toolCalls: [{ id: '2', name: 'paint_terrain', input: {} }] }, // the one muted message
      { text: 'All wrapped up.', toolCalls: [] },     // must be audible again
    ]);
    await runSiteLogTurn(ctx({ adapter, deps: w.deps, execToolImpl: w.execToolImpl, oversight: 'yolo' }));
    const texts = S().log
      .map((e) => (e.kind === 'note' ? e.text : e.kind === 'ticket' ? (e.summary ?? '') : ''))
      .join('\n');
    expect(texts).not.toContain('Actually, one more thing.');
    expect(texts).toContain('All wrapped up.');
  });
});
