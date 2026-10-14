import { ANCHOR_LANDMARK, LANDMARKS, PLANET_PROFILE, landmarkSpec, type LandmarkSpec } from '../../core/game/profile';
import { planetLandmarkObject } from '../../core/model/landmarks';
import { getRotatedSize } from '../../core/grid/footprint';
import { cropPlanet, type PlanetCut } from '../../core/model/planet';
import { isTrustedPlanet, validatePlanetTemplate } from '../../core/model/planet-validate';
import { rectsOverlap } from '../../core/grid/rect';
import { type PlacedObject, type Rotation } from '../../core/model/types';
import { CellZone } from '../../core/game/zones';
import type { GroundReading } from './ground/classify';
import { GRASS, SAND } from './ground/color';
import { ScanError } from './errors';
import type { LandmarkDetection } from './ground/landmark';

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
  /** Where the anchor came from: read in the scan, or placed at the grass's centre because none was
   *  read (null when no footprint fits on the grass). Its turn is never read: it stands unturned,
   *  so `rotationInferred` holds. */
  readonly plaza: { readonly detected: boolean; readonly confidence: number; readonly rotationInferred: true } | null;
  /** The landmarks the planet editor places that the scan left off the planet, in profile order. */
  readonly unplaced: string[];
  /** The landmarks read but left off because they would widen the planet past
   *  `PLANET_PROFILE.maxChunks` chunks; they are among `unplaced`. */
  readonly tooFar: string[];
  /** The landmarks read but left off because the planet cannot hold them there: the ground under
   *  them is not the ground they stand on, or another landmark stands there; among `unplaced`. */
  readonly blocked: string[];
  /** The landmarks laid where they were read but not by their recorded structure
   *  (`LandmarkDetection.placedBy`), so their place is an estimate, in profile order. */
  readonly estimated: string[];
}

/** Footprint size of the anchor landmark `anchor` at `rotation`. */
function footprint(anchor: LandmarkSpec, rotation: Rotation): { w: number; h: number } {
  return getRotatedSize(anchor, rotation);
}

/** The top-left of the whole-cell footprint position nearest the grass's centroid whose every cell
 *  is grass, or null when none fits. */
function centralPlaza(anchor: LandmarkSpec, isGrass: Uint8Array, cols: number, rows: number): { x: number; y: number } | null {
  const { w, h } = footprint(anchor, 0);
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
 * The planet of a ground reading and the landmarks read from it. A read anchor stands where it was
 * read and the cells under it become grass; otherwise it stands at the grass's centre where its
 * footprint fits, flagged as placed. Every other landmark read stands where it was read; one reaching
 * past the ground widens the planet's frame to hold it, and one that would widen it past the largest
 * planet (`tooFar`) or that the planet cannot hold there (`blocked`) is left off. Throws `ScanError('no-ground')` without grass and
 * `ScanError('too-large')` when the land and the anchor span more chunks than a planet may.
 */
export function scannedPlanet(reading: GroundReading, read: readonly LandmarkDetection[], name = ''): ScannedPlanet {
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
  const anchor = ANCHOR_LANDMARK;
  const plaza = anchor && read.find((l) => l.id === anchor.id);
  if (plaza && anchor) {
    landmark = planetLandmarkObject(anchor, { x: plaza.x, y: plaza.y }, 0);
    const { w, h } = footprint(anchor, 0);
    for (let r = Math.max(0, Math.floor(plaza.y)); r < Math.min(rows, Math.ceil(plaza.y + h)); r++) {
      for (let c = Math.max(0, Math.floor(plaza.x)); c < Math.min(cols, Math.ceil(plaza.x + w)); c++) {
        ground[r]![c] = CellZone.Grass;
        reviewed[r * cols + c] = 0;
      }
    }
    origin = { detected: true, confidence: plaza.confidence, rotationInferred: true };
  } else if (anchor) {
    const at = centralPlaza(anchor, isGrass, cols, rows);
    if (at) {
      landmark = planetLandmarkObject(anchor, at, 0);
      origin = { detected: false, confidence: 0, rotationInferred: true };
    }
  }
  // Every other landmark read stands where it was read, on the ground under it, unless it would
  // widen the planet past the largest or the planet cannot hold it there; those are left for the
  // person to place.
  const fits = (c: PlanetCut | null) => !!c && c.frame.cols <= PLANET_PROFILE.maxChunks && c.frame.rows <= PLANET_PROFILE.maxChunks;
  const cut = (objects: readonly PlacedObject[]) => cropPlanet(ground, [...(landmark ? [landmark] : []), ...objects], () => null, name);
  const rectOf = (o: PlacedObject) => ({ x: o.position.x, y: o.position.y, w: o.width ?? 0, h: o.height ?? 0 });
  const others: PlacedObject[] = [];
  const tooFar: string[] = [];
  const blocked: string[] = [];
  for (const l of read) {
    const spec = landmarkSpec(l.id);
    if (!spec || spec.anchor) continue;
    const object = planetLandmarkObject(spec, { x: l.x, y: l.y }, 0);
    const laid = cut([...others, object]);
    const overlaps = [...(landmark ? [landmark] : []), ...others].some((o) => rectsOverlap(rectOf(o), rectOf(object)));
    if (!fits(laid)) tooFar.push(l.id);
    else if (overlaps || validatePlanetTemplate(laid!.template) !== null) blocked.push(l.id);
    else others.push(object);
  }
  const crop = cut(others);
  if (!crop) throw new ScanError('no-ground');
  const { frame } = crop;
  if (!fits(crop)) throw new ScanError('too-large');
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
  const placed = new Set(crop.template.landmarks.map((l) => l.id));
  const unplaced = LANDMARKS.filter((l) => l.editorPlaceable && !placed.has(l.id)).map((l) => l.id);
  const estimated = read.filter((l) => l.placedBy !== 'structure' && placed.has(l.id)).map((l) => l.id);
  return { ...crop, inferred, unseen, plaza: origin, unplaced, tooFar, blocked, estimated };
}
