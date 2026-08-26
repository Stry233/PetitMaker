/*
 * road-trim-preview.ts — what auto-trim WILL do to a road stroke, worked out before the stroke.
 *
 * The terrain twin of this (`trim-preview.ts`) runs the real trim pass over a scratch copy of the
 * CELLS. A road is not a cell: it is an object carrying a `surfaceCoating` trait, and every
 * "what is paved here?" question in the cut geometry goes through `state/object-index:roadLookup`.
 * Putting the stroke's unlaid tiles on a scratch grid would therefore mean placing objects and
 * rebuilding that index on every pointer move.
 *
 * So the scratch here is the LOOKUP, not the grid. `applyAutoEdgeCut` takes the coating lookup as
 * an argument (`EdgeCutCtx.roads`), and this module hands it one that answers for the map's roads
 * PLUS the tiles the ghost is about to lay — so the REAL pass runs, over the real rules, and the
 * cut it picks for a ghost cell is the cut the click will commit. Nothing about the road cut
 * geometry is re-derived here.
 *
 * Terrain is untouched by a road stroke, so the live grid is passed through as-is; only the
 * coatings are shadowed, copy-on-write, so a cut landing on a road already on the map is visible
 * to the next candidate without touching the object the renderer is holding.
 */
import { CommandType } from '../../core/model/types';
import type {
  AutoEdgeCut, Command, Corners, GridState, MacroCoord, PlacedObject, ValidationResult,
} from '../../core/model/types';
import { cellKey } from '../../core/model/grid-model';
import type { RoadLookup } from '../../core/model/road-lookup';
import { detectRoadConn } from '../../core/edge-cut/road-cut-states';
import type { RuleDispatcher } from '../../core/model/rule-dispatcher';
import { roadLookup } from '../../state/object-index';
import { strippableRefusal } from '../paint/tile-coating';
import { applyAutoEdgeCut } from './auto-edge-cut';
import { region, TRIM_PREVIEW_MAX_RIM, type GhostShape, type TrimmedCell } from './trim-preview';

const REFUSED: ValidationResult = { success: false, errors: [] };
const APPLIED: ValidationResult = { success: true, errors: [] };
const EMPTY: ReadonlySet<string> = new Set<string>();

/**
 * The cuts a road stroke over `shape` will leave on its OWN tiles.
 *
 * `plan` is the click's own command plan for a cell list (`planPaint` with content 'tile'), so
 * which cells actually get paved is decided by the same code the click runs, then gated by the
 * same pre-command rules. A cell the rules refuse is not paved, and its neighbours are previewed
 * as the end-caps that refusal leaves them.
 *
 * `laidThisStroke` is the freehand brush's record of what it has already put down (its
 * `tileStrokeCells`). A dab is previewed against a map the same stroke has been editing, and the
 * cuts standing on those tiles are provisional — see `priorWindow` below.
 *
 * Returns an empty list when there is nothing to show: trim off, no shape, or a stroke whose tiles
 * all stay square (every interior tile does — `validateCut` forces a through-road square).
 */
