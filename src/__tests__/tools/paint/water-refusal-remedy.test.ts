/** A refused water stroke names the sole legal layer when one exists and otherwise keeps the rule's reason. */
import { describe, it, expect } from 'vitest';
import { DrawingTool } from '../../../tools/paint/drawing-tool';
import { soleLegalWaterLayer } from '../../../tools/paint/water-layers';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules/index';
import { setToastPresenter, type ToastType } from '../../../core/runtime/toast-bus';
import { TerrainType, type EditorEvents, type GridState, type MacroCoord } from '../../../core/model/types';
import { makeState, setTerrain } from '../../rules/_helpers';
import { makeToolCtx } from '../_tool-ctx';
import { roadLookup } from '../../../state/object-index';
import type { ToolContext } from '../../../tools/runtime/types';

const exec = (s: GridState) => new CommandExecutor(s, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(s));
const m = (x: number, y: number): MacroCoord => ({ x, y });
const terrainAt = (s: GridState, x: number, y: number) => s.cells[y]?.[x]?.terrain ?? null;

/** Three-layer mesa with a waterfall site on its southern lip at (8,8). */
function mesa(): GridState {
  const state = makeState(20, 20);
  for (let y = 4; y <= 8; y++) for (let x = 4; x <= 12; x++) setTerrain(state, x, y, TerrainType.Mountain, 3);
  return state;
}

/** The messages a stroke asked for, and the toasts it posted. */
function recording(state: GridState, ex: CommandExecutor, elevation: number, over: Partial<ToolContext> = {}) {
  const asked: { key: string; params?: Record<string, string | number> }[] = [];
  const toasts: { text: string; type: ToastType }[] = [];
  const restore = setToastPresenter((text, type) => toasts.push({ text, type }));
  const ctx: ToolContext = {
    ...makeToolCtx(state, ex, 1, elevation, { layerPinned: true, ...over }),
    t: (key: string, params?: Record<string, string | number>) => {
      asked.push({ key, params });
      return params ? `${key}:${JSON.stringify(params)}` : key;
    },
  };
  return { ctx, asked, toasts, restore };
}

function waterDab(ctx: ToolContext, at: MacroCoord): void {
  const tool = new DrawingTool();
  tool.contentType = 'water';
  tool.mode = 'brush';
  tool.onPointerDown(at, at, ctx);
  tool.onPointerUp(at, at, ctx);
}

describe('a refused water stroke names the one layer that would hold it', () => {
  it('the repro: layer 2 armed on a three-layer lip is refused, and the toast names layer 3', () => {
    const state = mesa();
    const ex = exec(state);
    const { ctx, asked, toasts, restore } = recording(state, ex, 2);
    waterDab(ctx, m(8, 8));
    restore();

    expect(terrainAt(state, 8, 8), 'the stroke is still refused, and nothing is quietly moved')
      .toEqual({ type: TerrainType.Mountain, elevation: 3 });
    expect(asked).toEqual([{ key: 'error.water_only_layer', params: { layer: 3 } }]);
    expect(toasts).toEqual([{ text: 'error.water_only_layer:{"layer":3}', type: 'warning' }]);
  });

  it('layer 3 is what actually works there, which is what the message promises', () => {
    const state = mesa();
    const ex = exec(state);
    const { ctx, asked, restore } = recording(state, ex, 3);
    waterDab(ctx, m(8, 8));
    restore();

    expect(terrainAt(state, 8, 8)).toEqual({ type: TerrainType.Water, elevation: 3 });
    expect(asked, 'a stroke that stands says nothing').toEqual([]);
  });

  it('the enumeration itself reports exactly layer 3 for that cell', () => {
    const state = mesa();
    expect(soleLegalWaterLayer([m(8, 8)], state, createDefaultRegistry())).toBe(3);
  });

  // A dent in the plateau top can take water at its own floor (a sunken pool the walls contain) or
  // at the plateau's layer (a pond flush with it). Two answers is not a remedy, so nothing is named.
  it('keeps the rule\'s own message where several layers are legal', () => {
    const state = mesa();
    setTerrain(state, 8, 6, TerrainType.Mountain, 2);
    expect(soleLegalWaterLayer([m(8, 6)], state, createDefaultRegistry())).toBeNull();
  });

  it('keeps the rule\'s own message where no layer is legal', () => {
    const state = makeState(20, 20);
    // A lone tier-1 block: water on it is uncapped whichever layer it takes, and the map edge is
    // not a cap either.
    setTerrain(state, 5, 5, TerrainType.Mountain, 1);
    const ex = exec(state);
    expect(soleLegalWaterLayer([m(5, 5)], state, createDefaultRegistry())).toBeNull();
    const { ctx, asked, restore } = recording(state, ex, 1);
    waterDab(ctx, m(5, 5));
    restore();
    expect(asked.map((a) => a.key)).toEqual(['error.water_uncapped']);
  });

  // The brush lays each cell at its own height, so a stroke that crossed a step has no single layer
  // to name — and the no-floating rule refuses every uniform one, so the answer costs no sweep.
  it('names nothing for a stroke spanning two steps', () => {
    const state = mesa();
    setTerrain(state, 8, 9, TerrainType.Mountain, 1);
    expect(soleLegalWaterLayer([m(8, 8), m(8, 9)], state, createDefaultRegistry())).toBeNull();
  });

  it('reads the map as it stands after the revert, so a second attempt is judged on the same ground', () => {
    const state = mesa();
    const ex = exec(state);
    const first = recording(state, ex, 2);
    waterDab(first.ctx, m(8, 8));
    first.restore();
    const again = recording(state, ex, 2);
    waterDab(again.ctx, m(8, 8));
    again.restore();
    expect(again.asked).toEqual(first.asked);
  });

  // The remedy is a water answer. A mountain stroke on the same cell has a layer of its own and its
  // refusal keeps the rule's reason, even though the water question there has a single answer.
  it('leaves a refused mountain stroke saying what the mountain rule said', () => {
    const state = mesa();
    const ex = exec(state);
    const { ctx, asked, restore } = recording(state, ex, 2);
    const tool = new DrawingTool();
    tool.contentType = 'mountain';
    tool.mode = 'brush';
    tool.onPointerDown(m(8, 8), m(8, 8), ctx);
    tool.onPointerUp(m(8, 8), m(8, 8), ctx);
    restore();
    expect(soleLegalWaterLayer([m(8, 8)], state, createDefaultRegistry()), 'the water question there does have one answer').toBe(3);
    expect(asked.map((a) => a.key)).toEqual(['error.need_3x3_base']);
  });

  it('an off-map footprint names nothing', () => {
    const state = mesa();
    expect(soleLegalWaterLayer([m(-3, -3)], state, createDefaultRegistry())).toBeNull();
  });
});
