import {
  type GridState,
  type MacroCell,
  type MapTemplate,
  type PlacedObject,
  type TerrainCell,
  type CornerTrim,
  type Corners,
  CellZone,
  TerrainType,
} from '../core/model/types';
import { cellKey, createGrid, createPlazaObject, onHalfGrid } from '../core/model/grid-model';
import { PLAZA_ID } from '../core/model/constants';
import { isCoating } from '../core/model/traits';
import { isValidTerrainType, isValidRotation, isValidElevation } from './import-validate';
import { getCatalogItem } from '../state/catalog';
import { hasHalfStep, objectRect } from '../state/object-geometry';
import {
  CURRENT_VERSION,
  migrateToCurrent,
  type RawSave,
  type SaveFile,
  type SaveObject,
  type PersistedCamera,
} from './save-format';
import { serializeProvenance, deserializeProvenance, markLegacyUnknown } from '../core/provenance/serialize';

/* ── SaveFile schema lives in ./save-format/types (shared with the migration
   framework). serialize writes CURRENT_VERSION; deserialize lifts any older save
   to the current shape via migrateToCurrent before decoding. ─────────────────── */

/* ── Corner codec maps ───────────────────────────────────── */

const CORNER_ENCODE: Record<string, string> = {
  square: 'S', fan: 'F', 'tri-NW': '1', 'tri-NE': '2', 'tri-SW': '3', 'tri-SE': '4', empty: 'E',
};

const CORNER_DECODE: Record<string, CornerTrim> = {
  S: 'square', F: 'fan', T: 'tri-NW', '1': 'tri-NW', '2': 'tri-NE', '3': 'tri-SW', '4': 'tri-SE', E: 'empty',
};

/** Encode a corner tuple to its 4-char suffix, or undefined when all-square ('SSSS' — the default,
 *  which the token/object omits). The single source for the CORNER_ENCODE + all-square-elision idiom
 *  shared by terrain tokens and saved objects. */
export function encodeCorners(corners: Corners): string | undefined {
  const suffix = corners.map((c: CornerTrim) => CORNER_ENCODE[c] ?? 'S').join('');
  return suffix === 'SSSS' ? undefined : suffix;
}

/** Decode a 4-char corner suffix back to a corner tuple (missing/unknown chars → 'square'). */
export function decodeCorners(suffix: string): Corners {
  return [0, 1, 2, 3].map((i) => CORNER_DECODE[suffix[i]!] ?? 'square') as Corners;
}

/* ── Cell tokenisation ───────────────────────────────────── */

export function terrainToken(t: TerrainCell): string {
  let token = `t${t.type}:${t.elevation}`;
  if (t.corners) {
    const suffix = encodeCorners(t.corners);
    if (suffix) token += ':' + suffix;
    if (t.patchOnly) token += ':P';
  } else if (t.patchOnly) {
    token += '::P';
  }
  // Γ patch: a cosmetic corner fillet (patchOnly) whose real support tier is patchBase — see
  // docs/ARCHITECTURE.md → Edge-Cut System. `:B{n}` encodes that base; absent ⇒ legacy fallback (elevation-1).
  if (t.patchOnly && t.patchBase !== undefined) token += ':B' + t.patchBase;
  return token;
}

function cellToToken(cell: MacroCell): string {
  if (!cell.terrain) return '_';
  return terrainToken(cell.terrain);
}

/* ── RLE compression ─────────────────────────────────────── */

export function rleEncode(tokens: string[]): string {
  if (tokens.length === 0) return '';
  const runs: string[] = [];
  let current = tokens[0]!;
  let count = 1;
  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i] === current) {
      count++;
    } else {
      runs.push(count > 1 ? `${count}*${current}` : current);
      current = tokens[i]!;
      count = 1;
    }
  }
  runs.push(count > 1 ? `${count}*${current}` : current);
  return runs.join(',');
}

/**
 * Decode a comma-joined RLE stream. `maxTokens` bounds the expansion: run counts are
 * attacker-controlled in an imported file, so an unbounded loop would let a single
 * `1e9*_` run allocate the tab to death before any later validation could reject the
 * save. Throws on malformed or over-long input; callers treat that as a bad file.
 */
