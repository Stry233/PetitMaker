import { CUSTOM_TAG_MAX, HALVES, ZONE_CELL_MAX, chipTextSize, generateAnnotationId, generateCustomTagId, isCustomTagId, nextZoneNumber, zoneHalfCells, type CustomTag, type MapAnnotation, type NoteTag } from '../../core/model/annotations';
import { ANNOTATION_COLORS } from '../../config/annotation-palette';
import { SELECTABLE_ANNOTATION_TAGS, isTagId } from '../../config/annotation-tags';
import { anchorHandles } from '../../core/base/spline';
import type { GridState, MacroCoord } from '../../core/model/types';
import { ellipseCells, lineCells, polygonCells, rectCells } from '../../core/grid/shapes';
import { floodFrom } from '../../core/grid/cell-sets';
import { PLANET_NAME_MAX } from '../../io/save/facts';
import type { AgentToolDeps } from './deps';
import { bool, int, list, num, obj, oneOf, req, str } from './schema';
import { defineTool, type ToolOutcome } from './spec';
import { cellKey } from '../../core/grid/rect';
import { noteLabel, openGround, surveyAnnotations, surveyText, zoneLine, zoneWholeCells } from './annotation-survey';
import { BUILDABLE_ZONES } from './game-terms';

const point = obj({ x: req(num()), y: req(num()) }, { closed: true });

const SHAPE_TYPES = ['rect', 'ellipse', 'ring', 'polygon', 'band', 'fill'] as const;

const shape = obj({
  type: req(oneOf([...SHAPE_TYPES])),
  x1: num(), y1: num(), x2: num(), y2: num(),
  points: list(point, { minItems: 2 }),
  width: int({ min: 1, max: 40, description: 'band: its width in cells; ring: its thickness.' }),
  x: num(), y: num(),
  cut: bool({ description: 'Subtract this shape from the shapes before it instead of adding it.' }),
}, { closed: true });

export const getAnnotationsTool = defineTool({
  description: 'Read the planning annotations. Without id: a compact survey of every zone (number, tag, colour, id, area, bounds, pieces, touching zones), overlaps, how much open buildable ground the zones cover, circulation (entrance zones and routes) and whether it reaches the fixed landmarks, the largest unplanned ground, and every chip, route and measure. With id: that one annotation in full, its cells included. These are planning ink, not terrain or placed objects. Unfinished user drafts are separate and cannot be edited by these tools.',
  input: obj({ id: str() }),
  access: 'read',
  verifies: true,
  run: (deps, input) => getAnnotations(deps, input),
});

export const setAnnotationTool = defineTool({
  description: `Create a planning annotation, or update the supplied id. Updates preserve omitted fields and cannot change kind. A zone takes shapes (preferred) or explicit cells. Shapes are unioned in order and a shape with cut subtracts: rect and ellipse fill the inclusive box x1,y1,x2,y2; ring is that ellipse's outline of the given width; polygon fills its points (diagonal edges allowed); band is a path of the given width through its points; fill floods from x,y across the open ground no other zone claims, stopped by other zones and by the box x1..y2 when given. clip decides what shapes keep: "unclaimed" (default) keeps open ${BUILDABLE_ZONES} ground that no other zone holds, so zones tile without overlapping, "ground" keeps open ${BUILDABLE_ZONES} ground even where other zones lie, "none" keeps every in-map cell. Open ground excludes fixed landmarks. mode "add" or "cut" changes an existing zone's cells instead of replacing them. Explicit cells use integer map coordinates and are kept as given. tag takes a preset; customTag names a facility in the user's language (at most ${PLANET_NAME_MAX} characters) and creates or reuses the map's custom tag. Chips mark a point and require a tag or customTag. Routes are arrows through points, dashed by default. Measurements take two endpoints on one row or column, multiples of 0.5. New zones are numbered in creation order. The result summarizes the annotation instead of echoing its cells. This edits annotation history independently of terrain history.`,
  input: obj({
    id: str(),
    kind: oneOf(['zone', 'chip', 'route', 'measure']),
    tag: oneOf([...SELECTABLE_ANNOTATION_TAGS.map(t => t.id), null]),
    customTag: str({ description: 'The text of a custom tag, in the user\'s language.' }),
    color: oneOf([...ANNOTATION_COLORS]),
    size: oneOf(['s', 'm', 'l', 'none'], { description: 'Caption size; none draws a zone with no caption, as paths in a dense plan.' }),
    shapes: list(shape, { minItems: 1, maxItems: 24 }),
    clip: oneOf(['unclaimed', 'ground', 'none']),
    mode: oneOf(['replace', 'add', 'cut']),
    cells: list(point, { minItems: 1 }),
    points: list(point, { minItems: 2 }),
    x: num(),
    y: num(),
    dashed: bool(),
    flipped: bool(),
  }, { closed: true }),
  access: 'write',
  sketches: true,
  example: 'kind: "zone", tag: "homes", shapes: [{ type: "rect", x1: 40, y1: 20, x2: 70, y2: 38 }, { type: "band", points: [{ x: 40, y: 29 }, { x: 70, y: 29 }], width: 3, cut: true }]',
  run: (deps, input) => editAnnotation(deps, input),
});

