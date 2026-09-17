/*
 * maze-endpoints.ts — a way in and a destination, and the walk between them.
 *
 * TWO KINDS OF END, AND NOBODY PICKS WHICH. A WAY IN is a hole in the maze's outer wall: you pass
 * through it. A DESTINATION is a place inside that the maze must lead to — the plaza, or any cell
 * pointed at. They are not the same thing, and one word for both cannot express the second: aiming at
 * the plaza would move the exit to the map's edge instead.
 *
 * The kind is READ FROM WHERE AN END IS DROPPED and never selected: on the maze's own border ring
 * (or outside it) it is a hole, anywhere else it snaps to the nearest walkable cell and is a
 * destination. There is no control for this and there must not be one.
 *
 * ONE IMPLEMENTATION, TWO READERS. The generator asks these questions of the lattice it has just
 * carved, and the interface asks them of the map the run left behind, so everything here is written
 * against a `MazeField`: a rectangle plus "can a walker stand here". The caller supplies the
 * predicate — corridors for the generator, standable ground for the map — and the answers cannot
 * differ between the two.
 *
 * THE TERRAIN AROUND A MAZE IS NOT TOUCHED, and a maze whose ends are both outside cannot be walled to
 * fix that: two holes in the boundary of a simply-connected shape are two doors onto the SAME outside, so
 * no wall the generator may build separates them (`__tests__/tools/maze-endpoints.test.ts`). The inward
 * pairing this file defaults to needs nothing: with an end inside, entering is the only way to arrive,
 * and the carve's spanning tree makes that route unique for free.
 */
import type { MacroCoord } from '../../../core/model/types';

/** What an end turned out to be. */
export type EndKind = 'hole' | 'target';

export interface MazeEnd {
  cell: MacroCoord;
  kind: EndKind;
}

/** The rectangle a maze fills, and what a walker can stand on inside it. */
export interface MazeField {
  origin: MacroCoord;
  dims: { mazeW: number; mazeH: number };
  /** Map coordinates, so a caller with a lattice converts and a caller with a map does not. */
  walkable(x: number, y: number): boolean;
}

const STEPS: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** Inside the maze's rectangle at all. */
export function inField(field: MazeField, x: number, y: number): boolean {
  const { origin: o, dims: d } = field;
  return x >= o.x && x < o.x + d.mazeW && y >= o.y && y < o.y + d.mazeH;
}

/** On the rectangle's outer ring, which is the wall a hole is cut in — or outside it altogether,
 *  which is somebody reaching in from the shore and means the same thing. */
export function onRing(field: MazeField, x: number, y: number): boolean {
  const { origin: o, dims: d } = field;
  if (!inField(field, x, y)) return true;
  return x === o.x || y === o.y || x === o.x + d.mazeW - 1 || y === o.y + d.mazeH - 1;
}

/**
 * The corridor a hole in this ring cell would open onto, or null where the wall behind it is solid.
 *
 * BY THE EDGE THE CELL STANDS ON, never "the first walkable neighbour": once a hole has been cut,
 * the cell beside it on the ring IS walkable, so a naive scan can step sideways along the wall and
 * measure a walk from the wrong place. That is worth a cell or two, which is the whole margin
 * between the longest walk and the second longest.
 */
export function insideOf(field: MazeField, gate: MacroCoord): MacroCoord | null {
  const { origin: o, dims: d } = field;
  const inward: MacroCoord[] = [];
  if (gate.x === o.x) inward.push({ x: gate.x + 1, y: gate.y });
  if (gate.x === o.x + d.mazeW - 1) inward.push({ x: gate.x - 1, y: gate.y });
  if (gate.y === o.y) inward.push({ x: gate.x, y: gate.y + 1 });
  if (gate.y === o.y + d.mazeH - 1) inward.push({ x: gate.x, y: gate.y - 1 });
  return inward.find((c) => inField(field, c.x, c.y) && field.walkable(c.x, c.y)) ?? null;
}

