/**
 * Cuts the ambient water off the terrace steps: the gaps the movement line steps over and the
 * cascade bands that fall from one terrace onto the next.
 */
import { stepDistance } from '../../../../core/grid/cell-sets';
import { flatIndex, rectContains, type Rect } from '../../../../core/grid/rect';
import type { MacroCoord } from '../../../../core/model/types';
import type { TerrainPlan } from '../../terrain-plan/types';
import type { MovementLine, WaterWant } from '../composition/movement-line';
import type { StreetPlan } from '../streets/model';
import { atTier, flood, uniform, type WaterGround } from '../water/water-cut';
import type { DesignPlan } from '../types';
import { seedHash01 } from '../../../../core/base/hash';
import { lerpClamped } from '../../../../core/base/math';
import type { CascadeBand, WaterFeature } from './terrain-sculpt';

/** A fall band's run, at richness 0 and 1, and how deep it may be. A cascade band reads 2 to 4 rows
 *  deep and 30 to 40 cells wide, and half of a terraced planet's bodies present a capped face, so the
 *  cascade, not the pond, is the dominant water form, and it is what carries most of a map's water. */
const FALL_RUN = { min: 3, max: 30 } as const;
const FALL_DEPTH = { min: 1, max: 3 } as const;
/** Share of the terrace steps that carry a fall, at richness 0 and 1. */
const FALL_SHARE = { low: 0.12, high: 1 } as const;
/** How far apart two falls stand along one step, in cells. */
const FALL_GAP = 4;
/**
 * How many ambient bands of one size a map may carry: the cap on congruent shapes, applied to the pass
 * most able to break it.
 *
 * Every minimal terrace step offers exactly one band length, so without this a planet of short steps
 * came back with twenty-five congruent 5x3 bodies — wallpaper rather than water.
 * The cap is about the look rather than about the reading: a band is a dozen cells and the congruence
 * reading counts features of twenty or more, so nothing here would fail a check either way.
 */
const BAND_CLASS_MAX = 3;

/** How far a gorge is cut below the terrace its crossing stands on: V-MTN-03's own window, which is
 *  the deepest a hole may be without the ground around it losing its support. */
const GORGE_DROP = 3;

// --- the water compositions ---------------------------------------------------------------------

/**
 * The gap the movement line steps over, opened in the stretch `streets.ts` left unpaved. At
 * elevation 0 it is flooded (ground water shows no face); a raised stretch is cut down into a gorge,
 * the bridge gap a terraced planet can offer. The drop is V-MTN-03's own window, so the banks keep
 * their support by construction, and the opened cells are locked into the reservation.
 */
export function openLineCrossings(
  t: TerrainPlan, grass: Uint8Array, flat: Uint8Array, streets: StreetPlan, wet: boolean,
): WaterFeature[] {
  const out: WaterFeature[] = [];
  for (const crossing of streets.crossings) {
    const rect = crossing.open;
    const floor = Math.max(0, crossing.tier - GORGE_DROP);
    let opened = 0;
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        if (x < 1 || y < 1 || x >= t.width - 1 || y >= t.height - 1) continue;
        const i = flatIndex(x, y, t.width);
        if (!grass[i] || flat[i] || t.water[i]! >= 0) continue;
        // An earth planet floods nothing, its crossings included. The `earth` kind's whole meaning
        // is that the map holds no water (`waterScale` 0), and a flooded channel is water however it
        // was planned.
        // What it gets instead is the gorge every terraced crossing gets, which a deck spans just
        // the same.
        if (crossing.kind === 'water' && wet) {
          t.tier[i] = 0;
          t.water[i] = 0;
        } else {
          t.tier[i] = floor;
        }
        flat[i] = 1;
        opened++;
      }
    }
    if (opened > 0) {
      out.push({ kind: 'crossing', regionId: '', rect, tier: crossing.tier });
    }
  }
  return out;
}

/** Where the walk asked for a cascade: the bands beside its climbs, which `cutFalls` takes as the
 *  steps worth cutting whatever the seeded share would otherwise have said. */
export function cascadeRects(line: MovementLine | undefined): Rect[] {
  return (line?.waterWants ?? [])
    .filter((w): w is WaterWant => w.kind === 'cascade')
    .map((w) => w.rect);
}

