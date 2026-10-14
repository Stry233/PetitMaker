/*
 * Laying a `Stencil` onto the map, in the two ways the shelf offers.
 *
 * Shape (the text mode) reads the stencil's coverage: the cells inside the glyph become terrain, or
 * carry an object each. Colour (the image mode) ignores the shape and reads each cell's colour,
 * choosing the terrain whose own colour comes nearest — the elevation palette is a green ramp, so a
 * picture lands as a mosaic that is still a real, buildable map underneath.
 *
 * Everything is built bottom-up through `terrain-plan/commit.ts:raiseBottomUp`, as the maze builds
 * its walls: a cell that wants layer 4 gets 1, 2 and 3 under it first. That is what keeps an arbitrary
 * picture legal without the rules having to reject most of it — nothing ever floats, so the 3x3 base
 * rule has a mass to find. A layer refused as a batch is retried cell by cell and only the cells that
 * took it climb any further, so the shape degrades at its edges rather than vanishing.
 */
import { placeObjectCommand, removeObjectCommand } from '../../../core/model/command-build';
import { paintLayer, raiseBottomUp, type RaiseTarget } from '../terrain-plan';
import { TerrainType } from '../../../core/model/types';
import type { Command, GridState, MacroCoord, PlacedObject, ValidationResult } from '../../../core/model/types';
import { FLAT_SAFE_ELEVATION, type Stencil, type StencilBudgetOutcome, type StencilPlan, type StencilWaterRole } from '../recipe';
import { getCell } from '../../../core/model/grid-model';
import { NEIGHBORS4_NESW } from '../../../core/grid/directions';
import { isBuildableZone } from '../../../core/game/zones';
import { surfaceElevation } from '../../../core/domain/terrain/terrain-surface';
import { flatSweepOffenders } from '../../../rules/placement';
import { getAllItems, getCatalogItem } from '../../../state/catalog';
import { generateObjectId } from '../../../core/model/object-id';
import { overlappingCoatings } from '../../placement/coatings';
import { getObjectIndex, objectAt } from '../../../state/object-index';
import { COMPACT_IMAGE_LIMIT, covered, fitTarget, narrowRange, nearestByColor, nearestTerrain, paletteToneRange, relaxHeights, sourceToneRange, terrainPalette, toneFit, withTone, type ToneRange } from './stencil';
import { DIFFUSION, matchWithDiffusion, RAMP_DIFFUSION } from './stencil-sample';
import { colorDistance, luma } from './color';
import { bedCells, hueReach, hueToneOffsets, planBorrow, planColorFill, readSmallBox, settleWaterBodies, smallBoxWeight, sourceColor, BORROW_COVER_MIN, type BorrowPolicy } from './stencil-small';
import { detectFeatures, featureBudget, planFeatureMarks, FEATURE_MAX_SHARE } from './stencil-feature';
import { declaredColorPalette, type ColorEntry } from './stencil-palette';
import { isChunkLoadEnforced } from '../../../core/model/load';
import { LoadBudget } from '../../../state/load-budget';
import { budgetStencil } from './stencil-budget';
import { strokeTilePalette, strokeTileMask } from './stencil-line-tiles';
import { coatingLayer, isCoatingItem } from '../../../core/model/traits';
import { ELEVATION_MAX } from '../../../core/game/profile';

export interface StencilResult {
  budget?: StencilBudgetOutcome;
  placed: number;
  skipped: number;
  /** shape/terrain runs: the surface tier the figure was written on. A glyph stands exactly one
   *  layer above it, so this is what a caller reports when it says where the text landed. */
  base?: number;
  /**
   * shape/terrain runs: covered cells left alone because they stand on a different surface than the
   * majority — a step through the middle of the word, or a pond under it. Reported rather than
   * mangled: a glyph laid across a step would either float or carve, and both are worse than a
   * shorter word.
   */
  offBase?: number;
  /**
   * shape/terrain runs: covered cells on the base whose own neighbourhood could not carry the layer
   * — the rim of a plateau, where the ground beside it falls too far for V-MTN-03 (or, for water,
   * anywhere the body would have an uncapped face).
   *
   * Separate from `offBase` because they are separate things to say: one is "your word crosses a
   * step", the other is "your word reaches the edge of the ground it stands on".
   */
  unsupported?: number;
  /**
   * shape/terrain runs: covered cells whose surface is already the tallest layer the grid has, so
   * the one above it does not exist. A run that writes nothing for this reason is otherwise
   * indistinguishable from one with nothing to write.
   */
  atCeiling?: number;
  /** How many of the placements were the decoration rather than the primary material. Absent when
   *  the picture is built from one material alone. */
  decorated?: number;
  /** color runs in a small box: how many cells were paved in a borrowed material because the picture's
   *  own palette had no hue for them — a region covered whole (`stencil-small.ts:planBorrow`) or a bed
   *  inside a body the ground would not hold one over (`planColorFill`). */
  coated?: number;
}