/** Every ring cell that has a corridor immediately inside it: the places a hole can be cut. */
export function gateSites(field: MazeField): { gate: MacroCoord; inside: MacroCoord }[] {
  const { origin: o, dims: d } = field;
  const out: { gate: MacroCoord; inside: MacroCoord }[] = [];
  const consider = (gate: MacroCoord): void => {
    const inside = insideOf(field, gate);
    if (inside) out.push({ gate, inside });
  };
  for (let x = o.x + 1; x < o.x + d.mazeW - 1; x++) {
    consider({ x, y: o.y });
    consider({ x, y: o.y + d.mazeH - 1 });
  }
  for (let y = o.y + 1; y < o.y + d.mazeH - 1; y++) {
    consider({ x: o.x, y });
    consider({ x: o.x + d.mazeW - 1, y });
  }
  return out;
}

/**
 * Distances in cells from `from` over the field's own walkable cells, `from` counted as 1, as a flat
 * array over the field's rectangle: -1 for a cell no walk reaches.
 *
 * FLAT RATHER THAN A MAP OF STRING KEYS, because the default runs one of these per way IN and a
 * whole-planet maze offers a few hundred of them over ten thousand cells. Keyed by string that is
 * seconds; indexed by row it is milliseconds, and it is what lets the default be the true longest
 * walk rather than a heuristic that lands a cell short.
 */
function sweep(field: MazeField, from: MacroCoord): Int32Array {
  const { origin: o, dims: d } = field;
  const at = (x: number, y: number): number => (y - o.y) * d.mazeW + (x - o.x);
  const dist = new Int32Array(d.mazeW * d.mazeH).fill(-1);
  dist[at(from.x, from.y)] = 1;
  const queue: MacroCoord[] = [from];
  for (let head = 0; head < queue.length; head++) {
    const here = queue[head]!;
    const step = dist[at(here.x, here.y)]! + 1;
    for (const [dx, dy] of STEPS) {
      const x = here.x + dx!;
      const y = here.y + dy!;
      if (!inField(field, x, y) || dist[at(x, y)] !== -1 || !field.walkable(x, y)) continue;
      dist[at(x, y)] = step;
      queue.push({ x, y });
    }
  }
  return dist;
}

/** A cell's place in a sweep's array. */
function slot(field: MazeField, c: MacroCoord): number {
  return (c.y - field.origin.y) * field.dims.mazeW + (c.x - field.origin.x);
}

/**
 * How many cells a walk from one end to the other visits, or null where there is no route.
 *
 * Counted in CELLS, both ends included, so two ends dropped next to each other read 2. That is a
 * legal pair rather than a refused one: a rule nobody was told about is worse than a readout the
 * person can see and act on.
 *
 * A hole is not itself walkable until it is cut, so an end that is one is measured from the corridor
 * it opens onto and counted as the extra cell it is.
 */
export function walkLength(field: MazeField, a: MazeEnd, b: MazeEnd): number | null {
  const step = (end: MazeEnd): { at: MacroCoord; extra: number } | null => {
    if (end.kind === 'target') return { at: end.cell, extra: 0 };
    const inside = insideOf(field, end.cell);
    return inside ? { at: inside, extra: 1 } : null;
  };
  const from = step(a);
  const to = step(b);
  if (!from || !to) return null;
  const reach = sweep(field, from.at)[slot(field, to.at)]!;
  return reach < 0 ? null : reach + from.extra + to.extra;
}

/**
 * The ONE route between two ends, cell by cell, or null where there is none.
 *
 * A recursive backtracker carves a spanning tree, so between any two corridors there is exactly one
 * path and it does not have to be searched for: sweep from one end and walk DOWN the distance
 * field from the other. Every step has exactly one neighbour one closer, which is the tree saying
 * so.
 *
 * A hole is not walkable until it is cut, so an end that is one contributes the corridor it opens
 * onto plus itself — the same accounting `walkLength` does, and the two agree by construction
 * because they read the same sweep.
 */
