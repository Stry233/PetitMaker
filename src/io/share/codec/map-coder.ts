/**
 * Adaptive range-coded map representation shared by the encoder and decoder.
 * Terrain and objects are raster planes whose decoded neighbours provide model context.
 * Derivable fields, including ordinary object elevation and commonly locked corners, use stable wire predictors.
 * `MapModelOpts.half` carries the sub-cell offset needed by ramps and bridges.
 */
import {
  RangeEncoder, RangeDecoder, BitModel, TreeModel, UintModel,
  encodeTree, decodeTree, encodeUint, decodeUint, zigzag, unzigzag,
} from './bitio';
import type { CellFields } from './grid-io';
import { SHARE_CATALOG_ORDER } from './catalog-order';
import { frozenTemplateMask } from './template-mask';
import type { Corners, CornerTrim, MapTemplate } from '../../../core/model/types';
import type { SaveObject } from '../../save-format';
import { MAX_OBJECTS_PER_CELL } from '../../import-limits';

/** The encoder's inverse of `SHARE_CATALOG_ORDER[idx]`, asked once per object per pass. */
const SHARE_CATALOG_INDEX = new Map(SHARE_CATALOG_ORDER.map((id, i) => [id, i]));

/** Corner codes, in the order `grid-io` spells them. */
const CORNERS = 'SF1234E';
const CORNER_TRIM: readonly CornerTrim[] = ['square', 'fan', 'tri-NW', 'tri-NE', 'tri-SW', 'tri-SE', 'empty'];
const ROTS = [0, 90, 180, 270];

const models = <T>(n: number, make: () => T): T[] => Array.from({ length: n }, make);

class Models {
  // terrain planes
  has = models(64, () => new BitModel());
  /** Covers every two-bit decoded value, including invalid values from hostile streams. */
  type = models(25, () => new TreeModel(2));
  elevZero = models(8, () => new BitModel());
  elevDelta = new UintModel();
  cornerFree = models(4, () => new TreeModel(3));
  cornerLocked = new BitModel();
  cornerLockedVal = new TreeModel(3);
  patchOnly = models(2, () => new BitModel());
  hasPatchBase = new BitModel();
  patchBase = new TreeModel(4);
  /** Row-presence model keeps empty margins at one bit per row. */
  rowHas = models(2, () => new BitModel());
  rowOcc = models(2, () => new BitModel());
  // object plane
  occ = models(16, () => new BitModel());
  sameId = models(2, () => new BitModel());
  catalog = new TreeModel(8);
  rotZero = new BitModel();
  rot = new TreeModel(2);
  hasElev = new BitModel();
  elevIsSurface = new BitModel();
  objElev = new UintModel();
  hasSpan = new BitModel();
  span = new UintModel();
  objCorners = new BitModel();
  objCorner = models(4, () => new TreeModel(3));
  objPatch = new BitModel();
  halfOffset = new TreeModel(2);
  more = new BitModel();
}

/**
 * Stable wire predictor for square corners: a same-type edge neighbour reaching this tier pins the shared corner.
 * It is intentionally independent of editable placement rules; predictor misses remain explicit data rather than changing decode semantics.
 * The frozen predictor agrees with 99.1–100% of corpus cases and locks 91–95% of corner slots.
 */
const EDGE_NEIGHBOURS: readonly (readonly (readonly [number, number])[])[] = [
  [[-1, 0], [0, -1]], // top-left
  [[1, 0], [0, -1]],  // top-right
  [[-1, 0], [0, 1]],  // bottom-left
  [[1, 0], [0, 1]],   // bottom-right
];
const WATER = 2;

/** The mass a cell contributes: a patch is a cosmetic fillet standing on whatever was there. */
const structuralTop = (f: CellFields) => (f.patchOnly ? f.patchBase ?? f.elevation - 1 : f.elevation);

/** Does this cell hold solid mass of `type` at tier `e`? Water fills from 0, mountain from 1. */
function solidAt(f: CellFields | null, type: number, e: number): boolean {
  if (!f || f.type !== type) return false;
  const top = structuralTop(f);
  return type === WATER ? e >= 0 && e <= top : e >= 1 && e <= top;
}

