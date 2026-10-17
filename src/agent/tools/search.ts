/**
 * Read-only search tools: enumerate sites the model can act on — flat areas a
 * footprint fits, legal bridge anchors, and validated ramp anchors. None mutate
 * state; bridge/ramp scans reuse the exact rule-layer detectors (detectBridgeSpan
 * and the registry's pre-command validation) so a returned site is placeable.
 */
import { placeObjectCommand } from '../../core/model/command-build';
import {
  TerrainType,
  type GridState,
  type MacroCoord,
  type PlacedObject,
  type Rotation,
  ROTATIONS,
} from '../../core/model/types';
import type { ToolOutcome } from './spec';
import { getCell } from '../../core/model/grid-model';
import { groundZone, isBuildableZone, isSandZone, SAND_ZONE } from '../../core/game/zones';
import { getAllItems, getCatalogItem } from '../../state/catalog';
import { surfaceElevation } from '../../core/domain/terrain/terrain-surface';
import { detectBridgeSpan } from '../../core/domain/terrain/bridge-span';
import { hasGate, objectRect } from '../../state/object-geometry';
import { doorGroundRule } from '../../rules/door-ground';
import { footprintCells, getRotatedSize } from '../../core/grid/footprint';
import { findTrait, groundZonesOf } from '../../core/model/traits';
import type { AgentToolDeps } from './deps';
import { argError } from './feedback';
import { nearPoint, pointInput } from './geometry';
import { ELEVATION_MAX } from '../../core/game/profile';
import { int, obj, oneOf, str } from './schema';
import { defineTool } from './spec';
import { BUILDABLE_ZONES, bridgeSpanText, zoneName } from './game-terms';
import { narrowestBridgeId } from '../../tools/placement';
import { cellKey } from '../../core/grid/rect';

const nearX = int({ description: 'Prefer sites close to (nearX,nearY).' });

/* ── search: flat areas a footprint fits on ─────────────────────────── */

export const findFlatAreasTool = defineTool({
  description: `Search the whole map for flat buildable spots where a footprint of minWidth x minHeight fits (${BUILDABLE_ZONES} zone, uniform elevation, no water, no objects; includes the +1 right/bottom margin the flat trait checks, so place_object at a returned anchor will pass). Pass catalogId (and rotation) to search for that item: its own turned footprint, ${zoneName(SAND_ZONE)} as well where its groundZones allow it, and for a house the level ground its door side needs (V-PLACE-DOOR). Use this instead of guessing where things fit.`,
  input: obj({
    minWidth: int({ min: 1, description: 'Footprint width; taken from catalogId when given.' }),
    minHeight: int({ min: 1, description: 'Footprint height; taken from catalogId when given.' }),
    catalogId: str({ description: 'The item to be placed: its footprint, ground zones and door decide the fit.' }),
    rotation: oneOf([...ROTATIONS]),
    elevation: int({ min: 0, max: ELEVATION_MAX, description: 'Terrain elevation to search on (default 0 = flat ground).' }),
    nearX: int({ description: 'Prefer anchors close to (nearX,nearY).' }),
    nearY: int(),
    near: nearPoint,
    limit: int({ min: 1, max: 10, description: 'Max anchors to return (default 5, spread apart).' }),
  }),
  access: 'read',
  example: 'minWidth: 3, minHeight: 3',
  run: findFlatAreas,
});

type FlatQuery = {
  minWidth?: number; minHeight?: number; catalogId?: string; rotation?: Rotation; elevation?: number; limit?: number;
};

