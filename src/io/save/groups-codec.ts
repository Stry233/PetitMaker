// A save's placed blueprint groups (`core/model/placed-group.ts`). Only standing members are written,
// and only what the map cannot give back: a member object by id, a laid cell by where it is and what
// it held before, since the map itself holds what the group laid, and what its last laying skipped.
// Share codes, exports and the canonical map never carry them.
import { prunedGroup, type GroupCell, type PlacedGroup } from '../../core/model/placed-group';
import type { BlueprintBody, BlueprintCell, BlueprintObject } from '../../core/model/blueprint';
import { admitBlueprintBody } from '../blueprint/codec';
import { currentCatalogId } from '../../config/catalog/retired-ids';
import { clonePlacedObject, cloneTerrain, getCell } from '../../core/model/grid-model';
import { cellKey, rectContains, type Rect } from '../../core/grid/rect';
import { footprintTerrain } from '../../core/grid/footprint';
import { BLUEPRINT_MAX_SIDE } from '../../tools/blueprint';
import type { GridState } from '../../core/model/types';
import { BLUEPRINT_NAME_MAX } from '../blueprint/facts';
import { clampText } from '../../core/base/text';
import { isValidElevation } from './admission';
import { isValidId } from '../../core/base/guards';
import { parseTerrain, terrainToken } from './terrain-token';

/** One group as a save writes it; `cells` hold `[x, y, prior]` with `prior` a terrain token, or `_`
 *  for bare ground; `skipped` holds `PlacedGroup.skipped`, its cells as `[index, cell]` in the
 *  frame's terrain cells, absent when nothing was skipped and in files written before it. */
export interface SaveGroup {
  id: string;
  blueprint: string;
  name: string;
  origin: string | null;
  frame: [number, number, number, number];
  base: number;
  objects: string[];
  cells: [number, number, string][];
  skipped?: { cells: [number, BlueprintCell][]; objects: BlueprintObject[] };
}

/** The most groups a save keeps. */
const GROUPS_MAX = 2000;

/** The groups of `state` with anything standing, cut down to their standing members; none when the
 *  map has none. */
export function encodeGroups(state: GridState): SaveGroup[] | undefined {
  const out: SaveGroup[] = [];
  for (const g of state.groups ?? []) {
    const kept = prunedGroup(state, g);
    if (!kept) continue;
    out.push({
      id: kept.id, blueprint: kept.blueprint, name: kept.name, origin: kept.origin,
      frame: [kept.frame.x, kept.frame.y, kept.frame.w, kept.frame.h], base: kept.base,
      objects: kept.objects.map((o) => o.id),
      cells: kept.cells.map((c) => [c.x, c.y, c.prior ? terrainToken(c.prior) : '_']),
      ...(kept.skipped ? { skipped: encodeSkipped(kept.skipped) } : null),
    });
  }
  return out.length > 0 ? out : undefined;
}

/** Whether `frame` is a frame a placement could have: inside the map, each side 1 to
 *  `BLUEPRINT_MAX_SIDE` cells. */
function frameFits(frame: Rect, state: GridState): boolean {
  const { width, height } = state.template;
  return frame.w >= 1 && frame.h >= 1 && frame.w <= BLUEPRINT_MAX_SIDE && frame.h <= BLUEPRINT_MAX_SIDE
    && frame.x >= 0 && frame.y >= 0 && frame.x + frame.w <= width && frame.y + frame.h <= height;
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

const clampName = (v: unknown): string | null => clampText(v, BLUEPRINT_NAME_MAX);

function encodeSkipped(body: BlueprintBody): NonNullable<SaveGroup['skipped']> {
  return { cells: body.cells.flatMap((c, i) => (c ? [[i, c] as [number, BlueprintCell]] : [])), objects: [...body.objects] };
}

/** A saved group's `skipped` in `frame`, admitted as a blueprint file's body is; undefined when
 *  absent or malformed, so the group lays what it holds. */
function decodeSkipped(raw: unknown, frame: Rect): BlueprintBody | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as { cells?: unknown; objects?: unknown };
  if (!Array.isArray(r.cells)) return undefined;
  const cells: unknown[] = new Array<unknown>((frame.w + 1) * (frame.h + 1)).fill(null);
  for (const c of r.cells) {
    if (!Array.isArray(c) || c.length !== 2 || !isInt(c[0]) || c[0] < 0 || c[0] >= cells.length || cells[c[0]] !== null) return undefined;
    cells[c[0]] = c[1];
  }
  const body = admitBlueprintBody({ w: frame.w, h: frame.h, cells, objects: r.objects });
  return body ? { ...body, objects: body.objects.map((o) => ({ ...o, catalogId: currentCatalogId(o.catalogId) })) } : undefined;
}