/**
 * The falls: a band of water cut along a terrace step, pouring onto the terrace below.
 *
 * A step is where a cell stands exactly one tier above its neighbour, and a run of such cells is one
 * lip. The band takes the middle of the run and leaves a cell of standing terrace at each end, which
 * are the caps V-WTR-02 asks for; the row it pours onto is the plate below, uniform by construction,
 * which is V-WTR-03. Depth 2 is taken only where the row behind the lip stands at the lip's own tier
 * with its own caps, so the second row shows no face of its own.
 */
export function cutFalls(ground: WaterGround, richness: number, seed: number, wanted: readonly Rect[] = []): CascadeBand[] {
  const { t, grass, flat } = ground;
  const W = t.width, H = t.height;
  const run = Math.round(lerpClamped(FALL_RUN.min, FALL_RUN.max, richness));
  const depth = Math.round(lerpClamped(FALL_DEPTH.min, FALL_DEPTH.max, richness));
  const share = lerpClamped(FALL_SHARE.low, FALL_SHARE.high, richness);
  const out: CascadeBand[] = [];
  const taken: MacroCoord[] = [];
  // How many bands of each size the map has cut, so no size is repeated past the congruence cap.
  const sized = new Map<string, number>();
  // Both axes: a step faces south or east as readily as it faces the way the mass leans.
  for (const axis of ['y', 'x'] as const) {
    const along = axis === 'y' ? W : H;
    const down = axis === 'y' ? H : W;
    for (let d = 1; d < down - 1; d++) {
      let a = 1;
      while (a < along - 1) {
        const at = (k: number): { x: number; y: number } => (axis === 'y' ? { x: k, y: d } : { x: d, y: k });
        const step = (k: number): boolean => {
          const c = at(k), n = axis === 'y' ? { x: k, y: d + 1 } : { x: d + 1, y: k };
          if (c.x < 1 || c.y < 1 || c.x >= W - 1 || c.y >= H - 1) return false;
          const i = flatIndex(c.x, c.y, W), j = flatIndex(n.x, n.y, W);
          return !!grass[i] && !flat[i] && !!grass[j] && !flat[j]
            && t.water[i]! < 0 && t.water[j]! < 0
            && t.tier[i]! >= 1 && t.tier[i]! === t.tier[j]! + 1;
        };
        if (!step(a)) { a++; continue; }
        let end = a;
        while (end + 1 < along - 1 && step(end + 1) && end - a + 1 < run + 2) end++;
        const length = end - a + 1;
        // The two end cells are the caps; what is left between them is the band.
        // A step the walk asked for is always worth cutting: the cascade beside a climb is the
        // companion the movement line named, not one of the map's ambient falls.
        const head = at(a), tail = at(end);
        const asked = wanted.some((r) => rectContains(r, head.x, head.y) || rectContains(r, tail.x, tail.y));
        if (length >= FALL_RUN.min + 2 && (asked || seedHash01(seed ^ 0xfa11, a * 131 + d) < share)) {
          // No two bands the same size, the congruence cap read on this pass's own output: a band taking
          // the whole of its run comes out `FALL_RUN.min` by `depth` at every minimal step on the map,
          // which is how one seed drops twenty-five congruent 5x3 bodies — wallpaper rather than water.
          // The length and the depth are drawn per site instead, and every
          // sub-band of a step run has the same caps the whole run would: the run's cells all stand at
          // one tier with lower ground ahead, so a shorter band's own end cells are caps too.
          const room = length - 2;
          const rows = 1 + Math.floor(seedHash01(seed ^ 0x5b09, a * 311 + d) * depth);
          // The drawn length, then the next one whose size class this map has not used up: a run only
          // `FALL_RUN.min` long can be cut one way, so on a planet of short steps the draw alone still
          // answers the same size every time.
          const draw = FALL_RUN.min
            + Math.floor(seedHash01(seed ^ 0x2c1f, a * 131 + d) * (room - FALL_RUN.min + 1));
          let want = 0;
          for (let k = 0; k <= room - FALL_RUN.min; k++) {
            const size = FALL_RUN.min + ((draw - FALL_RUN.min + k) % (room - FALL_RUN.min + 1));
            if ((sized.get(`${size}x${rows}`) ?? 0) < BAND_CLASS_MAX) { want = size; break; }
          }
          if (want === 0) { a = end + 1; continue; }
          const off = Math.floor(seedHash01(seed ^ 0x71a3, a * 197 + d) * (room - want + 1));
          const lo = a + 1 + off, hi = lo + want - 1;
          const c0 = at(lo);
          const tier = t.tier[flatIndex(c0.x, c0.y, W)]!;
          const near = taken.some((p) => Math.abs(p.x - c0.x) + Math.abs(p.y - c0.y) < FALL_GAP);
          // A band pours one way, and both rules read the other three sides. V-WTR-02 wants a cap of
          // standing terrace at each perpendicular end, which the run's own end cells are; the back
          // of the band must stand at the band's own tier, or the water faces a drop there too and
          // its own apron is somebody else's terrace; and V-WTR-03 wants the row it pours onto,
          // caps included, at one elevation. The apron is then locked, since a bed cut into it later
          // would break a fall already standing.
          const strip = (from: number, to: number, lo2: number, hi2: number): Rect => (axis === 'y'
            ? { x: lo2, y: from, w: hi2 - lo2 + 1, h: to - from + 1 }
            : { x: from, y: lo2, w: to - from + 1, h: hi2 - lo2 + 1 });
          const apron = strip(d + 1, d + 1, lo - 1, hi + 1);
          let deep = rows;
          while (deep > 0 && !atTier(t, grass, flat, strip(d - deep, d - deep, lo - 1, hi + 1), tier)) deep--;
          // The cap is checked on the size the band actually comes out at. The depth is drawn before
          // the ground is read and then shrinks where the row behind the lip is not standing, so a band
          // asked for at one class lands in another: checking the asked class alone let five congruent
          // bodies through on one seed while the tally said three.
          const cls = `${want}x${deep}`;
          if (!near && deep > 0 && (sized.get(cls) ?? 0) < BAND_CLASS_MAX && uniform(t, grass, apron)) {
            sized.set(cls, (sized.get(cls) ?? 0) + 1);
            for (let k = 0; k < deep; k++) {
              const rect = strip(d - k, d - k, lo, hi);
              if (k > 0 && !atTier(t, grass, flat, strip(d - k, d - k, lo - 1, hi + 1), tier)) break;
              flood(t, rect, tier);
              out.push({ rect, tier });
            }
            taken.push(c0);
            for (let ay = apron.y; ay < apron.y + apron.h; ay++) {
              for (let ax = apron.x; ax < apron.x + apron.w; ax++) {
                if (ax >= 0 && ay >= 0 && ax < W && ay < H) flat[flatIndex(ax, ay, W)] = 1;
              }
            }
          }
        }
        a = end + 1;
      }
    }
  }
  return out;
}

