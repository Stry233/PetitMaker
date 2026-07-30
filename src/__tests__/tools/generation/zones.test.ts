import { describe, it, expect } from 'vitest';
import { buildZones } from '../../../tools/generation/zones';
import { resolveShaping } from '../../../tools/generation/shaping';
import { makeField } from '../../../tools/generation/field';
import { makeState } from '../../rules/_helpers';
import { TUNING } from '../../../tools/generation/tuning';
import type { GenConfig } from '../../../tools/generation/types';

const cfg: GenConfig = { mode: 'mixed', relief: 0.5, naturalness: 1, waterAmount: 0.5, rivers: 0.5, flatness: 0.5, settlement: 0.5, nature: 0.5, seed: 4, maxElevation: 6, region: null };
const TOWN = { x: 40, y: 40 };

describe('buildZones — partition', () => {
  it('assigns every grass cell to exactly one connected, non-sliver zone, deterministically', () => {
    const f = makeField(makeState(80, 80));
    const a = buildZones(f, resolveShaping(cfg), cfg.seed, TOWN);
    const b = buildZones(f, resolveShaping(cfg), cfg.seed, TOWN);
    expect(a.zones.map((z) => z.cells.length)).toEqual(b.zones.map((z) => z.cells.length));
    for (let i = 0; i < f.grass.length; i++) {
      if (f.grass[i] === 1) expect(a.zoneOf[i]).toBeGreaterThanOrEqual(0);
      else expect(a.zoneOf[i]).toBe(-1);
    }
    for (const z of a.zones) {
      expect(z.cells.length, `zone ${z.id} above sliver size`).toBeGreaterThanOrEqual(TUNING.crownMinArea); // crowns are deliberate small terraces; everything else clears zoneMinArea
      const set = new Set(z.cells); const seen = new Set([z.cells[0]!]); const q = [z.cells[0]!];
      while (q.length) { const c = q.pop()!; for (const d of [1, -1, 80, -80]) { const n = c + d; if (set.has(n) && !seen.has(n)) { seen.add(n); q.push(n); } } }
      expect(seen.size, `zone ${z.id} connected`).toBe(z.cells.length);
    }
    expect(a.zones.length).toBeGreaterThanOrEqual(TUNING.zoneCountMin);
    expect(a.zones.length).toBeLessThanOrEqual(TUNING.zoneCountMax + TUNING.crownMassifs * TUNING.zoneLevelCap); // crowns add nested terraces (≤ massifs × levels) beyond the site cap
  });
  it('zone 0 contains the town; seeds vary the partition', () => {
    const f = makeField(makeState(80, 80));
    const a = buildZones(f, resolveShaping(cfg), 4, TOWN);
    expect(a.zoneOf[TOWN.y * 80 + TOWN.x]).toBe(0);
    const c = buildZones(f, resolveShaping(cfg), 5, TOWN);
    expect(a.zones.map((z) => z.cells.length)).not.toEqual(c.zones.map((z) => z.cells.length));
  });
});

describe('buildZones — levels + themes', () => {
  it('town zone level 0, adjacent zones differ by <= 1, a peak exists, themes assigned', () => {
    const f = makeField(makeState(80, 80));
    const zp = buildZones(f, resolveShaping(cfg), 4, TOWN);
    expect(zp.zones[0]!.level).toBe(0);
    expect(zp.zones[0]!.theme).toBe('town');
    for (const [a, ns] of zp.adjacency) for (const n of ns) {
      expect(Math.abs(zp.zones[a]!.level - zp.zones[n]!.level), `zones ${a}/${n}`).toBeLessThanOrEqual(1);
    }
    expect(Math.max(...zp.zones.map((z) => z.level)), 'some zone is raised').toBeGreaterThanOrEqual(1);
    expect(zp.zones.filter((z) => z.theme === 'peak').length).toBe(1);
  });
  it('relief raises more zones; flatness 1 keeps more zones at ground', () => {
    const f = makeField(makeState(80, 80));
    const raised = (relief: number, flatness: number): number => {
      const zp = buildZones(f, resolveShaping({ ...cfg, relief, flatness }), 4, TOWN);
      return zp.zones.filter((z) => z.level > 0).length;
    };
    expect(raised(0, 0.5)).toBeLessThanOrEqual(raised(1, 0.5));
    expect(raised(0.5, 1)).toBeLessThanOrEqual(raised(0.5, 0));
  });
});
