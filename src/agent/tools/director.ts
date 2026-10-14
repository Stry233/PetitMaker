/**
 * Director tools: high-level write tools wrapping the shared placement machinery
 * (themes/nature/network/portals). Same bridge contract as every write tool: One
 * silent stroke group, reject-and-skip, reverted feedback. A wrapper adapts the
 * model's arguments to what that machinery takes — a rect becomes the cells of one
 * themed room, a region becomes an analysis — and never modifies it.
 *
 * plant_forest and build_road_network are the editor's `patch` and `roads`
 * macros, so their bodies come from `tools/macros`. The stroke stays here because
 * authorship differs: a macro run from the shell is the generator's work, one
 * run from a tool call is the model's, and the export disclosure reads that.
 */
import type { GridState, MacroCoord } from '../../core/model/types';
import { roleOf } from '../../state/catalog';
import {
  decorateRoom, frameCrossingNear, layRoadNetwork, PATCH_SPAN, plantPatch, ROOM_THEMES, type FramedCrossing, type RoomTheme,
} from '../../tools/macros';
import type { EditContext } from '../../core/commands/edit-context';
import { PLACEMENT_GRID } from '../../core/game/profile';
import { cellSet } from '../../core/grid/grids';
import type { AgentToolDeps } from './deps';
import { argError } from './feedback';
import { int, num, obj, oneOf, req } from './schema';
import { defineTool, type ToolOutcome } from './spec';
import { runStrokeBody } from './stroke';

// Default seed for reproducible calls when the caller omits seed.
const DEFAULT_SEED = 0x4d616d65;
const DEFAULT_DENSITY = 0.6;

/** Clamp an {x,y,w,h} rect input to the map and build its cell list. Returns null
 *  when the clamped rect is empty (the caller reports the empty-rect error). Shared
 *  by decorate_zone and plant_forest, which take the same rect args. */
function clampRect(
  state: GridState,
  input: { x: number; y: number; w: number; h: number },
): { cells: MacroCoord[]; rx: number; ry: number; rw: number; rh: number; x2: number; y2: number } | null {
  const { width, height } = state.template;
  const rx = Math.max(0, Math.min(input.x, width - 1));
  const ry = Math.max(0, Math.min(input.y, height - 1));
  const rw = Math.max(1, input.w);
  const rh = Math.max(1, input.h);
  const x2 = Math.min(rx + rw - 1, width - 1);
  const y2 = Math.min(ry + rh - 1, height - 1);
  const cells: MacroCoord[] = [];
  for (let y = ry; y <= y2; y++) {
    for (let x = rx; x <= x2; x++) {
      cells.push({ x, y });
    }
  }
  return cells.length === 0 ? null : { cells, rx, ry, rw, rh, x2, y2 };
}

/**
 * decorate_zone: the rect decorated as one themed room. One stroke group (one undo step);
 * rule-rejected placements are skipped.
 */
const RECT_CALL = 'x: 10, y: 10, w: 8, h: 6';
const rectFields = { x: req(int()), y: req(int()), w: req(int()), h: req(int()) };

export const decorateZoneTool = defineTool({
  description: "Decorate a rect in a professional theme using the procedural populator's decorators: orchard (fruit grids), farm (crop rows), garden (flower beds), hamlet (homes + gardens), waterfront (promenade), peak (lookout ring). Places MANY objects in one validated stroke. Use it instead of placing objects one by one.",
  input: obj({ ...rectFields, theme: req(oneOf([...ROOM_THEMES])), seed: int() }),
  access: 'write',
  example: `${RECT_CALL}, theme: "garden"`,
  run: decorateRect,
});

