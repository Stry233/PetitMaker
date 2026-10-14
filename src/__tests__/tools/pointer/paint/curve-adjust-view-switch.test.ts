import { describe, it, expect, afterEach, vi } from 'vitest';
import { DrawingTool } from '../../../../tools/pointer/paint/drawing-tool';
import { __resetCurveSession, getCurveSession, moveCurveAnchor } from '../../../_support/curve-session';
import { setToastPresenter } from '../../../../platform/channels/toast-bus';
import type { ToolContext } from '../../../../tools/pointer/runtime/types';
import { makeState, makeExecutor } from '../../../_support/map-state';
import { makeToolCtx, arm } from '../../../_support/tool-ctx';
import { makeStubView, makeTestToolManager } from '../../../_support/tool-manager';
import { cell, point } from '../../../_support/grid';

setToastPresenter(() => {});
afterEach(() => { __resetCurveSession(); });

const overlay = () => ({ showGhost: vi.fn(), showGhostSpans: vi.fn(), clearGhost: vi.fn(), flashCommit: vi.fn() }) as unknown as ToolContext['overlay'];

describe('a curve adjusted after switching between the 2D and 3D views', () => {
  it('previews in the view on screen', () => {
    const state = makeState(24, 20);
    const ctx = makeToolCtx(state, makeExecutor(state), 1, 1, { overlay: overlay() });
    const tool = new DrawingTool();
    arm(ctx, { shape: 'curve' });
    for (const at of [{ x: 4, y: 8 }, { x: 10, y: 4 }, { x: 16, y: 8 }, { x: 16, y: 8 }]) {
      tool.onPointerDown(cell(at), point(at), ctx);
      tool.onPointerUp(cell(at), point(at), ctx);
    }
    expect(getCurveSession()).not.toBeNull();

    const hidden = ctx.overlay, shown = overlay();
    vi.mocked(hidden.showGhost).mockClear();
    ctx.overlay = shown;
    moveCurveAnchor(1, 10, 10, false);

    expect(shown.showGhost).toHaveBeenCalled();
    expect(hidden.showGhost).not.toHaveBeenCalled();
  });

  it('keeps one tool context and hands it the new view', () => {
    const tm = makeTestToolManager();
    const before = tm.getContext();
    const view = { ...makeStubView(), overlay: overlay() };
    tm.setView(view);
    expect(tm.getContext()).toBe(before);
    expect(before.overlay).toBe(view.overlay);
    expect(before.viewport).toBe(view.projection);
  });
});
