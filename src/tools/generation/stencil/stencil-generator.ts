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
import { CommandType, TerrainType } from '../../../core/model/types';
import type { Command, GridState, MacroCoord, PlacedObject, Stencil, StencilPlan, StencilWaterRole, ValidationResult } from '../../../core/model/types';
import { getCell, isBuildableZone } from '../../../core/model/grid-model';
import { ELEVATION_MAX } from '../../../core/model/constants';
import { realSurface, surfaceElevation } from '../../../core/edge-cut/terrain-silhouette';
import { getCatalogItem } from '../../../state/catalog';
import { generateObjectId } from '../../../core/model/object-id';
import { objectPlacementCommand, removeObjectCommand } from '../../objects/object-placer';
import { getObjectIndex, objectAt } from '../../../state/object-index';
import { covered, fitTarget, FLAT_SAFE_ELEVATION, luma, narrowRange, nearestByColor, nearestTerrain, paletteToneRange, relaxHeights, sourceToneRange, terrainPalette, toneFit, withTone, type ToneRange } from './stencil';
import { DIFFUSION, matchWithDiffusion, RAMP_DIFFUSION } from './stencil-sample';
import { bedCells, hueReach, hueToneOffsets, planBorrow, planColourFill, readSmallBox, settleWaterBodies, smallBoxWeight, sourceColour, BORROW_COVER_MIN, type BorrowPolicy } from './stencil-small';
import { detectFeatures, featureBudget, planFeatureMarks, FEATURE_MAX_SHARE } from './stencil-feature';
import { declaredColorPalette } from './stencil-palette';

export interface StencilResult {
  placed: number;
  skipped: number;
  /** shape/terrain runs: the surface tier the figure was written on. A glyph stands exactly one
   *  layer above it, so this is what a caller reports when it says where the text landed. */
  base?: number;
  /**
   * shape/terrain runs: covered cells left alone because they stand on a DIFFERENT surface than the
   * majority — a step through the middle of the word, or a pond under it. Reported rather than
   * mangled: a glyph laid across a step would either float or carve, and both are worse than a
   * shorter word.
   */
  offBase?: number;
  /**
   * shape/terrain runs: covered cells ON the base whose own neighbourhood could not carry the layer
   * — the rim of a plateau, where the ground beside it falls too far for V-MTN-03 (or, for water,
   * anywhere the body would have an uncapped face).
   *
   * SEPARATE FROM `offBase` because they are separate things to say: one is "your word crosses a
   * step", the other is "your word reaches the edge of the ground it stands on".
   */
  unsupported?: number;
  /**
   * shape/terrain runs: covered cells whose surface is ALREADY the tallest layer the grid has, so
   * the one above it does not exist. A run that writes nothing for this reason is otherwise
   * indistinguishable from one with nothing to write.
   */
  atCeiling?: number;
  /** How many of the placements were the DECORATION rather than the primary material. Absent when
   *  the picture is built from one material alone. */
  decorated?: number;
  /** color runs in a small box: how many cells were paved in a BORROWED material because the picture's
   *  own palette had no hue for them — a region covered whole (`stencil-small.ts:planBorrow`) or a bed
   *  inside a body the ground would not hold one over (`planColourFill`). */
  coated?: number;
}

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

/** Whether a cell is GROUND a glyph could be written on: a surface that is not water.
 *
 *  Water reads as a perfectly good standable tier through the kernel (a lake sits at ground level and
 *  a boat could be on it), and it is not one for this: a letter written over a pond would paint
 *  mountain into the water. So a water cell is never part of the base and never written. */
function standableBase(state: GridState, x: number, y: number): number | null {
  const terrain = getCell(state.cells, x, y)?.terrain;
  if (terrain?.type === TerrainType.Water) return null;
  return surfaceElevation(terrain);
}

/**
 * The tier the figure is written ON: the standable surface most of the cells it may write stand at.
 *
 * Read through the silhouette kernel (`realSurface`/`surfaceElevation`), never off `terrain.elevation`
 * — a Γ patch is cosmetic above its own base, and a raw read sees a fillet as a full block.
 *
 * Ties go to the LOWER tier, so the answer is one function of the map rather than of iteration order.
 * `null` when there is no writable GROUND under the stencil at all.
 */
export function stencilBaseTier(state: GridState, { origin, stencil, allow }: StencilPlacement): number | null {
  const counts = new Map<number, number>();
  for (let y = 0; y < stencil.height; y++) {
    for (let x = 0; x < stencil.width; x++) {
      if (!covered(stencil, x, y)) continue;
      const cx = origin.x + x, cy = origin.y + y;
      if (!writable(state, cx, cy, allow)) continue;
      const tier = standableBase(state, cx, cy);
      if (tier === null) continue;
      counts.set(tier, (counts.get(tier) ?? 0) + 1);
    }
  }
  let best: number | null = null, bestN = 0;
  for (const [tier, n] of counts) {
    if (n > bestN || (n === bestN && best !== null && tier < best)) { best = tier; bestN = n; }
  }
  return best;
}

/** The lowest surface anywhere in the 8-neighbourhood of (x, y), the map's own cells included — what
 *  a layer written here would have to stand over. */
