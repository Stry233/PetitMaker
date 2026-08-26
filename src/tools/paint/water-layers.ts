/**
 * WHICH LAYER COULD HOLD THIS WATER — the remedy a refused water stroke names.
 *
 * A water refusal is nearly always a height that does not fit: the waterfall rules ask for caps at
 * EXACTLY the water's layer and for a uniform row under its lip, so a stroke aimed at a lip with a
 * stale layer armed is refused for a reason the map, not the user, decides. Where the ground leaves
 * exactly one layer that WOULD hold the stroke, the refusal can say which — the same figure the
 * user would find by trying every layer in turn.
 *
 * The answer comes from the REAL rules, both phases, run over a scratch of the live map
 * (`scratchGrid`): pre-command per candidate command, then the whole-map post-stroke sweep, judged
 * as a DELTA against what the map already breaks — a map carrying an illegal water body elsewhere
 * would otherwise report every layer as refused and the remedy would never be found.
 *
 * TWO BOUNDS make it cheap enough to run at refusal time. A layer BELOW a cell's own surface is not
 * a candidate: painting water there strips the mass above it, which is an excavation rather than the
 * stroke being refused. And no layer sits more than one step above a cell's surface, which is
 * V-WTR-01's own bound. A stroke that crossed a step therefore leaves the window empty and is
 * answered without touching the rules at all; anything inside it costs at most two whole-map sweeps
 * on top of the baseline, once, on a stroke a hand has just been refused.
 */
import { CommandType, TerrainType } from '../../core/model/types';
import type {
  EditorEvents, GridState, MacroCoord, PaintTerrainCommand, ValidationError,
} from '../../core/model/types';
import type { RuleDispatcher } from '../../core/model/rule-dispatcher';
import { getCell, scratchGrid } from '../../core/model/grid-model';
import { surfaceElevation } from '../../core/edge-cut/terrain-silhouette';
import { ELEVATION_MAX } from '../../core/model/constants';
import { applyCommand } from '../../core/commands/command-apply';
import { EventBus } from '../../core/commands/event-bus';

/** Nothing listens to a scratch grid, and the probe issues terrain commands only. */
const silentBus = new EventBus<EditorEvents>();

/** One violation as a comparable value: which rule, over which cells. */
function signature(v: ValidationError): string {
  return `${v.ruleId}:${v.cells.map((c) => `${c.x},${c.y}`).join('|')}`;
}

function violations(state: GridState, rules: RuleDispatcher): Set<string> {
  return new Set(rules.validatePostStroke(state).map(signature));
}

/**
 * The ONE layer this water stroke could legally be laid at, or null when none or several could —
 * several is not a remedy, and a refusal that lists them is a lecture.
 *
 * `cells` is the stroke's whole footprint, asked as one uniform layer: the water brush lays each
 * cell at its own height, so a stroke that crossed a step has no single layer to name and the
 * bounds above answer it without a sweep.
 */
export function soleLegalWaterLayer(
  cells: readonly MacroCoord[], state: GridState, rules: RuleDispatcher,
): number | null {
  // Off-map cells can never carry water, and left in they refuse every candidate.
  const onMap = cells.filter((c) => getCell(state.cells, c.x, c.y) !== null);
  if (onMap.length === 0) return null;

  // The window every candidate falls in, read off the ground the stroke covers: no lower than the
  // tallest surface it would otherwise excavate, and no higher than one step above the shortest
  // (V-WTR-01's own bound). A stroke that crossed a step leaves the window empty, which is the whole
  // answer for it — the rules still decide every layer inside it.
  let floor = 0;
  let ceiling = ELEVATION_MAX;
  for (const c of onMap) {
    const surface = surfaceElevation(getCell(state.cells, c.x, c.y)!.terrain);
    if (surface > floor) floor = surface;
    if (surface + 1 < ceiling) ceiling = surface + 1;
  }

  if (floor > ceiling) return null;

  const already = violations(state, rules);
  let found: number | null = null;
  for (let elevation = floor; elevation <= ceiling; elevation++) {
    const cmd: PaintTerrainCommand = {
      type: CommandType.PaintTerrain,
      timestamp: Date.now(),
      cells: [...onMap],
      terrainType: TerrainType.Water,
      elevation,
    };
    // Against the LIVE map: nothing has been laid on the scratch yet, so the two answer alike and
    // a candidate the pre-command rules refuse costs no copy.
    if (rules.validatePreCommand(cmd, state).length > 0) continue;
    const scratch = scratchGrid(state, onMap);
    applyCommand(cmd, scratch, silentBus);
    if (rules.validatePostStroke(scratch).some((v) => !already.has(signature(v)))) continue;
    if (found !== null) return null;
    found = elevation;
  }
  return found;
}