export const removeAnnotationTool = defineTool({
  description: 'Remove one finished planning annotation by its id. Read get_annotations first. Respects the annotation lock and selected region; never removes terrain, objects or an unfinished draft.',
  input: obj({ id: req(str()) }),
  access: 'write',
  run: (deps, input) => editAnnotation(deps, input, true),
});

/** The annotation line of the map context: counts, the layer's state and every standing zone,
 *  so a plan the user drew reads as part of the order. */
export function annotationContext(state: GridState): string {
  const notes = state.annotations;
  const items = notes?.items ?? [];
  const head = `Planning annotations: ${items.length}; visible=${notes?.visible ?? true}; locked=${notes?.locked ?? false}.`;
  if (items.length === 0) return `${head} Annotation edits use the Annotations undo lane; terrain undo and job rewind do not change them.`;
  const survey = surveyAnnotations(state);
  const zones = survey.zones.slice(0, 24).map((z) => zoneLine(z, survey.content.get(z.id)));
  const others = items.filter((n) => n.kind !== 'zone').slice(0, 12).map((n) => otherLine(state, n));
  const more = items.length - zones.length - others.length;
  return [
    `${head} These stood before this order; they are requirements or earlier plans, and stay unless the user asks to change them.`,
    ...zones, ...others, ...(more > 0 ? [`and ${more} more (get_annotations).`] : []),
  ].join('\n');
}

function otherLine(state: GridState, n: MapAnnotation): string {
  const at = (p: MacroCoord) => `(${p.x},${p.y})`;
  if (n.kind === 'chip') return `chip ${noteLabel(state.annotations, n)} ${n.color} id=${n.id} at ${at(n)}`;
  if (n.kind === 'route') return `route ${n.color} id=${n.id}${n.dashed ? ' dashed' : ''} through ${n.points.map(at).join(' ')}`;
  if (n.kind === 'measure') return `measure ${n.color} id=${n.id} ${at(n.points[0])}-${at(n.points[1])}`;
  return '';
}

function getAnnotations(deps: AgentToolDeps, input: Record<string, unknown>): ToolOutcome {
  const state = deps.getState();
  const data = state.annotations;
  const items = data?.items ?? [];
  if (input.id !== undefined) {
    const note = items.find(n => n.id === input.id);
    if (!note) return failure('Annotation id not found.');
    return { isError: false, content: JSON.stringify({ ...note, ...(noteLabel(data, note) ? { label: noteLabel(data, note) } : {}) }) };
  }
  const others = items.filter((n) => n.kind !== 'zone').map((n) => otherLine(state, n));
  const tags = (data?.customTags ?? []).map((t) => t.text);
  return { isError: false, content: [
    `visible=${data?.visible ?? true}; locked=${data?.locked ?? false}.`,
    surveyText(surveyAnnotations(state)),
    ...others,
    ...(tags.length ? [`Custom tags: ${tags.join(', ')}.`] : []),
  ].join('\n') };
}

