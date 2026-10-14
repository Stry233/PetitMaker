import type { LandmarkConfig, MapTemplate, MacroCoord, Rotation } from '../../core/model/types';
import type { CellZone } from '../../core/game/zones';
import { planetChunkGrid, upgradeLandmarks, PLANET_MAX_CELLS } from '../../core/model/planet';
import { loadableWater } from '../../core/model/template';
import { hasLandmark } from '../../core/model/landmarks';
import { isTrustedPlanet } from '../../core/model/planet-validate';
import { rleDecode, rleEncode } from './rle';
import { ImportError } from './import-error';
import { ANCHOR_LANDMARK, ELEVATION_MAX } from '../../core/game/profile';

export const PLANET_FILE_FORMAT = 'petitmaker.planet';
/** Version 2 carries the landmark list; version 1, which carries the plaza alone, still reads. */
const PLANET_FILE_VERSION = 2;
const READABLE_PLANET_FILE_VERSIONS: readonly unknown[] = [1, PLANET_FILE_VERSION];
/** The longest planet name a file, a share code or the library keeps, in UTF-16 units. */
export const PLANET_NAME_MAX = 24;


export interface SerializedLandmark { id: string; x: number; y: number; width: number; height: number; rotation?: Rotation }

export interface SerializedTemplate {
  id: string;
  name: string;
  width: number;
  height: number;
  /** RLE of one zone digit per cell, row-major. */
  zones: string;
  /** The template's landmarks, in profile order. */
  landmarks?: SerializedLandmark[];
  /** The anchor landmark alone, as templates stored it before they carried a landmark list; read, never written. */
  plaza?: Omit<SerializedLandmark, 'id'> | null;
  chunkGrid: { origin: MacroCoord; columns: number; rows: number };
  /** RLE of one elevation digit per cell, row-major; absent when the template has no terrain array. */
  terrain?: string;
  /** RLE of one 0/1 digit per cell marking water, row-major; absent when the template holds no water. */
  water?: string;
}

/** A planet name as every planet format stores it: a string of at most `PLANET_NAME_MAX` UTF-16
 *  units, never ending in half a surrogate pair. */
export function clampName(v: unknown): string {
  const name = (typeof v === 'string' ? v : '').slice(0, PLANET_NAME_MAX);
  return /[\uD800-\uDBFF]$/.test(name) ? name.slice(0, -1) : name;
}

export function serializeTemplate(t: MapTemplate): SerializedTemplate {
  const out: SerializedTemplate = {
    id: t.id,
    name: t.name.en,
    width: t.width,
    height: t.height,
    zones: rleEncode(t.zones.flat().map(String)),
    landmarks: t.landmarks.filter((p) => hasLandmark(p)).map((p) => ({
      id: p.id, x: p.x, y: p.y, width: p.width, height: p.height, ...(p.rotation ? { rotation: p.rotation } : {}),
    })),
    chunkGrid: planetChunkGrid(t),
  };
  if (t.terrain?.some((e) => e > 0)) out.terrain = rleEncode([...t.terrain].map(String));
  if (t.water?.some((e) => e > 0)) out.water = rleEncode([...t.water].map(String));
  return out;
}

/** A zone or elevation token as its value; throws unless it is a plain decimal integer in
 *  0..`max`, so no value wraps or coerces before validation. */
const tokenValue = (max: number) => (token: string): number => {
  const v = /^\d{1,3}$/.test(token) ? Number(token) : NaN;
  if (!(v <= max)) throw new ImportError('malformed', 'Planet file: invalid');
  return v;
};

/** A stored landmark's fields as a config; the validator judges the values. */
function landmarkOf(p: Partial<SerializedLandmark>, id: unknown): LandmarkConfig {
  return {
    id: String(id), x: Number(p.x), y: Number(p.y), width: Number(p.width), height: Number(p.height),
    ...(p.rotation !== undefined ? { rotation: p.rotation } : {}),
  };
}