function lockedCorners(
  cells: (CellFields | null)[], width: number, height: number, x: number, y: number,
): [boolean, boolean, boolean, boolean] {
  const at = (px: number, py: number) =>
    (px < 0 || py < 0 || px >= width || py >= height ? null : cells[py * width + px] ?? null);
  const c = at(x, y);
  if (!c) return [false, false, false, false];
  const e = structuralTop(c);
  return EDGE_NEIGHBOURS.map((pair) =>
    pair.some(([dx, dy]) => solidAt(at(x + dx, y + dy), c.type, e))) as [boolean, boolean, boolean, boolean];
}

/** Context for a cell's occupancy bit: which of the already-decoded neighbours carry terrain. */
const hasCtx = (w: unknown, n: unknown, nw: unknown, ne: unknown, par: number) =>
  (w ? 1 : 0) | (n ? 2 : 0) | (nw ? 4 : 0) | (ne ? 8 : 0) | (par << 4);

/**
 * Frame-indexed model variants. `templateMask` names a frozen buildable-coordinate mask revision.
 * Variant indices are append-only wire identities.
 */
export interface MapModelOpts { parity: boolean; half: boolean; templateMask?: 1 }
export const MODEL_VARIANTS: readonly MapModelOpts[] = [
  { parity: false, half: false },
  { parity: true, half: false },
  { parity: false, half: true },
  { parity: true, half: true },
  { parity: false, half: false, templateMask: 1 },
  { parity: true, half: false, templateMask: 1 },
  { parity: false, half: true, templateMask: 1 },
  { parity: true, half: true, templateMask: 1 },
];

function codedCell(mask: Readonly<Uint8Array> | null, index: number): boolean {
  return !mask || mask[index] === 1;
}

function codedRow(mask: Readonly<Uint8Array> | null, y: number, width: number): boolean {
  if (!mask) return true;
  const start = y * width;
  for (let index = start; index < start + width; index++) {
    if (mask[index] === 1) return true;
  }
  return false;
}

/** Whether a model can omit its masked coordinates without losing map data. */
export function modelCanRepresent(
  template: MapTemplate,
  cells: readonly (CellFields | null)[],
  objects: readonly SaveObject[],
  opts: MapModelOpts,
): boolean {
  if (!opts.templateMask) return true;
  const mask = frozenTemplateMask(template, opts.templateMask);
  if (!mask) return false;
  for (let index = 0; index < cells.length; index++) {
    if (cells[index] && mask[index] !== 1) return false;
  }
  return objects.every((object) => {
    const index = Math.floor(object.y) * template.width + Math.floor(object.x);
    return mask[index] === 1;
  });
}

/** Does any object stand off the whole-cell grid? Decides which half of MODEL_VARIANTS applies. */
export const hasHalfPosition = (objects: readonly SaveObject[]): boolean =>
  objects.some((o) => !Number.isInteger(o.x) || !Number.isInteger(o.y));

/** The sub-cell offset of an anchor: bit 0 = half a cell along x, bit 1 = along y, 0 = whole. */
function halfOffsetOf(o: SaveObject): number {
  const off = (v: number) => {
    const f = v - Math.floor(v);
    if (f === 0) return 0;
    if (f === 0.5) return 1;
    throw new Error(`map-coder: position ${v} is off the half grid`);
  };
  return off(o.x) | (off(o.y) << 1);
}

interface Neighbourhood { w: CellFields | null; n: CellFields | null; nw: CellFields | null; ne: CellFields | null }

function around(cells: (CellFields | null)[], i: number, width: number): Neighbourhood {
  const x = i % width;
  return {
    w: x > 0 ? cells[i - 1] ?? null : null,
    n: i >= width ? cells[i - width] ?? null : null,
    nw: x > 0 && i >= width ? cells[i - width - 1] ?? null : null,
    ne: x < width - 1 && i >= width ? cells[i - width + 1] ?? null : null,
  };
}

/** Elevation the neighbours imply: terraces mean the west cell is usually right. */
const predictElev = ({ w, n }: Neighbourhood) => w?.elevation ?? n?.elevation ?? 1;
const elevCtx = ({ w, n }: Neighbourhood) =>
  (w ? 1 : 0) | (n ? 2 : 0) | (w && n && w.elevation === n.elevation ? 4 : 0);
const typeCtx = ({ w, n }: Neighbourhood) => (w ? w.type + 1 : 0) * 5 + (n ? n.type + 1 : 0);