const failure = (content: string): ToolOutcome => ({ isError: true, content });

/** Coordinates on the lattice of `per` steps a cell, or free with 0. */
function points(value: unknown, state: GridState, per: number): MacroCoord[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > state.template.width * state.template.height) return null;
  const result: MacroCoord[] = [];
  for (const p of value) {
    if (!p || typeof p !== 'object' || typeof p.x !== 'number' || typeof p.y !== 'number'
      || !Number.isFinite(p.x) || !Number.isFinite(p.y)
      || p.x < 0 || p.y < 0 || p.x >= state.template.width || p.y >= state.template.height
      || (per > 0 && (!Number.isInteger(p.x * per) || !Number.isInteger(p.y * per)))) return null;
    result.push({ x: p.x, y: p.y });
  }
  return result;
}

/** A region must contain the whole old and new geometry, including space between route anchors. */
function insideRegion(note: MapAnnotation, region: MacroCoord[]): boolean {
  if (!region.length) return true;
  const allowed = new Set(region.map(p => cellKey(p.x, p.y)));
  // A zone on the half grid needs every whole cell it touches.
  if (note.kind === 'zone') return zoneHalfCells(note).every(p => allowed.has(cellKey(Math.floor(p.x / HALVES), Math.floor(p.y / HALVES))));
  const vertices: MacroCoord[] = note.kind === 'chip' ? [note] : [...note.points];
  if (note.kind === 'route') {
    const handles = anchorHandles(note.points);
    note.points.forEach((p, i) => {
      const h = handles[i]!;
      if (i < note.points.length - 1) vertices.push({ x: p.x + h.hx, y: p.y + h.hy });
      if (i > 0) vertices.push({ x: p.x + h.ihx, y: p.y + h.ihy });
    });
  }
  const xs = vertices.map(p => p.x), ys = vertices.map(p => p.y);
  for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
    for (let x = Math.floor(Math.min(...xs)); x <= Math.ceil(Math.max(...xs)); x++) {
      if (!allowed.has(cellKey(x, y))) return false;
    }
  }
  return true;
}

type ShapeInput = {
  type: typeof SHAPE_TYPES[number]; x1?: number; y1?: number; x2?: number; y2?: number;
  points?: MacroCoord[]; width?: number; x?: number; y?: number; cut?: boolean;
};

/** The in-map cells one shape covers, or the reason it covers none. `claimed` marks the flat
 *  indices other zones hold, which a fill does not cross. */
