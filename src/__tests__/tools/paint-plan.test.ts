import { describe, it, expect } from 'vitest';
import { CommandType, type Command, type EditorEvents, type MacroCoord } from '../../core/model/types';
import { planPaint } from '../../tools/paint/paint-plan';
import { DrawingTool } from '../../tools/paint/drawing-tool';
import { rectCells, circleCells } from '../../tools/paint/shapes';
import { isInBounds } from '../../core/model/grid-model';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry, type RuleRegistry } from '../../rules/index';
import { makeState } from '../rules/_helpers';
import { makeToolCtx } from './_tool-ctx';
import { roadLookup } from '../../state/object-index';

const m = (x: number, y: number): MacroCoord => ({ x, y });

function exec(state: any): CommandExecutor {
  return new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
}

/** Every cell any PaintTerrain command in a plan carries. */
function commandCells(commands: readonly Command[]): MacroCoord[] {
  const out: MacroCoord[] = [];
  for (const cmd of commands) if (cmd.type === CommandType.PaintTerrain) out.push(...cmd.cells);
  return out;
}

/** Counts calls into the registry's pre-command validation, the cost the retry storm inflates. */
function countValidations(registry: RuleRegistry): { calls: () => number } {
  const orig = registry.validatePreCommand.bind(registry);
  let calls = 0;
  registry.validatePreCommand = ((cmd, state) => { calls++; return orig(cmd, state); }) as typeof registry.validatePreCommand;
  return { calls: () => calls };
}