/** Where the stencil's top-left cell sits on the map, and what it may write to. */
interface StencilPlacement { origin: MacroCoord; stencil: Stencil; allow?: ReadonlySet<number> }

/**
 * A cell the generator may write to at all: on the map, buildable ground, and inside the run's own
 * scope where it has one.
 *
 * The scope matters because a stencil is fitted to the region's bounding box rather than to the
 * region, and any region but a rectangle is smaller than its box.
 */
function writable(state: GridState, x: number, y: number, allow?: ReadonlySet<number>): boolean {
  const cell = getCell(state.cells, x, y);
  if (!cell || !isBuildableZone(cell.zone)) return false;
  return !allow || allow.has(y * state.template.width + x);
}

/** Whether a cell is ground a glyph could be written on: a surface that is not water.
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
 * The tier the figure is written on: the standable surface most of the cells it may write stand at.
 *
 * Read through the silhouette kernel (`realSurface`/`surfaceElevation`), never off `terrain.elevation`
 * — a Γ patch is cosmetic above its own base, and a raw read sees a fillet as a full block.
 *
 * Ties go to the lower tier, so the answer is one function of the map rather than of iteration order.
 * `null` when there is no writable ground under the stencil at all.
 */
function stencilBaseTier(state: GridState, { origin, stencil, allow }: StencilPlacement): number | null {
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
 * The glyph as terrain: every covered cell written as one layer on the region's own surface.
 * Terracing by inset would give a letter a skirt round a taller core, leave thin strokes reading as
 * holes, and paint tier 1 into a plateau; one layer on the measured surface keeps the shape the whole
 * subject. Water sinks at the surface itself, where the surrounding mass is the cap V-WTR-02 wants
 * and open ground has no face at all.
 */
function layStencilTerrain(
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
  // pool may not overhang anything lower at all. Both rules are post-stroke: a cell laid without
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

  const placed = paintLayer(cells, terrainType, elevation, executeCommand);
  return { placed, skipped: cells.length - placed, ...counts };
}

/**
 * The glyph as objects: one item per footprint-sized step across the covered cells.
 *
 * Stepped by the item's own size rather than per cell, so a 2x2 building fills the shape instead of
 * refusing at every second cell for overlapping the one before it. A step whose whole footprint is
 * not covered is skipped, which is what keeps the outline readable at the size the glyph was drawn.
 */
function* shapeTiles(stencil: Stencil, catalogId: string): Iterable<{ x: number; y: number }> {
  const item = getCatalogItem(catalogId);
  if (!item) return;
  const stepX = Math.max(1, item.width), stepY = Math.max(1, item.height);
  for (let y = 0; y + stepY <= stencil.height; y += stepY) {
    for (let x = 0; x + stepX <= stencil.width; x += stepX) {
      let whole = true;
      for (let dy = 0; dy < stepY && whole; dy++) {
        for (let dx = 0; dx < stepX; dx++) if (!covered(stencil, x + dx, y + dy)) { whole = false; break; }
      }
      if (whole) yield { x, y };
    }
  }
}

function layStencilObjects(
  state: GridState,
  { origin, stencil, allow }: StencilPlacement,
  catalogId: string,
  executeCommand: (cmd: Command) => ValidationResult,
): StencilResult {
  let placed = 0, skipped = 0;
  for (const { x, y } of shapeTiles(stencil, catalogId)) {
    const at = { x: origin.x + x, y: origin.y + y };
    if (!writable(state, at.x, at.y, allow)) { skipped++; continue; }
    const obj: PlacedObject = {
      id: generateObjectId(), catalogId,
      position: at, rotation: 0,
      elevation: surfaceElevation(getCell(state.cells, at.x, at.y)?.terrain),
    };
    if (executeCommand(placeObjectCommand(obj)).success) placed++;
    else skipped++;
  }
  return { placed, skipped };
}

function layStencilLines(
  state: GridState, { origin, stencil, allow }: StencilPlacement,
  executeCommand: (cmd: Command) => ValidationResult,
): StencilResult {
  const palette = strokeTilePalette(getAllItems()), curved = strokeTilePalette(getAllItems(), true);
  let placed = 0, skipped = 0;
  for (let y = 0; y < stencil.height; y++) for (let x = 0; x < stencil.width; x++) {
    if (!covered(stencil, x, y)) continue;
    const index = y * stencil.width + x;
    const tile = (stencil.curves?.[index] ? curved : palette).get(strokeTileMask(stencil, index));
    const position = { x: origin.x + x, y: origin.y + y };
    if (!tile || !writable(state, position.x, position.y, allow)) { skipped++; continue; }
    const object: PlacedObject = {
      id: generateObjectId(), ...tile, position,
      elevation: surfaceElevation(getCell(state.cells, position.x, position.y)?.terrain),
    };
    const previous = overlappingCoatings(state, [position], coatingLayer(getCatalogItem(tile.catalogId)));
    const removed: PlacedObject[] = [];
    for (const old of previous) {
      if (executeCommand(removeObjectCommand(old)).success) removed.push(old);
    }
    if (executeCommand(placeObjectCommand(object)).success) placed++;
    else {
      for (const old of removed) executeCommand(placeObjectCommand(old));
      skipped++;
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
interface PaletteReading {
  contrast: number;
  damping: number;
  fitTones: boolean;
  span?: boolean;
  hueAware?: boolean;
}

function paletteReader(
  state: GridState,
  { origin, stencil, allow }: StencilPlacement,
  palette: readonly { rgb: number }[],
  { contrast, damping, fitTones, span = false, hueAware = false }: PaletteReading,
): {
  wanted: (index: number) => number | null;
  /** The same reading with no hue lift in it: the picture's own tone, landed on the palette. What
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
 * Whether a covered cell sits on the picture's own edge: one of its four neighbours is not part of
 * the picture.
 *
 * A cell off the stencil counts as covered here, so a picture that fills its whole box — a
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

export interface StencilColorOptions {
  /** The ramp's depth: how many greens the picture may be told in. */
  maxElevation: number;
  /** How much of the picture's tonal range spreads across the palette; 1 leaves it alone. */
  contrast?: number;
  /** The part water plays (`recipe.ts:StencilWaterRole`): the green ramp alone, the ramp with the
   *  blue as one more entry, or water as the body with mountain drawing its outline. `none` when absent. */
  water?: StencilWaterRole;
  /** Whether source tones are fitted to the palette's range; on when absent. */
  fitTones?: boolean;
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
  executeCommand: (cmd: Command) => ValidationResult,
  { maxElevation, contrast = 1, water = 'none', fitTones = true }: StencilColorOptions,
): StencilResult {
  const compact = Math.min(stencil.width, stencil.height) < COMPACT_IMAGE_LIMIT;
  const palette = terrainPalette(Math.max(1, maxElevation), water === 'palette');
  // The coatings a terrain picture may borrow a hue from: the road surfaces, which declare their own
  // colours in the catalog, so this needs no canvas and crosses into the candidate worker intact.
  const smallCoatings = declaredColorPalette('roads');
  // What the picture is fitted against, which is not always what it is matched against. As the
  // primary material the blue is the light end of the picture's own range, so the fit has to know
  // about it; the match below still runs over the greens alone, since a cell that is not the water's
  // is the ramp's.
  const fitted = water === 'primary' ? terrainPalette(Math.max(1, maxElevation), true) : palette;
  const { width: sw, height: sh } = stencil;

  // The colour a cell wants, as a height, before anything is asked of the rules. Water is marked
  // separately: it is laid at ground level and takes no part in the support arithmetic. A cell this
  // run cannot write stays 0, so the relax below treats it as the ground it will remain.
  //
  // The match is diffused: nine colours cannot hold a photograph's shading, so each cell's error is
  // spent on the cells after it and the area reads as the colour the picture had.
  const want = new Int16Array(sw * sh);
  const isWater = new Uint8Array(sw * sh);
  const read = paletteReader(state, { origin, stencil, ...(allow ? { allow } : {}) }, fitted, {
    contrast, damping: RAMP_DIFFUSION, fitTones, span: water === 'primary', hueAware: true,
  });
  let wanted = read.wanted;
  if (water === 'primary') {
    // The cells water may take are the picture's inside: its silhouette is the bank, whatever the
    // tone there, so a pond is always drawn within a shape.
    //
    // A picture of one colour is all light. It has no tones to grade, so the fit lands the whole of
    // it on one tier and a nearest-tone cut would find either none of it or all of it; the material
    // it was asked for decides, and the answer is a lake in the shape of the subject with its own
    // outline as the bank.
    const cut = read.source.hi - read.source.lo < 1 ? -Infinity : waterTone(fitted);
    for (let i = 0; i < sw * sh; i++) {
      const rgb = read.wanted(i);
      if (rgb === null || silhouetteEdge(stencil, i % sw, (i / sw) | 0)) continue;
      if (luma(rgb) >= cut) isWater[i] = 1;
    }
    // A pond wants a body. At this size a highlight is a few scattered cells and lands as that many
    // one-cell ponds, which read as holes in the figure rather than as water in it, so a body under the
    // minimum either grows out of the lightest cells beside it or goes back to being land.
    settleWaterBodies(
      stencil, isWater, smallBoxWeight(stencil),
      { tone: (i) => { const rgb = read.wanted(i); return rgb === null ? null : luma(rgb); }, cut, step: paletteStep(fitted) },
      (i) => read.wanted(i) !== null && !silhouetteEdge(stencil, i % sw, (i / sw) | 0),
    );
    // A water cell is declined by the match, so it neither takes a green nor spends an error on the
    // cells after it: the terrain is matched against the ramp as if it were the whole picture.
    wanted = (i): number | null => (isWater[i] ? null : read.wanted(i));
  }
  const boxWeight = smallBoxWeight(stencil);
  const ramp = palette.filter((entry) => entry.type === TerrainType.Mountain);
  if (boxWeight > 0 && water === 'palette') {
    // Water is a material, not one more step of lightness, and the small box's allocation spreads areas
    // across the palette by tone: with the blue in it as the brightest entry, a merely pale area would
    // land on water. So where the blue is one entry among the greens, the cells nearest to it are
    // decided first, exactly as the primary role does, and the areas are then allocated over the ramp
    // alone.
    for (let i = 0; i < sw * sh; i++) {
      const rgb = wanted(i);
      if (rgb === null) continue;
      if (nearestTerrain(palette, rgb).type === TerrainType.Water) isWater[i] = 1;
    }
    const blue = palette.find((entry) => entry.type === TerrainType.Water);
    settleWaterBodies(
      stencil, isWater, boxWeight,
      {
        tone: (i) => { const rgb = wanted(i); return rgb === null ? null : luma(rgb); },
        cut: blue ? luma(blue.rgb) : Infinity, step: paletteStep(palette),
      },
      (i) => wanted(i) !== null,
    );
    const terrainOnly = wanted;
    wanted = (i): number | null => (isWater[i] ? null : terrainOnly(i));
  }
  // Compact terrain keeps local details; mixed material still needs coherent plateaus for coatings.
  const small = readSmallBox(stencil, {
    matchable: (i) => wanted(i) !== null, colorAt: (i) => wanted(i) ?? 0,
    weight: boxWeight, entries: ramp, distinct: !compact || water === 'palette', damping: read.damping,
    // What an area of this depth may be told in: the support rules give a block three layers over the
    // ground beside it, so a cell one step inside the figure can stand at three and no higher. Read
    // as the palette's own tone, since that is what the allocation orders entries by.
    minTone: (depth) => {
      const cap = Math.max(1, Math.min(maxElevation, FLAT_SAFE_ELEVATION * Math.max(1, depth)));
      let tone = Infinity;
      for (const entry of ramp) if (entry.elevation <= cap) tone = Math.min(tone, luma(entry.rgb));
      return tone;
    },
  });
  // Where the water has already been decided, the match is over the ramp alone. The blue is the palette's
  // brightest entry, so a cell the water pass left as land could still be handed it here — one cell at a
  // time, which is the speck the pass exists to remove.
  // Which regions are told in a borrowed material, decided on the picture's own colours over the
  // regions the reading above composed — so what the ramp cannot say is spent once per region rather
  // than once per cell. The coatings are laid after the terrain is up (below).
  const borrow = small && smallCoatings.length > 0
    ? planBorrow(small, (area) => sourceColor(stencil, area), ramp, smallCoatings, borrowPolicy(water))
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

  const ceiling = Math.max(1, maxElevation);
  const targets: RaiseTarget[] = [];
  const blue: MacroCoord[] = [];
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const i = y * sw + x;
      if (!covered(stencil, x, y)) continue;
      const coord = { x: origin.x + x, y: origin.y + y };
      if (!writable(state, coord.x, coord.y, allow)) continue;
      if (isWater[i]) { blue.push(coord); continue; }
      const top = want[i]!;
      if (top >= 1) targets.push({ coord, top: Math.min(top, ceiling) });
    }
  }
  const res: StencilResult = raiseBottomUp(targets, executeCommand, { settle: FLAT_SAFE_ELEVATION });
  // A region whose colour the ramp cannot say is paved in one that can (`stencil-small.ts:planBorrow`).
  // Eight greens have one hue between them, so a warm or a grey region arrives as a tier of green and
  // says nothing about its own colour; the road surfaces carry real hues and are coatings, so a region
  // told in one keeps the terrain underneath it. Laid after the terrain, against the surface the rules
  // actually built rather than the one the match asked for. Only the mixed material reaches any of it
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
        if (executeCommand(placeObjectCommand(obj)).success) { res.placed++; coated++; }
        else res.skipped++;
      }
    };
    const paved = new Set<number>();
    for (const [id, catalogId] of borrow ?? []) {
      const cells = small.regions[id]!.cells.filter(holds);
      // A borrow either covers its region or is not worth taking. A coating wants flat ground and a
      // region is a plateau, so its right and bottom edge rows sit against a different tier and refuse:
      // that is a fringe on a paved area, which is fine, and on a region where most of the cells refuse
      // it is a scatter of paving over a tier of green — the region arrives in two colours and reads as
      // neither, which fragments the areas the composition has just made.
      if (cells.length < small.regions[id]!.cells.length * BORROW_COVER_MIN) continue;
      paved.add(id);
      pave(cells, catalogId);
    }
    // And a body the ground refused gets a bed of the same colour (`stencil-small.ts:planColorFill`).
    // The region above is either paved whole or told in green, and a subject's own mass on broken ground
    // is the second: a colour no green can approximate, too big for the accent to mark, said by nothing.
    // A bed is a block inside the body rather than a
    // claim on its surface, so it is bounded to a sixteenth of the figure and gathered around one seed.
    // Behind the same policy the paving above read, and charged against what that paving actually laid:
    // a borrow the cover test declined took none of the promise, so the room reappears.
    for (const fill of planColorFill(
      small, (area) => sourceColor(stencil, area), ramp, smallCoatings,
      {
        bodyShare: FEATURE_MAX_SHARE, paved, policy: borrowPolicy(water), coated,
        ground: (id) => small.regions[id]!.cells.filter(holds).length,
      },
    )) {
      pave(bedCells(stencil, small.regions[fill.region]!, holds, fill.want), fill.catalogId);
    }
    if (coated > 0) res.coated = coated;
  }
  // Batched like every layer: one command per cell would come to thousands on a planet-scale run.
  const wet = paintLayer(blue, TerrainType.Water, 0, executeCommand);
  res.placed += wet;
  res.skipped += blue.length - wet;
  return res;
}

