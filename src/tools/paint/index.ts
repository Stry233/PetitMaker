/**
 * THE PAINT MODULE'S DOOR: the brushes that lay a surface, and the geometry they lay it in.
 *
 * Behind it:
 *
 *   drawing-tool.ts   the build brush — freehand, line, rect, circle and the curve's anchor chain
 *   eraser.ts         the same gestures taking a surface back
 *   paint-plan.ts     what one click on one cell means before any of it is issued
 *   water-layers.ts   the layer a refused water stroke COULD have stood at, which its message names
 *   tile-coating.ts   the shared road place/erase both of the above go through
 *   terrain-peel.ts   taking the terrain out from under an object without moving the object
 *   curve-session.ts  the finished curve's adjust phase, which the chrome draws handles for
 *   shapes.ts         the pure figure rasterizers, plus the spline the curve runs through
 *
 * WHAT CROSSES IT. The canvas registers the tools, the chrome draws the curve's handles, the
 * region brush and the agent's terraform tools rasterize the same figures the brushes do. Modules
 * inside `tools/` import these files directly rather than through here: they are peers of one
 * implementation, and `edge-cut/road-trim-preview` already reads `tile-coating`, so a barrel
 * between peers would close a cycle the direct import does not have. `EraserTool` is not here for the
 * same reason `macro-tool` is not at the macro door: `tools/runtime` constructs it. `DrawingTool` IS,
 * because `PixiCanvas` tests the active tool against it with `instanceof`.
 */
export { DrawingTool } from './drawing-tool';
export {
  endCurveSession, getCurveSession, isCurveSessionOpen, moveCurveAnchor, setCurveHandle,
  subscribeCurveSession,
} from './curve-session';
export {
  anchorHandles, bezier4, circleCells, curveCells, expandLine, lineCells, rectCells, snapShapeEnd, splineCells,
} from './shapes';
