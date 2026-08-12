/*
 * stencil-generator.ts — laying a `Stencil` onto the map, in the two ways the shelf offers.
 *
 * SHAPE (the text mode) reads the stencil's coverage: the cells inside the glyph become terrain, or
 * carry an object each. COLOUR (the image mode) ignores the shape and reads each cell's colour,
 * choosing the terrain whose own colour comes nearest — the elevation palette is a green ramp, so a
 * picture lands as a mosaic that is still a real, buildable map underneath.
 *
 * EVERYTHING IS BUILT BOTTOM-UP, one layer at a time, exactly as the maze builds its walls: a cell
 * that wants layer 4 gets 1, 2 and 3 under it first. That is what keeps an arbitrary picture legal
 * without the rules having to reject most of it — nothing ever floats, so the 3x3 base rule has a
 * mass to find. A layer refused as a batch is retried cell by cell and only the cells that took it
 * climb any further, so the shape degrades at its edges rather than vanishing.
 */
import { CommandType, ItemCategory, TerrainType } from '../../core/model/types';
import type { CatalogItem, Command, GridState, MacroCoord, PlacedObject, Stencil, StencilPlan, ValidationResult } from '../../core/model/types';
import { getCell, isBuildableZone } from '../../core/model/grid-model';
import { getCatalogItem } from '../../state/catalog';
import { generateObjectId } from '../utils';
import { objectPlacementCommand } from '../objects/object-placer';
import { applyContrast, covered, FLAT_SAFE_ELEVATION, insetDepth, nearestByColor, nearestTerrain, relaxHeights, terrainPalette } from './stencil';

export interface StencilResult { placed: number; skipped: number }

/** Where the stencil's top-left cell sits on the map, and what it may write to. */
export interface StencilPlacement { origin: MacroCoord; stencil: Stencil; allow?: ReadonlySet<number> }

/**
 * A cell the generator may write to at all: on the map, buildable ground, and inside the run's own
 * scope where it has one.
 *
 * The scope matters because a stencil is fitted to the region's BOUNDING BOX rather than to the
 * region. A rectangle's box is itself, so the two agreed and the gap went unnoticed; anything else
 * has a box bigger than it is, and the picture filled the box.
 */
function writable(state: GridState, x: number, y: number, allow?: ReadonlySet<number>): boolean {
  const cell = getCell(state.cells, x, y);
  if (!cell || !isBuildableZone(cell.zone)) return false;
  return !allow || allow.has(y * state.template.width + x);
}

/**
 * Raise `targets` bottom-up, each cell to its own height.
 *
 * One pass per layer over the cells that still want to be that tall, batched — and on refusal
 * retried singly, so one illegal cell cannot take the layer down with it. A cell that fails a layer
 * stops climbing, and everything targeted around it comes down with it: the 3x3 base rule is a
 * POST-stroke rule, so a neighbour left climbing over the stump would pass every command and be
 * found floating only at commit, taking the whole stroke down in the auto-revert.
 */
function raise(
  targets: Map<number, { coord: MacroCoord; type: TerrainType; top: number }>,
  maxElevation: number,
  mapWidth: number,
  executeCommand: (cmd: Command) => ValidationResult,
): StencilResult {
  // `top` lowered at `coord`: every neighbouring target may now stand at most 3 above it.
  const settle = (seed: { coord: MacroCoord; top: number }): void => {
    const queue = [seed];
    for (let q = 0; q < queue.length; q++) {
      const { coord, top } = queue[q]!;
      const cap = top + FLAT_SAFE_ELEVATION;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const n = targets.get((coord.y + dy) * mapWidth + (coord.x + dx));
          if (n && n.top > cap) { n.top = cap; queue.push(n); }
        }
      }
    }
  };
  let placed = 0, skipped = 0;
  let live = [...targets.values()];
  for (let e = 1; e <= maxElevation && live.length > 0; e++) {
    // Water is one block deep and sits AT its own layer, so it is laid once, at the top of the
    // column the layers below it have already built.
    const wants = live.filter((t) => t.top >= e);
    const mountain = wants.filter((t) => t.type === TerrainType.Mountain || t.top > e);
    const water = wants.filter((t) => t.type === TerrainType.Water && t.top === e);

    for (const [type, group] of [[TerrainType.Mountain, mountain], [TerrainType.Water, water]] as const) {
      if (group.length === 0) continue;
      const cells = group.map((t) => t.coord);
      const cmd: Command = { type: CommandType.PaintTerrain, timestamp: 0, cells, terrainType: type, elevation: e };
      if (executeCommand(cmd).success) { placed += cells.length; continue; }
      for (const t of group) {
        const one: Command = { type: CommandType.PaintTerrain, timestamp: 0, cells: [t.coord], terrainType: type, elevation: e };
        if (executeCommand(one).success) placed++;
        else { skipped++; t.top = e - 1; settle(t); }  // stops here, and its neighbours come down to what it can carry
      }
    }
    live = live.filter((t) => t.top > e);
  }
  return { placed, skipped };
}

