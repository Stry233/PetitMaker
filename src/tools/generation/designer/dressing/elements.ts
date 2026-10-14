/**
 * The blocks a kit builds a place out of, and the engine that lays them. Two planting grammars,
 * read off the decoded expert maps: a flower goes down as a step-1 solid block of one species, a
 * tree as a step-2 lattice. Everything is one of those, a pair of straight one-species runs along a
 * block's edges, or bare ground.
 *
 * The tiling is mirror-symmetric by construction: a block's element and species come from its
 * mirrored index, so both halves ask for the same thing before `symmetry.ts` reflects the marks,
 * which would otherwise drop half of them.
 *
 * `KitCanvas.cover` is reached by walking blocks up a ladder (bare, tree lattice, stripes, solid
 * bed), never by packing a bed tighter: a composed planet differs from a carpet in arrangement, not amount.
 *
 * Pure and deterministic per (canvas, style): every draw hashes the block's mirrored index.
 */
import { cellKey, type Rect } from '../../../../core/grid/rect';
import type { PlantRole } from './palette';
import { inCanvas, type KitCanvas, type KitStyle, type PlantMark, type TileKind } from './types';
import { fnv1a32 } from '../../../../core/base/hash';
import { clamp } from '../../../../core/base/math';

/** What share of a tree block's cells a step-2 lattice actually plants: one in four, since every
 *  tree carries an exclusion radius of a cell. */
const LATTICE_FILL = 0.25;
/** Cells between two blocks: one, so a bed reads as a bed rather than as a field. */
const TILE_GAP = 1;
/** What share of a canvas the blocks actually stand on. They are laid `TILE_GAP` apart, so a 5x5
 *  block grid covers about 0.69 of its ground and a 7x6 one about 0.75. */
const TILE_YIELD = 0.7;
/** The most of a run any composition plants: a run planted edge to edge is a carpet. */
const COVER_MAX = 0.9;
/** Share of blocks that plant the accent family instead of the dominant one. Held well under half so
 *  the region's dominant family stays over 60% of its decor. */
const ACCENT_SHARE = 0.25;
/** What share of a block each element covers, used to steer the tiling toward `cover`. */
const FILL: Readonly<Record<TileKind, number>> = {
  bed: 1, rows: 0.5, checker: 0.5, border: 0.4,
  orchard: LATTICE_FILL, grove: LATTICE_FILL, open: 0,
};
/**
 * The ladder is two rungs, bare ground and a solid bed: the grain rule. Half-filled rungs would
 * reach a cover by speckling every block; half the blocks solid and the rest bare plants the same
 * cells in far fewer pieces, the grain of a bed or a specimen with nothing between.
 *
 * Trees are off the ladder, which holds the tree-to-flower ratio: a lattice covers a quarter of its
 * block, so one ladder would answer "plant more" by turning orchards into beds. Tree ground is set
 * first from `KitCanvas.treeShare` and the cover knob moves only the rest.
 *
 * A border, chequer or striped block stands at the bottom rung: kept while the cover is low, it
 * becomes a bed where the cover is high, so line planting survives at the quiet end.
 */
const STEERABLE: Readonly<Record<TileKind, boolean>> = {
  open: true, border: true, rows: true, checker: true, bed: true, orchard: false, grove: false,
};
/**
 * The moves a block makes in each direction, which are not symmetric.
 *
 * Up goes straight to a solid bed, which is the grain rule: a place that needs more planting gets
 * another bed, never a whole canvas of half-filled blocks.
 *
 * Down walks every rung, because the quiet end of the richness axis is the flat garden town and its own
 * planting is line planting — its near-water flora is period-2 rows and nothing else. Skipping rungs
 * would let a region planting three blocks in total be dominated by whichever family the kit's accent
 * roll gave one of them. So a place with little to plant keeps its border runs and stripes, and a place
 * with a lot reads as beds.
 */
