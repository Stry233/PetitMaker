/**
 * Compact text serialization of editor state for the LLM agent.
 *
 * One char per object cell so grids stay column-aligned in the model's context, each saying what
 * an object on that cell would stand on (`groundUnder`): mountain elevation N → the digit N; water
 * elevation N → 'A' + N; bare zones use glyphs; a cell whose ground is not one piece reads as an
 * edge (see TOKEN_LEGEND). The model never sees the terrain grid. Detailed reads are tool-driven and
 * capped at REGION_CAP per axis — the agent subdivides rather than dumping whole maps.
 */
import { TerrainType, type GridState, type MacroCoord, type PlacedObject } from '../../core/model/types';
import { isBuildableZone, isOpenSeaZone, isRimZone, type CellZone } from '../../core/game/zones';
import { getCell } from '../../core/model/grid-model';
import { cellKey, regionBounds } from '../../core/grid/rect';
import { footprintCells, terrainCellsUnder, wholeCellsInRegion } from '../../core/grid/footprint';
import { isCoating } from '../../core/model/traits';
import { getCatalogItem } from '../../state/catalog';
import { doorOf, hasGate, objectRect } from '../../state/object-geometry';
import { getMapStats } from '../../state/map-stats';
import { isChunkLoadEnforced, roundLoad } from '../../core/model/load';
import { chunkName, mapChunkOrigin } from '../../core/grid/map-chunks';
import { CHUNK_LOAD_LIMIT, CHUNK_SIZE, ELEVATION_MAX } from '../../core/game/profile';
import { BUILDABLE_ZONES, ZONE_ORDER, anchorTerm, zoneName } from './game-terms';

export const REGION_CAP = 45;

// Highest water glyph: 'A'(=0) + ELEVATION_MAX. Derived so the token vocabulary
// tracks the elevation ceiling.
const WATER_GLYPH_MAX = String.fromCharCode(65 + ELEVATION_MAX);

// A buildable zone is marked buildable, and the rim unbuildable because it draws as land.
const zoneLegend = (zone: CellZone): string =>
  `${zoneGlyph(zone)} ${zoneName(zone)}${isBuildableZone(zone) ? ' (buildable)' : isRimZone(zone) ? ' (unbuildable)' : ''}`;
const ANCHOR = anchorTerm();

/** A cell resting partly on water. */
const BANK_GLYPH = '=';
/** A cell resting on ground at two heights, none of it water. */
const STEP_GLYPH = '^';

const TOKEN_LEGEND =
  `Legend: each token is what an object on that cell stands on. ` +
  `o object footprint (occupied: placing there is refused, and terrain painted under it or under a cell touching it leaves the object's ground out; get_objects names them); ` +
  `P ${ANCHOR ? `${ANCHOR} or ` : ''}locked structure (permanent); 1-${ELEVATION_MAX} mountain at that elevation; ` +
  `A-${WATER_GLYPH_MAX} water at elevation 0-${ELEVATION_MAX} (A=0); ` +
  `${BANK_GLYPH} bank (the cell touching water: part of its ground is water); ${STEP_GLYPH} step (the cell touching a height change: its ground is at two heights); ` +
  `only bridges and ramps go on ${BANK_GLYPH} and ${STEP_GLYPH}, and painting terrain under the cells that show a token gives exactly the terrain read; ` +
  `${ZONE_ORDER.map(zoneLegend).join('; ')}.`;

/**
 * The solid objects' cells, locked and unlocked apart, built once per grid render and handed into
 * the per-cell tokenizer (a per-cell scan of state.objects is the cost the object index exists to
 * avoid). A marked cell is one the object's footprint covers, wholly or in part. Coatings (roads)
 * mark nothing: they follow a surface change rather than blocking it, and an 'o' over every paved
 * cell would hide the ground the road lies on.
 */
interface ObjectMarks { solid: Set<string>; locked: Set<string> }

function objectMarks(state: GridState): ObjectMarks {
  const solid = new Set<string>();
  const locked = new Set<string>();
  for (const obj of state.objects.values()) {
    const item = getCatalogItem(obj.catalogId);
    if (item && isCoating(item)) continue;
    const r = objectRect(obj);
    for (const { x, y } of footprintCells(r.x, r.y, r.w, r.h)) {
      solid.add(cellKey(x, y));
      if (obj.locked) locked.add(cellKey(x, y));
    }
  }
  return { solid, locked };
}

