/**
 * Director tools: high-level write tools wrapping the shared placement machinery
 * (themes/nature/network/portals). Same bridge contract as every write tool: ONE
 * silent stroke group, reject-and-skip, REVERTED feedback. A wrapper ADAPTS the
 * model's arguments to what that machinery takes — a rect becomes the cells of one
 * themed room, a region becomes an analysis — and never modifies it.
 *
 * plant_forest and build_road_network are the editor's `patch` and `roads`
 * macros, so their bodies come from `tools/macros`. The stroke stays here because
 * authorship differs: a macro run from the shell is the generator's work, one
 * run from a tool call is the model's, and the export disclosure reads that.
 */
import { ItemCategory, type GridState, type MacroCoord } from '../../core/model/types';
import {
  analyzeTerrain, makeCtx, tryPlace, forEachFootprintCell, scanPortals, decorateZone, decorateCrossing, type Zone,
} from '../../tools/placement';
import { getPlaceableByCategory } from '../../state/catalog';
import { makeRng } from '../../core/model/rng';
import { layRoadNetwork, plantPatch } from '../../tools/macros';
import type { KitContext } from '../../kit/context';
import { argError, parseSeed, revertedMsg, runStrokeBody } from './tools-common';
import type { AgentToolDeps } from './tools';
import type { ToolResultDetail } from '../core/types';

// Default seed for reproducible calls when the caller omits seed.
const DEFAULT_SEED = 0x4d616d65;

export const THEMES = ['orchard', 'farm', 'garden', 'hamlet', 'waterfront', 'peak'] as const;
type Theme = (typeof THEMES)[number];

type ToolResultBody = { content: string; isError: boolean; detail?: ToolResultDetail };

/** Clamp an {x,y,w,h} rect input to the map and build its cell list. Returns null
 *  when the clamped rect is empty (the caller reports the empty-rect error). Shared
 *  by decorate_zone and plant_forest, which take the same rect args. */
