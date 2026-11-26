/*
 * The generated maps a Help figure pictures, and their pictures, each built once per session: a
 * picture kind's run through the shelf's own plan pipeline (sample, rasterize, plan, candidate) on a
 * sandbox world, a designed run swept along a knob, and one finished map. The real renderer
 * photographs them, so a figure is a dealt card's own build.
 */
import { isBuildableZone } from '../../core/game/zones';
import { templateAnchor } from '../../core/model/landmarks';
import { TerrainType, type GridState, type MacroCoord } from '../../core/model/types';
import { KIND_ENGINE, RECIPE_RANGES, type StencilFillKind } from '../../tools/generation/facts';
import type { StencilKind } from '../../tools/generation/kinds';
import type { StencilBox, StencilSource } from '../../tools/generation/stencil';
import { renderThumbnail } from '../../view/map2d/capture/thumbnail';
import { kindCandidate } from '../editing/generate-batch';
import { SandboxWorld } from './demo-world';
import { sceneNeighbourhood } from './neighbourhood';
import { buildableBox, cellsBox, stencilPlanOn } from './stencil-shots';

/** A picture built once per key. A failed build must not poison the cache or vanish silently: it is
 *  logged, resolves null and is retried on the next ask. */
function onceEach(label: string): (key: string, build: () => Promise<string | null>) => Promise<string | null> {
  const shots = new Map<string, Promise<string | null>>();
  return (key, build) => {
    let hit = shots.get(key);
    if (!hit) {
      hit = build().catch((err) => {
        console.error(label, key, err);
        shots.delete(key);
        return null;
      });
      shots.set(key, hit);
    }
    return hit;
  };
}

/** One built shot per (kind, sample, fill): each is a real run through the shelf's own plan pipeline
 *  over the whole block, which is what gives a letter its size and a picture its fidelity. */
const stencilShots = onceEach('help stencil shot failed');

/** The shelf's own picture defaults: its contrast as the engine's factor, and the picture kinds' ceiling. */
const SHOT_CONTRAST = RECIPE_RANGES.contrast.default;
const SHOT_RELIEF = KIND_ENGINE.image.maxElevation;

/** The window a comparison thumbnail builds in, in cells. */
const COMPACT = { maxW: 44, maxH: 56 };

export interface StencilShotAsk {
  kind: StencilKind;
  /** The sample the run reads, named for the cache by `id`. */
  sample: StencilSource & { id: string };
  fill: StencilFillKind;
  /** The one item a letter tiles with when its material is Objects. */
  item: string;
  /** A comparison thumbnail: a clamped window of the block, which builds several times faster at
   *  the size a row shows. */
  compact?: boolean;
  /** The picture knobs, at the shelf's own defaults when absent. */
  contrast?: number;
  maxElevation?: number;
}

/** A picture kind's run on the default planet, photographed where it drew; null where it cannot be built. */
export function stencilShot(ask: StencilShotAsk): Promise<string | null> {
  const key = `${ask.sample.id}|${ask.fill}|${ask.sample.text ?? ''}|${ask.item}|${ask.compact ? 'c' : 'f'}|${ask.contrast ?? SHOT_CONTRAST}|${ask.maxElevation ?? SHOT_RELIEF}`;
  return stencilShots(key, () => buildStencilShot(ask));
}

/** The tall buildable block west of the plaza: as much room as a region can give a letter or a
 *  picture without wrapping the locked plaza, which would stand as a hole in the figure's middle.
 *  The plaza rect can sit on the half grid, so its edge rounds to whole cells before the walk. */