/** What an object standing on one cell would rest on. */
type Ground =
  | { kind: 'water' | 'mountain'; elevation: number }
  | { kind: 'bare'; zone: CellZone }
  | { kind: 'bank' | 'step' }
  | { kind: 'off' };

/**
 * The ground under object cell (x, y): the terrain cells it rests on, read as one. Where they are the
 * same terrain at the same elevation the cell reads as that, which is what painting under the cell
 * would lay, so a grid read and painted back changes nothing. Where they differ the cell is an edge
 * and names no terrain: a bank where any of it is water, else a step. Bare ground across two zones
 * reads as the zone that is not buildable.
 */
export function groundUnder(state: GridState, x: number, y: number): Ground {
  let first: { type: TerrainType | undefined; elevation: number } | undefined;
  let zone: CellZone | undefined;
  let mixed = false, wet = false;
  for (const t of terrainCellsUnder({ x, y, w: 1, h: 1 })) {
    const cell = getCell(state.cells, t.x, t.y);
    if (!cell) continue;
    const here = { type: cell.terrain?.type, elevation: cell.terrain?.elevation ?? 0 };
    if (here.type === TerrainType.Water) wet = true;
    if (!first) first = here;
    else if (first.type !== here.type || first.elevation !== here.elevation) mixed = true;
    if (zone === undefined || (isBuildableZone(zone) && !isBuildableZone(cell.zone))) zone = cell.zone;
  }
  if (!first || zone === undefined) return { kind: 'off' };
  if (mixed) return { kind: wet ? 'bank' : 'step' };
  if (first.type === TerrainType.Water) return { kind: 'water', elevation: first.elevation };
  if (first.type === TerrainType.Mountain) return { kind: 'mountain', elevation: first.elevation };
  return { kind: 'bare', zone };
}

/** Objects over ground in the glyph order, because occupancy is the question an exact grid gets
 *  asked (where can I paint or place): an invisible footprint was the one thing the grid could not
 *  answer, and the ground under an object is still readable from the cells around it. */
function cellToken(state: GridState, x: number, y: number, marks: ObjectMarks): string {
  const g = groundUnder(state, x, y);
  if (g.kind === 'off') return ' ';
  const key = cellKey(x, y);
  if (marks.locked.has(key)) return 'P';
  if (marks.solid.has(key)) return 'o';
  if (g.kind === 'mountain') return String(Math.min(g.elevation, ELEVATION_MAX));
  if (g.kind === 'water') return String.fromCharCode(65 + Math.min(g.elevation, ELEVATION_MAX));
  if (g.kind === 'bank') return BANK_GLYPH;
  return g.kind === 'bare' ? zoneGlyph(g.zone) : STEP_GLYPH;
}

/** The token a bare cell of `zone` reads as in a map view: buildable ground, the shore rim, open sea,
 *  or other land. */
export function zoneGlyph(zone: CellZone): string {
  if (isBuildableZone(zone)) return '.';
  if (isRimZone(zone)) return '#';
  if (isOpenSeaZone(zone)) return '~';
  return ':';
}

export function regionTokens(state: GridState, r: { x1: number; y1: number; x2: number; y2: number }): string {
  const x1 = Math.max(0, Math.min(r.x1, r.x2));
  const x2 = Math.min(state.template.width - 1, Math.max(r.x1, r.x2));
  const y1 = Math.max(0, Math.min(r.y1, r.y2));
  const y2 = Math.min(state.template.height - 1, Math.max(r.y1, r.y2));
  const w = x2 - x1 + 1;
  const h = y2 - y1 + 1;
  if (w > REGION_CAP || h > REGION_CAP) {
    return `Region ${w}x${h} too large — max ${REGION_CAP}x${REGION_CAP} per call. Subdivide into smaller inspect_region calls.`;
  }
  const lines: string[] = [];
  // x ruler (tens + units rows), offset by the 5-char y prefix "yyyy "
  let tens = '     ';
  let units = '     ';
  for (let x = x1; x <= x2; x++) {
    tens += x >= 10 ? String(Math.floor(x / 10) % 10) : ' ';
    units += String(x % 10);
  }
  lines.push(tens, units);
  const marks = objectMarks(state);
  for (let y = y1; y <= y2; y++) {
    let row = `${String(y).padStart(4)} `;
    for (let x = x1; x <= x2; x++) row += cellToken(state, x, y, marks);
    lines.push(row);
  }
  lines.push(TOKEN_LEGEND);
  return lines.join('\n');
}

