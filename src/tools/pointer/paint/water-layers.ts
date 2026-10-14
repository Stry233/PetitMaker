/**
 * Which layer could hold this water: the remedy a refused water stroke names. A refusal is nearly
 * always a height that does not fit the waterfall rules (caps at exactly the water's layer, a uniform
 * row under its lip); where exactly one layer would hold the stroke, the refusal names it.
 *
 * The answer runs the real rules over a scratch of the live map (`scratchGrid`): pre-command per
 * candidate, then the post-stroke sweep judged as a delta against what the map already breaks.
 * Candidates run from a cell's own surface to one step above it (V-WTR-01's bound; lower would be an
 * excavation), so a stroke across a step is answered without the rules, and anything else costs at
 * most two whole-map sweeps, once, at refusal time.
 */
import { paintTerrainCommand } from '../../../core/model/command-build';
import { TerrainType } from '../../../core/model/types';
import type { GridState, MacroCoord, PaintTerrainCommand, ValidationError } from '../../../core/model/types';
import type { EditorEvents } from '../../../state/editing/events';
import type { RuleDispatcher } from '../../../core/model/rule-dispatcher';
import { getCell, scratchGrid } from '../../../core/model/grid-model';
import { surfaceElevation } from '../../../core/domain/terrain/terrain-surface';
import { applyCommand } from '../../../core/commands/command-apply';
import { applyTrim } from '../../../core/domain/edge-cut/trim-apply';
import { EventBus } from '../../../core/commands/event-bus';
import { ELEVATION_MAX } from '../../../core/game/profile';
import { cellKey } from '../../../core/grid/rect';

/** One violation as a comparable value: which rule, over which cells. */
function signature(v: ValidationError): string {
  return `${v.ruleId}:${v.cells.map((c) => cellKey(c.x, c.y)).join('|')}`;
}

function violations(state: GridState, rules: RuleDispatcher): Set<string> {
  return new Set(rules.validatePostStroke(state).map(signature));
}

/**
 * The one layer this water stroke could legally be laid at, or null when none or several could —
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
  // Nothing listens to a scratch grid, and the probe issues terrain commands only.
  const silentBus = new EventBus<EditorEvents>();
  let found: number | null = null;
  for (let elevation = floor; elevation <= ceiling; elevation++) {
    const cmd: PaintTerrainCommand = paintTerrainCommand([...onMap], TerrainType.Water, elevation);
    // Against the live map: nothing has been laid on the scratch yet, so the two answer alike and
    // a candidate the pre-command rules refuse costs no copy.
    if (rules.validatePreCommand(cmd, state).length > 0) continue;
    const scratch = scratchGrid(state, onMap);
    applyCommand(cmd, scratch, silentBus, applyTrim);
    if (rules.validatePostStroke(scratch).some((v) => !already.has(signature(v)))) continue;
    if (found !== null) return null;
    found = elevation;
  }
  return found;
}
