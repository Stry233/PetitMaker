/**
 * Director tools: high-level write tools wrapping the procedural populator's
 * machinery (themes/nature/network/crossings). Same bridge contract as every
 * write tool: ONE silent stroke group, reject-and-skip, REVERTED feedback.
 * Wrappers ADAPT arguments to the populator's unzoned (no-ZonePlan) path — the
 * same components the zone pipeline builds on; they never modify populator
 * internals.
 */
import { ItemCategory, ObjectCategory, type GridState, type MacroCoord } from '../../core/model/types';
import { analyzeTerrain } from '../../tools/generation/placement/analysis';
import { makeCtx, tryPlace, forEachFootprintCell } from '../../tools/generation/placement/object';
import { getPlaceableByCategory } from '../../state/catalog';
import { placeNature } from '../../tools/generation/placement/nature';
import { buildNetwork } from '../../tools/generation/placement/network';
import { scanPortals } from '../../tools/generation/placement/portals';
import type { Node } from '../../tools/generation/placement/settlement';
import { decorateZone, decorateCrossing } from '../../tools/generation/placement/themes';
import { makeRng } from '../../core/model/rng';
import { objectRect } from '../../state/object-geometry';
import type { Zone } from '../../tools/generation/types';
import { parseSeed, revertedMsg, runStrokeBody } from './tools-common';
import type { AgentToolDeps } from './tools';

// Default seed for reproducible calls when the caller omits seed.
const DEFAULT_SEED = 0x4d616d65;

export const THEMES = ['orchard', 'farm', 'garden', 'hamlet', 'waterfront', 'peak'] as const;
type Theme = (typeof THEMES)[number];

type ToolResultBody = { content: string; isError: boolean };

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
    return {
      isError: true,
      content: `Unknown theme "${theme}". Valid themes: ${THEMES.join(', ')}.`,
    };
  }

  const state = deps.getState();
  const { width } = state.template;

  const clamped = clampRect(state, input);
  if (!clamped) {
    return { isError: true, content: 'Rect is empty after clamping to the map.' };
  }
  const { cells: rectCells, rx, ry, rw, rh, x2, y2 } = clamped;

  const seed = parseSeed(input, DEFAULT_SEED);

  const exec = deps.getExecutor();
  const reg = exec.getRegistry();

  let placed = 0;

  const { reverted, violations } = await runStrokeBody(deps, () => {
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

    // Minimal Zone — only the fields the six theme decorators actually read:
    //   orchard/farm/garden: zone.cells, a.width (for x = i % a.width, y = i / a.width)
    //   hamlet: zone.cells, zone.centroid
    //   waterfront: zone.cells, a.distToWater
    //   peak: zone.centroid
    const zone: Zone = {
      id: 0,
      cells: cellsForZone,
      centroid,
      level: 0,
      theme,
      bordersMap: false,
      riverside: false,
    };

    const ctx = makeCtx(state, (c) => exec.execute(c), reg, seed);
    const settled = new Set<string>();
    const rng = makeRng(seed);

    const before = state.objects.size;
    decorateZone(ctx, a, zone, 0.5, 0.5, settled, rng);
    placed = state.objects.size - before;
  });

  if (reverted) {
    return { isError: true, content: revertedMsg('the decoration', violations) };
  }

  deps.onFlash?.(rectCells);

  return {
    isError: false,
    content: `Placed ${placed} object(s) with theme "${theme}" over ${rectCells.length}-cell rect (${rx},${ry})+(${rw}x${rh}). Rule-rejected placement spots were skipped.`,
  };
}

/**
 * plant_forest: run the populator's layered ecology (stands with glades, biome
 * bands, ecotone drifts) restricted to the given rect. ONE stroke group.
 */
export async function plantForestHandler(
  deps: AgentToolDeps,
  input: Record<string, unknown>,
): Promise<ToolResultBody> {
  const state = deps.getState();

  const clamped = clampRect(state, input);
  if (!clamped) {
    return { isError: true, content: 'Rect is empty after clamping to the map.' };
  }
  const { cells: rectCells, rx, ry, rw, rh } = clamped;

  // density defaults to 0.6 when not provided; NaN from Number(undefined) becomes 0.6 via fallback.
  const rawDensity = Number(input.density);
  const density = Math.max(0, Math.min(1, Number.isFinite(rawDensity) ? rawDensity : 0.6));
  const seed = parseSeed(input, DEFAULT_SEED);

  const exec = deps.getExecutor();
  const reg = exec.getRegistry();

  let placed = 0;

  const { reverted, violations } = await runStrokeBody(deps, () => {
    // Restrict analysis to the rect — the open mask covers only the selected
    // area, so placeNature's noise walks are bounded to this region.
    const a = analyzeTerrain(state, rectCells);
    const ctx = makeCtx(state, (c) => exec.execute(c), reg, seed);
    const settled = new Set<string>();
    const before = state.objects.size;
    placeNature(ctx, a, density, settled);
    placed = state.objects.size - before;
  });

  if (reverted) {
    return { isError: true, content: revertedMsg('the forest', violations) };
  }

  deps.onFlash?.(rectCells);

  return {
    isError: false,
    content: `Planted ${placed} object(s) (trees + flora) over ${rectCells.length}-cell rect (${rx},${ry})+(${rw}x${rh}) at density ${density.toFixed(2)}. Rule-rejected placement spots were skipped.`,
  };
}

