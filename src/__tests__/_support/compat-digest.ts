/**
 * A version-independent fingerprint of a map, read from the core save JSON a version's own
 * `serialize` writes. The released-exports corpus records it in each release's own build and the
 * compatibility test recomputes it from the current build, so this file is plain enough to run in
 * either: no imports, structural input, WebCrypto only.
 *
 * Object and annotation ids are minted fresh on every load, so they are left out; everything else a
 * save carries for cells, objects, annotations and notes is part of the fingerprint.
 */

export interface MapDigest {
  cells: string;
  objects: string;
  annotations: string;
  notes: string;
  counts: { terrainCells: number; objects: number; annotations: number };
}

/** JSON with object keys sorted, so two equal records always print the same text. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).filter((k) => record[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(',')}}`;
}

async function hash(text: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return Array.from(bytes.subarray(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}

function withoutId(entry: unknown): unknown {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
  const { id: _id, ...rest } = entry as Record<string, unknown>;
  return rest;
}

/** The objects of a core save, each without its id, sorted into a canonical order. */
export function objectRecords(core: { objects?: unknown }): string[] {
  const list = Array.isArray(core.objects) ? core.objects : [];
  return list.map((o) => stableStringify(withoutId(o))).sort();
}

/** The annotation items of a core save, each without its id, sorted, plus the layer's flags. */
export function annotationRecords(core: { annotations?: unknown }): string[] {
  const layer = core.annotations as { items?: unknown; visible?: unknown; locked?: unknown } | undefined;
  const items = Array.isArray(layer?.items) ? layer.items : [];
  const records = items.map((a) => stableStringify(withoutId(a))).sort();
  if (layer && (layer.visible === false || layer.locked === true)) records.push(stableStringify({ visible: layer.visible, locked: layer.locked }));
  return records;
}

/** Expanded cell tokens of an RLE cell string (`3*t1:2,_` is three `t1:2` then `_`). */
export function cellTokens(cells: unknown): string[] {
  if (typeof cells !== 'string' || cells === '') return [];
  const out: string[] = [];
  for (const part of cells.split(',')) {
    const star = part.indexOf('*');
    if (star > 0) {
      const token = part.slice(star + 1);
      for (let i = Number(part.slice(0, star)); i > 0; i--) out.push(token);
    } else out.push(part);
  }
  return out;
}

export async function digestSave(core: { cells?: unknown; objects?: unknown; annotations?: unknown; notes?: unknown }): Promise<MapDigest> {
  const tokens = cellTokens(core.cells);
  const objects = objectRecords(core);
  const annotations = annotationRecords(core);
  const notes = core.notes && typeof core.notes === 'object' ? core.notes as Record<string, unknown> : {};
  const shownNotes = { title: notes.title || undefined, description: notes.description || undefined };
  return {
    cells: await hash(tokens.join(',')),
    objects: await hash(objects.join('\n')),
    annotations: await hash(annotations.join('\n')),
    notes: await hash(stableStringify(shownNotes)),
    counts: { terrainCells: tokens.filter((t) => t !== '_').length, objects: objects.length, annotations: annotations.length },
  };
}

/** A fingerprint of a planet's own content: its size, the zone of every cell and the terrain and
 *  water it carries. Ids and landmark placement are left out; their encodings changed between
 *  releases while the ground they describe did not. */
export async function digestPlanet(
  t: { width: number; height: number; zones: ArrayLike<ArrayLike<number>>; terrain?: ArrayLike<number>; water?: ArrayLike<number> },
): Promise<string> {
  const plane = (values: ArrayLike<number> | undefined) => Array.from({ length: t.width * t.height }, (_, i) => values?.[i] ?? 0).join('');
  const zones = Array.from(t.zones, (row) => Array.from(row).join('.')).join('/');
  return hash(stableStringify({ w: t.width, h: t.height, zones, terrain: plane(t.terrain), water: plane(t.water) }));
}
