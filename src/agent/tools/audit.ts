/**
 * What a builder would not sign: the faults in what stands that can be found without judgment. The
 * loop asks for this when a job tries to close, so "filled" is not taken for "finished".
 */
import { footprintCells, terrainCellsUnder } from '../../core/grid/footprint';
import { cellKey, parseCellKey, regionBounds } from '../../core/grid/rect';
import { isCoatingItem, isCrossing, isPlantRole, isSurfacePrint } from '../../core/model/traits';
import { TerrainType, type GridState, type MacroCoord, type PlacedObject } from '../../core/model/types';
import { getCatalogItem, itemRole } from '../../state/catalog';
import { doorOf, getPlacedObjectSize, hasGate, objectRect } from '../../state/object-geometry';
import { objectCellsOver } from './cells';

interface AuditBox { x1: number; y1: number; x2: number; y2: number }

const STEPS: readonly MacroCoord[] = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
const key = cellKey;

/** A paving a visitor walks on: a surface coating that is not a print laid over one. */
const isPaving = (catalogId: string): boolean => { const item = getCatalogItem(catalogId); return isCoatingItem(item) && !isSurfacePrint(item); };
/** The most findings of one kind a list names. */
const CAP = 8;
/** A layout this close to symmetric about a line was meant to be symmetric about it. */
const MEANT_SYMMETRIC = 0.7;

function objectsIn(state: GridState, box: AuditBox): PlacedObject[] {
  return [...state.objects.values()].filter((o) => !o.locked
    && o.position.x >= box.x1 && o.position.x <= box.x2 && o.position.y >= box.y1 && o.position.y <= box.y2);
}

/**
 * Paths as a visitor walks them: a door with no path, a path cut off, an end that leads nowhere. The
 * walk is read across the whole map, since a path inside the box is joined, and a door inside it is
 * met, by paving that may lie outside; only what stands inside the box is reported.
 */
function pathFindings(state: GridState, box: AuditBox): string[] {
  const inside = (x: number, y: number): boolean => x >= box.x1 && x <= box.x2 && y >= box.y1 && y <= box.y2;
  const walk = new Set<string>(), paved = new Set<string>(), stops = new Set<string>();
  const homes: PlacedObject[] = [];
  for (const o of state.objects.values()) {
    const item = getCatalogItem(o.catalogId);
    if (!item) continue;
    const { w, h } = getPlacedObjectSize(o);
    // Every cell the footprint touches: a stair or a bridge anchored on a half cell still joins the paths at both its ends.
    const cells = footprintCells(o.position.x, o.position.y, w, h);
    if (isPaving(o.catalogId)) for (const c of cells) { walk.add(key(c.x, c.y)); paved.add(key(c.x, c.y)); }
    // A ramp or a bridge carries the walk on and is a place for a path to end.
    else if (isCrossing(item)) for (const c of cells) { walk.add(key(c.x, c.y)); stops.add(key(c.x, c.y)); }
    else if (hasGate(item) && !o.locked && cells.some((c) => inside(c.x, c.y))) homes.push(o);
  }
  const pavedInside = [...paved].map(parseCellKey).filter((c) => inside(c.x, c.y));
  if (pavedInside.length === 0) return homes.length > 0 ? [`${homes.length} building(s) stand with no path at all.`] : [];
  const out: string[] = [];
  for (const o of homes) {
    const { gate, facing } = doorOf(objectRect(o), o.rotation);
    const front = { x: gate.x + facing.x, y: gate.y + facing.y };
    stops.add(key(front.x, front.y));
    if (!walk.has(key(front.x, front.y))) out.push(`${o.catalogId} at (${o.position.x},${o.position.y}): no path on (${front.x},${front.y}), the cell in front of its door`);
  }
  // The pieces of the walk, joined anywhere on the map; the largest is the network.
  const piece = new Map<string, number>();
  const sizes: number[] = [];
  for (const start of walk) {
    if (piece.has(start)) continue;
    const id = sizes.length, queue = [start];
    let size = 0;
    piece.set(start, id);
    while (queue.length > 0) {
      const { x, y } = parseCellKey(queue.pop()!);
      size++;
      for (const s of STEPS) {
        const next = key(x + s.x, y + s.y);
        if (walk.has(next) && !piece.has(next)) { piece.set(next, id); queue.push(next); }
      }
    }
    sizes.push(size);
  }
  const main = sizes.indexOf(Math.max(...sizes));
  const apart = new Map<number, MacroCoord[]>();
  for (const c of pavedInside) {
    const id = piece.get(key(c.x, c.y))!;
    if (id !== main) apart.set(id, [...(apart.get(id) ?? []), c]);
  }
  for (const cells of [...apart.values()].sort((a, b) => b.length - a.length).slice(0, CAP)) {
    out.push(`${cells.length} path cells near (${cells[0]!.x},${cells[0]!.y}) are not joined to the main network`);
  }
  const ends: string[] = [];
  for (const { x, y } of pavedInside) {
    if (STEPS.filter((s) => walk.has(key(x + s.x, y + s.y))).length > 1) continue;
    if (!(stops.has(key(x, y)) || STEPS.some((s) => stops.has(key(x + s.x, y + s.y))))) ends.push(`(${x},${y})`);
  }
  if (ends.length > 0) out.push(`${ends.length} path end(s) lead nowhere: ${ends.slice(0, CAP).join(' ')}`);
  return out;
}