export function rleDecode(rle: string, maxTokens?: number): string[] {
  if (rle === '') return [];
  const tokens: string[] = [];
  for (const part of rle.split(',')) {
    const starIdx = part.indexOf('*');
    if (starIdx > 0) {
      const count = Number(part.slice(0, starIdx));
      if (!Number.isInteger(count) || count <= 0) throw new Error('Invalid cell data: bad RLE run count.');
      if (maxTokens !== undefined && tokens.length + count > maxTokens) {
        throw new Error('Invalid cell data: more cells than the map template holds.');
      }
      const token = part.slice(starIdx + 1);
      for (let i = 0; i < count; i++) tokens.push(token);
    } else {
      if (maxTokens !== undefined && tokens.length >= maxTokens) {
        throw new Error('Invalid cell data: more cells than the map template holds.');
      }
      tokens.push(part);
    }
  }
  return tokens;
}

/* ── Token → Cell parsing ────────────────────────────────── */

/** Parse one terrain token. Returns null for malformed or out-of-range values —
 *  imported tokens are untrusted, and a NaN elevation must never reach GridState. */
export function parseTerrain(s: string): TerrainCell | null {
  const parts = s.slice(1).split(':');
  const type = Number(parts[0]) as TerrainType;
  const elevation = Number(parts[1]);
  if (!isValidTerrainType(type)) return null;
  if (!isValidElevation(elevation)) return null;
  const cell: TerrainCell = { type, elevation };
  if (parts[2] && parts[2] !== 'P') {
    cell.corners = decodeCorners(parts[2]);
  }
  if (parts.includes('P')) cell.patchOnly = true;
  const bPart = parts.find((p) => /^B\d+$/.test(p));
  if (bPart) {
    const base = Number(bPart.slice(1));
    if (!isValidElevation(base)) return null;
    cell.patchBase = base;
  }
  return cell;
}

function tokenToCell(token: string, zone: CellZone): MacroCell {
  if (token === '_') {
    return { zone, terrain: null };
  }

  let terrain: TerrainCell | null = null;

  for (const part of token.split('+')) {
    if (part.startsWith('t')) {
      terrain = parseTerrain(part);
    }
    // Legacy corner ('c') and road ('r') tokens are silently ignored
  }

  return { zone, terrain };
}

/* ── Public API ──────────────────────────────────────────── */

/** `camera` is session/view data (which view was looking where), not map content — it never
 *  comes from GridState (a higher layer would have to leak into core/model to put it there).
 *  Callers that want it round-tripped (io/autosave) read it live from the canvas at write time
 *  and pass it in; every other caller (import, share codecs, editor-api) omits it. */
export function serialize(state: GridState, camera?: PersistedCamera): string {
  const { template, cells, objects } = state;

  // Flatten row-major
  const tokens: string[] = [];
  for (let y = 0; y < template.height; y++) {
    const row = cells[y];
    if (!row) continue;
    for (let x = 0; x < template.width; x++) {
      const cell = row[x];
      tokens.push(cell ? cellToToken(cell) : '_');
    }
  }

  const objectList: SaveObject[] = [];
  for (const obj of objects.values()) {
    if (obj.locked) continue; // immutable structures (the plaza) are recreated from the template on load
    const saved: SaveObject = {
      id: obj.id,
      catalogId: obj.catalogId,
      x: obj.position.x,
      y: obj.position.y,
      rotation: obj.rotation,
      elevation: obj.elevation,
    };
    if (obj.spanLength !== undefined) saved.spanLength = obj.spanLength;
    if (obj.corners) {
      const suffix = encodeCorners(obj.corners);
      if (suffix) saved.corners = suffix;
    }
    if (obj.patchOnly) (saved as any).patchOnly = true;
    objectList.push(saved);
  }

  const saveFile: SaveFile = {
    version: CURRENT_VERSION,
    templateId: template.id,
    cells: rleEncode(tokens),
    objects: objectList,
    metadata: { savedAt: new Date().toISOString() },
    ...(state.provenance ? { provenance: serializeProvenance(state.provenance) } : {}),
    // Notes round-trip with the map (autosave keeps them). Written only when non-empty.
    // Safe for the share codecs: canonicalize() reads just version/templateId/cells/objects.
    ...(state.notes && (state.notes.title || state.notes.description || state.notes.author)
      ? { notes: state.notes }
      : {}),
    ...(camera && (camera.view2d || camera.view3d) ? { camera } : {}),
  };

  return JSON.stringify(saveFile);
}