/**
 * The glyph as TERRAIN: every covered cell raised to `maxElevation` in one material.
 *
 * A flat slab rather than a relief, because the shape is the whole point — and because a slab is
 * what auto-trim can round the corners of, which is how a blocky letter comes out looking drawn.
 */
export function layStencilTerrain(
  state: GridState,
  { origin, stencil, allow }: StencilPlacement,
  terrainType: TerrainType,
  maxElevation: number,
  executeCommand: (cmd: Command) => ValidationResult,
): StencilResult {
  // WATER IS LAID AT GROUND LEVEL, in one pass and never stacked. A body raised above the ground
  // beside it has an exposed face at every border cell, and V-WTR-02 wants each of those capped by
  // mountain at exactly the water's own height — which a glyph has nothing to build out of. At
  // elevation 0 nothing around it is lower, so there are no faces and the shape stands as drawn.
  if (terrainType === TerrainType.Water) {
    const cells: MacroCoord[] = [];
    for (let y = 0; y < stencil.height; y++) {
      for (let x = 0; x < stencil.width; x++) {
        if (!covered(stencil, x, y)) continue;
        const coord = { x: origin.x + x, y: origin.y + y };
        if (writable(state, coord.x, coord.y, allow)) cells.push(coord);
      }
    }
    if (cells.length === 0) return { placed: 0, skipped: 0 };
    const cmd: Command = { type: CommandType.PaintTerrain, timestamp: 0, cells, terrainType, elevation: 0 };
    if (executeCommand(cmd).success) return { placed: cells.length, skipped: 0 };
    let placed = 0, skipped = 0;
    for (const coord of cells) {
      const one: Command = { type: CommandType.PaintTerrain, timestamp: 0, cells: [coord], terrainType, elevation: 0 };
      if (executeCommand(one).success) placed++; else skipped++;
    }
    return { placed, skipped };
  }

  // TERRACED BY INSET: the border ring at tier 1, then THREE TIERS PER RING to the cap.
  //
  // The border is tier 1 so the shape stays CUTTABLE — a Γ fillet rests one tier above the notch
  // floor (`isInnerCorner`), and a taller edge is a cliff no fillet can rest against, for the
  // manual tool and the trim pass alike. Inside, each ring climbs the full three tiers the 3x3 base
  // rule allows (a cell at N stands on its ring-below neighbours at N−3), which is the tallest
  // legal climb under that border: the chosen height is reached wherever the shape is wide enough
  // to hold it at all. Depth is measured over what will actually be LAID — a covered cell this run
  // cannot write is a hole in the base, and climbing past it is found out only at commit.
  const depth = insetDepth(stencil, (x, y) => writable(state, origin.x + x, origin.y + y, allow));
  const cap = Math.max(1, maxElevation);
  const targets = new Map<number, { coord: MacroCoord; type: TerrainType; top: number }>();
  let tallest = 1;
  for (let y = 0; y < stencil.height; y++) {
    for (let x = 0; x < stencil.width; x++) {
      if (!covered(stencil, x, y)) continue;
      const coord = { x: origin.x + x, y: origin.y + y };
      if (!writable(state, coord.x, coord.y, allow)) continue;
      const inset = depth[y * stencil.width + x] ?? 1;
      const top = Math.min(cap, 1 + 3 * (inset - 1));
      if (top > tallest) tallest = top;
      targets.set(coord.y * state.template.width + coord.x, { coord, type: terrainType, top });
    }
  }
  return raise(targets, tallest, state.template.width, executeCommand);
}

