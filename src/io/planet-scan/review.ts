import { groundUnderRim } from '../../core/model/planet';
import { isGrassZone } from '../../core/model/grid-model';
import type { GroundReading } from './classify';
import { SEA } from './colour';
import { SCAN_PROFILE } from './profile';
import { chessboardDistance } from './raster';
import type { ScannedPlanet } from './to-template';

// What the import asks the person to check, and how much of the planet the scan covered.

/**
 * The share of the land's outline that borders ground the scan saw: each side between a land cell
 * and a cell that is not land counts, and the grid's own border counts as unseen. A scan that
 * covered the whole planet and went past its coast sees all of it; a partial scan leaves the land
 * cut off where the frames stopped.
 */
export function coastCoverage(reading: GroundReading): number {
  const { cols, rows, ground } = reading;
  const known = reading.readings.known;
  let seen = 0;
  let unseen = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (ground[r * cols + c] === SEA) continue;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) {
          unseen++;
          continue;
        }
        const j = nr * cols + nc;
        if (ground[j] !== SEA) continue;
        if (known[j]) seen++;
        else unseen++;
      }
    }
  }
  return seen + unseen === 0 ? 0 : seen / (seen + unseen);
}

/** Land cells of a reading. */
export function landCells(reading: GroundReading): number {
  let n = 0;
  for (let i = 0; i < reading.ground.length; i++) if (reading.ground[i] !== SEA) n++;
  return n;
}

/**
 * The inferred cells worth a look: those within `distance` cells of the grass outline, on either
 * side, as row-major indices into the template. Inferred cells deep inside the grass (enclosed
 * builds, paving) or far out at sea are left out; the grass there is not in doubt.
 */
export function reviewCells(planet: ScannedPlanet, distance: number = SCAN_PROFILE.review.outlineDistance): number[] {
  const { width, height, zones } = planet.template;
  const ground = groundUnderRim(zones, planet.rimSand);
  const grass = new Uint8Array(width * height);
  const other = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const g = isGrassZone(ground[y]![x]!) ? 1 : 0;
      grass[y * width + x] = g;
      other[y * width + x] = 1 - g;
    }
  }
  const inside = chessboardDistance(grass, width, height);
  const outside = chessboardDistance(other, width, height);
  return planet.inferred.filter((i) => (grass[i] ? inside[i]! : outside[i]!) <= distance);
}