/** What stands or lies on an object cell, as one comparable word: the item, or the ground under it. */
function cellMarks(state: GridState, box: AuditBox): Map<string, string> {
  const marks = new Map<string, string>();
  for (let y = box.y1; y <= box.y2; y++) {
    for (let x = box.x1; x <= box.x2; x++) {
      // An object on (x,y) rests on these four terrain cells; the mark is what all four are.
      const under = [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]].map(([tx, ty]) => state.cells[ty!]?.[tx!]?.terrain ?? null);
      const words = under.map((t) => (!t || t.type === TerrainType.None ? 'ground' : `${t.type === TerrainType.Water ? 'water' : 'raised'}${t.elevation}`));
      if (words.every((w) => w === words[0]) && words[0] !== 'ground') marks.set(key(x, y), words[0]!);
    }
  }
  for (const o of objectsIn(state, box)) {
    const { w, h } = getPlacedObjectSize(o);
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) marks.set(key(o.position.x + dx, o.position.y + dy), o.catalogId);
  }
  return marks;
}

/**
 * Accidental asymmetry: for the line (through a column or row, or between two) about which what
 * stands is most nearly its own mirror image, the cells that break it, when the match is close
 * enough that the symmetry was plainly intended. Objects, paving, water and raised ground alike.
 */
function symmetryFindings(state: GridState, box: AuditBox): string[] {
  const marks = cellMarks(state, box);
  if (marks.size < 12) return [];
  const out: string[] = [];
  for (const along of ['x', 'y'] as const) {
    const lo = along === 'x' ? box.x1 : box.y1, hi = along === 'x' ? box.x2 : box.y2;
    let best: { at: number; misses: string[]; share: number } | null = null;
    // In whole and half cells; cell c mirrors to 2a - c about the line a.
    for (let twice = 2 * lo + 4; twice <= 2 * hi - 4; twice++) {
      const misses: string[] = [];
      let paired = 0, counted = 0;
      for (const [cell, mark] of marks) {
        const [x, y] = cell.split(',').map(Number) as [number, number];
        const mx = along === 'x' ? twice - x : x, my = along === 'y' ? twice - y : y;
        if (mx < box.x1 || mx > box.x2 || my < box.y1 || my > box.y2) continue;
        counted++;
        if (marks.get(key(mx, my)) === mark) paired++;
        else misses.push(`${mark} on (${x},${y}) has ${marks.get(key(mx, my)) ?? 'nothing'} at its mirror cell (${mx},${my})`);
      }
      const share = counted === 0 ? 0 : paired / counted;
      if (counted >= marks.size * 0.6 && (best === null || share > best.share)) best = { at: twice / 2, misses, share };
    }
    if (best && best.share >= MEANT_SYMMETRIC && best.misses.length > 0) {
      const line = along === 'x' ? `the vertical line axisX ${best.at}` : `the horizontal line axisY ${best.at}`;
      out.push(`The layout is ${Math.round(best.share * 100)}% its own mirror image about ${line}, so it was meant to match, but ${best.misses.length} cells do not: `
        + `${best.misses.slice(0, CAP).join('; ')}${best.misses.length > CAP ? `; and ${best.misses.length - CAP} more` : ''}.`);
    }
  }
  return out;
}

/** Connected groups of the terrain cells in the box that `is` accepts, by the four sides. */
function terrainGroups(box: AuditBox, is: (x: number, y: number) => boolean): MacroCoord[][] {
  const seen = new Set<string>();
  const groups: MacroCoord[][] = [];
  for (let y = box.y1; y <= box.y2 + 1; y++) {
    for (let x = box.x1; x <= box.x2 + 1; x++) {
      if (seen.has(key(x, y)) || !is(x, y)) continue;
      const group: MacroCoord[] = [], queue: MacroCoord[] = [{ x, y }];
      seen.add(key(x, y));
      while (queue.length > 0) {
        const c = queue.pop()!;
        group.push(c);
        for (const s of STEPS) {
          const nx = c.x + s.x, ny = c.y + s.y;
          if (nx < box.x1 || nx > box.x2 + 1 || ny < box.y1 || ny > box.y2 + 1 || seen.has(key(nx, ny)) || !is(nx, ny)) continue;
          seen.add(key(nx, ny));
          queue.push({ x: nx, y: ny });
        }
      }
      groups.push(group);
    }
  }
  return groups;
}

