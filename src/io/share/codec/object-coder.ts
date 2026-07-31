// src/io/share/codec/object-coder.ts — object-list residual coder. The decoder reconstructs the
// EXACT canonical list: predicted minus deletions plus additions, re-sorted by the canonical
// objKey and re-id'd o0.. . An object's category is not transmitted at all: `catalogId` already
// determines it, so the reader derives it from the catalog when it needs it.
import { RangeEncoder, RangeDecoder, BitModel, TreeModel, UintModel, encodeTree, decodeTree, encodeUint, decodeUint, zigzag, unzigzag } from './bitio';
import { objKey } from '../canonical';
import { getAllItems, getCatalogItem } from '../../../state/catalog';
import type { SaveObject } from '../../save-format';

const CORNERS = 'SF1234E';
const ROTS = [0, 90, 180, 270];
let CATALOG_IDS: string[] | null = null;
function catalogIds(): string[] {
  if (!CATALOG_IDS) {
    CATALOG_IDS = getAllItems().map((it) => it.id).sort();
    if (CATALOG_IDS.length > 128) throw new Error('object-coder: catalog exceeds 7-bit index');
  }
  return CATALOG_IDS;
}

class Models {
  delCount = new UintModel(); delGap = new UintModel();
  addCount = new UintModel();
  catalog = new TreeModel(7);
  dx = new UintModel(); dy = new UintModel();
  rot = new TreeModel(2);
  hasElev = new BitModel(); elev = new UintModel();
  hasSpan = new BitModel(); span = new UintModel();
  hasCorners = new BitModel(); corner = [new TreeModel(3), new TreeModel(3), new TreeModel(3), new TreeModel(3)];
  patchOnly = new BitModel();
}

function keySet(objs: SaveObject[]): Map<string, number> {
  const m = new Map<string, number>();
  objs.forEach((o, i) => m.set(objKey(o), i));
  return m;
}
function normalize(objs: SaveObject[]): SaveObject[] {
  return [...objs].sort((a, b) => { const ka = objKey(a), kb = objKey(b); return ka < kb ? -1 : ka > kb ? 1 : 0; })
    .map((o, i) => {
      const out: SaveObject = { id: `o${i}`, catalogId: o.catalogId, x: o.x, y: o.y, rotation: o.rotation };
      if (o.elevation !== undefined) out.elevation = o.elevation;
      if (o.spanLength !== undefined) out.spanLength = o.spanLength;
      if (o.corners !== undefined) out.corners = o.corners;
      if (o.patchOnly) out.patchOnly = true;
      return out;
    });
}

/** Encoder precondition: every object's `catalogId` must resolve in the live catalog — an
 *  unknown id has no index in `catalogIds()` (`indexOf` returns -1), which would silently encode
 *  garbage into the catalog TreeModel. Throws rather than mis-encoding; the payload layer falls
 *  back to a non-residual path on this. */
function assertNormalized(objects: SaveObject[]): void {
  for (const o of objects) {
    if (!getCatalogItem(o.catalogId)) {
      throw new Error('object-coder: unknown catalogId ' + o.catalogId);
    }
  }
}

export function encodeObjects(enc: RangeEncoder, objects: SaveObject[], predicted: SaveObject[]): void {
  assertNormalized(objects);
  const M = new Models();
  const objKeys = keySet(objects);
  const deletions: number[] = [];
  predicted.forEach((p, i) => { if (!objKeys.has(objKey(p))) deletions.push(i); });
  const predKeys = keySet(predicted);
  const additions = objects.filter((o) => !predKeys.has(objKey(o)));

  encodeUint(enc, M.delCount, deletions.length);
  let prev = -1;
  for (const d of deletions) { encodeUint(enc, M.delGap, d - prev - 1); prev = d; }

  encodeUint(enc, M.addCount, additions.length);
  let px = 0, py = 0;
  for (const o of additions) {
    encodeTree(enc, M.catalog, catalogIds().indexOf(o.catalogId));
    encodeUint(enc, M.dx, zigzag(o.x - px)); encodeUint(enc, M.dy, zigzag(o.y - py));
    px = o.x; py = o.y;
    encodeTree(enc, M.rot, ROTS.indexOf(o.rotation));
    enc.encodeBit(M.hasElev, o.elevation !== undefined ? 1 : 0);
    if (o.elevation !== undefined) encodeUint(enc, M.elev, o.elevation);
    enc.encodeBit(M.hasSpan, o.spanLength !== undefined ? 1 : 0);
    if (o.spanLength !== undefined) encodeUint(enc, M.span, o.spanLength);
    enc.encodeBit(M.hasCorners, o.corners !== undefined ? 1 : 0);
    if (o.corners !== undefined) for (let k = 0; k < 4; k++) encodeTree(enc, M.corner[k]!, CORNERS.indexOf(o.corners[k]!));
    enc.encodeBit(M.patchOnly, o.patchOnly ? 1 : 0);
  }
}

export function decodeObjects(dec: RangeDecoder, predicted: SaveObject[]): SaveObject[] {
  const M = new Models();
  const MAX_LIST = 50_000; // real maps bounded by game's load budget (~few thousand objects); guards hostile payloads
  const delCount = decodeUint(dec, M.delCount);
  if (delCount > MAX_LIST) throw new Error('object-coder: implausible list count');
  const dropped = new Set<number>();
  let prev = -1;
  for (let i = 0; i < delCount; i++) { prev = prev + 1 + decodeUint(dec, M.delGap); dropped.add(prev); }
  const kept = predicted.filter((_, i) => !dropped.has(i));

  const addCount = decodeUint(dec, M.addCount);
  if (addCount > MAX_LIST) throw new Error('object-coder: implausible list count');
  const added: SaveObject[] = [];
  let px = 0, py = 0;
  for (let i = 0; i < addCount; i++) {
    const catalogId = catalogIds()[decodeTree(dec, M.catalog)]!;
    px += unzigzag(decodeUint(dec, M.dx)); py += unzigzag(decodeUint(dec, M.dy));
    const rotation = ROTS[decodeTree(dec, M.rot)]!;
    const o: SaveObject = { id: 'o?', catalogId, x: px, y: py, rotation };
    if (dec.decodeBit(M.hasElev) === 1) o.elevation = decodeUint(dec, M.elev);
    if (dec.decodeBit(M.hasSpan) === 1) o.spanLength = decodeUint(dec, M.span);
    if (dec.decodeBit(M.hasCorners) === 1) {
      let cs = '';
      for (let k = 0; k < 4; k++) cs += CORNERS[decodeTree(dec, M.corner[k]!)]!;
      o.corners = cs;
    }
    if (dec.decodeBit(M.patchOnly) === 1) o.patchOnly = true;
    added.push(o);
  }
  return normalize([...kept, ...added]);
}
