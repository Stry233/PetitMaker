/**
 * What a map's planning annotations claim, measured on whole cells: each zone's area, pieces,
 * neighbours and overlaps, how much open buildable ground the plan covers, and whether its
 * circulation reaches the fixed landmarks. The assistant reads it to check a plan it laid; the eval
 * rigs score plans with the same numbers.
 */
import { customTagOf, zoneHalfCells, HALVES, type AnnotationsState, type MapAnnotation, type ZoneNote } from '../../core/model/annotations';
import { TerrainType, type GridState } from '../../core/model/types';
import { isCoatingItem } from '../../core/model/traits';
import { getCatalogItem, itemRole } from '../../state/catalog';
import { isBuildableZone } from '../../core/game/zones';
import { NEIGHBORS4 } from '../../core/grid/directions';
import { components } from '../../core/grid/cell-sets';
import { line4 } from '../../core/grid/shapes';
import { wholeCellsOf } from '../../core/grid/footprint';
import { objectRect } from '../../state/object-geometry';
import { isCirculationTag } from '../../config/annotation-tags';

interface ZoneFact {
  id: string;
  num: number;
  /** The preset tag id, the custom tag's text, or null. */
  label: string | null;
  color: string;
  circulation: boolean;
  /** Whole cells the zone touches. */
  area: number;
  /** Cells off open buildable ground (outside it or under a fixed landmark). */
  offGround: number;
  /** 4-connected pieces. */
  pieces: number;
  bbox: { x1: number; y1: number; x2: number; y2: number };
  /** Numbers of the zones that share an edge or a cell with this one. */
  neighbours: number[];
  /** A circulation zone's typical width in cells. */
  width?: number;
}

/** The typical thickness of a cell set: the median, over its cells, of the shorter of the row and
 *  column runs through each cell. A band drawn at any angle reads about its drawn width. */
function typicalWidth(cells: Set<number>, W: number): number {
  const run = (i: number, step: number, sameLine: (j: number) => boolean) => {
    let n = 1;
    for (let j = i + step; cells.has(j) && sameLine(j); j += step) n++;
    for (let j = i - step; cells.has(j) && sameLine(j); j -= step) n++;
    return n;
  };
  const thick: number[] = [];
  for (const i of cells) {
    const row = Math.floor(i / W);
    thick.push(Math.min(run(i, 1, (j) => Math.floor(j / W) === row), run(i, W, () => true)));
  }
  thick.sort((a, b) => a - b);
  return thick.length ? thick[thick.length >> 1]! : 0;
}

export interface AnnotationSurvey {
  /** Buildable cells not under a locked object. */
  ground: number;
  /** Ground cells inside at least one zone. */
  covered: number;
  /** Ground cells inside two or more zones. */
  overlap: number;
  zones: ZoneFact[];
  /** Zone pairs sharing cells, by number, largest first. */
  overlaps: { a: number; b: number; cells: number }[];
  circulation: {
    /** Cells of circulation zones and routes. */
    cells: number;
    pieces: number;
    /** Locked landmarks (by catalog id) circulation runs beside or onto. */
    reaches: string[];
    landmarks: string[];
    /** Non-circulation zones sharing no edge with circulation. */
    apart: number[];
  };
  chips: number;
  /** Chips standing inside a zone. */
  chipsOnZones: number;
  routes: number;
  measures: number;
  /** Labels worn in more than one colour. */
  mixedColours: { label: string; colours: string[] }[];
  /** The largest pieces of open ground no zone covers. */
  unplanned: { cells: number; bbox: { x1: number; y1: number; x2: number; y2: number } }[];
  /** What the edges of the zones that are not circulation meet, in cell edges. */
  edges: ParcelEdges;
  /** How many zones wear each label, most first. */
  labels: { label: string; zones: number }[];
  /** The largest zone that is not circulation and its share of the cells such zones hold. */
  largest: { num: number; share: number } | null;
  /** What each zone holds, by zone id, and what stands on open ground outside every zone. */
  content: Map<string, ZoneContent>;
  outside: Partial<Record<ContentKind, number>>;
}

interface ParcelEdges { parcels: number; paths: number; fixed: number; open: number }

/** What the edges of the parcels (zones `isPath` does not mark) meet: another parcel, a path, ground
 *  that is not open (coast, a landmark, the map edge or ground outside `ground`), or open ground no
 *  zone holds. */
