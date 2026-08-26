/**
 * THE EDGE-CUT MODULE'S DOOR: corner trimming as a tool, as an automatic pass, and as a preview.
 *
 * Behind it:
 *
 *   edge-cut-tool.ts       the manual tool, which cycles one corner at a time
 *   auto-edge-cut.ts       the pass the build brushes and the generators run over what they laid
 *   trim-preview.ts        the same pass over a scratch copy, so a ghost can promise what a click
 *                          will do
 *   road-trim-preview.ts   the road ghost's twin of it
 *
 * The geometry itself is not here: it is `core/edge-cut/`, which the renderers read too. This
 * module is the EDITING side of it.
 *
 * WHAT CROSSES IT. The agent's terraform tools trim what they lay, and both views draw the ghost's
 * trimmed shape. Everything else here is read by peers, which import these files directly (see the
 * paint door for why) — `EdgeCutTool` included: `tools/runtime` constructs it.
 */
export { edgeCutGeneratedTerrain, edgeCutGeneratedRoads } from './auto-edge-cut';
export { shapeOfSpans, type TrimmedCell } from './trim-preview';