async function decorateRect(
  deps: AgentToolDeps, input: { x: number; y: number; w: number; h: number } & { theme: RoomTheme; seed?: number },
): Promise<ToolOutcome> {
  const { theme } = input;
  const state = deps.getState();

  const clamped = clampRect(state, input);
  if (!clamped) {
    return argError('the rect is empty after clamping to the map, pass x, y, w, h inside it.', 'x: 10, y: 10, w: 8, h: 6');
  }
  const { cells: rectCells, rx, ry, rw, rh } = clamped;
  const seed = input.seed ?? DEFAULT_SEED;
  const exec = deps.getExecutor();
  const kit: EditContext = { state, executor: exec, registry: exec.getRegistry() };

  const stroke = await runStrokeBody(deps, 'the decoration', () =>
    decorateRoom(kit, rectCells, theme, seed),
  );

  if ('refusal' in stroke) return stroke.refusal;
  const { result: placed, detail } = stroke;

  deps.onFlash?.([cellSet(PLACEMENT_GRID, rectCells)]);

  return {
    isError: false,
    content: `Placed ${placed} object(s) with theme "${theme}" over ${rectCells.length}-cell rect (${rx},${ry})+(${rw}x${rh}). Rule-rejected placement spots were skipped.`,
    detail,
  };
}

/**
 * plant_forest: the `patch` macro over the given rect, so the tool and the editor's smart-build
 * shelf plant from one implementation. One stroke group, authored by the model rather than by the
 * generator — which is why the stroke stays here and only the planting comes from `tools/macros`.
 */
export const plantForestTool = defineTool({
  description: `Plant a layered forest (stands with glades, flora drifts) across the rect in one validated stroke. Species follow the ground the way a Smart Build planting does: a dominant species chosen for the ground, with accents suited to wetter, higher or edge ground. A large rect is planted as patches about ${PATCH_SPAN} cells across, each led by its own species. density 0-1 controls tree/flora density.`,
  input: obj({
    ...rectFields,
    density: num({ min: 0, max: 1, description: `Vegetation density 0-1 (default ${DEFAULT_DENSITY}).` }),
    seed: int(),
  }),
  access: 'write',
  example: RECT_CALL,
  run: plantForest,
});

async function plantForest(
  deps: AgentToolDeps, input: { x: number; y: number; w: number; h: number } & { density?: number; seed?: number },
): Promise<ToolOutcome> {
  const state = deps.getState();

  const clamped = clampRect(state, input);
  if (!clamped) {
    return argError('the rect is empty after clamping to the map, pass x, y, w, h inside it.', 'x: 10, y: 10, w: 8, h: 6');
  }
  const { cells: rectCells, rx, ry, rw, rh } = clamped;

  const density = input.density ?? DEFAULT_DENSITY;
  const seed = input.seed ?? DEFAULT_SEED;

  const exec = deps.getExecutor();
  const kit: EditContext = { state, executor: exec, registry: exec.getRegistry() };

  const stroke = await runStrokeBody(deps, 'the forest', () =>
    plantPatch(kit, { cells: rectCells, density, seed }),
  );

  if ('refusal' in stroke) return stroke.refusal;
  const { result: placed, detail } = stroke;

  deps.onFlash?.([cellSet(PLACEMENT_GRID, rectCells)]);

  return {
    isError: false,
    content: `Planted ${placed} object(s) (trees + flora) over ${rectCells.length}-cell rect (${rx},${ry})+(${rw}x${rh}) at density ${density.toFixed(2)}. Rule-rejected placement spots were skipped.`,
    detail,
  };
}

/**
 * build_road_network: the `roads` macro over the user's painted region, or the whole map when
 * nothing is painted, so the tool and the editor's
 * smart-build shelf route from one implementation. One stroke group, authored by the model rather
 * than by the generator — which is why the stroke stays here and only the routing comes from
 * `tools/macros`.
 */
export const buildRoadNetworkTool = defineTool({
  description: "Route a road network connecting the existing buildings through validated crossings (the procedural generator's region-portal router). Reads the current map's buildings and terrain to determine hub + hamlet nodes, scans for bridge/ramp crossing sites, then routes roads and any needed crossings in one stroke.",
  input: obj({ seed: int({ description: 'Determinism seed (optional).' }) }),
  // The router reaches every building on the map, far beyond anything the call names.
  access: 'wide',
  run: buildRoadNetwork,
});