function westBlock(world: SandboxWorld, clamp?: { maxW: number; maxH: number }): { cells: MacroCoord[]; box: StencilBox; allow: Set<number> } | null {
  const island = buildableBox(world);
  const anchor = templateAnchor(world.state.template);
  if (!island) return null;
  const right = anchor ? Math.floor(anchor.x) - 3 : island.origin.x + island.width;
  const fullW = Math.min(right, island.origin.x + island.width) - island.origin.x;
  const x0 = clamp ? island.origin.x + Math.max(0, Math.floor((fullW - clamp.maxW) / 2)) : island.origin.x;
  const x1 = clamp ? Math.min(right, x0 + clamp.maxW) : Math.min(right, island.origin.x + island.width);
  const y0 = clamp ? island.origin.y + Math.max(0, Math.floor((island.height - clamp.maxH) / 2)) : island.origin.y;
  const y1 = clamp ? Math.min(island.origin.y + island.height, y0 + clamp.maxH) : island.origin.y + island.height;
  const cells: MacroCoord[] = [];
  const allow = new Set<number>();
  const mapW = world.state.template.width;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const zone = world.state.cells[y]?.[x]?.zone;
      if (zone === undefined || !isBuildableZone(zone)) continue;
      cells.push({ x, y });
      allow.add(y * mapW + x);
    }
  }
  const box = cellsBox(cells);
  if (!box) return null;
  return { cells, box, allow };
}

/** The rect the run actually drew (terrain raised or sunk, objects placed), for the photograph:
 *  the stencil fits the image's own aspect inside the region, so the region's box over-frames. */
function drawnFrame(state: GridState, box: StencilBox): { x: number; y: number; width: number; height: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const mark = (x: number, y: number) => {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  };
  for (let y = box.origin.y; y < box.origin.y + box.height; y++) {
    for (let x = box.origin.x; x < box.origin.x + box.width; x++) {
      const t = state.cells[y]?.[x]?.terrain;
      if (t && (t.elevation > 0 || t.type !== TerrainType.None)) mark(x, y);
    }
  }
  for (const o of state.objects.values()) {
    if (o.locked) continue;
    mark(Math.floor(o.position.x), Math.floor(o.position.y));
  }
  if (minX > maxX) return { x: box.origin.x, y: box.origin.y, width: box.width, height: box.height };
  const pad = 2;
  return { x: minX - pad, y: minY - pad, width: maxX - minX + 1 + 2 * pad, height: maxY - minY + 1 + 2 * pad };
}

async function buildStencilShot({ kind, sample, fill, item, compact, contrast, maxElevation }: StencilShotAsk): Promise<string | null> {
  const world = new SandboxWorld();
  const band = westBlock(world, compact ? COMPACT : undefined);
  if (!band) return null;
  const { cells, box, allow } = band;
  const plan = await stencilPlanOn(sample, kind, box, { fill, item, contrast: contrast ?? SHOT_CONTRAST, allow });
  if (!plan) return null;
  const candidate = await kindCandidate(world.kit, {
    kind, seed: 7, richness: Math.round(RECIPE_RANGES.richness.default * 100), maxElevation: maxElevation ?? SHOT_RELIEF,
    corridorWidth: RECIPE_RANGES.corridorWidth.min, gates: null, stencilPlan: plan,
  }, cells);
  if (!candidate) return null;
  const frame = drawnFrame(candidate.state, box);
  return renderThumbnail(candidate.state, 760, { aspect: frame.width / frame.height, frame });
}

/** One designed run per (richness, tallest layer), photographed whole. */
const islandShots = onceEach('help planet shot failed');

/** The seed every sweep shares, so the only difference between neighbours is the knob. */
const SWEEP_SEED = 20260830;

/** The default planet designed at `richness` (0 to 1) under `maxElevation`, photographed whole. */
export function islandShot(richness: number, maxElevation: number): Promise<string | null> {
  return islandShots(`${richness}|${maxElevation}`, async () => {
    const world = new SandboxWorld();
    world.beginStroke();
    world.generateDesigned({ seed: SWEEP_SEED, richness, maxElevation, mode: 'mixed', region: null });
    world.commit();
    return renderThumbnail(world.state, 520, { aspect: world.state.template.width / world.state.template.height });
  });
}

let finished: GridState | null = null;

/** A finished map of the default planet, built once per session by the scenes' own designed run on
 *  this thread, so it carries the run's record as a map just generated does. */
export function finishedMap(): GridState {
  finished ??= sceneNeighbourhood(undefined);
  return finished;
}
