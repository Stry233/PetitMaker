/**
 * The trim module's door: automatic corner trimming and its preview, with no pointer in them.
 *
 * `auto-edge-cut.ts` is the pass the build brushes, Smart Build, the generators and the assistant
 * run over what they laid; `trim-preview.ts` and `road-trim-preview.ts` run the same pass over a
 * scratch copy, so a ghost shows what a click will do. The geometry is `core/domain/edge-cut/`, and
 * the manual corner tool is `tools/pointer/edge-cut/`. Both views draw the ghost's trimmed shape. Peers
 * import these files directly.
 */
export { edgeCutGeneratedTerrain, edgeCutGeneratedRoads, edgeCutTerrainWith, type CornerChooser } from './auto-edge-cut';
export { shapeOfSpans, type TrimmedCell } from './trim-preview';
