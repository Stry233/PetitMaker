import { hasLandmark, isCellZone, isGrassZone, onHalfGrid } from './grid-model';
import { PLANET_PROFILE, ELEVATION_MAX } from './game-profile';
import type { MapTemplate } from './types';
import { isCustomTemplate, planetTemplateId, PLANET_MAX_CELLS } from './planet';

const half = (v: number) => Number.isFinite(v) && onHalfGrid(v);

/** A reason code for an untrusted custom template, or null when it may be installed. */
export function validatePlanetTemplate(t: MapTemplate): 'id' | 'size' | 'zones' | 'plaza' | 'terrain' | null {
  if (typeof t.id !== 'string' || !isCustomTemplate(t)) return 'id';
  const { width: w, height: h } = t;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > PLANET_MAX_CELLS || h > PLANET_MAX_CELLS) return 'size';
  if (!Array.isArray(t.zones) || t.zones.length !== h) return 'zones';
  for (const row of t.zones) if (!Array.isArray(row) || row.length !== w || row.some((z) => !isCellZone(z))) return 'zones';
  const g = t.chunkGrid;
  if (g !== undefined) {
    const inRange = (v: unknown) => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= PLANET_PROFILE.maxChunks;
    if (!g || typeof g !== 'object' || !g.origin || !Number.isInteger(g.origin.x) || !Number.isInteger(g.origin.y) || !inRange(g.columns) || !inRange(g.rows)) return 'size';
  }
  const p = t.plaza;
  if (!p || ![p.x, p.y].every(half) || ![p.width, p.height].every((v) => Number.isInteger(v) && v >= 0)) return 'plaza';
  if (!Number.isInteger(p.elevation) || p.elevation < 0 || p.elevation > ELEVATION_MAX) return 'plaza';
  if (p.rotation !== undefined && !(PLANET_PROFILE.rotations as readonly number[]).includes(p.rotation)) return 'plaza';
  if (hasLandmark(p)) {
    if (p.x < 0 || p.y < 0 || p.x + p.width > w || p.y + p.height > h) return 'plaza';
    for (let y = Math.floor(p.y); y < Math.ceil(p.y + p.height); y++) for (let x = Math.floor(p.x); x < Math.ceil(p.x + p.width); x++) {
      const z = t.zones[y]![x];
      if (z === undefined || !isGrassZone(z)) return 'plaza';
    }
  }
  if (t.terrain !== undefined && (!(t.terrain instanceof Uint8Array) || t.terrain.length !== w * h || t.terrain.some((e) => e > ELEVATION_MAX))) return 'terrain';
  if (t.water !== undefined && (!(t.water instanceof Uint8Array) || t.water.length !== w * h || t.water.some((e) => e > 1))) return 'terrain';
  return null;
}

/** Whether an untrusted custom template may be installed as it stands: valid, and named by the id its content hashes to. */
export function isTrustedPlanet(t: MapTemplate): boolean {
  return validatePlanetTemplate(t) === null && t.id === planetTemplateId(t);
}
