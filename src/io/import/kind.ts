/**
 * What an imported file is, decided once for every import surface: a map (a share image or a map
 * save, whatever `file.ts:inspectImportFile` reads), a planet file, a blueprint file, a recorded game video,
 * or none of these. Videos are told by their first bytes, with the type and extension as a
 * fallback; JSON is told apart by its `format` field. Kinds this edition cannot import read as
 * `unknown`, so the offline edition keeps refusing planet files and videos as it always has.
 */
import { SUPPORTS_JSON_FILES, SUPPORTS_VIDEO_IMPORT } from '../../platform/build/edition';
import { MAX_IMPORT_BYTES } from '../save/limits';
import { PLANET_FILE_FORMAT } from '../save/planet-codec';
import { BLUEPRINT_FILE_FORMAT } from '../blueprint/format';
import { ISO_FIRST_BOXES, opensEbml } from '../../pipelines/planet-scan/facts';
import { readBlob } from './read-blob';

export type ImportKind = 'map' | 'planet' | 'blueprint' | 'video' | 'unknown';
/** `classifyImportFile`'s decision with a map told apart as a JSON save or a share image. */
type ImportSource = 'map-save' | 'map-image' | 'planet' | 'blueprint' | 'video' | 'unknown';

/** The recording containers the video picker offers by name as well as by type: macOS greys out
 *  files whose type it does not map to `video/*`, Matroska among them. */
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.m4v', '.mkv', '.webm'] as const;
export const VIDEO_ACCEPT = ['video/*', ...VIDEO_EXTENSIONS].join(',');
/** The pictures a map picker offers. */
const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp';
/** What a JSON file picker offers, by name as well as by type. */
export const JSON_ACCEPT = '.json,application/json';
/** What the map picker offers: map images, then map and planet files where JSON is read, then game
 *  videos where they are read, so a picked one reaches its own window. */
export const IMPORT_ACCEPT = [
  IMAGE_ACCEPT,
  ...(SUPPORTS_JSON_FILES ? [JSON_ACCEPT] : []),
  ...(SUPPORTS_VIDEO_IMPORT ? [VIDEO_ACCEPT] : []),
].join(',');

/** `ftyp` major brands of still images (HEIF, AVIF), which share the video container's layout. */
const IMAGE_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'mif1', 'msf1', 'avif', 'avis']);

/** Bytes read from the start of a file to tell its container. */
const HEAD_BYTES = 16;

function isJsonFile(file: Blob, name: string): boolean {
  return name.toLowerCase().endsWith('.json') || file.type === 'application/json';
}

/** Some drag sources omit MIME types, so supported extensions are also accepted. */
function isImageFile(file: Blob, name: string): boolean {
  if (file.type.startsWith('image/')) return true;
  return /\.(png|jpe?g|webp)$/i.test(name);
}

/** Whether the video picker would offer `file`: a video type, or a recording container's extension. */
export function acceptsVideo(file: File): boolean {
  return namesVideo(file, file.name);
}

function namesVideo(file: Blob, name: string): boolean {
  const lower = name.toLowerCase();
  return file.type.startsWith('video/') || VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

const ascii = (bytes: Uint8Array, from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));

/** Whether `head` opens a Matroska, WebM, MP4 or QuickTime file. */
function sniffVideo(head: Uint8Array): boolean {
  if (opensEbml(head)) return true;
  if (head.length < 8 || !ISO_FIRST_BOXES.has(ascii(head, 4, 8))) return false;
  return ascii(head, 4, 8) !== 'ftyp' || head.length < 12 || !IMAGE_BRANDS.has(ascii(head, 8, 12));
}

/** Whether `head` opens a JSON object, after an optional byte order mark and white space. */
function opensJson(head: Uint8Array): boolean {
  let k = head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf ? 3 : 0;
  while (k < head.length && (head[k] === 0x20 || head[k] === 0x09 || head[k] === 0x0a || head[k] === 0x0d)) k += 1;
  return head[k] === 0x7b;
}

async function readHead(file: Blob): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await readBlob(file.slice(0, HEAD_BYTES), 'bytes'));
  } catch {
    return null; // a source that cannot be sliced is told by its name and type alone
  }
}

/** Whether `text` is a JSON object whose `format` is `format`. */
function hasFormat(text: string, format: string): boolean {
  if (!text.includes(format)) return false;
  try {
    const parsed = JSON.parse(text) as { format?: unknown } | null;
    return parsed?.format === format;
  } catch {
    return false;
  }
}

/** What `file` is; never throws. `name` is the file's own name where `file` is a bare Blob. */
export async function classifyImportFile(file: File | Blob, name = file instanceof File ? file.name : ''): Promise<ImportKind> {
  return (await classifyImport(file, name)).kind;
}

/** `classifyImportFile`'s one decision, keeping which reader a map goes to and the text read to
 *  reach it, which that reader takes rather than reading the file again. */
export interface ClassifiedImport {
  kind: ImportKind;
  source: ImportSource;
  /** The whole file as text, where a JSON file was read to tell it; null where it was not read. */
  text: string | null;
}

const classified = (source: ImportSource, text: string | null = null): ClassifiedImport => ({
  kind: source === 'map-save' || source === 'map-image' ? 'map' : source, source, text,
});

/** What `file` is with what was read of it; never throws. */
export async function classifyImport(file: File | Blob, name = file instanceof File ? file.name : ''): Promise<ClassifiedImport> {
  const head = SUPPORTS_VIDEO_IMPORT || SUPPORTS_JSON_FILES ? await readHead(file) : null;
  if (SUPPORTS_VIDEO_IMPORT && head && sniffVideo(head)) return classified('video');
  const json = isJsonFile(file, name) || (head !== null && opensJson(head));
  if (SUPPORTS_JSON_FILES && json) {
    let text: string | null = null;
    if (!(file.size > MAX_IMPORT_BYTES)) { // a source that reports no size is read; the map reader bounds it
      try {
        text = await readBlob(file, 'text');
        if (hasFormat(text, PLANET_FILE_FORMAT)) return classified('planet', text);
        if (hasFormat(text, BLUEPRINT_FILE_FORMAT)) return classified('blueprint', text);
      } catch { /* unreadable text is the map reader's to refuse */ }
    }
    if (isJsonFile(file, name)) return classified('map-save', text);
  }
  if (isImageFile(file, name)) return classified('map-image');
  if (SUPPORTS_VIDEO_IMPORT && namesVideo(file, name)) return classified('video');
  return classified('unknown');
}
