/** Planning annotations are independent of buildable map content and rule validation. Coordinates
 * use macro-grid cell units; zones and measurements use whole cells, while chips and routes may be fractional. */
import type { MacroCoord } from './types';
import { type CurveAnchor } from '../base/spline';
import { generateId } from './object-id';
import { cellCentre } from '../grid/grid-convert';
import { cellKey } from '../grid/rect';
import { gridCellAt } from '../grid/grids';
import { GRIDS, PLACEMENT_GRID } from '../game/profile';

/** A tag the map's author typed. Its text is drawn only once the text check has approved it. */
export interface CustomTag {
  id: CustomTagId;
  text: string;
}

/** The id a custom tag goes by; the prefix keeps it apart from every preset id. */
export type CustomTagId = `custom:${string}`;

/** A preset tag id. The kernel keeps any string the codec accepted; the preset vocabulary is app
 *  data the layers above own. */
export type PresetTagId = string & { readonly __presetTag?: never };

/** What a zone or chip carries as its label: a preset or one of the map's custom tags. */
export type NoteTag = PresetTagId | CustomTagId;

/** The most custom tags one map holds. */
export const CUSTOM_TAG_MAX = 32;

export function isCustomTagId(v: unknown): v is CustomTagId {
  return typeof v === 'string' && v.startsWith('custom:') && v.length > 'custom:'.length;
}

export function generateCustomTagId(): CustomTagId {
  return `custom:${generateId('t')}`;
}

/** The custom tag `tag` names in `tags`, if it is one. */
export function customTagOf(tags: readonly CustomTag[] | undefined, tag: NoteTag | null): CustomTag | undefined {
  return tag && isCustomTagId(tag) ? tags?.find((t) => t.id === tag) : undefined;
}

/** `items` without the custom tags in `gone`: a zone wearing one keeps its body untagged, and a
 *  chip, which is its tag, goes with it. */
export function withoutTagsOn(items: readonly MapAnnotation[], gone: ReadonlySet<string>): MapAnnotation[] {
  const out: MapAnnotation[] = [];
  for (const n of items) {
    if (n.kind === 'zone' && n.tag && gone.has(n.tag)) out.push({ ...n, tag: null });
    else if (n.kind !== 'chip' || !gone.has(n.tag)) out.push(n);
  }
  return out;
}

/** `state` without its custom tags `keep` refuses, and without their uses. */
export function keepCustomTags(state: AnnotationsState, keep: (tag: CustomTag) => boolean): AnnotationsState {
  const tags = state.customTags ?? [];
  const gone = new Set(tags.filter((t) => !keep(t)).map((t) => t.id));
  if (gone.size === 0) return state;
  const { customTags: _, ...rest } = state;
  const customTags = tags.filter((t) => !gone.has(t.id));
  return { ...rest, items: withoutTagsOn(state.items, gone), ...(customTags.length ? { customTags } : {}) };
}

/** A painted region with a stable number and an optional text tag. */
export interface ZoneNote {
  kind: 'zone';
  id: string;
  cells: MacroCoord[];
  /** A hex from `ANNOTATION_COLORS` today; any CSS hex renders. */
  color: string;
  tag: NoteTag | null;
  /** Stable display number; deleted numbers are not reused. */
  num: number;
  /** Caption size; an omitted value decodes as 'm', and 'none' draws no caption at all. */
  size?: ZoneTextSize;
}

/** The lettering sizes a chip can take. */
export type NoteTextSize = 's' | 'm' | 'l';
/** The font size control's values: a zone may also carry no text. */
export type ZoneTextSize = NoteTextSize | 'none';
/** The size a chip takes from the control: with 'none' armed it keeps the default lettering. */
export function chipTextSize(size: ZoneTextSize): NoteTextSize {
  return size === 'none' ? 'm' : size;
}

/** Whether a zone draws a caption: a number or a tag label, at a size that carries text. */
export function zoneHasCaption(zone: ZoneNote, label: string): boolean {
  return zone.size !== 'none' && (zone.num > 0 || label !== '');
}

/** A tag standing on its own plate, for marking a spot without painting a zone. */
export interface ChipNote {
  kind: 'chip';
  id: string;
  x: number;
  y: number;
  tag: NoteTag;
  size: NoteTextSize;
  color: string;
}

/** A routed arrow using the same adjustable curve anchors as terrain curves. */
export interface RouteNote {
  kind: 'route';
  id: string;
  points: CurveAnchor[];
  color: string;
  dashed: boolean;
  /** Line width in multiples of the annotation line, on the brush size slider's range; absent is 1. */
  width?: number;
}

/** A route's line width, in multiples of the annotation line. */
export function routeWidth(route: Pick<RouteNote, 'width'>): number {
  return route.width ?? 1;
}

