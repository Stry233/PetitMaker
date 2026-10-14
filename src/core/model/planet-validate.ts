import { hasLandmark, landmarkGroundHolds, zonesReader } from './landmarks';
import { onHalfGrid } from '../grid/rect';
import { isCellZone } from '../game/zones';
import { PLANET_PROFILE, ELEVATION_MAX, landmarkSpec } from '../game/profile';
import type { MapTemplate } from './types';
import { isCustomTemplate, planetTemplateId, PLANET_MAX_CELLS } from './planet';

const half = (v: number) => Number.isFinite(v) && onHalfGrid(v);

/** A reason code for an untrusted custom template, or null when it may be installed. */
export function validatePlanetTemplate(t: MapTemplate): 'id' | 'size' | 'zones' | 'landmark' | 'terrain' | null {
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
  if (!Array.isArray(t.landmarks)) return 'landmark';
  const seen = new Set<string>();
  const zoneAt = zonesReader(t.zones);
  for (const p of t.landmarks) {
    const spec = p && typeof p.id === 'string' ? landmarkSpec(p.id) : undefined;
    if (!spec || seen.has(spec.id)) return 'landmark';
    seen.add(spec.id);
    if (![p.x, p.y].every(half) || ![p.width, p.height].every((v) => Number.isInteger(v) && v > 0)) return 'landmark';
    if (p.rotation !== undefined && !(PLANET_PROFILE.rotations as readonly number[]).includes(p.rotation)) return 'landmark';
    if (!hasLandmark(p) || p.x < 0 || p.y < 0 || p.x + p.width > w || p.y + p.height > h) return 'landmark';
    if (!landmarkGroundHolds(spec, p, p.rotation ?? 0, zoneAt)) return 'landmark';
  }
  if (t.terrain !== undefined && (!(t.terrain instanceof Uint8Array) || t.terrain.length !== w * h || t.terrain.some((e) => e > ELEVATION_MAX))) return 'terrain';
  if (t.water !== undefined && (!(t.water instanceof Uint8Array) || t.water.length !== w * h || t.water.some((e) => e > 1))) return 'terrain';
  return null;
}

/** Whether an untrusted custom template may be installed as it stands: valid, and named by the id its content hashes to. */
export function isTrustedPlanet(t: MapTemplate): boolean {
  return validatePlanetTemplate(t) === null && t.id === planetTemplateId(t);
}
