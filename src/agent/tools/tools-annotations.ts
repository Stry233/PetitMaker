import {
  ANNOTATION_COLORS, SELECTABLE_ANNOTATION_TAGS, generateAnnotationId, isTagId, nextZoneNumber,
  type MapAnnotation,
} from '../../core/model/annotations';
import { anchorHandles } from '../../core/model/spline';
import type { GridState, MacroCoord } from '../../core/model/types';
import type { AgentToolDeps, ToolResultBody } from './tools-common';
import type { ToolSchema } from './types';

const point = { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'], additionalProperties: false };

export const ANNOTATION_TOOL_SCHEMAS: ToolSchema[] = [
  {
    name: 'get_annotations',
    description: 'Read planning annotations, their stable IDs, geometry, tags, visibility and lock state. These are planning ink, not terrain or placed objects. Optional id reads one annotation. Unfinished user drafts are separate and cannot be edited by these tools.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
  },
  {
    name: 'set_annotation',
    description: 'Create a planning annotation, or update the supplied id. Updates preserve omitted fields and cannot change kind. Zone cells and measurement endpoints use integer map coordinates; chips and routes may use fractional coordinates. Zones may have tag null. Chips require a tag. Measurements require two aligned endpoints. This edits annotation history independently of terrain history.',
    inputSchema: {
      type: 'object', properties: {
        id: { type: 'string' }, kind: { type: 'string', enum: ['zone', 'chip', 'route', 'measure'] },
        tag: { type: ['string', 'null'], enum: [...SELECTABLE_ANNOTATION_TAGS.map(t => t.id), null] },
        color: { type: 'string', enum: [...ANNOTATION_COLORS] }, size: { type: 'string', enum: ['s', 'm', 'l'] },
        cells: { type: 'array', items: point, minItems: 1 },
        points: { type: 'array', items: point, minItems: 2 },
        x: { type: 'number' }, y: { type: 'number' }, dashed: { type: 'boolean' }, flipped: { type: 'boolean' },
      }, additionalProperties: false,
    },
  },
  {
    name: 'remove_annotation',
    description: 'Remove one finished planning annotation by its id. Read get_annotations first. Respects the annotation lock and selected region; never removes terrain, objects or an unfinished draft.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
];

export function annotationContext(state: GridState): string {
  const notes = state.annotations;
  return `Planning annotations: ${notes?.items.length ?? 0}; visible=${notes?.visible ?? true}; locked=${notes?.locked ?? false}. Use get_annotations to read their IDs and geometry. Annotation edits use the Notes undo lane; terrain undo and job rewind do not change them.`;
}

export function getAnnotations(deps: AgentToolDeps, input: Record<string, unknown>): ToolResultBody {
  const data = deps.getState().annotations;
  const items = data?.items ?? [];
  if (input.id !== undefined && !items.some(n => n.id === input.id)) return failure('Annotation id not found.');
  return { isError: false, content: JSON.stringify({ visible: data?.visible ?? true, locked: data?.locked ?? false, items: input.id === undefined ? items : items.filter(n => n.id === input.id) }) };
}

const failure = (content: string): ToolResultBody => ({ isError: true, content });

function points(value: unknown, state: GridState, whole: boolean): MacroCoord[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > state.template.width * state.template.height) return null;
  const result: MacroCoord[] = [];
  for (const p of value) {
    if (!p || typeof p !== 'object' || typeof p.x !== 'number' || typeof p.y !== 'number'
      || !Number.isFinite(p.x) || !Number.isFinite(p.y)
      || p.x < 0 || p.y < 0 || p.x >= state.template.width || p.y >= state.template.height
      || (whole && (!Number.isInteger(p.x) || !Number.isInteger(p.y)))) return null;
    result.push({ x: p.x, y: p.y });
  }
  return result;
}

/** A region must contain the whole old and new geometry, including space between route anchors. */
function insideRegion(note: MapAnnotation, region: MacroCoord[]): boolean {
  if (!region.length) return true;
  const allowed = new Set(region.map(p => `${p.x},${p.y}`));
  if (note.kind === 'zone') return note.cells.every(p => allowed.has(`${p.x},${p.y}`));
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
      if (!allowed.has(`${x},${y}`)) return false;
    }
  }
  return true;
}

