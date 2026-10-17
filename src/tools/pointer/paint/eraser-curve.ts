import type { MacroCoord } from '../../../core/model/types';
import { violationToast } from '../../../i18n/terms/rule-copy';
import { stampMap, stillStamped } from '../../../core/model/fingerprint';
import { restoreStroke, type StrokePreimage } from './restore';
import type { CurveToolContext } from './curve-session';
import { adjustContext, curveArmingKey } from './curve-session';
import { splineCells } from '../../../core/grid/shapes';
import { type CurveAnchor } from '../../../core/base/spline';
import { finishEraserStroke } from './eraser-stroke';
import { CONTENT_GRID } from '../../../state/editing/edit-mode';

type Erase = (cells: MacroCoord[], ctx: CurveToolContext) => void;

/** Each adjustment restores the pre-erase map, read off the erasure's history, before applying the
 *  new path. */
export function adjustErasedCurve(anchors: CurveAnchor[], preimage: StrokePreimage, live: CurveToolContext, erase: Erase): void {
  const ctx = adjustContext(live);
  const visibility = JSON.stringify(ctx.arming.layerVisibility);
  let held = anchors.map(a => ({ ...a }));
  let stamp = stampMap(ctx.state);
  const current = () => {
    if (stillStamped(ctx.state, stamp) && JSON.stringify(live.arming.layerVisibility) === visibility) return true;
    ctx.curve.end(); return false;
  };
  ctx.curve.begin(held, {
    width: ctx.arming.brushSize, grid: CONTENT_GRID[ctx.arming.contentType], footprint: true, armingKey: curveArmingKey(ctx.arming),
  }, {
    preview() { current(); },
    repaint(next) {
      if (!current()) return;
      const stroke = ctx.beginStroke();
      const reject = () => { stroke.rollback(); ctx.curve.resetAnchors(held); ctx.overlay.clearGhost(); };
      if (!restoreStroke(ctx, preimage)) { reject(); return; }
      const erased = ctx.beginStroke();
      erase(splineCells(next, ctx.arming.brushSize), ctx);
      const violations = finishEraserStroke(ctx, stroke, erased);
      if (violations.length > 0) {
        reject();
        if (violations[0]) ctx.notify(violationToast(ctx.t, violations[0]), 'warning');
        return;
      }
      preimage.record(stroke.entries());
      held = next.map(a => ({ ...a }));
      stamp = stampMap(ctx.state);
      ctx.overlay.clearGhost();
    },
    finalize() { ctx.overlay.clearGhost(); },
  });
}
