/**
 * Compact text serialization of editor state for the LLM agent.
 *
 * One char per cell so grids stay column-aligned in the model's context:
 * mountain elev 1-8 → '1'..'8'; water elev 0-8 → 'A'..'I' (A=0); bare zones
 * use glyphs (see TOKEN_LEGEND). Detailed reads are tool-driven and capped at
 * REGION_CAP per axis — the agent subdivides rather than dumping whole maps.
 */
import { CellZone, TerrainType, type GridState, type MacroCoord, type PlacedObject } from '../core/model/types';
import { getCell } from '../core/model/grid-model';
import { ELEVATION_MAX } from '../core/model/constants';

export const REGION_CAP = 45;

// Highest water glyph: 'A'(=0) + ELEVATION_MAX. Derived so the token vocabulary
// tracks the elevation ceiling instead of hardcoding '8'/'I'.
const WATER_GLYPH_MAX = String.fromCharCode(65 + ELEVATION_MAX);

const ZONE_GLYPH: Record<CellZone, string> = {
  [CellZone.Grass]: '.',
  [CellZone.Void]: '~',
  [CellZone.Beach]: ':',
  [CellZone.Plaza]: 'P',
  [CellZone.Boundary]: '#',
};

const TOKEN_LEGEND =
  `Legend: 1-${ELEVATION_MAX} mountain at that elevation; A-${WATER_GLYPH_MAX} water at elevation 0-${ELEVATION_MAX} (A=0); ` +
  '. grass (buildable); ~ sea; : beach; P plaza; # boundary (all unbuildable).';

function cellToken(state: GridState, x: number, y: number): string {
  const cell = getCell(state.cells, x, y);
  if (!cell) return ' ';
  const t = cell.terrain;
  if (t?.type === TerrainType.Mountain) return String(Math.min(t.elevation, ELEVATION_MAX));
  if (t?.type === TerrainType.Water) return String.fromCharCode(65 + Math.min(t.elevation, ELEVATION_MAX));
  return ZONE_GLYPH[cell.zone] ?? '.';
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
  for (let y = y1; y <= y2; y++) {
    let row = `${String(y).padStart(4)} `;
    for (let x = x1; x <= x2; x++) row += cellToken(state, x, y);
    lines.push(row);
  }
  lines.push(TOKEN_LEGEND);
  return lines.join('\n');
}

export function objectLine(o: PlacedObject): string {
  const span = o.spanLength !== undefined ? ` span=${o.spanLength}` : '';
  return `${o.id}: ${o.catalogId} at (${o.position.x},${o.position.y}) rot=${o.rotation} elev=${o.elevation}${span}${o.locked ? ' [locked]' : ''}`;
}

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
      if (cell.zone === CellZone.Grass) {
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
  const lines = [
    `Map ${width}x${height}. Buildable (grass) bounds: (${minX},${minY})-(${maxX},${maxY}).`,
    `Mountain cells — ${mountainStr}. Water cells: ${water}.`,
    `Objects (${state.objects.size}) — ${objStr}.`,
  ];
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
    `Whole-map overview — 1 char summarizes a ${k}x${k} block (dominant feature; use inspect_region for exact cells):`,
  ];
  for (let by = 0; by < height; by += k) {
    let row = `${String(by).padStart(4)} `;
    for (let bx = 0; bx < width; bx += k) {
      let mountains = 0;
      let maxMtn = 0;
      let water = 0;
      let maxWtr = 0;
      let grass = 0;
      let total = 0;
      for (let y = by; y < Math.min(by + k, height); y++) {
        for (let x = bx; x < Math.min(bx + k, width); x++) {
          total++;
          const cell = state.cells[y]![x]!;
          const t = cell.terrain;
          if (t?.type === TerrainType.Mountain) {
            mountains++;
            if (t.elevation > maxMtn) maxMtn = t.elevation;
          } else if (t?.type === TerrainType.Water) {
            water++;
            if (t.elevation > maxWtr) maxWtr = t.elevation;
          } else if (cell.zone === CellZone.Grass) grass++;
        }
      }
      if (water >= total * 0.25 && water >= mountains) row += String.fromCharCode(65 + Math.min(maxWtr, ELEVATION_MAX));
      else if (mountains >= total * 0.25) row += String(Math.min(maxMtn, ELEVATION_MAX));
      else if (grass >= total * 0.4) row += '.';
      else row += '~';
    }
    lines.push(row);
  }
  lines.push(`Row prefix = the block-row's starting y. Column i starts at x=i*${k}. ${TOKEN_LEGEND}`);
  return lines.join('\n');
}

export function selectionContext(region: MacroCoord[]): string {
  if (region.length === 0) {
    return 'User selection: none (operate anywhere on grass, or ask the user to select a region).';
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of region) {
    if (c.x < minX) minX = c.x;
    if (c.x > maxX) maxX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.y > maxY) maxY = c.y;
  }
  return `User selection: ${region.length} cells in bbox (${minX},${minY})-(${maxX},${maxY}). When the user says "here"/"the selected area", they mean this region. `
    + 'It is also a HARD BOUNDARY while it is set: every cell you paint or erase, and the whole footprint '
    + 'of every object you place or remove, must lie inside it. An edit that reaches outside is refused '
    + 'and applies nothing, so plan within these cells.';
}