/**
 * What the water role a picture was asked for lets it borrow (`stencil-small.ts:BorrowPolicy`). A
 * mountain picture is mountain and a water picture is water and its banks, and neither lays a road,
 * which would confuse a single-terrain read; the ramp with water as one more entry, which exists to
 * spend colour, borrows freely. Both borrowing instruments, the paved region (`stencil-small.ts:planBorrow`) and
 * the bed inside a body (`planColorFill`), read this one answer. A picture built from objects never
 * reaches here, since its palette has hues of its own.
 */
function borrowPolicy(water: StencilWaterRole): BorrowPolicy {
  return water === 'palette' ? 'free' : 'none';
}

/**
 * Whether a 1x1 coating placed here would pass its own flat trait: the cell, the one right of it, the
 * one below and the corner between them, all at one surface elevation and none of them water.
 *
 * Asked before the rules refuse, not instead of them. The placement still goes through the executor and
 * the rules still decide; what this avoids is issuing a command per cell of a region that is a hillside,
 * where every one of them is a refusal. The sweep is the `flat` trait's own test.
 */
function coatable(state: GridState, x: number, y: number): boolean {
  const own = getCell(state.cells, x, y);
  if (!own) return false;
  return flatSweepOffenders(state, { x, y }, 1, 1, surfaceElevation(own.terrain)).length === 0;
}

