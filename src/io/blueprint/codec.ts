/** Writes and reads blueprint files; reading treats the text as untrusted and admits every number. */
import { TerrainType, type Corners } from '../../core/model/types';
import { BLUEPRINT_MAX_SIDE, type BlueprintBody, type BlueprintCell, type BlueprintObject } from '../../tools/blueprint';
import { MAX_IMPORT_BYTES, MAX_OBJECTS_PER_CELL } from '../save/limits';
import { clampText } from '../../core/base/text';
import { ID_MAX_LENGTH, isRecord, isValidId } from '../../core/base/guards';
import { isValidCorners, isValidElevation, isValidRotation } from '../save/admission';
import {
  BLUEPRINT_FILE_FORMAT, BLUEPRINT_FILE_MAX_RECORDS, BLUEPRINT_FILE_VERSION, BLUEPRINT_NAME_MAX,
  BLUEPRINT_THUMB_MAX_CHARS, builtInFolderOf, type BlueprintFileError, type BlueprintRecord, type BlueprintTextPart,
} from './format';

type Json = Record<string, unknown>;

/** Thrown inside admission; the entry point turns it into `'malformed'`. */
class Malformed extends Error {}
const bad = (): never => { throw new Malformed(); };

const intIn = (v: unknown, lo: number, hi: number): number => (typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : bad());
const halfStepIn = (v: unknown, lo: number, hi: number): number => (typeof v === 'number' && Number.isInteger(v * 2) && v >= lo && v <= hi ? v : bad());

const clampName = (v: unknown): string | null => clampText(v, BLUEPRINT_NAME_MAX);

const PARTS: readonly BlueprintTextPart[] = ['name', 'author', 'folder'];

const admitCorners = (v: unknown): Corners => (isValidCorners(v) ? [...v] as Corners : bad());
const admitElevation = (v: unknown): number => (isValidElevation(v) ? v : bad());

function admitCell(v: unknown): BlueprintCell | null {
  if (v === null) return null;
  if (!isRecord(v)) return bad();
  const type = v.type === TerrainType.Mountain || v.type === TerrainType.Water ? (v.type as TerrainType) : bad();
  const cell: { -readonly [K in keyof BlueprintCell]: BlueprintCell[K] } = { type, rise: admitElevation(v.rise) };
  if (v.corners !== undefined) cell.corners = admitCorners(v.corners);
  if (v.patchOnly === true) cell.patchOnly = true;
  else if (v.patchOnly !== undefined && v.patchOnly !== false) bad();
  if (v.patchBase !== undefined) cell.patchBase = admitElevation(v.patchBase);
  return cell;
}

function admitObject(v: unknown, w: number, h: number): BlueprintObject {
  if (!isRecord(v) || typeof v.catalogId !== 'string' || v.catalogId.length === 0 || v.catalogId.length > ID_MAX_LENGTH) return bad();
  if (!isValidRotation(v.rotation)) return bad();
  const out: { -readonly [K in keyof BlueprintObject]: BlueprintObject[K] } = {
    catalogId: v.catalogId,
    x: halfStepIn(v.x, -1, w),
    y: halfStepIn(v.y, -1, h),
    rotation: v.rotation,
    rise: admitElevation(v.rise),
  };
  if (v.spanLength !== undefined) out.spanLength = intIn(v.spanLength, 1, 2 * BLUEPRINT_MAX_SIDE);
  if (v.corners !== undefined) out.corners = admitCorners(v.corners);
  return out;
}

function admitBody(v: unknown): BlueprintBody {
  if (!isRecord(v)) return bad();
  const w = intIn(v.w, 1, BLUEPRINT_MAX_SIDE);
  const h = intIn(v.h, 1, BLUEPRINT_MAX_SIDE);
  // The frame rests on (w + 1) * (h + 1) terrain cells.
  if (!Array.isArray(v.cells) || v.cells.length !== (w + 1) * (h + 1)) return bad();
  if (!Array.isArray(v.objects) || v.objects.length > w * h * MAX_OBJECTS_PER_CELL) return bad();
  return { w, h, cells: v.cells.map(admitCell), objects: v.objects.map((o) => admitObject(o, w, h)) };
}

/** A body as a blueprint file holds it, admitted by the file's rules, or null when it fails them. */
export function admitBlueprintBody(v: unknown): BlueprintBody | null {
  try {
    return admitBody(v);
  } catch (e) {
    if (e instanceof Malformed) return null;
    throw e;
  }
}