/**
 * The glyph as OBJECTS: one item per footprint-sized step across the covered cells.
 *
 * Stepped by the ITEM'S OWN SIZE rather than per cell, so a 2x2 building fills the shape instead of
 * refusing at every second cell for overlapping the one before it. A step whose whole footprint is
 * not covered is skipped, which is what keeps the outline readable at the size the glyph was drawn.
 */
export function layStencilObjects(
  state: GridState,
  { origin, stencil, allow }: StencilPlacement,
  catalogId: string,
  executeCommand: (cmd: Command) => ValidationResult,
): StencilResult {
  const item = getCatalogItem(catalogId);
  if (!item) return { placed: 0, skipped: 0 };
  const stepX = Math.max(1, item.width), stepY = Math.max(1, item.height);
  let placed = 0, skipped = 0;

  for (let y = 0; y + stepY <= stencil.height; y += stepY) {
    for (let x = 0; x + stepX <= stencil.width; x += stepX) {
      let whole = true;
      for (let dy = 0; dy < stepY && whole; dy++) {
        for (let dx = 0; dx < stepX; dx++) if (!covered(stencil, x + dx, y + dy)) { whole = false; break; }
      }
      if (!whole) continue;
      const at = { x: origin.x + x, y: origin.y + y };
      if (!writable(state, at.x, at.y, allow)) { skipped++; continue; }
      const obj: PlacedObject = {
        id: generateObjectId(), catalogId,
        position: at, rotation: 0,
        elevation: getCell(state.cells, at.x, at.y)?.terrain?.elevation ?? 0,
      };
      if (executeCommand(objectPlacementCommand(obj)).success) placed++;
      else skipped++;
    }
  }
  return { placed, skipped };
}

/**
 * The picture as COLOUR: each cell takes the terrain whose own colour is nearest to it.
 *
 * The shape is not the subject here, so an uncovered (transparent) cell is simply left alone rather
 * than being treated as sea — a photograph fills its region, and a cut-out PNG keeps its background
 * as whatever the map already had there.
 */
export function layStencilColor(
  state: GridState,
  { origin, stencil, allow }: StencilPlacement,
  maxElevation: number,
  executeCommand: (cmd: Command) => ValidationResult,
  contrast = 1,
  water = true,
): StencilResult {
  const palette = terrainPalette(Math.max(1, maxElevation), water);
  const { width: sw, height: sh } = stencil;

  // The colour a cell wants, as a height, before anything is asked of the rules. Water is marked
  // separately: it is laid at ground level and takes no part in the support arithmetic. A cell this
  // run cannot write stays 0, so the relax below treats it as the ground it will remain.
  const want = new Int16Array(sw * sh);
  const isWater = new Uint8Array(sw * sh);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const i = y * sw + x;
      if (!covered(stencil, x, y)) continue;
      if (!writable(state, origin.x + x, origin.y + y, allow)) continue;
      const match = nearestTerrain(palette, applyContrast(stencil.color[i] ?? 0, contrast));
      if (match.type === TerrainType.Water) { isWater[i] = 1; continue; }
      want[i] = match.elevation;
    }
  }
  // Lower what cannot stand. A picture chooses its own heights and they land in any order, so
  // without this every bright cell beside a dark one is refused and takes the stroke with it.
  relaxHeights(want, sw, sh);

  const targets = new Map<number, { coord: MacroCoord; type: TerrainType; top: number }>();
  const blue: MacroCoord[] = [];
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const i = y * sw + x;
      if (!covered(stencil, x, y)) continue;
      const coord = { x: origin.x + x, y: origin.y + y };
      if (!writable(state, coord.x, coord.y, allow)) continue;
      if (isWater[i]) { blue.push(coord); continue; }
      const top = want[i]!;
      if (top >= 1) targets.set(coord.y * state.template.width + coord.x, { coord, type: TerrainType.Mountain, top });
    }
  }
  const res = raise(targets, Math.max(1, maxElevation), state.template.width, executeCommand);
  for (const coord of blue) {
    const cmd: Command = { type: CommandType.PaintTerrain, timestamp: 0, cells: [coord], terrainType: TerrainType.Water, elevation: 0 };
    if (executeCommand(cmd).success) res.placed++; else res.skipped++;
  }
  return res;
}

