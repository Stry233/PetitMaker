/**
 * Rare delights: now and then a planting press lays a SET PIECE instead of a stand.
 *
 * Roughly one press in thirty (`DELIGHT_RATE`), decided from the press seed alone, so it is a
 * property of the press rather than of the map and the same seed always answers the same way. The
 * ghost previews the real run, so the surprise is visible before the click lands — which is the
 * point: a delight is a gift, not a trick.
 *
 * THEY ARE HAND-AUTHORED. Every other composition in this feature is generated (an ecology, a
 * habitat sort, a succession ladder); these five are drawn shapes with named species, because the
 * pleasure of finding one comes from it being unmistakably PLACED. Each is category-appropriate —
 * the tree card gets the lone grand tree and the orchard, the flora card the fairy ring and the
 * heart — and each is laid through the live rules like everything else (`tryDecorate`), so a piece
 * that will not fit simply comes out smaller.
 *
 * A SET PIECE NEEDS ROOM AND LEVEL GROUND. A heart drawn across a terrace is a broken heart, so the
 * roll is offered only where the disc is one tier of plantable ground and wide enough to draw in.
 * Where it is not, the press is an ordinary one and nothing announces the difference.
 *
 * A SET PIECE DOES NOT GROW, for the same reason a bed does not (`grammar.ts`): a hold over one lays
 * it again, which the rules refuse cell by cell, so the shape stays the shape. The caller passes the
 * hold's ANCHOR seed, so every burst of one hold rolls the same answer.
 */
import { getCell, isBuildableZone } from '../../core/model/grid-model';
import { makeRng } from '../../core/model/rng';
import { surfaceElevation } from '../../core/edge-cut/terrain-silhouette';
import { ItemCategory, TerrainType, type GridState, type MacroCoord } from '../../core/model/types';
import { getCatalogItem, getPlaceableByCategory } from '../../state/catalog';
import { makeCtx, tryDecorate, type PlaceCtx } from '../placement/object';
import type { MacroContext } from './context';
import { CLIMAX_STAGE, successionPalette, tierOf } from './succession';

/** How often a press lays a set piece instead of a stand. */
const DELIGHT_RATE = 0.03;
/** Separates the roll from the piece draw, and both from every other seeded decision in the run. */
const DELIGHT_SALT = 0x9e3f7a1b;
const SPECIES_SALT = 0x7f4a7c15;
const ACCENT_SALT = 0x3c79a5d3;

/** Under this the disc is too small to draw a shape in — the ring would be two cells and the heart
 *  a blob. The bar's own smallest setting is 4. */
const DELIGHT_MIN_RADIUS = 4;
/** How much of the disc must be one tier of plantable ground before a shape is offered. */
const UNIFORM_SHARE = 0.9;

export interface DelightInput {
  cells: readonly MacroCoord[];
  centre: { x: number; y: number };
  radius: number;
  /** The HOLD's own seed (its anchor's), not the burst's: one hold is one answer. */
  seed: number;
  lead: ItemCategory;
  /** How many bursts have landed at this spot. A piece is laid once and repeated, never grown. */
  stage: number;
}

/** The white blooms a fairy ring is made of, in catalog order of preference — the ring is the one
 *  piece whose COLOUR is the whole idea, so the species cannot be drawn from the site. */
const WHITE_FLORA = ['flower-agapanthus-white', 'flower-portulaca-white', 'flower-amaryllis-white'];

/** Two colourways of one species: the same drawing repainted, which is what makes a two-colour heart
 *  read as one shape in two colours rather than as two plants sharing a bed. */
const HEART_PAIRS: readonly (readonly [string, string])[] = [
  ['flower-rose', 'flower-rose-blue'],
  ['flower-lily', 'flower-lily-cyan'],
  ['flower-dahlia', 'flower-dahlia-orange'],
  ['flower-violet', 'flower-violet-pink'],
  ['flower-daisy', 'flower-daisy-yellow'],
];

interface Piece {
  id: string;
  lead: ItemCategory;
  lay: (place: PlaceCtx, input: DelightInput) => number;
}

/**
 * Lay a set piece, or answer null for an ordinary press.
 *
 * Null is the caller's cue to plant the wild stand. A piece that rolled but found no room says the
 * same thing on the FIRST press (better a stand than an empty press) and says nothing on a later
 * burst of the same hold, where the piece is already standing and the stand would grow around it.
 */
export function layDelight(ctx: MacroContext, input: DelightInput): number | null {
  const piece = rolled(ctx.state, input);
  if (!piece) return null;
  const place = makeCtx(ctx.state, (c) => ctx.executor.execute(c), ctx.registry, input.seed);
  const laid = piece.lay(place, input);
  return laid === 0 && input.stage <= 1 ? null : laid;
}

