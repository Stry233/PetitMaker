import {
  type GridState,
  type MacroCell,
  type MacroCoord,
  type MapTemplate,
  type PlacedObject,
  type TerrainCell,
  type CornerTrim,
  type Corners,
  CellZone,
  TerrainType,
} from '../core/model/types';
import {
  ANNOTATION_COLORS, generateAnnotationId,
  type AnnotationsState, type MapAnnotation, isTagId,
} from '../core/model/annotations';
import type { CurveAnchor } from '../core/model/spline';
import { cellKey, createGrid, createPlazaObject, onHalfGrid } from '../core/model/grid-model';
import { generateObjectId } from '../core/model/object-id';
import { PLAZA_ID } from '../core/model/constants';
import { isCoating } from '../core/model/traits';
import { isValidTerrainType, isValidRotation, isValidElevation } from './import-validate';
import { currentCatalogId } from './legacy-catalog';
import { getCatalogItem } from '../state/catalog';
import { hasHalfStep, objectRect } from '../state/object-geometry';
import {
  CURRENT_VERSION,
  migrateToCurrent,
  type RawSave,
  type SaveFile,
  type SaveObject,
  type PersistedCamera,
} from './save-format';
import { serializeProvenance, deserializeProvenance, markLegacyUnknown } from '../core/provenance/serialize';

/* Save files are migrated to the schema in ./save-format/types before decoding. */

const CORNER_ENCODE: Record<string, string> = {
  square: 'S', fan: 'F', 'tri-NW': '1', 'tri-NE': '2', 'tri-SW': '3', 'tri-SE': '4', empty: 'E',
};

const CORNER_DECODE: Record<string, CornerTrim> = {
  S: 'square', F: 'fan', T: 'tri-NW', '1': 'tri-NW', '2': 'tri-NE', '3': 'tri-SW', '4': 'tri-SE', E: 'empty',
};

/** Encodes corners as a four-character suffix, omitting the all-square default. */
export function encodeCorners(corners: Corners): string | undefined {
  const suffix = corners.map((c: CornerTrim) => CORNER_ENCODE[c] ?? 'S').join('');
  return suffix === 'SSSS' ? undefined : suffix;
}

/** Decodes a four-character corner suffix, treating unknown characters as square. */
export function decodeCorners(suffix: string): Corners {
  return [0, 1, 2, 3].map((i) => CORNER_DECODE[suffix[i]!] ?? 'square') as Corners;
}

export function terrainToken(t: TerrainCell): string {
  let token = `t${t.type}:${t.elevation}`;
  if (t.corners) {
    const suffix = encodeCorners(t.corners);
    if (suffix) token += ':' + suffix;
    if (t.patchOnly) token += ':P';
  } else if (t.patchOnly) {
    token += '::P';
  }
  // Patch-only terrain stores its support tier in `:B{n}`; an absent tier falls back to elevation - 1.
  if (t.patchOnly && t.patchBase !== undefined) token += ':B' + t.patchBase;
  return token;
}

function cellToToken(cell: MacroCell): string {
  if (!cell.terrain) return '_';
  return terrainToken(cell.terrain);
}

export function rleEncode(tokens: string[]): string {
  if (tokens.length === 0) return '';
  const runs: string[] = [];
  let current = tokens[0]!;
  let count = 1;
  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i] === current) {
      count++;
    } else {
      runs.push(count > 1 ? `${count}*${current}` : current);
      current = tokens[i]!;
      count = 1;
    }
  }
  runs.push(count > 1 ? `${count}*${current}` : current);
  return runs.join(',');
}

/** Decodes comma-separated RLE while bounding expansion from untrusted run counts. */
export function rleDecode(rle: string, maxTokens?: number): string[] {
  if (rle === '') return [];
  const tokens: string[] = [];
  for (const part of rle.split(',')) {
    const starIdx = part.indexOf('*');
    if (starIdx > 0) {
      const count = Number(part.slice(0, starIdx));
      if (!Number.isInteger(count) || count <= 0) throw new Error('Invalid cell data: bad RLE run count.');
      if (maxTokens !== undefined && tokens.length + count > maxTokens) {
        throw new Error('Invalid cell data: more cells than the map template holds.');
      }
      const token = part.slice(starIdx + 1);
      for (let i = 0; i < count; i++) tokens.push(token);
    } else {
      if (maxTokens !== undefined && tokens.length >= maxTokens) {
        throw new Error('Invalid cell data: more cells than the map template holds.');
      }
      tokens.push(part);
    }
  }
  return tokens;
}