export function routeBetween(field: MazeField, a: MazeEnd, b: MazeEnd): MacroCoord[] | null {
  const step = (end: MazeEnd): MacroCoord | null => (
    end.kind === 'target' ? end.cell : insideOf(field, end.cell)
  );
  const from = step(a);
  const to = step(b);
  if (!from || !to) return null;

  const dist = sweep(field, from);
  const at = (c: MacroCoord): number => slot(field, c);
  if (dist[at(to)]! < 0) return null;

  const out: MacroCoord[] = [];
  if (b.kind === 'hole') out.push(b.cell);
  let here = to;
  out.push(here);
  while (dist[at(here)]! > 1) {
    const want = dist[at(here)]! - 1;
    let next: MacroCoord | null = null;
    for (const [dx, dy] of STEPS) {
      const x = here.x + dx!;
      const y = here.y + dy!;
      if (!inField(field, x, y) || !field.walkable(x, y)) continue;
      if (dist[slot(field, { x, y })] === want) { next = { x, y }; break; }
    }
    if (!next) return null;
    out.push(next);
    here = next;
  }
  if (a.kind === 'hole') out.push(a.cell);
  return out;
}

/** The walkable cell nearest a coordinate (optionally only cells `within` allows), by distance out
 *  from it over the whole field. Null where the maze holds no such cell at all. */
function nearestWalkable(field: MazeField, to: MacroCoord, within?: (cell: MacroCoord) => boolean): MacroCoord | null {
  let best: MacroCoord | null = null;
  let bestD = Infinity;
  const { origin: o, dims: d } = field;
  for (let y = o.y; y < o.y + d.mazeH; y++) {
    for (let x = o.x; x < o.x + d.mazeW; x++) {
      if (!field.walkable(x, y) || (within && !within({ x, y }))) continue;
      const dist = Math.abs(x - to.x) + Math.abs(y - to.y);
      if (dist < bestD) { bestD = dist; best = { x, y }; }
    }
  }
  return best;
}

/**
 * The maze's MAINLAND: the largest connected patch of walkable cells, as a membership test.
 *
 * A maze's rectangle is the bounding box of the free grass, and on a real map that box also
 * covers sea, sand and the square — so the walkable cells are not one graph but several, and two
 * ends snapped blindly to their nearest cells could land in pockets no corridor joins. Snapping
 * BOTH ends into the mainland is what makes the walk between them exist by construction: the carve
 * is a spanning tree, so within one component every pair of cells is joined.
 */
export function mainland(field: MazeField): (cell: MacroCoord) => boolean {
  const { origin: o, dims: d } = field;
  const label = new Int32Array(d.mazeW * d.mazeH).fill(-1);
  let best = -1;
  let bestSize = 0;
  let next = 0;
  for (let y = o.y; y < o.y + d.mazeH; y++) {
    for (let x = o.x; x < o.x + d.mazeW; x++) {
      if (!field.walkable(x, y) || label[slot(field, { x, y })] !== -1) continue;
      const id = next++;
      label[slot(field, { x, y })] = id;
      const queue: MacroCoord[] = [{ x, y }];
      for (let head = 0; head < queue.length; head++) {
        const here = queue[head]!;
        for (const [dx, dy] of STEPS) {
          const nx = here.x + dx!, ny = here.y + dy!;
          if (!inField(field, nx, ny) || !field.walkable(nx, ny)) continue;
          const s = slot(field, { x: nx, y: ny });
          if (label[s] !== -1) continue;
          label[s] = id;
          queue.push({ x: nx, y: ny });
        }
      }
      if (queue.length > bestSize) { bestSize = queue.length; best = id; }
    }
  }
  return (cell) => inField(field, cell.x, cell.y) && label[slot(field, cell)] === best;
}

/**
 * What a coordinate BECOMES when it is dropped: the kind is the drop's, and the cell is snapped to
 * something the kind can actually be.
 *
 * A ring drop snaps to the nearest place a hole can be cut, since not every ring cell has a corridor
 * behind it; anything else snaps to the nearest walkable cell. `within` confines the snap — the
 * generator passes the mainland, so a pair of asked-for ends always shares one component and the
 * walk between them always exists. Null where the maze offers nothing the kind can be.
 */
