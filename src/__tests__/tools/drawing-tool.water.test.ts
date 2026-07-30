import { describe, it, expect } from 'vitest';
import { DrawingTool } from '../../tools/paint/drawing-tool';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules/index';
import { TerrainType, type Command, type EditorEvents, type MacroCoord, type ValidationResult } from '../../core/model/types';
import { makeState, setTerrain } from '../rules/_helpers';
import { makeToolCtx } from './_tool-ctx';
import { useEditorStore } from '../../state/store';
import type { ToolContext } from '../../tools/types';

const exec = (state: any) => new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
const m = (x: number, y: number): MacroCoord => ({ x, y });
const terrainAt = (state: any, x: number, y: number) => state.cells[y]?.[x]?.terrain ?? null;

function fillMountain(state: any, x0: number, y0: number, x1: number, y1: number, elevation: number) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) setTerrain(state, x, y, TerrainType.Mountain, elevation);
}

/** Captures every command the tool issues (in order) without caring whether commitStroke's
 *  post-stroke pass later reverts them — the elevation/target-cell question this feature answers
 *  is settled at the PLAN, before containment or any other post-stroke rule gets a say. */
function captureCommands(state: any, ex: CommandExecutor, elevation: number, brushSize = 1) {
  const commands: Command[] = [];
  const ctx: ToolContext = {
    ...makeToolCtx(state, ex, brushSize, elevation),
    executeCommand: (cmd: Command): ValidationResult => {
      commands.push(cmd);
      return ex.execute(cmd);
    },
  };
  return { ctx, commands };
}

function waterBrush(ctx: ToolContext, x: number, y: number): void {
  const tool = new DrawingTool();
  tool.contentType = 'water';
  tool.mode = 'brush';
  tool.onPointerDown(m(x, y), m(x, y), ctx);
  tool.onPointerUp(m(x, y), m(x, y), ctx);
}