export function previewRoadTrim(
  state: GridState,
  mode: AutoEdgeCut,
  shape: GhostShape,
  rules: RuleDispatcher,
  plan: (cells: readonly MacroCoord[]) => readonly Command[],
  laidThisStroke: ReadonlySet<string> = EMPTY,
): TrimmedCell[] {
  if (mode === 'off' || shape.rim.length === 0 || shape.rim.length > TRIM_PREVIEW_MAX_RIM) return [];

  // The rim and one ring inside it: the only cells a cut can land on, plus the ones whose being
  // paved decides those cuts. A tile deeper in has a road on all four sides and is forced square by
  // validateCut, so `at` below can answer for it without asking the rules — which is what keeps the
  // preview's cost proportional to the shape's outline rather than its area. The rim comes first so
  // the pass walks the cells that can be cut in the order the stroke lays them; a cut can depend on
  // one its neighbour took first.
  const rimSet = new Set(shape.rim.map((c) => cellKey(c.x, c.y)));
  const reach = region(shape.rim, 1);
  const candidates = [
    ...shape.rim,
    ...reach.filter((c) => shape.contains(c.x, c.y) && !rimSet.has(cellKey(c.x, c.y))),
  ];
  const planned = new Map<string, PlacedObject>();
  for (const cmd of plan(candidates)) {
    if (cmd.type !== CommandType.PlaceObject) continue;
    const errors = rules.validatePreCommand(cmd, state);
    // The click strips the coating it covers before placing, so a refusal that is only that
    // coating's overlap is a cell the click WILL pave — the same answer the cursor probe gives.
    if (errors.length > 0 && !strippableRefusal(state, cmd.object.position, errors)) continue;
    planned.set(cellKey(cmd.object.position.x, cmd.object.position.y), cmd.object);
  }
  // What was ASKED about and refused is not the same as what was never asked: a cell inside the
  // shape that the rules turn down keeps whatever the map already holds there, and its neighbour is
  // the end-cap that refusal leaves. Without this the shape's own footprint would answer for it and
  // the ghost would promise a through-road across a gap the click cannot pave.
  const asked = new Set(candidates.map((c) => cellKey(c.x, c.y)));
  const laid = candidates.filter((c) => planned.has(cellKey(c.x, c.y)));
  if (laid.length === 0) return [];

  const material = planned.values().next().value?.catalogId ?? '';
  const live = roadLookup(state);
  const shadow = new Map<string, PlacedObject>();
  const interior = new Map<string, PlacedObject>();

  // The stroke's OWN earlier tiles, beside the shape. A freehand brush lays as it moves and trims
  // what it has laid, so by the time this dab is previewed its neighbour may be carrying the
  // end-cap it was given while it still WAS the end — and the click will take that back
  // (`liveTrim` squares the stroke's cells in the dab's window before re-deriving, because the trim
  // keeps the cuts it finds). Reading the stale cut instead fails every candidate state against the
  // neighbour's kept-edge check, so the ghost promises nothing where the click cuts a wedge.
  // Squaring them here is that same step, and putting them in the pass is what re-derives them.
  const priorWindow = reach
    .filter((c) => laidThisStroke.has(cellKey(c.x, c.y)) && !asked.has(cellKey(c.x, c.y)));
  for (const { x, y } of priorWindow) {
    const road = live(x, y);
    if (road) shadow.set(cellKey(x, y), { ...road, corners: undefined });
  }

  /** The map's coatings with the ghost's tiles laid over them, and any cut this pass has made. */
  const at: RoadLookup = (x, y) => {
    const k = cellKey(x, y);
    const cut = shadow.get(k);
    if (cut) return cut;
    const ghost = planned.get(k);
    if (ghost) return ghost;
    if (asked.has(k) || !shape.contains(x, y)) return live(x, y);
    // Inside the shape but never planned: deep interior. A tile there is paved by construction (a
    // refusal can only be found by asking, and asking about the interior is what the rim bound
    // exists to avoid) and is never a cut candidate — only its position and id are ever read.
    let synth = interior.get(k);
    if (!synth) {
      synth = { id: `ghost:${k}`, catalogId: material, position: { x, y }, rotation: 0, elevation: 0 };
      interior.set(k, synth);
    }
    return synth;
  };

  const owned = new Set(laid.map((c) => cellKey(c.x, c.y)));
  const cuts = new Map<string, Corners>();
  applyAutoEdgeCut({
    gridState: state,
    roads: at,
    executeCommand: (cmd: Command): ValidationResult => {
      if (cmd.type !== CommandType.TrimCorners || cmd.layer !== 'road') return REFUSED;
      const k = cellKey(cmd.x, cmd.y);
      const road = at(cmd.x, cmd.y);
      if (!road) return REFUSED;
      const corners = [...cmd.afterCorners] as Corners;
      shadow.set(k, { ...road, corners });
      if (owned.has(k)) cuts.set(k, corners);
      return APPLIED;
    },
  }, mode, [], [...laid, ...priorWindow]);

  // The connection side is read from the FINISHED lookup, exactly as each view reads it off the
  // finished map when it draws a laid road — a tile's neighbours are all in place by then.
  const out: TrimmedCell[] = [];
  for (const { x, y } of laid) {
    const corners = cuts.get(cellKey(x, y));
    const road = corners && at(x, y);
    if (!corners || !road) continue;
    out.push({ x, y, corners, patch: false, road: detectRoadConn(at, road) });
  }
  return out;
}
