/** Read tools: the map, its objects, the selection and the catalog, as the model inspects them. */
import { TerrainType, type GridState, type MacroCoord, type PlacedObject } from '../../core/model/types';
import { getCell } from '../../core/model/grid-model';
import { getCatalogItem, getOfferedItem } from '../../state/catalog';
import { localizedName } from '../../i18n/context';
import type { AgentToolDeps } from './deps';
import { objectCellsOver, terrainRectUnder, type Corners } from './cells';
import { argError } from './feedback';
import { corners } from './geometry';
import { qualityReport, renderScorecard, speckleFindings, type QualityReport } from './quality';
import { int, num, obj, oneOf, req, str } from './schema';
import { mapOverview, mapSummary, objectLine, regionTokens, selectionContext, REGION_CAP } from './serialize';
import { annotationContext } from './annotations';
import { defineTool, type ToolOutcome } from './spec';
import { ItemCategory } from '../../config/catalog/categories';
import { GROUND_LEGEND, groundLevels } from '../../view/map2d/capture/ground-levels';

/** The most objects one listing names; the rest are counted, so a built map cannot fill the context. */
const OBJECT_LIST_CAP = 80;

/** The objects a capped listing left out, counted by catalog id, with how to reach them. */
function unlistedObjects(rest: readonly PlacedObject[]): string {
  const counts = new Map<string, number>();
  for (const o of rest) counts.set(o.catalogId, (counts.get(o.catalogId) ?? 0) + 1);
  const byCount = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return `${rest.length} more objects are not listed: ${byCount.map(([id, n]) => `${id} x${n}`).join(', ')}. `
    + 'Pass x1,y1,x2,y2 or category to list the ones the next edit needs.';
}

const REGION_CALL = '{"x1":40,"y1":30,"x2":60,"y2":45}';

export const inspectRegionTool = defineTool({
  description: `Read a rectangle (max ${REGION_CAP}x${REGION_CAP}) as a compact token grid: what an object on each cell stands on. Use this before editing — do not guess current terrain.`,
  input: obj(corners),
  access: 'read',
  verifies: true,
  example: REGION_CALL,
  run: (deps, rect) => ({ isError: false, content: regionTokens(deps.getState(), rect) }),
});

export const getObjectsTool = defineTool({
  description: `List placed objects (id, catalogId, position, rotation, elevation), at most ${OBJECT_LIST_CAP} per call. `
    + 'Pass x1,y1,x2,y2 to list only objects placed in that rectangle, and category to list one catalog category.',
  input: obj({ category: oneOf(Object.values(ItemCategory)), x1: int(), y1: int(), x2: int(), y2: int() }),
  access: 'read',
  verifies: true,
  run(deps, { category, x1, y1, x2, y2 }) {
    const given = [x1, y1, x2, y2].filter((v) => v !== undefined).length;
    if (given !== 0 && given !== 4) return argError('a rectangle needs all of x1, y1, x2 and y2.', REGION_CALL);
    const inRect = (o: PlacedObject): boolean => given === 0
      || (o.position.x >= Math.min(x1!, x2!) && o.position.x <= Math.max(x1!, x2!)
        && o.position.y >= Math.min(y1!, y2!) && o.position.y <= Math.max(y1!, y2!));
    const objs = [...deps.getState().objects.values()]
      .filter((o) => (!category || getCatalogItem(o.catalogId)?.category === category) && inRect(o));
    if (objs.length === 0) return { isError: false, content: given === 0 && !category ? 'No objects placed.' : 'No objects match.' };
    const listed = objs.slice(0, OBJECT_LIST_CAP).map(objectLine).join('\n');
    if (objs.length <= OBJECT_LIST_CAP) return { isError: false, content: listed };
    return { isError: false, content: `${listed}\n${unlistedObjects(objs.slice(OBJECT_LIST_CAP))}` };
  },
});

export const getSelectionTool = defineTool({
  description: "Get the user's current region selection (bbox + cell count). Call when the user refers to 'here' or 'the selected area'.",
  input: obj({}),
  access: 'read',
  run: (deps) => ({ isError: false, content: `${selectionContext(deps.getRegion())}\n${selectedBlockContext(deps)}` }),
});

export const getCatalogItemTool = defineTool({
  description: 'Full catalog details for one item id (size, traits, display name, maxCount).',
  input: obj({ id: req(str()) }),
  access: 'read',
  run(_deps, { id }) {
    const item = getOfferedItem(id);
    if (!item) return argError(`unknown item id "${id}", use ids from the CATALOG section.`);
    return {
      isError: false,
      content: `${item.id}: "${localizedName(item.name, 'en')}" — category ${item.category}, ${item.width}x${item.height}, rotatable=${item.rotatable}, maxCount=${item.maxCount ?? 'unlimited'}, load=${item.loadUnknown ? 'unknown (counted as 0)' : item.loadValue}, traits=${JSON.stringify(item.traits)}`,
    };
  },
});