/** Parses one terrain token and rejects malformed or out-of-range values. */
export function parseTerrain(s: string): TerrainCell | null {
  const parts = s.slice(1).split(':');
  const type = Number(parts[0]) as TerrainType;
  const elevation = Number(parts[1]);
  if (!isValidTerrainType(type)) return null;
  if (!isValidElevation(elevation)) return null;
  const cell: TerrainCell = { type, elevation };
  if (parts[2] && parts[2] !== 'P') {
    cell.corners = decodeCorners(parts[2]);
  }
  if (parts.includes('P')) cell.patchOnly = true;
  const bPart = parts.find((p) => /^B\d+$/.test(p));
  if (bPart) {
    const base = Number(bPart.slice(1));
    if (!isValidElevation(base)) return null;
    cell.patchBase = base;
  }
  return cell;
}

function tokenToCell(token: string, zone: CellZone): MacroCell {
  if (token === '_') {
    return { zone, terrain: null };
  }

  let terrain: TerrainCell | null = null;

  for (const part of token.split('+')) {
    if (part.startsWith('t')) {
      terrain = parseTerrain(part);
    }
    // Obsolete corner (`c`) and road (`r`) tokens are accepted but ignored.
  }

  return { zone, terrain };
}

/** Serializes map state with optional camera session data supplied by the caller. */
export function serialize(state: GridState, camera?: PersistedCamera): string {
  const { template, cells, objects } = state;

  const tokens: string[] = [];
  for (let y = 0; y < template.height; y++) {
    const row = cells[y];
    if (!row) continue;
    for (let x = 0; x < template.width; x++) {
      const cell = row[x];
      tokens.push(cell ? cellToToken(cell) : '_');
    }
  }

  const objectList: SaveObject[] = [];
  for (const obj of objects.values()) {
    if (obj.locked) continue; // immutable structures (the plaza) are recreated from the template on load
    const saved: SaveObject = {
      id: obj.id,
      catalogId: obj.catalogId,
      x: obj.position.x,
      y: obj.position.y,
      rotation: obj.rotation,
      elevation: obj.elevation,
    };
    if (obj.spanLength !== undefined) saved.spanLength = obj.spanLength;
    if (obj.corners) {
      const suffix = encodeCorners(obj.corners);
      if (suffix) saved.corners = suffix;
    }
    if (obj.patchOnly) saved.patchOnly = true;
    objectList.push(saved);
  }

  const saveFile: SaveFile = {
    version: CURRENT_VERSION,
    templateId: template.id,
    cells: rleEncode(tokens),
    objects: objectList,
    metadata: { savedAt: new Date().toISOString() },
    ...(state.provenance ? { provenance: serializeProvenance(state.provenance) } : {}),
    // Project notes are omitted when empty and are not part of the canonical share payload.
    ...(state.notes && (state.notes.title || state.notes.description || state.notes.author)
      ? { notes: state.notes }
      : {}),
    // An empty annotation layer has no persisted visibility or lock state.
    ...(state.annotations && state.annotations.items.length > 0 ? { annotations: state.annotations } : {}),
    ...(camera && (camera.view2d || camera.view3d) ? { camera } : {}),
  };

  return JSON.stringify(saveFile);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Reads valid 2D and 3D camera fields independently without rejecting the map. */
export function readSaveCamera(json: string): PersistedCamera | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (!raw || typeof raw !== 'object' || !('camera' in raw)) return undefined;
  const cam = (raw as { camera?: unknown }).camera;
  if (!cam || typeof cam !== 'object') return undefined;
  const { view2d, view3d } = cam as { view2d?: unknown; view3d?: unknown };
  const result: PersistedCamera = {};
  if (view2d && typeof view2d === 'object') {
    const { x, y, zoom } = view2d as { x?: unknown; y?: unknown; zoom?: unknown };
    if (isFiniteNumber(x) && isFiniteNumber(y) && isFiniteNumber(zoom)) result.view2d = { x, y, zoom };
  }
  if (view3d && typeof view3d === 'object') {
    const { az, el, dist, tx, tz } = view3d as { az?: unknown; el?: unknown; dist?: unknown; tx?: unknown; tz?: unknown };
    if (isFiniteNumber(az) && isFiniteNumber(el) && isFiniteNumber(dist)) {
      result.view3d = {
        az, el, dist,
        ...(isFiniteNumber(tx) ? { tx } : {}),
        ...(isFiniteNumber(tz) ? { tz } : {}),
      };
    }
  }
  return result.view2d || result.view3d ? result : undefined;
}

/**
 * Finds coatings fully covered by later coatings. A coating that still owns any cell survives,
 * so partial overlaps preserve both objects. Catalog traits define which objects are coatings.
 */
