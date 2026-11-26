// Decoding of a save's annotation record, shared by saves and share codes. The encoder writes the
// annotation state as it stands.
import { clampBrushSize } from '../../state/editing/edit-mode';
import { CUSTOM_TAG_MAX, HALVES, ZONE_CELL_MAX, admitTagText, generateAnnotationId, isCustomTagId, isMeasureSpan, zoneCellsOnGrid, type AnnotationsState, type CustomTag, type CustomTagId, type MapAnnotation, type NoteTag } from '../../core/model/annotations';
import { HALF_GRID } from '../../core/game/profile';
import { ID_MAX_LENGTH } from '../../core/base/guards';
import { ANNOTATION_COLORS } from '../../config/annotation-palette';
import { isTagId } from '../../config/annotation-tags';
import type { MacroCoord } from '../../core/model/types';
import type { CurveAnchor } from '../../core/base/spline';

/* Invalid annotations are discarded; collection, text and coordinate limits bound imported data.
 * Coordinates are in map cells, except a half-grid zone's cells, which count half cells under the
 * same area and coordinate caps. */
const ANNOT_MAX_ITEMS = 500;
const ANNOT_MAX_POINTS = 200;
const ANNOT_MAX_COORD = 1024;
const HEX_COLOR = /^#[0-9a-fA-F]{3,8}$/;

/** `v` when it is a finite coordinate within the map limit, counted in cells of `1 / per` map cells. */
function finiteCoord(v: unknown, per = 1): number | null {
  return typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= ANNOT_MAX_COORD * per ? v : null;
}

export function decodeAnnotations(raw: unknown): AnnotationsState | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as { items?: unknown; customTags?: unknown; visible?: unknown; locked?: unknown };
  if (!Array.isArray(r.items)) return undefined;
  const { tags: customTags, alias } = decodeCustomTags(r.customTags);
  // A tag the map does not carry, preset or custom, reads as no tag.
  const tagOf = (v: unknown): NoteTag | null => (isTagId(v) ? v : isCustomTagId(v) ? alias.get(v) ?? null : null);
  const items: MapAnnotation[] = [];
  for (const entry of r.items.slice(0, ANNOT_MAX_ITEMS)) {
    const note = decodeAnnotation(entry, tagOf);
    if (note) items.push(note);
  }
  if (items.length === 0 && customTags.length === 0) return undefined;
  return { items, ...(customTags.length ? { customTags } : {}), visible: r.visible !== false, locked: r.locked === true };
}

/** A map's custom tags, each text admitted by `admitTagText`, once by id and once by text, with the
 *  tag each id now reads as: a tag whose text another holds goes, its notes wearing that one, since
 *  earlier releases kept texts longer than they read back. Saves from before custom tags carry none. */
function decodeCustomTags(raw: unknown): { tags: CustomTag[]; alias: Map<string, CustomTagId> } {
  const tags: CustomTag[] = [];
  const alias = new Map<string, CustomTagId>();
  if (!Array.isArray(raw)) return { tags, alias };
  const byText = new Map<string, CustomTagId>();
  for (const entry of raw) {
    if (tags.length >= CUSTOM_TAG_MAX) break;
    const { id, text: typed } = (entry ?? {}) as { id?: unknown; text?: unknown };
    const text = admitTagText(typed);
    if (!isCustomTagId(id) || id.length > ID_MAX_LENGTH || !text || alias.has(id)) continue;
    const same = byText.get(text);
    alias.set(id, same ?? id);
    if (same) continue;
    byText.set(text, id);
    tags.push({ id, text });
  }
  return { tags, alias };
}