/** The landmarks a stored template carries: its list, or the plaza a template stored before lists. */
function storedLandmarks(s: Partial<SerializedTemplate>): LandmarkConfig[] {
  if (Array.isArray(s.landmarks)) return s.landmarks.map((p) => (p && typeof p === 'object' ? landmarkOf(p, p.id) : landmarkOf({}, '')));
  const p = s.plaza;
  return p && typeof p === 'object' && hasLandmark(p) && ANCHOR_LANDMARK ? [landmarkOf(p, ANCHOR_LANDMARK.id)] : [];
}

/**
 * Restores what `serializeTemplate` wrote; throws unless the result is a valid planet whose id
 * matches its content. A landmark stored at another footprint than the game profile's then takes the
 * profile's, a landmark stored with its deck's layer stands on a support raised to it
 * (`upgradeLandmarks`), and the planet takes the id its content hashes to.
 */
export function parseTemplate(raw: unknown): MapTemplate {
  return upgradeLandmarks(parseStoredTemplate(raw));
}

/** The template exactly as stored, trusted but not upgraded. */
export function parseStoredTemplate(raw: unknown): MapTemplate {
  const s = raw as Partial<SerializedTemplate> | null;
  if (!s || typeof s !== 'object' || typeof s.zones !== 'string' || !Number.isInteger(s.width) || !Number.isInteger(s.height)) throw new ImportError('malformed', 'Planet file: invalid');
  if ((s.terrain !== undefined && typeof s.terrain !== 'string') || (s.water !== undefined && typeof s.water !== 'string')) throw new ImportError('malformed', 'Planet file: invalid');
  const w = s.width!, h = s.height!;
  if (w < 1 || h < 1 || w > PLANET_MAX_CELLS || h > PLANET_MAX_CELLS) throw new ImportError('malformed', 'Planet file: invalid');
  let flat: number[];
  let terrain: Uint8Array | undefined;
  let water: Uint8Array | undefined;
  try {
    flat = rleDecode(s.zones, w * h).map(tokenValue(255));
    if (s.terrain !== undefined) terrain = Uint8Array.from(rleDecode(s.terrain, w * h).map(tokenValue(ELEVATION_MAX)));
    if (s.water !== undefined) water = Uint8Array.from(rleDecode(s.water, w * h).map(tokenValue(1)));
  } catch {
    throw new ImportError('malformed', 'Planet file: invalid');
  }
  if (flat.length !== w * h || (terrain && terrain.length !== w * h) || (water && water.length !== w * h)) throw new ImportError('malformed', 'Planet file: invalid');
  const zones: CellZone[][] = Array.from({ length: h }, (_, y) => flat.slice(y * w, (y + 1) * w) as CellZone[]);
  const landmarks = storedLandmarks(s);
  const chunkGrid = planetChunkGrid({ width: w, height: h, chunkGrid: s.chunkGrid !== null && typeof s.chunkGrid === 'object' ? s.chunkGrid : undefined });
  const loadable = water && loadableWater({ width: w, zones, water });
  const body = { width: w, height: h, zones, landmarks, chunkGrid, ...(terrain ? { terrain } : {}), ...(loadable ? { water: loadable } : {}) };
  const t: MapTemplate = { id: String(s.id), name: { en: clampName(s.name) }, ...body };
  if (!isTrustedPlanet(t)) throw new ImportError('malformed', 'Planet file: invalid');
  return t;
}

export function writePlanetFile(name: string, t: MapTemplate): string {
  return JSON.stringify({ format: PLANET_FILE_FORMAT, version: PLANET_FILE_VERSION, name: clampName(name), template: serializeTemplate(t) });
}

export function readPlanetFile(text: string): { name: string; template: MapTemplate } {
  let f: { format?: unknown; version?: unknown; name?: unknown; template?: unknown } | null;
  try { f = JSON.parse(text); } catch { throw new ImportError('malformed', 'Planet file: invalid'); }
  if (f?.format !== PLANET_FILE_FORMAT) throw new ImportError('malformed', 'Planet file: not a planet file');
  if (typeof f.version === 'number' && f.version > PLANET_FILE_VERSION) throw new ImportError('future-version', `Planet file: version ${f.version}`);
  if (!READABLE_PLANET_FILE_VERSIONS.includes(f.version)) throw new ImportError('malformed', 'Planet file: unknown version');
  const template = parseTemplate(f.template);
  return { name: typeof f.name === 'string' ? clampName(f.name) : template.name.en, template };
}