/** The compass side a unit step points to; +y is south on the map. */
function sideOf(step: MacroCoord): string {
  return step.x > 0 ? 'east' : step.x < 0 ? 'west' : step.y > 0 ? 'south' : 'north';
}

/** Where a building's door is and the cell a path to it ends on, so a road meets the door and not the wall. */
function doorNote(o: PlacedObject): string {
  const item = getCatalogItem(o.catalogId);
  if (!item || !hasGate(item)) return '';
  const { gate, facing } = doorOf(objectRect(o, item), o.rotation);
  return ` door=(${gate.x},${gate.y}) faces ${sideOf(facing)}, path ends at (${gate.x + facing.x},${gate.y + facing.y})`;
}

export function objectLine(o: PlacedObject): string {
  const span = o.spanLength !== undefined ? ` span=${o.spanLength}` : '';
  return `${o.id}: ${o.catalogId} at (${o.position.x},${o.position.y}) rot=${o.rotation} elev=${o.elevation}${span}${doorNote(o)}${o.locked ? ' [locked]' : ''}`;
}

/** The share of a region's limit from which the map summary names the region. */
const NEAR_LIMIT_SHARE = 0.8;

export function mapSummary(state: GridState): string {
  const { width, height } = state.template;
  const mountain = new Map<number, number>();
  let water = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = state.cells[y]![x]!;
      if (isBuildableZone(cell.zone)) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      const t = cell.terrain;
      if (t?.type === TerrainType.Mountain) mountain.set(t.elevation, (mountain.get(t.elevation) ?? 0) + 1);
      else if (t?.type === TerrainType.Water) water++;
    }
  }
  const byCat = new Map<string, number>();
  const immovable: string[] = [];
  for (const o of state.objects.values()) {
    const cat = o.catalogId.split('-')[0]!;
    byCat.set(cat, (byCat.get(cat) ?? 0) + 1);
    if (o.locked) {
      const w = o.width ?? 1;
      const h = o.height ?? 1;
      immovable.push(
        `${o.catalogId} at (${o.position.x},${o.position.y}) size ${w}x${h} — covers (${Math.floor(o.position.x)},${Math.floor(o.position.y)})-(${Math.ceil(o.position.x + w) - 1},${Math.ceil(o.position.y + h) - 1})`,
      );
    }
  }
  const mountainStr =
    [...mountain.entries()].sort((a, b) => a[0] - b[0]).map(([e, n]) => `elev ${e}: ${n}`).join(', ') || 'none';
  const objStr = [...byCat.entries()].map(([c, n]) => `${c}: ${n}`).join(', ') || 'none';
  // The cells objects can stand on: those resting wholly on the buildable ground.
  const stand = maxX >= minX ? wholeCellsInRegion([{ x: minX, y: minY }, { x: maxX, y: maxY }]) : null;
  const bounds = stand ? `(${stand.x},${stand.y})-(${stand.x + stand.w - 1},${stand.y + stand.h - 1})` : 'none';
  const lines = [
    `Map ${width}x${height}. Buildable (${BUILDABLE_ZONES}) bounds: ${bounds}.`,
    `Mountain area, in cells — ${mountainStr}. Water area: ${water}.`,
    `Objects (${state.objects.size}) — ${objStr}.`,
  ];
  const origin = mapChunkOrigin(state.template);
  lines.push(`Regional load enforcement: ${isChunkLoadEnforced(state) ? 'on' : 'off'}. Limit per region: ${CHUNK_LOAD_LIMIT}. Regions are ${CHUNK_SIZE}x${CHUNK_SIZE} cells from origin (${origin.x},${origin.y}). Unknown loads count as 0, not confirmed free capacity.`);
  const occupied = [...getMapStats(state).chunks].map(([key, chunk]) => {
    const [cx, cy] = key.split(',').map(Number) as [number, number];
    return { cx, cy, chunk };
  }).sort((a, b) => a.cy - b.cy || a.cx - b.cx);
  const near = occupied.filter(({ chunk }) => chunk.load >= NEAR_LIMIT_SHARE * CHUNK_LOAD_LIMIT);
  const loads = near.map(({ cx, cy, chunk }) =>
    `${chunkName(cx, cy)} load=${chunk.load} remaining=${roundLoad(CHUNK_LOAD_LIMIT - chunk.load)}${chunk.unknownLoads > 0 ? ` unknown=${chunk.unknownLoads}` : ''}`);
  lines.push(`Regions are named as in the UI and the game: row letter from the top, column number from the left (B4 is row 2, column 4). Regions at ${NEAR_LIMIT_SHARE * 100}% of the limit or more: ${loads.join('; ') || 'none'}. Occupied regions below that share: ${occupied.length - near.length}. Empty regions have zero load.`);
  if (immovable.length > 0) {
    lines.push(`IMMOVABLE structures (nothing can be placed/painted on their footprint): ${immovable.join('; ')}.`);
  }
  return lines.join('\n');
}