function lowestAround(state: GridState, x: number, y: number): number {
  let low = Infinity;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const cell = getCell(state.cells, x + dx, y + dy);
      const tier = cell ? surfaceElevation(cell.terrain) : 0;   // off the map reads as the ground
      if (tier < low) low = tier;
    }
  }
  return low === Infinity ? 0 : low;
}

/**
 * The glyph as TERRAIN: every covered cell written as ONE layer standing on the region's own surface.
 *
 * BASE+1, AND NOTHING ELSE. Terracing the shape by inset — the outline at tier 1 and each ring inward
 * three tiers higher, up to a picked height — gives a letter a layer-1 SKIRT around a taller core (包边)
 * and leaves every stroke too thin to hold a second ring down at the skirt's tier, reading as a hole
 * through the middle of the letter. It also reads the map as if it were always sea level: on a region
 * standing on a mountain it paints tier 1 INTO the plateau.
 *
 * A single layer on the measured surface has neither failure by construction, and it is what makes a
 * glyph legible at small sizes: the shape is the whole subject, and a relief is only ever noise in it.
 *
 * WATER SINKS AT THE SURFACE ITSELF rather than one above it. A body raised over the ground beside it
 * has an exposed face at every border cell and V-WTR-02 wants each capped by mountain at exactly the
 * water's height; at the surface tier the mass around it IS that cap, and on open ground there is
 * nothing lower and so no face at all.
 */
export function layStencilTerrain(
  state: GridState,
  placement: StencilPlacement,
  terrainType: TerrainType,
  executeCommand: (cmd: Command) => ValidationResult,
): StencilResult {
  const { origin, stencil, allow } = placement;
  const base = stencilBaseTier(state, placement);
  if (base === null) return { placed: 0, skipped: 0, offBase: 0, unsupported: 0, atCeiling: 0 };
  const elevation = terrainType === TerrainType.Water ? base : base + 1;

  // What the neighbourhood has to hold up for this layer to survive the commit. V-MTN-03 gives a
  // block three layers of grace over its 3x3; water is asked for a full cap at its own height, so a
  // pool may not overhang anything lower at all. Both rules are POST-stroke: a cell laid without
  // this check passes every command and takes the whole run down in the auto-revert.
  const floor = terrainType === TerrainType.Water ? elevation : Math.max(0, elevation - FLAT_SAFE_ELEVATION);

  const cells: MacroCoord[] = [];
  let offBase = 0, unsupported = 0, atCeiling = 0;
  for (let y = 0; y < stencil.height; y++) {
    for (let x = 0; x < stencil.width; x++) {
      if (!covered(stencil, x, y)) continue;
      const coord = { x: origin.x + x, y: origin.y + y };
      if (!writable(state, coord.x, coord.y, allow)) continue;
      if (standableBase(state, coord.x, coord.y) !== base) { offBase++; continue; }
      // The surface is already the tallest the grid has, so the layer above it does not exist. Its
      // own count, or a whole word that lands nowhere is indistinguishable from one with nothing to
      // write — a region on the summit would just come back silently empty.
      if (elevation > ELEVATION_MAX) { atCeiling++; continue; }
      if (lowestAround(state, coord.x, coord.y) < floor) { unsupported++; continue; }
      cells.push(coord);
    }
  }
  const counts = { base, offBase, unsupported, atCeiling };
  if (cells.length === 0) return { placed: 0, skipped: 0, ...counts };

  const cmd: Command = { type: CommandType.PaintTerrain, timestamp: 0, cells, terrainType, elevation };
  if (executeCommand(cmd).success) return { placed: cells.length, skipped: 0, ...counts };
  let placed = 0, skipped = 0;
  for (const coord of cells) {
    const one: Command = { type: CommandType.PaintTerrain, timestamp: 0, cells: [coord], terrainType, elevation };
    if (executeCommand(one).success) placed++; else skipped++;
  }
  return { placed, skipped, ...counts };
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
        elevation: surfaceElevation(getCell(state.cells, at.x, at.y)?.terrain),
      };
      if (executeCommand(objectPlacementCommand(obj)).success) placed++;
      else skipped++;
    }
  }
  return { placed, skipped };
}

/**
 * Maps covered source cells into a material palette. Source tones are fitted over the cells that can
 * actually be written, without error diffusion across small hard-edged drawings. `span` uses the full
 * palette range. `hueAware` converts hue separation into tone only for small, single-hue palettes;
 * `plain` retains the unshifted tone reading for lightness decisions.
 */