export function stackedCoatingIds(objects: Iterable<PlacedObject>): Set<string> {
  const owner = new Map<string, string>();
  const coatings: PlacedObject[] = [];
  for (const obj of objects) {
    const item = getCatalogItem(obj.catalogId);
    if (!item || !isCoating(item)) continue;
    coatings.push(obj);
    const { x, y, w, h } = objectRect(obj);
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) owner.set(cellKey(Math.floor(x) + dx, Math.floor(y) + dy), obj.id);
    }
  }
  const drop = new Set<string>();
  for (const obj of coatings) {
    const { x, y, w, h } = objectRect(obj);
    let owns = false;
    for (let dy = 0; dy < h && !owns; dy++) {
      for (let dx = 0; dx < w && !owns; dx++) {
        owns = owner.get(cellKey(Math.floor(x) + dx, Math.floor(y) + dy)) === obj.id;
      }
    }
    if (!owns) drop.add(obj.id);
  }
  return drop;
}

export function deserialize(json: string, template: MapTemplate): GridState {
  // Migration rejects unsupported future versions and inputs without a migration path.
  const save = migrateToCurrent(JSON.parse(json) as RawSave) as unknown as SaveFile;
  // Row-major cell data is meaningful only for its declared template dimensions.
  if (save.templateId && save.templateId !== template.id) {
    throw new Error(`Save was made for map template "${save.templateId}", not "${template.id}".`);
  }
  const area = template.width * template.height;
  const tokens = rleDecode(save.cells, area);
  if (tokens.length !== area) {
    throw new Error('Invalid cell data: the save does not cover the map template.');
  }
  const cells = createGrid(template);

  let idx = 0;
  for (let y = 0; y < template.height; y++) {
    const row = cells[y];
    if (!row) continue;
    for (let x = 0; x < template.width; x++) {
      const token = tokens[idx++];
      // Plaza terrain comes from its immutable template object, not saved cell tokens.
      if (token && (template.zones[y]?.[x] ?? CellZone.Grass) !== CellZone.Plaza) {
        row[x] = tokenToCell(token, row[x]?.zone ?? CellZone.Grass);
      }
    }
  }

  const objects = new Map<string, PlacedObject>();
  // Provenance keys follow object IDs that are replaced during validation.
  const reIdedObjects = new Map<string, string>();
  for (const obj of save.objects) {
    if (obj.id === PLAZA_ID) continue; // recreated fresh from the template below
    // Exact catalog-ID aliases preserve renamed items; unknown IDs are discarded below.
    const catalogId = currentCatalogId(obj.catalogId);
    // Catalog IDs can enter model context, so imports accept only registered values.
    const item = getCatalogItem(catalogId);
    if (!item) continue;
    // Half-step items accept integer or half-integer anchors; other items require integers.
    const onGrid = (v: number) => (hasHalfStep(item) ? onHalfGrid(v) : Number.isInteger(v));
    if (!onGrid(obj.x) || !onGrid(obj.y)
      || obj.x < 0 || obj.y < 0 || obj.x >= template.width || obj.y >= template.height) continue;
    if (!isValidRotation(obj.rotation)) continue;
    if (obj.elevation !== undefined && !isValidElevation(obj.elevation)) continue;
    if (obj.spanLength !== undefined
      && (!Number.isInteger(obj.spanLength) || obj.spanLength < 1 || obj.spanLength > Math.max(template.width, template.height))) continue;
    // Object IDs can enter model context; replace values outside the app's emitted alphabet.
    const id = /^[A-Za-z0-9_-]{1,64}$/.test(obj.id) ? obj.id : generateObjectId();
    if (id !== obj.id && typeof obj.id === 'string') reIdedObjects.set(obj.id, id);
    const placed: PlacedObject = {
      id,
      catalogId,
      position: { x: obj.x, y: obj.y },
      rotation: obj.rotation as 0 | 90 | 180 | 270,
      elevation: obj.elevation ?? 0,
    };
    if (obj.spanLength !== undefined) placed.spanLength = obj.spanLength;
    if (obj.corners) {
      placed.corners = decodeCorners(obj.corners);
    }
    if (obj.patchOnly) placed.patchOnly = true;
    objects.set(id, placed);
  }

  // Fully covered coatings are invisible duplicates and must not consume load or payload space.
  for (const id of stackedCoatingIds(objects.values())) objects.delete(id);

  const plaza = createPlazaObject(template);
  if (plaza) objects.set(plaza.id, plaza);

  const result: GridState = {
    template,
    cells,
    objects,
    lockedLayers: new Set(),
  };
  if (save.provenance) {
    result.provenance = deserializeProvenance(save.provenance, template.width, template.height);
    // Keep provenance aligned with replaced and discarded object IDs.
    const taint = result.provenance.objectTaint;
    for (const [oldId, newId] of reIdedObjects) {
      const t = taint.get(oldId);
      if (t) { taint.delete(oldId); taint.set(newId, t); }
    }
    for (const id of [...taint.keys()]) {
      if (!objects.has(id)) taint.delete(id);
    }
  } else {
    markLegacyUnknown(result); // legacy / pre-provenance map → existing content is Unknown
  }
  // Notes are untrusted; coerce them to strings and enforce persisted length limits.
  if (save.notes && typeof save.notes === 'object') {
    result.notes = {
      ...(save.notes.title ? { title: String(save.notes.title).slice(0, 80) } : {}),
      ...(save.notes.description ? { description: String(save.notes.description).slice(0, 400) } : {}),
      ...(save.notes.author ? { author: String(save.notes.author).slice(0, 80) } : {}),
    };
  }
  const annotations = decodeAnnotations(save.annotations);
  if (annotations) result.annotations = annotations;
  return result;
}