/**
 * build_road_network: connect all existing unlocked buildings via the
 * procedural router (scanPortals + buildNetwork, the UNZONED path).
 *
 * Node derivation: hub = the locked plaza (if present), else the centroid of
 * the largest open region (mirroring placeSettlement's hub logic). Every
 * unlocked House/Facility on the map becomes a hamlet node — this mirrors how
 * placeSettlement registers each placed building as a network node without
 * re-running the settlement stage. No placeSettlement logic is duplicated;
 * Node is a plain struct with {kind, pos, region} that we fill from existing
 * object positions.
 *
 * scanPortals mutation-safety: inside runSilently, each portal candidate is
 * validated with tryPlace then removePlaced (synchronous, paired). The remove
 * call cleanly undoes the dry-run place; net state change is zero before the
 * road/bridge placements that intentionally stick.
 */
export async function buildRoadNetworkHandler(
  deps: AgentToolDeps,
  input: Record<string, unknown>,
): Promise<ToolResultBody> {
  const state = deps.getState();
  const seed = parseSeed(input, DEFAULT_SEED);

  const exec = deps.getExecutor();
  const reg = exec.getRegistry();

  let placed = 0;

  const { reverted, violations } = await runStrokeBody(deps, () => {
    // Full-map analysis (unzoned path: no rect restriction).
    const a = analyzeTerrain(state, null);
    const ctx = makeCtx(state, (c) => exec.execute(c), reg, seed);

    // scanPortals validates ramp portals via tryPlace+removePlaced dry-runs.
    // All inside runSilently → event bus is quiet, removePlaced is clean.
    const { regionAdj } = scanPortals(ctx, a);

    const { width: W } = a;
    const nodes: Node[] = [];

    // Hub: the locked plaza centre, or centroid of the largest open region.
    const plaza = [...state.objects.values()].find((o) => o.locked);
    if (plaza) {
      const r = objectRect(plaza);
      const hubPos: MacroCoord = {
        x: Math.round(r.x + r.w / 2),
        y: Math.round(r.y + r.h / 2),
      };
      const hubRegion = a.region[hubPos.y * W + hubPos.x] ?? (a.rankedRegions[0] ?? 0);
      nodes.push({ kind: 'hub', pos: hubPos, region: hubRegion });
    } else if (a.rankedRegions.length > 0) {
      const cells = a.regionCells[a.rankedRegions[0]!]!;
      let sx = 0, sy = 0;
      for (const i of cells) { sx += i % W; sy += (i / W) | 0; }
      const hubPos: MacroCoord = {
        x: Math.round(sx / cells.length),
        y: Math.round(sy / cells.length),
      };
      const hubRegion = a.region[hubPos.y * W + hubPos.x] ?? a.rankedRegions[0]!;
      nodes.push({ kind: 'hub', pos: hubPos, region: hubRegion });
    }

    // Hamlet nodes from existing unlocked buildings (House + Facility).
    for (const obj of state.objects.values()) {
      if (obj.locked) continue;
      if (obj.category !== ObjectCategory.House && obj.category !== ObjectCategory.Facility) continue;
      const r = objectRect(obj);
      const pos: MacroCoord = {
        x: Math.round(r.x + r.w / 2),
        y: Math.round(r.y + r.h / 2),
      };
      const region = a.region[pos.y * W + pos.x] ?? -1;
      if (region < 0) continue;
      nodes.push({ kind: 'hamlet', pos, region });
    }

    if (nodes.length === 0) return;

    const before = state.objects.size;
    buildNetwork(ctx, a, 0.5, nodes, regionAdj);
    placed = state.objects.size - before;
  });

  if (reverted) {
    return { isError: true, content: revertedMsg('the road network', violations) };
  }

  const buildingCount = [...state.objects.values()].filter((o) => !o.locked).length;
  return {
    isError: false,
    content: `Road network placed ${placed} object(s) (roads + any bridges/ramps) connecting ${buildingCount} buildings. Rule-rejected placement spots were skipped.`,
  };
}

/**
 * frame_crossing: scan portals, pick nearest to (x,y), realize that crossing
 * (bridge or ramp) with the mirrored flora scene. Gracefully reports "no
 * crossing site found" when the map has no valid portals.
 *
 * scanPortals mutation-safety: the dry-run tryPlace+removePlaced pairs inside
 * scanPortals run through ctx.execute inside runSilently — event bus is quiet
 * and removePlaced synchronously undoes each dry-run place. Net mutation from
 * the scan is zero; only the deliberately realized crossing commits.
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

  let resultMsg = '';

  const { reverted, violations } = await runStrokeBody(deps, () => {
    const a = analyzeTerrain(state, null);
    const ctx = makeCtx(state, (c) => exec.execute(c), reg, seed);

    // scanPortals validates each candidate (tryPlace + removePlaced dry-run)
    // inside this runSilently context. Event bus is quiet; removePlaced cleanly
    // undoes each dry-run. Net mutation so far is zero.
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

  if (reverted) {
    return { isError: true, content: revertedMsg('the crossing', violations) };
  }

  return { isError: false, content: resultMsg };
}