function shapeCells(s: ShapeInput, state: GridState, ground: Uint8Array, claimed: Uint8Array): Set<number> | string {
  const W = state.template.width, H = state.template.height;
  const clampX = (v: number) => Math.max(0, Math.min(W - 1, Math.round(v)));
  const clampY = (v: number) => Math.max(0, Math.min(H - 1, Math.round(v)));
  const box = [s.x1, s.y1, s.x2, s.y2].every((v) => typeof v === 'number' && Number.isFinite(v))
    ? { x1: clampX(Math.min(s.x1!, s.x2!)), y1: clampY(Math.min(s.y1!, s.y2!)), x2: clampX(Math.max(s.x1!, s.x2!)), y2: clampY(Math.max(s.y1!, s.y2!)) }
    : undefined;
  const pts = s.points?.map((p) => ({ x: Math.max(0, Math.min(W - 1, p.x)), y: Math.max(0, Math.min(H - 1, p.y)) }));
  let cells: MacroCoord[];
  switch (s.type) {
    case 'rect':
      if (!box) return `${s.type} needs x1, y1, x2 and y2.`;
      cells = rectCells({ x: box.x1, y: box.y1 }, { x: box.x2, y: box.y2 });
      break;
    case 'ellipse':
      if (!box) return `${s.type} needs x1, y1, x2 and y2.`;
      cells = ellipseCells(box.x1, box.y1, box.x2, box.y2);
      break;
    case 'ring': {
      if (!box) return 'ring needs x1, y1, x2, y2 and width.';
      const w = s.width ?? 1;
      const inner = box.x2 - box.x1 >= 2 * w && box.y2 - box.y1 >= 2 * w
        ? new Set(ellipseCells(box.x1 + w, box.y1 + w, box.x2 - w, box.y2 - w).map((c) => cellKey(c.x, c.y)))
        : new Set<string>();
      cells = ellipseCells(box.x1, box.y1, box.x2, box.y2).filter((c) => !inner.has(cellKey(c.x, c.y)));
      break;
    }
    case 'polygon':
      if (!pts || pts.length < 3) return 'polygon needs at least three points.';
      cells = polygonCells(pts);
      break;
    case 'band': {
      if (!pts) return 'band needs at least two points.';
      const round = pts.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
      cells = round.slice(1).flatMap((p, i) => lineCells(round[i]!, p, s.width ?? 1));
      break;
    }
    case 'fill': {
      if (typeof s.x !== 'number' || typeof s.y !== 'number') return 'fill needs a seed x and y.';
      const sx = clampX(s.x), sy = clampY(s.y), seed = sy * W + sx;
      if (!ground[seed] || claimed[seed]) return `fill's seed (${sx},${sy}) is not open unclaimed ground.`;
      const inBox = (i: number) => { const x = i % W, y = (i - x) / W; return !box || (x >= box.x1 && x <= box.x2 && y >= box.y1 && y <= box.y2); };
      const reach = floodFrom([seed], (i) => ground[i] === 1 && !claimed[i] && inBox(i), W, H);
      const out = new Set<number>();
      for (let i = 0; i < reach.length; i++) if (reach[i]) out.add(i);
      return out;
    }
  }
  const out = new Set<number>();
  for (const c of cells) if (c.x >= 0 && c.y >= 0 && c.x < W && c.y < H) out.add(c.y * W + c.x);
  return out;
}

/** A zone's cells from its shapes under `clip` and the selected region, with what was clipped. */
function resolveShapes(
  deps: AgentToolDeps, shapes: ShapeInput[], clip: string, selfId: string | undefined,
): { cells: Set<number>; offGround: number; claimed: number; outside: number } | string {
  const state = deps.getState();
  const W = state.template.width, H = state.template.height;
  const { ground } = openGround(state);
  const claimed = new Uint8Array(W * H);
  for (const n of state.annotations?.items ?? []) {
    if (n.kind === 'zone' && n.id !== selfId) for (const i of zoneWholeCells(n, W, H)) claimed[i] = 1;
  }
  const union = new Set<number>();
  for (const [k, s] of shapes.entries()) {
    const cells = shapeCells(s, state, ground, claimed);
    if (typeof cells === 'string') return `shapes[${k}]: ${cells}`;
    for (const i of cells) if (s.cut) union.delete(i); else union.add(i);
  }
  const region = deps.getRegion();
  const allowed = region.length ? new Set(region.map((p) => p.y * W + p.x)) : null;
  const out = new Set<number>();
  let offGround = 0, taken = 0, outside = 0;
  for (const i of union) {
    if (allowed && !allowed.has(i)) { outside++; continue; }
    if (clip !== 'none' && !ground[i]) { offGround++; continue; }
    if (clip === 'unclaimed' && claimed[i]) { taken++; continue; }
    out.add(i);
  }
  return { cells: out, offGround, claimed: taken, outside };
}

