/**
 * The assistant's advice for each rule, keyed by rule id: the system prompt lists it beside the
 * rule and a refusal's feedback appends it. It names assistant tools and prompt sections, so it
 * lives with the assistant rather than in the rule files; the rules keep only their own messages.
 */
import { BASE_SUPPORT, CHUNK_LOAD_LIMIT, DOOR, ELEVATION_MAX, GROUND_SUPPORT_LAYER } from '../../core/game/profile';
import { CLEARING_ELEVATION } from '../../core/model/grid-model';
import type { RuleId } from '../../rules/index';
import { anchorTerm, BUILDABLE_ZONES, UNBUILDABLE_ZONES, ZONE_ORDER, zoneName } from './game-terms';
import { SAND_ZONE } from '../../core/game/zones';

const ANCHOR = anchorTerm();
const capitalized = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** Every rule id has advice: the type is total, so a new rule fails to compile until it has its entry. */
export const RULE_HINTS: Readonly<Record<RuleId, string>> = {
  'V-MTN-03': `POST-CHECK — a mountain cell at elevation >=${BASE_SUPPORT.fromLayer} needs a full ${BASE_SUPPORT.window}x${BASE_SUPPORT.window} base at some elevation >= N-${BASE_SUPPORT.reach} below it. Build pyramids, not 1-wide towers. A water cell counts as support up to its own surface, but nothing can be built ON water.`,
  'V-CHUNK-01': `When regional load enforcement is on, each region may carry at most ${CHUNK_LOAD_LIMIT}. The full object load counts in every region it touches; moving or turning an item counts only the net change. Unknown loads count as zero.`,
  'V-MTN-01': `Mountain elevation must be 0-${ELEVATION_MAX} (${CLEARING_ELEVATION} clears the cell).`,
  'V-GROUND-LOCK': `The ground shape (${ZONE_ORDER.map(zoneName).join(', ')}) is fixed by the planet and cannot be edited.`,
  'V-LOCK-01': 'Terrain on a locked layer cannot be modified (user setting; tell the user to unlock it).',
  'V-LOCK-02': `Locked features (${ANCHOR ? `the ${ANCHOR}, ` : ''}any locked object) are PERMANENT: they cannot be moved, removed, or built over, and retrying an edit there always fails. On a lock rejection, immediately design around that footprint instead.`,
  'V-MTN-02': `Painting mountain at elevation N>${GROUND_SUPPORT_LAYER} requires the same cell to already hold elevation N-1 (the paint_terrain tool auto-builds tiers for you).`,
  'V-PLACE-BLOCK': 'Terrain cannot be painted on cells covered by an object footprint — clear_area removes the objects AND the terrain there in one step.',
  'V-PLACE-COATED': 'Structures with coatingSupport may stand on any road. Flora may stand on plantable coatings. Other solid objects require uncovered ground.',
  'V-PLACE-MAX': 'An item listed with max=N in CATALOG may stand at most N times on the map. A village of capped buildings uses DIFFERENT building ids (CATALOG shows which carry max) and adds extras only from buildings without max. Never place a capped id past its max; never batch identical capped houses.',
  'V-PLACE-OVERLAP': 'Solid footprints may not overlap. Coatings on different layers coexist. Structures with coatingSupport keep underlying roads; flora require plantable surfaces. Roads may pass beneath higher bridges.',
  'V-PLACE-TRAIT': 'Objects validate their placement traits (see TRAITS below). For flat-trait buildings do NOT guess coordinates near water or slopes — the flat check rejects ANY water or elevation change touching the footprint+1-cell margin, so a house beside a river/lake/cliff you just made will fail; call find_flat_areas (object- and margin-aware) and place at a returned anchor. Items carrying exclusionRadius N (houses and trees, see CATALOG) keep N open cells between their footprint and every other exclusionRadius item, diagonals included, the larger N of the pair winning: leave a cell between two houses and between a house and a tree. bridges/ramps auto-snap position/rotation.',
  'V-PLACE-DOOR': `A house's door is the middle of its bottom side at rotation 0 and turns with it (90 faces -x, 180 faces -y, 270 faces +x). Measured out from the whole door side of the footprint, along its full length: the first ${DOOR.dropDepth} cells must be land at the house's elevation (no cliff drop, sea or map edge), and nothing higher than the house and no water may come nearer than ${DOOR.riseDepth} cells. find_flat_areas given the house's catalogId and rotation returns only anchors whose door side holds. Turn the house so the door faces open level ground or a street, or move it; once a house stands, terrain edits that would break its doorstep are refused.`,
  'V-WTR-02': 'POST-CHECK, WHOLE-MAP — every water cell with a lower neighbor (an exposed face) must be capped by mountains at EXACTLY the water elevation on both perpendicular ends. Nothing may stand on a cap: painting a cap above the water uncaps it and reverts the stroke. Because it re-checks the ENTIRE map, a pre-existing illegal water cell reverts ANY edit, even one far away. If the cited cell is NOT one you just touched, that water was already broken: you canNOT fix it by editing elsewhere — clear_area that water (or cap its faces with mountains at its elevation) FIRST, then RE-APPLY the edit that just reverted — it did NOT land — and continue. Otherwise enclose new water in the SAME call or keep it surrounded by same-level ground.',
  'V-WTR-01': `Painting water at elevation N>${GROUND_SUPPORT_LAYER} requires terrain at N-1 at the same cell — elevated water sits ON mountains; build the mountain first.`,
  'V-WTR-03': 'POST-CHECK — the row directly BELOW the waterfall lip must all be ONE elevation across the full frame width. FIX: keep the falling water at the pool elevation (a high water cell), and build the cells directly below it as a single uniform lower shelf FIRST. Painting low (e.g. elev-0) water against a stepped hillside always fails here — do not repeat it.',
  'V-PLANET-01': 'While a planet is being shaped, the ground under a placed object keeps its zone: move or remove the object before reshaping the ground beneath it.',
  'V-ZONE-01': `Build only on ${BUILDABLE_ZONES} zone (token "."). ${capitalized(UNBUILDABLE_ZONES.join('/'))} reject all edits, except that an item listed with groundZones in CATALOG may also stand wholly on ${zoneName(SAND_ZONE)} when it says sand; a footprint may cross from ${BUILDABLE_ZONES} to ${zoneName(SAND_ZONE)} only when it says across. find_flat_areas given the catalogId searches every ground the item may stand on.`,
};

/** The advice for the rule a refusal names, if the assistant has any. */
export function ruleHint(ruleId: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(RULE_HINTS, ruleId) ? RULE_HINTS[ruleId as RuleId] : undefined;
}