/** A missing or invalid thumbnail reads as empty so the record still opens; an import replaces a
 *  file's thumbnails with the app's own drawing (`editor/editing/blueprint/import-file.ts:importBlueprintFile`). */
const admitThumb = (v: unknown): string => (typeof v === 'string' && v.length <= BLUEPRINT_THUMB_MAX_CHARS && /^data:image\/[a-z0-9.+-]+[;,]/i.test(v) ? v : '');

function admitRecord(v: unknown): BlueprintRecord {
  if (!isRecord(v)) return bad();
  if (!isValidId(v.id)) return bad();
  const name = clampName(v.name) ?? bad();
  if (typeof v.savedAt !== 'number' || !Number.isFinite(v.savedAt) || v.savedAt < 0) return bad();
  const thumbs = isRecord(v.thumbs) ? v.thumbs : {};
  return {
    id: v.id,
    name,
    folder: clampName(v.folder),
    author: clampName(v.author),
    origin: clampName(v.origin),
    savedAt: v.savedAt,
    appVersion: typeof v.appVersion === 'string' ? v.appVersion.slice(0, 40) : '',
    body: admitBody(v.body),
    thumbs: { flat: admitThumb(thumbs.flat), lifted: admitThumb(thumbs.lifted) },
  };
}

/** One stored or received record admitted by the same rules as a file's, or null when it fails them;
 *  it keeps the marks only the library writes: the texts waiting for review, the app's own name and
 *  the app's own folders. */
export function admitBlueprintRecord(v: unknown): BlueprintRecord | null {
  try {
    const r = admitRecord(v);
    const json = v as Json;
    const held = Array.isArray(json.unreviewed) ? PARTS.filter((p) => (json.unreviewed as unknown[]).includes(p)) : [];
    return {
      ...r,
      ...(typeof json.folder === 'string' && builtInFolderOf(json.folder) ? { folder: json.folder } : {}),
      ...(held.length > 0 ? { unreviewed: held } : {}),
      ...(json.appName === true ? { appName: true as const } : {}),
    };
  } catch (e) {
    if (e instanceof Malformed) return null;
    throw e;
  }
}

function recordJson(r: BlueprintRecord): Json {
  return {
    id: r.id, name: r.name, folder: r.folder, author: r.author, origin: r.origin, savedAt: r.savedAt,
    appVersion: r.appVersion, body: r.body, thumbs: r.thumbs,
  };
}

/** A file of `records`, each naming the folder it lands in. */
export function encodeBlueprints(records: readonly BlueprintRecord[]): string {
  return JSON.stringify({ format: BLUEPRINT_FILE_FORMAT, version: BLUEPRINT_FILE_VERSION, records: records.map(recordJson) });
}

/** What a blueprint file holds: its records, each `folder` the folder the file names for it, which a
 *  version 1 file names once for all its records; and where one naming none lands, the folder open as a
 *  version 1 file was dropped, else its author's folder. */
interface BlueprintFile { readonly records: BlueprintRecord[]; readonly unfiled: 'open-folder' | 'author-folder' }

/** Reads a blueprint file; never throws. Records naming unknown catalog items are kept, since
 *  placement skips what it does not know. */
export function decodeBlueprints(text: string): BlueprintFile | { error: BlueprintFileError } {
  if (text.length > MAX_IMPORT_BYTES) return { error: 'malformed' };
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { error: 'not-blueprint' }; }
  if (!isRecord(raw) || raw.format !== BLUEPRINT_FILE_FORMAT) return { error: 'not-blueprint' };
  if (typeof raw.version !== 'number' || !Number.isInteger(raw.version) || raw.version < 1) return { error: 'malformed' };
  if (raw.version > BLUEPRINT_FILE_VERSION) return { error: 'too-new' };
  try {
    if (!Array.isArray(raw.records) || raw.records.length > BLUEPRINT_FILE_MAX_RECORDS) return { error: 'malformed' };
    const records = raw.records.map(admitRecord);
    if (raw.version > 1) return { records, unfiled: 'author-folder' };
    const folder = clampName(raw.folder);
    return { records: records.map((r) => ({ ...r, folder })), unfiled: 'open-folder' };
  } catch (e) {
    if (e instanceof Malformed) return { error: 'malformed' };
    throw e;
  }
}
