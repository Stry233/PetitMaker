/**
 * Agent tool surface: JSON-schema tool definitions + the execution bridge that
 * maps LLM tool calls onto the editor's CommandExecutor.
 *
 * Every WRITE tool call is exactly ONE stroke group:
 *   getUndoStackSize() → runSilently(execute each command) → commitStrokeGroup()
 * - runSilently suppresses `validation-failed` events, so the error Toast never
 *   fires for agent edits — rejections are fed back to the LLM instead.
 * - Pre-command rejections are reported per command (reject-and-skip, same
 *   semantics as generation); post-stroke violations mean the executor already
 *   rolled the stroke back, reported as "REVERTED: …" so the model re-plans.
 * - One stroke group = one undo step, so the user can undo agent work normally.
 *
 * Error strings are always rendered in ENGLISH (translateFor('en', …)) — the
 * model converses with the user in any language but reasons over stable rule
 * feedback, augmented with the rule's own agentHint (RULE_HINTS) for the violated rule.
 */
import {
  CellZone,
  CommandType,
  TerrainType,
  type Command,
  type Corners,
  type CornerTrim,
  type GridState,
  type MacroCoord,
  type PlacedObject,
} from '../../core/model/types';
import { getCell, rectsOverlap } from '../../core/model/grid-model';
import { ELEVATION_MAX } from '../../core/model/constants';
import { getCatalogItem } from '../../state/catalog';
import { localizedName } from '../../i18n/context';
import { edgeCutGeneratedTerrain, edgeCutGeneratedRoads } from '../../tools/edge-cut/auto-edge-cut';
import { computeLockedCorners } from '../../core/edge-cut/trim-lock';
import { validateCut } from '../../core/edge-cut/cut-validator';
import { CORNER_POS, CORNER_COMPASS, type CornerPos } from '../../core/edge-cut/corner-index';
import { objectRect, buildObjectOccupancy, coatingsUnder } from '../../state/object-geometry';
import { isCoating, hasTrait } from '../../core/model/traits';
import { generateTerrain, clearAllObjects, clearAllTerrain } from '../../tools/generation/terrain-generator';
import { toGenConfig } from '../../tools/generation';
import { populate } from '../../tools/generation/placement';
import type { GenerateConfig } from '../../core/model/types';
import { mapOverview, mapSummary, objectLine, regionTokens, selectionContext, REGION_CAP } from '../serialize';
import { decorateZoneHandler, plantForestHandler, buildRoadNetworkHandler, frameCrossingHandler, THEMES } from './tools-director';
import { SKILLS, listSkills } from '../skills';
import { evaluateMap, renderScorecard, renderScoreDelta, type QualityReport } from '../quality';
import type { PlanStage, ToolCall, ToolResult, ToolSchema } from '../types';
import { type AgentToolDeps, type ToolResultBody, clamp, dedupe, formatErrors, runStroke, runStrokeBody, resolveCells, waterSpanTrait } from './tools-common';
import { sculptTerrace, carveRiver } from './tools-terraform';
import { findFlatAreas, findBridgeSites, findRampSites, scanBridgeSites } from './tools-search';
import { objectPlacementCommand, removeObjectCommand } from '../../tools/objects/object-placer';

/** Re-exported from tools-common so existing importers keep their path. */
export type { AgentToolDeps } from './tools-common';

let agentObjCounter = 0;

/** Last quality report per map — the reference the next evaluation is compared
 *  against (trend feedback). WeakMap keyed by GridState: survives across turns
 *  for the same map, evaporates when a new map replaces the state object. */
const lastQuality = new WeakMap<GridState, QualityReport>();

/** Evaluate + render with the session's previous report as the trend baseline. */
function evaluateWithTrend(state: GridState): { report: QualityReport; prev: QualityReport | undefined } {
  const prev = lastQuality.get(state);
  const report = evaluateMap(state);
  lastQuality.set(state, report);
  return { report, prev };
}

/* ── schemas ─────────────────────────────────────────────────────────── */