/** Pieces of ground by level as `level:count` pairs, the empty levels left out. */
const levelCounts = (counts: number[]): string => counts.map((n, l) => (n ? `${l}:${n}` : '')).filter(Boolean).join(' ') || 'none';

/** The ground of `rect` of object cells as counts of pieces of ground: each piece is a cell's size
 *  and centred on a corner where four cells meet, so the ground under a rectangle of cells is one
 *  piece wider and taller than it. */
function groundCounts(state: GridState, rect?: Corners): string {
  const g = groundLevels(state, rect && terrainRectUnder(rect));
  return `pieces of ground by land level ${levelCounts(g.land)}; by water level ${levelCounts(g.water)}; waterfall pieces ${g.falls}`;
}

/** One line on the ground of `rect` for a reader of the rendered map, where levels show only as shades. */
function groundLine(state: GridState, rect?: Corners): string {
  return ` Ground here: ${groundCounts(state, rect)}. view_map layer "ground" shows each level in its own colour.`;
}

/** The ground layer: its counts and legend, and the level picture where the seat reads pictures. */
async function groundView(deps: AgentToolDeps, rect?: Corners): Promise<ToolOutcome> {
  const state = deps.getState();
  const text = `Ground view${rect ? ` of (${rect.x1},${rect.y1})-(${rect.x2},${rect.y2})` : ''}: ${groundCounts(state, rect)}. ${GROUND_LEGEND}`;
  if (!deps.snapshotGround) return { isError: false, content: `${text}\nThis connection reads no pictures; inspect_region gives the exact levels cell by cell.` };
  const pic = await deps.snapshotGround(rect && terrainRectUnder(rect));
  return {
    isError: false,
    content: `${text} Each piece of ground is ${pic.scale} pixels square; the top-left one is centred on the top-left corner of cell (${pic.origin.x},${pic.origin.y}), `
      + 'and the faint lines run through the pieces centred on the left edges of the columns, and the top edges of the rows, whose number is a multiple of 10.',
    image: { dataUrl: pic.url },
  };
}

export const viewMapTool = defineTool({
  description: 'See the map as a rendered image (on vision models) or a token grid. Pass x1,y1,x2,y2 to view just that region, close up. Rendered images carry a coordinate ruler so you can map what you see to the cells you edit. Use it to judge COMPOSITION — shapes, balance, ragged edges — after major terrain or decoration work. The map shows what is built in its true colours; layer "plan" adds the planning annotations. layer "ground" shows the terrain alone, one colour per level, water by its level and every waterfall marked: the picture to judge levels, terraces and falls by, which the rendered map shows only as faint shades. Costs tokens on vision models; prefer evaluate_map for objective metrics.',
  input: obj({ x1: num(), y1: num(), x2: num(), y2: num(), layer: oneOf(['map', 'plan', 'ground'], { description: 'map (default): the rendered map as built, true colours. plan: the same with the planning annotations drawn over it. ground: the terrain alone by level.' }) }),
  access: 'read',
  verifies: true,
  example: REGION_CALL,
  async run(deps, { x1, y1, x2, y2, layer }) {
    const given = [x1, y1, x2, y2].filter((c) => c !== undefined).length;
    if (given > 0 && (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined)) {
      return argError('view_map takes either no region or all four corners as numbers, x1 y1 x2 y2.', REGION_CALL);
    }
    const rect = given > 0 ? { x1: Math.min(x1!, x2!), y1: Math.min(y1!, y2!), x2: Math.max(x1!, x2!), y2: Math.max(y1!, y2!) } : undefined;
    if (layer === 'ground') return groundView(deps, rect);
    if (rect) {
      const url = deps.snapshotRegion ? await deps.snapshotRegion(rect, { notes: layer === 'plan' }) : null;
      return url
        ? { isError: false, content: `Rendered view of region (${rect.x1},${rect.y1})-(${rect.x2},${rect.y2}) attached.${groundLine(deps.getState(), rect)}`, image: { dataUrl: url } }
        : { isError: false, content: `Render unavailable, token region instead.\n${regionTokens(deps.getState(), rect)}` };
    }
    const url = deps.snapshot ? await deps.snapshot({ notes: layer === 'plan' }) : null;
    return url
      ? { isError: false, content: `Rendered view of the current map attached.${groundLine(deps.getState())}`, image: { dataUrl: url } }
      : { isError: false, content: `Render unavailable, token overview instead.\n${mapOverview(deps.getState())}` };
  },
});