function matchObjectColors(
  state: GridState,
  { origin, stencil, allow }: StencilPlacement,
  palette: readonly ColorEntry[],
  contrast: number,
  fitTones: boolean,
): (ColorEntry | null)[] {
  const read = paletteReader(state, { origin, stencil, ...(allow ? { allow } : {}) }, palette, { contrast, damping: DIFFUSION, fitTones });
  // The area reading a small box gets, without the hue lift or the forced distinctness that a ramp of
  // one hue needs: this palette has real hues, so an area's own colour already lands somewhere the
  // picture recognises, and what a small box still wants is the area rather than the dithered cell.
  const small = readSmallBox(stencil, {
    matchable: read.matchable, colorAt: (i) => read.wanted(i) ?? 0,
    weight: smallBoxWeight(stencil), entries: palette, distinct: false, damping: read.damping,
  });
  return matchWithDiffusion(
    stencil,
    small?.wanted ?? read.wanted,
    (rgb) => nearestByColor(palette, rgb),
    (entry) => entry.rgb,
    small?.damping ?? read.damping,
  );
}

/**
 * The picture as objects: per cell, the item whose colour comes nearest the picture's there. The
 * catalogue has dozens of hues where the terrain ramp has eight greens and a blue, so a colour mode
 * reproduces rather than paraphrases. The palette must hold single-cell items; refusals (an occupied
 * cell, ground an item will not stand on) are counted and skipped. `fitTones` off changes little,
 * since the catalogue's hues already span white to near-black.
 */