describe('paint-plan: a figure sheds its off-map cells before anything validates them', () => {
  it('a mountain plan never carries an out-of-bounds cell, for a rect straddling the edge', () => {
    const state = makeState(20, 20);
    const ctx = makeToolCtx(state, exec(state), 1, 3); // build floor 3: elevation > 1 is what V-MTN-02 flags off-map
    const cells = rectCells(m(15, 15), m(24, 24)); // 10x10, half off a 20x20 map
    const plan = planPaint(cells, ctx, 'mountain', new Set());
    for (const c of commandCells(plan.commands)) {
      expect(isInBounds(c.x, c.y, 20, 20), `cell (${c.x},${c.y}) is off-map and must never reach a command`).toBe(true);
    }
  });

  it('a water plan never carries an out-of-bounds cell, for a rect straddling the edge', () => {
    const state = makeState(20, 20);
    const ctx = makeToolCtx(state, exec(state), 1, 3);
    const cells = rectCells(m(15, 15), m(24, 24));
    const plan = planPaint(cells, ctx, 'water', new Set());
    for (const c of commandCells(plan.commands)) {
      expect(isInBounds(c.x, c.y, 20, 20)).toBe(true);
    }
  });

  it('a plan built entirely off-map is empty, not a no-op command carrying nothing', () => {
    const state = makeState(20, 20);
    const ctx = makeToolCtx(state, exec(state), 1, 1);
    const cells = rectCells(m(25, 25), m(30, 30)); // wholly off a 20x20 map
    expect(planPaint(cells, ctx, 'water', new Set()).commands).toEqual([]);
    expect(planPaint(cells, ctx, 'mountain', new Set()).commands).toEqual([]);
  });

  it('paints the in-bounds part of a straddling rect exactly as the same rect painted fully inside the map', () => {
    // Baseline: the same 10x10 rect, fully inside a big enough map, at the same build floor.
    const baseline = makeState(40, 40);
    const bTool = new DrawingTool();
    bTool.contentType = 'mountain';
    bTool.mode = 'rect';
    const bCtx = makeToolCtx(baseline, exec(baseline), 1, 3);
    bTool.onPointerDown(m(15, 15), m(15, 15), bCtx);
    bTool.onPointerUp(m(24, 24), m(24, 24), bCtx);

    // Straddling: the identical rect (same origin), but the map ends at 20x20 so half of it is off-map.
    const straddling = makeState(20, 20);
    const sTool = new DrawingTool();
    sTool.contentType = 'mountain';
    sTool.mode = 'rect';
    const sCtx = makeToolCtx(straddling, exec(straddling), 1, 3);
    sTool.onPointerDown(m(15, 15), m(15, 15), sCtx);
    sTool.onPointerUp(m(24, 24), m(24, 24), sCtx);

    // Every in-bounds cell of the rect must match the baseline exactly.
    for (const c of rectCells(m(15, 15), m(19, 19))) {
      const got = straddling.cells[c.y]![c.x]!.terrain?.elevation ?? 0;
      const want = baseline.cells[c.y]![c.x]!.terrain?.elevation ?? 0;
      expect(got, `cell (${c.x},${c.y})`).toBe(want);
    }
  });

  it('a brush dab straddling the map edge still raises its in-bounds cells past layer 1', () => {
    // Regression: an off-map neighbour used to refuse the WHOLE batch (V-MTN-02), and a brush dab
    // never retries per cell, so painting near any edge above floor 1 silently capped at layer 1.
    const state = makeState(20, 20);
    const tool = new DrawingTool();
    tool.contentType = 'mountain';
    tool.mode = 'brush';
    const ctx = makeToolCtx(state, exec(state), 21, 2); // a 21x21 dab centred on the corner: half off-map
    tool.onPointerDown(m(0, 0), m(0, 0), ctx);
    tool.onPointerUp(m(0, 0), m(0, 0), ctx);
    expect(state.cells[0]![0]!.terrain?.elevation).toBe(2);
    expect(state.cells[5]![5]!.terrain?.elevation).toBe(2);
  });

  it('a large rect straddling the edge at a build floor above 1 validates a bounded number of times', () => {
    // The bound this pins: never one full validatePreCommand pass PER CELL (a retry-per-cell storm
    // triggered by the off-map cells refusing the whole batch): thousands of calls for a shape this
    // size. Culled, it costs at most one call per elevation level the shape climbs through.
    const state = makeState(64, 64);
    const registry = createDefaultRegistry();
    const ex = new CommandExecutor(state, new EventBus<EditorEvents>(), registry, roadLookup(state));
    const probe = countValidations(registry);

    const tool = new DrawingTool();
    tool.contentType = 'mountain';
    tool.mode = 'rect';
    const ctx = makeToolCtx(state, ex, 1, 3); // floor 3: three levels to climb

    tool.onPointerDown(m(34, 34), m(34, 34), ctx);
    tool.onPointerUp(m(93, 93), m(93, 93), ctx); // 60x60, half off the 64x64 map

    // A generous bound: a handful of calls (one per level, plus edge-cut/reconcile bookkeeping),
    // nowhere near the thousands a per-cell retry storm would cost.
    expect(probe.calls()).toBeLessThan(20);
  });

  it('a huge circle brush dab at the map corner stays cheap to validate', () => {
    const state = makeState(64, 64);
    const registry = createDefaultRegistry();
    const ex = new CommandExecutor(state, new EventBus<EditorEvents>(), registry, roadLookup(state));
    const probe = countValidations(registry);

    const cells = circleCells(m(0, 0), 50, 50); // most of the disc is off the map
    const ctx = makeToolCtx(state, ex, 1, 4);
    const plan = planPaint(cells, ctx, 'mountain', new Set());
    for (const cmd of plan.commands) ex.execute(cmd);

    expect(probe.calls()).toBeLessThan(20);
  });

  it('a circle figure straddling the edge, drawn through the REAL tool, dodges the retry storm too', () => {
    // The pin above drives planPaint directly, which cannot see DrawingTool's per-cell retry on a
    // refused batch — the storm this fix exists to defuse (measured ~24k validations pre-fix for
    // this figure). This one drives the tool itself, exactly like the rect pin.
    const state = makeState(64, 64);
    const registry = createDefaultRegistry();
    const ex = new CommandExecutor(state, new EventBus<EditorEvents>(), registry, roadLookup(state));
    const probe = countValidations(registry);

    const tool = new DrawingTool();
    tool.contentType = 'mountain';
    tool.mode = 'circle';
    const ctx = makeToolCtx(state, ex, 1, 3);

    tool.onPointerDown(m(60, 60), m(60, 60), ctx);
    tool.onPointerUp(m(90, 90), m(90, 90), ctx); // a radius-~42 disc, most of it off the map

    expect(probe.calls()).toBeLessThan(20);
  });
});
