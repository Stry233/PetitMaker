import type { GridState, MacroCoord } from '../../core/model/types';
import { showToast } from '../../core/runtime/toast-bus';
import { mapFingerprint } from '../macros/scratch';
import { restoreMacroCommands } from '../macros/restore';
import type { ToolContext } from '../runtime/types';
import { beginCurveSession, endCurveSession, resetCurveAnchors } from './curve-session';
import { splineCells, type CurveAnchor } from './shapes';
import { finishEraserStroke } from './eraser-stroke';

type Erase = (cells: MacroCoord[], ctx: ToolContext) => void;

/** Each adjustment restores the pre-erase map before applying the new path. */
export function adjustErasedCurve(anchors: CurveAnchor[], baseline: GridState, live: ToolContext, erase: Erase): void {
  const ctx = { ...live };
  const visibility = JSON.stringify(ctx.layerVisibility);
  let held = anchors.map(a => ({ ...a }));
  let fingerprint = mapFingerprint(ctx.gridState);
  const current = () => {
    if (mapFingerprint(ctx.gridState) === fingerprint && JSON.stringify(live.layerVisibility) === visibility) return true;
    endCurveSession(); return false;
  };
  beginCurveSession(held, { width: ctx.brushSize, terrainGrid: ctx.contentType !== 'tile', footprint: true }, {
    preview() { current(); },
    repaint(next) {
      if (!current()) return;
      const start = ctx.getUndoStackSize();
      const reject = () => { ctx.rollbackTo(start); resetCurveAnchors(held); ctx.overlay.clearGhost(); };
      // Terrain restoration can reconcile neighbouring cuts; the second pass restores those silhouettes.
      for (let pass = 0; pass < 2; pass++) {
        for (const command of restoreMacroCommands(ctx.gridState, baseline)) {
          if (!ctx.executeCommand(command).success) { reject(); return; }
        }
      }
      const ordered = (state: GridState) => ({ ...state, objects: new Map([...state.objects].sort(([a], [b]) => a.localeCompare(b))) });
      if (mapFingerprint(ordered(ctx.gridState)) !== mapFingerprint(ordered(baseline))) { reject(); return; }
      const eraseStart = ctx.getUndoStackSize();
      erase(splineCells(next, ctx.brushSize), ctx);
      const violations = finishEraserStroke(ctx, start, eraseStart);
      if (violations.length > 0) {
        reject();
        if (violations[0]) showToast(ctx.t(violations[0].message), 'warning');
        return;
      }
      held = next.map(a => ({ ...a }));
      fingerprint = mapFingerprint(ctx.gridState);
      ctx.overlay.clearGhost();
    },
    finalize() { ctx.overlay.clearGhost(); },
  });
}