export function resolveEnd(field: MazeField, dropped: MacroCoord, within?: (cell: MacroCoord) => boolean): MazeEnd | null {
  if (onRing(field, dropped.x, dropped.y)) {
    let best: MacroCoord | null = null;
    let bestD = Infinity;
    for (const site of gateSites(field)) {
      if (within && !within(site.inside)) continue;
      const dist = Math.abs(site.gate.x - dropped.x) + Math.abs(site.gate.y - dropped.y);
      if (dist < bestD) { bestD = dist; best = site.gate; }
    }
    return best ? { cell: best, kind: 'hole' } : null;
  }
  const inside = nearestWalkable(field, dropped, within);
  return inside ? { cell: inside, kind: 'target' } : null;
}

/**
 * Where the two ends start: in from the edge, out at the destination.
 *
 * THE PLAZA IS THE DEFAULT DESTINATION, and it makes a better maze than edge to edge because the
 * destination means something — you arrive on the shore and find your way to the square. The caller
 * says which walkable cells count as one (for the plaza: a corridor touching its edge, since the
 * square itself is unbuildable and the maze routes around it), and the entrance is then the way in
 * whose walk to it is longest.
 *
 * With no destination it falls back to edge to edge at the LONGEST walk the maze holds. It is the
 * TRUE longest rather than the two-sweep approximation: a sweep from every way in is a few hundred
 * flat-array passes over a maze's own rectangle, which is milliseconds, and the approximation lands a
 * cell short of the best pair on an ordinary map.
 */
export function defaultEnds(field: MazeField, isDestination?: (cell: MacroCoord) => boolean): {
  entrance: MazeEnd | null;
  exit: MazeEnd | null;
} {
  const sites = gateSites(field);
  if (sites.length === 0) return { entrance: null, exit: null };

  const targets = isDestination ? walkableCells(field).filter(isDestination) : [];

  /** The farthest of `to` from this way in, and how far: -1 where it reaches none of them. */
  const reachFrom = (site: { inside: MacroCoord }, to: readonly MacroCoord[], want: 'far' | 'near') => {
    const dist = sweep(field, site.inside);
    let best: MacroCoord | null = null;
    let bestD = want === 'far' ? -1 : Infinity;
    for (const c of to) {
      const d = dist[slot(field, c)]!;
      if (d < 0) continue;
      if (want === 'far' ? d > bestD : d < bestD) { bestD = d; best = c; }
    }
    return { cell: best, dist: best ? bestD : -1 };
  };

  if (targets.length > 0) {
    // The way in is the one whose walk to the NEAREST destination is longest, and the destination is
    // then whichever one that walk ends at: the farthest door onto the closest square.
    let entrance = sites[0]!;
    let bestD = -1;
    for (const site of sites) {
      const { dist } = reachFrom(site, targets, 'near');
      if (dist > bestD) { bestD = dist; entrance = site; }
    }
    if (bestD >= 0) {
      const { cell } = reachFrom(entrance, targets, 'near');
      if (cell) return { entrance: { cell: entrance.gate, kind: 'hole' }, exit: { cell, kind: 'target' } };
    }
  }

  const insides = sites.map((site) => site.inside);
  let pair = { entrance: sites[0]!, exit: sites[0]!, walk: -1 };
  for (const site of sites) {
    const { cell, dist } = reachFrom(site, insides, 'far');
    if (!cell || dist <= pair.walk) continue;
    const far = sites.find((s) => s.inside.x === cell.x && s.inside.y === cell.y)!;
    pair = { entrance: site, exit: far, walk: dist };
  }
  return {
    entrance: { cell: pair.entrance.gate, kind: 'hole' },
    exit: { cell: pair.exit.gate, kind: 'hole' },
  };
}

/** Every cell of the field a walker can stand on. */
function walkableCells(field: MazeField): MacroCoord[] {
  const { origin: o, dims: d } = field;
  const out: MacroCoord[] = [];
  for (let y = o.y; y < o.y + d.mazeH; y++) {
    for (let x = o.x; x < o.x + d.mazeW; x++) if (field.walkable(x, y)) out.push({ x, y });
  }
  return out;
}