async function buildRoadNetwork(deps: AgentToolDeps, input: { seed?: number }): Promise<ToolOutcome> {
  const state = deps.getState();
  const seed = input.seed ?? DEFAULT_SEED;

  const exec = deps.getExecutor();
  const kit: EditContext = { state, executor: exec, registry: exec.getRegistry() };
  // The router plans over the whole analysis, so a region has to reach it as an input: a network
  // designed planet-wide and then refused for straying would never lay a road at all.
  const region = deps.getRegion();

  const stroke = await runStrokeBody(deps, 'the road network', () =>
    layRoadNetwork(kit, { seed, ...(region.length > 0 ? { region } : {}) }),
  );

  if ('refusal' in stroke) return stroke.refusal;
  const { result: routed, detail } = stroke;
  if (routed.reason) return { isError: true, content: `No road network was laid: ${routed.reason}.` };

  // Buildings, not every object: after the run the map also holds the road tiles and crossings it laid.
  const buildingCount = [...state.objects.values()]
    .filter((o) => !o.locked && roleOf(o) === 'home').length;
  const narrowNote = routed.narrowedByPlanting
    ? ` The corridor stayed narrow at ${routed.narrowedByPlanting} cell(s) where a hand-placed tree or flower stood its ground.`
    : '';
  return {
    isError: false,
    content: `Road network placed ${routed.laid} object(s) (roads + any bridges/ramps) connecting ${buildingCount} buildings. Rule-rejected placement spots were skipped.${narrowNote}`,
    detail,
  };
}

/**
 * frame_crossing: the validated crossing site nearest (x,y), laid and framed with a mirrored flora
 * scene. The portal scan's dry-run placements run inside the silent stroke and undo themselves, so
 * only the realized crossing commits.
 */
export const frameCrossingTool = defineTool({
  description: 'Find the crossing site (bridge or ramp) nearest to (x,y), realize just that one crossing, and decorate it with a mirrored flora scene on both ends. Reports "no crossing site found" gracefully if no valid portal exists on the map.',
  input: obj({ x: req(int()), y: req(int()), seed: int() }),
  access: 'write',
  example: 'x: 40, y: 30',
  run: frameCrossing,
});

async function frameCrossing(deps: AgentToolDeps, input: { x: number; y: number; seed?: number }): Promise<ToolOutcome> {
  const state = deps.getState();
  const targetX = input.x;
  const targetY = input.y;
  const seed = input.seed ?? DEFAULT_SEED;

  const exec = deps.getExecutor();
  const kit: EditContext = { state, executor: exec, registry: exec.getRegistry() };
  // Same reason as build_road_network: the portal scan reaches every seam on the map unless the
  // placeable mask confines it, and a crossing framed outside the user's region is refused anyway.
  const region = deps.getRegion();

  const stroke = await runStrokeBody(deps, 'the crossing', () =>
    frameCrossingNear(kit, { x: targetX, y: targetY }, seed, region),
  );

  if ('refusal' in stroke) return stroke.refusal;
  const { result: framed, detail } = stroke;

  return { isError: false, content: framedText(framed), detail };
}

function framedText(framed: FramedCrossing): string {
  switch (framed.status) {
    case 'no-site': return 'No crossing site found on this map (no valid bridge or ramp positions detected).';
    case 'no-item': return `No ${framed.kind} item found in the catalog.`;
    case 'refused': return `Crossing site at (${framed.anchor.x},${framed.anchor.y}) could not be realized (rule rejected).`;
    case 'framed': return `Placed ${framed.kind} at (${framed.anchor.x},${framed.anchor.y}) connecting regions ${framed.regionA} and ${framed.regionB}, with mirrored flora scene.`;
  }
}
