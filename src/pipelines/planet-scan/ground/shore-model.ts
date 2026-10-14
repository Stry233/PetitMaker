import { distanceField } from '../../../core/base/fields';
import type { CellEvidence } from './evidence';
import { SCAN_PROFILE } from '../profile';
import { blur, sampleBilinear } from './raster';
import weights from './shore-weights.json';

// The shore classifier: land or sea for a cell near the coast, from its neighbourhood of the sea
// vote and the signed distance to the observed coast, its foam animation and its colour. The game
// draws the beach as a smooth, shaded outline with animated foam, which no fixed offset from the
// observed sand edge reproduces. The model is a gradient-boosted tree ensemble trained on the
// reference recordings against their templates; shore-weights.json is its source of truth and
// names the features in order.
//
// Feature names: `psea<dx>,<dy>` is the blurred sea vote and `sd<dx>,<dy>` the signed distance in
// cells (positive on land) at the cell centre offset by (dx, dy) cells; `anim`, `sat`, `L`, `a`,
// `b` and `tstdL` are the centre's still-run deviation, saturation, L*a*b* and lightness temporal
// deviation. Beyond the evidence a sea vote reads 1 and a distance -5.

interface Tree {
  readonly feature: Int16Array;
  readonly threshold: Float64Array;
  readonly left: Int32Array;
  readonly right: Int32Array;
  readonly missingLeft: Uint8Array;
  readonly value: Float64Array;
}

/** Land probability of feature vectors. */
export interface ShoreModel {
  readonly features: readonly string[];
  predict(features: Float64Array): number;
}

interface WeightsFile {
  readonly features: readonly string[];
  readonly baseline: number;
  readonly trees: readonly {
    readonly feature: readonly number[];
    readonly threshold: readonly number[];
    readonly left: readonly number[];
    readonly right: readonly number[];
    readonly missingLeft: readonly number[];
    readonly value: readonly number[];
  }[];
}

/** The ensemble of a weights file: the logistic of the baseline plus one leaf per tree. */
export function shoreModel(file: WeightsFile): ShoreModel {
  const trees: Tree[] = file.trees.map((t) => ({
    feature: Int16Array.from(t.feature),
    threshold: Float64Array.from(t.threshold),
    left: Int32Array.from(t.left),
    right: Int32Array.from(t.right),
    missingLeft: Uint8Array.from(t.missingLeft),
    value: Float64Array.from(t.value),
  }));
  return {
    features: file.features,
    predict(x) {
      let raw = file.baseline;
      for (const t of trees) {
        let n = 0;
        for (let f = t.feature[0]!; f >= 0; f = t.feature[n]!) {
          const v = x[f]!;
          n = (Number.isNaN(v) ? t.missingLeft[n] === 1 : v <= t.threshold[n]!) ? t.left[n]! : t.right[n]!;
        }
        raw += t.value[n]!;
      }
      return 1 / (1 + Math.exp(-raw));
    },
  };
}

/** The shipped shore classifier. */
export const SHORE_MODEL: ShoreModel = shoreModel(weights as WeightsFile);

/** The coast rasters on the evidence's sample points: the blurred sea vote and the signed distance
 *  in cells to its 0.5 level, positive on land. */
export interface CoastRasters {
  readonly sea: Float32Array;
  readonly distance: Float32Array;
}

export function coastRasters(ev: CellEvidence): CoastRasters {
  const { width, height } = ev.points;
  const G = SCAN_PROFILE.ground;
  const cell = SCAN_PROFILE.cell;
  const sea = blur(ev.points.sea, { w: width, h: height }, { sx: (G.seaBlur * ev.sub) / cell.width, sy: (G.seaBlur * ev.sub) / cell.height });
  const land = new Uint8Array(width * height);
  const water = new Uint8Array(width * height);
  for (let i = 0; i < land.length; i++) {
    const isLand = sea[i]! < G.vote;
    land[i] = isLand ? 1 : 0;
    water[i] = isLand ? 0 : 1;
  }
  const toWater = distanceField(water, width, height);
  const toLand = distanceField(land, width, height);
  const distance = new Float32Array(width * height);
  for (let i = 0; i < distance.length; i++) distance[i] = (toWater[i]! - toLand[i]!) / ev.sub;
  return { sea, distance };
}

/** Value of a sample-point raster at a cell's centre offset by (dx, dy) cells. */
export function atCell(
  plane: Float32Array, ev: CellEvidence, cell: { col: number; row: number }, shift: { dx: number; dy: number }, outside: number,
): number {
  const s = ev.sub;
  const { col, row } = cell, { dx, dy } = shift;
  const sampled = { data: plane, width: ev.points.width, height: ev.points.height };
  return sampleBilinear(sampled, (col + 0.5 + dx) * s - 0.5, (row + 0.5 + dy) * s - 0.5, outside);
}

type Feature = (ev: CellEvidence, coast: CoastRasters, cell: number, col: number, row: number) => number;

const OFFSET = /^(psea|sd)(-?[\d.]+),(-?[\d.]+)$/;

function featureOf(name: string): Feature {
  const m = OFFSET.exec(name);
  if (m) {
    const dx = Number(m[2]);
    const dy = Number(m[3]);
    return m[1] === 'psea'
      ? (ev, coast, _c, col, row) => atCell(coast.sea, ev, { col, row }, { dx, dy }, 1)
      : (ev, coast, _c, col, row) => atCell(coast.distance, ev, { col, row }, { dx, dy }, -5);
  }
  switch (name) {
    case 'anim': return (ev, _k, c) => ev.animation[c]!;
    case 'sat': return (ev, _k, c) => ev.saturation[c]!;
    case 'L': return (ev, _k, c) => ev.lab.l[c]!;
    case 'a': return (ev, _k, c) => ev.lab.a[c]!;
    case 'b': return (ev, _k, c) => ev.lab.b[c]!;
    case 'tstdL': return (ev, _k, c) => ev.lightnessDeviation[c]!;
    default: throw new Error(`unknown shore feature ${name}`);
  }
}

/** The model's feature rows of the listed cells (grid indices), one row of `model.features.length`
 *  values per cell. */
export function shoreFeatures(ev: CellEvidence, coast: CoastRasters, cells: ArrayLike<number>, model: ShoreModel = SHORE_MODEL): Float64Array {
  const features = model.features.map(featureOf);
  const f = features.length;
  const x = new Float64Array(cells.length * f);
  const cols = ev.grid.cols;
  for (let k = 0; k < cells.length; k++) {
    const c = cells[k]!;
    const col = c % cols;
    const row = (c - col) / cols;
    for (let j = 0; j < f; j++) x[k * f + j] = features[j]!(ev, coast, c, col, row);
  }
  return x;
}

/** Land probabilities of the listed cells (grid indices) by `model`. */
export function shoreLand(ev: CellEvidence, coast: CoastRasters, cells: ArrayLike<number>, model: ShoreModel = SHORE_MODEL): Float32Array {
  const f = model.features.length;
  const x = shoreFeatures(ev, coast, cells, model);
  const out = new Float32Array(cells.length);
  for (let k = 0; k < cells.length; k++) out[k] = model.predict(x.subarray(k * f, (k + 1) * f));
  return out;
}
