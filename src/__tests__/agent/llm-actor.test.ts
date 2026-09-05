/**
 * Drives one scripted job through the real loop, tool surface, map, and rule registry. Its realistic
 * model-authored strings exercise the same six UI copy contracts as the opt-in gateway test, while
 * remaining deterministic in CI. The lower-level loop suite covers control flow separately.
 */
import { describe, expect, it } from 'vitest';

import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { TerrainType, type EditorEvents } from '../../core/model/types';
import { createDefaultRegistry } from '../../rules';
import { roadLookup } from '../../state/object-index';
import { createScriptedAdapter, type ScriptedTurn } from '../../agent/eval/scripted-adapter';
import { append, createLog, eventsOf } from '../../agent/core/log';
import { runJob, type LoopDeps } from '../../agent/core/loop';
import { deriveView } from '../../agent/core/project-view';
import { createExecutor, wireSchemas } from '../../agent/exec/executor';
import { buildSystemPrompt } from '../../agent/system-prompt';
import type { AgentToolDeps } from '../../agent/tools';
import { makeState } from '../rules/_helpers';
import { checkContracts, reportContracts, CONTRACTS } from './_llm-contracts';

/** The order the job is given. Small on purpose: what is under test is the SHAPE of what comes back,
 *  and a large build only buys more of the same strings. */
export const ORDER =
  'Terrace the little rise at the north end of the plaza and put a lookout on top of it.';

/** A live map with the plaza's own ground under it, as the panel always stands over one. */
function liveMap() {
  const state = makeState(24, 24);
  const bus = new EventBus<EditorEvents>();
  const executor = new CommandExecutor(state, bus, createDefaultRegistry(), roadLookup(state));
  const deps: AgentToolDeps = {
    getState: () => state,
    getExecutor: () => executor,
    getRegion: () => [],
  };
  return { state, executor, deps };
}

function toolTurn(
  text: string,
  calls: { callId: string; name: string; args: Record<string, unknown> }[],
): ScriptedTurn {
  return {
    events: [
      ...(text ? [{ t: 'text' as const, delta: text }] : []),
      {
        t: 'done', stop: 'tool-calls',
        final: calls.map((c) => ({ callId: c.callId, name: c.name, args: c.args, rawArgs: JSON.stringify(c.args) })),
      },
    ],
  };
}

/**
 * THE ACTOR'S SCRIPT, written as a model that has read its own instructions would answer.
 *
 * Six turns: read the ground, file a plan, raise the terrace, measure, place the lookout, and close
 * with a summary plus the one obvious reply. Every string is at the length its contract states — the
 * says lines put their point in the first sentence, the stage labels fit a rail row, the suggestion
 * fits the composer's field, and the summary is the two sentences a receipt is drawn for.
 */
function script(): ScriptedTurn[] {
  return [
    toolTurn(
      'Reading the ground north of the plaza before I cut anything.',
      [{ callId: 'a1', name: 'inspect_region', args: { x1: 6, y1: 2, x2: 16, y2: 10 } }],
    ),
    toolTurn(
      'Flat all the way. Three stages: raise the terrace, check it, then stand the lookout.',
      [{
        callId: 'a2', name: 'update_plan',
        args: {
          stages: [
            { label: 'Raise the terrace to two layers' },
            { label: 'Measure the shape it left' },
            { label: 'Stand the lookout on the top step', checkpoint: true },
          ],
        },
      }],
    ),
    toolTurn(
      'Cutting the two steps now, wide side to the plaza.',
      [{
        callId: 'a3', name: 'paint_terrain',
        args: { rect: { x1: 8, y1: 3, x2: 18, y2: 10 }, terrain: 'mountain', elevation: 2 },
      }],
    ),
    toolTurn(
      'Terrace stands. Measuring before I put anything on it.',
      [{ callId: 'a4', name: 'evaluate_map', args: {} }],
    ),
    toolTurn(
      'Room for the lookout on the top step, back from the edge.',
      [{ callId: 'a5', name: 'place_object', args: { catalogId: 'building-myhouse', x: 10, y: 5 } }],
    ),
    toolTurn(
      'The rise is two terraces now, with the lookout on the upper step facing the plaza. '
      + 'The lower step is left clear so a path can come up to it later.',
      [{ callId: 'a6', name: 'suggest_reply', args: { reply: 'Yes, run a path up to it' } }],
    ),
  ];
}

function deps(over: Partial<LoopDeps> & { adapter: LoopDeps['adapter']; executor: LoopDeps['executor'] }): LoopDeps {
  return {
    model: 'actor',
    system: buildSystemPrompt(createDefaultRegistry()),
    tools: wireSchemas(),
    oversight: 'yolo',
    sameModel: true,
    budgetTokens: 120_000,
    signal: new AbortController().signal,
    undoStackSize: () => 0,
    ...over,
  };
}