/** Finite-number guard for camera fields read back from storage — untrusted (hand-edited
 *  localStorage, an old/foreign save) — a NaN/string must never reach the camera bridge. */
function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Read just the `camera` section from a save's raw JSON, independent of `deserialize` (which
 *  returns a GridState and has no business carrying view state). Malformed/missing shapes are
 *  dropped field-by-field rather than failing the whole read: a corrupt 3D camera shouldn't cost
 *  the user their 2D one. Never throws; returns undefined when there's nothing usable. */
export function readSaveCamera(json: string): PersistedCamera | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (!raw || typeof raw !== 'object' || !('camera' in raw)) return undefined;
  const cam = (raw as { camera?: unknown }).camera;
  if (!cam || typeof cam !== 'object') return undefined;
  const { view2d, view3d } = cam as { view2d?: unknown; view3d?: unknown };
  const result: PersistedCamera = {};
  if (view2d && typeof view2d === 'object') {
    const { x, y, zoom } = view2d as { x?: unknown; y?: unknown; zoom?: unknown };
    if (isFiniteNumber(x) && isFiniteNumber(y) && isFiniteNumber(zoom)) result.view2d = { x, y, zoom };
  }
  if (view3d && typeof view3d === 'object') {
    const { az, el, dist, tx, tz } = view3d as { az?: unknown; el?: unknown; dist?: unknown; tx?: unknown; tz?: unknown };
    if (isFiniteNumber(az) && isFiniteNumber(el) && isFiniteNumber(dist)) {
      result.view3d = {
        az, el, dist,
        ...(isFiniteNumber(tx) ? { tx } : {}),
        ...(isFiniteNumber(tz) ? { tz } : {}),
      };
    }
  }
  return result.view2d || result.view3d ? result : undefined;
}

/**
 * The coatings a LATER coating has completely covered, by id.
 *
 * Nothing in the rules refuses a second road on a paved cell: V-PLACE-OVERLAP exempts surface
 * coatings so that a placement may coat OVER one, which leaves a tool that forgets to strip the
 * tile underneath free to stack them. The stack is invisible on screen, charges its load value
 * once per copy, travels with the save, and is what makes a share code unbuildable (one real map
 * reached ten dirt roads on a single cell). Read by TRAIT, so any future coating item is covered.
 *
 * Last one wins, which is what coating over means. A coating that still owns a cell of its own
 * survives: two differently sized coatings that merely OVERLAP are not a stack, and dropping one
 * of those would take ground the other never covered.
 */
export function stackedCoatingIds(objects: Iterable<PlacedObject>): Set<string> {
  const owner = new Map<string, string>();
  const coatings: PlacedObject[] = [];
  for (const obj of objects) {
    const item = getCatalogItem(obj.catalogId);
    if (!item || !isCoating(item)) continue;
    coatings.push(obj);
    const { x, y, w, h } = objectRect(obj);
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) owner.set(cellKey(Math.floor(x) + dx, Math.floor(y) + dy), obj.id);
    }
  }
  const drop = new Set<string>();
  for (const obj of coatings) {
    const { x, y, w, h } = objectRect(obj);
    let owns = false;
    for (let dy = 0; dy < h && !owns; dy++) {
      for (let dx = 0; dx < w && !owns; dx++) {
        owns = owner.get(cellKey(Math.floor(x) + dx, Math.floor(y) + dy)) === obj.id;
      }
    }
    if (!owns) drop.add(obj.id);
  }
  return drop;
}