/**
 * Whole-map situational awareness for every turn: the exact token grid when the
 * map fits REGION_CAP, otherwise a block-downsampled overview. This is what
 * keeps the model from blind exploratory inspect_region sweeps.
 */
export function mapOverview(state: GridState): string {
  const { width, height } = state.template;
  if (Math.max(width, height) <= REGION_CAP) {
    return `Whole map (exact):\n${regionTokens(state, { x1: 0, y1: 0, x2: width - 1, y2: height - 1 })}`;
  }
  const k = Math.ceil(Math.max(width, height) / 40);
  const lines: string[] = [
    `Whole-map overview — 1 char summarizes a ${k}x${k} block (dominant terrain only; object footprints show in exact grids, so inspect_region before painting or placing near objects):`,
  ];
  for (let by = 0; by < height; by += k) {
    let row = `${String(by).padStart(4)} `;
    for (let bx = 0; bx < width; bx += k) {
      let mountains = 0;
      let maxMtn = 0;
      let water = 0;
      let maxWtr = 0;
      let buildable = 0;
      let total = 0;
      for (let y = by; y < Math.min(by + k, height); y++) {
        for (let x = bx; x < Math.min(bx + k, width); x++) {
          total++;
          const g = groundUnder(state, x, y);
          if (g.kind === 'mountain') {
            mountains++;
            if (g.elevation > maxMtn) maxMtn = g.elevation;
          } else if (g.kind === 'water') {
            water++;
            if (g.elevation > maxWtr) maxWtr = g.elevation;
          } else if (g.kind === 'bare' && isBuildableZone(g.zone)) buildable++;
        }
      }
      if (water >= total * 0.25 && water >= mountains) row += String.fromCharCode(65 + Math.min(maxWtr, ELEVATION_MAX));
      else if (mountains >= total * 0.25) row += String(Math.min(maxMtn, ELEVATION_MAX));
      else if (buildable >= total * 0.4) row += '.';
      else row += '~';
    }
    lines.push(row);
  }
  lines.push(`Row prefix = the block-row's starting y. Column i starts at x=i*${k}. ${TOKEN_LEGEND}`);
  return lines.join('\n');
}

export function selectionContext(region: MacroCoord[]): string {
  if (region.length === 0) {
    return `User selection: none (operate anywhere on ${BUILDABLE_ZONES}, or ask the user to select a region).`;
  }
  const { x1, y1, x2, y2 } = regionBounds(region)!;
  return `User selection: ${region.length} cells in bbox (${x1},${y1})-(${x2},${y2}). When the user says "here"/"the selected area", they mean this region. `
    + 'It is also a HARD BOUNDARY while it is set: every cell you paint or erase, and the whole footprint '
    + 'of every object you place or remove, must lie inside it. An edit that reaches outside is refused '
    + 'and applies nothing, so plan within these cells.';
}