/** The custom tag reading `text` in `tags`, created when new; null when the map holds no more. */
function customTagFor(tags: CustomTag[], text: string): { tags: CustomTag[]; id: NoteTag } | null {
  const same = tags.find((t) => t.text === text);
  if (same) return { tags, id: same.id };
  if (tags.length >= CUSTOM_TAG_MAX) return null;
  const tag: CustomTag = { id: generateCustomTagId(), text };
  return { tags: [...tags, tag], id: tag.id };
}

function editAnnotation(deps: AgentToolDeps, input: Record<string, unknown>, remove = false): ToolOutcome {
  if (!deps.editAnnotations) return failure('Annotation editing is unavailable in this editor.');
  const state = deps.getState();
  const data = state.annotations;
  if (data?.locked || data?.visible === false) return failure('The annotation layer is locked or hidden. Ask the user to unlock or show Annotations.');
  const existing = data?.items.find(n => n.id === input.id);
  if ((input.id !== undefined || remove) && !existing) return failure('Annotation id not found.');
  const region = deps.getRegion();
  if (existing && !insideRegion(existing, region)) return failure('OUT OF REGION: the entire annotation must be inside the selected region.');
  if (remove) {
    if (!deps.editAnnotations(notes => ({ ...notes, items: notes.items.filter(n => n.id !== existing!.id) }))) return failure('The active map changed.');
    return { isError: false, content: `Removed annotation ${existing!.id}.` };
  }
  const value: Record<string, unknown> = { ...existing, ...input };
  if (value.kind === undefined && (input.shapes !== undefined || input.cells !== undefined)) value.kind = 'zone';
  if (existing && value.kind !== existing.kind) return failure('An annotation update cannot change its kind.');
  const color = value.color ?? ANNOTATION_COLORS[0]!;
  const size = value.size ?? 'm';
  if (typeof color !== 'string' || !ANNOTATION_COLORS.includes(color)) return failure('Choose an annotation palette color.');
  if (size !== 's' && size !== 'm' && size !== 'l' && !(size === 'none' && value.kind === 'zone')) return failure('Size must be s, m or l; none is for zones only.');
  let customTags = data?.customTags ?? [];
  let tag = (value.tag ?? null) as NoteTag | null;
  if (typeof input.customTag === 'string') {
    const text = input.customTag.trim();
    if (!text || [...text].length > PLANET_NAME_MAX) return failure(`customTag needs 1 to ${PLANET_NAME_MAX} characters.`);
    const made = customTagFor(customTags, text);
    if (!made) return failure(`The map already holds ${CUSTOM_TAG_MAX} custom tags; reuse one or a preset tag.`);
    customTags = made.tags;
    tag = made.id;
  } else if (tag !== null && (!(isTagId(tag) || isCustomTagId(tag)) || (!SELECTABLE_ANNOTATION_TAGS.some(t => t.id === tag) && !(existing && 'tag' in existing && existing.tag === tag)))) {
    // A note keeps the tag it already wears, a retired preset or one of the map's custom tags.
    return failure('Choose a supported annotation tag, a customTag, or null for an untagged zone.');
  }
  for (const key of ['dashed', 'flipped']) if (value[key] !== undefined && typeof value[key] !== 'boolean') return failure(`${key} must be a boolean.`);
  const id = existing?.id ?? generateAnnotationId();
  let note: MapAnnotation;
  let clipNote = '';
  if (value.kind === 'zone') {
    const num = existing?.kind === 'zone' ? existing.num : nextZoneNumber(data?.items ?? []);
    const W = state.template.width;
    if (input.shapes !== undefined) {
      const resolved = resolveShapes(deps, input.shapes as ShapeInput[], (input.clip as string | undefined) ?? 'unclaimed', existing?.id);
      if (typeof resolved === 'string') return failure(resolved);
      let cells = resolved.cells;
      const mode = input.mode ?? 'replace';
      if (mode !== 'replace' && existing?.kind === 'zone') {
        const own = zoneWholeCells(existing, W, state.template.height);
        if (mode === 'add') for (const i of own) cells.add(i);
        else { for (const i of cells) own.delete(i); cells = own; }
      }
      const parts = [
        resolved.offGround && `${resolved.offGround} off open ground`,
        resolved.claimed && `${resolved.claimed} already in other zones`,
        resolved.outside && `${resolved.outside} outside the selected region`,
      ].filter(Boolean);
      clipNote = parts.length ? ` Clipped ${parts.join(', ')}.` : '';
      if (cells.size > ZONE_CELL_MAX) return failure(`The shapes give this zone ${cells.size} cells; a zone holds at most ${ZONE_CELL_MAX}. Split it into smaller zones by function.`);
      if (cells.size === 0) return failure(`The shapes leave no cells for this zone.${clipNote} Aim at open ${BUILDABLE_ZONES} ground, or choose clip "ground" to overlap other zones.`);
      note = { kind: 'zone', id, color, size, tag, num, cells: [...cells].sort((a, b) => a - b).map((i) => ({ x: i % W, y: Math.floor(i / W) })) };
    } else if (input.cells === undefined && existing?.kind === 'zone') {
      // Omitted cells keep the zone's own, on whichever grid they lie.
      note = { ...existing, color, size, tag, num };
    } else {
      const cells = points(value.cells, state, 1);
      if (!cells) return failure('A zone needs shapes, or nonempty integer cells within the map.');
      note = { kind: 'zone', id, color, size, tag, cells: [...new Map(cells.map(p => [cellKey(p.x, p.y), p])).values()], num };
    }
  } else if (value.kind === 'chip') {
    if (!tag || !points([{ x: value.x, y: value.y }], state, 0)) return failure('A chip needs a tag or customTag and an in-map position.');
    note = { kind: 'chip', id, color, size: chipTextSize(size), tag, x: value.x as number, y: value.y as number };
  } else if (value.kind === 'route' || value.kind === 'measure') {
    const coords = points(value.points, state, value.kind === 'measure' ? HALVES : 0);
    if (!coords || coords.length < 2) return failure('At least two valid points are required.');
    if (value.kind === 'measure') {
      if (coords.length !== 2 || (coords[0]!.x !== coords[1]!.x && coords[0]!.y !== coords[1]!.y)) return failure('Measurement endpoints must share a row or column.');
      note = { kind: 'measure', id, color, points: [coords[0]!, coords[1]!], flipped: value.flipped === true };
    } else {
      note = { kind: 'route', id, color, points: input.points === undefined && existing?.kind === 'route' ? existing.points : coords, dashed: value.dashed !== false };
    }
  } else return failure('Choose zone, chip, route or measure.');
  if (!insideRegion(note, region)) return failure('OUT OF REGION: the entire annotation must be inside the selected region.');
  const used = new Set((existing ? data!.items.map(n => n.id === id ? note : n) : [...(data?.items ?? []), note])
    .flatMap((n) => (n.kind === 'zone' || n.kind === 'chip') && n.tag ? [n.tag] : []));
  // A custom tag this call created and the note does not wear stays off the map.
  const tags = customTags.filter((t) => used.has(t.id) || (data?.customTags ?? []).some((old) => old.id === t.id));
  if (!deps.editAnnotations(notes => ({
    items: existing ? notes.items.map(n => n.id === id ? note : n) : [...notes.items, note],
    customTags: tags,
  }))) return failure('The active map changed.');
  return { isError: false, content: `${existing ? 'Updated' : 'Created'} ${describeNote(deps.getState(), note)}.${clipNote}` };
}

/** One annotation as the write result reads it back. */
function describeNote(state: GridState, note: MapAnnotation): string {
  if (note.kind !== 'zone') return otherLine(state, note);
  return `zone ${zoneLine(surveyAnnotations(state).zones.find((z) => z.id === note.id)!)}`;
}