const isWater = (state: GridState) => (x: number, y: number): boolean => state.cells[y]?.[x]?.terrain?.type === TerrainType.Water;

/** Whether two groups of cells are one shape and its reflection across the upright or level line midway between them. */
function mirrored(a: readonly MacroCoord[], b: readonly MacroCoord[]): boolean {
  if (a.length !== b.length) return false;
  const other = new Set(b.map((c) => key(c.x, c.y)));
  const xs = [...a, ...b].map((c) => c.x), ys = [...a, ...b].map((c) => c.y);
  const sx = Math.min(...xs) + Math.max(...xs), sy = Math.min(...ys) + Math.max(...ys);
  return a.every((c) => other.has(key(sx - c.x, c.y))) || a.every((c) => other.has(key(c.x, sy - c.y)));
}

/** The object cells whose ground is the dry terrain `gap` and water of `wet` only: the cells that, painted, join the water. */
function cellsJoining(gap: readonly MacroCoord[], wet: ReadonlySet<string>): { x1: number; y1: number; x2: number; y2: number } | null {
  const over = objectCellsOver(gap);
  if (!over) return null;
  const dry = new Set(gap.map((c) => key(c.x, c.y)));
  const joining: MacroCoord[] = [];
  for (let y = over.y1; y <= over.y2; y++) {
    for (let x = over.x1; x <= over.x2; x++) {
      if (terrainCellsUnder({ x, y, w: 1, h: 1 }).every((t) => dry.has(key(t.x, t.y)) || wet.has(key(t.x, t.y)))) joining.push({ x, y });
    }
  }
  const box = regionBounds(joining);
  return box ? { x1: box.x1, y1: box.y1, x2: box.x2, y2: box.y2 } : over;
}

/**
 * Water drawn as one channel or pond and left in pieces: two bodies a cell or two apart. A body and
 * its mirror image are a pair built to match, not a break.
 */
function waterFindings(state: GridState, box: AuditBox): string[] {
  const bodies = terrainGroups(box, isWater(state)).filter((g) => g.length >= 4);
  const out: string[] = [];
  for (let i = 0; i < bodies.length && out.length < CAP; i++) {
    for (let j = i + 1; j < bodies.length && out.length < CAP; j++) {
      if (mirrored(bodies[i]!, bodies[j]!)) continue;
      // The dry terrain on the straight gaps of the narrowest width between the two.
      let gap: MacroCoord[] = [], apart = Infinity;
      for (const a of bodies[i]!) {
        for (const b of bodies[j]!) {
          // Only a straight gap reads as a break; a diagonal neighbour is a separate pool.
          if (a.x !== b.x && a.y !== b.y) continue;
          const d = Math.abs(a.x - b.x) + Math.abs(a.y - b.y) - 1;
          if (d < 1 || d > 2 || d > apart) continue;
          if (d < apart) { apart = d; gap = []; }
          const sx = Math.sign(b.x - a.x), sy = Math.sign(b.y - a.y);
          for (let k = 1; k <= d; k++) gap.push({ x: a.x + sx * k, y: a.y + sy * k });
        }
      }
      const at = cellsJoining(gap, new Set([...bodies[i]!, ...bodies[j]!].map((c) => key(c.x, c.y))));
      if (at) out.push(`The water is in two pieces ${apart} cell(s) apart, dry under cells (${at.x1},${at.y1})-(${at.x2},${at.y2}): a channel or pond meant as one is broken there`);
    }
  }
  return out;
}