/** Chebyshev distance from every cell to the nearest one a body of water must keep clear of: the
 *  sea, a place's own lot, the plaza, the reserved road space, and — where a `TerrainPlan` is
 *  passed — the water already cut. */
export function openGround(
  flat: Uint8Array, plan: DesignPlan, W: number, H: number, cut?: TerrainPlan,
): Int16Array {
  const seeds: number[] = [];
  const near = new Uint8Array(flat);
  if (cut) for (let i = 0; i < near.length; i++) if (cut.water[i]! >= 0) near[i] = 1;
  for (const region of plan.regions) {
    for (const lot of region.lot) {
      for (let y = Math.max(0, lot.y); y < Math.min(H, lot.y + lot.h); y++) {
        for (let x = Math.max(0, lot.x); x < Math.min(W, lot.x + lot.w); x++) near[flatIndex(x, y, W)] = 1;
      }
    }
  }
  for (let i = 0; i < near.length; i++) if (near[i]) seeds.push(i);
  return stepDistance(seeds, W, H, true);
}

/** Where the street plan is going to lay pavement: what a fountain court is composed against. */
export function pavedMask(streets: StreetPlan, W: number, H: number): Uint8Array {
  const out = new Uint8Array(W * H);
  for (const c of streets.cells) {
    if (c.x >= 0 && c.y >= 0 && c.x < W && c.y < H) out[flatIndex(c.x, c.y, W)] = 1;
  }
  return out;
}