export function parcelEdges(cellsOf: readonly Set<number>[], isPath: readonly boolean[], ground: Uint8Array, W: number, H: number): ParcelEdges {
  const path = new Uint8Array(W * H), held = new Int32Array(W * H).fill(-1);
  cellsOf.forEach((cells, k) => { for (const i of cells) { if (isPath[k]) path[i] = 1; else if (held[i] === -1) held[i] = k; } });
  const out: ParcelEdges = { parcels: 0, paths: 0, fixed: 0, open: 0 };
  cellsOf.forEach((cells, k) => {
    if (isPath[k]) return;
    for (const i of cells) {
      const x = i % W, y = (i - x) / W;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
        const j = ny * W + nx;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H && cells.has(j)) continue;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || !ground[j]) out.fixed++;
        else if (path[j]) out.paths++;
        else if (held[j] !== -1) out.parcels++;
        else out.open++;
      }
    }
  });
  return out;
}

const bboxOf = (cells: Iterable<number>, W: number) => {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const i of cells) { const x = i % W, y = (i - x) / W; x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y); }
  return { x1, y1, x2, y2 };
};

/** The whole cells `zone` touches, as flat indices on a map `W` by `H`. */
export function zoneWholeCells(zone: Pick<ZoneNote, 'cells' | 'grid'>, W: number, H: number): Set<number> {
  const out = new Set<number>();
  for (const c of zone.grid ? zoneHalfCells(zone) : zone.cells) {
    const x = zone.grid ? Math.floor(c.x / HALVES) : c.x, y = zone.grid ? Math.floor(c.y / HALVES) : c.y;
    if (x >= 0 && y >= 0 && x < W && y < H) out.add(y * W + x);
  }
  return out;
}

/** The label a note's tag reads as: a preset id or the custom tag's text. */
export function noteLabel(notes: AnnotationsState | undefined, note: MapAnnotation): string | null {
  if (note.kind !== 'zone' && note.kind !== 'chip') return null;
  if (!note.tag) return null;
  return customTagOf(notes?.customTags, note.tag)?.text ?? note.tag;
}

/** Open buildable ground: buildable cells no locked object covers, and the locked footprints by id. */
export function openGround(state: GridState): { ground: Uint8Array; landmarks: Map<string, Set<number>> } {
  const W = state.template.width, H = state.template.height;
  const ground = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (isBuildableZone(state.cells[y]![x]!.zone)) ground[y * W + x] = 1;
  const landmarks = new Map<string, Set<number>>();
  for (const o of state.objects.values()) {
    if (!o.locked) continue;
    const r = wholeCellsOf(objectRect(o));
    const cells = landmarks.get(o.catalogId) ?? new Set<number>();
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      cells.add(y * W + x); ground[y * W + x] = 0;
    }
    landmarks.set(o.catalogId, cells);
  }
  return { ground, landmarks };
}

