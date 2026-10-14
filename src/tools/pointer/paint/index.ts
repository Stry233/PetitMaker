/**
 * The paint module's door: the brushes that lay a surface, and the geometry they lay it in.
 *
 * `drawing-tool.ts` is the build brush (freehand, line, rect, circle and the curve's anchor chain)
 * and `eraser.ts` the same gestures taking a surface back; `paint-plan.ts` decides what one click on
 * one cell means before anything is issued; `tile-coating.ts` is the road place and erase both go
 * through; `stroke-finish.ts` closes a stroke with its trim; `curve-session.ts` is a finished curve's adjust phase; `gestures.ts` holds
 * the gestures the brush and the eraser share. The figures they lay are `core/grid/shapes.ts`.
 *
 * Modules inside `tools/` import these files directly, so a barrel between peers closes no cycle.
 * `pointer/runtime` constructs `DrawingTool` and `EraserTool`.
 */
export { curveArmingKey, CurveSessions } from './curve-session';
export { finishPaintStroke } from './stroke-finish';