/** Two cell centres on the same row or column define an inclusive measurement span. */
export interface MeasureNote {
  kind: 'measure';
  id: string;
  points: [MacroCoord, MacroCoord];
  color: string;
  /** Place the dimension above or left of the span instead of below or right. */
  flipped?: boolean;
}

export type MapAnnotation = ZoneNote | ChipNote | RouteNote | MeasureNote;

/** Annotation items, the map's own custom tags, and their shared visibility and edit lock. */
export interface AnnotationsState {
  items: MapAnnotation[];
  /** In the order they were added; absent when the map has none. */
  customTags?: CustomTag[];
  visible: boolean;
  locked: boolean;
}

function createAnnotationsState(): AnnotationsState {
  return { items: [], visible: true, locked: false };
}

/** `state`'s annotations, created empty on first use. */
export function annotationsOf(state: { annotations?: AnnotationsState }): AnnotationsState {
  return (state.annotations ??= createAnnotationsState());
}

/** Whether a finished note holds nothing to keep: a zone without cells or a route under two points. */
export function isEmptyNote(n: MapAnnotation): boolean {
  return n.kind === 'zone' ? n.cells.length === 0 : n.kind === 'route' ? n.points.length < 2 : false;
}

/** `n` wearing `tag`: a zone takes any tag or none, and a chip, which is its tag, keeps one. */
export function withTag(n: MapAnnotation, tag: NoteTag | null): MapAnnotation {
  return n.kind === 'zone' ? { ...n, tag } : n.kind === 'chip' && tag ? { ...n, tag } : n;
}

/** `items` with the zones among `ids` merged into the first of them: its tag, number, colour and
 *  size absorb the others' cells (deduplicated, in stable order) and the absorbed zones go. Ids that
 *  are not zones are ignored; null under two zones. */
export function mergeZones(items: readonly MapAnnotation[], ids: readonly string[]): { items: MapAnnotation[]; head: string } | null {
  const zones = ids
    .map((id) => items.find((n) => n.id === id))
    .filter((n): n is ZoneNote => n?.kind === 'zone');
  if (zones.length < 2) return null;
  const [head, ...rest] = zones as [ZoneNote, ...ZoneNote[]];
  const restIds = new Set(rest.map((z) => z.id));
  const cells = addZoneCells(head.cells, rest.flatMap((z) => z.cells));
  const merged = items.map((n) => (n.id === head.id ? { ...head, cells } : n)).filter((n) => !restIds.has(n.id));
  return { items: merged, head: head.id };
}

/** Whether two points span a measurement: whole cells on one row or column. */
export function isMeasureSpan(points: readonly [MacroCoord, MacroCoord]): boolean {
  if (points.some((p) => !Number.isInteger(p.x) || !Number.isInteger(p.y))) return false;
  return points[0].x === points[1].x || points[0].y === points[1].y;
}

/** `items` with the measurements among `ids` drawn on their other side. */
export function flipMeasures(items: readonly MapAnnotation[], ids: ReadonlySet<string>): MapAnnotation[] {
  return items.map((n) => (n.kind === 'measure' && ids.has(n.id) ? { ...n, flipped: !n.flipped } : n));
}

/** Generate an id unique within the session and unlikely to collide with loaded ids. */
export function generateAnnotationId(): string {
  return generateId('an');
}

/** Return one more than the highest assigned zone number. */
export function nextZoneNumber(annotations: readonly MapAnnotation[]): number {
  let max = 0;
  for (const a of annotations) if (a.kind === 'zone' && a.num > max) max = a.num;
  return max + 1;
}

/** Note cells are placement-grid cells, the grid roads and objects lie on, so a zone's edges meet
 *  road and object edges exactly in both views. Return the cell under the point `p`. */
export function zoneCellAt(p: { x: number; y: number }): MacroCoord {
  return gridCellAt(GRIDS[PLACEMENT_GRID], p.x, p.y);
}

/** The drawn centre of a note cell. */
export function zoneCellCentre(c: MacroCoord): { x: number; y: number } {
  return cellCentre(c);
}

/** Build the shared zone-cell lookup used by rendering and hit testing. */
export function zoneCellSet(cells: readonly MacroCoord[]): Set<string> {
  return new Set(cells.map((c) => cellKey(c.x, c.y)));
}

/** `cells` plus `more`, without duplicates and in stable order. */
export function addZoneCells(cells: readonly MacroCoord[], more: readonly MacroCoord[]): MacroCoord[] {
  const seen = zoneCellSet(cells);
  const out = [...cells];
  for (const c of more) {
    const k = cellKey(c.x, c.y);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

/** `cells` without any member of `gone`. */
export function removeZoneCells(cells: readonly MacroCoord[], gone: readonly MacroCoord[]): MacroCoord[] {
  const drop = zoneCellSet(gone);
  return cells.filter((c) => !drop.has(cellKey(c.x, c.y)));
}