function findFlatAreas(deps: AgentToolDeps, input: FlatQuery): ToolOutcome {
  const state = deps.getState();
  const { width, height } = state.template;
  const item = input.catalogId ? getCatalogItem(input.catalogId) : undefined;
  if (input.catalogId && !item) return argError(`unknown catalogId "${input.catalogId}"; use an id from the CATALOG section.`);
  const rotation = input.rotation ?? 0;
  const size = item ? getRotatedSize(item, rotation) : undefined;
  const minW = size?.w ?? input.minWidth;
  const minH = size?.h ?? input.minHeight;
  if (!minW || !minH) return argError('give minWidth and minHeight, or a catalogId.');
  const zones = item ? groundZonesOf(item) : { onGrass: true, onSand: false, acrossBoundary: false };
  const elevation = input.elevation ?? 0;
  const limit = input.limit ?? 5;
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
    for (const { x, y } of footprintCells(r.x, r.y, r.w, r.h)) occupied.add(cellKey(x, y));
  }
  const level = (x: number, y: number): boolean => {
    const cell = state.cells[y]?.[x];
    if (!cell || occupied.has(cellKey(x, y))) return false;
    const tr = cell.terrain;
    if (tr?.patchOnly || tr?.type === TerrainType.Water) return false;
    return (tr?.elevation ?? 0) === elevation && (elevation === 0 || tr?.type === TerrainType.Mountain);
  };
  const onGrass = (x: number, y: number): boolean => zones.onGrass && isBuildableZone(state.cells[y]![x]!.zone);
  const onSand = (x: number, y: number): boolean => zones.onSand && isSandZone(groundZone(state.cells[y]![x]!));
  // Prefix sums over each ground's ok-grid → O(1) window checks. A window is whole on one ground,
  // or on either where the item may cross the boundary.
  const sums = (ok: (x: number, y: number) => boolean): ((x: number, y: number) => boolean) => {
    const t = new Int32Array((width + 1) * (height + 1));
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        t[(y + 1) * (width + 1) + (x + 1)] = (level(x, y) && ok(x, y) ? 1 : 0)
          + t[y * (width + 1) + (x + 1)]! + t[(y + 1) * (width + 1) + x]! - t[y * (width + 1) + x]!;
      }
    }
    const at = (x: number, y: number): number => t[y * (width + 1) + x]!;
    return (x, y) => at(x + needW, y + needH) - at(x + needW, y) - at(x, y + needH) + at(x, y) === needW * needH;
  };
  const windows = zones.acrossBoundary
    ? [sums((x, y) => onGrass(x, y) || onSand(x, y))]
    : [sums(onGrass), ...(zones.onSand ? [sums(onSand)] : [])];

  const anchors: MacroCoord[] = [];
  for (let y = 0; y + needH <= height; y++) {
    for (let x = 0; x + needW <= width; x++) {
      if (windows.some((full) => full(x, y))) anchors.push({ x, y });
    }
  }
  anchors.sort((a, b) => (Math.abs(a.x - near.x) + Math.abs(a.y - near.y)) - (Math.abs(b.x - near.x) + Math.abs(b.y - near.y)));
  // A house's door side is judged by the rule itself, nearest first, so a returned anchor holds.
  const doorHolds = (a: MacroCoord): boolean => !item || !hasGate(item)
    || doorGroundRule.validate(placeObjectCommand({ id: 'probe', catalogId: item.id, position: a, rotation, elevation }), state).length === 0;
  const picked: MacroCoord[] = [];
  let fits = 0;
  const minGap = Math.max(minW, minH);
  for (const a of anchors) {
    if (!doorHolds(a)) continue;
    fits++;
    if (picked.length < limit && picked.every((p) => Math.abs(p.x - a.x) > minGap || Math.abs(p.y - a.y) > minGap)) picked.push(a);
  }
  const what = item ? `${item.id} at rotation ${rotation} (${minW}x${minH})` : `a ${minW}x${minH} footprint`;
  if (picked.length === 0) {
    return { isError: false, content: `No flat spot for ${what} at elevation ${elevation}. Try a smaller footprint, another rotation or elevation, or flatten an area first.` };
  }
  return {
    isError: false,
    content: `${fits} anchor(s) fit ${what} at elevation ${elevation}. Nearest (spread apart): ${picked.map((p) => `(${p.x},${p.y})`).join(' ')}`,
  };
}

/* ── search: legal bridge anchors (reuses the rule's own span detector) ── */

interface BridgeSite { x: number; y: number; rotation: number; spanLength: number; elevation: number }