export function deserialize(json: string, template: MapTemplate): GridState {
  // Lift any older save to the current shape before decoding (throws
  // SaveVersionError on a future-version or unmigratable file).
  const save = migrateToCurrent(JSON.parse(json) as RawSave) as unknown as SaveFile;
  // A save decoded into the wrong template would load silently sheared — terrain
  // squashed into the top rows, the rest grass. Fail loudly instead, matching the
  // raster import path's incompatible-template error.
  if (save.templateId && save.templateId !== template.id) {
    throw new Error(`Save was made for map template "${save.templateId}", not "${template.id}".`);
  }
  const area = template.width * template.height;
  const tokens = rleDecode(save.cells, area);
  if (tokens.length !== area) {
    throw new Error('Invalid cell data: the save does not cover the map template.');
  }
  const cells = createGrid(template);

  let idx = 0;
  for (let y = 0; y < template.height; y++) {
    const row = cells[y];
    if (!row) continue;
    for (let x = 0; x < template.width; x++) {
      const token = tokens[idx++];
      // Plaza cells are plain grass (the plaza is an object now); ignore any
      // terrain a legacy save baked into them. createGrid already set grass.
      if (token && (template.zones[y]?.[x] ?? CellZone.Grass) !== CellZone.Plaza) {
        row[x] = tokenToCell(token, row[x]?.zone ?? CellZone.Grass);
      }
    }
  }

  const objects = new Map<string, PlacedObject>();
  for (const obj of save.objects) {
    if (obj.id === PLAZA_ID) continue; // recreated fresh from the template below
    // Import validation: only real catalog items may enter the state. A crafted
    // save could otherwise smuggle arbitrary strings as catalogId — which the
    // renderer/rules would choke on, and which the AI agent would echo into its
    // model context (prompt-injection vector via shared map files).
    const item = getCatalogItem(obj.catalogId);
    if (!item) continue;
    // Numeric fields are untrusted: a NaN position or a 45° rotation would pass the
    // type cast and corrupt every downstream footprint read. Drop the object instead.
    // A halfStep item (ramps, bridges) anchors on the half grid, so 7.5 is a legal x for
    // one and only one; 7.33 is legal for neither.
    const onGrid = (v: number) => (hasHalfStep(item) ? onHalfGrid(v) : Number.isInteger(v));
    if (!onGrid(obj.x) || !onGrid(obj.y)
      || obj.x < 0 || obj.y < 0 || obj.x >= template.width || obj.y >= template.height) continue;
    if (!isValidRotation(obj.rotation)) continue;
    if (obj.elevation !== undefined && !isValidElevation(obj.elevation)) continue;
    if (obj.spanLength !== undefined
      && (!Number.isInteger(obj.spanLength) || obj.spanLength < 1 || obj.spanLength > Math.max(template.width, template.height))) continue;
    const placed: PlacedObject = {
      id: obj.id,
      catalogId: obj.catalogId,
      position: { x: obj.x, y: obj.y },
      rotation: obj.rotation as 0 | 90 | 180 | 270,
      elevation: obj.elevation ?? 0,
    };
    if (obj.spanLength !== undefined) placed.spanLength = obj.spanLength;
    if (obj.corners) {
      placed.corners = decodeCorners(obj.corners);
    }
    if ((obj as any).patchOnly) placed.patchOnly = true;
    objects.set(obj.id, placed);
  }

  // Repair a map that arrives with coatings stacked on one cell, beside the unknown-catalogId
  // drop above: both are about what may enter the state, and a stack is one road tile's worth of
  // map wearing several objects' worth of load, save size and share-code payload.
  for (const id of stackedCoatingIds(objects.values())) objects.delete(id);

  const plaza = createPlazaObject(template);
  if (plaza) objects.set(plaza.id, plaza);

  const result: GridState = {
    template,
    cells,
    objects,
    lockedLayers: new Set(),
  };
  if (save.provenance) {
    result.provenance = deserializeProvenance(save.provenance, template.width, template.height);
  } else {
    markLegacyUnknown(result); // legacy / pre-provenance map → existing content is Unknown
  }
  // Notes: untrusted input — coerce to strings and clamp lengths (title/author 80, description 400).
  if (save.notes && typeof save.notes === 'object') {
    result.notes = {
      ...(save.notes.title ? { title: String(save.notes.title).slice(0, 80) } : {}),
      ...(save.notes.description ? { description: String(save.notes.description).slice(0, 400) } : {}),
      ...(save.notes.author ? { author: String(save.notes.author).slice(0, 80) } : {}),
    };
  }
  return result;
}