/* Invalid annotations are discarded; collection, text and coordinate limits bound imported data. */
const ANNOT_MAX_ITEMS = 500;
const ANNOT_MAX_CELLS = 5000;
const ANNOT_MAX_POINTS = 200;
const ANNOT_MAX_COORD = 1024;
const HEX_COLOR = /^#[0-9a-fA-F]{3,8}$/;

function finiteCoord(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= ANNOT_MAX_COORD ? v : null;
}

export function decodeAnnotations(raw: unknown): AnnotationsState | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as { items?: unknown; visible?: unknown; locked?: unknown };
  if (!Array.isArray(r.items)) return undefined;
  const items: MapAnnotation[] = [];
  for (const entry of r.items.slice(0, ANNOT_MAX_ITEMS)) {
    const note = decodeAnnotation(entry);
    if (note) items.push(note);
  }
  if (items.length === 0) return undefined;
  return { items, visible: r.visible !== false, locked: r.locked === true };
}

function decodeAnnotation(raw: unknown): MapAnnotation | null {
  if (!raw || typeof raw !== 'object') return null;
  const n = raw as Record<string, unknown>;
  const id = typeof n.id === 'string' && n.id ? n.id.slice(0, 40) : generateAnnotationId();
  const color = typeof n.color === 'string' && HEX_COLOR.test(n.color) ? n.color : ANNOTATION_COLORS[0]!;
  if (n.kind === 'zone') {
    if (!Array.isArray(n.cells)) return null;
    const cells: MacroCoord[] = [];
    for (const c of n.cells.slice(0, ANNOT_MAX_CELLS)) {
      const x = finiteCoord((c as MacroCoord)?.x);
      const y = finiteCoord((c as MacroCoord)?.y);
      if (x === null || y === null || !Number.isInteger(x) || !Number.isInteger(y)) continue;
      cells.push({ x, y });
    }
    if (cells.length === 0) return null;
    const num = typeof n.num === 'number' && Number.isInteger(n.num) && n.num > 0 && n.num < 10000 ? n.num : 0;
    // A zone from before tags arrives untagged; its free-text name is not carried.
    return {
      kind: 'zone', id, cells, color, tag: isTagId(n.tag) ? n.tag : null, num,
      size: n.size === 's' || n.size === 'l' ? n.size : 'm',
    };
  }
  // Free-text notes from before tags are dropped: nothing on the layer holds typed words.
  if (n.kind === 'chip') {
    const x = finiteCoord(n.x);
    const y = finiteCoord(n.y);
    if (x === null || y === null || !isTagId(n.tag)) return null;
    return { kind: 'chip', id, x, y, tag: n.tag, size: n.size === 's' || n.size === 'l' ? n.size : 'm', color };
  }
  if (n.kind === 'route') {
    if (!Array.isArray(n.points)) return null;
    const points: CurveAnchor[] = [];
    // Direction handles are bounded offsets and each side is valid only as an x/y pair.
    const handle = (v: unknown): number | null =>
      typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 64 ? v : null;
    for (const c of n.points.slice(0, ANNOT_MAX_POINTS)) {
      const a = c as CurveAnchor;
      const x = finiteCoord(a?.x);
      const y = finiteCoord(a?.y);
      if (x === null || y === null) continue;
      const pt: CurveAnchor = { x, y };
      const hx = handle(a?.hx), hy = handle(a?.hy);
      if (hx !== null && hy !== null) { pt.hx = hx; pt.hy = hy; }
      const ihx = handle(a?.ihx), ihy = handle(a?.ihy);
      if (ihx !== null && ihy !== null) { pt.ihx = ihx; pt.ihy = ihy; }
      points.push(pt);
    }
    if (points.length < 2) return null;
    return { kind: 'route', id, points, color, dashed: n.dashed !== false };
  }
  return null;
}
