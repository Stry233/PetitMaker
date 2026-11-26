/**
 * draw_area: a place drawn as rows of text, one mark per cell, each mark standing for ground, a
 * thing or both. The drawing may be completed by mirroring and repeated as a tile; it lands as one
 * undo step, ground first, then paving, then everything else.
 */
import { removeObjectCommand } from '../../core/model/command-build';
import { ROTATIONS, type CatalogItem, type MacroCoord, type PlacedObject, type Rotation } from '../../core/model/types';
import { cellKey } from '../../core/grid/rect';
import { cellSet } from '../../core/grid/grids';
import { footprintCells, getRotatedSize, terrainCellsUnder } from '../../core/grid/footprint';
import { ELEVATION_MAX, PLACEMENT_GRID } from '../../core/game/profile';
import { isBridge, isCoatingItem, isRamp, standsOnCoating } from '../../core/model/traits';
import { getCatalogItem, getOfferedItem } from '../../state/catalog';
import { roadLookup } from '../../state/object-index';
import { objectRect, placedFootprint } from '../../state/object-geometry';
import { orientedFacing } from '../../tools/blueprint';
import { layDrawnGround, type GroundAsk } from '../../tools/macros';
import { argError, dedupe, formatErrors } from './feedback';
import { drawnRow, raggedRows } from './geometry';
import { buildPlaceCmd } from './objects';
import { bool, int, list, obj, oneOf, req, str } from './schema';
import { defineTool } from './spec';
import { runStrokeBody } from './stroke';

const MAX_ROWS = 80;
const MAX_COLUMNS = 96;
const MAX_CELLS = 6500;
/** The most cells a ground-only drawing at a scale may mark: the open ground of a whole island. */
const MAX_GROUND_CELLS = 20000;
/** The most cells a character may stand for on a side. */
const MAX_SCALE = 6;

/** What one mark lays on its cell: ground, things, or both. */
interface Mark {
  ground?: { water: true; level?: number } | { water: false; level: number };
  things: { id: string; item: CatalogItem; rotation?: Rotation }[];
}

/** The marks that leave a cell alone: the blank ones always, and the edge and object glyphs of a map read unless the legend gives them a meaning. */
const BLANK = new Set(['.', ' ']);
const LEAVE = new Set([...BLANK, '=', '^', 'o', 'P']);

function builtIn(mark: string): Mark | null {
  if (mark === '~') return { ground: { water: true }, things: [] };
  if (mark >= '0' && mark <= '9') return { ground: { water: false, level: Number(mark) }, things: [] };
  return null;
}

/** One legend line, `T=tree-apple` or `a=1+path-stone` or `h=house-id@90`, as its mark, or the problem with it. */
function legendEntry(line: string): { mark: string; is: Mark } | string {
  const cut = line.indexOf('=');
  const mark = line.slice(0, cut).trim();
  if (cut < 1 || [...mark].length !== 1) return `legend line "${line}" must read <one character>=<what it is>`;
  if (BLANK.has(mark) || builtIn(mark)) return `"${mark}" already has a meaning and cannot be redefined; pick a letter`;
  const is: Mark = { things: [] };
  for (const raw of line.slice(cut + 1).split('+')) {
    const part = raw.trim();
    if (!part) continue;
    const level = /^(?:level\s*)?(\d)$/.exec(part);
    const water = /^water(?:\s*(\d))?$/.exec(part);
    if (level) { is.ground = { water: false, level: Number(level[1]) }; continue; }
    if (water) { is.ground = { water: true, ...(water[1] ? { level: Number(water[1]) } : {}) }; continue; }
    const [id = '', turn] = part.split('@');
    const item = getOfferedItem(id.trim());
    if (!item) return `legend "${mark}": unknown catalogId "${id.trim()}", use ids from the CATALOG section`;
    const rotation = turn === undefined ? undefined : ROTATIONS.find((r) => r === Number(turn));
    if (turn !== undefined && rotation === undefined) return `legend "${mark}": rotation must be one of ${ROTATIONS.join(', ')}`;
    is.things.push({ id: id.trim(), item, ...(rotation === undefined ? {} : { rotation }) });
  }
  if (!is.ground && is.things.length === 0) return `legend "${mark}" names nothing`;
  return { mark, is };
}

