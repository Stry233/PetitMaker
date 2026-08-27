// THE CASCADE STAIR, read on ground the test itself shapes.
//
// The claims are all about the BAND GEOMETRY, and the only proof that matters for it is a commit: a
// band's caps (V-WTR-02) and its uniform landing (V-WTR-03) are claims about a finished map, so the
// terraced fixture is committed through the live rules and the violation list has to be empty.
//
// The rest is what makes a stair a stair rather than a pool on a lip: it descends several steps, the
// bands stand on one strip AND join into one connected body so the whole of it reads as one figure, it
// crosses more tiers than any single body the accent pass could cut, and its foot is a cell the
// island's water story can carry on from.
//
// THE GROUND IS THE INPUT, not a seed. The pass is a pure function of the plan — nothing in it is
// seeded — so the fixture varies what actually varies between islands: how deep a terrace runs before
// it steps. A test that ran six seeds over one staircase would be running one case six times.
import { describe, it, expect } from 'vitest';
import { MAP_TEMPLATES } from '../../../../../config/maps';
import { flatIndex } from '../../../../../core/model/grid-model';
import type { MapTemplate } from '../../../../../core/model/types';
import { createDefaultRegistry } from '../../../../../rules';
import { applyPlanToScratch } from '../../../../../tools/generation/core/repair';
import type { TerrainPlan } from '../../../../../tools/generation/core/types';
import { paintableMask } from '../../../../../tools/generation/designer/composition/composition';
import { carveCascadeStairs, type CascadeStair } from '../../../../../tools/generation/designer/water/cascade-stair';

const HEXIA = MAP_TEMPLATES['hexia']!;
/** Terrace depths, in rows per tier: the shallowest a band and its landing fit in, the deepest a
 *  designed plate runs to, and the awkward ones between. */
const STEPS = [4, 5, 6, 8, 10, 14];
/** The floors `cascade-stair.ts` holds a band to: how deep its tread runs and how wide it may narrow to. */
const BAND_DEPTH_MIN = 2;
const WIDTH_MIN = 5;

/**
 * A staircase island: the buildable land terraced from `peak` down to 0 along y, `step` rows per
 * tier, which is the shape the composition's plates make on a flank and the one a stair has to
 * descend.
 *
 * Three tiers rather than eight because V-MTN-03 auto-passes at and below layer 3: a synthetic
 * plateau at layer 4 running to the coast has no 3x3 support at its rim and would fail the rule on
 * ground the test drew rather than on anything the stair cut. Three tiers is also exactly `STEPS_MIN`
 * steps, so the fixture is the smallest island a stair may be cut on at all. The rows per tier are
 * the terrace DEPTH: eight is what a designed plate runs to, and a stair that only worked on a flank
 * with no floor on it would never be cut on a real map.
 */
function staircase(
  template: MapTemplate, peak = 3, step = 8,
): { t: TerrainPlan; grass: Uint8Array; flat: Uint8Array } {
  const W = template.width, H = template.height;
  const grass = paintableMask(template);
  const t: TerrainPlan = { width: W, height: H, tier: new Int8Array(W * H), water: new Int8Array(W * H).fill(-1) };
  // The staircase starts at the island's own northern shore, not at row 0: the template's top rows
  // are sea, and a fixture that spent its high tiers there would offer a stair no land to stand on.
  let top = H;
  for (let i = 0; i < grass.length; i++) if (grass[i]) { top = Math.min(top, (i / W) | 0); }
  for (let y = 0; y < H; y++) {
    const tier = Math.max(0, peak - Math.floor(Math.max(0, y - top) / step));
    for (let x = 0; x < W; x++) {
      const i = flatIndex(x, y, W);
      if (grass[i]) t.tier[i] = tier;
    }
  }
  return { t, grass, flat: new Uint8Array(W * H) };
}