export function layStencilObjectColor(
  state: GridState,
  { origin, stencil, allow }: StencilPlacement,
  palette: readonly { catalogId: string; rgb: number }[],
  executeCommand: (cmd: Command) => ValidationResult,
  { contrast = 1, fitTones = true, matches }: { contrast?: number; fitTones?: boolean; matches?: (ColorEntry | null)[] } = {},
): StencilResult {
  if (palette.length === 0) return { placed: 0, skipped: 0 };
  const sw = stencil.width;
  const chosen = matches ?? matchObjectColors(state, { origin, stencil, allow }, palette, contrast, fitTones);
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
      if (executeCommand(placeObjectCommand(obj)).success) placed++;
      else skipped++;
    }
  }
  return { placed, skipped };
}

/**
 * How much of a picture the background decoration may take, at most, whatever it is asked for.
 *
 * The decoration marks the picture's anchor points, so past a small share it stops marking anything
 * and starts being a competing image — and every one of its cells is an object standing on the
 * result, which the load rules have to carry.
 *
 * In a small box this pass is not what the decoration is for at all: it fades out across the box gate
 * and the features take over (`stencil-feature.ts`).
 */
const DECOR_MAX_SHARE = 0.15;
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
 * A neighbour off the stencil, or one the picture does not cover, reads as the cell's own colour
 * rather than as black. Otherwise the picture's own rim is the strongest edge in it and a flat
 * colour would accent all the way round its border, which is a frame rather than a mark.
 */