export function editAnnotation(deps: AgentToolDeps, input: Record<string, unknown>, remove = false): ToolResultBody {
  if (!deps.editAnnotations) return failure('Annotation editing is unavailable in this editor.');
  const state = deps.getState();
  const data = state.annotations;
  if (data?.locked || data?.visible === false) return failure('The annotation layer is locked or hidden. Ask the user to unlock or show Notes.');
  const existing = data?.items.find(n => n.id === input.id);
  if ((input.id !== undefined || remove) && !existing) return failure('Annotation id not found.');
  const region = deps.getRegion();
  if (existing && !insideRegion(existing, region)) return failure('OUT OF REGION: the entire annotation must be inside the selected region.');
  if (remove) {
    if (!deps.editAnnotations(items => items.filter(n => n.id !== existing!.id))) return failure('The active map changed.');
    return { isError: false, content: `Removed annotation ${existing!.id}.` };
  }
  const value: Record<string, unknown> = { ...existing, ...input };
  if (existing && value.kind !== existing.kind) return failure('An annotation update cannot change its kind.');
  const color = value.color ?? ANNOTATION_COLORS[0]!;
  const size = value.size ?? 'm';
  const tag = value.tag ?? null;
  if (typeof color !== 'string' || !ANNOTATION_COLORS.includes(color)) return failure('Choose an annotation palette color.');
  if (size !== 's' && size !== 'm' && size !== 'l') return failure('Size must be s, m or l.');
  if (tag !== null && (!isTagId(tag) || (!SELECTABLE_ANNOTATION_TAGS.some(t => t.id === tag) && !(existing && 'tag' in existing && existing.tag === tag)))) return failure('Choose a supported annotation tag or null for an untagged zone.');
  for (const key of ['dashed', 'flipped']) if (value[key] !== undefined && typeof value[key] !== 'boolean') return failure(`${key} must be a boolean.`);
  const id = existing?.id ?? generateAnnotationId();
  let note: MapAnnotation;
  if (value.kind === 'zone') {
    const cells = points(value.cells, state, true);
    if (!cells) return failure('A zone needs nonempty integer cells within the map.');
    note = { kind: 'zone', id, color, size, tag, cells: [...new Map(cells.map(p => [`${p.x},${p.y}`, p])).values()], num: existing?.kind === 'zone' ? existing.num : nextZoneNumber(data?.items ?? []) };
  } else if (value.kind === 'chip') {
    if (!tag || !points([{ x: value.x, y: value.y }], state, false)) return failure('A chip needs a tag and an in-map position.');
    note = { kind: 'chip', id, color, size, tag, x: value.x as number, y: value.y as number };
  } else if (value.kind === 'route' || value.kind === 'measure') {
    const coords = points(value.points, state, value.kind === 'measure');
    if (!coords || coords.length < 2) return failure('At least two valid points are required.');
    if (value.kind === 'measure') {
      if (coords.length !== 2 || (coords[0]!.x !== coords[1]!.x && coords[0]!.y !== coords[1]!.y)) return failure('Measurement endpoints must share a row or column.');
      note = { kind: 'measure', id, color, points: [coords[0]!, coords[1]!], flipped: value.flipped === true };
    } else {
      note = { kind: 'route', id, color, points: input.points === undefined && existing?.kind === 'route' ? existing.points : coords, dashed: value.dashed !== false };
    }
  } else return failure('Choose zone, chip, route or measure.');
  if (!insideRegion(note, region)) return failure('OUT OF REGION: the entire annotation must be inside the selected region.');
  if (!deps.editAnnotations(items => existing ? items.map(n => n.id === id ? note : n) : [...items, note])) return failure('The active map changed.');
  return { isError: false, content: JSON.stringify(note) };
}
