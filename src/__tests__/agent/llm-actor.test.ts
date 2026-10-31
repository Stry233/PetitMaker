/**
 * Drives one scripted job through the real loop, tool surface, map and rule registry, checking its
 * model-shaped strings against the UI copy contracts the opt-in gateway test checks, deterministically.
 */
import { describe, expect, it } from 'vitest';

import { EventBus } from '../../core/commands/event-bus';
import { TerrainType } from '../../core/model/types';
import { type EditorEvents } from '../../state/editing/events';
import { createDefaultRegistry } from '../../rules';
import { createScriptedAdapter, type ScriptedTurn } from '../_support/agent/scripted-adapter';
import { append, createLog, eventsOf } from '../../agent/core/log';
import { runJob, type LoopDeps } from '../../agent/core/loop';
import { deriveView } from '../../agent/core/project-view';
import { createExecutor } from '../../agent/exec/executor';
import { wireSchemas } from '../../agent/tools';
import { buildSystemPrompt } from '../../agent/prompts';
import type { AgentToolDeps } from '../../agent/tools';
import { makeState } from '../_support/map-state';
import { checkContracts, reportContracts, CONTRACTS } from './_llm-contracts';
import { createExecutor as createCommandExecutor } from '../../state/executor';

/** Small on purpose: the shape of the returned strings is under test, not the size of the build. */
export const ORDER =
  'Terrace the little rise at the north end of the plaza and put a lookout on top of it.';

function liveMap() {
  const state = makeState(24, 24);
  const bus = new EventBus<EditorEvents>();
  const executor = createCommandExecutor(state, createDefaultRegistry(), bus);
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

/** Six turns as a compliant model would write them: every string within its contract (point in the
 *  first sentence, short stage labels and suggestion, a two-sentence summary). */
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
      [{ callId: 'a4', name: 'evaluate_map', args: {} }, { callId: 'stage-2', name: 'update_plan', args: { completedStages: 2 } }],
    ),
    toolTurn(
      'Room for the lookout on the top step, back from the edge.',
      [{ callId: 'a5', name: 'place_object', args: { catalogId: 'building-myhouse', x: 10, y: 5 } }],
    ),
    toolTurn(
      'The rise is two terraces now, with the lookout on the upper step facing the plaza. '
      + 'The lower step is left clear so a path can come up to it later.',
      [{ callId: 'stage-3', name: 'update_plan', args: { completedStages: 3 } }, { callId: 'a6', name: 'suggest_reply', args: { reply: 'Yes, run a path up to it' } }],
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

    // The work reached the map, so the contract check is not reading a log of refusals.
    expect(map.state.cells[5]![10]!.terrain).toMatchObject({ type: TerrainType.Mountain, elevation: 2 });
    const view = deriveView(log);
    expect(view.vitals.cells).toBeGreaterThan(0);
    expect(view.vitals.objects).toBeGreaterThan(0);
    expect(view.jobs[0]!.plan!.stages.length).toBe(3);

    const findings = checkContracts(log);
    expect(findings, reportContracts(findings)).toEqual([]);
  });

  /** The same job with each string breaking its contract: a says line whose point arrives late, an
   *  overlong stage label and suggestion, and a six-sentence summary. */
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
        }, { callId: 'done', name: 'update_plan', args: { completedStages: 1 } }],
      ),
      toolTurn(
        'Done. It is finished. All of it. Every part. Nothing remains. The rise is terraced.',
        [{ callId: 'b2', name: 'suggest_reply', args: { reply: 'Yes please, and run a path up to the lookout as well' } }],
      ),
      // The zero-write close above earns the loop's delivery nudge; this second close settles and
      // breaks the summary contract the same way.
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
    // The measurement cites the contract's number, not the string.
    expect(findings.find((f) => f.contract === '5 suggest_reply')!.measured)
      .toContain(String(CONTRACTS.suggestLatin));
  });

  /** A CJK character takes about twice the width of a Latin one, so CJK suggestions have their own
   *  budget. */
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

    // 19 characters: over the CJK budget though within the Latin one.
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

/** The number of assistant turns in the log. */
export function turnsIn(log: ReturnType<typeof createLog>): number {
  return eventsOf(log).filter((e) => e.kind === 'assistant').length;
}