/** One saved group read against the map `state` decoded, with what the map holds as what it laid; null
 *  when malformed or when nothing of it is on the map. */
function decodeGroup(raw: unknown, state: GridState): PlacedGroup | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<Record<keyof SaveGroup, unknown>>;
  const name = clampName(r.name);
  const blueprint = isValidId(r.blueprint) ? r.blueprint : null;
  const f = Array.isArray(r.frame) && r.frame.length === 4 && r.frame.every(isInt) ? r.frame as number[] : null;
  const frame = f ? { x: f[0]!, y: f[1]!, w: f[2]!, h: f[3]! } : null;
  if (!isValidId(r.id) || !name || blueprint === null || !isValidElevation(r.base) || !frame || !frameFits(frame, state)) return null;
  if (!Array.isArray(r.objects) || !Array.isArray(r.cells)) return null;
  const objects = [...new Set(r.objects.filter((id): id is string => typeof id === 'string'))].flatMap((id) => {
    const o = state.objects.get(id);
    return o && !o.locked ? [clonePlacedObject(o)] : [];
  });
  const cells: GroupCell[] = [];
  for (const c of r.cells) {
    if (!Array.isArray(c) || c.length !== 3 || !isInt(c[0]) || !isInt(c[1]) || typeof c[2] !== 'string') continue;
    const laid = getCell(state.cells, c[0], c[1])?.terrain;
    const prior = c[2] === '_' ? null : c[2].startsWith('t') ? parseTerrain(c[2]) : undefined;
    if (!laid || prior === undefined || (c[2] !== '_' && prior === null)) continue;
    if (cells.some((m) => m.x === c[0] && m.y === c[1])) continue;
    cells.push({ x: c[0], y: c[1], laid: cloneTerrain(laid), prior });
  }
  if (objects.length === 0 && cells.length === 0) return null;
  // A placement lays nothing outside its frame: a member outside it marks the group as not one.
  const area = footprintTerrain(frame);
  if (cells.some((c) => !rectContains(area, c.x, c.y)) || objects.some((o) => !rectContains(frame, o.position.x, o.position.y))) return null;
  const skipped = decodeSkipped(r.skipped, frame);
  return {
    id: r.id, blueprint, name, origin: r.origin === null ? null : clampName(r.origin),
    frame, base: r.base as number, objects, cells, ...(skipped ? { skipped } : null),
  };
}

/** The groups a save holds, read against the map `state` it decoded; none when it holds none. A
 *  malformed group is left out, and an object or cell no other group already claims. */
export function decodeGroups(raw: unknown, state: GridState): PlacedGroup[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: PlacedGroup[] = [];
  const objects = new Set<string>(), cells = new Set<string>();
  for (const entry of raw.slice(0, GROUPS_MAX)) {
    const g = decodeGroup(entry, state);
    if (!g || out.some((o) => o.id === g.id)) continue;
    const own = {
      ...g,
      objects: g.objects.filter((o) => !objects.has(o.id)),
      cells: g.cells.filter((c) => !cells.has(cellKey(c.x, c.y))),
    };
    if (own.objects.length === 0 && own.cells.length === 0) continue;
    for (const o of own.objects) objects.add(o.id);
    for (const c of own.cells) cells.add(cellKey(c.x, c.y));
    out.push(own);
  }
  return out.length > 0 ? out : undefined;
}
