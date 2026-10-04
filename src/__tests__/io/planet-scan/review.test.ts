import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE } from '../../../core/model/game-profile';
import type { GroundReading } from '../../../io/planet-scan/classify';
import { GRASS, SAND, SEA } from '../../../io/planet-scan/colour';
import { SCAN_PROFILE } from '../../../io/planet-scan/profile';
import { coastCoverage, landCells, reviewCells } from '../../../io/planet-scan/review';
import { scannedPlanet } from '../../../io/planet-scan/to-template';

const N = 4 * CHUNK_SIZE;
/** The island: grass on [16, 48) squared, a cell of sand around it. */
const isGrass = (c: number, r: number) => c >= 16 && c < 48 && r >= 16 && r < 48;
const isSand = (c: number, r: number) => !isGrass(c, r) && c >= 15 && c < 49 && r >= 15 && r < 49;

function reading(options: { seen?: (c: number, r: number) => boolean; inferred?: readonly [number, number][] } = {}): GroundReading {
  const seen = options.seen ?? (() => true);
  const ground = new Uint8Array(N * N);
  const known = new Uint8Array(N * N);
  const inferred = new Uint8Array(N * N);
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const i = r * N + c;
      known[i] = seen(c, r) ? 1 : 0;
      ground[i] = !known[i] ? SEA : isGrass(c, r) ? GRASS : isSand(c, r) ? SAND : SEA;
    }
  }
  for (const [c, r] of options.inferred ?? []) inferred[r * N + c] = 1;
  return { cols: N, rows: N, ground, inferred, unseen: new Uint8Array(N * N), readings: { known } } as unknown as GroundReading;
}

describe('coast coverage', () => {
  it('is whole when the scan went past the coast all round', () => {
    expect(coastCoverage(reading())).toBe(1);
  });

  it('drops with the share of the coast a partial scan cut off', () => {
    const half = coastCoverage(reading({ seen: (c) => c < 32 }));
    expect(half).toBeGreaterThan(0.6);
    expect(half).toBeLessThan(0.85);
    expect(half).toBeLessThan(SCAN_PROFILE.import.fullCoast);
  });

  it('counts the land', () => {
    expect(landCells(reading())).toBe(34 * 34);
  });
});

describe('cells to check', () => {
  it('keeps the inferred cells near the grass outline and leaves the interior out', () => {
    const near: [number, number][] = [[16, 30], [17, 30], [47, 20], [14, 30], [49, 40]];
    const deep: [number, number][] = [[30, 30], [32, 25], [20, 40]];
    const planet = scannedPlanet(reading({ inferred: [...near, ...deep] }), null);
    const { width } = planet.template;
    const kept = reviewCells(planet).map((i) => [(i % width) + planet.frame.x0, Math.floor(i / width) + planet.frame.y0]);
    expect(planet.inferred).toHaveLength(near.length + deep.length);
    expect(kept.sort()).toEqual([...near].sort());
  });
});
