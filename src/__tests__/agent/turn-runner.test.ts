/**
 * Turn runner (spec §5): the loop's events become Site Log entries — one
 * ticket per planless burst with an ambient checkpoint, blueprint lifecycle
 * with the draft gate and stage bookkeeping, "May I?" gating in strict
 * oversight, friendly revert copy, and mid-run steering.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runSiteLogTurn, answerGate, answerBlueprintGate, queueSteering, proseTail, type RunnerCtx } from '../../agent/turn-runner';
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
    getState: () => ({}) ,
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
    if (call.name === 'update_plan') return { toolCallId: call.id, isError: false, content: 'Plan updated.' };
    if ((call.input as { fail?: boolean } | undefined)?.fail) {
      return { toolCallId: call.id, isError: true, content: 'REVERTED: rolled back.\n[V-WTR-02] containment broken' };
    }
    undoStack++; // every successful write lands one undo entry
    return { toolCallId: call.id, isError: false, content: 'ok' };
  };
  return { deps, execToolImpl, executed, undoDepth: () => undoStack };
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

describe('planless burst', () => {
  it('groups consecutive writes into one undoable ticket with a checkpoint', async () => {
    const w = fakeWorld();
    const adapter = fakeAdapter([
      { text: 'On it.', toolCalls: [
        { id: '1', name: 'paint_terrain', input: { terrain: 'water', elevation: 0 } },
        { id: '2', name: 'scatter_objects', input: { catalogIds: ['flora-reed'], count: 6 } },
      ] },
      { text: 'Done.', toolCalls: [] },
    ]);
    await runSiteLogTurn(ctx({ adapter, deps: w.deps, execToolImpl: w.execToolImpl }));
    const tickets = S().log.filter((e) => e.kind === 'ticket');
    expect(tickets).toHaveLength(1);
    const tk = tickets[0]!;
    if (tk.kind !== 'ticket') throw new Error('bad kind');
    expect(tk.rail.map((x) => x.s)).toEqual(['ok', 'ok']);
    expect(tk.working).toBe(false);
    expect(tk.undoable).toBe(true);
    expect(tk.checkpoint?.undoIndex).toBe(0);
    expect(S().vitals.water).toBe(1);
    expect(S().vitals.flower).toBe(6);
    // the opening narration stays a note; the CLOSING prose folds into the
    // ticket as its collapsible summary (no trailing note)
    expect(S().log.filter((e) => e.kind === 'note').map((e) => e.kind === 'note' && e.text)).toEqual(['On it.']);
    expect(tk.summary).toBe('Done.');
  });

  it('reverted writes tick amber with friendly copy, never the raw prefix', async () => {
    const w = fakeWorld();
    const adapter = fakeAdapter([
      { text: '', toolCalls: [{ id: '1', name: 'paint_terrain', input: { terrain: 'water', fail: true } }] },
      { text: 'adjusting', toolCalls: [] },
    ]);
    await runSiteLogTurn(ctx({ adapter, deps: w.deps, execToolImpl: w.execToolImpl }));
    const tk = S().log.find((e) => e.kind === 'ticket');
    if (!tk || tk.kind !== 'ticket') throw new Error('missing ticket');
    expect(tk.rail[0]!.s).toBe('revert');
    expect(tk.revertnote).toBeTruthy();
    expect(tk.revertnote).not.toContain('REVERTED');
    // rule tags stay model-facing; the card names the rule's reason in the user's language
    expect(tk.revertnote).not.toContain('V-WTR-02');
    expect(tk.revertnote).toBe(translateFor('en', 'agent2.rv_undid', {
      reason: translateFor('en', 'agent2.rv_water'),
    }));
  });
});

describe('plan completion discipline', () => {
  const plan = (statuses: string[]) => ({
    id: 'p', name: 'update_plan',
    input: { stages: statuses.map((st, i) => ({ title: `Stage ${i + 1}`, status: st })) },
  });

  it('a sign-off with unfinished stages is nudged back to work; finishing lands done', async () => {
    const w = fakeWorld();
    const adapter = fakeAdapter([
      { text: 'Planning.', toolCalls: [plan(['active', 'pending'])] },
      { text: 'Stage one done.', toolCalls: [plan(['done', 'active'])] },
      { text: 'All wrapped up!', toolCalls: [] },                    // premature sign-off
      { text: 'Finishing properly.', toolCalls: [plan(['done', 'done'])] },
      { text: 'Done for real.', toolCalls: [] },
    ]);
    const history = await runSiteLogTurn(ctx({ adapter, deps: w.deps, execToolImpl: w.execToolImpl, oversight: 'yolo' }));
    const bp = S().log.find((e) => e.kind === 'bp');
    if (!bp || bp.kind !== 'bp') throw new Error('missing bp');
    expect(bp.done).toBe(true);
    expect(bp.paused).toBe(false);
    expect(history.some((m) => m.role === 'user' && m.content.includes('unfinished'))).toBe(true);
  });

  it('mid-run narration attaches to the active stage, not a loose note', async () => {
    const w = fakeWorld();
    const plan = (statuses: string[]) => ({
      id: 'p', name: 'update_plan',
      input: { stages: statuses.map((st, i) => ({ title: `Stage ${i + 1}`, status: st })) },
    });
    const adapter = fakeAdapter([
      { text: 'Planning.', toolCalls: [plan(['active', 'pending'])] },
      { text: 'Shaping the west hill gently.', toolCalls: [
        { id: 'w1', name: 'paint_terrain', input: { terrain: 'mountain', elevation: 1 } },
      ] },
      { text: 'Done.', toolCalls: [plan(['done', 'done'])] },
      { text: 'All finished.', toolCalls: [] },
    ]);
    await runSiteLogTurn(ctx({ adapter, deps: w.deps, execToolImpl: w.execToolImpl, oversight: 'yolo' }));
    const bp = S().log.find((e) => e.kind === 'bp');
    if (!bp || bp.kind !== 'bp') throw new Error('missing bp');
    // the "Shaping the west hill" narration landed on stage 0's prose...
    expect(bp.stageProse?.[0]).toContain('west hill');
    // ...and did NOT spawn a standalone note entry for it
    expect(S().log.some((e) => e.kind === 'note' && e.text.includes('west hill'))).toBe(false);
  });

  it('a model that ignores the nudges leaves an honestly PAUSED blueprint, never a live one', async () => {
    const w = fakeWorld();
    const adapter = fakeAdapter([
      { text: 'Planning.', toolCalls: [plan(['active', 'pending'])] },
      { text: 'Giving up silently.', toolCalls: [] },               // repeats for every nudge
    ]);
    await runSiteLogTurn(ctx({ adapter, deps: w.deps, execToolImpl: w.execToolImpl, oversight: 'yolo' }));
    const bp = S().log.find((e) => e.kind === 'bp');
    if (!bp || bp.kind !== 'bp') throw new Error('missing bp');
    expect(bp.done).toBe(false);
    expect(bp.paused).toBe(true);
  });
});

describe('next-prompt suggestion (model-authored via suggest_reply)', () => {
  it("the model's suggest_reply call becomes the composer ghost at turn end", async () => {
    const w = fakeWorld();
    const adapter = fakeAdapter([
      { text: 'Done. Want a bridge over it?', toolCalls: [
        { id: '1', name: 'suggest_reply', input: { reply: 'Yes, add the bridge' } },
      ] },
      { text: 'ok', toolCalls: [] },
    ]);
    await runSiteLogTurn(ctx({ adapter, deps: w.deps, execToolImpl: w.execToolImpl }));
    expect(S().suggestion).toBe('Yes, add the bridge');
  });

  it('a working turn gets ONE silent sign-off check; the reply-only round ends the turn', async () => {
    const w = fakeWorld();
    const adapter = fakeAdapter([
      { text: '', toolCalls: [{ id: '1', name: 'paint_terrain', input: { terrain: 'water' } }] },
      { text: 'Pond done. Want reeds around it?', toolCalls: [] },   // sign-off, no suggestion yet
      { text: '', toolCalls: [{ id: 's', name: 'suggest_reply', input: { reply: 'Yes, add reeds' } }] },
      { text: 'SHOULD NEVER BE REQUESTED', toolCalls: [] },
    ]);
    await runSiteLogTurn(ctx({ adapter, deps: w.deps, execToolImpl: w.execToolImpl }));
    expect(S().suggestion).toBe('Yes, add reeds');
    // the suggest_reply-only round is terminal: no further assistant message
    expect(S().log.some((e) => e.kind === 'note' && e.text.includes('SHOULD NEVER'))).toBe(false);
  });

  it('a SKIP answer to the sign-off check never reaches the log', async () => {
    const w = fakeWorld();
    const adapter = fakeAdapter([
      { text: '', toolCalls: [{ id: '1', name: 'paint_terrain', input: { terrain: 'water' } }] },
      { text: 'Pond done.', toolCalls: [] },
      { text: 'SKIP', toolCalls: [] },
    ]);
    await runSiteLogTurn(ctx({ adapter, deps: w.deps, execToolImpl: w.execToolImpl }));
    expect(S().suggestion).toBeNull();
    expect(S().log.some((e) => e.kind === 'note' && e.text.includes('SKIP'))).toBe(false);
  });

  it('no call = no suggestion; a fresh turn clears the previous one', async () => {
    useAgentSession.getState().setSuggestion('Stale');
    const w = fakeWorld();
    const adapter = fakeAdapter([{ text: 'All set.', toolCalls: [] }]);
    await runSiteLogTurn(ctx({ adapter, deps: w.deps, execToolImpl: w.execToolImpl }));
    expect(S().suggestion).toBeNull();
  });
});

describe('proseTail', () => {
  it('returns the last sentence, tidied and capped', () => {
    expect(proseTail('I looked around. Now I will raise a gentle hill by the pond.')).toBe(
      'Now I will raise a gentle hill by the pond.',
    );
    expect(proseTail('   ')).toBeNull();
    expect(proseTail(`Start. ${'x'.repeat(200)}`)!.length).toBeLessThanOrEqual(140);
  });
});

describe('oversight gates', () => {
  it('strict mode raises May I? quoting the model narration; Allow proceeds', async () => {
    const w = fakeWorld();
    const adapter = fakeAdapter([
      { text: 'Let me plant a great oak by the gate.', toolCalls: [{ id: '1', name: 'place_object', input: { catalogId: 'tree-oak', x: 1, y: 2 } }] },
      { text: 'done', toolCalls: [] },
    ]);
    const run = runSiteLogTurn(ctx({ adapter, deps: w.deps, execToolImpl: w.execToolImpl, oversight: 'strict' }));
    await waitFor(() => S().gate !== null);
    // NATURAL language: the model's own sentence, not the parameter dump
    expect(S().gate!.sub).toBe('Let me plant a great oak by the gate.');
    answerGate('allow');
    await run;
    expect(w.executed).toContain('place_object');
    expect(S().vitals.tree).toBe(1);
  });

  it('a silent model falls back to the human title only (no coordinates)', async () => {
    const w = fakeWorld();
    const adapter = fakeAdapter([
      { text: '', toolCalls: [{ id: '1', name: 'sculpt_terrace', input: { cx: 42, cy: 36, radius: 12, tiers: 3 } }] },
      { text: 'done', toolCalls: [] },
    ]);
    const run = runSiteLogTurn(ctx({ adapter, deps: w.deps, execToolImpl: w.execToolImpl, oversight: 'strict' }));
    await waitFor(() => S().gate !== null);
    expect(S().gate!.sub).toBe('Terraced hill');
    expect(S().gate!.sub).not.toContain('(42');
    answerGate('allow');
    await run;
  });

  it('Skip feeds the denial to the model and ticks the rail amber', async () => {
    const w = fakeWorld();
    let fedBack = '';
    const adapter: ProviderAdapter = {
      listModels: async () => [],
      stream: async (req) => {
        const last = req.messages[req.messages.length - 1];
        if (last && last.role === 'tool') {
          fedBack = last.results[0]!.content;
          return { text: 'ok', toolCalls: [] };
        }
        return { text: '', toolCalls: [{ id: '1', name: 'clear_area', input: { rect: { x1: 0, y1: 0, x2: 5, y2: 5 } } }] };
      },
    };
    const run = runSiteLogTurn(ctx({ adapter, deps: w.deps, execToolImpl: w.execToolImpl, oversight: 'checkpoint' }));
    await waitFor(() => S().gate !== null);
    answerGate('deny');
    await run;
    expect(w.executed).not.toContain('clear_area');
    expect(fedBack).toContain('denied');
    const tk = S().log.find((e) => e.kind === 'ticket');
    expect(tk && tk.kind === 'ticket' && tk.rail[0]!.s).toBe('revert');
  });
});

describe('blueprint lifecycle', () => {
  const planCall = (stages: [string, 'pending' | 'active' | 'done'][], id: string): ToolCall => ({
    id, name: 'update_plan', input: { stages: stages.map(([title, status]) => ({ title, status })) },
  });

  it('drafts on the first plan, waits for the go, then runs stages to done', async () => {
    const w = fakeWorld();
    const adapter = fakeAdapter([
      { text: '', toolCalls: [planCall([['Shape', 'active'], ['Dress', 'pending']], 'p1')] },
      { text: '', toolCalls: [{ id: 'w1', name: 'sculpt_terrace', input: { cx: 3, cy: 3, baseRadius: 4 } }] },
      { text: '', toolCalls: [planCall([['Shape', 'done'], ['Dress', 'active']], 'p2')] },
      { text: '', toolCalls: [planCall([['Shape', 'done'], ['Dress', 'done']], 'p3')] },
      { text: 'all done', toolCalls: [] },
    ]);
    const run = runSiteLogTurn(ctx({ adapter, deps: w.deps, execToolImpl: w.execToolImpl, userText: 'a cozy village' }));
    await waitFor(() => S().log.some((e) => e.kind === 'bp' && e.draft));
    expect(S().running).toBe(false);           // waiting on the user's go
    answerBlueprintGate(true);
    await run;
    const bp = S().log.find((e) => e.kind === 'bp');
    if (!bp || bp.kind !== 'bp') throw new Error('missing bp');
    expect(bp.draft).toBe(false);
    expect(bp.done).toBe(true);
    expect(bp.doneCount).toBe(2);
    expect(bp.notes[0]).toBeTruthy();
    expect(bp.steps).toBeGreaterThan(0);
    expect(S().log.filter((e) => e.kind === 'ticket')).toHaveLength(0); // writes rode the blueprint
  });

  it('"Not now" pauses the draft and tells the model to stop', async () => {
    const w = fakeWorld();
    let fedBack = '';
    const adapter: ProviderAdapter = {
      listModels: async () => [],
      stream: async (req) => {
        const last = req.messages[req.messages.length - 1];
        if (last && last.role === 'tool') {
          fedBack = last.results[0]!.content;
          return { text: 'ok, asking', toolCalls: [] };
        }
        return { text: '', toolCalls: [{ id: 'p', name: 'update_plan', input: { stages: [{ title: 'A', status: 'active' }] } }] };
      },
    };
    const run = runSiteLogTurn(ctx({ adapter, deps: w.deps, execToolImpl: w.execToolImpl }));
    await waitFor(() => S().log.some((e) => e.kind === 'bp' && e.draft));
    answerBlueprintGate(false);
    await run;
    const bp = S().log.find((e) => e.kind === 'bp');
    expect(bp && bp.kind === 'bp' && bp.paused).toBe(true);
    expect(fedBack).toContain('set this plan aside');
  });
});

describe('steering', () => {
  it('a queued note reaches the model appended to the next tool result', async () => {
    const w = fakeWorld();
    let fedBack = '';
    const adapter: ProviderAdapter = {
      listModels: async () => [],
      stream: async (req) => {
        const last = req.messages[req.messages.length - 1];
        if (last && last.role === 'tool') {
          fedBack = last.results[0]!.content;
          return { text: 'noted', toolCalls: [] };
        }
        if (last && last.role === 'user' && last.content.startsWith('(system)')) {
          return { text: 'SKIP', toolCalls: [] }; // the sign-off suggestion check
        }
        return { text: '', toolCalls: [{ id: '1', name: 'build_road', input: { catalogId: 'road-dirt' } }] };
      },
    };
    queueSteering('more flowers please');
    await runSiteLogTurn(ctx({ adapter, deps: w.deps, execToolImpl: w.execToolImpl }));
    expect(fedBack).toContain('(user, mid-run) more flowers please');
  });
});
