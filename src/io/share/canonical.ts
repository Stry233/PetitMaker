// src/io/share/canonical.ts
import type { GridState, MapTemplate } from '../../core/model/types';
import { serialize } from '../json-codec';
import type { SaveFile, SaveObject } from '../save-format';
import { fnv1a, hashJSON } from '../../core/model/hash';
import { getAllItems } from '../../state/catalog';

// The canonical map is PROVENANCE-FREE: it is template + cells + objects only. Provenance is
// volatile (op timestamps in the ledger) and is carried separately by the EmbeddedProvenance
// carrier — so canonical bytes are deterministic, the content hash is purely about the map, and
// procedural-v1 replay can verify exact map equality.
export interface CanonicalSave {
  version: number;
  templateId: string;
  cells: string;
  objects: SaveObject[];
}

/** Total, deterministic object sort key. Objects cannot overlap, so
 *  (x,y,catalogId,rotation,span,corners,patch) is unique → no id tiebreak needed. */
export function objKey(o: SaveObject): string {
  return [o.x, o.y, o.catalogId, o.rotation, o.elevation ?? '', o.spanLength ?? '', o.corners ?? '', o.patchOnly ? 1 : 0].join('|');
}

/** The optional SaveObject fields (elevation/spanLength/corners/patchOnly), present-only, in
 *  canonical order — the single source both `canonicalize` and `stable` spread after the fixed
 *  keys, so the optional-field set can't drift between the two. Spread order == JSON key order. */
function optionalFields(o: SaveObject): Partial<SaveObject> {
  const r: Partial<SaveObject> = {};
  if (o.elevation !== undefined) r.elevation = o.elevation;
  if (o.spanLength !== undefined) r.spanLength = o.spanLength;
  if (o.corners !== undefined) r.corners = o.corners;
  if (o.patchOnly) r.patchOnly = true;
  return r;
}

/** Deterministic, id-normalized view of the SaveFile, built on the save encoder itself:
 *  serialize → parse → normalize (sort objects, re-id o0,o1,…, drop timestamp). */
export function canonicalize(state: GridState): CanonicalSave {
  const save = JSON.parse(serialize(state)) as SaveFile;
  const sorted = [...save.objects].sort((a, b) => {
    const ka = objKey(a), kb = objKey(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  const objects: SaveObject[] = sorted.map((o, i) => (
    { id: `o${i}`, catalogId: o.catalogId, x: o.x, y: o.y, rotation: o.rotation, ...optionalFields(o) }
  ));
  return { version: save.version, templateId: save.templateId, cells: save.cells, objects };
}

/** Stable JSON (fixed key order) of the canonical save — the hash + json-codec unit. */
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

/** A real SaveFile JSON string the existing deserialize() consumes (DRY load path). */
export function toSaveJSON(c: CanonicalSave): string {
  const save: SaveFile = { version: c.version, templateId: c.templateId, cells: c.cells, objects: c.objects, metadata: { savedAt: '' } };
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
