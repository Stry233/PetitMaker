/**
 * Read-only search tools: enumerate sites the model can act on — flat areas a
 * footprint fits, legal bridge anchors, and validated ramp anchors. None mutate
 * state; bridge/ramp scans reuse the exact rule-layer detectors (detectBridgeSpan
 * and the registry's pre-command validation) so a returned site is placeable.
 */
import {
  ItemCategory,
  TerrainType,
  type GridState,
  type MacroCoord,
  type PlacedObject,
} from '../../core/model/types';
import { getCell, isBuildableZone } from '../../core/model/grid-model';
import { getCatalogItem, getCatalogByCategory } from '../../state/catalog';
import { surfaceElevation } from '../../core/edge-cut/terrain-silhouette';
import { detectBridgeSpan } from '../../core/model/bridge-span';
import { footprintCells, objectRect } from '../../state/object-geometry';
import { type AgentToolDeps, type ToolResultBody, argError, waterSpanTrait } from './tools-common';
import { pointInput } from './geometry';
import { objectPlacementCommand } from '../../tools/objects';

/* ── search: flat areas a footprint fits on ─────────────────────────── */

export function findFlatAreas(deps: AgentToolDeps, input: Record<string, unknown>): ToolResultBody {
  const state = deps.getState();
  const { width, height } = state.template;
  const minW = Number(input.minWidth);
  const minH = Number(input.minHeight);
  if (!Number.isInteger(minW) || !Number.isInteger(minH) || minW < 1 || minH < 1) {
    return argError('minWidth and minHeight must be positive integers.', 'minWidth: 3, minHeight: 3');
  }
  const elevation = input.elevation !== undefined ? Number(input.elevation) : 0;
  const limit = Math.min(Math.max(Number(input.limit) || 5, 1), 10);
  const near = pointInput(input, 'near') ?? { x: Math.floor(width / 2), y: Math.floor(height / 2) };
  // match the flat trait's check area: footprint + 1 cell right/bottom
  const needW = minW + 1;
  const needH = minH + 1;

  const occupied = new Set<string>();
  for (const o of state.objects.values()) {
    const r = objectRect(o);
    // footprintCells, not `pos + integer offset`: a half-integer origin (a halfStep ramp/bridge)
    // would add a fractional key ("4.5,4") the integer probe below never matches, and a deck's
    // own cells would read as flat and unoccupied.
    for (const { x, y } of footprintCells(r.x, r.y, r.w, r.h)) occupied.add(`${x},${y}`);
  }
  const ok = (x: number, y: number): boolean => {
    const cell = state.cells[y]?.[x];
    if (!cell || !isBuildableZone(cell.zone) || occupied.has(`${x},${y}`)) return false;
    const tr = cell.terrain;
    if (tr?.patchOnly || tr?.type === TerrainType.Water) return false;
    return (tr?.elevation ?? 0) === elevation && (elevation === 0 || tr?.type === TerrainType.Mountain);
  };
  // prefix sums over the ok-grid → O(1) window checks
  const sums = new Int32Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      sums[(y + 1) * (width + 1) + (x + 1)] =
        (ok(x, y) ? 1 : 0) + sums[y * (width + 1) + (x + 1)]! + sums[(y + 1) * (width + 1) + x]! - sums[y * (width + 1) + x]!;
    }
  }
  const windowFull = (x: number, y: number): boolean =>
    sums[(y + needH) * (width + 1) + (x + needW)]! - sums[y * (width + 1) + (x + needW)]! - sums[(y + needH) * (width + 1) + x]! + sums[y * (width + 1) + x]! === needW * needH;

  const anchors: MacroCoord[] = [];
  for (let y = 0; y + needH <= height; y++) {
    for (let x = 0; x + needW <= width; x++) {
      if (windowFull(x, y)) anchors.push({ x, y });
    }
  }
  if (anchors.length === 0) {
    return { isError: false, content: `No flat ${minW}x${minH} spot at elevation ${elevation}. Try a smaller footprint, another elevation, or flatten an area first.` };
  }
  anchors.sort((a, b) => (Math.abs(a.x - near.x) + Math.abs(a.y - near.y)) - (Math.abs(b.x - near.x) + Math.abs(b.y - near.y)));
  const picked: MacroCoord[] = [];
  const minGap = Math.max(minW, minH);
  for (const a of anchors) {
    if (picked.length >= limit) break;
    if (picked.every((p) => Math.abs(p.x - a.x) > minGap || Math.abs(p.y - a.y) > minGap)) picked.push(a);
  }
  return {
    isError: false,
    content: `${anchors.length} anchor(s) fit a ${minW}x${minH} footprint at elevation ${elevation}. Nearest (spread apart): ${picked.map((p) => `(${p.x},${p.y})`).join(' ')}`,
  };
}