// Pinned end to end, over a real committed map rather than the command the click issues.
describe('DrawingTool: water paints at the CLICKED surface, not the selected layer', () => {
  it('lands on a plateau top even though a lower layer is selected, and survives containment', () => {
    const state = makeState(10, 10);
    // A solid plateau: painting water in its centre at the plateau's own elevation is trivially
    // contained (every neighbour is mountain at the SAME elevation - no exposed face).
    fillMountain(state, 3, 3, 7, 7, 3);
    const ex = exec(state);
    const ctx = makeToolCtx(state, ex, 1, 1); // panel says layer 1
    waterBrush(ctx, 5, 5);
    expect(terrainAt(state, 5, 5)).toEqual({ type: TerrainType.Water, elevation: 3 });
  });

  it('drops to ground level (0) when the click is on fresh ground, even under a raised selection', () => {
    const state = makeState(10, 10);
    const ex = exec(state);
    const ctx = makeToolCtx(state, ex, 1, 5); // panel says layer 5
    waterBrush(ctx, 5, 5);
    expect(terrainAt(state, 5, 5)).toEqual({ type: TerrainType.Water, elevation: 0 });
  });

  it('updates the active-layer store to match, so the layer panel follows the click', () => {
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, TerrainType.Mountain, 4);
    const ex = exec(state);
    const ctx = makeToolCtx(state, ex, 1, 1);
    waterBrush(ctx, 5, 5);
    expect(useEditorStore.getState().activeLayer).toBe(4);
  });

  it('reads the REAL surface through the silhouette kernel: a Γ-patched corner reads its real (lower) support, not its cosmetic tier', () => {
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, TerrainType.Mountain, 3);
    const cell = state.cells[5]![5]!.terrain!;
    (cell as any).patchOnly = true;
    (cell as any).patchBase = 2; // cosmetic tier 3, real support 2
    const ex = exec(state);
    const { ctx, commands } = captureCommands(state, ex, 1);
    waterBrush(ctx, 5, 5);
    expect(commands[0]).toMatchObject({ terrainType: TerrainType.Water, elevation: 2 });
  });

  // The context's `elevation` field is what the FIRST command of the stroke reads (see
  // paint-plan.ts:planWater), and ToolManager builds ctx once and never rebuilds it between
  // pointer-down and the synchronous paint call — the store only reaches the tool on the NEXT
  // refreshCtx. So this drives the raw ToolContext with no refresh in between: resolving the layer
  // in the store alone would leave the STALE elevation (1) on the first (and only) command.
  it('the FIRST command of the stroke already carries the resolved layer (no stale first cell)', () => {
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, TerrainType.Mountain, 3);
    const ex = exec(state);
    const { ctx, commands } = captureCommands(state, ex, 1);
    waterBrush(ctx, 5, 5);
    expect(commands[0]).toMatchObject({ terrainType: TerrainType.Water, elevation: 3 });
  });

  it('stays fixed for the whole stroke: a brush footprint spanning differing surfaces all plans at the ORIGIN cell\'s layer', () => {
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, TerrainType.Mountain, 3); // origin: plateau top
    // Neighbours in the 3x3 footprint are fresh ground (elevation 0) - deliberately NOT the
    // origin's surface, to prove the whole footprint follows the click, not each cell's own surface.
    const ex = exec(state);
    const { ctx, commands } = captureCommands(state, ex, 1, 3);
    waterBrush(ctx, 5, 5);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ terrainType: TerrainType.Water, elevation: 3 });
    expect((commands[0] as any).cells).toEqual(
      expect.arrayContaining([{ x: 4, y: 4 }, { x: 5, y: 5 }, { x: 6, y: 6 }]),
    );
  });

  it('the cursor probe (canActAt) agrees with the click: both resolve the SAME clicked-surface layer', () => {
    const state = makeState(10, 10);
    fillMountain(state, 3, 3, 7, 7, 3);
    const ex = exec(state);
    const ctx = makeToolCtx(state, ex, 1, 1); // panel says layer 1; clicked surface is 3
    const tool = new DrawingTool();
    tool.contentType = 'water';
    tool.mode = 'brush';
    expect(tool.canActAt(m(5, 5), ctx)).toBe(true);
    waterBrush(ctx, 5, 5);
    expect(terrainAt(state, 5, 5)).toEqual({ type: TerrainType.Water, elevation: 3 });
  });
});

// The mountain brush and the tile brush must be entirely untouched: they have their own,
// deliberately different rules (mountain auto-stacks FROM the selected floor).
describe('DrawingTool: only water changes; mountain still floors from the SELECTED layer', () => {
  it('a mountain click still uses the selected floor, not the clicked surface', () => {
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, TerrainType.Mountain, 1);
    const ex = exec(state);
    const ctx = makeToolCtx(state, ex, 1, 2); // panel selects layer 2 (no 3x3-base cap in play)
    const tool = new DrawingTool();
    tool.contentType = 'mountain';
    tool.mode = 'brush';
    tool.onPointerDown(m(5, 5), m(5, 5), ctx);
    tool.onPointerUp(m(5, 5), m(5, 5), ctx);
    // Stacks toward the selected floor (2), never snaps to "the clicked surface" (1).
    expect(terrainAt(state, 5, 5)?.elevation).toBe(2);
  });

  it('does not touch the store\'s activeLayer for a mountain click', () => {
    const state = makeState(10, 10);
    const ex = exec(state);
    const ctx = makeToolCtx(state, ex, 1, 4);
    useEditorStore.getState().setActiveLayer(2);
    const tool = new DrawingTool();
    tool.contentType = 'mountain';
    tool.mode = 'brush';
    tool.onPointerDown(m(5, 5), m(5, 5), ctx);
    tool.onPointerUp(m(5, 5), m(5, 5), ctx);
    expect(useEditorStore.getState().activeLayer).toBe(2);
  });
});