const DOWN: readonly TileKind[] = ['open', 'border', 'rows', 'bed'];
const RUNG: Readonly<Record<TileKind, number>> = {
  open: 0, border: 1, rows: 2, checker: 2, bed: 3, orchard: -1, grove: -1,
};
const promote = (kind: TileKind): TileKind | null => (kind === 'bed' ? null : 'bed');
const demote = (kind: TileKind): TileKind | null => {
  const at = RUNG[kind];
  return at <= 0 ? null : DOWN[at - 1]!;
};


/**
 * The most of a run one composition may plant, given its tree share. A tree block plants a quarter
 * of itself, so a tree share `s` at cover `c` commits `4sc` of the ground to lattices and leaves the
 * flowers `(1 - s)c`; the two fit while `c <= 1 / (1 + 3s)`, and past that the map-level correction
 * spirals thinner. `TILE_YIELD` accounts for the air between blocks that makes a bed read as a bed.
 */
export const coverCap = (treeShare: number): number =>
  Math.min(COVER_MAX, TILE_YIELD / (1 + 3 * clamp(treeShare, 0, 1)));

/** The bounding box of a set of flat indices. */
export function boxOf(cells: ReadonlySet<number>, W: number): Rect {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const i of cells) {
    const x = i % W, y = (i / W) | 0;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (!isFinite(x0)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** One block of the tiling: where it sits, and the index its element is drawn from. */
interface Tile { rect: Rect; key: string; cells: number }

/**
 * The composition: blocks over the canvas, each carrying one element of the kit's mix.
 *
 * @param mirrorAxis which coordinate the block indices are mirrored in, so the two halves of the
 *        canvas ask for the same elements. `null` composes freely (the informal regions).
 */
export function compose(
  canvas: KitCanvas, style: KitStyle, mirrorAxis: 'v' | 'h' | null,
): PlantMark[] {
  const tiles = layTiles(canvas, style, mirrorAxis);
  if (!tiles.length) return [];

  const kinds = new Map<string, TileKind>();
  const area = new Map<string, number>();
  for (const tile of tiles) {
    area.set(tile.key, (area.get(tile.key) ?? 0) + tile.cells);
    if (!kinds.has(tile.key)) kinds.set(tile.key, drawKind(canvas, style, tile.key));
  }
  steerTrees(canvas, kinds, area, canvas.cells.size);
  const promoted = steerCover(kinds, area, canvas.cells.size, canvas.cover);

  const out: PlantMark[] = [];
  const taken = new Set<number>();
  for (const tile of tiles) {
    for (const mark of fillTile(canvas, tile, kinds.get(tile.key)!, promoted.has(tile.key))) {
      const i = mark.y * canvas.W + mark.x;
      if (taken.has(i)) continue;
      taken.add(i);
      out.push(mark);
    }
  }
  return out;
}

/** The block grid over the canvas, centred in its box, with each block's mirrored index. */
function layTiles(canvas: KitCanvas, style: KitStyle, mirrorAxis: 'v' | 'h' | null): Tile[] {
  const { box } = canvas;
  const tw = Math.max(2, style.tile.w), th = Math.max(2, style.tile.h);
  const cols = Math.max(1, Math.floor((box.w + TILE_GAP) / (tw + TILE_GAP)));
  const rows = Math.max(1, Math.floor((box.h + TILE_GAP) / (th + TILE_GAP)));
  const spanW = cols * tw + (cols - 1) * TILE_GAP;
  const spanH = rows * th + (rows - 1) * TILE_GAP;
  const x0 = box.x + Math.floor((box.w - spanW) / 2);
  const y0 = box.y + Math.floor((box.h - spanH) / 2);

  const out: Tile[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const rect: Rect = { x: x0 + c * (tw + TILE_GAP), y: y0 + r * (th + TILE_GAP), w: tw, h: th };
      let cells = 0;
      for (let y = rect.y; y < rect.y + rect.h; y++) {
        for (let x = rect.x; x < rect.x + rect.w; x++) if (inCanvas(canvas, x, y)) cells++;
      }
      if (cells === 0) continue;
      const kc = mirrorAxis === 'v' ? Math.min(c, cols - 1 - c) : c;
      const kr = mirrorAxis === 'h' ? Math.min(r, rows - 1 - r) : r;
      const middle = style.aisle
        && (mirrorAxis === 'h' ? rows > 2 && 2 * r + 1 === rows : cols > 2 && 2 * c + 1 === cols);
      out.push({ rect, key: middle ? 'aisle' : cellKey(kr, kc), cells });
    }
  }
  return out;
}

/** The element a block carries, drawn from a hash of its mirrored index so the draw cannot depend on
 *  how many blocks came before it. */
function drawKind(canvas: KitCanvas, style: KitStyle, key: string): TileKind {
  if (key === 'aisle') return 'open';
  let total = 0;
  for (const [, weight] of style.mix) total += weight;
  if (total <= 0) return 'open';
  let roll = hash01(canvas.regionId, canvas.elevation, key, 1) * total;
  for (const [kind, weight] of style.mix) {
    roll -= weight;
    if (roll <= 0) return kind;
  }
  return style.mix[style.mix.length - 1]![0];
}

/**
 * How much of the canvas goes under trees, decided before the cover knob touches anything.
 *
 * The wanted tree area follows from three numbers the caller already fixed: the composition plants
 * `cover` of the canvas, `treeShare` of those plants should be trees, and a lattice plants a quarter
 * of the block it stands on — so the blocks given to trees are `4 * cover * treeShare` of the
 * canvas. Blocks are converted largest-first, and a block the kit's own mix already drew as a tree
 * block is the last to be taken away, so a tree avenue stays an avenue while the map's ratio moves.
 */
function steerTrees(
  canvas: KitCanvas, kinds: Map<string, TileKind>, area: Map<string, number>, cells: number,
): void {
  if (cells <= 0) return;
  const want = clamp(canvas.cover * canvas.treeShare / LATTICE_FILL, 0, 1) * cells;
  let now = 0;
  for (const [key, kind] of kinds) if (kind === 'orchard' || kind === 'grove') now += area.get(key) ?? 0;
  // Largest block first, so one step moves the area as far as it can, and never past the point where
  // the step lands further from the target than standing still would.
  const order = [...kinds.keys()].sort((a, b) => (area.get(b) ?? 0) - (area.get(a) ?? 0) || (a < b ? -1 : 1));
  if (now < want) {
    for (const key of order) {
      if (now >= want) break;
      const kind = kinds.get(key)!;
      if (kind === 'orchard' || kind === 'grove' || kind === 'border' || kind === 'checker') continue;
      const a = area.get(key) ?? 0;
      if (now + a > want + a / 2) continue;
      kinds.set(key, 'orchard');
      now += a;
    }
    return;
  }
  // Orchards are felled before groves. A grove is the tree block the kit's own mix asked for, so it
  // is what a tree avenue is made of; an orchard at this point may be one this pass planted. At the
  // quiet end of the axis the map wants six flowers per tree and even the groves have to go, but
  // they go last, and a region whose whole mix is trees keeps its character longest.
  for (const felling of ['orchard', 'grove'] as const) {
    for (const key of order) {
      if (now <= want) return;
      if (kinds.get(key) !== felling) continue;
      const a = area.get(key) ?? 0;
      if (now - a < want - a / 2) continue;
      kinds.set(key, 'open');
      now -= a;
    }
  }
}

/** Walk the flower blocks up or down the ladder until the composition covers about `cover` of the
 *  canvas, counting what the tree blocks already carry. */
function steerCover(
  kinds: Map<string, TileKind>, area: Map<string, number>, cells: number, cover: number,
): Set<string> {
  const promoted = new Set<string>();
  if (cells <= 0) return promoted;
  const covered = (): number => {
    let sum = 0;
    for (const [key, kind] of kinds) sum += FILL[kind] * (area.get(key) ?? 0);
    return sum / cells;
  };
  const movable = [...kinds.keys()].filter((k) => STEERABLE[kinds.get(k)!]);
  // Largest block first, so a step changes the cover as much as it can.
  movable.sort((a, b) => (area.get(b) ?? 0) - (area.get(a) ?? 0) || (a < b ? -1 : 1));
  // Round robin, not block by block: walking one block to the top of the ladder before touching the
  // next leaves a composition of a few solid beds among bare ground, which is a carpet beside a lawn
  // rather than a composed place. Every block rises a rung, then every block rises again.
  let cursor = 0;
  for (let guard = 0; guard < 3 * movable.length; guard++) {
    const now = covered();
    if (Math.abs(now - cover) < 0.02) return promoted;
    const up = now < cover;
    let moved = false;
    for (let step = 0; step < movable.length && !moved; step++) {
      const key = movable[(cursor + step) % movable.length]!;
      const kind = kinds.get(key)!;
      const next = up ? promote(kind) : demote(kind);
      if (!next) continue;
      // A step that lands further from the target is not taken. On a canvas holding two or three
      // steerable blocks the rungs are coarse, so a run asked for a third of its ground can sit
      // between two of them — and a loop that only asks which side of the target it is on walks
      // straight past, then back, until it settles at the far rung, which plants a run at an eighth
      // of the cover it asked for.
      const after = now + (FILL[next] - FILL[kind]) * (area.get(key) ?? 0) / cells;
      if (Math.abs(after - cover) >= Math.abs(now - cover)) continue;
      kinds.set(key, next);
      if (next === 'bed') promoted.add(key);
      else promoted.delete(key);
      cursor = (cursor + step + 1) % movable.length;
      moved = true;
    }
    if (!moved) return promoted;
  }
  return promoted;
}

/**
 * The marks one block lays.
 *
 * A bed the cover knob added plants the region's own family. The accent is a deliberate draw of the
 * kit — a quarter of the blocks it composes — and a block the steering promoted to reach a cover is not
 * one of those: letting it keep its accent roll spent the region's unity on how much ground was being
 * planted rather than on how the place was composed, which is what the per-region unity reading is for.
 */
function fillTile(canvas: KitCanvas, tile: Tile, kind: TileKind, promoted = false): PlantMark[] {
  if (kind === 'open') return [];
  const { rect } = tile;
  const role: PlantRole = !promoted
    && hash01(canvas.regionId, canvas.elevation, tile.key, 2) < ACCENT_SHARE
    ? 'accent' : 'mass';
  const out: PlantMark[] = [];
  const put = (x: number, y: number, catalogId: string): void => {
    if (catalogId && inCanvas(canvas, x, y)) out.push({ x, y, catalogId });
  };
  const flower = canvas.palette.species(kind === 'border' ? 'edge' : role);
  const second = canvas.palette.species(role === 'accent' ? 'mass' : 'accent');
  const tree = canvas.palette.species(kind === 'grove' ? 'grove-accent' : 'grove');

  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      switch (kind) {
        case 'bed': put(x, y, flower); break;
        case 'rows': if ((y - rect.y) % 2 === 0) put(x, y, flower); break;
        case 'checker': put(x, y, (x + y) % 2 === 0 ? flower : second); break;
        // Two parallel runs along the block's long axis, not a closed frame: border planting is straight
        // same-species runs of four and more, and a ring of them at block scale
        // tiles the map with picture frames.
        case 'border':
          if (rect.w >= rect.h ? (y === rect.y || y === rect.y + rect.h - 1)
            : (x === rect.x || x === rect.x + rect.w - 1)) put(x, y, flower);
          break;
        // One parity for every tree on the map, absolute rather than each block's own. Two
        // adjacent lattices then line up into one orchard instead of meeting at a seam — and, more
        // than that, every tree carries an exclusion radius of one cell, so two lattices on
        // opposite parities would stand diagonally adjacent and the rules would refuse half of the
        // second one. A grove differs from an orchard by its species, not by its phase.
        case 'orchard':
        case 'grove': if (x % 2 === 0 && y % 2 === 0) put(x, y, tree); break;
      }
    }
  }
  return out;
}

/** A stable value in [0,1) per (region, elevation, block, salt). */
function hash01(regionId: string, elevation: number, key: string, salt: number): number {
  let h = fnv1a32(`${regionId}|${key}`, 0x9e3779b9 ^ (elevation * 0x27d4eb2d) ^ (salt * 0x165667b1));
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