/* ── search: legal bridge anchors (reuses the rule's own span detector) ── */

interface BridgeSite { x: number; y: number; rotation: number; spanLength: number; elevation: number }

export function scanBridgeSites(state: GridState, bridgeWidth: number, min: number, max: number, near: MacroCoord, limit: number): BridgeSite[] {
  const { width, height } = state.template;
  const seen = new Set<string>();
  const sites: BridgeSite[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // detectBridgeSpan anchors on a GAP cell (water / void / lower ground) and
      // walks outward for the raised ends — so candidate anchors are exactly the
      // cells that are NOT plain buildable ground at their surroundings' level.
      // Trying every cell is cheap (early-outs); dedupe by the snapped placement.
      const span = detectBridgeSpan(state, { x, y }, bridgeWidth, min, max);
      if (!span) continue;
      const key = `${span.position.x},${span.position.y},${span.rotation}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // report the ANCHOR (the scanned gap cell): aiming place_object at it
      // reproduces this exact detection; the snapped origin would NOT re-detect.
      sites.push({ x, y, rotation: span.rotation, spanLength: span.spanLength, elevation: span.elevation });
    }
  }
  sites.sort((a, b) => (Math.abs(a.x - near.x) + Math.abs(a.y - near.y)) - (Math.abs(b.x - near.x) + Math.abs(b.y - near.y)));
  return sites.slice(0, limit);
}

export function findBridgeSites(deps: AgentToolDeps, input: Record<string, unknown>): ToolResultBody {
  const state = deps.getState();
  const catalogId = String(input.catalogId ?? 'bridge-plank');
  const item = getCatalogItem(catalogId);
  const trait = waterSpanTrait(item);
  if (!item || !trait) return argError(`"${catalogId}" is not a bridge (no waterSpan trait).`, 'catalogId: "bridge-plank"');
  const limit = Math.min(Math.max(Number(input.limit) || 6, 1), 10);
  const near = pointInput(input, 'near') ?? { x: Math.floor(state.template.width / 2), y: Math.floor(state.template.height / 2) };
  const sites = scanBridgeSites(state, item.width, trait.min, trait.max, near, limit);
  if (sites.length === 0) {
    return {
      isError: false,
      content: 'No legal bridge site on the map. A bridge needs a STRAIGHT gap of 3-6 cells (water/void/lower ground) with flat, equal-height land on both ends — reshape a channel to a uniform 3-6 cell width first (rect water reads better than circles for crossings).',
    };
  }
  return {
    isError: false,
    content: `Legal ${catalogId} anchors (pass x,y straight to place_object):\n${sites.map((s) => `(${s.x},${s.y}) rot=${s.rotation} span=${s.spanLength} elev=${s.elevation}`).join('\n')}`,
  };
}

/* ── ramp site scanner: cliff-edge enumeration + pre-command validation ── */

/** Cardinal offsets for the four directions. */
const RAMP_DIRS = [
  { dx: 0, dy: -1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 },
] as const;

interface RampSite {
  anchor: MacroCoord;
  rampId: string;
  highElev: number;
  lowElev: number;
}

/** Enumerate every cliff-edge cell that a catalog ramp could validly connect, using
 *  pre-command validation (registry.validatePreCommand — read-only, no mutation).
 *
 *  A candidate anchor is a cell whose realSurface elevation is `e` (the HIGH side)
 *  and has a cardinal neighbor whose realSurface is `e - heightDrop.layers` (the LOW
 *  side). We validate with the registry's pre-command rules so the same placement
 *  constraints the placement ghost uses (flat, noFloat, zone, etc.) are applied
 *  without touching state. */
function scanRampSites(deps: AgentToolDeps, near: MacroCoord, limit: number): RampSite[] {
  const state = deps.getState();
  const exec = deps.getExecutor();
  const reg = exec.getRegistry();
  const { width, height } = state.template;

  // Collect ramp items grouped by their heightDrop.layers value.
  const rampsByDrop = new Map<number, string[]>();
  for (const item of getCatalogByCategory(ItemCategory.Ramp)) {
    const trait = item.traits.find((t): t is Extract<typeof t, { type: 'heightDrop' }> => t.type === 'heightDrop');
    if (!trait) continue;
    const list = rampsByDrop.get(trait.layers) ?? [];
    list.push(item.id);
    rampsByDrop.set(trait.layers, list);
  }
  if (rampsByDrop.size === 0) return [];

  const seen = new Set<string>();
  const sites: RampSite[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = getCell(state.cells, x, y);
      const anchorElev = surfaceElevation(cell?.terrain);

      for (const { dx, dy } of RAMP_DIRS) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const neighborCell = getCell(state.cells, nx, ny);
        const neighborElev = surfaceElevation(neighborCell?.terrain);
        const drop = anchorElev - neighborElev;
        if (drop <= 0) continue; // anchor must be the high side

        const rampIds = rampsByDrop.get(drop);
        if (!rampIds || rampIds.length === 0) continue;

        // Pick the first ramp with this heightDrop to validate with.
        const rampId = rampIds[0]!;
        const item = getCatalogItem(rampId);
        if (!item) continue;

        const siteKey = `${x},${y},${rampId}`;
        if (seen.has(siteKey)) continue;

        // Validate via pre-command rules (non-mutating path — identical to the ghost).
        const candidate: PlacedObject = {
          id: '__ramp_probe__',
          catalogId: rampId,
          position: { x, y },
          rotation: 0,
          elevation: anchorElev,
        };
        const cmd = objectPlacementCommand(candidate);
        const errors = reg.validatePreCommand(cmd, state);
        if (errors.length > 0) continue;

        seen.add(siteKey);
        sites.push({ anchor: { x, y }, rampId, highElev: anchorElev, lowElev: neighborElev });
      }
    }
  }

  sites.sort((a, b) =>
    (Math.abs(a.anchor.x - near.x) + Math.abs(a.anchor.y - near.y)) -
    (Math.abs(b.anchor.x - near.x) + Math.abs(b.anchor.y - near.y)),
  );
  return sites.slice(0, limit);
}

export function findRampSites(deps: AgentToolDeps, input: Record<string, unknown>): ToolResultBody {
  const state = deps.getState();
  const limit = Math.min(Math.max(Number(input.limit) || 6, 1), 10);
  const near = pointInput(input, 'near') ??
    { x: Math.floor(state.template.width / 2), y: Math.floor(state.template.height / 2) };
  const sites = scanRampSites(deps, near, limit);
  if (sites.length === 0) {
    return {
      isError: false,
      content:
        'No ramp sites found: no cliffs match any catalog ramp\'s heightDrop. Build a terrace first (sculpt_terrace or paint_terrain mountain elev 1+), then call find_ramp_sites again.',
    };
  }
  const lines = sites.map(
    (s) => `(${s.anchor.x},${s.anchor.y}) ${s.rampId}: elev ${s.highElev} -> elev ${s.lowElev}`,
  );
  return {
    isError: false,
    content: `Validated ramp anchors (aim place_object at the anchor cell — the heightDrop snap will orient the ramp):\n${lines.join('\n')}`,
  };
}