export function surveyAnnotations(state: GridState): AnnotationSurvey {
  const W = state.template.width, H = state.template.height;
  const notes = state.annotations;
  const items = notes?.items ?? [];
  const { ground, landmarks } = openGround(state);
  const zones = items.filter((n): n is ZoneNote => n.kind === 'zone');
  const cellsOf = zones.map((z) => zoneWholeCells(z, W, H));
  const count = new Uint16Array(W * H);
  cellsOf.forEach((cells) => { for (const i of cells) count[i] = count[i]! + 1; });
  const circ = new Set<number>();
  zones.forEach((z, k) => { if (isCirculationTag(z.tag)) for (const i of cellsOf[k]!) circ.add(i); });
  let routes = 0;
  for (const n of items) {
    if (n.kind !== 'route') continue;
    routes++;
    for (let p = 1; p < n.points.length; p++) {
      const a = n.points[p - 1]!, b = n.points[p]!;
      for (const c of line4(Math.floor(a.x), Math.floor(a.y), Math.floor(b.x), Math.floor(b.y))) {
        if (c.x >= 0 && c.y >= 0 && c.x < W && c.y < H) circ.add(c.y * W + c.x);
      }
    }
  }
  const pairs = new Map<number, number>();
  const facts: ZoneFact[] = zones.map((z, k) => {
    const cells = cellsOf[k]!;
    const near = new Set<number>();
    let offGround = 0;
    for (const i of cells) {
      if (!ground[i]) offGround++;
      const x = i % W, y = (i - x) / W;
      for (const [dx, dy] of [[0, 0], ...NEIGHBORS4] as const) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (count[j] === 0) continue;
        cellsOf.forEach((other, m) => { if (m !== k && other.has(j)) near.add(m); });
      }
    }
    for (const m of near) {
      if (m <= k) continue;
      let shared = 0;
      for (const i of cells) if (cellsOf[m]!.has(i)) shared++;
      if (shared) pairs.set(k * zones.length + m, shared);
    }
    return {
      id: z.id, num: z.num, label: noteLabel(notes, z), color: z.color, circulation: isCirculationTag(z.tag),
      area: cells.size, offGround, pieces: new Set(components(cells, W, H).values()).size,
      bbox: bboxOf(cells, W), neighbours: [...near].map((m) => zones[m]!.num).sort((a, b) => a - b),
      ...(isCirculationTag(z.tag) ? { width: typicalWidth(cells, W) } : {}),
    };
  });
  let groundCells = 0, covered = 0, overlap = 0;
  const open = new Set<number>();
  for (let i = 0; i < W * H; i++) {
    if (!ground[i]) continue;
    groundCells++;
    if (count[i]! > 0) covered++; else open.add(i);
    if (count[i]! > 1) overlap++;
  }
  const openPieces = new Map<number, number[]>();
  for (const [i, c] of components(open, W, H)) (openPieces.get(c) ?? openPieces.set(c, []).get(c)!).push(i);
  const unplanned = [...openPieces.values()].sort((a, b) => b.length - a.length).slice(0, 3)
    .map((cells) => ({ cells: cells.length, bbox: bboxOf(cells, W) }));
  const besideCirc = (cells: Set<number>) => [...cells].some((i) => {
    const x = i % W, y = (i - x) / W;
    return circ.has(i) || NEIGHBORS4.some(([dx, dy]) => x + dx >= 0 && x + dx < W && y + dy >= 0 && y + dy < H && circ.has((y + dy) * W + x + dx));
  });
  const reaches = [...landmarks].filter(([, cells]) => besideCirc(cells)).map(([id]) => id);
  const colours = new Map<string, Set<string>>();
  for (const f of facts) if (f.label) (colours.get(f.label) ?? colours.set(f.label, new Set()).get(f.label)!).add(f.color);
  const isPath = zones.map((z) => isCirculationTag(z.tag));
  const labelCount = new Map<string, number>();
  for (const f of facts) if (!f.circulation) labelCount.set(f.label ?? 'untagged', (labelCount.get(f.label ?? 'untagged') ?? 0) + 1);
  const parcels = facts.filter((f) => !f.circulation);
  const parcelCells = parcels.reduce((n, f) => n + f.area, 0);
  const big = parcels.reduce<ZoneFact | null>((best, f) => (!best || f.area > best.area ? f : best), null);
  const { zones: content, outside } = zoneContents(state);
  return {
    edges: parcelEdges(cellsOf, isPath, ground, W, H),
    labels: [...labelCount].map(([label, n]) => ({ label, zones: n })).sort((a, b) => b.zones - a.zones),
    largest: big && parcelCells ? { num: big.num, share: Math.round((100 * big.area) / parcelCells) / 100 } : null,
    content, outside,
    ground: groundCells, covered, overlap, zones: facts,
    overlaps: [...pairs].map(([key, cells]) => ({
      a: zones[Math.floor(key / zones.length)]!.num, b: zones[key % zones.length]!.num, cells,
    })).sort((p, q) => q.cells - p.cells),
    circulation: {
      cells: circ.size, pieces: circ.size ? new Set(components(circ, W, H).values()).size : 0,
      reaches, landmarks: [...landmarks.keys()],
      apart: circ.size ? facts.filter((f, k) => !f.circulation && !besideCirc(cellsOf[k]!)).map((f) => f.num) : [],
    },
    chips: items.filter((n) => n.kind === 'chip').length,
    chipsOnZones: items.filter((n) => n.kind === 'chip' && count[Math.floor(n.y) * W + Math.floor(n.x)]! > 0).length, routes, measures: items.filter((n) => n.kind === 'measure').length,
    mixedColours: [...colours].filter(([, c]) => c.size > 1).map(([label, c]) => ({ label, colours: [...c] })),
    unplanned,
  };
}

