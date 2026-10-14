import type { CatalogItem, GridState, MapTemplate } from '../../core/model/types';
import type { AnnotationsState } from '../../core/model/annotations';
import { buildSaveFile } from './json-codec';
import type { SaveFile, SaveObject } from './format';
import { fnv1a32, hashJSON32 } from '../../core/base/hash';
import { getKnownItems } from '../../state/catalog';
import { ANCHOR_LANDMARK } from '../../core/game/profile';
import { isCustomTemplate } from '../../core/model/planet';

// The canonical map is template + cells + objects only. Provenance and annotations use separate
// payload fields, leaving one deterministic byte representation for map integrity checks.
export interface CanonicalSave {
  version: number;
  templateId: string;
  cells: string;
  objects: SaveObject[];
}

/** Deterministic object sort key independent of runtime ids. */
export function objKey(o: SaveObject): string {
  return [o.x, o.y, o.catalogId, o.rotation, o.elevation ?? '', o.spanLength ?? '', o.corners ?? '', o.patchOnly ? 1 : 0].join('|');
}

/** An object in the canonical field set and JSON key order, under `id`. */
function canonicalObject(o: SaveObject, id: string): SaveObject {
  const r: SaveObject = { id, catalogId: o.catalogId, x: o.x, y: o.y, rotation: o.rotation };
  if (o.elevation !== undefined) r.elevation = o.elevation;
  if (o.spanLength !== undefined) r.spanLength = o.spanLength;
  if (o.corners !== undefined) r.corners = o.corners;
  if (o.patchOnly) r.patchOnly = true;
  return r;
}

/** Deterministic save view with sorted objects, normalized ids, and no timestamp. */
export function canonicalize(state: GridState): CanonicalSave {
  const save = buildSaveFile(state);
  // Cache sort keys because dense maps contain thousands of objects.
  const keyed = save.objects.map((o) => ({ o, k: objKey(o) }));
  keyed.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
  const sorted = keyed.map((e) => e.o);
  const objects = sorted.map((o, i) => canonicalObject(o, `o${i}`));
  return { version: save.version, templateId: save.templateId, cells: save.cells, objects };
}

/** Stable JSON with a fixed key order for hashing and encoding. */
function stable(c: CanonicalSave): string {
  return JSON.stringify({
    version: c.version,
    templateId: c.templateId,
    cells: c.cells,
    objects: c.objects.map((o) => canonicalObject(o, o.id)),
  });
}

export function canonicalBytes(c: CanonicalSave): Uint8Array { return new TextEncoder().encode(stable(c)); }

/** A SaveFile JSON string for the shared save loader. */
export function toSaveJSON(c: CanonicalSave, annotations?: AnnotationsState): string {
  const save: SaveFile = {
    version: c.version,
    templateId: c.templateId,
    cells: c.cells,
    objects: c.objects,
    metadata: { savedAt: '' },
    ...(annotations ? { annotations } : {}),
  };
  return JSON.stringify(save);
}

/** The template signature a save or share code records, for the drift check on import. A built-in
 *  template returns the signature it carries, so a correction to its ground leaves the codes made
 *  before it signed as they were. */
export function templateHash(t: MapTemplate): number {
  if (!isCustomTemplate(t) && t.signature !== undefined) return t.signature;
  return hashJSON32({ id: t.id, w: t.width, h: t.height, zones: t.zones, landmarks: t.landmarks });
}

/** The items a share code may name and its catalog signature lists: every known item but the anchor
 *  landmark's, which no share code has ever carried (the template lays it). */
export function signedCatalogItems(): CatalogItem[] {
  return getKnownItems().filter((it) => it.id !== ANCHOR_LANDMARK?.id);
}

/** The catalog signature a share code records: each signed item's id, footprint and category. */
export function catalogHash(): number {
  const sig = signedCatalogItems()
    .map((it) => `${it.id}:${it.width}x${it.height}:${it.category}`)
    .sort()
    .join(',');
  return fnv1a32(sig);
}