function paletteReader(
  state: GridState,
  { origin, stencil, allow }: StencilPlacement,
  palette: readonly { rgb: number }[],
  contrast: number,
  damping: number,
  fitTones: boolean,
  span = false,
  hueAware = false,
): {
  wanted: (index: number) => number | null;
  /** The same reading with no hue lift in it: the picture's own TONE, landed on the palette. What
   *  asks a question about lightness (which cells are the picture's light) reads this, so a lever
   *  about colour cannot move a decision about tone. */
  plain: (index: number) => number | null;
  damping: number;
  source: ToneRange;
  matchable: (index: number) => boolean;
} {
  const sw = stencil.width;
  const matchable = (i: number): boolean => {
    const x = i % sw, y = (i / sw) | 0;
    return covered(stencil, x, y) && writable(state, origin.x + x, origin.y + y, allow);
  };
  const reach = paletteToneRange(palette);
  // Include hue lift in the measured source range so the ordinary fit keeps every palette entry
  // reachable instead of clipping shifted cells at the endpoints.
  const lift = hueAware ? hueReach(smallBoxWeight(stencil), reach) : 0;
  const hue = lift > 0 ? hueToneOffsets(stencil, matchable, lift) : null;
  const lifted = hue
    ? (i: number): number => {
      const rgb = stencil.color[i] ?? 0;
      return hue[i] === 0 ? rgb : withTone(rgb, Math.min(255, Math.max(0, luma(rgb) + hue[i]!)));
    }
    : (i: number): number => stencil.color[i] ?? 0;
  const lumas: number[] = [];
  for (let i = 0; i < stencil.width * stencil.height; i++) if (matchable(i)) lumas.push(luma(lifted(i)));
  const source = sourceToneRange(lumas);
  const target = fitTones ? (span ? reach : fitTarget(source, reach)) : source;
  const fit = toneFit(narrowRange(source, contrast), target);
  const wanted = (i: number): number | null => (matchable(i) ? fit(lifted(i)) : null);
  return {
    wanted,
    plain: hue ? (i) => (matchable(i) ? fit(stencil.color[i] ?? 0) : null) : wanted,
    damping: stencil.nature === 'flat' ? 0 : damping,
    source,
    matchable,
  };
}

/**
 * Whether a covered cell sits on the picture's own EDGE: one of its four neighbours is not part of
 * the picture.
 *
 * A cell off the stencil counts as COVERED here, so a picture that fills its whole box — a
 * photograph, anything without transparency — has no silhouette at all rather than a rectangular
 * frame drawn round its border.
 */
function silhouetteEdge(stencil: Stencil, x: number, y: number): boolean {
  const inside = (cx: number, cy: number): boolean =>
    cx < 0 || cy < 0 || cx >= stencil.width || cy >= stencil.height || covered(stencil, cx, cy);
  return !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
}

/** The tone between neighbouring entries of a palette: what a difference has to cross to say anything,
 *  and what "just below the water's own tone" is measured in. */
function paletteStep(palette: readonly { rgb: number }[]): number {
  const range = paletteToneRange(palette);
  return (range.hi - range.lo) / Math.max(1, palette.length - 1);
}

/** Water threshold halfway between the two brightest palette tones. */
function waterTone(palette: readonly { rgb: number }[]): number {
  const tones = palette.map((entry) => luma(entry.rgb)).sort((a, b) => a - b);
  const top = tones[tones.length - 1] ?? 0, next = tones[tones.length - 2] ?? top;
  return (top + next) / 2;
}

/**
 * Renders covered image cells with the nearest terrain palette entry; transparent cells retain the
 * map beneath them. Water may be excluded, participate as an ordinary colour, or serve as the primary
 * material for bright interior cells. Silhouette cells always remain terrain to form a containing
 * bank. `fitTones` controls whether source tones are fitted to the available range.
 */
