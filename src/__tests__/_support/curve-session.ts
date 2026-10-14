/** The editor's curve adjust phase as tests drive it: `makeToolCtx` and the editor's tool wiring both
 *  hand tools `editorCurves`, so these reach the session a test's tool opened. */
import type { CurveAnchor } from '../../core/base/spline';
import { editorCurves } from '../../editor/session/tool-wiring';
import type { CurveSessions } from '../../tools/pointer/paint/curve-session';

export { curveArmingKey } from '../../tools/pointer/paint/curve-session';

export const getCurveSession = () => editorCurves.get();
export const isCurveSessionOpen = () => editorCurves.isOpen();
export const beginCurveSession = (...args: Parameters<CurveSessions['begin']>) => editorCurves.begin(...args);
export const moveCurveAnchor = (index: number, x: number, y: number, commit: boolean) => editorCurves.moveAnchor(index, x, y, commit);
export const setCurveHandle = (...args: Parameters<CurveSessions['setHandle']>) => editorCurves.setHandle(...args);
export const resetCurveAnchors = (anchors: CurveAnchor[]) => editorCurves.resetAnchors(anchors);
export const endCurveSession = () => editorCurves.end();
export const __resetCurveSession = () => editorCurves.__reset();