/** Last quality report per map — the reference the next evaluation is compared
 *  against (trend feedback). WeakMap keyed by GridState: survives across turns
 *  for the same map, evaporates when a new map replaces the state object. */
const lastQuality = new WeakMap<GridState, QualityReport>();

export const evaluateMapTool = defineTool({
  description: 'Inspect whole-map design heuristics and trends. These are suggestions, not game rules or task completion criteria: low scores and REGRESSED trends do not require edits outside the user request. A small task needs no scorecard.',
  input: obj({}),
  access: 'read',
  run(deps) {
    const state = deps.getState();
    const prev = lastQuality.get(state);
    const report = qualityReport(state);
    lastQuality.set(state, report);
    // The scorecard grades the whole map. Said explicitly on a region-locked job, because a
    // bounded build read against whole-map absolutes looks like it moved nothing and the model
    // then spends turns chasing dimensions its region cannot reach.
    const region = deps.getRegion();
    const note = region.length > 0
      ? `\nNote: these scores grade the WHOLE map, and your work is confined to the ${region.length}-cell selected region. Read the TRENDS ("was N") for what your edits moved; do not chase whole-map absolutes a bounded build cannot reach.`
      : '';
    return { isError: false, content: renderScorecard(report, prev) + note };
  },
});

/** Token grids show occupancy, so pattern findings need a separate inspection before any edit. */
export const findSpeckleTool = defineTool({
  description: 'Find candidate planting patterns for optional review. Findings are aesthetic heuristics, not errors. Inspect relevant patches before deciding whether a local adjustment serves the request. Intentional mixed planting and small groups can remain; never clear a finding blindly.',
  input: obj({}),
  access: 'read',
  run(deps) {
    const { findings, plantCount } = speckleFindings(deps.getState());
    if (plantCount === 0) return { isError: false, content: 'No planting on the map yet; nothing to sweep.' };
    if (findings.length === 0) {
      return { isError: false, content: 'Planting sweep clean: every patch reads as a bed, row, lattice or specimen, species-pure.' };
    }
    const lines = findings.slice(0, 8).map((f) => `- ${f.rect}: ${f.n} plants, ${f.why}`);
    return {
      isError: false,
      content: `${findings.length} candidate planting patch(es) for review:\n${lines.join('\n')}\nThese patterns may be intentional. Inspect only findings relevant to the request; preserve existing work and use individual edits if a correction is needed. Do not clear a rectangle solely because it appears here.`,
    };
  },
});

/** The clicked block, described for the model ("this/it" references). */
function selectedBlockContext(deps: AgentToolDeps): string {
  const sel = deps.getSelectedBlock?.() ?? null;
  if (!sel) return 'Clicked block: none.';
  if (sel.kind === 'terrain') {
    const cell = getCell(deps.getState().cells, sel.x, sel.y);
    const t = cell?.terrain;
    const what = t ? `${t.type === TerrainType.Water ? 'water' : 'mountain'} elev ${t.elevation}` : 'flat ground';
    const over = objectCellsOver([sel]);
    const where = over ? `the ground between cells (${over.x1},${over.y1})-(${over.x2},${over.y2})` : 'ground off the map';
    return `Clicked block: ${where} — ${what}. "This/it" likely refers to it.`;
  }
  const found = deps.getState().objects.get(sel.id);
  return found
    ? `Clicked block: object ${objectLine(found)}. "This/it" likely refers to it.`
    : 'Clicked block: none.';
}

/** Per-turn volatile context injected ahead of the user message (kept out of the
 *  cached system prefix). */
export function buildMapContext(state: GridState, region: MacroCoord[], deps?: AgentToolDeps): string {
  const sel = deps ? `\n${selectedBlockContext(deps)}` : '';
  // Which of view_map's two answers this connection gets is a wiring fact the model cannot
  // otherwise learn until it calls: told up front, a sighted seat reaches for the picture at its
  // review step and a text seat never budgets a turn hoping for one.
  const eyes = deps?.snapshot
    ? '\nThis connection has VISION: view_map returns a rendered picture of the map, and view_map with x1,y1,x2,y2 returns a close-up crop of that region.'
    : '';
  const language = deps?.interfaceLanguage?.();
  // Preset tags show in the interface language; a custom name in another one makes a plan read in two.
  const tongue = language ? `\nInterface language: ${language}. Preset annotation tags show in it; write custom tag names in it too.` : '';
  return `${mapSummary(state)}\n${annotationContext(state)}\n${selectionContext(region)}${sel}${eyes}${tongue}\n${mapOverview(state)}`;
}