/**
 * Which set piece a seed lays, or null for an ordinary press — THE ROLL ALONE, with no map in it.
 *
 * Exported because that is what makes the rate measurable: a probe can sweep a thousand seeds
 * without pressing a thousand maps, and can check that every piece is reachable rather than that
 * one of them is.
 */
export function delightRoll(seed: number, lead: ItemCategory): string | null {
  return roll(seed, lead)?.id ?? null;
}

function roll(seed: number, lead: ItemCategory): Piece | null {
  // Both draws come off ONE stream, in order. A second stream salted from the same seed would be
  // correlated with the first through the seed they share: only the seeds whose first draw came out
  // small ever reach the second one, and asked that way the pieces came out 2.5:1 rather than even.
  const rng = makeRng((seed ^ DELIGHT_SALT) >>> 0);
  if (rng.float() >= DELIGHT_RATE) return null;
  const pieces = PIECES.filter((p) => p.lead === lead);
  if (pieces.length === 0) return null;
  return pieces[rng.int(pieces.length)]!;
}

/** The roll, once the ground has been asked whether it can hold a shape at all. */
function rolled(state: GridState, input: DelightInput): Piece | null {
  if (input.radius < DELIGHT_MIN_RADIUS) return null;
  if (!uniformGround(state, input.cells, input.centre)) return null;
  return roll(input.seed, input.lead);
}

/** Whether the disc is one tier of plantable ground: buildable, dry, and at the surface the aim
 *  point stands on. Read through the kernel (`surfaceElevation`), so a filleted cell reports the
 *  surface a plant would actually stand on rather than the block under it. */
function uniformGround(state: GridState, cells: readonly MacroCoord[], centre: { x: number; y: number }): boolean {
  const at = getCell(state.cells, Math.round(centre.x), Math.round(centre.y));
  if (!at || !isBuildableZone(at.zone) || at.terrain?.type === TerrainType.Water) return false;
  const tier = surfaceElevation(at.terrain);
  let level = 0;
  for (const c of cells) {
    const cell = getCell(state.cells, c.x, c.y);
    if (!cell || !isBuildableZone(cell.zone) || cell.terrain?.type === TerrainType.Water) continue;
    if (surfaceElevation(cell.terrain) === tier) level++;
  }
  return level >= cells.length * UNIFORM_SHARE;
}

/** The cells one ring out from a centre, at radius `r` — the ring a circle of plants stands on. */
function ringCells(cx: number, cy: number, r: number): MacroCoord[] {
  const out: MacroCoord[] = [];
  const span = Math.ceil(r) + 1;
  for (let dy = -span; dy <= span; dy++) {
    for (let dx = -span; dx <= span; dx++) {
      const d = Math.hypot(dx, dy);
      if (d >= r - 0.5 && d < r + 0.5) out.push({ x: cx + dx, y: cy + dy });
    }
  }
  return out.sort((a, b) => a.y - b.y || a.x - b.x);
}

/** One id out of a pool, deterministic in `seed`. Empty pools are the caller's problem. */
const pick = (pool: readonly string[], seed: number): string => pool[makeRng(seed >>> 0).int(pool.length)]!;

/** The ordinary climax trees — the wood a grand specimen stands apart from. */
function climaxTrees(): string[] {
  const palette = successionPalette(ItemCategory.Tree)!;
  return getPlaceableByCategory(ItemCategory.Tree)
    .map((i) => i.id)
    .filter((id) => !id.startsWith(palette.grand) && tierOf(id, palette) === CLIMAX_STAGE);
}

/** Only what the catalog actually carries, in the order the piece names them. */
const present = (ids: readonly string[]): string[] => ids.filter((id) => getCatalogItem(id));