/** The four corner codes of a cell, or null when every one is square. */
function cornersOf(f: CellFields): string | null { return f.corners; }

export function encodeMap(
  enc: RangeEncoder, template: MapTemplate, cells: (CellFields | null)[], objects: SaveObject[],
  opts: MapModelOpts = { parity: false, half: false },
): void {
  if (!modelCanRepresent(template, cells, objects, opts)) {
    throw new Error('map-coder: template mask would omit map data');
  }
  const M = new Models();
  const width = template.width;
  const n = cells.length;
  const mask = opts.templateMask ? frozenTemplateMask(template, opts.templateMask)! : null;
  const par = (i: number, y: number) => (opts.parity ? ((i % width) & 1) | ((y & 1) << 1) : 0);

  // ── terrain: shape, then type, then height, then the cosmetic fields ──
  let prevRow = 0;
  for (let y = 0; y < template.height; y++) {
    if (!codedRow(mask, y, width)) continue;
    const rowUsed = rowHasTerrain(cells, y, width) ? 1 : 0;
    enc.encodeBit(M.rowHas[prevRow]!, rowUsed);
    prevRow = rowUsed;
    if (!rowUsed) continue;
    for (let i = y * width; i < (y + 1) * width; i++) {
      if (!codedCell(mask, i)) continue;
      const nb = around(cells, i, width);
      const c = cells[i] ?? null;
      enc.encodeBit(M.has[hasCtx(nb.w, nb.n, nb.nw, nb.ne, par(i, y))]!, c ? 1 : 0);
      if (!c) continue;
      encodeTree(enc, M.type[typeCtx(nb)]!, c.type);
      const d = c.elevation - predictElev(nb);
      enc.encodeBit(M.elevZero[elevCtx(nb)]!, d !== 0 ? 1 : 0);
      if (d !== 0) encodeUint(enc, M.elevDelta, zigzag(d));
      enc.encodeBit(M.patchOnly[nb.w?.patchOnly ? 1 : 0]!, c.patchOnly ? 1 : 0);
      if (c.patchOnly) {
        enc.encodeBit(M.hasPatchBase, c.patchBase != null ? 1 : 0);
        if (c.patchBase != null) encodeTree(enc, M.patchBase, c.patchBase);
      }
    }
  }

  // ── corners, against the silhouette the reader now shares ──
  for (let i = 0; i < n; i++) {
    const c = cells[i] ?? null;
    if (!c) continue;
    const locked = lockedCorners(cells, width, template.height, i % width, Math.floor(i / width));
    const code = cornersOf(c);
    for (let k = 0; k < 4; k++) {
      const v = CORNERS.indexOf(code?.[k] ?? 'S');
      if (locked[k]) {
        // The geometry says square. A cut here is a state the silhouette cannot explain, so it is
        // spelled out; the model drives the cost of saying "as derived" to near nothing.
        enc.encodeBit(M.cornerLocked, v === 0 ? 0 : 1);
        if (v !== 0) encodeTree(enc, M.cornerLockedVal, v);
      } else {
        encodeTree(enc, M.cornerFree[k]!, v);
      }
    }
  }

  // ── objects: an image of what stands where ──
  const anchor = new Map<number, SaveObject[]>();
  for (const o of objects) {
    const k = Math.floor(o.y) * width + Math.floor(o.x);
    const list = anchor.get(k);
    if (list) list.push(o); else anchor.set(k, [o]);
  }
  const idAt = (i: number) => anchor.get(i)?.[0]?.catalogId ?? null;
  let prevOccRow = 0;
  for (let y = 0; y < template.height; y++) {
    if (!codedRow(mask, y, width)) continue;
    const rowUsed = rowHasObject(anchor, y, width) ? 1 : 0;
    enc.encodeBit(M.rowOcc[prevOccRow]!, rowUsed);
    prevOccRow = rowUsed;
    if (!rowUsed) continue;
    for (let i = y * width; i < (y + 1) * width; i++) {
      if (!codedCell(mask, i)) continue;
      const x = i % width;
      const here = anchor.get(i);
      enc.encodeBit(M.occ[occCtx(anchor, i, x, width)]!, here ? 1 : 0);
      if (!here) continue;
      const ctxId = (x > 0 ? idAt(i - 1) : null) ?? idAt(i - width) ?? (x > 0 ? idAt(i - width - 1) : null);
      const surface = cells[i]?.elevation ?? 0;
      for (let j = 0; j < here.length; j++) {
        const o = here[j]!;
        const idx = SHARE_CATALOG_INDEX.get(o.catalogId) ?? -1;
        if (idx < 0) throw new Error(`map-coder: unknown catalogId ${o.catalogId}`);
        if (ctxId !== null) {
          const same = o.catalogId === ctxId ? 1 : 0;
          enc.encodeBit(M.sameId[j === 0 ? 0 : 1]!, same);
          if (!same) encodeTree(enc, M.catalog, idx);
        } else encodeTree(enc, M.catalog, idx);
        const half = halfOffsetOf(o);
        if (opts.half) encodeTree(enc, M.halfOffset, half);
        else if (half !== 0) throw new Error('map-coder: half position under a whole-cell shape');
        enc.encodeBit(M.rotZero, o.rotation !== 0 ? 1 : 0);
        if (o.rotation !== 0) encodeTree(enc, M.rot, ROTS.indexOf(o.rotation));
        enc.encodeBit(M.hasElev, o.elevation !== undefined ? 1 : 0);
        if (o.elevation !== undefined) {
          const onSurface = o.elevation === surface ? 0 : 1;
          enc.encodeBit(M.elevIsSurface, onSurface);
          if (onSurface) encodeUint(enc, M.objElev, o.elevation);
        }
        enc.encodeBit(M.hasSpan, o.spanLength !== undefined ? 1 : 0);
        if (o.spanLength !== undefined) encodeUint(enc, M.span, o.spanLength);
        enc.encodeBit(M.objCorners, o.corners !== undefined ? 1 : 0);
        if (o.corners !== undefined) {
          for (let k = 0; k < 4; k++) encodeTree(enc, M.objCorner[k]!, CORNERS.indexOf(o.corners[k]!));
        }
        enc.encodeBit(M.objPatch, o.patchOnly ? 1 : 0);
        enc.encodeBit(M.more, j < here.length - 1 ? 1 : 0);
      }
    }
  }
}