/** What a built map holds, by kind: the catalog roles, surfaces (coatings such as roads), crossings
 *  (other placed items without a role) and the two terrains. */
const CONTENT_KINDS = ['home', 'amenity', 'canopy', 'groundcover', 'surface', 'crossing', 'water', 'mountain'] as const;
export type ContentKind = typeof CONTENT_KINDS[number];

/** The kind of one placed item. */
export function contentKindOf(catalogId: string): ContentKind {
  const item = getCatalogItem(catalogId);
  return itemRole(item) ?? (isCoatingItem(item) ? 'surface' : 'crossing');
}

interface ZoneContent {
  /** Items whose footprint centre lies in the zone, and terrain cells in it, by kind. */
  counts: Partial<Record<ContentKind, number>>;
  /** Zone cells under an item or terrain, over the zone's cells. */
  built: number;
}

/** What stands inside each zone, and what was built on open ground outside every zone. */
function zoneContents(state: GridState): { zones: Map<string, ZoneContent>; outside: Partial<Record<ContentKind, number>> } {
  const W = state.template.width, H = state.template.height;
  const zones = (state.annotations?.items ?? []).filter((n): n is ZoneNote => n.kind === 'zone');
  const cellsOf = zones.map((z) => zoneWholeCells(z, W, H));
  const inAny = new Uint8Array(W * H);
  for (const cells of cellsOf) for (const i of cells) inAny[i] = 1;
  const usedBy = new Uint8Array(W * H);
  const centres: { at: number; kind: ContentKind }[] = [];
  for (const o of state.objects.values()) {
    if (o.locked) continue;
    const r = wholeCellsOf(objectRect(o));
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (x >= 0 && y >= 0 && x < W && y < H) usedBy[y * W + x] = 1;
    const cx = Math.min(W - 1, Math.max(0, Math.floor(r.x + r.w / 2 - 0.01))), cy = Math.min(H - 1, Math.max(0, Math.floor(r.y + r.h / 2 - 0.01)));
    centres.push({ at: cy * W + cx, kind: contentKindOf(o.catalogId) });
  }
  const terrain = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = state.cells[y]![x]!.terrain;
    if (t?.type === TerrainType.Water) terrain[y * W + x] = 2;
    else if (t?.type === TerrainType.Mountain && t.elevation > 0) terrain[y * W + x] = 1;
  }
  const baseline = state.template.terrain;
  const result = new Map<string, ZoneContent>();
  const add = (counts: Partial<Record<ContentKind, number>>, kind: ContentKind) => { counts[kind] = (counts[kind] ?? 0) + 1; };
  zones.forEach((z, k) => {
    const cells = cellsOf[k]!;
    const counts: Partial<Record<ContentKind, number>> = {};
    let built = 0;
    for (const i of cells) {
      if (terrain[i] === 2) add(counts, 'water');
      else if (terrain[i] === 1 && !baseline?.[i]) add(counts, 'mountain');
      if (usedBy[i] || terrain[i] === 2 || (terrain[i] === 1 && !baseline?.[i])) built++;
    }
    for (const c of centres) if (cells.has(c.at)) add(counts, c.kind);
    result.set(z.id, { counts, built: cells.size ? Math.round((100 * built) / cells.size) / 100 : 0 });
  });
  const outside: Partial<Record<ContentKind, number>> = {};
  for (const c of centres) if (!inAny[c.at]) add(outside, c.kind);
  return { zones: result, outside };
}

const box = (b: { x1: number; y1: number; x2: number; y2: number }) => `(${b.x1},${b.y1})-(${b.x2},${b.y2})`;

/** The words a zone's contents read in. */
const CONTENT_WORDS: Record<ContentKind, string> = {
  home: 'home', amenity: 'facility', canopy: 'tree', groundcover: 'flora', surface: 'paving', crossing: 'crossing',
  water: 'water cells', mountain: 'raised cells',
};

/** Content counts as "2 home, 14 tree"; empty when there are none. */
function contentText(counts: Partial<Record<ContentKind, number>>): string {
  return CONTENT_KINDS.filter((k) => counts[k]).map((k) => `${counts[k]} ${CONTENT_WORDS[k]}`).join(', ');
}

