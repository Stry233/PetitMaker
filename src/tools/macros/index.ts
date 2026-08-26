/**
 * THE MACRO MODULE'S DOOR: smart build, one generator verb invoked at a point on a live map.
 *
 * Behind it:
 *
 *   run.ts            the catalogue of verbs and the run itself — build on a scratch clone, replay
 *                     what the rules accepted, land it as exactly ONE undo entry
 *   raise.ts stream.ts road-link.ts roads.ts patch.ts   the verbs
 *   grammar.ts habitat.ts succession.ts delights.ts     what a planting press reads before it plants
 *   road-paving.ts route-world.ts terrace.ts walkable.ts measure.ts   the shared bodies they build on
 *   scratch.ts        the detached clone with the live rules every verb tries its design on
 *   context.ts        the {state, executor, registry} triple a verb runs against, so the shell, the
 *                     agent and a test reach one implementation
 *   preview.ts        the same run, cached and diffed, for the ghost that follows the pointer
 *   route-session.ts  the two draggable route marks a road-link press leaves standing
 *   macro-tool.ts     the TOOL that arms a verb and aims it
 *
 * WHAT CROSSES IT. `kit` presses a verb and runs the preview pool, the shell names verbs and reads
 * their outcomes, the chrome draws the route marks, and the agent's director tools call TWO bodies
 * without going through `applyMacro` — `layRoadNetwork` and `plantPatch` — because the stroke group
 * and the provenance around those runs are the model's, not the generator's, and the tool wraps them
 * itself. Every other verb and body behind this door is read by peers inside `tools/`, which import
 * files directly (see the paint door for why); `macro-tool.ts` stays back there too, since
 * `tools/runtime` registers it.
 */
export {
  MACRO_IDS, EMPTY_KEY, applyMacro, buildMacroRun, installMacroBuildRunner,
  type MacroBuild, type MacroId, type MacroOpts, type MacroOutcome,
} from './run';
export type { MacroContext } from './context';

// The two bodies the agent's director tools call.
export { plantPatch } from './patch';
export { layRoadNetwork } from './roads';

export { detachCommand, mapFingerprint } from './scratch';
export { installMacroPreviewRunner, previewMacro, type MacroPreview } from './preview';
export {
  closeRouteMarks, getRouteSession, moveRouteMark, subscribeRouteSession, type RouteMarkId,
} from './route-session';