/** One thing to place, by its top-left cell in the drawing. */
interface Piece { mark: string; id: string; item: CatalogItem; rotation: Rotation; c: number; r: number; w: number; h: number }

/** The facing a piece takes in the mirror image across a vertical line (`x`) or a horizontal one, by the rule a flipped blueprint follows. */
const flipped = (p: Piece, axis: 'x' | 'y'): Rotation => orientedFacing(p.rotation, p.item, { mirror: true, quarters: axis === 'x' ? 0 : 2 });

/** The drawing as given: the ground mark of every cell and the pieces standing on it. */
interface Drawing { w: number; h: number; ground: (Mark['ground'] | undefined)[][]; pieces: Piece[] }

function readDrawing(rows: readonly string[], legend: ReadonlyMap<string, Mark>): Drawing | string {
  const grid = rows.map((row) => [...row]);
  const h = grid.length, w = Math.max(...grid.map((row) => row.length));
  const ground: Drawing['ground'] = grid.map(() => new Array<Mark['ground'] | undefined>(w).fill(undefined));
  const pieces: Piece[] = [];
  const taken = grid.map(() => new Array<boolean>(w).fill(false));
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const mark = grid[r]![c] ?? '.';
      if (LEAVE.has(mark) && !legend.has(mark)) continue;
      const is = builtIn(mark) ?? legend.get(mark);
      if (!is) return `row ${r + 1} uses "${mark}", which the legend does not define`;
      ground[r]![c] = is.ground;
      if (taken[r]![c]) continue;
      for (const thing of is.things) {
        const big = thing.item.width > 1 || thing.item.height > 1;
        if (!big || isBridge(thing.item) || isRamp(thing.item)) {
          pieces.push({ mark, id: thing.id, item: thing.item, rotation: thing.rotation ?? 0, c, r, w: 1, h: 1 });
          continue;
        }
        // A larger item is one mark at its top-left cell, or a block of its mark at its size.
        let bw = 1, bh = 1;
        while (grid[r]![c + bw] === mark) bw++;
        while (grid[r + bh]?.[c] === mark) bh++;
        const upright = getRotatedSize(thing.item, 0), turned = getRotatedSize(thing.item, 90);
        let rotation = thing.rotation ?? 0;
        if (bw * bh > 1) {
          const size = getRotatedSize(thing.item, rotation);
          if (bw === size.w && bh === size.h) { /* drawn at its size */ }
          else if (thing.rotation === undefined && thing.item.rotatable && bw === turned.w && bh === turned.h) rotation = 90;
          else return `"${mark}" (${thing.id}) is ${upright.w}x${upright.h}: draw it as one mark at its top-left cell or as a block of exactly that size, not ${bw}x${bh} at row ${r + 1}`;
          for (let dr = 0; dr < bh; dr++) for (let dc = 0; dc < bw; dc++) taken[r + dr]![c + dc] = true;
        }
        const size = getRotatedSize(thing.item, rotation);
        pieces.push({ mark, id: thing.id, item: thing.item, rotation, c, r, w: size.w, h: size.h });
      }
    }
  }
  return { w, h, ground, pieces };
}

/** The drawing completed by its mirror image across the right edge (`x`) or the bottom edge; `shared` keeps the last column or row as the middle, drawn once. */
function mirrored(d: Drawing, axis: 'x' | 'y', shared: boolean): Drawing {
  const span = axis === 'x' ? d.w : d.h;
  const full = shared ? span * 2 - 1 : span * 2;
  const w = axis === 'x' ? full : d.w, h = axis === 'y' ? full : d.h;
  const ground: Drawing['ground'] = Array.from({ length: h }, (_, r) => Array.from({ length: w }, (_, c) => {
    const sr = axis === 'y' && r >= d.h ? full - 1 - r : r, sc = axis === 'x' && c >= d.w ? full - 1 - c : c;
    return d.ground[sr]?.[sc];
  }));
  const pieces = [...d.pieces];
  for (const p of d.pieces) {
    const at = axis === 'x' ? p.c : p.r, size = axis === 'x' ? p.w : p.h;
    const twin = full - (at + size);
    // A piece lying across the mirror line is itself the middle and stands once.
    if (twin < at + size) continue;
    pieces.push(axis === 'x' ? { ...p, c: twin, rotation: flipped(p, 'x') } : { ...p, r: twin, rotation: flipped(p, 'y') });
  }
  return { w, h, ground, pieces };
}