/** One zone as a single line the model reads, with what it holds once anything stands in it. */
export function zoneLine(f: ZoneFact, content?: ZoneContent): string {
  const holds = content && content.built > 0 ? `; holds ${contentText(content.counts)} (${Math.round(content.built * 100)}% of its cells built)` : '';
  return `#${f.num} ${f.label ?? 'untagged'} ${f.color} id=${f.id}: ${f.area} cells ${box(f.bbox)}${f.width ? `, about ${f.width} wide` : ''}`
    + `${f.pieces > 1 ? `, ${f.pieces} pieces` : ''}${f.offGround ? `, ${f.offGround} off open ground` : ''}`
    + `${f.neighbours.length ? `, touches ${f.neighbours.map((n) => `#${n}`).join(' ')}` : ''}${holds}`;
}

/** The plan's shape: parcels by label, the largest one's share and what parcel edges meet. */
function shapeLine(s: AnnotationSurvey): string | null {
  const e = s.edges, total = e.parcels + e.paths + e.fixed + e.open;
  if (!total) return null;
  const share = (n: number) => `${Math.round((100 * n) / total)}%`;
  const count = s.labels.reduce((n, l) => n + l.zones, 0);
  return `Parcels (zones besides circulation): ${count}; by label ${s.labels.map((l) => `${l.label} ${l.zones}`).join(', ')}`
    + `${s.largest ? `; the largest, #${s.largest.num}, holds ${Math.round(s.largest.share * 100)}% of their cells` : ''}.`
    + ` Their edges meet other parcels ${share(e.parcels)}, circulation ${share(e.paths)}, coast or fixed ground ${share(e.fixed)},`
    + ` open unplanned ground ${share(e.open)}.`;
}

/** What a build left: zones holding nothing and what stands outside every zone, once anything is built. */
function builtLine(s: AnnotationSurvey): string | null {
  const empty = s.zones.filter((z) => !s.content.get(z.id)?.built);
  const outside = contentText(s.outside);
  if (empty.length === s.zones.length && !outside) return null;
  return `Built: ${empty.length ? `zones holding nothing ${empty.map((z) => `#${z.num}`).join(' ')}` : 'every zone holds something'}`
    + `${outside ? `; standing on open ground outside every zone: ${outside}` : ''}.`;
}

/** The survey as the compact read-back `get_annotations` answers with. */
export function surveyText(s: AnnotationSurvey): string {
  const pct = (n: number) => (s.ground ? Math.round((100 * n) / s.ground) : 0);
  const c = s.circulation;
  const lines = [
    `Zones ${s.zones.length}, chips ${s.chips}${s.chipsOnZones ? ` (${s.chipsOnZones} inside zones)` : ''}, routes ${s.routes}, measures ${s.measures}.`,
    `Open buildable ground ${s.ground} cells: ${pct(s.covered)}% inside zones, ${pct(s.overlap)}% inside two or more.`,
    c.cells
      ? `Circulation: ${c.cells} cells in ${c.pieces} piece(s); beside ${c.reaches.length ? c.reaches.join(', ') : 'no fixed landmark'}${c.landmarks.length > c.reaches.length ? ` (fixed landmarks: ${c.landmarks.join(', ')})` : ''}; ${c.apart.length} of ${s.zones.filter((z) => !z.circulation).length} other zones touch no circulation${c.apart.length ? ` (${c.apart.map((n) => `#${n}`).join(' ')})` : ''}.`
      : 'Circulation: none marked (entrance zones or routes).',
    ...[shapeLine(s), builtLine(s)].filter((l): l is string => l !== null),
    ...s.zones.map((z) => zoneLine(z, s.content.get(z.id))),
  ];
  if (s.overlaps.length) lines.push(`Overlaps: ${s.overlaps.slice(0, 8).map((o) => `#${o.a}/#${o.b} ${o.cells}`).join(', ')}${s.overlaps.length > 8 ? ` and ${s.overlaps.length - 8} more` : ''}.`);
  if (s.mixedColours.length) lines.push(`Same label, several colours: ${s.mixedColours.map((m) => `${m.label} ${m.colours.join('/')}`).join('; ')}.`);
  if (s.unplanned.length && s.unplanned[0]!.cells > 0) lines.push(`Largest unplanned ground: ${s.unplanned.map((u) => `${u.cells} cells ${box(u.bbox)}`).join(', ')}.`);
  return lines.join('\n');
}