/**
 * The picture as OBJECTS: per cell, the item whose own colour comes nearest to the picture's there.
 *
 * This is what a colour mode wants. The terrain ramp is eight greens and one blue, so a photograph
 * matched against it comes back as a green relief of itself; the catalogue carries dozens of hues,
 * and one item per cell reproduces a picture rather than paraphrasing it.
 *
 * ONE CELL EACH, so the palette is expected to hold only items that occupy a single cell — a bigger
 * footprint would overlap its neighbour and be refused for it. Refusals are counted and skipped: a
 * cell already occupied, or ground an item will not stand on, simply keeps what it had.
 */
export function layStencilObjectColor(
  state: GridState,
  { origin, stencil, allow }: StencilPlacement,
  palette: readonly { catalogId: string; rgb: number }[],
  executeCommand: (cmd: Command) => ValidationResult,
  contrast = 1,
): StencilResult {
  if (palette.length === 0) return { placed: 0, skipped: 0 };
  let placed = 0, skipped = 0;
  for (let y = 0; y < stencil.height; y++) {
    for (let x = 0; x < stencil.width; x++) {
      if (!covered(stencil, x, y)) continue;
      const at = { x: origin.x + x, y: origin.y + y };
      if (!writable(state, at.x, at.y, allow)) continue;
      const want = applyContrast(stencil.color[y * stencil.width + x] ?? 0, contrast);
      const match = nearestByColor(palette, want);
      if (!match) continue;
      const obj: PlacedObject = {
        id: generateObjectId(), catalogId: match.catalogId,
        position: at, rotation: 0,
        elevation: getCell(state.cells, at.x, at.y)?.terrain?.elevation ?? 0,
      };
      if (executeCommand(objectPlacementCommand(obj)).success) placed++;
      else skipped++;
    }
  }
  return { placed, skipped };
}

/**
 * Run a whole plan: the one entry point the generator dispatch calls, so `read` and `fill` are
 * decided in one place rather than at each call site.
 */
export function runStencilPlan(
  state: GridState,
  plan: StencilPlan,
  maxElevation: number,
  executeCommand: (cmd: Command) => ValidationResult,
): StencilResult {
  const placement = { origin: plan.origin, stencil: plan.stencil, ...(plan.allow ? { allow: plan.allow } : {}) };
  if (plan.read === 'color') {
    // A palette of objects means the picture is BUILT from them; without one it is coloured in
    // terrain, which is the same read against a much narrower set of hues.
    return plan.objectPalette?.length
      ? layStencilObjectColor(state, placement, plan.objectPalette, executeCommand, plan.contrast ?? 1)
      : layStencilColor(state, placement, maxElevation, executeCommand, plan.contrast ?? 1, plan.water ?? true);
  }
  if (plan.fill?.kind === 'object') return layStencilObjects(state, placement, plan.fill.catalogId, executeCommand);
  return layStencilTerrain(state, placement, plan.fill?.terrain ?? TerrainType.Mountain, maxElevation, executeCommand);
}

/**
 * Whether an item can TILE a shape, which is the only thing the letter mode does with one.
 *
 * A letter needs the same item many times over, so anything the rules cap is unusable here: every
 * unique cabin carries `maxCount: 1`, and offering one means a letter whose second cell onward is
 * refused. A bridge or a ramp SPANS terrain it is placed against rather than standing on it, so
 * neither tiles either, whatever its count.
 *
 * Read from the item, never from a list of ids: a catalog addition is then offered or excluded on
 * its own terms with nothing here to update.
 */
export function tilesAShape(item: CatalogItem): boolean {
  if (item.maxCount !== undefined) return false;
  if (item.category === ItemCategory.Bridge || item.category === ItemCategory.Ramp) return false;
  if (item.category === ItemCategory.Road) return false;   // a coating, laid by the road tools
  return true;
}