const coordProps = {
  x1: { type: 'integer' },
  y1: { type: 'integer' },
  x2: { type: 'integer' },
  y2: { type: 'integer' },
};
const cellsOrRect = {
  rect: {
    type: 'object',
    properties: coordProps,
    required: ['x1', 'y1', 'x2', 'y2'],
    description: 'Inclusive rectangle of cells.',
  },
  circle: {
    type: 'object',
    properties: { cx: { type: 'integer' }, cy: { type: 'integer' }, r: { type: 'integer', minimum: 1 } },
    required: ['cx', 'cy', 'r'],
    description: 'Filled circle (organic lakes/hills).',
  },
  line: {
    type: 'object',
    properties: {
      x1: { type: 'integer' }, y1: { type: 'integer' }, x2: { type: 'integer' }, y2: { type: 'integer' },
      width: { type: 'integer', minimum: 1, description: 'Stroke width (default 1).' },
    },
    required: ['x1', 'y1', 'x2', 'y2'],
    description: 'Straight stroke between two points (rivers, paths, walls).',
  },
  outline: {
    type: 'boolean',
    description: 'With rect or circle: paint only the 1-cell border ring (e.g. a mountain rim to contain water).',
  },
  cells: {
    type: 'array',
    items: { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' } }, required: ['x', 'y'] },
    description: 'Explicit cell list (alternative to the shapes).',
  },
};

export const TOOL_SCHEMAS: ToolSchema[] = [
  {
    name: 'inspect_region',
    description: `Read the terrain of a rectangle (max ${REGION_CAP}x${REGION_CAP}) as a compact token grid. Use this before editing — do not guess current terrain.`,
    inputSchema: { type: 'object', properties: coordProps, required: ['x1', 'y1', 'x2', 'y2'] },
  },
  {
    name: 'get_objects',
    description: 'List placed objects (id, catalogId, position, rotation, elevation). Optionally filter by catalog category.',
    inputSchema: {
      type: 'object',
      properties: { category: { type: 'string', enum: ['building', 'tree', 'flora', 'road', 'bridge', 'ramp', 'facility'] } },
    },
  },
  {
    name: 'get_selection',
    description: "Get the user's current region selection (bbox + cell count). Call when the user refers to 'here' or 'the selected area'.",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_catalog_item',
    description: 'Full catalog details for one item id (size, traits, display name, maxCount).',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'view_map',
    description:
      'See the map as a rendered image (on vision models) or a token grid. Use it to judge COMPOSITION — shapes, balance, ragged edges — after major terrain or decoration work. Costs tokens on vision models; prefer evaluate_map for objective metrics.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'evaluate_map',
    description:
      'Grade the current map on seven professional-design dimensions (connectivity, terrain interest, water, buildings, decoration, roads, silhouette), 0-10 each with actionable hints PLUS the trend vs your previous evaluation ("was N" / REGRESSED). Free and instant — call it before large work (baseline) and before declaring it done; fix regressions first, then the lowest score.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'update_plan',
    description:
      'Commit or update your staged build plan (replaces the whole plan each call). Use for any multi-stage request: plan first, keep exactly one stage active, mark stages done as you finish. The user sees this as a progress header. Completing a stage automatically returns a one-line scorecard trend — read it before starting the next stage.',
    inputSchema: {
      type: 'object',
      properties: {
        stages: {
          type: 'array',
          items: {
            type: 'object',
            properties: { title: { type: 'string' }, status: { type: 'string', enum: ['pending', 'active', 'done'] } },
            required: ['title', 'status'],
          },
        },
      },
      required: ['stages'],
    },
  },
  {
    name: 'export_map',
    description:
      "Open the export flow for the user to save their map: kind 'image' (a shareable PNG with the visible share-code band) or 'json' (the sectioned project file). This opens the export dialog for the user to confirm and download — you do not receive the file. Use only when the user asks to export, save, or share their map.",
    inputSchema: {
      type: 'object',
      properties: { kind: { type: 'string', enum: ['image', 'json'] } },
      required: ['kind'],
    },
  },
  {
    name: 'suggest_reply',
    description:
      "When your closing message leaves ONE obvious next step (a yes/no offer, a single natural follow-up), call this with the short reply the user would most likely send — in the user's own language, under 60 characters. It appears as a one-tap suggestion in their reply box. Skip it whenever the next step is genuinely open.",
    inputSchema: {
      type: 'object',
      properties: { reply: { type: 'string', description: 'The predicted user reply, short and verbatim-sendable.' } },
      required: ['reply'],
    },
  },
  {
    name: 'paint_terrain',
    description:
      'Paint mountain or water on cells. Mountain auto-builds support tiers 1..elevation (give only the FINAL elevation; elevation 0 clears the cell). Water paints at exactly the given elevation — elevated water needs mountain at elevation-1 beneath it, and ALL water must be enclosed (V-WTR-02) by the end of this call or the whole call reverts.',
    inputSchema: {
      type: 'object',
      properties: {
        ...cellsOrRect,
        terrain: { type: 'string', enum: ['mountain', 'water'] },
        elevation: { type: 'integer', minimum: 0, maximum: ELEVATION_MAX },
        smooth: { type: 'string', enum: ['round', 'rect'], description: 'Auto-trim the painted edges (rounded chamfer / 45-degree bevel) — use for natural-looking cliffs and banks.' },
      },
      required: ['terrain', 'elevation'],
    },
  },
  {
    name: 'erase_terrain',
    description: 'Clear terrain (mountain/water) back to flat ground on cells.',
    inputSchema: { type: 'object', properties: { ...cellsOrRect } },
  },
  {
    name: 'place_object',
    description:
      'Place a catalog item with its top-left anchor at (x,y). Ramps snap automatically — aim at a cliff-edge cell. BRIDGES: aim at a GAP cell (water/void, mid-channel) — use the anchors from find_bridge_sites. Returns the final (possibly snapped) placement.',
    inputSchema: {
      type: 'object',
      properties: {
        catalogId: { type: 'string' },
        x: { type: 'integer' },
        y: { type: 'integer' },
        rotation: { type: 'integer', enum: [0, 90, 180, 270] },
      },
      required: ['catalogId', 'x', 'y'],
    },
  },
  {
    name: 'remove_object',
    description: 'Remove a placed object by its id (from get_objects).',
    inputSchema: { type: 'object', properties: { objectId: { type: 'string' } }, required: ['objectId'] },
  },
  {
    name: 'rotate_object',
    description: 'Rotate an existing rotatable object to an absolute rotation (re-validates placement).',
    inputSchema: {
      type: 'object',
      properties: { objectId: { type: 'string' }, rotation: { type: 'integer', enum: [0, 90, 180, 270] } },
      required: ['objectId', 'rotation'],
    },
  },
  {
    name: 'trim_corner',
    description: "Cosmetic corner trim on a terrain cell: style 'fan' (rounded), 'tri' (45-degree bevel), 'square' (reset), 'empty' (cut away).",
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'integer' },
        y: { type: 'integer' },
        corner: { type: 'string', enum: [...CORNER_POS] },
        layer: { type: 'string', enum: ['terrain', 'road'], description: "What to trim at that cell (default 'terrain')." },
        style: { type: 'string', enum: ['square', 'fan', 'tri', 'empty'] },
      },
      required: ['x', 'y', 'corner', 'style'],
    },
  },
  {
    name: 'find_flat_areas',
    description:
      'Search the whole map for flat buildable spots where a footprint of minWidth x minHeight fits (grass zone, uniform elevation, no water, no objects; includes the +1 right/bottom margin the flat trait checks, so place_object at a returned anchor will pass). Use this instead of guessing where things fit.',
    inputSchema: {
      type: 'object',
      properties: {
        minWidth: { type: 'integer', minimum: 1 },
        minHeight: { type: 'integer', minimum: 1 },
        elevation: { type: 'integer', minimum: 0, maximum: ELEVATION_MAX, description: 'Terrain elevation to search on (default 0 = flat ground).' },
        near: { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' } }, description: 'Prefer anchors close to this point.' },
        limit: { type: 'integer', minimum: 1, maximum: 10, description: 'Max anchors to return (default 5, spread apart).' },
      },
      required: ['minWidth', 'minHeight'],
    },
  },
  {
    name: 'scatter_objects',
    description:
      'Place many items at once with natural randomness (forests, flower meadows). Random positions inside the rect (or the user selection if no rect), validated per placement (illegal spots are skipped). One undo step. Returns how many landed.',
    inputSchema: {
      type: 'object',
      properties: {
        catalogIds: { type: 'array', items: { type: 'string' }, description: 'Pool to sample from (mix species for natural looks).' },
        count: { type: 'integer', minimum: 1, maximum: 200 },
        rect: { type: 'object', properties: coordProps, required: ['x1', 'y1', 'x2', 'y2'] },
        spacing: { type: 'integer', minimum: 0, description: 'Extra min distance between placed items (default 0; trees already keep their own exclusion radius).' },
      },
      required: ['catalogIds', 'count'],
    },
  },
  {
    name: 'sculpt_terrace',
    description:
      'Sculpt an ORGANIC terraced hill like a pro terraformer: 1-3 stacked tiers of blob-shaped mountain with naturally rounded (edge-cut) cliffs. Far better looking than rect/circle paint_terrain for hills. Same seed = same shape.',
    inputSchema: {
      type: 'object',
      properties: {
        cx: { type: 'integer' },
        cy: { type: 'integer' },
        baseRadius: { type: 'integer', minimum: 3, maximum: 12, description: 'Footprint radius of tier 1.' },
        tiers: { type: 'integer', minimum: 1, maximum: 3, description: 'Elevation levels (default 2).' },
        smooth: { type: 'string', enum: ['round', 'rect'], description: "Cliff corner style (default 'round')." },
        seed: { type: 'integer', description: 'Shape seed (random if omitted).' },
      },
      required: ['cx', 'cy', 'baseRadius'],
    },
  },
  {
    name: 'carve_river',
    description:
      'Carve a MEANDERING ground-level river through waypoints (smooth bezier path, constant width, rounded banks). Use 3-5 waypoints with sideways offsets for natural bends; straight 2-point calls are for canals. Banks stay bridgeable where the width is 3-6.',
    inputSchema: {
      type: 'object',
      properties: {
        points: {
          type: 'array',
          minItems: 2,
          maxItems: 6,
          items: { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' } }, required: ['x', 'y'] },
          description: 'Waypoints from source to mouth.',
        },
        width: { type: 'integer', minimum: 2, maximum: 6, description: 'Channel width (default 4).' },
        smooth: { type: 'string', enum: ['round', 'rect'], description: "Bank corner style (default 'round')." },
      },
      required: ['points'],
    },
  },
  {
    name: 'clear_area',
    description:
      'Make room: in ONE step, remove every (non-locked) object touching the given cells AND erase the terrain there back to flat grass. Use before reshaping an area instead of removing objects one by one.',
    inputSchema: { type: 'object', properties: { ...cellsOrRect } },
  },
  {
    name: 'find_bridge_sites',
    description:
      'Search for spots where a bridge can legally be placed (straight 3-6 cell gap of water/void/lower ground with flat EQUAL-height banks). Returns anchor cells you can pass directly to place_object. ALWAYS use this before placing a bridge — valid sites are rare and invisible in the token grid.',
    inputSchema: {
      type: 'object',
      properties: {
        catalogId: { type: 'string', description: 'Bridge item id (determines deck width); default bridge-plank.' },
        near: { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' } }, description: 'Prefer sites close to this point.' },
        limit: { type: 'integer', minimum: 1, maximum: 10 },
      },
    },
  },
  {
    name: 'find_ramp_sites',
    description:
      'Scan for validated ramp placements connecting elevation tiers (the ramp equivalent of find_bridge_sites). Returns anchor cells, the catalog ramp item whose heightDrop matches each cliff, and which elevations it connects. Optional near {x,y} and limit. Use before placing ramps instead of guessing cliff edges.',
    inputSchema: {
      type: 'object',
      properties: {
        near: { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' } } },
        limit: { type: 'integer' },
      },
      required: [],
    },
  },
  {
    name: 'build_road',
    description:
      'Lay a road in one call: places one road tile per cell along a line (or explicit cells), skipping illegal cells. End-caps and bends are auto-trimmed like the manual road brush (smooth:"off" keeps them square). One undo step. Use instead of placing road cells one by one.',
    inputSchema: {
      type: 'object',
      properties: {
        catalogId: { type: 'string', enum: ['road-dirt', 'road-stone'] },
        line: {
          type: 'object',
          properties: { x1: { type: 'integer' }, y1: { type: 'integer' }, x2: { type: 'integer' }, y2: { type: 'integer' }, width: { type: 'integer', minimum: 1 } },
          required: ['x1', 'y1', 'x2', 'y2'],
        },
        cells: { type: 'array', items: { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' } }, required: ['x', 'y'] } },
        smooth: { type: 'string', enum: ['round', 'rect', 'off'], description: "End-cap/bend trim style (default 'round', the manual brush's Auto Trim)." },
      },
      required: ['catalogId'],
    },
  },
  {
    name: 'run_generator',
    description:
      "Run the editor's professional procedural generator: a full designed-island pipeline (themed zones, lakes/rivers with legal containment, terraced elevation, bridges/ramps, villages, roads, layered nature). REPLACES existing content in the target area. Use it to bootstrap large areas or whole maps, then refine with the other tools. Same seed + params = same result.",
    inputSchema: {
      type: 'object',
      properties: {
        algorithm: { type: 'string', enum: ['random', 'maze'], description: "'random' = designed island (default); 'maze' = mountain maze." },
        mode: { type: 'string', enum: ['earth', 'water', 'mixed'], description: 'Terrain bias (random only; default mixed).' },
        maxElevation: { type: 'integer', minimum: 1, maximum: 6 },
        relief: { type: 'integer', minimum: 0, maximum: 100, description: 'Hilliness 0-100 (default 80).' },
        naturalness: { type: 'integer', minimum: 0, maximum: 100, description: 'Geometry style 0-100 (default 100): 100 = organic seams/winding rivers, 0 = fully rectilinear "lego" terrain and straight roads.' },
        settlement: { type: 'number', minimum: 0, maximum: 1, description: 'Building/road density (default 0.5).' },
        nature: { type: 'number', minimum: 0, maximum: 1, description: 'Vegetation density (default 0.5).' },
        seed: { type: 'integer', description: 'Recipe id for reproducibility (random if omitted).' },
        rect: { type: 'object', properties: coordProps, required: ['x1', 'y1', 'x2', 'y2'], description: 'Target area; falls back to the user selection, then the WHOLE MAP.' },
      },
    },
  },
  {
    name: 'list_skills',
    description: 'List the available build playbooks (proven multi-step recipes for villages, hills, rivers…). Cheap — call it when the user asks for a composite scene.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'load_skill',
    description: 'Load the full step-by-step playbook for one skill from list_skills. Follow it, adapting sizes/locations to the map.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  },
  {
    name: 'delegate_task',
    description:
      'Spawn a focused sub-agent with a FRESH context to execute one well-scoped build task, and get back its summary. Use for big requests: split them into independent parts (e.g. "terrain the north hills", "build the village at (40,60)-(70,90)", "decorate the lakeshore") and delegate each. The sub-agent sees the live map but NOT this conversation — the task text must be self-contained (locations, sizes, style).',
    inputSchema: {
      type: 'object',
      properties: { task: { type: 'string', description: 'Complete, self-contained instructions incl. coordinates/area and desired style.' } },
      required: ['task'],
    },
  },
  {
    name: 'undo',
    description: 'Undo the last N edit steps (default 1). Each of your write tool calls is one step.',
    inputSchema: { type: 'object', properties: { steps: { type: 'integer', minimum: 1, maximum: 10 } } },
  },
  {
    name: 'decorate_zone',
    description:
      "Decorate a rect in a professional theme using the procedural populator's decorators: orchard (fruit grids), farm (crop rows), garden (flower beds), hamlet (homes + gardens), waterfront (promenade), peak (lookout ring). Places MANY objects in one validated stroke. Use it instead of placing objects one by one.",
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'integer' },
        y: { type: 'integer' },
        w: { type: 'integer' },
        h: { type: 'integer' },
        theme: { type: 'string', enum: [...THEMES] },
        seed: { type: 'integer' },
      },
      required: ['x', 'y', 'w', 'h', 'theme'],
    },
  },
  {
    name: 'plant_forest',
    description:
      'Plant a layered forest (stands with glades, biome-banded flora drifts) across the rect in one validated stroke. Uses the procedural populator ecology (species clustering, ecotone drifts, waterside flora). density 0-1 controls tree/flora density.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'integer' },
        y: { type: 'integer' },
        w: { type: 'integer' },
        h: { type: 'integer' },
        density: { type: 'number', minimum: 0, maximum: 1, description: 'Vegetation density 0-1 (default 0.6).' },
        seed: { type: 'integer' },
      },
      required: ['x', 'y', 'w', 'h'],
    },
  },
  {
    name: 'build_road_network',
    description:
      "Route a road network connecting the existing buildings through validated crossings (the procedural generator's region-portal router). Reads the current map's buildings and terrain to determine hub + hamlet nodes, scans for bridge/ramp crossing sites, then routes roads and any needed crossings in one stroke.",
    inputSchema: {
      type: 'object',
      properties: {
        seed: { type: 'integer', description: 'Determinism seed (optional).' },
      },
      required: [],
    },
  },
  {
    name: 'frame_crossing',
    description:
      'Find the crossing site (bridge or ramp) nearest to (x,y), realize just that one crossing, and decorate it with a mirrored flora scene on both ends. Reports "no crossing site found" gracefully if no valid portal exists on the map.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'integer' },
        y: { type: 'integer' },
        seed: { type: 'integer' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'redo',
    description: 'Redo the last N undone edit steps (default 1), like the editor Redo button.',
    inputSchema: { type: 'object', properties: { steps: { type: 'integer', minimum: 1, maximum: 10 } } },
  },
];

/** delegate_task is handled by the UI layer (it needs the adapter); sub-agents
 *  get every tool except delegation itself (depth is capped at 1).
 *  update_plan is also excluded: the plan is the PARENT agent's progress surface
 *  rendered in the UI header — a fresh-context subagent would clobber it. */
export const SUBAGENT_TOOL_SCHEMAS: ToolSchema[] = TOOL_SCHEMAS.filter(
  (t) => !['delegate_task', 'update_plan', 'suggest_reply', 'export_map'].includes(t.name),
);



/* ── per-tool handlers ───────────────────────────────────────────────── */

function paintTerrain(deps: AgentToolDeps, input: Record<string, unknown>): ToolResultBody {
  const cells = resolveCells(input, deps.getState());
  if (cells.length === 0) return { isError: true, content: 'No cells given — pass rect, circle, line, or cells.' };
  if (cells.length > 4000) return { isError: true, content: 'Too many cells in one call (max 4000) — split the edit.' };
  const type = input.terrain === 'water' ? TerrainType.Water : TerrainType.Mountain;
  const elevation = Number(input.elevation);
  const commands: Command[] = [];
  if (type === TerrainType.Mountain && elevation > 1) {
    // cumulative bottom-up tiers, same as generation's planToCommands (satisfies V-MTN-02 by construction)
    for (let L = 1; L <= elevation; L++) {
      commands.push({ type: CommandType.PaintTerrain, timestamp: Date.now(), cells, terrainType: type, elevation: L });
    }
  } else {
    commands.push({ type: CommandType.PaintTerrain, timestamp: Date.now(), cells, terrainType: type, elevation });
  }
  const label = type === TerrainType.Water ? 'water' : 'mountain';
  const smooth = input.smooth === 'round' || input.smooth === 'rect' ? input.smooth : undefined;
  return runStroke(
    deps,
    commands,
    () => `Painted ${label} elev ${elevation} on ${cells.length} cell(s)${smooth ? ', edges smoothed' : ''}.`,
    cells,
    // Non-interactive edge-cut (rounds convex tips/steps, fills empty notches).
    // Uses the generated-* path, NOT applyAutoEdgeCut: the latter needs a full
    // interactive ToolContext + the renderer's reconcile handling; driving it
    // from a silent agent stroke left detached scene nodes (Pixi _parentID null).
    smooth ? (exec) => edgeCutGeneratedTerrain({ gridState: deps.getState(), executeCommand: (c: Command) => exec.execute(c) }, cells, smooth) : undefined,
  );
}


function eraseTerrain(deps: AgentToolDeps, input: Record<string, unknown>): ToolResultBody {
  const cells = resolveCells(input, deps.getState());
  if (cells.length === 0) return { isError: true, content: 'No cells given — pass rect, circle, line, or cells.' };
  return runStroke(
    deps,
    [{ type: CommandType.EraseTerrain, timestamp: Date.now(), cells }],
    () => `Erased terrain on ${cells.length} cell(s).`,
    cells,
  );
}


/* ── make room: remove intersecting objects + erase terrain, one stroke ── */

function clearArea(deps: AgentToolDeps, input: Record<string, unknown>): ToolResultBody {
  const state = deps.getState();
  const cells = resolveCells(input, state);
  if (cells.length === 0) return { isError: true, content: 'No cells given — pass rect, circle, line, or cells.' };
  const cellSet = new Set(cells.map((c) => `${c.x},${c.y}`));
  const commands: Command[] = [];
  for (const obj of state.objects.values()) {
    if (obj.locked) continue;
    const r = objectRect(obj);
    let hit = false;
    for (let y = Math.floor(r.y); y < Math.ceil(r.y + r.h) && !hit; y++) {
      for (let x = Math.floor(r.x); x < Math.ceil(r.x + r.w) && !hit; x++) {
        if (cellSet.has(`${x},${y}`)) hit = true;
      }
    }
    if (hit) {
      commands.push(removeObjectCommand(obj));
    }
  }
  const removed = commands.length;
  commands.push({ type: CommandType.EraseTerrain, timestamp: Date.now(), cells });
  return runStroke(deps, commands, () => `Cleared ${cells.length} cell(s): removed ${removed} object(s), terrain reset to flat grass.`, cells);
}


/* ── batch: lay a road along a path in one stroke ────────────────────── */

async function buildRoad(deps: AgentToolDeps, input: Record<string, unknown>): Promise<ToolResultBody> {
  const catalogId = String(input.catalogId ?? 'road-dirt');
  const item = getCatalogItem(catalogId);
  if (!item || item.category !== 'road') return { isError: true, content: `"${catalogId}" is not a road item.` };
  const cells = resolveCells(input, deps.getState());
  if (cells.length === 0) return { isError: true, content: 'No cells given — pass line or cells.' };
  if (cells.length > 400) return { isError: true, content: 'Road too long for one call (max 400 cells).' };
  const exec = deps.getExecutor();
  const failures: string[] = [];
  let ok = 0;
  const smooth = input.smooth === 'off' ? 'off' : input.smooth === 'rect' ? 'rect' as const : 'round' as const;
  const { reverted, violations } = await runStrokeBody(deps, () => {
    for (const cell of cells) {
      const cmd = buildPlaceCmd(deps, catalogId, cell.x, cell.y, 0);
      if (typeof cmd === 'string') continue;
      const r = exec.execute(cmd);
      if (r.success) ok++;
      else failures.push(formatErrors(r.errors));
    }
    // end-cap/bend trim via the non-interactive road cut (safe to drive from a
    // silent stroke, unlike the interactive applyAutoEdgeCut)
    if (ok > 0 && smooth !== 'off') {
      edgeCutGeneratedRoads({ gridState: deps.getState(), executeCommand: (c: Command) => exec.execute(c) }, cells, smooth);
    }
  });
  if (reverted) return { isError: true, content: `REVERTED, nothing changed:\n${formatErrors(violations)}` };
  if (ok > 0) deps.onFlash?.(cells);
  let msg = `Laid ${ok}/${cells.length} road cell(s).`;
  if (failures.length > 0) msg += ` Skipped cells:\n${dedupe(failures).slice(0, 2).join('\n')}`;
  if (ok === 0) {
    msg += '\nRoads coat FLAT GROUND-LEVEL GRASS only. Fixes: route across grass (roads may cross a bridge/ramp but not open water, mountains, or object footprints); clear_area to open a blocked path; or place a bridge/ramp for the gap first, then road up to it.';
  }
  return { isError: ok === 0, content: msg };
}

/* ── batch: scatter objects with natural randomness ──────────────────── */

async function scatterObjects(deps: AgentToolDeps, input: Record<string, unknown>): Promise<ToolResultBody> {
  const ids = (input.catalogIds as string[] | undefined) ?? [];
  const count = Math.min(Math.max(Number(input.count) || 0, 1), 200);
  if (ids.length === 0) return { isError: true, content: 'catalogIds must be a non-empty array of item ids.' };
  for (const id of ids) {
    if (!getCatalogItem(id)) return { isError: true, content: `Unknown catalogId "${id}".` };
  }
  const state = deps.getState();
  const pool = input.rect ? resolveCells({ rect: input.rect }, state) : [...deps.getRegion()];
  if (pool.length === 0) {
    return { isError: true, content: 'No area: pass rect, or have the user select a region first.' };
  }
  const spacing = Math.max(0, Number(input.spacing) || 0);
  // shuffle (Fisher-Yates); interactive tool, so non-seeded randomness is fine
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  const exec = deps.getExecutor();
  const placedAt: MacroCoord[] = [];
  const failures: string[] = [];
  const { reverted, violations } = await runStrokeBody(deps, () => {
    for (const cell of pool) {
      if (placedAt.length >= count) break;
      if (spacing > 0 && placedAt.some((p) => Math.abs(p.x - cell.x) <= spacing && Math.abs(p.y - cell.y) <= spacing)) continue;
      const id = ids[Math.floor(Math.random() * ids.length)]!;
      const cmd = buildPlaceCmd(deps, id, cell.x, cell.y, 0);
      if (typeof cmd === 'string') continue;
      const r = exec.execute(cmd);
      if (r.success) placedAt.push(cell);
      else failures.push(formatErrors(r.errors));
    }
  });
  if (reverted) return { isError: true, content: `REVERTED:\n${formatErrors(violations)}` };
  if (placedAt.length > 0) deps.onFlash?.(placedAt);
  let why = placedAt.length < count && failures.length > 0 ? ` Most common rejections:\n${dedupe(failures).slice(0, 3).join('\n')}` : '';
  if (placedAt.length === 0) {
    why += '\nNothing placed. Most items need flat grass clear of water, slopes, and other objects. Fixes: pick a flatter/emptier area (find_flat_areas), lower the spacing, or clear_area first. Flora/trees will not sit on water or mountains.';
  }
  return {
    isError: placedAt.length === 0,
    content: `Scattered ${placedAt.length}/${count} object(s) over ${pool.length} candidate cell(s).${why}`,
  };
}

/* ── the procedural generator as a tool ──────────────────────────────── */


async function runGenerator(deps: AgentToolDeps, input: Record<string, unknown>): Promise<ToolResultBody> {
  const state = deps.getState();
  const exec = deps.getExecutor();
  const algorithm = input.algorithm === 'maze' ? 'maze' : 'random';
  const rect = input.rect as { x1: number; y1: number; x2: number; y2: number } | undefined;
  const region: MacroCoord[] | null = rect
    ? resolveCells({ rect }, state)
    : deps.getRegion().length > 0
      ? [...deps.getRegion()]
      : null;
  const config: GenerateConfig = {
    algorithm,
    mode: input.mode === 'earth' || input.mode === 'water' ? input.mode : 'mixed',
    corridorWidth: 1,
    maxElevation: clamp(Number(input.maxElevation) || 3, 1, algorithm === 'maze' ? 3 : 6),
    seed: Number.isFinite(Number(input.seed)) && input.seed !== undefined ? Number(input.seed) : Math.floor(Math.random() * 99999),
    region,
    relief: clamp(input.relief !== undefined ? Number(input.relief) : 80, 0, 100) / 100,       // explicit 0 stays 0 (no falsy fallback)
    naturalness: clamp(input.naturalness !== undefined ? Number(input.naturalness) : 100, 0, 100) / 100,
    settlement: clamp(input.settlement !== undefined ? Number(input.settlement) : 0.5, 0, 1),
    nature: clamp(input.nature !== undefined ? Number(input.nature) : 0.5, 0, 1),
  };
  // Mirror the Generate button's flow (App.tsx): clear objects, then terrain
  // (region-scoped), then generate + populate — all silenced, one stroke group.
  const { reverted, violations, result } = await runStrokeBody(deps, async () => {
    clearAllObjects(state, (cmd) => exec.execute(cmd), region ?? undefined);
    if (region) {
      const occ = buildObjectOccupancy(state);
      const regionCells = region.filter((coord) => {
        const cell = getCell(state.cells, coord.x, coord.y);
        return cell?.terrain && cell.zone === CellZone.Grass && !occ.has(`${coord.x},${coord.y}`);
      });
      if (regionCells.length > 0) {
        exec.execute({ type: CommandType.EraseTerrain, timestamp: Date.now(), cells: regionCells });
      }
    } else {
      clearAllTerrain(state, (cmd) => exec.execute(cmd));
    }
    const r = generateTerrain(config, state, (cmd) => exec.execute(cmd));
    if (config.algorithm === 'random') {
      await populate(toGenConfig(config), state, (cmd) => exec.execute(cmd), exec.getRegistry(), undefined, r.zonePlan);
    }
    return r;
  });
  if (reverted) return { isError: true, content: `REVERTED:\n${formatErrors(violations)}` };
  const scope = region ? `${region.length}-cell region` : 'whole map';
  const flash: MacroCoord[] = region ?? [];
  if (!region) {
    for (let y = 0; y < state.template.height; y++) for (let x = 0; x < state.template.width; x++) flash.push({ x, y });
  }
  deps.onFlash?.(flash);
  return {
    isError: false,
    content: `Generated (${config.algorithm}, seed ${config.seed}) over the ${scope}: ${result.placed} terrain cell(s); objects now on map: ${state.objects.size}. Refine with inspect_region + the editing tools.`,
  };
}

function buildPlaceCmd(
  deps: AgentToolDeps,
  catalogId: string,
  x: number,
  y: number,
  rotation: 0 | 90 | 180 | 270,
  id?: string,
): Extract<Command, { type: CommandType.PlaceObject }> | string {
  const item = getCatalogItem(catalogId);
  if (!item) return `Unknown catalogId "${catalogId}" — use ids from the CATALOG section or get_catalog_item.`;
  const obj: PlacedObject = {
    id: id ?? `agent-${Date.now().toString(36)}-${agentObjCounter++}`,
    catalogId,
    position: { x, y },
    rotation,
    elevation: deps.getState().cells[y]?.[x]?.terrain?.elevation ?? 0,
  };
  return objectPlacementCommand(obj);
}

function placeObject(deps: AgentToolDeps, input: Record<string, unknown>): ToolResultBody {
  const cmd = buildPlaceCmd(
    deps,
    String(input.catalogId),
    Number(input.x),
    Number(input.y),
    (Number(input.rotation) || 0) as 0 | 90 | 180 | 270,
  );
  if (typeof cmd === 'string') return { isError: true, content: cmd };
  // Placing an object over a road auto-clears the covered road, the same trick the
  // manual editor does (the overlap rule exempts coatings). It's done NON-silently:
  // the road removals fold into this stroke (one undo) and the result tells the
  // model it happened. Only when the placement would otherwise succeed — never
  // strip a road for a placement that gets rejected anyway (mirrors the placer).
  // Coatings and crossings (bridges/ramps, which snap) are exempt.
  const placeItem = getCatalogItem(String(input.catalogId));
  const stripCmds: Command[] = [];
  let cleared = '';
  if (placeItem && !isCoating(placeItem) && !hasTrait(placeItem, 'waterSpan') && !hasTrait(placeItem, 'heightDrop')) {
    const state = deps.getState();
    if (deps.getExecutor().getRegistry().validatePreCommand(cmd, state).length === 0) {
      const roads = coatingsUnder(state, objectRect(cmd.object));
      for (const o of roads) stripCmds.push(removeObjectCommand(o));
      if (roads.length) cleared = ` Cleared ${roads.length} road tile(s) it covered (placing over a road removes it).`;
    }
  }
  // V-PLACE-TRAIT may snap cmd.object (bridges/ramps) — read it AFTER the stroke.
  const result = runStroke(deps, [...stripCmds, cmd], () => `Placed ${objectLine(cmd.object)} (position/rotation may have snapped).${cleared}`);
  if (!result.isError) {
    const r = objectRect(cmd.object);
    const cells: MacroCoord[] = [];
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) cells.push({ x, y });
    deps.onFlash?.(cells);
    return result;
  }
  // Failure diagnostics: tell the model WHAT is in the way so it never has to
  // burn turns figuring it out (locked plaza, another object, wrong zone…).
  const item = getCatalogItem(String(input.catalogId));
  if (item) {
    const state = deps.getState();
    const x = Number(input.x);
    const y = Number(input.y);
    const blockers: string[] = [];
    for (const o of state.objects.values()) {
      if (rectsOverlap({ x, y, w: item.width, h: item.height }, objectRect(o))) {
        blockers.push(`${objectLine(o)}${o.locked ? ' — IMMOVABLE, build elsewhere' : ' — remove_object or clear_area first'}`);
      }
    }
    if (blockers.length > 0) result.content += `\nIn the way:\n${blockers.join('\n')}`;
    const zone = state.cells[y]?.[x]?.zone;
    if (zone !== undefined && zone !== CellZone.Grass) {
      result.content += `\nTarget anchor (${x},${y}) is not on buildable grass (zone token "${['~', ':', '.', 'P', '#'][zone]}").`;
    }
  }
  // failed BRIDGE placements additionally get concrete alternatives
  const span = waterSpanTrait(item);
  if (item && span) {
    const sites = scanBridgeSites(deps.getState(), item.width, span.min, span.max, { x: Number(input.x), y: Number(input.y) }, 4);
    result.content += sites.length
      ? `\nNearest LEGAL anchors for ${item.id}: ${sites.map((s) => `(${s.x},${s.y})`).join(' ')} — retry with one of these exact coordinates.`
      : '\nNo legal bridge site anywhere on the map — reshape a water channel to a straight, uniform 3-6 cell width with flat equal banks first.';
  }
  return result;
}

function removeObject(deps: AgentToolDeps, input: Record<string, unknown>): ToolResultBody {
  const id = String(input.objectId);
  const obj = deps.getState().objects.get(id);
  if (!obj) return { isError: true, content: `No object with id "${id}". Use get_objects.` };
  return runStroke(
    deps,
    [removeObjectCommand(obj)],
    () => `Removed ${obj.catalogId} (${id}).`,
  );
}

async function rotateObject(deps: AgentToolDeps, input: Record<string, unknown>): Promise<ToolResultBody> {
  const id = String(input.objectId);
  const rotation = Number(input.rotation) as 0 | 90 | 180 | 270;
  const state = deps.getState();
  const obj = state.objects.get(id);
  if (!obj) return { isError: true, content: `No object with id "${id}".` };
  const item = getCatalogItem(obj.catalogId);
  if (!item?.rotatable) return { isError: true, content: `${obj.catalogId} is not rotatable.` };
  const exec = deps.getExecutor();
  let failure: string | null = null;
  const { reverted, violations } = await runStrokeBody(deps, () => {
    const rm = exec.execute({
      ...removeObjectCommand(obj) });
    if (!rm.success) {
      failure = formatErrors(rm.errors);
      return;
    }
    const place = buildPlaceCmd(deps, obj.catalogId, obj.position.x, obj.position.y, rotation, id);
    const pr = typeof place === 'string' ? null : exec.execute(place);
    if (!pr || !pr.success) {
      failure = pr ? formatErrors(pr.errors) : (place as string);
      // restore the original (state is identical to before the remove → must succeed)
      exec.execute(objectPlacementCommand(obj));
    }
  });
  if (reverted) return { isError: true, content: `REVERTED:\n${formatErrors(violations)}` };
  if (failure) return { isError: true, content: `Rotation failed (object restored unchanged):\n${failure}` };
  return { isError: false, content: `Rotated ${obj.catalogId} to ${rotation} degrees.` };
}

function trimCorner(deps: AgentToolDeps, input: Record<string, unknown>): ToolResultBody {
  const x = Number(input.x);
  const y = Number(input.y);
  const layer = input.layer === 'road' ? 'road' as const : 'terrain' as const;
  const cell = getCell(deps.getState().cells, x, y);
  const roadObj = layer === 'road'
    ? [...deps.getState().objects.values()].find((o) => getCatalogItem(o.catalogId)?.category === 'road' && o.position.x === x && o.position.y === y)
    : undefined;
  if (layer === 'terrain' && !cell?.terrain) return { isError: true, content: `No terrain at (${x},${y}) to trim.` };
  if (layer === 'road' && !roadObj) return { isError: true, content: `No road at (${x},${y}) to trim.` };
  const idx = CORNER_POS.indexOf(String(input.corner) as CornerPos);
  if (idx < 0) return { isError: true, content: 'corner must be TL|TR|BL|BR.' };
  const style = String(input.style);
  // The persisted CornerTrim value keeps the frozen compass suffix (TL→'tri-NW', same index).
  const value: CornerTrim = style === 'tri' ? (`tri-${CORNER_COMPASS[idx]}` as CornerTrim) : (style as CornerTrim);
  const before = layer === 'terrain' ? cell?.terrain?.corners : roadObj?.corners;
  const after = [...(before ?? (['square', 'square', 'square', 'square'] as Corners))] as Corners;
  after[idx] = value;
  // same gates as the manual edge-cut tool: structural locks (incl. the
  // waterfall-frame policy) and edge-contact validity
  if (value !== 'square') {
    const locked = computeLockedCorners(deps.getState(), x, y, layer);
    if (locked[idx]) {
      return { isError: true, content: `Corner ${String(input.corner)} of (${x},${y}) is structurally locked (interior corner, water boundary, or waterfall frame) — it must stay square.` };
    }
    if (!validateCut(deps.getState(), x, y, layer, after)) {
      return { isError: true, content: `Trimming ${String(input.corner)} of (${x},${y}) to ${style} would break edge contact with a neighboring block.` };
    }
  }
  return runStroke(
    deps,
    [{ type: CommandType.TrimCorners, timestamp: Date.now(), x, y, layer, objectId: roadObj?.id, beforeCorners: before, afterCorners: after }],
    () => `Trimmed ${String(input.corner)} corner of (${x},${y}) to ${style}.`,
    undefined,
    undefined,
    // a silhouette-only cut can never invalidate any cut: skip the repair
    // pass exactly like the manual EdgeCutTool (EDGE-CUTS SKIP RECONCILE)
    { reconcile: false },
  );
}

function getCatalogItemTool(input: Record<string, unknown>): ToolResultBody {
  const item = getCatalogItem(String(input.id));
  if (!item) return { isError: true, content: `Unknown item id "${String(input.id)}".` };
  return {
    isError: false,
    content: `${item.id}: "${localizedName(item.name, 'en')}" — category ${item.category}, ${item.width}x${item.height}, rotatable=${item.rotatable}, maxCount=${item.maxCount ?? 'unlimited'}, traits=${JSON.stringify(item.traits)}`,
  };
}

/* ── dispatcher ──────────────────────────────────────────────────────── */

type ToolHandler = (deps: AgentToolDeps, input: Record<string, unknown>) => ToolResultBody | Promise<ToolResultBody>;

/**
 * Tool dispatch registry — ONE record per tool ties its handler to whether it
 * mutates the map. WRITE_TOOLS and executeToolCall are DERIVED from this, so:
 *  - a write tool can't be dispatched without being marked `write` (the UI's
 *    approval gate keys off WRITE_TOOLS — a missing flag would bypass it);
 *  - a tool can't have a handler with no schema, or a schema with no handler
 *    (the tool-surface parity test asserts TOOL_SCHEMAS names === registry keys).
 * Schemas stay in TOOL_SCHEMAS above (the wire format the model sees); this is
 * the runtime side of the same surface.
 */
export const TOOL_HANDLERS: Record<string, { write?: boolean; handler: ToolHandler }> = {
  // ── read / inspect ──
  inspect_region: { handler: (deps, input) => ({ isError: false, content: regionTokens(deps.getState(), { x1: Number(input.x1), y1: Number(input.y1), x2: Number(input.x2), y2: Number(input.y2) }) }) },
  get_objects: { handler: (deps, input) => {
    const cat = input.category as string | undefined;
    const objs = [...deps.getState().objects.values()].filter((o) => !cat || getCatalogItem(o.catalogId)?.category === cat);
    return { isError: false, content: objs.length ? objs.map(objectLine).join('\n') : 'No objects placed.' };
  } },
  get_selection: { handler: (deps) => ({ isError: false, content: `${selectionContext(deps.getRegion())}\n${selectedBlockContext(deps)}` }) },
  get_catalog_item: { handler: (_deps, input) => getCatalogItemTool(input) },
  view_map: { handler: async (deps) => {
    const url = deps.snapshot ? await deps.snapshot() : null;
    return url
      ? { isError: false, content: 'Rendered view of the current map attached.', image: { dataUrl: url } }
      : { isError: false, content: `Render unavailable, token overview instead.\n${mapOverview(deps.getState())}` };
  } },
  evaluate_map: { handler: (deps) => {
    const { report, prev } = evaluateWithTrend(deps.getState());
    return { isError: false, content: renderScorecard(report, prev) };
  } },
  export_map: { handler: (deps, input) => {
    const kind = input.kind === 'json' ? 'json' as const : 'image' as const;
    if (!deps.requestExport) {
      return { isError: true, content: 'Export is only available in the live editor, not in this context.' };
    }
    deps.requestExport(kind);
    return { isError: false, content: `Opened the ${kind === 'json' ? 'JSON project' : 'share image'} export dialog for the user to review and download.` };
  } },
  suggest_reply: { handler: (_deps, input) => {
    const reply = typeof input.reply === 'string' ? input.reply.trim() : '';
    if (!reply) return { isError: true, content: 'reply must be a non-empty string.' };
    return { isError: false, content: 'Suggestion noted.' };
  } },
  update_plan: { handler: (deps, input) => {
    const raw = input.stages;
    const ok = Array.isArray(raw) && raw.every(
      (s) => s && typeof (s as PlanStage).title === 'string' && ['pending', 'active', 'done'].includes((s as PlanStage).status),
    );
    if (!ok) return { isError: true, content: 'stages must be [{title, status: pending|active|done}, …].' };
    const stages = raw as PlanStage[];
    const doneBefore = new Set((deps.getPlan?.() ?? []).filter((s) => s.status === 'done').map((s) => s.title));
    deps.setPlan?.(stages);
    let msg = `Plan updated (${stages.filter((s) => s.status === 'done').length}/${stages.length} done).`;
    // Closed-loop hook: a stage just completed → measure NOW and hand the model
    // the trend, so course corrections happen at the stage boundary for free.
    if (stages.some((s) => s.status === 'done' && !doneBefore.has(s.title))) {
      const { report, prev } = evaluateWithTrend(deps.getState());
      msg += `\n${renderScoreDelta(prev, report)}`;
    }
    return { isError: false, content: msg };
  } },
  list_skills: { handler: () => ({ isError: false, content: `Available skills:\n${listSkills()}\nUse load_skill to get the full playbook.` }) },
  load_skill: { handler: (_deps, input) => {
    const skill = SKILLS[String(input.name)];
    return skill
      ? { isError: false, content: skill.body }
      : { isError: true, content: `Unknown skill "${String(input.name)}". Available:\n${listSkills()}` };
  } },
  find_flat_areas: { handler: findFlatAreas },
  find_bridge_sites: { handler: findBridgeSites },
  find_ramp_sites: { handler: findRampSites },

  // ── write (mutate the map → approval gate + edit counter) ──
  paint_terrain: { write: true, handler: paintTerrain },
  erase_terrain: { write: true, handler: eraseTerrain },
  place_object: { write: true, handler: placeObject },
  remove_object: { write: true, handler: removeObject },
  rotate_object: { write: true, handler: rotateObject },
  trim_corner: { write: true, handler: trimCorner },
  clear_area: { write: true, handler: clearArea },
  sculpt_terrace: { write: true, handler: sculptTerrace },
  carve_river: { write: true, handler: carveRiver },
  build_road: { write: true, handler: buildRoad },
  scatter_objects: { write: true, handler: scatterObjects },
  run_generator: { write: true, handler: runGenerator },
  decorate_zone: { write: true, handler: decorateZoneHandler },
  plant_forest: { write: true, handler: plantForestHandler },
  build_road_network: { write: true, handler: buildRoadNetworkHandler },
  frame_crossing: { write: true, handler: frameCrossingHandler },
  // delegate_task is intercepted by the chat layer (needs the LLM adapter); reaching
  // this fallback means no delegate handler was wired. Marked write to gate it.
  delegate_task: { write: true, handler: () => ({ isError: true, content: 'Delegation is not available in this context — do the task directly.' }) },
  undo: { write: true, handler: (deps, input) => {
    const steps = Math.min(Math.max(Number(input.steps) || 1, 1), 10);
    let n = 0;
    for (let i = 0; i < steps; i++) if (deps.getExecutor().undo()) n++;
    return { isError: false, content: `Undid ${n} step(s).` };
  } },
  redo: { write: true, handler: (deps, input) => {
    const steps = Math.min(Math.max(Number(input.steps) || 1, 1), 10);
    const exec = deps.getExecutor();
    let n = 0;
    for (let i = 0; i < steps; i++) { if (!exec.canRedo()) break; exec.redo(); n++; }
    return { isError: false, content: `Redid ${n} step(s).` };
  } },
};

/** Tools that mutate the map — the UI's approval gate ("ask before edits") and the
 *  per-turn edit counter key off this set. Derived from the registry's write flags. */
export const WRITE_TOOLS: ReadonlySet<string> = new Set(
  Object.entries(TOOL_HANDLERS).filter(([, def]) => def.write).map(([name]) => name),
);

export async function executeToolCall(call: ToolCall, deps: AgentToolDeps): Promise<ToolResult> {
  let body: ToolResultBody;
  try {
    const def = TOOL_HANDLERS[call.name];
    body = def
      ? await def.handler(deps, call.input ?? {})
      : { isError: true, content: `Unknown tool "${call.name}".` };
  } catch (err) {
    body = { isError: true, content: `Tool crashed: ${err instanceof Error ? err.message : String(err)}` };
  }
  return { toolCallId: call.id, ...body };
}

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
  const obj = deps.getState().objects.get(sel.id);
  return obj
    ? `Clicked block: object ${objectLine(obj)}. "This/it" likely refers to it.`
    : 'Clicked block: none.';
}

/** Per-turn volatile context injected ahead of the user message (kept out of the
 *  cached system prefix). */
export function buildMapContext(state: GridState, region: MacroCoord[], deps?: AgentToolDeps): string {
  const sel = deps ? `\n${selectedBlockContext(deps)}` : '';
  return `${mapSummary(state)}\n${selectionContext(region)}${sel}\n${mapOverview(state)}`;
}
