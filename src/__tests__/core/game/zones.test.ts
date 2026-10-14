import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SRC, sourceFiles, srcRelative } from '../../_support/source-graph';
import { CellZone, ELEVATION_MAX, PALETTE, ZONE_ID_BITS, ZONES } from '../../../core/game/profile';
import {
  OFF_MAP_ZONE, RIM_ZONE, SAND_ZONE,
  groundZone, isBuildableZone, isCellZone, isGrassZone, isGroundZone, isLandZone, isOpenSeaZone, isRimZone, isSandZone, isSeaZone,
} from '../../../core/game/zones';
import { zoneSurface } from '../../../view/map3d/geometry/coords';

const ALL = Object.keys(ZONES).map(Number) as CellZone[];
const COMPARES_ZONE = /[=!]==\s*CellZone\.|CellZone\.\w+\s*[=!]==/;

describe('the zone table', () => {
  it('keeps every zone id within the bits the share codec packs', () => {
    expect(ALL.every((z) => Number.isInteger(z) && z >= 0 && z < 1 << ZONE_ID_BITS)).toBe(true);
  });

  it('names one off-map zone, one rim zone and one sand a rim keeps', () => {
    expect([OFF_MAP_ZONE, RIM_ZONE, SAND_ZONE]).toEqual([CellZone.Void, CellZone.Boundary, CellZone.Beach]);
    expect(ALL.filter(isSandZone)).toEqual([CellZone.Beach]);
    expect(isSandZone(undefined)).toBe(false);
  });

  it('answers each predicate from the zone traits', () => {
    const row = (z: CellZone) => [isBuildableZone(z), isLandZone(z), isGrassZone(z), isSeaZone(z), isOpenSeaZone(z), isRimZone(z), isGroundZone(z)];
    expect(row(CellZone.Void)).toEqual([false, false, false, true, true, false, true]);
    expect(row(CellZone.Beach)).toEqual([false, true, false, false, false, false, true]);
    expect(row(CellZone.Grass)).toEqual([true, true, true, false, false, false, true]);
    expect(row(CellZone.Boundary)).toEqual([false, false, false, true, false, true, false]);
  });

  it('draws the shore rim as land in 3D and in its own sand colour in 2D', () => {
    expect(zoneSurface(CellZone.Boundary)).toBe('land');
    expect(ZONES[CellZone.Boundary].color).toBe('#f7c68c');
    expect(zoneSurface(CellZone.Void)).toBe('sea');
  });

  it('reads a rim cell as the ground under it, and as open sea when it keeps none', () => {
    expect(groundZone({ zone: CellZone.Boundary, under: CellZone.Beach })).toBe(CellZone.Beach);
    expect(groundZone({ zone: CellZone.Boundary })).toBe(CellZone.Void);
    expect(groundZone({ zone: CellZone.Grass })).toBe(CellZone.Grass);
  });

  it('names a zone only for a listed whole id', () => {
    expect(ALL.every(isCellZone)).toBe(true);
    for (const v of [-1, 1.5, 8, Number.NaN, '2', undefined]) expect(isCellZone(v)).toBe(false);
    expect(isBuildableZone(undefined)).toBe(false);
  });
});

describe('shared code outside the game profile', () => {
  it('asks a zone trait and never compares a zone id', () => {
    const offenders: string[] = [];
    for (const folder of ['rules', 'tools', 'view', 'editor', 'agent']) {
      for (const file of sourceFiles(join(SRC, folder))) {
        readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
          if (COMPARES_ZONE.test(line)) offenders.push(`${srcRelative(file)}:${i + 1}`);
        });
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('the palette', () => {
  it('colours the ground and every mountain layer', () => {
    expect(PALETTE.elevation).toHaveLength(ELEVATION_MAX + 1);
  });
});
