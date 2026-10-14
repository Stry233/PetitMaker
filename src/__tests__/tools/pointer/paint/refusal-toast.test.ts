import { describe, it, expect, beforeEach } from 'vitest';
import { TerrainType } from '../../../../core/model/types';
import { DrawingTool } from '../../../../tools/pointer/paint/drawing-tool';
import { EraserTool } from '../../../../tools/pointer/paint/eraser';
import { translateFor } from '../../../../i18n/context';
import { makeState, makeExecutor, setTerrain } from '../../../_support/map-state';
import { makeToolCtx } from '../../../_support/tool-ctx';
import { cell, point } from '../../../_support/grid';
import type { TextKey } from '../../../../i18n/keys';

const toasts: string[] = [];
const t = (key: TextKey, params?: Record<string, string | number>) => translateFor('en', key, params);
const base = (reason: string) => translateFor('en', 'rule.toast', { category: translateFor('en', 'rule.category.base'), reason });

beforeEach(() => { toasts.length = 0; });
const notify = (text: string): void => { toasts.push(text); };

function tap(tool: DrawingTool | EraserTool, ctx: ReturnType<typeof makeToolCtx>, x: number, y: number): void {
  tool.onPointerDown(cell({ x, y }), point({ x: x + 0.5, y: y + 0.5 }), ctx);
  tool.onPointerUp(cell({ x, y }), point({ x: x + 0.5, y: y + 0.5 }), ctx);
}

describe('a stroke the map rules refuse', () => {
  it('names the base rule with its own numbers when a lone block is laid too high', () => {
    const state = makeState(12, 12);
    const ctx = makeToolCtx(state, makeExecutor(state), 1, 4, { t, notify });
    tap(new DrawingTool(), ctx, 5, 5);
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).not.toMatch(/[{}]/);
    expect(toasts[0]!.startsWith(base('').trimEnd())).toBe(true);
  });

  it('keeps the category and the numbers when an erasure takes away support', () => {
    const state = makeState(12, 12);
    for (let y = 4; y <= 6; y++) for (let x = 4; x <= 6; x++) setTerrain(state, x, y, TerrainType.Mountain, 1);
    setTerrain(state, 5, 5, TerrainType.Mountain, 4);
    const ctx = makeToolCtx(state, makeExecutor(state), 1, 1, { t, notify });
    tap(new EraserTool(), ctx, 4, 4);
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).not.toMatch(/[{}]/);
    expect(toasts[0]!.startsWith(base('').trimEnd())).toBe(true);
  });
});
