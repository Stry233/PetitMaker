/**
 * The editor's verbs.
 *
 * Each one is a plain function that takes a KitContext, performs one stroke group, and RETURNS its
 * result. None of them speaks to the user: a toast, a modal or a translation would tie the verb to
 * a single caller, and these have three.
 */
export type { Outcome } from './outcome';
export { newMap, loadMap } from './map';
export { generateMap, generateCandidate, clearGenerated } from './generate';
export type { Candidate } from './generate';
export { pressRoadNetwork } from './road-press';
export type { RoadPress } from './road-press';