/** The drawing laid `columns` across and `rows` down, `gapX` and `gapY` untouched cells between copies. */
function tiled(d: Drawing, columns: number, rows: number, gapX: number, gapY: number): Drawing {
  const w = d.w * columns + gapX * (columns - 1), h = d.h * rows + gapY * (rows - 1);
  const ground: Drawing['ground'] = Array.from({ length: h }, () => new Array<Mark['ground'] | undefined>(w).fill(undefined));
  const pieces: Piece[] = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < columns; i++) {
      const ox = i * (d.w + gapX), oy = j * (d.h + gapY);
      d.ground.forEach((row, r) => row.forEach((g, c) => { if (g) ground[oy + r]![ox + c] = g; }));
      for (const p of d.pieces) pieces.push({ ...p, c: p.c + ox, r: p.r + oy });
    }
  }
  return { w, h, ground, pieces };
}

export const drawAreaTool = defineTool({
  description: 'Build a whole place from a drawing: rows of text, one character per cell, top-left at (x,y). '
    + `Built-in marks: "." leaves the cell as it is, "~" water, a digit raised ground at that level (0 is flat ground, 1-${ELEVATION_MAX} higher). `
    + 'Every other character is defined in legend, one line each: "T=tree-apple", "p=path-stone", "h=house-id@90" (rotation), and "+" joins ground with things: "t=1+tree-apple" is a tree on level 1, "a=1+path-stone" paving on level 1. '
    + 'Ground is laid first, then paving, then everything else, in one undo step. A thing with no level of its own stands at the level of the ground drawn around it. '
    + 'Ground reaches half a cell past its marks. Whatever stands keeps its ground, so water drawn right beside a thing stops half a cell short of it and the thing stays on dry ground; water between two things needs two "~" across to show. Where two kinds of ground meet, the half cell between them goes to the one drawn less, the figure: a pool in a terrace or a shape of land in a pool keeps its drawn shape. '
    + 'A water body takes the level of the lowest ground around it, so a pool drawn on a terrace lies in the terrace. '
    + 'An item larger than one cell is one mark at its top-left cell, the rest of its footprint left "."; trees and houses need a free cell between them. '
    + 'mirror completes the drawing so both sides match exactly: "x" mirrors it to the right (draw the left half), "y" downward (draw the top half), "xy" both (draw the top-left quarter); give x2,y2, the far corner of the area, and draw the half rounded up: the tool completes it to exactly that size. '
    + 'repeatX and repeatY lay the finished drawing as a tile, gapX and gapY cells apart. '
    + 'scale draws ground at island size: each character stands for a square of that many cells on a side, so 35 characters span 140 cells; a drawing at a scale holds ground marks only, and x2,y2 stay in cells. '
    + 'The result counts what landed per mark and names what was refused.',
  input: obj({
    x: req(int({ description: 'Left column of the drawing.' })),
    y: req(int({ description: 'Top row of the drawing.' })),
    reads_as: req(str({ description: 'Before the rows: what a visitor must see here to call this place what was asked, and where this drawing puts each of it. A court is closed in on its sides, has a floor to stand on and one thing at its centre; an orchard is one tree in rows with lanes between; a word is letters a visitor can read, each one drawn as its letter. For a correction, what it restores.' })),
    x2: int({ description: 'Right column the finished drawing must end on. With mirror "x" or "xy" draw the left half, rounded up: the tool completes it to exactly this width, sharing the middle column when the width is odd.' }),
    y2: int({ description: 'Bottom row the finished drawing must end on; with mirror "y" or "xy" draw the top half, rounded up.' }),
    rows: req(list(str(), { description: 'The drawing, top row first; every row the same length. Write a run of one mark as the mark and its count in braces: "2{26}3{20}" is twenty-six 2s then twenty 3s.' })),
    legend: list(str(), { description: 'One line per mark you define: "<character>=<catalogId>", optionally "@<rotation>" and "<level>+" or "water+" before it. A mark may also be ground alone: "<character>=<level>" for land, "<character>=water<level>" for water held at that level, such as a pool raised on a terrace inside a ring of the terrace. A drawing does not make falls: unstated water touching lower ground is laid at the lower level, and water at a stated level must be ringed by ground of its own level; carve_river begun inside a raised pool makes the falls.' }),
    mirror: oneOf(['x', 'y', 'xy'], { description: 'Complete the drawing by its mirror image: x to the right, y downward, xy both.' }),
    seam: oneOf(['shared', 'doubled'], { description: 'Only without x2/y2. shared (default): the last column or row drawn is the middle, drawn once, for an odd size. doubled: it is repeated, for an even size.' }),
    repeatX: int({ min: 1, max: MAX_COLUMNS, description: 'How many copies across (default 1).' }),
    repeatY: int({ min: 1, max: MAX_ROWS, description: 'How many copies down (default 1).' }),
    gapX: int({ min: 0, max: 20, description: 'Untouched cells between copies across (default 0).' }),
    gapY: int({ min: 0, max: 20, description: 'Untouched cells between copies down (default 0).' }),
    replace: bool({ description: 'Remove what already stands on the cells that carry a mark before drawing (default false: occupied cells are skipped and reported).' }),
    scale: int({ min: 1, max: MAX_SCALE, description: 'Cells each character stands for on a side (default 1). Above 1 the drawing holds ground only: digits, "~", "." and ground marks of the legend.' }),
  }),
  access: 'write',
  example: 'x: 20, y: 30, reads_as: "a parterre: beds framed by a path, a tree at each corner, the same on both sides", rows: ["ppppp", "pFFF.", "pF.T."], legend: ["p=<a path id>", "F=<a flower id>", "T=<a tree id>"], mirror: "xy"',
  async run(deps, input) {
    if (input.rows.length === 0) return argError('rows is empty, give the drawing as rows of text.');
    const rows = input.rows.map(drawnRow);
    // Row length decides the result only against a named far corner or a mirror; elsewhere a short row ends early.
    const ragged = input.x2 !== undefined || input.y2 !== undefined || input.mirror !== undefined ? raggedRows(rows) : null;
    if (ragged) return argError(`${ragged}; give every row the same length, writing long runs as mark{count}. Nothing was drawn.`);
    if (rows.length > MAX_ROWS || rows.some((row) => [...row].length > MAX_COLUMNS)) {
      return argError(`a drawing is at most ${MAX_COLUMNS} columns by ${MAX_ROWS} rows; draw the place in parts.`);
    }
    const legend = new Map<string, Mark>();
    for (const line of input.legend ?? []) {
      const entry = legendEntry(line);
      if (typeof entry === 'string') return argError(entry);
      legend.set(entry.mark, entry.is);
    }
    const scale = input.scale ?? 1;
    const first = readDrawing(rows, legend);
    if (typeof first === 'string') return argError(first);
    if (scale > 1 && first.pieces.length > 0) {
      return argError(`at scale ${scale} a drawing holds ground only (digits, "~", "." and ground marks of the legend); "${first.pieces[0]!.mark}" stands for ${first.pieces[0]!.id}. Draw things at scale 1. Nothing was drawn.`);
    }
    // At a scale every character becomes a square of cells; the rest of the tool reads cells.
    const read = scale > 1
      ? readDrawing(rows.flatMap((row) => new Array<string>(scale).fill([...row].map((mark) => mark.repeat(scale)).join(''))), legend)
      : first;
    if (typeof read === 'string') return argError(read);
    const cellLimit = scale > 1 ? MAX_GROUND_CELLS : MAX_CELLS;
    let drawing = read;
    const ox = input.x, oy = input.y;
    // With the far corner given, the seam follows from the size one copy must have: an odd span shares its middle.
    const copiesX = input.repeatX ?? 1, copiesY = input.repeatY ?? 1;
    const gapX = input.gapX ?? 0, gapY = input.gapY ?? 0;
    const spanX = input.x2 === undefined ? undefined : input.x2 - ox + 1, spanY = input.y2 === undefined ? undefined : input.y2 - oy + 1;
    /** The size one copy must come to for `copies` of it, `gap` apart, to fill `span` exactly; NaN when they cannot. */
    const tile = (span: number | undefined, copies: number, gap: number): number | undefined => {
      if (span === undefined) return undefined;
      const one = (span - gap * (copies - 1)) / copies;
      return Number.isInteger(one) && one > 0 ? one : NaN;
    };
    const tileX = tile(spanX, copiesX, gapX), tileY = tile(spanY, copiesY, gapY);
    const mirrorsX = input.mirror === 'x' || input.mirror === 'xy', mirrorsY = input.mirror === 'y' || input.mirror === 'xy';
    const shared = (one: number | undefined): boolean => (one === undefined || Number.isNaN(one) ? input.seam !== 'doubled' : one % 2 === 1);
    if (mirrorsX) drawing = mirrored(drawing, 'x', shared(tileX));
    if (mirrorsY) drawing = mirrored(drawing, 'y', shared(tileY));
    /** The refusal of a drawing whose one copy does not come to the size the named area gives it, or null. */
    const misfit = (m: { name: string; span?: number; one?: number; copies: number; got: number; half: number; mirrors: boolean }): string | null => {
      if (m.span === undefined || m.one === undefined || m.one === m.got) return null;
      const each = m.copies > 1 ? ` (${m.copies} copies${Number.isNaN(m.one) ? ', which do not divide it evenly' : ` of ${m.one}`})` : '';
      const want = m.mirrors && !Number.isNaN(m.one) ? ` Draw ${Math.ceil(m.one / 2)} ${m.name} for the half; you drew ${m.half}.` : '';
      return `one copy of the finished drawing is ${m.got} ${m.name} but the area you named is ${m.span}${each}.${want} Nothing was drawn.`;
    };
    const wide = misfit({ name: 'columns', span: spanX, one: tileX, copies: copiesX, got: drawing.w, half: read.w, mirrors: mirrorsX });
    const tall = misfit({ name: 'rows', span: spanY, one: tileY, copies: copiesY, got: drawing.h, half: read.h, mirrors: mirrorsY });
    if (wide || tall) return argError((wide ?? tall)!);
    if (drawing.w * copiesX * drawing.h * copiesY > cellLimit * 4) return argError('the finished drawing is too large for one call; draw it in parts.');
    if (copiesX > 1 || copiesY > 1) drawing = tiled(drawing, copiesX, copiesY, gapX, gapY);
    // Every cell that carries a mark, and whether something stands on it.
    const marked = new Map<string, MacroCoord>();
    const standing = new Map<string, number | undefined>();
    // How much of each kind of ground the drawing holds: the kind drawn less is the figure.
    const drawn = new Map<string, number>();
    const kindOf = (g: NonNullable<Mark['ground']>): string => (g.water ? 'water' : `land ${g.level}`);
    drawing.ground.forEach((row, r) => row.forEach((g, c) => {
      if (!g) return;
      marked.set(cellKey(ox + c, oy + r), { x: ox + c, y: oy + r });
      drawn.set(kindOf(g), (drawn.get(kindOf(g)) ?? 0) + 1);
    }));
    /** The level of the land drawn around a cell that states none: the commonest among its neighbours, the higher on a tie. */
    const levelAround = (c: number, r: number, w: number, h: number): number | undefined => {
      const seen = new Map<number, number>();
      for (let dr = -1; dr <= h; dr++) {
        for (let dc = -1; dc <= w; dc++) {
          if (dr >= 0 && dr < h && dc >= 0 && dc < w) continue;
          const g = drawing.ground[r + dr]?.[c + dc];
          if (g && !g.water) seen.set(g.level, (seen.get(g.level) ?? 0) + 1);
        }
      }
      // A piece drawn over its own land marks, with none around it, stands on what it covers.
      if (seen.size === 0) {
        for (let dr = 0; dr < h; dr++) {
          for (let dc = 0; dc < w; dc++) {
            const g = drawing.ground[r + dr]?.[c + dc];
            if (g && !g.water) seen.set(g.level, (seen.get(g.level) ?? 0) + 1);
          }
        }
      }
      let best: number | undefined, most = 0;
      for (const [level, n] of seen) if (n > most || (n === most && level > (best ?? -1))) { best = level; most = n; }
      return best;
    };
    for (const p of drawing.pieces) {
      const g = drawing.ground[p.r]?.[p.c];
      const claims = !isBridge(p.item) && !isRamp(p.item) && !(g && g.water);
      const level = g && !g.water ? g.level : levelAround(p.c, p.r, p.w, p.h);
      for (const cell of footprintCells(ox + p.c, oy + p.r, p.w, p.h)) {
        const key = cellKey(cell.x, cell.y);
        marked.set(key, cell);
        if (claims) standing.set(key, level ?? standing.get(key));
      }
    }
    if (marked.size === 0) return argError('the drawing marks no cell: every character is "." or blank.');
    if (marked.size > cellLimit) return argError(`the drawing marks ${marked.size} cells (max ${cellLimit}); draw the place in parts.`);
    const region = deps.getRegion();
    if (region.length > 0) {
      const inside = new Set(region.map((c) => cellKey(c.x, c.y)));
      const out = [...marked.values()].find((c) => !inside.has(cellKey(c.x, c.y)));
      if (out) {
        return argError(`the drawing reaches (${out.x},${out.y}), outside the region you may edit; it spans (${ox},${oy})-(${ox + drawing.w - 1},${oy + drawing.h - 1}). Move or shrink it. Nothing was drawn.`);
      }
    }

    const exec = deps.getExecutor();
    const failures: string[] = [];
    const tally = new Map<string, { id: string; asked: number; landed: number; kept: number; refused: MacroCoord[] }>();
    const count = (p: Piece) => {
      const key = `${p.mark} ${p.id}`;
      let row = tally.get(key);
      if (!row) { row = { id: p.id, asked: 0, landed: 0, kept: 0, refused: [] }; tally.set(key, row); }
      return row;
    };
    const ground = { water: 0, raised: 0, flat: 0, same: 0, skipped: 0 };
    let removed = 0;
    const removedLarge: string[] = [];
    // The cells something drawn will stand on: there everything gives way; on ground-only marks only what blocks ground does.
    const pieceCells = new Set<string>();
    for (const p of drawing.pieces) for (const cell of footprintCells(ox + p.c, oy + p.r, p.w, p.h)) pieceCells.add(cellKey(cell.x, cell.y));
    const placedObjects: PlacedObject[] = [];
    const notes: string[] = [];

    const stroke = await runStrokeBody(deps, 'the drawing', () => {
      const state = deps.getState();
      if (input.replace) {
        for (const o of [...state.objects.values()]) {
          if (o.locked) continue;
          const r = objectRect(o);
          const under = footprintCells(r.x, r.y, r.w, r.h).filter((c) => marked.has(cellKey(c.x, c.y)));
          if (under.length === 0) continue;
          // Paving lies on ground and does not block it, so a ground-only mark leaves it.
          if (isCoatingItem(getCatalogItem(o.catalogId)) && !under.some((c) => pieceCells.has(cellKey(c.x, c.y)))) continue;
          if (!exec.execute(removeObjectCommand(o)).success) continue;
          removed++;
          if (r.w * r.h > 1) removedLarge.push(`${o.catalogId} at (${r.x},${r.y})`);
        }
      }

      // What each terrain cell is asked to be by the cells resting on it.
      const asks = new Map<string, GroundAsk>();
      for (const [key, cell] of marked) {
        const g = drawing.ground[cell.y - oy]?.[cell.x - ox];
        for (const t of terrainCellsUnder({ x: cell.x, y: cell.y, w: 1, h: 1 })) {
          const tk = cellKey(t.x, t.y);
          let entry = asks.get(tk);
          if (!entry) { entry = { at: t, stand: [], ground: [] }; asks.set(tk, entry); }
          if (standing.has(key)) entry.stand.push(standing.get(key));
          else if (g) entry.ground.push(g);
        }
      }
      const laid = layDrawnGround({ state, executor: exec, registry: exec.getRegistry() }, asks, (g) => drawn.get(kindOf(g)) ?? 0);
      if (laid.clash > 0) notes.push(`${laid.clash} spot(s) have things on two different levels side by side; they need a cell between them, and the higher level was laid there.`);
      for (const errors of laid.errors) failures.push(formatErrors(errors));
      Object.assign(ground, { water: laid.water, raised: laid.raised, flat: laid.flat, same: laid.same, skipped: laid.skipped });

      // Paving before what stands on it, each in reading order.
      const ordered = [...drawing.pieces].sort((a, b) => Number(isCoatingItem(b.item)) - Number(isCoatingItem(a.item)) || a.r - b.r || a.c - b.c);
      for (const p of ordered) {
        const row = count(p);
        row.asked++;
        const at = { x: ox + p.c, y: oy + p.r };
        const road = roadLookup(deps.getState())(at.x, at.y);
        if (isCoatingItem(p.item)) {
          if (road && road.catalogId === p.id && road.rotation === p.rotation) { row.kept++; continue; }
          if (road) exec.execute(removeObjectCommand(road));
        } else if (road && !standsOnCoating(p.item, getCatalogItem(road.catalogId)!)) {
          row.refused.push(at);
          failures.push(`${p.id} cannot stand on the paving at (${at.x},${at.y})`);
          continue;
        }
        const cmd = buildPlaceCmd(deps, p.id, at, p.rotation);
        if (typeof cmd === 'string') { row.refused.push(at); failures.push(cmd); continue; }
        const r = exec.execute(cmd);
        if (r.success) {
          row.landed++;
          const landed = deps.getState().objects.get(cmd.object.id);
          if (landed) placedObjects.push(landed);
        } else {
          const twin = [...deps.getState().objects.values()].find((o) => o.catalogId === p.id && o.position.x === at.x && o.position.y === at.y);
          if (twin && (twin.rotation === p.rotation || !p.item.rotatable)) { row.kept++; continue; }
          row.refused.push(at);
          failures.push(twin ? `${p.id} already stands at (${at.x},${at.y}) facing ${twin.rotation}; replace: true turns it` : formatErrors(r.errors));
        }
      }
    });
    if ('refusal' in stroke) return stroke.refusal;

    const landedThings = [...tally.values()].reduce((n, row) => n + row.landed + row.kept, 0);
    const landedGround = ground.water + ground.raised + ground.flat;
    if (placedObjects.length > 0) deps.onFlash?.([cellSet(PLACEMENT_GRID, placedObjects.flatMap(placedFootprint))]);
    const lines: string[] = [];
    lines.push(`Drew ${drawing.w}x${drawing.h} cells at (${ox},${oy})-(${ox + drawing.w - 1},${oy + drawing.h - 1}).`);
    if (removed > 0) lines.push(`Removed ${removed} object(s) that stood on marked cells${removedLarge.length > 0 ? `, among them ${removedLarge.slice(0, 6).join(', ')}` : ''}.`);
    const groundParts = [
      ground.water > 0 ? `water on ${ground.water}` : '', ground.raised > 0 ? `raised ground on ${ground.raised}` : '',
      ground.flat > 0 ? `flat ground on ${ground.flat}` : '',
    ].filter(Boolean);
    if (groundParts.length > 0) lines.push(`Ground (in half-cell pieces): ${groundParts.join(', ')}.`);
    if (ground.same > 0) lines.push(`${ground.same} piece(s) of ground were already as drawn.`);
    if (ground.skipped > 0) lines.push(`${ground.skipped} piece(s) of ground were left as they are: outside buildable ground or under something standing.`);
    for (const [key, row] of tally) {
      const mark = key.slice(0, key.indexOf(' '));
      const refused = row.refused.length > 0
        ? `, ${row.refused.length} refused at ${row.refused.slice(0, 8).map((c) => `(${c.x},${c.y})`).join(' ')}${row.refused.length > 8 ? ' ...' : ''}`
        : '';
      lines.push(`${mark} ${row.id}: ${row.landed + row.kept}/${row.asked}${row.kept > 0 ? ` (${row.kept} already there)` : ''}${refused}`);
    }
    lines.push(...notes);
    if (failures.length > 0) lines.push(`Why (most common):\n${dedupe(failures).slice(0, 4).join('\n')}`);
    const nothing = landedThings + landedGround + ground.same + removed === 0;
    if (nothing) lines.push('Nothing landed. Read the reasons, change the drawing and draw again.');
    return { isError: nothing, content: lines.join('\n'), ...(stroke.detail ? { detail: stroke.detail } : {}) };
  },
});
