/**
 * The assistant's advice for each rule and trait: what to do about it with the assistant's tools. What
 * a rule requires and what a trait means are stated where each is defined (`rules/define.ts`,
 * `rules/placement.ts:TRAIT_VALIDATORS`) and read from there, so this file states neither.
 */
import type { PlacementTrait } from '../../core/model/types';
import { ruleDescription, type RuleId } from '../../rules/index';
import { anchorTerm, BUILDABLE_ZONES } from './game-terms';

const ANCHOR = anchorTerm();

/**
 * Every rule id has its entry, empty where the requirement says it all: the type is total, so a new
 * rule fails to compile until its advice is decided. A refusal's feedback adds it to the rule's own
 * description at the moment it applies.
 */
const RULE_ADVICE: Readonly<Record<RuleId, string>> = {
  'V-MTN-03': ` A terrace at level 4 or higher lies inside ground at most three levels lower that reaches at least one cell past its edge on every side; inside that, its outline can be any shape. A water cell counts as support up to its own surface, but nothing can be built ON water.`,
  'V-CHUNK-01': ` The full object load counts in every region it touches; moving or turning an item counts only the net change. Unknown loads count as zero.`,
  'V-MTN-01': '',
  'V-GROUND-LOCK': '',
  'V-LOCK-01': ' Tell the user to unlock it.',
  'V-LOCK-02': `${ANCHOR ? ` The ${ANCHOR} is locked.` : ''} Retrying an edit on a locked footprint always fails: on a lock rejection, immediately design around that footprint instead.`,
  'V-MTN-02': ' The paint_terrain tool auto-builds tiers for you.',
  'V-PLACE-BLOCK': ' clear_area removes the objects AND the terrain there in one step.',
  'V-PLACE-COATED': '',
  'V-PLACE-MAX': ' CATALOG lists the cap as max=N. A village of capped buildings uses DIFFERENT building ids (CATALOG shows which carry max) and adds extras only from buildings without max. Never place a capped id past its max; never batch identical capped houses.',
  'V-PLACE-OVERLAP': '',
  'V-PLACE-TRAIT': ' TRAITS in the system prompt says what each trait asks. For flat-trait buildings do NOT guess coordinates near water or slopes — the flat check rejects ANY water or elevation change touching the footprint+1-cell margin, so a house beside a river/lake/cliff you just made will fail; call find_flat_areas (object- and margin-aware) and place at a returned anchor. Items carrying exclusionRadius N (houses and trees, see CATALOG) keep N open cells between their footprint and every other exclusionRadius item, diagonals included, the larger N of the pair winning: leave a cell between two houses and between a house and a tree. bridges/ramps auto-snap position/rotation.',
  'V-PLACE-DOOR': ` find_flat_areas given the house's catalogId and rotation returns only anchors whose door side holds. Turn the house so the door faces open level ground or a street, or move it; once a house stands, terrain edits that would break its doorstep are refused.`,
  'V-WTR-02': ' This is checked after the call on the ENTIRE map, so a pre-existing illegal water cell reverts ANY edit, even one far away. If the cited cell is NOT one you just touched, that water was already broken: you canNOT fix it by editing elsewhere — clear_area that water (or cap its faces with mountains at its elevation) FIRST, then RE-APPLY the edit that just reverted — it did NOT land — and continue. Otherwise enclose new water in the SAME call or keep it surrounded by same-level ground.',
  'V-WTR-01': ' Elevated water sits ON mountains; build the mountain first.',
  'V-WTR-03': ' FIX: keep the falling water at the pool elevation, and build the row directly below the fall as one lower level across its width and end cells FIRST; or carve_river from inside the pool, which frames the fall itself. Painting low (e.g. elev-0) water against a stepped hillside always fails here — do not repeat it.',
  'V-PLANET-01': '',
  'V-ZONE-01': ` ${BUILDABLE_ZONES.charAt(0).toUpperCase()}${BUILDABLE_ZONES.slice(1)} reads as token "." in a map view, and CATALOG lists groundZones with the grounds an item may take. find_flat_areas given the catalogId searches every ground the item may stand on.`,
};

/** What the rule a refusal names requires, in the rule's own words, and the assistant's advice on it;
 *  undefined for an id no rule carries. */
export function ruleHint(ruleId: string): string | undefined {
  const requirement = ruleDescription(ruleId);
  return requirement === undefined ? undefined : `${requirement}${RULE_ADVICE[ruleId as RuleId]}`;
}

/** The assistant's advice on a trait, for the traits its tools serve: the system prompt adds it to
 *  the trait's own description. */
const TRAIT_ADVICE: Readonly<Partial<Record<PlacementTrait['type'], string>>> = {
  waterSpan: ' AIM AT A GAP CELL (e.g. mid-water), never at the bank — find_bridge_sites gives ready anchors.',
  heightDrop: ' Use find_ramp_sites to locate valid spots and the matching ramp item before placing.',
  surfaceCoating: ' Use place_object for prints, including their quarter-turn rotation. Remove a print by its object id to preserve the pavement.',
};

/** The assistant's advice on trait `type`, empty where it has none. */
export function traitAdvice(type: PlacementTrait['type']): string {
  return TRAIT_ADVICE[type] ?? '';
}