const PIECES: readonly Piece[] = [
  {
    // The oldest tree on the map, standing alone in a glade with the wood held back around it.
    id: 'lone-grand',
    lead: ItemCategory.Tree,
    lay: (place, { centre, radius, seed }) => {
      const cx = Math.round(centre.x), cy = Math.round(centre.y);
      const wood = climaxTrees();
      let laid = tryDecorate(place, successionPalette(ItemCategory.Tree)!.grand, cx, cy) ? 1 : 0;
      if (wood.length === 0) return laid;
      const sp = pick(wood, seed ^ SPECIES_SALT);
      for (const c of ringCells(cx, cy, Math.max(3, Math.round(radius * 0.8)))) {
        // Alternating cells: every tree in the catalog refuses another within one cell.
        if ((c.x + c.y) % 2 === 0 && tryDecorate(place, sp, c.x, c.y)) laid++;
      }
      return laid;
    },
  },
  {
    // A planted orchard: one fruit species on a square lattice, the way a working grove is set out.
    id: 'orchard',
    lead: ItemCategory.Tree,
    lay: (place, { centre, radius, seed }) => {
      const palette = successionPalette(ItemCategory.Tree)!;
      const pool = getPlaceableByCategory(ItemCategory.Tree)
        .map((i) => i.id)
        .filter((id) => !id.startsWith(palette.grand));
      if (pool.length === 0) return 0;
      const sp = pick(pool, seed ^ SPECIES_SALT);
      const cx = Math.round(centre.x), cy = Math.round(centre.y);
      const half = Math.max(2, Math.floor(radius * 0.7));
      let laid = 0;
      for (let dy = -half; dy <= half; dy += 2) {
        for (let dx = -half; dx <= half; dx += 2) {
          if (tryDecorate(place, sp, cx + dx, cy + dy)) laid++;
        }
      }
      return laid;
    },
  },
  {
    // A fairy ring: one white bloom all the way round, and nothing at all inside it.
    id: 'fairy-ring',
    lead: ItemCategory.Flora,
    lay: (place, { centre, radius, seed }) => {
      const whites = present(WHITE_FLORA);
      if (whites.length === 0) return 0;
      const sp = pick(whites, seed ^ SPECIES_SALT);
      const cx = Math.round(centre.x), cy = Math.round(centre.y);
      let laid = 0;
      for (const c of ringCells(cx, cy, Math.max(2, Math.round(radius * 0.65)))) {
        if (tryDecorate(place, sp, c.x, c.y)) laid++;
      }
      return laid;
    },
  },
  {
    // A heart, outlined in one colourway and filled with the other.
    id: 'heart',
    lead: ItemCategory.Flora,
    lay: (place, { centre, radius, seed }) => {
      const pairs = HEART_PAIRS.filter(([a, b]) => getCatalogItem(a) && getCatalogItem(b));
      if (pairs.length === 0) return 0;
      const [fill, outline] = pairs[makeRng((seed ^ SPECIES_SALT) >>> 0).int(pairs.length)]!;
      const cx = Math.round(centre.x), cy = Math.round(centre.y);
      const s = Math.max(2, radius * 0.55);
      // The classic implicit heart, sampled per cell: (u^2+v^2-1)^3 - u^2 v^3 <= 0, with v measured
      // UP so the point of it sits below the lobes on a screen whose y grows downward.
      const inside = (dx: number, dy: number): boolean => {
        const u = dx / s, v = -dy / s;
        const t = u * u + v * v - 1;
        return t * t * t - u * u * v * v * v <= 0;
      };
      const span = Math.ceil(s * 1.4);
      let laid = 0;
      for (let dy = -span; dy <= span; dy++) {
        for (let dx = -span; dx <= span; dx++) {
          if (!inside(dx, dy)) continue;
          const edge = !inside(dx - 1, dy) || !inside(dx + 1, dy) || !inside(dx, dy - 1) || !inside(dx, dy + 1);
          if (tryDecorate(place, edge ? outline : fill, cx + dx, cy + dy)) laid++;
        }
      }
      return laid;
    },
  },
  {
    // Two rings of one species around an open middle: a knot garden, the smallest formal thing a
    // press can lay.
    id: 'knot',
    lead: ItemCategory.Flora,
    lay: (place, { centre, radius, seed }) => {
      const pool = getPlaceableByCategory(ItemCategory.Flora).map((i) => i.id);
      if (pool.length === 0) return 0;
      const sp = pick(pool, seed ^ SPECIES_SALT);
      const accentPool = pool.filter((id) => id !== sp);
      const accent = accentPool.length ? pick(accentPool, seed ^ ACCENT_SALT) : sp;
      const cx = Math.round(centre.x), cy = Math.round(centre.y);
      const outer = Math.max(3, Math.round(radius * 0.7));
      let laid = 0;
      for (const c of ringCells(cx, cy, outer)) if (tryDecorate(place, sp, c.x, c.y)) laid++;
      for (const c of ringCells(cx, cy, Math.max(1.5, outer - 2))) {
        if (tryDecorate(place, accent, c.x, c.y)) laid++;
      }
      return laid;
    },
  },
];

/** The pieces a card can lay, for a probe that must know what to look for. */
export const delightIds = (lead: ItemCategory): string[] => PIECES.filter((p) => p.lead === lead).map((p) => p.id);