export function layStencilColor(
  state: GridState,
  { origin, stencil, allow }: StencilPlacement,
  maxElevation: number,
  executeCommand: (cmd: Command) => ValidationResult,
  contrast = 1,
  water: StencilWaterRole = 'none',
  fitTones = true,
): StencilResult {
  const palette = terrainPalette(Math.max(1, maxElevation), water === 'palette');
  // The COATINGS a terrain picture may borrow a hue from: the road surfaces, which declare their own
  // colours in the catalog, so this needs no canvas and crosses into the candidate worker intact.
  const smallCoatings = declaredColorPalette('roads');
  // WHAT THE PICTURE IS FITTED AGAINST, which is not always what it is matched against. As the
  // primary material the blue is the light end of the picture's own range, so the fit has to know
  // about it; the match below still runs over the greens alone, since a cell that is not the water's
  // is the ramp's.
  const fitted = water === 'primary' ? terrainPalette(Math.max(1, maxElevation), true) : palette;
  const { width: sw, height: sh } = stencil;

  // The colour a cell wants, as a height, before anything is asked of the rules. Water is marked
  // separately: it is laid at ground level and takes no part in the support arithmetic. A cell this
  // run cannot write stays 0, so the relax below treats it as the ground it will remain.
  //
  // The match is DIFFUSED: nine colours cannot hold a photograph's shading, so each cell's error is
  // spent on the cells after it and the area reads as the colour the picture had.
  const want = new Int16Array(sw * sh);
  const isWater = new Uint8Array(sw * sh);
  const read = paletteReader(
    state, { origin, stencil, ...(allow ? { allow } : {}) }, fitted, contrast, RAMP_DIFFUSION,
    fitTones, water === 'primary', true,
  );
  let wanted = read.wanted;
  if (water === 'primary') {
    // The cells water may take are the picture's INSIDE: its silhouette is the bank, whatever the
    // tone there, so a pond is always drawn within a shape.
    //
    // A PICTURE OF ONE COLOUR IS ALL LIGHT. It has no tones to grade, so the fit lands the whole of
    // it on one tier and a nearest-tone cut would find either none of it or all of it; the material
    // it was asked for decides, and the answer is a lake in the shape of the subject with its own
    // outline as the bank.
    const cut = read.source.hi - read.source.lo < 1 ? -Infinity : waterTone(fitted);
    for (let i = 0; i < sw * sh; i++) {
      const rgb = read.wanted(i);
      if (rgb === null || silhouetteEdge(stencil, i % sw, (i / sw) | 0)) continue;
      if (luma(rgb) >= cut) isWater[i] = 1;
    }
    // A POND WANTS A BODY. At this size a highlight is a few scattered cells and lands as that many
    // one-cell ponds, which read as holes in the figure rather than as water in it, so a body under the
    // minimum either grows out of the lightest cells beside it or goes back to being land.
    settleWaterBodies(
      stencil, isWater, smallBoxWeight(stencil),
      (i) => { const rgb = read.wanted(i); return rgb === null ? null : luma(rgb); },
      cut, paletteStep(fitted),
      (i) => read.wanted(i) !== null && !silhouetteEdge(stencil, i % sw, (i / sw) | 0),
    );
    // A water cell is declined by the match, so it neither takes a green nor spends an error on the
    // cells after it: the terrain is matched against the ramp as if it were the whole picture.
    wanted = (i): number | null => (isWater[i] ? null : read.wanted(i));
  }
  const boxWeight = smallBoxWeight(stencil);
  const ramp = palette.filter((entry) => entry.type === TerrainType.Mountain);
  if (boxWeight > 0 && water === 'palette') {
    // WATER IS A MATERIAL, NOT ONE MORE STEP OF LIGHTNESS, and the small box's allocation spreads areas
    // across the palette by tone: with the blue in it as the brightest entry, a merely pale area was
    // pushed onto water and a picture of flat ground came back as a pond. So where the blue is one entry
    // among the greens, the cells nearest to IT are decided first, exactly as the primary role does, and
    // the areas are then allocated over the ramp alone.
    for (let i = 0; i < sw * sh; i++) {
      const rgb = wanted(i);
      if (rgb === null) continue;
      if (nearestTerrain(palette, rgb).type === TerrainType.Water) isWater[i] = 1;
    }
    const blue = palette.find((entry) => entry.type === TerrainType.Water);
    settleWaterBodies(
      stencil, isWater, boxWeight,
      (i) => { const rgb = wanted(i); return rgb === null ? null : luma(rgb); },
      blue ? luma(blue.rgb) : Infinity, paletteStep(palette),
      (i) => wanted(i) !== null,
    );
    const terrainOnly = wanted;
    wanted = (i): number | null => (isWater[i] ? null : terrainOnly(i));
  }
  // IN A SMALL BOX THE UNIT IS THE AREA, NOT THE CELL (`stencil-small.ts:readSmallBox`): the picture is
  // read as the few coherent areas the box can hold and each is told in ONE tier, allocated to the
  // areas by what carries the subject rather than to a tonal ramp every cell is rounded against.
  const small = readSmallBox(
    stencil, (i) => wanted(i) !== null, (i) => wanted(i) ?? 0,
    boxWeight, ramp, true, read.damping,
    // What an area of this depth may be told in: the support rules give a block three layers over the
    // ground beside it, so a cell one step inside the figure can stand at three and no higher. Read
    // as the palette's own tone, since that is what the allocation orders entries by.
    (depth) => {
      const cap = Math.max(1, Math.min(maxElevation, FLAT_SAFE_ELEVATION * Math.max(1, depth)));
      let tone = Infinity;
      for (const entry of ramp) if (entry.elevation <= cap) tone = Math.min(tone, luma(entry.rgb));
      return tone;
    },
  );
  // WHERE THE WATER HAS ALREADY BEEN DECIDED, THE MATCH IS OVER THE RAMP ALONE. The blue is the palette's
  // brightest entry, so a cell the water pass left as land could still be handed it here — one cell at a
  // time, which is the speck the pass exists to remove.
  // WHICH REGIONS ARE TOLD IN A BORROWED MATERIAL, decided on the picture's own colours over the
  // regions the reading above composed — so what the ramp cannot say is spent once per region rather
  // than once per cell. The coatings are laid after the terrain is up (below).
  const borrow = small && smallCoatings.length > 0
    ? planBorrow(small.regions, small.rim, (area) => sourceColour(stencil, area), ramp, smallCoatings, borrowPolicy(water))
    : null;
  let coated = 0;
  const matched = boxWeight > 0 && water === 'palette' ? ramp : palette;
  const chosen = matchWithDiffusion(
    stencil,
    small?.wanted ?? wanted,
    (rgb) => nearestTerrain(matched, rgb),
    (entry) => entry.rgb,
    small?.damping ?? read.damping,
  );
  for (let i = 0; i < chosen.length; i++) {
    const match = chosen[i];
    if (!match) continue;
    if (match.type === TerrainType.Water) { isWater[i] = 1; continue; }
    want[i] = match.elevation;
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
  // A REGION WHOSE COLOUR THE RAMP CANNOT SAY IS PAVED IN ONE THAT CAN (`stencil-small.ts:planBorrow`).
  // Eight greens have one hue between them, so a warm or a grey region arrives as a tier of green and
  // says nothing about its own colour; the road surfaces carry real hues and are coatings, so a region
  // told in one keeps the terrain underneath it. Laid AFTER the terrain, against the surface the rules
  // actually built rather than the one the match asked for. Only the MIXED material reaches any of it
  // (`borrowPolicy`), so the whole of what follows is a no-op for a mountain or a water picture.
  if (small) {
    // Whether a cell of a region will hold a coating at all, against the surface the rules just built.
    const holds = (i: number): boolean => {
      if (isWater[i]) return false;
      const at = { x: origin.x + (i % sw), y: origin.y + ((i / sw) | 0) };
      return writable(state, at.x, at.y, allow) && coatable(state, at.x, at.y);
    };
    const pave = (cells: readonly number[], catalogId: string): void => {
      for (const i of cells) {
        const at = { x: origin.x + (i % sw), y: origin.y + ((i / sw) | 0) };
        const obj: PlacedObject = {
          id: generateObjectId(), catalogId, position: at, rotation: 0,
          elevation: surfaceElevation(getCell(state.cells, at.x, at.y)?.terrain),
        };
        if (executeCommand(objectPlacementCommand(obj)).success) { res.placed++; coated++; }
        else res.skipped++;
      }
    };
    const paved = new Set<number>();
    for (const [id, catalogId] of borrow ?? []) {
      const cells = small.regions[id]!.cells.filter(holds);
      // A BORROW EITHER COVERS ITS REGION OR IS NOT WORTH TAKING. A coating wants flat ground and a
      // region is a plateau, so its right and bottom edge rows sit against a different tier and refuse:
      // that is a fringe on a paved area, which is fine, and on a region where most of the cells refuse
      // it is a scatter of paving over a tier of green — the region arrives in two colours and reads as
      // neither (measured: paving whatever would take it fragmented the areas the composition had just
      // made, region survival 0.72 to 0.70 and the result's area count 7.1 to 8.0 at 16 cells).
      if (cells.length < small.regions[id]!.cells.length * BORROW_COVER_MIN) continue;
      paved.add(id);
      pave(cells, catalogId);
    }
    // AND A BODY THE GROUND REFUSED GETS A BED OF THE SAME COLOUR (`stencil-small.ts:planColourFill`).
    // The region above is either paved whole or told in green, and a subject's own mass on broken ground
    // is the second: a colour no green can approximate, too big for the accent to mark, said by nothing
    // (T8 — a quarter of the pictures at sixteen cells). A bed is a block INSIDE the body rather than a
    // claim on its surface, so it is bounded to a sixteenth of the figure and gathered around one seed.
    // Behind the SAME policy the paving above read, and charged against what that paving actually LAID:
    // a borrow the cover test declined took none of the promise, so the room reappears.
    for (const fill of planColourFill(
      small.regions, small.rim, (area) => sourceColour(stencil, area), ramp, smallCoatings,
      {
        bodyShare: FEATURE_MAX_SHARE, paved, policy: borrowPolicy(water), coated,
        ground: (id) => small.regions[id]!.cells.filter(holds).length,
      },
    )) {
      pave(bedCells(stencil, small.regions[fill.region]!, holds, fill.want), fill.catalogId);
    }
    if (coated > 0) res.coated = coated;
  }
  // BATCHED, then retried singly on refusal — `raise`'s own pattern. A picture is a cell per cell of
  // the figure, and one command each came to thousands of commands on an island-scale run.
  if (blue.length > 0) {
    const all: Command = { type: CommandType.PaintTerrain, timestamp: 0, cells: blue, terrainType: TerrainType.Water, elevation: 0 };
    if (executeCommand(all).success) res.placed += blue.length;
    else {
      for (const coord of blue) {
        const one: Command = { type: CommandType.PaintTerrain, timestamp: 0, cells: [coord], terrainType: TerrainType.Water, elevation: 0 };
        if (executeCommand(one).success) res.placed++; else res.skipped++;
      }
    }
  }
  return res;
}

/**
 * WHAT THE MATERIAL A PICTURE WAS ASKED FOR LETS IT BORROW (`stencil-small.ts:BorrowPolicy`).
 *
 * THE MODE PROMISE IS ABSOLUTE: a mountain picture is mountain, a water picture is water and its banks,
 * and neither lays a road: a road on a single-terrain picture confuses the read. Only the MIXED
 * material, which exists to spend colour, borrows at all, and there it borrows freely. Read off the water
 * role because that is what the three terrain materials differ by: `none` is the mountain picture,
 * `primary` the water one, `palette` the mixed one. A picture built from objects never reaches here —
 * its palette has hues of its own.
 *
 * Both borrowing instruments read this one answer — the paved REGION (`stencil-small.ts:planBorrow`) and
 * the bed inside a body (`planColourFill`) — so a material cannot promise one thing and lay the other.
 */
function borrowPolicy(water: StencilWaterRole): BorrowPolicy {
  return water === 'palette' ? 'free' : 'none';
}

/**
 * Whether a 1x1 coating placed here would pass its own flat trait: the cell, the one right of it, the
 * one below and the corner between them, all at one surface elevation and none of them water.
 *
 * ASKED BEFORE THE RULES REFUSE, not instead of them. The placement still goes through the executor and
 * the rules still decide; what this avoids is issuing a command per cell of a region that is a hillside,
 * where every one of them is a refusal. The sweep is `rules/placement.ts`'s own (terrain renders half a
 * cell off the macro grid, so a whole-coordinate footprint bleeds one cell past each end).
 */
function coatable(state: GridState, x: number, y: number): boolean {
  const own = getCell(state.cells, x, y);
  if (!own) return false;
  const base = surfaceElevation(own.terrain);
  for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
    const cell = getCell(state.cells, x + dx, y + dy);
    if (!cell) continue;                             // off the map has no cliff to report
    const surf = realSurface(cell.terrain);
    if (surf?.type === TerrainType.Water || (surf?.elevation ?? 0) !== base) return false;
  }
  return true;
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
 *
 * `fitTones` off matches the picture's colours where they are, as above. It changes little here in
 * practice: the catalogue's own hues run from white to near-black, so a picture is usually inside
 * them already and the fit leaves it alone of its own accord.
 */
export function layStencilObjectColor(
  state: GridState,
  { origin, stencil, allow }: StencilPlacement,
  palette: readonly { catalogId: string; rgb: number }[],
  executeCommand: (cmd: Command) => ValidationResult,
  contrast = 1,
  fitTones = true,
): StencilResult {
  if (palette.length === 0) return { placed: 0, skipped: 0 };
  const sw = stencil.width;
  const read = paletteReader(state, { origin, stencil, ...(allow ? { allow } : {}) }, palette, contrast, DIFFUSION, fitTones);
  // The AREA reading a small box gets, without the hue lift or the forced distinctness that a ramp of
  // one hue needs: this palette has real hues, so an area's own colour already lands somewhere the
  // picture recognises, and what a small box still wants is the area rather than the dithered cell.
  const small = readSmallBox(
    stencil, read.matchable, (i) => read.wanted(i) ?? 0,
    smallBoxWeight(stencil), palette, false, read.damping,
  );
  const chosen = matchWithDiffusion(
    stencil,
    small?.wanted ?? read.wanted,
    (rgb) => nearestByColor(palette, rgb),
    (entry) => entry.rgb,
    small?.damping ?? read.damping,
  );
  let placed = 0, skipped = 0;
  for (let y = 0; y < stencil.height; y++) {
    for (let x = 0; x < stencil.width; x++) {
      const match = chosen[y * sw + x];
      if (!match) continue;
      const at = { x: origin.x + x, y: origin.y + y };
      const obj: PlacedObject = {
        id: generateObjectId(), catalogId: match.catalogId,
        position: at, rotation: 0,
        elevation: surfaceElevation(getCell(state.cells, at.x, at.y)?.terrain),
      };
      if (executeCommand(objectPlacementCommand(obj)).success) placed++;
      else skipped++;
    }
  }
  return { placed, skipped };
}

/**
 * How much of a picture the BACKGROUND decoration may take, at most, whatever it is asked for.
 *
 * The decoration marks the picture's ANCHOR POINTS, so past a small share it stops marking anything
 * and starts being a competing image — and every one of its cells is an object standing on the
 * result, which the load rules have to carry.
 *
 * In a SMALL box this pass is not what the decoration is for at all: it fades out across the box gate
 * and the features take over (`stencil-feature.ts`).
 */
export const DECOR_MAX_SHARE = 0.15;
const DECOR_DEFAULT_SHARE = 0.08;

/**
 * The least salience worth marking, in the units of the Sobel sum below.
 *
 * A step of one luma level across a cell comes to four here, so this is a step of two — under
 * anything the eye can see, and above the arithmetic's own residue on a picture that is genuinely
 * flat (which is never exactly zero once three channel weights have been summed).
 */
const DECOR_MIN_SALIENCE = 8;

/**
 * How strongly the picture changes at a cell: the luma gradient, Sobel over the eight around it.
 * Detail rather than brightness, so an accent lands on an eye or an outline, never on a flat wall.
 *
 * A neighbour off the stencil, or one the picture does not cover, reads as the CELL'S OWN colour
 * rather than as black. Otherwise the picture's own rim is the strongest edge in it and a flat
 * colour would accent all the way round its border, which is a frame rather than a mark.
 */
function detailAt(stencil: Stencil, x: number, y: number): number {
  const own = stencil.color[y * stencil.width + x] ?? 0;
  const lumaOf = (rgb: number): number =>
    0.299 * ((rgb >> 16) & 0xff) + 0.587 * ((rgb >> 8) & 0xff) + 0.114 * (rgb & 0xff);
  const luma = (cx: number, cy: number): number =>
    lumaOf(covered(stencil, cx, cy) ? (stencil.color[cy * stencil.width + cx] ?? 0) : own);
  const gx = luma(x + 1, y - 1) + 2 * luma(x + 1, y) + luma(x + 1, y + 1)
    - luma(x - 1, y - 1) - 2 * luma(x - 1, y) - luma(x - 1, y + 1);
  const gy = luma(x - 1, y + 1) + 2 * luma(x, y + 1) + luma(x + 1, y + 1)
    - luma(x - 1, y - 1) - 2 * luma(x, y - 1) - luma(x + 1, y - 1);
  return Math.abs(gx) + Math.abs(gy);
}

/**
 * How far a cell's colour is from anything the primary palette can draw in.
 *
 * The second half of salience, and the half that says "this is what the material cannot tell you":
 * a red bow on a green ramp is one flat cell with no detail in it at all, and it is exactly the
 * thing worth marking. Measured in the same channel-weighted units as the gradient below, so the
 * two add without a conversion.
 *
 * ON THE SOURCE'S OWN COLOUR, not on the tone-fitted colour the primary is built from. Two reasons,
 * and the first is the one that decides it: the decoration picks its species off the source colour
 * too (`nearestByColor` below), so what makes a cell worth marking and what is planted there read
 * the same picture rather than two versions of it. The second is that the fit is a tone move with
 * the chroma carried along, so it shifts nearly the whole picture's miss by a constant — and the
 * constant is exactly what the floor subtraction in `layStencilDecor` takes back out.
 */
function missAt(palette: readonly { rgb: number }[], rgb: number): number {
  const nearest = nearestByColor(palette, rgb);
  if (!nearest) return 0;
  const dr = ((rgb >> 16) & 0xff) - ((nearest.rgb >> 16) & 0xff);
  const dg = ((rgb >> 8) & 0xff) - ((nearest.rgb >> 8) & 0xff);
  const db = (rgb & 0xff) - (nearest.rgb & 0xff);
  return Math.sqrt(0.299 * dr * dr + 0.587 * dg * dg + 0.114 * db * db);
}

/**
 * Decorate a stencil after its primary material. Small images spend the budget on detected color
 * features; larger images rank background cells by luma gradient plus palette miss. Selection is
 * deterministic, capped, and spaced. Feature marks may replace coating laid by this run; background
 * marks replace only this run's object tiling. All placements still pass ordinary map rules.
 */
export function layStencilDecor(
  state: GridState,
  { origin, stencil, allow }: StencilPlacement,
  decor: { palette: readonly { catalogId: string; rgb: number }[]; density?: number },
  executeCommand: (cmd: Command) => ValidationResult,
  replaceable?: ReadonlySet<string>,
  primary: readonly { rgb: number }[] = [],
  paved = false,
): StencilResult {
  const { palette } = decor;
  if (palette.length === 0) return { placed: 0, skipped: 0 };
  const { width: sw, height: sh } = stencil;

  const candidates: { i: number; detail: number; miss: number }[] = [];
  let floor = Infinity;
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      if (!covered(stencil, x, y)) continue;
      if (!writable(state, origin.x + x, origin.y + y, allow)) continue;
      const i = y * sw + x;
      const miss = primary.length ? missAt(primary, stencil.color[i] ?? 0) : 0;
      if (miss < floor) floor = miss;
      candidates.push({ i, detail: detailAt(stencil, x, y), miss });
    }
  }
  if (candidates.length === 0) return { placed: 0, skipped: 0 };
  const base = floor === Infinity ? 0 : floor;
  const ranked = candidates.map((c) => ({ i: c.i, salience: c.detail + (c.miss - base) }));
  ranked.sort((a, b) => (b.salience - a.salience) || (a.i - b.i));

  const taken = new Set<number>();
  let placed = 0, skipped = 0;

  /** One mark at one cell, if the cell will take it. Null where nothing was attempted at all. */
  const mark = (i: number, catalogId: string, spaced: boolean, mayCoat: boolean): boolean | null => {
    const x = i % sw, y = (i / sw) | 0;
    if (!covered(stencil, x, y) || !writable(state, origin.x + x, origin.y + y, allow)) return null;
    if (taken.has(i)) return null;
    if (spaced) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) if (taken.has((y + dy) * sw + (x + dx))) return null;
      }
    }
    const at = { x: origin.x + x, y: origin.y + y };
    const standing = objectAt(getObjectIndex(state), at);
    if (standing) {
      if (!replaceable?.has(standing.id)) return false;
      if (!mayCoat && isCoating(standing.catalogId)) return false;
      if (!executeCommand(removeObjectCommand(standing)).success) return false;
    }
    const obj: PlacedObject = {
      id: generateObjectId(), catalogId,
      position: at, rotation: 0,
      elevation: surfaceElevation(getCell(state.cells, at.x, at.y)?.terrain),
    };
    if (!executeCommand(objectPlacementCommand(obj)).success) return false;
    taken.add(i);
    return true;
  };

  const weight = smallBoxWeight(stencil);
  if (weight > 0) {
    const inFigure = (i: number): boolean =>
      covered(stencil, i % sw, (i / sw) | 0)
      && writable(state, origin.x + (i % sw), origin.y + ((i / sw) | 0), allow);
    const features = detectFeatures(stencil, inFigure, primary, palette);
    for (const plan of planFeatureMarks(features, palette, featureBudget(candidates.length))) {
      // Down the feature's own cells until the budget's share of them STANDS: a cell at the feature's
      // edge is a cell against a step, which a flat placement is refused, and the plan cannot know which
      // ones those are (`FeatureMark.cells`).
      let stood = 0;
      for (const i of plan.cells) {
        if (stood >= plan.want) break;
        const at = mark(i, plan.catalogId, false, true);
        if (at === true) { stood++; placed++; continue; }
        if (at === null) continue;
        // AND A MARK THE GROUND REFUSES STANDS BESIDE THE FEATURE, in the figure, which is the same
        // answer the background pass gives for the same cause: a feature IS a colour boundary and so a
        // tier boundary, and a flat placement is refused a cell away from a step. Measured on the seed
        // picture at 24 cells, three of its four features are one cell each and every one of them was
        // refused where it stood — a scarce instrument that says nothing is not scarce, it is absent.
        let beside = false;
        for (const [dx, dy] of NEIGHBOUR_ORDER) {
          const x = i % sw + dx, y = ((i / sw) | 0) + dy;
          if (x < 0 || y < 0 || x >= sw || y >= sh || !inFigure(y * sw + x)) continue;
          if (mark(y * sw + x, plan.catalogId, false, true) === true) { beside = true; break; }
        }
        if (beside) { stood++; placed++; } else skipped++;
      }
    }
  }

  const share = Math.min(DECOR_MAX_SHARE, Math.max(0, decor.density ?? DECOR_DEFAULT_SHARE));
  // The background's own ceiling, on top of whatever the features have already spent.
  const cap = placed + Math.floor(ranked.length * share * (1 - weight));
  for (const { i, salience } of ranked) {
    if (placed >= cap) break;
    if (salience < DECOR_MIN_SALIENCE) break;   // flat and in reach from here down: nothing to mark
    const rgb = stencil.color[i] ?? 0;
    const match = nearestByColor(palette, rgb);
    if (!match) break;
    const at = mark(i, match.catalogId, true, paved);
    if (at === true) { placed++; continue; }
    if (at === null) continue;
    // A MARK THAT CANNOT STAND ON THE LINE STANDS BESIDE IT. The salient cells of a picture built in
    // terrain are its EDGES, and an edge in terrain is a step: flora wants flat ground, so exactly
    // the cells worth marking are the ones that refuse. The four edge neighbours in a fixed order
    // keep the mark against the feature it belongs to and keep the whole pass deterministic.
    let beside = false;
    for (const [dx, dy] of NEIGHBOUR_ORDER) {
      const x = i % sw + dx, y = ((i / sw) | 0) + dy;
      if (x < 0 || y < 0 || x >= sw || y >= sh) continue;
      if (mark(y * sw + x, match.catalogId, true, paved) === true) { beside = true; break; }
    }
    if (beside) placed++; else skipped++;
  }
  return { placed, skipped };
}