export function scanBridgeSites(
  state: GridState, bridgeWidth: number, span: { min: number; max: number }, near: MacroCoord, limit: number,
): BridgeSite[] {
  const { min, max } = span;
  const { width, height } = state.template;
  const seen = new Set<string>();
  const sites: BridgeSite[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // detectBridgeSpan anchors on a gap cell (water / void / lower ground) and
      // walks outward for the raised ends — so candidate anchors are exactly the
      // cells that are not plain buildable ground at their surroundings' level.
      // Trying every cell is cheap (early-outs); dedupe by the snapped placement.
      const span = detectBridgeSpan(state, { x, y }, bridgeWidth, min, max);
      if (!span) continue;
      const key = `${span.position.x},${span.position.y},${span.rotation}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // report the anchor (the scanned gap cell): aiming place_object at it
      // reproduces this exact detection; the snapped origin would not re-detect.
      sites.push({ x, y, rotation: span.rotation, spanLength: span.spanLength, elevation: span.elevation });
    }
  }
  sites.sort((a, b) => (Math.abs(a.x - near.x) + Math.abs(a.y - near.y)) - (Math.abs(b.x - near.x) + Math.abs(b.y - near.y)));
  return sites.slice(0, limit);
}

export const findBridgeSitesTool = defineTool({
  description: 'Search for spots where a bridge can legally be placed (a straight gap of water/void/lower ground within the bridge\'s waterSpan, with flat EQUAL-height banks). Returns anchor cells you can pass directly to place_object. ALWAYS use this before placing a bridge — valid sites are rare and invisible in the token grid.',
  input: obj({
    catalogId: str({ description: `Bridge item id (determines deck width); default ${narrowestBridgeId()}.` }),
    nearX,
    nearY: int(),
    near: nearPoint,
    limit: int({ min: 1, max: 10 }),
  }),
  access: 'read',
  example: 'nearX: 40, nearY: 30, limit: 5',
  run: findBridgeSites,
});

function findBridgeSites(deps: AgentToolDeps, input: { catalogId?: string; limit?: number }): ToolOutcome {
  const state = deps.getState();
  const catalogId = input.catalogId ?? narrowestBridgeId() ?? '';
  const item = getCatalogItem(catalogId);
  const trait = findTrait(item, 'waterSpan');
  if (!item || !trait) return argError(`"${catalogId}" is not a bridge (no waterSpan trait).`, `catalogId: "${narrowestBridgeId()}"`);
  const limit = input.limit ?? 6;
  const near = pointInput(input, 'near') ?? { x: Math.floor(state.template.width / 2), y: Math.floor(state.template.height / 2) };
  const sites = scanBridgeSites(state, item.width, trait, near, limit);
  if (sites.length === 0) {
    return {
      isError: false,
      content: `No legal bridge site on the map. A bridge needs a STRAIGHT gap of ${bridgeSpanText()} cells (water/void/lower ground) with flat, equal-height land on both ends — reshape a channel to a uniform ${bridgeSpanText()} cell width first (rect water reads better than circles for crossings).`,
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
 *  A candidate anchor is a cell whose realSurface elevation is `e` (the high side)
 *  and has a cardinal neighbor whose realSurface is `e - heightDrop.layers` (the low
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
  for (const item of getAllItems()) {
    const trait = findTrait(item, 'heightDrop');
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
        const cmd = placeObjectCommand(candidate);
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

export const findRampSitesTool = defineTool({
  description: 'Scan for validated ramp placements connecting elevation tiers (the ramp equivalent of find_bridge_sites). Returns anchor cells, the catalog ramp item whose heightDrop matches each cliff, and which elevations it connects. Optional nearX/nearY and limit. Use before placing ramps instead of guessing cliff edges.',
  input: obj({ nearX, nearY: int(), near: nearPoint, limit: int() }),
  access: 'read',
  example: 'nearX: 40, nearY: 30, limit: 5',
  run: findRampSites,
});

function findRampSites(deps: AgentToolDeps, input: { limit?: number }): ToolOutcome {
  const state = deps.getState();
  // The schema bounds no limit here, so an out-of-range one is clamped rather than refused.
  const limit = Math.min(Math.max(input.limit || 6, 1), 10);
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