function clampRect(
  state: GridState,
  input: Record<string, unknown>,
): { cells: MacroCoord[]; rx: number; ry: number; rw: number; rh: number; x2: number; y2: number } | null {
  const { width, height } = state.template;
  const rx = Math.max(0, Math.min(Number(input.x) || 0, width - 1));
  const ry = Math.max(0, Math.min(Number(input.y) || 0, height - 1));
  const rw = Math.max(1, Number(input.w) || 1);
  const rh = Math.max(1, Number(input.h) || 1);
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
 * decorate_zone: fill a rect in a professional theme using the populator's
 * decorated room logic. ONE stroke group (one undo step). Rule-rejected
 * placement attempts are silently skipped by tryPlace (reject-and-skip).
 */
export async function decorateZoneHandler(
  deps: AgentToolDeps,
  input: Record<string, unknown>,
): Promise<ToolResultBody> {
  // Validate theme first.
  const theme = String(input.theme) as Theme;
  if (!(THEMES as readonly string[]).includes(theme)) {
    return argError(`unknown theme "${theme}", valid themes: ${THEMES.join(', ')}.`, 'theme: "garden"');
  }

  const state = deps.getState();
  const { width } = state.template;

  const clamped = clampRect(state, input);
  if (!clamped) {
    return argError('the rect is empty after clamping to the map, pass x, y, w, h inside it.', 'x: 10, y: 10, w: 8, h: 6');
  }
  const { cells: rectCells, rx, ry, rw, rh, x2, y2 } = clamped;

  const seed = parseSeed(input, DEFAULT_SEED);

  const exec = deps.getExecutor();
  const reg = exec.getRegistry();

  let placed = 0;

  const { reverted, violations, outOfRegion, detail } = await runStrokeBody(deps, () => {
    // Restrict analysis to the rect so the open mask only covers our area,
    // exactly mirroring the run_generator region-restricted path.
    const a = analyzeTerrain(state, rectCells);

    // Build the rect's placeable cells (intersect with a.open).
    const placeableCells: number[] = [];
    // Compute centroid from the open (placeable) cells inside the rect.
    let sumX = 0, sumY = 0;
    for (const c of rectCells) {
      const idx = c.y * width + c.x;
      if (a.open[idx] === 1) {
        placeableCells.push(idx);
        sumX += c.x;
        sumY += c.y;
      }
    }
    // If no placeable cells, fall back to all rect cells (decorators will skip
    // non-open ones via the openAt guard inside tryPlace).
    const cellsForZone = placeableCells.length > 0 ? placeableCells : rectCells.map((c) => c.y * width + c.x);
    const centroid: MacroCoord = placeableCells.length > 0
      ? { x: Math.round(sumX / placeableCells.length), y: Math.round(sumY / placeableCells.length) }
      : { x: Math.round((rx + x2) / 2), y: Math.round((ry + y2) / 2) };

    const zone: Zone = { id: 0, cells: cellsForZone, centroid, theme };

    const ctx = makeCtx(state, (c) => exec.execute(c), reg, seed);
    const settled = new Set<string>();
    const rng = makeRng(seed);

    const before = state.objects.size;
    decorateZone(ctx, a, zone, 0.5, 0.5, settled, rng);
    placed = state.objects.size - before;
  });

  if (outOfRegion) return outOfRegion;
  if (reverted) {
    return { isError: true, content: revertedMsg('the decoration', violations) };
  }

  deps.onFlash?.(rectCells);

  return {
    isError: false,
    content: `Placed ${placed} object(s) with theme "${theme}" over ${rectCells.length}-cell rect (${rx},${ry})+(${rw}x${rh}). Rule-rejected placement spots were skipped.`,
    detail,
  };
}

/**
 * plant_forest: the `patch` macro over the given rect, so the tool and the editor's smart-build
 * shelf plant from one implementation. ONE stroke group, authored by the model rather than by the
 * generator — which is why the stroke stays here and only the planting comes from `tools/macros`.
 */
export async function plantForestHandler(
  deps: AgentToolDeps,
  input: Record<string, unknown>,
): Promise<ToolResultBody> {
  const state = deps.getState();

  const clamped = clampRect(state, input);
  if (!clamped) {
    return argError('the rect is empty after clamping to the map, pass x, y, w, h inside it.', 'x: 10, y: 10, w: 8, h: 6');
  }
  const { cells: rectCells, rx, ry, rw, rh } = clamped;

  // density defaults to 0.6 when not provided; NaN from Number(undefined) becomes 0.6 via fallback.
  const rawDensity = Number(input.density);
  const density = Math.max(0, Math.min(1, Number.isFinite(rawDensity) ? rawDensity : 0.6));
  const seed = parseSeed(input, DEFAULT_SEED);

  const exec = deps.getExecutor();
  const kit: KitContext = { state, executor: exec, registry: exec.getRegistry() };

  const { reverted, violations, result: placed, outOfRegion, detail } = await runStrokeBody(deps, () =>
    plantPatch(kit, { cells: rectCells, density, seed }),
  );

  if (outOfRegion) return outOfRegion;
  if (reverted) {
    return { isError: true, content: revertedMsg('the forest', violations) };
  }

  deps.onFlash?.(rectCells);

  return {
    isError: false,
    content: `Planted ${placed} object(s) (trees + flora) over ${rectCells.length}-cell rect (${rx},${ry})+(${rw}x${rh}) at density ${density.toFixed(2)}. Rule-rejected placement spots were skipped.`,
    detail,
  };
}

/**
 * build_road_network: the `roads` macro over the user's painted region, or the whole map when
 * nothing is painted, so the tool and the editor's
 * smart-build shelf route from one implementation. ONE stroke group, authored by the model rather
 * than by the generator — which is why the stroke stays here and only the routing comes from
 * `tools/macros`.
 */
export async function buildRoadNetworkHandler(
  deps: AgentToolDeps,
  input: Record<string, unknown>,
): Promise<ToolResultBody> {
  const state = deps.getState();
  const seed = parseSeed(input, DEFAULT_SEED);

  const exec = deps.getExecutor();
  const kit: KitContext = { state, executor: exec, registry: exec.getRegistry() };
  // The router plans over the whole analysis, so a region has to reach it as an input: a network
  // designed island-wide and then refused for straying would never lay a road at all.
  const region = deps.getRegion();

  const { reverted, violations, result: routed, outOfRegion, detail } = await runStrokeBody(deps, () =>
    layRoadNetwork(kit, { seed, ...(region.length > 0 ? { region } : {}) }),
  );

  if (outOfRegion) return outOfRegion;
  if (reverted) {
    return { isError: true, content: revertedMsg('the road network', violations) };
  }
  if (routed.reason) return { isError: true, content: `No road network was laid: ${routed.reason}.` };

  const buildingCount = [...state.objects.values()].filter((o) => !o.locked).length;
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
 * frame_crossing: scan portals, pick nearest to (x,y), realize that crossing
 * (bridge or ramp) with the mirrored flora scene. Gracefully reports "no
 * crossing site found" when the map has no valid portals.
 *
 * scanPortals mutates nothing: its dry-run tryPlace+removePlaced pairs run through
 * ctx.execute inside runSilently, so the event bus stays quiet and removePlaced
 * synchronously undoes each dry-run place. Only the realized crossing commits.
 */
export async function frameCrossingHandler(
  deps: AgentToolDeps,
  input: Record<string, unknown>,
): Promise<ToolResultBody> {
  const state = deps.getState();
  const targetX = Number(input.x) || 0;
  const targetY = Number(input.y) || 0;
  const seed = parseSeed(input, DEFAULT_SEED);

  const exec = deps.getExecutor();
  const reg = exec.getRegistry();

  // Same reason as build_road_network: the portal scan reaches every seam on the map unless the
  // placeable mask confines it, and a crossing framed outside the user's region is refused anyway.
  const region = deps.getRegion();

  let resultMsg = '';

  const { reverted, violations, outOfRegion, detail } = await runStrokeBody(deps, () => {
    const a = analyzeTerrain(state, region.length > 0 ? region : null);
    const ctx = makeCtx(state, (c) => exec.execute(c), reg, seed);

    // Each candidate is validated by a dry-run place inside this runSilently context.
    const { portals } = scanPortals(ctx, a);

    if (portals.length === 0) {
      resultMsg = 'No crossing site found on this map (no valid bridge or ramp positions detected).';
      return;
    }

    // Pick the portal nearest to the target (x,y).
    const nearest = portals.reduce((best, p) => {
      const da = (p.anchor.x - targetX) ** 2 + (p.anchor.y - targetY) ** 2;
      const db = (best.anchor.x - targetX) ** 2 + (best.anchor.y - targetY) ** 2;
      return da < db ? p : best;
    });

    // Select the first item from the matching catalog pool.
    const pool = nearest.kind === 'bridge'
      ? getPlaceableByCategory(ItemCategory.Bridge)
      : getPlaceableByCategory(ItemCategory.Ramp);

    const itemId = pool[0]?.id;
    if (!itemId) {
      resultMsg = `No ${nearest.kind} item found in the catalog.`;
      return;
    }

    // Realize the crossing — portal was pre-validated so this should succeed.
    const placed = tryPlace(ctx, itemId, nearest.anchor.x, nearest.anchor.y);
    if (!placed) {
      resultMsg = `Crossing site at (${nearest.anchor.x},${nearest.anchor.y}) could not be realized (rule rejected).`;
      return;
    }

    // Frame with a mirrored flora scene on both ends of the crossing.
    const rng = makeRng(seed);
    const settled = new Set<string>();
    forEachFootprintCell(placed, (x, y) => settled.add(`${x},${y}`));
    decorateCrossing(ctx, a, placed, settled, rng);

    resultMsg = `Placed ${nearest.kind} at (${nearest.anchor.x},${nearest.anchor.y}) connecting regions ${nearest.regionA} and ${nearest.regionB}, with mirrored flora scene.`;
  });

  if (outOfRegion) return outOfRegion;
  if (reverted) {
    return { isError: true, content: revertedMsg('the crossing', violations) };
  }

  return { isError: false, content: resultMsg, detail };
}