/** Whether an item COATS the surface it is placed on rather than standing on it — read from the item's
 *  own traits, so a catalog addition is classified on its own terms. */
function isCoating(catalogId: string): boolean {
  return getCatalogItem(catalogId)?.traits?.some((trait) => trait.type === 'surfaceCoating') ?? false;
}

/** The order a mark tries its neighbours in. Fixed, so the pass is one function of the picture. */
const NEIGHBOUR_ORDER: readonly (readonly [number, number])[] = [[0, -1], [1, 0], [0, 1], [-1, 0]];


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
  const before = plan.decor?.palette.length ? new Set(state.objects.keys()) : null;
  // What the picture is told in, which is also what the decoration is measured against: a cell is
  // worth marking partly because THIS palette cannot say its colour.
  const primary = plan.objectPalette?.length
    ? plan.objectPalette
    : terrainPalette(Math.max(1, maxElevation), (plan.water ?? 'none') === 'palette');
  const result = ((): StencilResult => {
    if (plan.read === 'color') {
      // A palette of objects means the picture is BUILT from them; without one it is coloured in
      // terrain, which is the same read against a much narrower set of hues. `maxElevation` is that
      // ramp's DEPTH — how many greens the picture may be told in — and applies to this read alone.
      return plan.objectPalette?.length
        ? layStencilObjectColor(state, placement, plan.objectPalette, executeCommand, plan.contrast ?? 1)
        : layStencilColor(state, placement, maxElevation, executeCommand, plan.contrast ?? 1, plan.water ?? 'none');
    }
    if (plan.fill?.kind === 'object') return layStencilObjects(state, placement, plan.fill.catalogId, executeCommand);
    // No height argument: a glyph is ONE layer on the region's own surface, so there is nothing for a
    // height to say.
    return layStencilTerrain(state, placement, plan.fill?.terrain ?? TerrainType.Mountain, executeCommand);
  })();

  // The decoration goes on AFTER, over whatever the primary left standing — it marks the picture
  // rather than building it, and it is absent unless the material asks for one.
  if (plan.decor?.palette.length) {
    // WHAT THIS RUN LAID IS THE DECORATION'S TO MOVE, and which marks may move a COATING is the decor
    // pass's own decision (`layStencilDecor`): a mark can stand where the primary already tiled the
    // picture with an object, which for a picture built out of paths means taking the path's cell, since
    // nothing may stand on a coating (V-PLACE-COATED). Anything the run did not lay is left alone.
    const paved = Boolean(plan.objectPalette?.length);
    const laid = new Set([...state.objects.values()]
      .filter((object) => !before?.has(object.id))
      .map((object) => object.id));
    const extra = layStencilDecor(state, placement, plan.decor, executeCommand, laid, primary, paved);
    return {
      ...result,
      placed: result.placed + extra.placed,
      skipped: result.skipped + extra.skipped,
      decorated: extra.placed,
    };
  }
  return result;
}
