// src/io/share/canonical.ts
import type { GridState, MapTemplate } from '../../core/model/types';
import type { AnnotationsState } from '../../core/model/annotations';
import { serialize } from '../json-codec';
import type { SaveFile, SaveObject } from '../save-format';
import { fnv1a, hashJSON } from '../../core/model/hash';
import { getAllItems } from '../../state/catalog';

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

/** Optional object fields in their canonical JSON key order. */
function optionalFields(o: SaveObject): Partial<SaveObject> {
  const r: Partial<SaveObject> = {};
  if (o.elevation !== undefined) r.elevation = o.elevation;
  if (o.spanLength !== undefined) r.spanLength = o.spanLength;
  if (o.corners !== undefined) r.corners = o.corners;
  if (o.patchOnly) r.patchOnly = true;
  return r;
}

/** Deterministic save view with sorted objects, normalized ids, and no timestamp. */
export function canonicalize(state: GridState): CanonicalSave {
  const save = JSON.parse(serialize(state)) as SaveFile;
  // Cache sort keys because dense maps contain thousands of objects.
  const keyed = save.objects.map((o) => ({ o, k: objKey(o) }));
  keyed.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
  const sorted = keyed.map((e) => e.o);
  const objects: SaveObject[] = sorted.map((o, i) => (
    { id: `o${i}`, catalogId: o.catalogId, x: o.x, y: o.y, rotation: o.rotation, ...optionalFields(o) }
  ));
  return { version: save.version, templateId: save.templateId, cells: save.cells, objects };
}

/** Stable JSON with a fixed key order for hashing and encoding. */
function stable(c: CanonicalSave): string {
  const obj = (o: SaveObject) => (
    { id: o.id, catalogId: o.catalogId, x: o.x, y: o.y, rotation: o.rotation, ...optionalFields(o) }
  );
  return JSON.stringify({
    version: c.version,
    templateId: c.templateId,
    cells: c.cells,
    objects: c.objects.map(obj),
  });
}

export function canonicalBytes(c: CanonicalSave): Uint8Array { return new TextEncoder().encode(stable(c)); }

/** A SaveFile JSON string for the shared deserialize path. */
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

export function templateHash(t: MapTemplate): number {
  const sig = hashJSON({ id: t.id, w: t.width, h: t.height, zones: t.zones, plaza: t.plaza });
  return parseInt(sig, 16) >>> 0;
}

export function catalogHash(): number {
  const sig = getAllItems()
    .map((it) => `${it.id}:${it.width}x${it.height}:${it.category}`)
    .sort()
    .join(',');
  return parseInt(fnv1a(sig), 16) >>> 0;
}
