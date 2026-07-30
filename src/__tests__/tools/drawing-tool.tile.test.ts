import { describe, it, expect, beforeEach } from 'vitest';
import { DrawingTool } from '../../tools/paint/drawing-tool';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules/index';
import { type EditorEvents, type MacroCoord } from '../../core/model/types';
import { useEditorStore } from '../../state/store';
import { makeState } from '../rules/_helpers';
import { makeToolCtx, objectsByCatalog } from './_tool-ctx';

const exec = (state: any) => new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
const m = (x: number, y: number): MacroCoord => ({ x, y });

describe('DrawingTool: tile surface', () => {
  beforeEach(() => useEditorStore.getState().setTileMaterial('dirt'));

  it('brush places a single tile (size 1)', () => {
    const state = makeState(10, 10);
    const tool = new DrawingTool();
    tool.contentType = 'tile';
    tool.mode = 'brush';
    const ctx = makeToolCtx(state, exec(state));
    tool.onPointerDown(m(5, 5), m(5, 5), ctx);
    tool.onPointerUp(m(5, 5), m(5, 5), ctx);
    const t = objectsByCatalog(state, 'road-dirt');
    expect(t.length).toBe(1);
    expect(t[0]!.position).toEqual({ x: 5, y: 5 });
  });

  it('rect fills its footprint with tiles', () => {
    const state = makeState(10, 10);
    const tool = new DrawingTool();
    tool.contentType = 'tile';
    tool.mode = 'rect';
    const ctx = makeToolCtx(state, exec(state));
    tool.onPointerDown(m(2, 2), m(2, 2), ctx);
    tool.onPointerUp(m(4, 4), m(4, 4), ctx);
    expect(objectsByCatalog(state, 'road-dirt').length).toBe(9); // 3x3
  });

  it('does not paint terrain in tile mode', () => {
    const state = makeState(10, 10);
    const tool = new DrawingTool();
    tool.contentType = 'tile';
    tool.mode = 'brush';
    const ctx = makeToolCtx(state, exec(state));
    tool.onPointerDown(m(7, 7), m(7, 7), ctx);
    tool.onPointerUp(m(7, 7), m(7, 7), ctx);
    expect(state.cells[7]![7]!.terrain).toBeNull();
  });
});