function detailAt(stencil: Stencil, x: number, y: number): number {
  const own = stencil.color[y * stencil.width + x] ?? 0;
  const at = (cx: number, cy: number): number =>
    luma(covered(stencil, cx, cy) ? (stencil.color[cy * stencil.width + cx] ?? 0) : own);
  const gx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)
    - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
  const gy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)
    - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
  return Math.abs(gx) + Math.abs(gy);
}

/**
 * How far a cell's colour is from anything the primary palette can draw: the half of salience that
 * marks what the material cannot say (a red bow on a green ramp), in the gradient's channel-weighted
 * units so the two add. Read on the source colour, as `nearestByColor` picks the decoration's
 * species, so marking and planting read one picture; the tone fit shifts the whole picture's miss by
 * a constant that `layStencilDecor`'s floor subtraction removes.
 */
function missAt(palette: readonly { rgb: number }[], rgb: number): number {
  const nearest = nearestByColor(palette, rgb);
  if (!nearest) return 0;
  return colorDistance(rgb, nearest.rgb);
}

export interface StencilDecorOptions {
  /** The objects this run laid, which a mark may replace. */
  replaceable?: ReadonlySet<string>;
  /** The palette the primary material was told in, which a mark is measured against. */
  primary?: readonly { rgb: number }[];
  /** Whether this run laid coatings a feature mark may replace. */
  paved?: boolean;
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
  { replaceable, primary = [], paved = false }: StencilDecorOptions = {},
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
    if (isChunkLoadEnforced(state)) {
      const budget = new LoadBudget(state);
      if (standing) budget.change(standing, -1);
      budget.change({ id: '', catalogId, position: at, rotation: 0, elevation: 0 }, 1);
      if (!budget.fits) return false;
    }
    if (standing) {
      if (!replaceable?.has(standing.id)) return false;
      if (!mayCoat && isCoatingItem(getCatalogItem(standing.catalogId))) return false;
      if (!executeCommand(removeObjectCommand(standing)).success) return false;
    }
    const obj: PlacedObject = {
      id: generateObjectId(), catalogId,
      position: at, rotation: 0,
      elevation: surfaceElevation(getCell(state.cells, at.x, at.y)?.terrain),
    };
    if (!executeCommand(placeObjectCommand(obj)).success) {
      // The base object goes back under its own id, which the load rule credits with its own load.
      if (standing) executeCommand(placeObjectCommand(standing));
      return false;
    }
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
      // Down the feature's own cells until the budget's share of them stands: a cell at the feature's
      // edge is a cell against a step, which a flat placement is refused, and the plan cannot know which
      // ones those are (`FeatureMark.cells`).
      let stood = 0;
      for (const i of plan.cells) {
        if (stood >= plan.want) break;
        const at = mark(i, plan.catalogId, false, true);
        if (at === true) { stood++; placed++; continue; }
        if (at === null) continue;
        // And a mark the ground refuses stands beside the feature, in the figure, which is the same
        // answer the background pass gives for the same cause: a feature is a colour boundary and so a
        // tier boundary, and a flat placement is refused a cell away from a step, so a one-cell feature
        // is often refused where it stands.
        let beside = false;
        // A fixed neighbour order, so the pass is one function of the picture.
        for (const [dx, dy] of NEIGHBORS4_NESW) {
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
    // A mark that cannot stand on the line stands beside it. The salient cells of a picture built in
    // terrain are its edges, and an edge in terrain is a step: flora wants flat ground, so exactly
    // the cells worth marking are the ones that refuse. The four edge neighbours in a fixed order
    // keep the mark against the feature it belongs to and keep the whole pass deterministic.
    let beside = false;
    for (const [dx, dy] of NEIGHBORS4_NESW) {
      const x = i % sw + dx, y = ((i / sw) | 0) + dy;
      if (x < 0 || y < 0 || x >= sw || y >= sh) continue;
      if (mark(y * sw + x, match.catalogId, true, paved) === true) { beside = true; break; }
    }
    if (beside) placed++; else skipped++;
  }
  return { placed, skipped };
}

function layStencilPlan(
  state: GridState,
  plan: StencilPlan,
  maxElevation: number,
  executeCommand: (cmd: Command) => ValidationResult,
  matches?: (ColorEntry | null)[],
): StencilResult {
  const placement = { origin: plan.origin, stencil: plan.stencil, ...(plan.allow ? { allow: plan.allow } : {}) };
  const before = plan.decor?.palette.length ? new Set(state.objects.keys()) : null;
  // What the picture is told in, which is also what the decoration is measured against: a cell is
  // worth marking partly because this palette cannot say its colour.
  const primary = plan.objectPalette?.length
    ? plan.objectPalette
    : terrainPalette(Math.max(1, maxElevation), plan.water === 'palette');
  const result = ((): StencilResult => {
    if (plan.read === 'color') {
      // A palette of objects means the picture is built from them; without one it is coloured in
      // terrain, which is the same read against a much narrower set of hues. `maxElevation` is that
      // ramp's depth — how many greens the picture may be told in — and applies to this read alone.
      return plan.objectPalette?.length
        ? layStencilObjectColor(state, placement, plan.objectPalette, executeCommand, { contrast: plan.contrast ?? 1, matches })
        : layStencilColor(state, placement, executeCommand, {
          maxElevation, contrast: plan.contrast ?? 1, water: plan.water ?? 'none',
        });
    }
    if (plan.fill?.kind === 'stroke') return layStencilLines(state, placement, executeCommand);
    if (plan.fill?.kind === 'object') return layStencilObjects(state, placement, plan.fill.catalogId, executeCommand);
    // No height argument: a glyph is one layer on the region's own surface, so there is nothing for a
    // height to say.
    return layStencilTerrain(state, placement, plan.fill?.terrain ?? TerrainType.Mountain, executeCommand);
  })();

  // The decoration goes on after, over whatever the primary left standing — it marks the picture
  // rather than building it, and it is absent unless the material asks for one.
  if (plan.decor?.palette.length) {
    // What this run laid is the decoration's to move, and which marks may move a coating is the decor
    // pass's own decision (`layStencilDecor`): a mark can stand where the primary already tiled the
    // picture with an object, which for a picture built out of paths means taking the path's cell, since
    // nothing may stand on a coating (V-PLACE-COATED). Anything the run did not lay is left alone.
    const paved = Boolean(plan.objectPalette?.length);
    const laid = new Set([...state.objects.values()]
      .filter((object) => !before?.has(object.id))
      .map((object) => object.id));
    const extra = layStencilDecor(state, placement, plan.decor, executeCommand, { replaceable: laid, primary, paved });
    return {
      ...result,
      placed: result.placed + extra.placed,
      skipped: result.skipped + extra.skipped,
      decorated: extra.placed,
    };
  }
  return result;
}

function matchPlanObjects(state: GridState, plan: StencilPlan): (ColorEntry | null)[] {
  if (plan.read === 'color') return matchObjectColors(state, plan, plan.objectPalette ?? [], plan.contrast ?? 1, true);
  const matches: (ColorEntry | null)[] = Array(plan.stencil.width * plan.stencil.height).fill(null);
  const item = plan.fill?.kind === 'object' ? getCatalogItem(plan.fill.catalogId) : undefined;
  if (!item) return matches;
  for (const { x, y } of shapeTiles(plan.stencil, item.id)) {
    if (writable(state, plan.origin.x + x, plan.origin.y + y, plan.allow)) {
      matches[y * plan.stencil.width + x] = { catalogId: item.id, rgb: 0 };
    }
  }
  return matches;
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
  const objectPrimary = plan.read === 'color' ? !!plan.objectPalette?.length : plan.fill?.kind === 'object';
  if (!objectPrimary) return layStencilPlan(state, plan, maxElevation, executeCommand);
  const prepared = budgetStencil(state, plan, candidate => matchPlanObjects(state, candidate));
  if (!prepared) return { placed: 0, skipped: 0, budget: 'blocked' };
  const result = layStencilPlan(state, prepared.plan, maxElevation, executeCommand, prepared.matches);
  return prepared.adapted ? { ...result, budget: 'adapted' } : result;
}
