/** Read tools: the map, its objects, the selection and the catalog, as the model inspects them. */
import { TerrainType, type GridState, type MacroCoord } from '../../core/model/types';
import { getCell } from '../../core/model/grid-model';
import { getCatalogItem, getOfferedItem } from '../../state/catalog';
import { localizedName } from '../../i18n/context';
import type { AgentToolDeps } from './deps';
import { argError } from './feedback';
import { corners } from './geometry';
import { qualityReport, renderScorecard, speckleFindings, type QualityReport } from './quality';
import { num, obj, oneOf, req, str } from './schema';
import { mapOverview, mapSummary, objectLine, regionTokens, selectionContext, REGION_CAP } from './serialize';
import { annotationContext } from './annotations';
import { defineTool } from './spec';
import { ItemCategory } from '../../config/catalog/categories';

const REGION_CALL = '{"x1":40,"y1":30,"x2":60,"y2":45}';

export const inspectRegionTool = defineTool({
  description: `Read the terrain of a rectangle (max ${REGION_CAP}x${REGION_CAP}) as a compact token grid. Use this before editing — do not guess current terrain.`,
  input: obj(corners),
  access: 'read',
  verifies: true,
  example: REGION_CALL,
  run: (deps, rect) => ({ isError: false, content: regionTokens(deps.getState(), rect) }),
});

export const getObjectsTool = defineTool({
  description: 'List placed objects (id, catalogId, position, rotation, elevation). Optionally filter by catalog category.',
  input: obj({ category: oneOf(Object.values(ItemCategory)) }),
  access: 'read',
  verifies: true,
  run(deps, { category }) {
    const objs = [...deps.getState().objects.values()].filter((o) => !category || getCatalogItem(o.catalogId)?.category === category);
    return { isError: false, content: objs.length ? objs.map(objectLine).join('\n') : 'No objects placed.' };
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

export const viewMapTool = defineTool({
  description: 'See the map as a rendered image (on vision models) or a token grid. Pass x1,y1,x2,y2 to view just that region, close up. Rendered images carry a coordinate ruler so you can map what you see to the cells you edit. Use it to judge COMPOSITION — shapes, balance, ragged edges — after major terrain or decoration work. Costs tokens on vision models; prefer evaluate_map for objective metrics.',
  input: obj({ x1: num(), y1: num(), x2: num(), y2: num() }),
  access: 'read',
  verifies: true,
  example: REGION_CALL,
  async run(deps, { x1, y1, x2, y2 }) {
    const given = [x1, y1, x2, y2].filter((c) => c !== undefined).length;
    if (given > 0) {
      if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) {
        return argError('view_map takes either no region or all four corners as numbers, x1 y1 x2 y2.', REGION_CALL);
      }
      const rect = { x1, y1, x2, y2 };
      const url = deps.snapshotRegion ? await deps.snapshotRegion(rect) : null;
      return url
        ? { isError: false, content: `Rendered view of region (${x1},${y1})-(${x2},${y2}) attached.`, image: { dataUrl: url } }
        : { isError: false, content: `Render unavailable, token region instead.\n${regionTokens(deps.getState(), rect)}` };
    }
    const url = deps.snapshot ? await deps.snapshot() : null;
    return url
      ? { isError: false, content: 'Rendered view of the current map attached.', image: { dataUrl: url } }
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
    return `Clicked block: terrain at (${sel.x},${sel.y}) — ${what}. "This/it" likely refers to it.`;
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
    ? '\nThis connection has VISION: view_map returns a rendered picture of the map, and view_map with x1,y1,x2,y2 returns a close-up crop of that region. Look before declaring a build done.'
    : '';
  return `${mapSummary(state)}\n${annotationContext(state)}\n${selectionContext(region)}${sel}${eyes}\n${mapOverview(state)}`;
}