function decodeAnnotation(raw: unknown, tagOf: (v: unknown) => NoteTag | null): MapAnnotation | null {
  if (!raw || typeof raw !== 'object') return null;
  const n = raw as Record<string, unknown>;
  const id = typeof n.id === 'string' && n.id ? n.id.slice(0, 40) : generateAnnotationId();
  const color = typeof n.color === 'string' && HEX_COLOR.test(n.color) ? n.color : ANNOTATION_COLORS[0]!;
  if (n.kind === 'zone') {
    if (!Array.isArray(n.cells)) return null;
    // A zone from before half cells names no grid and lies on whole cells.
    const half = n.grid === HALF_GRID;
    const per = half ? HALVES : 1;
    const cells: MacroCoord[] = [];
    for (const c of n.cells.slice(0, ZONE_CELL_MAX * per * per)) {
      const x = finiteCoord((c as MacroCoord)?.x, per);
      const y = finiteCoord((c as MacroCoord)?.y, per);
      if (x === null || y === null || !Number.isInteger(x) || !Number.isInteger(y)) continue;
      cells.push({ x, y });
    }
    if (cells.length === 0) return null;
    const on = half ? zoneCellsOnGrid(cells) : null;
    const num = typeof n.num === 'number' && Number.isInteger(n.num) && n.num > 0 && n.num < 10000 ? n.num : 0;
    // A zone from before tags arrives untagged; its free-text name is not carried.
    return {
      kind: 'zone', id, cells: on?.cells ?? cells, ...(on?.grid === HALF_GRID ? { grid: HALF_GRID } : {}), color, tag: tagOf(n.tag), num,
      // 'none' arrived with the font size control's no-text choice; earlier readers take it as 'm'.
      size: n.size === 's' || n.size === 'l' || n.size === 'none' ? n.size : 'm',
    };
  }
  // Free-text notes from before tags are dropped; typed words live only in the custom tags.
  if (n.kind === 'chip') {
    const x = finiteCoord(n.x);
    const y = finiteCoord(n.y);
    const tag = tagOf(n.tag);
    if (x === null || y === null || !tag) return null;
    return { kind: 'chip', id, x, y, tag, size: n.size === 's' || n.size === 'l' ? n.size : 'm', color };
  }
  if (n.kind === 'measure') {
    if (!Array.isArray(n.points) || n.points.length !== 2) return null;
    const points: MacroCoord[] = [];
    for (const p of n.points) {
      const x = finiteCoord(p?.x), y = finiteCoord(p?.y);
      if (x === null || y === null) return null;
      points.push({ x, y });
    }
    const [start, end] = points as [MacroCoord, MacroCoord];
    // Ends are cells cornered on the half-cell lattice; releases before half cells wrote whole cells.
    if (!isMeasureSpan([start, end])) return null;
    return { kind: 'measure', id, points: [start, end], color, ...(typeof n.flipped === 'boolean' ? { flipped: n.flipped } : {}) };
  }
  if (n.kind === 'route') {
    if (!Array.isArray(n.points)) return null;
    const points: CurveAnchor[] = [];
    // Direction handles are bounded offsets and each side is valid only as an x/y pair.
    const handle = (v: unknown): number | null =>
      typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 64 ? v : null;
    for (const c of n.points.slice(0, ANNOT_MAX_POINTS)) {
      const a = c as CurveAnchor;
      const x = finiteCoord(a?.x);
      const y = finiteCoord(a?.y);
      if (x === null || y === null) continue;
      const pt: CurveAnchor = { x, y };
      const hx = handle(a?.hx), hy = handle(a?.hy);
      if (hx !== null && hy !== null) { pt.hx = hx; pt.hy = hy; }
      const ihx = handle(a?.ihx), ihy = handle(a?.ihy);
      if (ihx !== null && ihy !== null) { pt.ihx = ihx; pt.ihy = ihy; }
      points.push(pt);
    }
    if (points.length < 2) return null;
    // Routes from before the width setting carry none and draw at 1, the width they always had.
    const width = typeof n.width === 'number' && Number.isInteger(n.width) && n.width > 1 ? clampBrushSize(n.width) : undefined;
    return { kind: 'route', id, points, color, dashed: n.dashed !== false, ...(width ? { width } : {}) };
  }
  return null;
}