function carve(step: number, richness = 1): {
  stairs: CascadeStair[]; t: TerrainPlan; grass: Uint8Array; flat: Uint8Array;
} {
  const { t, grass, flat } = staircase(HEXIA, 3, step);
  const stairs = carveCascadeStairs({ t, grass, flat, richness });
  return { stairs, t, grass, flat };
}

/** How many 4-connected bodies the stair's own cells fall into on the plan it cut: one, or it is not
 *  one figure. */
function bodies(stair: CascadeStair, t: TerrainPlan): number {
  const own = new Set(stair.cells.map((c) => flatIndex(c.x, c.y, t.width)));
  const seen = new Set<number>();
  let count = 0;
  for (const start of own) {
    if (seen.has(start)) continue;
    count++;
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % t.width, y = (i / t.width) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const j = flatIndex(x + dx, y + dy, t.width);
        if (!own.has(j) || seen.has(j)) continue;
        seen.add(j);
        stack.push(j);
      }
    }
  }
  return count;
}

describe('the cascade stair, on a staircase island', () => {
  it('cuts a stair on every terrace depth, of three steps wherever three are there', () => {
    for (const step of STEPS) {
      const { stairs } = carve(step);
      expect(stairs.length, `step ${step}`).toBeGreaterThanOrEqual(1);
      for (const stair of stairs) {
        // TWO STEPS IS THE SMALLEST STAIR, and the shallowest fixture is where the pass falls back to
        // it: on 4 rows per tier this island's top terrace is two rows of land above its own shore, so
        // the top band would pour backwards off the coast and is not cut. Every deeper terrace carries
        // the three the pass asks for first.
        expect(stair.bands.length, `step ${step}`).toBeGreaterThanOrEqual(step > 4 ? 3 : 2);
        expect(stair.width, `step ${step}`).toBeGreaterThanOrEqual(WIDTH_MIN);
      }
    }
  });

  it('descends: every band pours onto a lower level than it stands at', () => {
    for (const step of STEPS) {
      for (const stair of carve(step).stairs) {
        for (const band of stair.bands) {
          expect(band.landsAt, `step ${step} band at ${band.rect.x},${band.rect.y}`)
            .toBeLessThan(band.tier);
        }
        // The bands are met top down, so the sequence of tiers is strictly falling.
        const tiers = stair.bands.map((b) => b.tier);
        for (let k = 1; k < tiers.length; k++) expect(tiers[k]!).toBeLessThan(tiers[k - 1]!);
        // One tier per band, plus the level the last one lands on.
        expect(stair.tiers, `step ${step}`).toBe(stair.bands.length + 1);
      }
    }
  });

  it('stacks its bands on ONE strip, each inside the one above it', () => {
    for (const step of STEPS) {
      for (const stair of carve(step).stairs) {
        // The strip keeps one axis and only ever NARROWS, so each band's span across the fall line
        // stands inside its predecessor's. That is what makes the whole of it read as one figure while
        // still letting a band give up the cells a street or a doorstep reaches into.
        const acrossX = stair.bands.every((b) => b.rect.w <= stair.width);
        const acrossY = stair.bands.every((b) => b.rect.h <= stair.width);
        const spans = stair.bands.map((b) => (acrossX ? { lo: b.rect.x, hi: b.rect.x + b.rect.w - 1 }
          : { lo: b.rect.y, hi: b.rect.y + b.rect.h - 1 }));
        expect(acrossX || acrossY, `step ${step}: bands `
          + stair.bands.map((b) => `${b.rect.w}x${b.rect.h}`).join(' ')).toBe(true);
        for (let k = 1; k < spans.length; k++) {
          expect(spans[k]!.lo >= spans[k - 1]!.lo && spans[k]!.hi <= spans[k - 1]!.hi,
            `step ${step}: spans ${spans.map((s) => `${s.lo}-${s.hi}`).join(' ')}`).toBe(true);
        }
      }
    }
  });

  it('lands as ONE connected body, bands and landings and crossings together', () => {
    // A STAIR CUT AS TWO POOLS IS NOT A STAIR. On the finished map the reading that says a cascade
    // stands there is a body spanning three surface levels with a capped face, so bands that stand
    // apart with a dry terrace between them are two ordinary ponds however neatly they line up on the
    // strip. Measured without the crossing requirement: 0 of 16 stairs on `hexia` arrive as one body.
    for (const step of STEPS) {
      const { stairs, t } = carve(step);
      for (const stair of stairs) {
        expect(bodies(stair, t), `step ${step}: ${stair.bands.length} bands, ${stair.cells.length} cells`)
          .toBe(1);
      }
    }
  });

  it('cuts no band thinner than the floor: a one-row band is a line, not a tread', () => {
    for (const step of STEPS) {
      for (const stair of carve(step).stairs) {
        for (const band of stair.bands) {
          expect(Math.min(band.rect.w, band.rect.h), `step ${step} band at ${band.rect.x},${band.rect.y}`)
            .toBeGreaterThanOrEqual(BAND_DEPTH_MIN);
        }
      }
    }
  });

  it('commits with no violation: every band is capped and every landing uniform', () => {
    const reg = createDefaultRegistry();
    for (const step of STEPS) {
      const { stairs, t } = carve(step);
      expect(stairs.length, `step ${step}`).toBeGreaterThan(0);
      const violations = reg.validatePostStroke(applyPlanToScratch(t, HEXIA));
      expect(violations.map((v) => `${v.ruleId}@${v.cells?.[0]?.x},${v.cells?.[0]?.y}`).slice(0, 4),
        `step ${step}`).toEqual([]);
    }
  });

  it('leaves a foot the water story can carry on from: water at the level it reports', () => {
    for (const step of STEPS) {
      const { stairs, t } = carve(step);
      for (const stair of stairs) {
        const i = flatIndex(stair.foot.x, stair.foot.y, t.width);
        expect(t.water[i], `step ${step} foot ${stair.foot.x},${stair.foot.y}`).toBe(stair.footTier);
        expect(stair.footTier, `step ${step}`).toBeLessThan(stair.bands[0]!.tier);
      }
    }
  });

  it('never floods a cell the ground kept for something else', () => {
    const { t, grass, flat } = staircase(HEXIA);
    // A reserved band across half the island, the shape a trunk street leaves: a strip that would
    // cross it is refused and another flank is tried.
    for (let y = Math.floor(HEXIA.height / 2); y < Math.floor(HEXIA.height / 2) + 3; y++) {
      for (let x = 0; x < Math.floor(HEXIA.width / 2); x++) flat[flatIndex(x, y, HEXIA.width)] = 1;
    }
    const stairs = carveCascadeStairs({ t, grass, flat, richness: 1 });
    expect(stairs.length).toBeGreaterThan(0);
    for (let i = 0; i < t.water.length; i++) {
      if (t.water[i]! >= 0) expect(flat[i], `cell ${i % HEXIA.width},${(i / HEXIA.width) | 0}`).toBe(0);
    }
  });

  it('puts back everything a refused attempt cut', () => {
    // A one-tier island offers no stair at all, and the ground has to come back untouched: an
    // attempt that floods and fails is the whole reason the pass is transactional.
    const { t, grass, flat } = staircase(HEXIA, 1);
    const before = [...t.water];
    const stairs = carveCascadeStairs({ t, grass, flat, richness: 1 });
    expect(stairs).toEqual([]);
    expect([...t.water]).toEqual(before);
  });

  it('is deterministic, and wider at full richness than at the quiet end', () => {
    for (const step of [5, 8]) {
      const a = carve(step), b = carve(step);
      expect(a.stairs.map((s) => s.cells.length)).toEqual(b.stairs.map((s) => s.cells.length));
      expect([...a.t.water]).toEqual([...b.t.water]);
      const quiet = carve(step, 0.2);
      const wide = Math.max(0, ...a.stairs.map((s) => s.width));
      expect(wide, `step ${step}`).toBeGreaterThanOrEqual(Math.max(0, ...quiet.stairs.map((s) => s.width)));
    }
  });
});
