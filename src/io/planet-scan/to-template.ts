import { PLANET_PROFILE } from '../../core/model/game-profile';
import { cropPlanet, planetPlazaObject, type PlanetCut } from '../../core/model/planet';
import { isTrustedPlanet } from '../../core/model/planet-validate';
import { CellZone, type PlacedObject, type Rotation } from '../../core/model/types';
import type { GroundReading } from './classify';
import { GRASS, SAND } from './colour';
import { ScanError } from './errors';
import type { PlazaDetection } from './plaza';

// The scanned ground as a planet template, built by the planet model as a drawn planet is
// (`cropPlanet`): the ground's bounding box snapped to whole chunks, the shore rim derived, the
// landmark as the plaza and the content-addressed id. The evidence grid starts on a chunk line of
// the scan's lattice, so the template's chunks are the game's.

/** A scanned planet and what the import reports about it. Cell lists are row-major indices into
 *  the template; `frame` places the template on the evidence grid. */
export interface ScannedPlanet extends PlanetCut {
  /** Cells decided by inference rather than observation, for review. */
  readonly inferred: number[];
  /** Cells of the template no frame saw. */
  readonly unseen: number[];
  /** Where the landmark came from: the paving found in the scan, or placed at the grass's centre
   *  because none was found (null when no footprint fits on the grass). Its turn is always
   *  inferred: the paving's outline cannot tell a half turn apart, so `rotationInferred` holds. */
  readonly plaza: { readonly detected: boolean; readonly confidence: number; readonly rotationInferred: true } | null;
}

/** Footprint size of the profile's landmark at `rotation`. */
function footprint(rotation: Rotation): { w: number; h: number } {
  const { width, height } = PLANET_PROFILE.landmark;
  return rotation === 90 || rotation === 270 ? { w: height, h: width } : { w: width, h: height };
}

/** The top-left of the whole-cell footprint position nearest the grass's centroid whose every cell
 *  is grass, or null when none fits. */
function centralPlaza(isGrass: Uint8Array, cols: number, rows: number): { x: number; y: number } | null {
  const { w, h } = footprint(0);
  const sum = new Int32Array((cols + 1) * (rows + 1));
  let sx = 0, sy = 0, count = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const g = isGrass[r * cols + c]!;
      sum[(r + 1) * (cols + 1) + c + 1] = g + sum[r * (cols + 1) + c + 1]! + sum[(r + 1) * (cols + 1) + c]! - sum[r * (cols + 1) + c]!;
      if (g) {
        sx += c + 0.5;
        sy += r + 0.5;
        count++;
      }
    }
  }
  if (count === 0) return null;
  const tx = sx / count - w / 2;
  const ty = sy / count - h / 2;
  let best: { x: number; y: number } | null = null;
  let bd = Infinity;
  for (let y = 0; y + h <= rows; y++) {
    for (let x = 0; x + w <= cols; x++) {
      const covered = sum[(y + h) * (cols + 1) + x + w]! - sum[y * (cols + 1) + x + w]! - sum[(y + h) * (cols + 1) + x]! + sum[y * (cols + 1) + x]!;
      if (covered !== w * h) continue;
      const d = (x - tx) ** 2 + (y - ty) ** 2;
      if (d < bd) {
        bd = d;
        best = { x, y };
      }
    }
  }
  return best;
}

/**
 * The planet of a ground reading. A detected landmark stands where it was found and the cells under
 * it become grass; otherwise it stands at the grass's centre where its footprint fits, flagged as
 * placed. Throws `ScanError('no-ground')` without grass and `ScanError('too-large')` when the land
 * spans more chunks than a planet may.
 */
export function scannedPlanet(reading: GroundReading, plaza: PlazaDetection | null, name = ''): ScannedPlanet {
  const { cols, rows } = reading;
  const isGrass = new Uint8Array(cols * rows);
  for (let i = 0; i < isGrass.length; i++) isGrass[i] = reading.ground[i] === GRASS ? 1 : 0;
  if (!isGrass.some((g) => g)) throw new ScanError('no-ground');
  const ground: CellZone[][] = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c): CellZone => {
    const g = reading.ground[r * cols + c];
    return g === GRASS ? CellZone.Grass : g === SAND ? CellZone.Beach : CellZone.Void;
  }));
  const reviewed = reading.inferred.slice();
  let landmark: PlacedObject | null = null;
  let origin: ScannedPlanet['plaza'] = null;
  if (plaza) {
    landmark = planetPlazaObject({ x: plaza.x, y: plaza.y }, plaza.rotation);
    const { w, h } = footprint(plaza.rotation);
    for (let r = Math.max(0, Math.floor(plaza.y)); r < Math.min(rows, Math.ceil(plaza.y + h)); r++) {
      for (let c = Math.max(0, Math.floor(plaza.x)); c < Math.min(cols, Math.ceil(plaza.x + w)); c++) {
        ground[r]![c] = CellZone.Grass;
        reviewed[r * cols + c] = 0;
      }
    }
    origin = { detected: true, confidence: plaza.confidence, rotationInferred: true };
  } else {
    const at = centralPlaza(isGrass, cols, rows);
    if (at) {
      landmark = planetPlazaObject(at, 0);
      origin = { detected: false, confidence: 0, rotationInferred: true };
    }
  }
  const crop = cropPlanet(ground, landmark, () => null, name);
  if (!crop) throw new ScanError('no-ground');
  const { frame } = crop;
  if (frame.cols > PLANET_PROFILE.maxChunks || frame.rows > PLANET_PROFILE.maxChunks) throw new ScanError('too-large');
  if (!isTrustedPlanet(crop.template)) throw new Error('the scanned planet does not validate');
  const { width, height } = crop.template;
  const inferred: number[] = [];
  const unseen: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const gx = frame.x0 + x;
      const gy = frame.y0 + y;
      if (gx >= cols || gy >= rows) continue;
      const i = gy * cols + gx;
      if (reviewed[i]) inferred.push(y * width + x);
      if (reading.unseen[i]) unseen.push(y * width + x);
    }
  }
  return { ...crop, inferred, unseen, plaza: origin };
}
