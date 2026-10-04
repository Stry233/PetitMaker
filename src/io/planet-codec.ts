import type { CellZone, MapTemplate, MacroCoord, Rotation } from '../core/model/types';
import { loadableWater, planetChunkGrid, NO_PLANET_PLAZA, PLANET_MAX_CELLS } from '../core/model/planet';
import { hasLandmark } from '../core/model/grid-model';
import { isTrustedPlanet } from '../core/model/planet-validate';
import { rleDecode, rleEncode } from './rle';
import { ELEVATION_MAX } from '../core/model/game-profile';

export const PLANET_FILE_FORMAT = 'petitmaker.planet';
const PLANET_FILE_VERSION = 1;
/** The longest planet name a file, a share code or the library keeps, in UTF-16 units. */
export const PLANET_NAME_MAX = 24;

/** No existing io error type fits: share errors are raster-specific and save errors are version-specific. */
export class PlanetFileError extends Error {
  constructor(readonly reason: 'invalid' | 'format') { super(`Planet file: ${reason}`); }
}

export interface SerializedTemplate {
  id: string;
  name: string;
  width: number;
  height: number;
  /** RLE of one zone digit per cell, row-major. */
  zones: string;
  plaza: { x: number; y: number; width: number; height: number; elevation: number; rotation?: Rotation } | null;
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
  const p = t.plaza;
  const out: SerializedTemplate = {
    id: t.id,
    name: t.name.en,
    width: t.width,
    height: t.height,
    zones: rleEncode(t.zones.flat().map(String)),
    plaza: hasLandmark(p)
      ? { x: p.x, y: p.y, width: p.width, height: p.height, elevation: p.elevation, ...(p.rotation ? { rotation: p.rotation } : {}) }
      : null,
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
  if (!(v <= max)) throw new PlanetFileError('invalid');
  return v;
};

/** Restores exactly what `serializeTemplate` wrote; throws unless the result is a valid planet whose id matches its content. */
export function parseTemplate(raw: unknown): MapTemplate {
  const s = raw as Partial<SerializedTemplate> | null;
  if (!s || typeof s !== 'object' || typeof s.zones !== 'string' || !Number.isInteger(s.width) || !Number.isInteger(s.height)) throw new PlanetFileError('invalid');
  if ((s.terrain !== undefined && typeof s.terrain !== 'string') || (s.water !== undefined && typeof s.water !== 'string')) throw new PlanetFileError('invalid');
  const w = s.width!, h = s.height!;
  if (w < 1 || h < 1 || w > PLANET_MAX_CELLS || h > PLANET_MAX_CELLS) throw new PlanetFileError('invalid');
  let flat: number[];
  let terrain: Uint8Array | undefined;
  let water: Uint8Array | undefined;
  try {
    flat = rleDecode(s.zones, w * h).map(tokenValue(255));
    if (s.terrain !== undefined) terrain = Uint8Array.from(rleDecode(s.terrain, w * h).map(tokenValue(ELEVATION_MAX)));
    if (s.water !== undefined) water = Uint8Array.from(rleDecode(s.water, w * h).map(tokenValue(1)));
  } catch {
    throw new PlanetFileError('invalid');
  }
  if (flat.length !== w * h || (terrain && terrain.length !== w * h) || (water && water.length !== w * h)) throw new PlanetFileError('invalid');
  const zones: CellZone[][] = Array.from({ length: h }, (_, y) => flat.slice(y * w, (y + 1) * w) as CellZone[]);
  const p = s.plaza;
  const plaza = p
    ? { x: p.x, y: p.y, width: p.width, height: p.height, elevation: p.elevation, ...(p.rotation !== undefined ? { rotation: p.rotation } : {}) }
    : { ...NO_PLANET_PLAZA };
  const chunkGrid = planetChunkGrid({ width: w, height: h, chunkGrid: s.chunkGrid !== null && typeof s.chunkGrid === 'object' ? s.chunkGrid : undefined });
  const loadable = water && loadableWater({ width: w, zones, water });
  const body = { width: w, height: h, zones, plaza, chunkGrid, ...(terrain ? { terrain } : {}), ...(loadable ? { water: loadable } : {}) };
  const t: MapTemplate = { id: String(s.id), name: { en: clampName(s.name) }, ...body };
  if (!isTrustedPlanet(t)) throw new PlanetFileError('invalid');
  return t;
}

export function writePlanetFile(name: string, t: MapTemplate): string {
  return JSON.stringify({ format: PLANET_FILE_FORMAT, version: PLANET_FILE_VERSION, name: clampName(name), template: serializeTemplate(t) });
}

export function readPlanetFile(text: string): { name: string; template: MapTemplate } {
  let f: { format?: unknown; version?: unknown; name?: unknown; template?: unknown } | null;
  try { f = JSON.parse(text); } catch { throw new PlanetFileError('invalid'); }
  if (f?.format !== PLANET_FILE_FORMAT || f.version !== PLANET_FILE_VERSION) throw new PlanetFileError('format');
  const template = parseTemplate(f.template);
  return { name: typeof f.name === 'string' ? clampName(f.name) : template.name.en, template };
}