/** Rows of one item whose gaps are not all the same, and groups that do not sit centred on the patch they stand on. */
function spacingFindings(state: GridState, box: AuditBox): string[] {
  const out: string[] = [];
  const objects = objectsIn(state, box);
  const plants = objects.filter((o) => {
    return isPlantRole(itemRole(getCatalogItem(o.catalogId)));
  });
  for (const along of ['x', 'y'] as const) {
    const rows = new Map<string, number[]>();
    for (const o of plants) {
      const line = `${o.catalogId}@${along === 'x' ? o.position.y : o.position.x}`;
      rows.set(line, [...(rows.get(line) ?? []), along === 'x' ? o.position.x : o.position.y]);
    }
    for (const [line, at] of rows) {
      if (at.length < 4) continue;
      at.sort((a, b) => a - b);
      const gaps = at.slice(1).map((v, i) => v - at[i]!);
      // A long gap separates two groups; within a group the pitch should be one number.
      const near = gaps.filter((g) => g <= 4);
      const pitches = [...new Set(near)];
      if (near.length >= 3 && pitches.length > 1 && out.length < CAP) {
        const [id, fixed] = line.split('@');
        out.push(`${id} along ${along === 'x' ? `row y=${fixed}` : `column x=${fixed}`} has uneven gaps (${gaps.join(', ')}): a row reads as spaced by one pitch`);
      }
    }
  }
  // A patch of one surfacing with plants on it: the planting should leave the same margin on opposite sides.
  const surface = new Map<string, string>();
  for (const o of objects) if (isPaving(o.catalogId)) surface.set(key(o.position.x, o.position.y), o.catalogId);
  const seen = new Set<string>();
  for (const [start, id] of surface) {
    if (seen.has(start)) continue;
    const patch: MacroCoord[] = [], queue = [start];
    seen.add(start);
    while (queue.length > 0) {
      const [x, y] = queue.pop()!.split(',').map(Number) as [number, number];
      patch.push({ x, y });
      for (const s of STEPS) {
        const next = key(x + s.x, y + s.y);
        if (surface.get(next) === id && !seen.has(next)) { seen.add(next); queue.push(next); }
      }
    }
    const on = new Set(patch.map((c) => key(c.x, c.y)));
    const standing = plants.filter((o) => on.has(key(o.position.x, o.position.y)));
    if (standing.length < 4 || patch.length < 12) continue;
    const span = (cells: readonly number[]): [number, number] => [Math.min(...cells), Math.max(...cells)];
    const [px1, px2] = span(patch.map((c) => c.x)), [py1, py2] = span(patch.map((c) => c.y));
    // Only a plain rectangle of surfacing has margins to compare.
    if (patch.length !== (px2 - px1 + 1) * (py2 - py1 + 1)) continue;
    const [sx1, sx2] = span(standing.map((o) => o.position.x)), [sy1, sy2] = span(standing.map((o) => o.position.y));
    const left = sx1 - px1, right = px2 - sx2, top = sy1 - py1, bottom = py2 - sy2;
    if ((left !== right || top !== bottom) && out.length < CAP) {
      out.push(`The planting on the ${id} patch (${px1},${py1})-(${px2},${py2}) is not centred on it: margins left ${left}, right ${right}, top ${top}, bottom ${bottom}`);
    }
  }
  return out;
}

/** One thing standing alone on a small island in water, off the island's middle. */
function isletFindings(state: GridState, box: AuditBox): string[] {
  const water = isWater(state);
  const land = terrainGroups(box, (x, y) => !water(x, y)).filter((g) => g.length <= 25
    && g.every((c) => c.x > box.x1 && c.x <= box.x2 && c.y > box.y1 && c.y <= box.y2));
  const out: string[] = [];
  const objects = objectsIn(state, box);
  for (const islet of land) {
    // An object on cell (x,y) rests on terrain cells x..x+w and y..y+h; it stands on the islet when all of them are its cells.
    const cells = new Set(islet.map((c) => key(c.x, c.y)));
    const on = objects.filter((o) => {
      const { w, h } = getPlacedObjectSize(o);
      for (let dy = 0; dy <= h; dy++) for (let dx = 0; dx <= w; dx++) if (!cells.has(key(o.position.x + dx, o.position.y + dy))) return false;
      return true;
    });
    if (on.length !== 1) continue;
    const o = on[0]!, { w, h } = getPlacedObjectSize(o);
    // Terrain cell k is centred on k; the object spans x..x+w in the same units.
    const cx = islet.reduce((sum, c) => sum + c.x, 0) / islet.length, cy = islet.reduce((sum, c) => sum + c.y, 0) / islet.length;
    const dx = o.position.x + w / 2 - cx, dy = o.position.y + h / 2 - cy;
    if ((Math.abs(dx) >= 0.5 || Math.abs(dy) >= 0.5) && out.length < CAP) {
      out.push(`${o.catalogId} at (${o.position.x},${o.position.y}) stands off the middle of its island by ${dx.toFixed(1)} across and ${dy.toFixed(1)} down`);
    }
  }
  return out;
}

/** Every fault of what stands in `box` that needs no judgment to see. */
export function auditBuild(state: GridState, box: AuditBox): string[] {
  return [
    ...pathFindings(state, box), ...waterFindings(state, box), ...symmetryFindings(state, box),
    ...spacingFindings(state, box), ...isletFindings(state, box),
  ];
}