describe('one small job, driven by a model-shaped actor through the real loop', () => {
  it('runs to a settled receipt, and every string it wrote wears its designed shape', async () => {
    const map = liveMap();
    const log = createLog();
    append(log, { kind: 'order', text: ORDER, mapContext: 'a 24x24 template, no region marked' });
    append(log, { kind: 'checkpoint', undoIndex: 0, label: 'job' });

    const outcome = await runJob(log, deps({
      adapter: createScriptedAdapter(script()),
      executor: createExecutor(map.deps),
    }));

    expect(outcome).toBe('done');

    // THE WORK REACHED THE MAP, through the real rules: without this the contract check would be
    // reading a log of refusals and passing.
    expect(map.state.cells[5]![10]!.terrain).toMatchObject({ type: TerrainType.Mountain, elevation: 2 });
    const view = deriveView(log);
    expect(view.vitals.cells).toBeGreaterThan(0);
    expect(view.vitals.objects).toBeGreaterThan(0);
    expect(view.jobs[0]!.plan!.stages.length).toBe(3);

    const findings = checkContracts(log);
    expect(findings, reportContracts(findings)).toEqual([]);
  });

  /**
   * AND THE CHECKER HAS TEETH. A test that only ever sees compliant output cannot tell a working
   * assertion from an empty one, so the same job is run again with the model writing each string the
   * way the contracts say it must not: a says line whose point arrives on line three, a stage label
   * too long for its row, a suggestion past the composer's clip, and a summary of six sentences.
   */
  it('names every contract a model-shaped string can break', async () => {
    const map = liveMap();
    const log = createLog();
    append(log, { kind: 'order', text: ORDER, mapContext: 'a 24x24 template, no region marked' });

    const overrun = [
      toolTurn(
        'Before I begin I should explain that the ground north of the plaza has been left untouched '
        + 'since the island was first laid out, which is why I am going to look at it first. '
        + 'Reading it now.',
        [{
          callId: 'b1', name: 'update_plan',
          args: {
            stages: [{ label: 'Raise the terrace at the north end of the plaza to two full layers of mountain' }],
          },
        }],
      ),
      toolTurn(
        'Done. It is finished. All of it. Every part. Nothing remains. The rise is terraced.',
        [{ callId: 'b2', name: 'suggest_reply', args: { reply: 'Yes please, and run a path up to the lookout as well' } }],
      ),
      // The zero-write close above earns the loop's delivery nudge, and this second close is the
      // one that settles: it rambles past the summary contract the same way, so the finding the
      // test is about still stands on the summary the receipt actually shows.
      toolTurn(
        'Done. It is finished. All of it. Every part. Nothing remains. The rise is terraced.',
        [],
      ),
    ];

    await runJob(log, deps({
      adapter: createScriptedAdapter(overrun),
      executor: createExecutor(map.deps),
    }));

    const findings = checkContracts(log);
    const named = new Set(findings.map((f) => f.contract));
    expect([...named].sort()).toEqual(['1 says line', '2 summary', '3 stage label', '5 suggest_reply']);
    // And the measurement is the contract's own number rather than a restatement of the string.
    expect(findings.find((f) => f.contract === '5 suggest_reply')!.measured)
      .toContain(String(CONTRACTS.suggestLatin));
  });

  /** A CJK suggestion spends about twice the room a Latin one does at the same box, which is why
   *  the contract carries a CJK budget of its own: the same tool description asks for the user's
   *  own language. */
  it('measures a CJK suggestion against the CJK budget', async () => {
    const map = liveMap();
    const log = createLog();
    append(log, { kind: 'order', text: '在广场北边修一座梯田，顶上放一个瞭望台。', mapContext: '24x24，未选区域' });

    await runJob(log, deps({
      adapter: createScriptedAdapter([
        toolTurn('先看一眼广场北边的地形。', [{ callId: 'c1', name: 'inspect_region', args: { x1: 6, y1: 2, x2: 12, y2: 8 } }]),
        toolTurn('梯田已经修好，瞭望台放在了上层。', [{ callId: 'c2', name: 'suggest_reply', args: { reply: '好的，再从广场修一条路上去' } }]),
      ]),
      executor: createExecutor(map.deps),
    }));

    const findings = checkContracts(log);
    const suggestion = findings.find((f) => f.contract === '5 suggest_reply');
    expect(suggestion, reportContracts(findings)).toBeUndefined();

    // One character over the CJK budget IS a finding, where the same count in Latin is not.
    const long = createLog();
    append(long, { kind: 'order', text: '再来一次', mapContext: '24x24' });
    append(long, {
      kind: 'assistant', stop: 'tool-calls',
      parts: [{
        kind: 'tool', callId: 'c3', name: 'suggest_reply', argsDone: true,
        input: { reply: '好的，请再从广场那边修一条路上去，谢谢' },
      }],
    });
    const over = checkContracts(long).find((f) => f.contract === '5 suggest_reply');
    expect(over?.measured).toContain(String(CONTRACTS.suggestCjk));
    expect(over?.measured).toContain('CJK');
  });
});

/** The log's own event count, for a caller that wants to see the actor did something. */
export function turnsIn(log: ReturnType<typeof createLog>): number {
  return eventsOf(log).filter((e) => e.kind === 'assistant').length;
}