const rowHasTerrain = (cells: (CellFields | null)[], y: number, width: number): boolean => {
  for (let i = y * width; i < (y + 1) * width; i++) if (cells[i]) return true;
  return false;
};
const rowHasObject = (anchor: Map<number, unknown>, y: number, width: number): boolean => {
  for (let i = y * width; i < (y + 1) * width; i++) if (anchor.has(i)) return true;
  return false;
};

function occCtx(anchor: Map<number, unknown>, i: number, x: number, width: number): number {
  return (x > 0 && anchor.has(i - 1) ? 1 : 0)
    | (anchor.has(i - width) ? 2 : 0)
    | (x > 0 && anchor.has(i - width - 1) ? 4 : 0)
    | (x < width - 1 && anchor.has(i - width + 1) ? 8 : 0);
}

export function decodeMap(
  dec: RangeDecoder, template: MapTemplate, opts: MapModelOpts = { parity: false, half: false },
): { cells: (CellFields | null)[]; objects: SaveObject[] } {
  const M = new Models();
  const width = template.width;
  const n = template.width * template.height;
  const mask = opts.templateMask ? frozenTemplateMask(template, opts.templateMask) : null;
  if (opts.templateMask && !mask) throw new Error('map-coder: template mask is unavailable');
  const par = (i: number, y: number) => (opts.parity ? ((i % width) & 1) | ((y & 1) << 1) : 0);
  const cells: (CellFields | null)[] = new Array(n).fill(null);

  let prevRow = 0;
  for (let y = 0; y < template.height; y++) {
    if (!codedRow(mask, y, width)) continue;
    const rowUsed = dec.decodeBit(M.rowHas[prevRow]!);
    prevRow = rowUsed;
    if (!rowUsed) continue;
    for (let i = y * width; i < (y + 1) * width; i++) {
      if (!codedCell(mask, i)) continue;
      const nb = around(cells, i, width);
      if (dec.decodeBit(M.has[hasCtx(nb.w, nb.n, nb.nw, nb.ne, par(i, y))]!) === 0) continue;
      const type = decodeTree(dec, M.type[typeCtx(nb)]!);
      let elevation = predictElev(nb);
      if (dec.decodeBit(M.elevZero[elevCtx(nb)]!) === 1) elevation += unzigzag(decodeUint(dec, M.elevDelta));
      const patchOnly = dec.decodeBit(M.patchOnly[nb.w?.patchOnly ? 1 : 0]!) === 1;
      let patchBase: number | null = null;
      if (patchOnly && dec.decodeBit(M.hasPatchBase) === 1) patchBase = decodeTree(dec, M.patchBase);
      cells[i] = { type, elevation, corners: null, patchOnly, patchBase };
    }
  }

  for (let i = 0; i < n; i++) {
    const c = cells[i];
    if (!c) continue;
    const locked = lockedCorners(cells, width, template.height, i % width, Math.floor(i / width));
    let code = '';
    for (let k = 0; k < 4; k++) {
      let v: number;
      if (locked[k]) v = dec.decodeBit(M.cornerLocked) === 0 ? 0 : decodeTree(dec, M.cornerLockedVal);
      else v = decodeTree(dec, M.cornerFree[k]!);
      code += CORNERS[v] ?? 'S';
    }
    c.corners = code === 'SSSS' ? null : code;
  }

  const objects: SaveObject[] = [];
  const anchor = new Map<number, SaveObject[]>();
  const idAt = (i: number) => anchor.get(i)?.[0]?.catalogId ?? null;
  let prevOccRow = 0;
  for (let y = 0; y < template.height; y++) {
    if (!codedRow(mask, y, width)) continue;
    const rowUsed = dec.decodeBit(M.rowOcc[prevOccRow]!);
    prevOccRow = rowUsed;
    if (!rowUsed) continue;
    for (let i = y * width; i < (y + 1) * width; i++) {
      if (!codedCell(mask, i)) continue;
      const x = i % width;
      if (dec.decodeBit(M.occ[occCtx(anchor, i, x, width)]!) === 0) continue;
      const ctxId = (x > 0 ? idAt(i - 1) : null) ?? idAt(i - width) ?? (x > 0 ? idAt(i - width - 1) : null);
      const surface = cells[i]?.elevation ?? 0;
      const here: SaveObject[] = [];
      anchor.set(i, here);
      for (let j = 0; ; j++) {
        if (j >= MAX_OBJECTS_PER_CELL) throw new Error('map-coder: implausible objects on one cell');
        let catalogId: string;
        if (ctxId !== null && dec.decodeBit(M.sameId[j === 0 ? 0 : 1]!) === 1) catalogId = ctxId;
        else {
          const idx = decodeTree(dec, M.catalog);
          const id = SHARE_CATALOG_ORDER[idx];
          if (id === undefined) throw new Error('map-coder: catalog index out of range');
          catalogId = id;
        }
        const half = opts.half ? decodeTree(dec, M.halfOffset) : 0;
        const rotation = dec.decodeBit(M.rotZero) === 1 ? ROTS[decodeTree(dec, M.rot)]! : 0;
        const o: SaveObject = {
          id: 'o?', catalogId,
          x: x + (half & 1 ? 0.5 : 0),
          y: Math.floor(i / width) + (half & 2 ? 0.5 : 0),
          rotation,
        };
        if (dec.decodeBit(M.hasElev) === 1) {
          o.elevation = dec.decodeBit(M.elevIsSurface) === 0 ? surface : decodeUint(dec, M.objElev);
        }
        if (dec.decodeBit(M.hasSpan) === 1) o.spanLength = decodeUint(dec, M.span);
        if (dec.decodeBit(M.objCorners) === 1) {
          let cs = '';
          for (let k = 0; k < 4; k++) cs += CORNERS[decodeTree(dec, M.objCorner[k]!)] ?? 'S';
          o.corners = cs;
        }
        if (dec.decodeBit(M.objPatch) === 1) o.patchOnly = true;
        here.push(o);
        objects.push(o);
        if (dec.decodeBit(M.more) === 0) break;
      }
    }
  }
  return { cells, objects };
}

/** The trim codes as the model layer spells them, for callers rebuilding a TerrainCell. */
export const cornerTrimOf = (code: string): Corners =>
  [...code].map((ch) => CORNER_TRIM[CORNERS.indexOf(ch)] ?? 'square') as unknown as Corners;
