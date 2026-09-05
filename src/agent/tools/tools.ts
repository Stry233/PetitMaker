/**
 * Agent tool surface: JSON-schema tool definitions + the execution bridge that
 * maps LLM tool calls onto the editor's CommandExecutor.
 *
 * The write contract every handler here runs under — one silent stroke group per call,
 * reject-and-skip, "REVERTED: …" feedback, English rule text — lives with the stroke
 * runner in tools-common.ts.
 */
import {
  CellZone,
  CommandType,
  ItemCategory,
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
import { getCatalogByCategory, getCatalogItem, getRoadMaterials } from '../../state/catalog';
import { localizedName } from '../../i18n/context';
import { edgeCutGeneratedTerrain, edgeCutGeneratedRoads } from '../../tools/edge-cut';
import { computeLockedCorners } from '../../core/edge-cut/trim-lock';
import { validateCut } from '../../core/edge-cut/cut-validator';
import { roadLookup } from '../../state/object-index';
import { CORNER_POS, CORNER_COMPASS, type CornerPos } from '../../core/edge-cut/corner-index';
import { objectRect } from '../../state/object-geometry';
import { coatingsUnder } from '../../state/object-index';
import { isCoating, hasTrait, standsOnCoating } from '../../core/model/traits';
import { makeRng } from '../../core/model/rng';
import { mapOverview, mapSummary, objectLine, regionTokens, selectionContext, REGION_CAP } from '../serialize';
import { decorateZoneHandler, plantForestHandler, buildRoadNetworkHandler, frameCrossingHandler, THEMES } from './tools-director';
import { SKILLS, listSkills } from '../skills';
import { evaluateMap, renderScorecard, speckleFindings, type QualityReport } from '../quality';
import type { ToolCall, ToolResult, ToolSchema } from './types';
import { type AgentToolDeps, type ToolResultBody, argError, clamp, clipBuildable, clipOccupied, dedupe, formatErrors, geometryError, occupiedNote, offZoneNote, runStroke, runStrokeBody, resolveCells, waterSpanTrait } from './tools-common';
import { rectInput } from './geometry';
import { regionClip, sculptTerrace, carveRiver, sculptWall, sinkPool } from './tools-terraform';
import { findFlatAreas, findBridgeSites, findRampSites, scanBridgeSites } from './tools-search';
import { objectPlacementCommand, removeObjectCommand } from '../../tools/objects';

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
const cellsProp = {
  type: 'array',
  items: { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' } }, required: ['x', 'y'] },
  description: 'Explicit cell list, for shape "cells".',
};
// The area, FLAT FIRST: some guided decoders never emit an optional nested object, so every
// geometry is reachable through top-level scalars; the nested forms stay accepted beside them.
const cellsOrRect = {
  shape: {
    type: 'string',
    enum: ['rect', 'circle', 'line', 'cells'],
    description: 'Area form: "rect" fills x1,y1..x2,y2 (inclusive corners); "circle" fills radius r around cx,cy; "line" strokes x1,y1..x2,y2 at width; "cells" reads the cells array.',
  },
  ...coordProps,
  cx: { type: 'integer' },
  cy: { type: 'integer' },
  r: { type: 'integer', minimum: 1 },
  width: { type: 'integer', minimum: 1, description: 'Line stroke width (default 1).' },
  outline: {
    type: 'boolean',
    description: 'With rect or circle: paint only the 1-cell border ring (e.g. a mountain rim to contain water).',
  },
  cells: cellsProp,
  rect: {
    type: 'object',
    properties: coordProps,
    required: ['x1', 'y1', 'x2', 'y2'],
    description: 'Nested alternative to shape "rect".',
  },
  circle: {
    type: 'object',
    properties: { cx: { type: 'integer' }, cy: { type: 'integer' }, r: { type: 'integer', minimum: 1 } },
    required: ['cx', 'cy', 'r'],
    description: 'Nested alternative to shape "circle".',
  },
  line: {
    type: 'object',
    properties: {
      x1: { type: 'integer' }, y1: { type: 'integer' }, x2: { type: 'integer' }, y2: { type: 'integer' },
      width: { type: 'integer', minimum: 1, description: 'Stroke width (default 1).' },
    },
    required: ['x1', 'y1', 'x2', 'y2'],
    description: 'Nested alternative to shape "line".',
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
      'See the map as a rendered image (on vision models) or a token grid. Pass x1,y1,x2,y2 to view just that region, close up. Rendered images carry a coordinate ruler so you can map what you see to the cells you edit. Use it to judge COMPOSITION — shapes, balance, ragged edges — after major terrain or decoration work. Costs tokens on vision models; prefer evaluate_map for objective metrics.',
    inputSchema: {
      type: 'object',
      properties: {
        x1: { type: 'number' }, y1: { type: 'number' }, x2: { type: 'number' }, y2: { type: 'number' },
      },
      required: [],
    },
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
      'Commit your staged build plan (replaces the whole plan each call). Use for any multi-stage request: call it FIRST, before any edit, with 3-6 concrete stages in the order you will build them, then work down the list. The user sees the stages as a rail beside the work, each stage one row about 30 characters wide with a step count beside it — write each label as a short noun phrase ("terrace the north hills"), not a sentence, or it will not read as one line.',
    inputSchema: {
      type: 'object',
      properties: {
        stages: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: { label: { type: 'string' } },
            required: ['label'],
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
    // THE ONE MODEL-AUTHORED STRING WITH A HARD CLIP, so its budget is the one that has to be true.
    // It stands as a ghost inside the composer's field (`ui/agent/Composer.tsx:GHOST_STYLE`:
    // `nowrap` + `overflow: hidden` + `ellipsis`), so unlike the says line (which expands on a tap)
    // and a stage label (which wraps), characters past the end are LOST. Measured from the shipped
    // faces at the real box — 378px of panel less its padding, the well's own inset, and the send
    // and stop buttons at 36px each — the field holds about 30 Latin characters and about 15 CJK,
    // where a glyph is a full em.
    description:
      "When your closing message leaves ONE obvious next step (a yes/no offer, a single natural follow-up), call this with the short reply the user would most likely send, in the user's own language. It appears as a one-tap suggestion inside their reply box, which shows about 30 characters in a Latin script and about 15 in Chinese, Japanese or Korean and simply cuts off what does not fit — so keep it to a few words. Skip it whenever the next step is genuinely open.",
    inputSchema: {
      type: 'object',
      properties: {
        reply: {
          type: 'string',
          description: 'The predicted user reply, verbatim-sendable. A few words: ~30 Latin characters, ~15 CJK.',
        },
      },
      required: ['reply'],
    },
  },
  // NO TOOL HERE PRODUCES `SessionEvent.gateAsked.quickAnswers`/`.options` (core/types.ts) — nothing
  // in this file calls `askGate` with either populated, so the wire shape stands ready with no
  // producer (a future "ask the user a multiple-choice question" tool is where one would go, right
  // here beside suggest_reply, the other tool that shapes the closing message). When it lands, state
  // its lengths as plainly as suggest_reply states its own 30/15: a `quickAnswers` entry is one pill
  // that wraps onto its own row with its siblings (`GateBlock.tsx:QuickRow`, no hard per-pill cap,
  // but a handful of short words reads as a choice, a sentence reads as an essay) — call it 20
  // characters; a `GateOption.cap` is ONE ellipsized line beside an 88x62 thumbnail in a card sized
  // to the panel's own content width (`OptionPick.tsx:OPTION_THUMB`, `PanelShell.tsx`'s ~326px) —
  // call it 40 characters before it clips.
  {
    name: 'paint_terrain',
    description:
      'Paint mountain or water on an area given as shape + flat coordinates (e.g. shape "rect" with x1,y1,x2,y2). Mountain auto-builds support tiers 1..elevation (give only the FINAL elevation; elevation 0 clears the cell). Water paints at exactly the given elevation — elevated water needs mountain at elevation-1 beneath it, and ALL water must be enclosed (V-WTR-02) by the end of this call or the whole call reverts.',
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
        nearX: { type: 'integer', description: 'Prefer anchors close to (nearX,nearY).' },
        nearY: { type: 'integer' },
        near: { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' } }, description: 'Nested alternative to nearX/nearY.' },
        limit: { type: 'integer', minimum: 1, maximum: 10, description: 'Max anchors to return (default 5, spread apart).' },
      },
      required: ['minWidth', 'minHeight'],
    },
  },
  {
    name: 'scatter_objects',
    description:
      'Place many items at once. pattern "scatter" (default) = a natural-looking arrangement (deterministic for the same area) for groves and meadows; "fill" = every cell of the rect in row order, for solid one-species beds, crop plots and 1-wide edging ribbons; "grid" = every step-th cell, for orchard lattices and islet parterres. Positions inside the rect (or the user selection if no rect), validated per placement (illegal spots are skipped). One undo step. Returns how many landed.',
    inputSchema: {
      type: 'object',
      properties: {
        catalogIds: { type: 'array', items: { type: 'string' }, description: 'Pool to sample from (ONE id for ordered patterns; mix species only for natural scatter).' },
        count: { type: 'integer', minimum: 1, maximum: 200 },
        ...coordProps,
        rect: { type: 'object', properties: coordProps, required: ['x1', 'y1', 'x2', 'y2'], description: 'Scatter area; the flat corners x1,y1,x2,y2 mean the same.' },
        pattern: { type: 'string', enum: ['scatter', 'fill', 'grid'], description: 'scatter = natural arrangement (default); fill = solid row-major fill; grid = a lattice of every step-th cell.' },
        step: { type: 'integer', minimum: 2, maximum: 6, description: 'Grid pitch for pattern "grid" (default 2: an open lattice).' },
        spacing: { type: 'integer', minimum: 0, description: 'Extra min distance between placed items (default 0; trees already keep their own exclusion radius). Ignored by fill/grid.' },
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
        seed: { type: 'integer', description: 'Shape seed (derived from the site when omitted, so the same call replays).' },
      },
      required: ['cx', 'cy', 'baseRadius'],
    },
  },
  {
    name: 'sculpt_wall',
    description:
      'Raise a BANDED BACKING WALL in one call: the expert maps\' primary form. Bands step up +3 per inset ring (legal by construction), the crest stays flat and pavable, and flood:true sinks a crest pool inside its own rim. Use for the map\'s far-side wall or any tall plateau; sculpt_terrace stays the tool for small organic hills.',
    inputSchema: {
      type: 'object',
      properties: {
        ...coordProps,
        edge: { type: 'string', enum: ['N', 'S', 'E', 'W'], description: 'Site the wall AS the map\'s boundary: abutting this edge of the buildable grass, spanning it, depth rows deep (overrides the corners). A backing wall is a boundary condition, not a centerpiece.' },
        depth: { type: 'integer', minimum: 7, maximum: 30, description: 'Rows deep when edge is given (default 14).' },
        crest: { type: 'integer', minimum: 2, maximum: 8, description: 'Crest elevation (default 6; lowered automatically if the rect is too shallow for the insets).' },
        flood: { type: 'boolean', description: 'Sink a crest pool (water at crest elevation inside a 1-cell rim).' },
        smooth: { type: 'string', enum: ['round', 'rect'], description: 'round (default) trims the outer cliffs organically; rect keeps them crisp.' },
      },
      required: ['x1', 'y1', 'x2', 'y2'],
    },
  },
  {
    name: 'sink_pool',
    description:
      'Sink a POOL COURT in one legal stroke: a 1-cell bench rim (mountain at `elevation`) holding water at the bench\'s own height — the containment the water rules demand, so it cannot revert half-built. islets:true leaves a step-3 lattice of bench islets inside the water (the parterre grid; plant it with scatter_objects pattern "grid" step 3). For terraced pool courts; ground-level lakes stay paint_terrain/draw_figure work.',
    inputSchema: {
      type: 'object',
      properties: {
        x1: { type: 'integer' }, y1: { type: 'integer' }, x2: { type: 'integer' }, y2: { type: 'integer' },
        elevation: { type: 'integer', minimum: 1, maximum: 3, description: 'Bench and water height (default 1).' },
        islets: { type: 'boolean', description: 'Leave the step-3 islet lattice inside the water.' },
        smooth: { type: 'string', enum: ['round', 'rect'], description: 'round (default) trims the bench corners; rect keeps them crisp.' },
      },
      required: ['x1', 'y1', 'x2', 'y2'],
    },
  },
  {
    name: 'draw_figure',
    description:
      'Paint an ICONIC ground-water figure with true symmetry: heart, ring or crescent, centered at cx,cy, size cells across. Optional ringId places a single-species ring of trees/flowers around the outline (the classic peach ring). For lettering and custom figures, compose cells yourself with paint_terrain (the figure-landscape skill has the rules).',
    inputSchema: {
      type: 'object',
      properties: {
        shape: { type: 'string', enum: ['heart', 'ring', 'crescent'] },
        cx: { type: 'integer' },
        cy: { type: 'integer' },
        size: { type: 'integer', minimum: 8, maximum: 48, description: 'Width in cells.' },
        ringId: { type: 'string', description: 'Catalog id planted in a ring around the figure (one species; omit for bare water).' },
        islandFor: { type: 'string', description: 'A building id to stand on a dry island at the figure\'s heart (the house-in-a-pond set piece); the island is sized for its footprint and margin, and a bridge reaches it via find_bridge_sites.' },
      },
      required: ['shape', 'cx', 'cy', 'size'],
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
      'Make room: in ONE step, remove every (non-locked) object touching the given cells AND erase the terrain there back to flat grass. Use before reshaping an area instead of removing objects one by one. NEVER answer a refused placement by clearing a district you built — fix the exact cells instead. A clear removing more than 25 objects or covering more than 400 cells refuses unless demolish:true acknowledges the scale.',
    inputSchema: { type: 'object', properties: { ...cellsOrRect, demolish: { type: 'boolean', description: 'Acknowledge a large demolition (over 25 objects or 400 cells).' } } },
  },
  {
    name: 'find_speckle',
    description:
      'Sweep the planting for NOISE: patches that are neither a bed, row, lattice nor specimen, or that mix 3+ species. Returns each noisy patch as a rect to clear_area or replant as one species. Free; run it before declaring a build done — disorder is invisible in the token grid.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'find_bridge_sites',
    description:
      'Search for spots where a bridge can legally be placed (straight 3-6 cell gap of water/void/lower ground with flat EQUAL-height banks). Returns anchor cells you can pass directly to place_object. ALWAYS use this before placing a bridge — valid sites are rare and invisible in the token grid.',
    inputSchema: {
      type: 'object',
      properties: {
        catalogId: { type: 'string', description: 'Bridge item id (determines deck width); default bridge-plank.' },
        nearX: { type: 'integer', description: 'Prefer sites close to (nearX,nearY).' },
        nearY: { type: 'integer' },
        near: { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' } }, description: 'Nested alternative to nearX/nearY.' },
        limit: { type: 'integer', minimum: 1, maximum: 10 },
      },
    },
  },
  {
    name: 'find_ramp_sites',
    description:
      'Scan for validated ramp placements connecting elevation tiers (the ramp equivalent of find_bridge_sites). Returns anchor cells, the catalog ramp item whose heightDrop matches each cliff, and which elevations it connects. Optional nearX/nearY and limit. Use before placing ramps instead of guessing cliff edges.',
    inputSchema: {
      type: 'object',
      properties: {
        nearX: { type: 'integer', description: 'Prefer sites close to (nearX,nearY).' },
        nearY: { type: 'integer' },
        near: { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' } }, description: 'Nested alternative to nearX/nearY.' },
        limit: { type: 'integer' },
      },
      required: [],
    },
  },
  {
    name: 'build_road',
    description:
      'Lay a road in one call: places one road tile per cell along a line given as flat x1,y1,x2,y2 (or explicit cells), skipping illegal cells. End-caps and bends are auto-trimmed like the manual road brush (smooth:"off" keeps them square). One undo step. Use instead of placing road cells one by one.',
    inputSchema: {
      type: 'object',
      properties: {
        catalogId: { type: 'string', enum: getRoadMaterials().map((i) => i.id) },
        shape: { type: 'string', enum: ['line', 'cells'], description: 'Path form: "line" strokes x1,y1..x2,y2 at width (bare corners mean the same); "cells" reads the cells array.' },
        ...coordProps,
        width: { type: 'integer', minimum: 1, description: 'Line stroke width (default 1).' },
        line: {
          type: 'object',
          properties: { x1: { type: 'integer' }, y1: { type: 'integer' }, x2: { type: 'integer' }, y2: { type: 'integer' }, width: { type: 'integer', minimum: 1 } },
          required: ['x1', 'y1', 'x2', 'y2'],
          description: 'Nested alternative to shape "line".',
        },
        cells: { type: 'array', items: { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' } }, required: ['x', 'y'] } },
        smooth: { type: 'string', enum: ['round', 'rect', 'off'], description: "End-cap/bend trim style (default 'round', the manual brush's Auto Trim)." },
      },
      required: ['catalogId'],
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
      'Spawn a focused sub-agent with a FRESH context to execute one well-scoped build task, and get back its summary. Use for big requests: split them into independent parts (e.g. "terrain the north hills", "build the village at (40,60)-(70,90)", "decorate the lakeshore") and delegate each. The sub-agent sees the live map but NOT this conversation — the task text must be self-contained (locations, sizes, style). While it works, the panel names it by `label` if you gave one, else by the first line of `task` — so give a short `label` whenever `task` runs longer than a few words.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Complete, self-contained instructions incl. coordinates/area and desired style.' },
        label: { type: 'string', description: "Optional short name (a few words, e.g. \"north grove\") shown in the panel while the helper works. Omit only when task already reads as one." },
      },
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
  const resolved = resolveCells(input, deps.getState());
  if (resolved.length === 0) return geometryError(input, 'area');
  if (resolved.length > 4000) return argError('too many cells in one call (max 4000), split the edit into smaller areas.');
  const zoneClip = clipBuildable(resolved, deps.getState());
  if (zoneClip.cells.length === 0) return argError('every cell lies outside the buildable grass zone (sea, beach, plaza or boundary), aim inside it.');
  const { cells, occupied } = clipOccupied(zoneClip.cells, deps.getState());
  const offZone = zoneClip.offZone;
  if (cells.length === 0) return argError('every remaining cell lies under standing objects; clear_area removes object and terrain together, or aim elsewhere.');
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
    () => `Painted ${label} elev ${elevation} on ${cells.length} cell(s)${smooth ? ', edges smoothed' : ''}.${offZoneNote(offZone)}${occupiedNote(occupied)}`,
    cells,
    // Non-interactive edge-cut (rounds convex tips/steps, fills empty notches).
    // Uses the generated-* path, NOT applyAutoEdgeCut: the latter needs a full
    // interactive ToolContext + the renderer's reconcile handling, and driving it
    // from a silent agent stroke leaves detached scene nodes (Pixi _parentID null).
    smooth ? (exec) => edgeCutGeneratedTerrain({ gridState: deps.getState(), executeCommand: (c: Command) => exec.execute(c) }, cells, smooth) : undefined,
  );
}


function eraseTerrain(deps: AgentToolDeps, input: Record<string, unknown>): ToolResultBody {
  const resolved = resolveCells(input, deps.getState());
  if (resolved.length === 0) return geometryError(input, 'area');
  const zoneClip = clipBuildable(resolved, deps.getState());
  if (zoneClip.cells.length === 0) return argError('every cell lies outside the buildable grass zone (sea, beach, plaza or boundary), aim inside it.');
  const { cells, occupied } = clipOccupied(zoneClip.cells, deps.getState());
  if (cells.length === 0) return argError('every remaining cell lies under standing objects; clear_area removes object and terrain together, or aim elsewhere.');
  return runStroke(
    deps,
    [{ type: CommandType.EraseTerrain, timestamp: Date.now(), cells }],
    () => `Erased terrain on ${cells.length} cell(s).${offZoneNote(zoneClip.offZone)}${occupiedNote(occupied)}`,
    cells,
  );
}


/* ── make room: remove intersecting objects + erase terrain, one stroke ── */

function clearArea(deps: AgentToolDeps, input: Record<string, unknown>): ToolResultBody {
  const state = deps.getState();
  const resolved = resolveCells(input, state);
  if (resolved.length === 0) return geometryError(input, 'area');
  const zoneClip = clipBuildable(resolved, state);
  if (zoneClip.cells.length === 0) return argError('every cell lies outside the buildable grass zone (sea, beach, plaza or boundary), aim inside it.');
  // A LOCKED object survives the clear, so the ground under it cannot be erased either: those
  // cells are skipped rather than letting one plaza-shadow cell refuse the stroke.
  const lockedRects = [...state.objects.values()].filter((o) => o.locked).map((o) => objectRect(o));
  const cells = zoneClip.cells.filter((c) => !lockedRects.some((r) => c.x + 1 > r.x && c.x < r.x + r.w && c.y + 1 > r.y && c.y < r.y + r.h));
  const underLocked = zoneClip.cells.length - cells.length;
  const offZone = zoneClip.offZone;
  if (cells.length === 0) return argError('every remaining cell lies under a locked structure, which a clear cannot touch.');
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
  // Large clears require explicit demolition intent.
  if ((removed > 25 || cells.length > 400) && input.demolish !== true) {
    return {
      isError: true,
      content: `STOP: this would remove ${removed} object(s) over ${cells.length} cell(s) — likely work already built. `
        + 'A refusal is fixed at its own cells, never by clearing the district. If the order genuinely asks for '
        + 'demolition at this scale, call again with demolish: true; otherwise clear only the exact cells you need.',
    };
  }
  commands.push({ type: CommandType.EraseTerrain, timestamp: Date.now(), cells });
  return runStroke(deps, commands, () => `Cleared ${cells.length} cell(s): removed ${removed} object(s), terrain reset to flat grass.${offZoneNote(offZone)}${underLocked > 0 ? ` ${underLocked} cell(s) under a locked structure were skipped.` : ''}`, cells);
}


/* ── batch: lay a road along a path in one stroke ────────────────────── */

async function buildRoad(deps: AgentToolDeps, input: Record<string, unknown>): Promise<ToolResultBody> {
  // The schema requires catalogId; a model that omits it anyway gets the catalog's first road, the
  // same surface the tile brush arms by default.
  const catalogId = String(input.catalogId ?? getRoadMaterials()[0]!.id);
  const item = getCatalogItem(catalogId);
  if (!item || item.category !== 'road') {
    return argError(`"${catalogId}" is not a road item, pass a road id from the catalog.`, `catalogId: "${getRoadMaterials()[0]!.id}"`);
  }
  const resolvedRoad = resolveCells(input, deps.getState(), 'line');
  if (resolvedRoad.length === 0) return geometryError(input, 'path');
  if (resolvedRoad.length > 400) return argError('road too long for one call (max 400 cells), split it into segments.');
  const { cells, offZone } = clipBuildable(resolvedRoad, deps.getState());
  if (cells.length === 0) return argError('every cell lies outside the buildable grass zone (sea, beach, plaza or boundary), aim inside it.');
  const exec = deps.getExecutor();
  const failures: string[] = [];
  let ok = 0;
  const smooth = input.smooth === 'off' ? 'off' : input.smooth === 'rect' ? 'rect' as const : 'round' as const;
  const { reverted, violations, outOfRegion, detail } = await runStrokeBody(deps, () => {
    for (const cell of cells) {
      const cmd = buildPlaceCmd(deps, catalogId, cell.x, cell.y, 0);
      if (typeof cmd === 'string') continue;
      const r = exec.execute(cmd);
      if (r.success) ok++;
      else failures.push(formatErrors(r.errors));
    }
    // end-cap/bend trim via the non-interactive road cut; the interactive
    // applyAutoEdgeCut wants a ToolContext a silent stroke has not got
    if (ok > 0 && smooth !== 'off') {
      edgeCutGeneratedRoads({ gridState: deps.getState(), executeCommand: (c: Command) => exec.execute(c) }, cells, smooth);
    }
  });
  if (outOfRegion) return outOfRegion;
  if (reverted) return { isError: true, content: `REVERTED, nothing changed:\n${formatErrors(violations)}` };
  if (ok > 0) deps.onFlash?.(cells);
  let msg = `Laid ${ok}/${cells.length} road cell(s).${offZoneNote(offZone)}`;
  // Said at the moment the crossing is made: the close-out hint arrives when re-routing a whole
  // grid costs more turns than remain, so the lay itself names the four-way it just created.
  if (ok > 0) {
    const roadAtNow = roadLookup(deps.getState());
    const paved = (x: number, y: number) => roadAtNow(x, y) !== null;
    const made = cells.filter((c) => paved(c.x, c.y)
      && paved(c.x + 1, c.y) && paved(c.x - 1, c.y) && paved(c.x, c.y + 1) && paved(c.x, c.y - 1)
      && [paved(c.x + 1, c.y + 1), paved(c.x + 1, c.y - 1), paved(c.x - 1, c.y + 1), paved(c.x - 1, c.y - 1)].filter(Boolean).length <= 1);
    if (made.length > 0) {
      msg += `\nNote: this run crossed another street at ${made.slice(0, 3).map((c) => `(${c.x},${c.y})`).join(' ')}, making a FOUR-WAY — the reference never crosses two streets. Stop a side street AT the trunk (T junction) or offset it; fix this now while it is one street, not at the close.`;
    }
  }
  if (failures.length > 0) msg += ` Skipped cells:\n${dedupe(failures).slice(0, 2).join('\n')}`;
  if (ok === 0) {
    msg += '\nRoads coat FLAT GROUND-LEVEL GRASS only. Fixes: route across grass (roads may cross a bridge/ramp but not open water, mountains, or object footprints); clear_area to open a blocked path; or place a bridge/ramp for the gap first, then road up to it.';
  }
  return { isError: ok === 0, content: msg, detail };
}

/* ── batch: scatter objects in ordered or natural patterns ───────────── */

async function scatterObjects(deps: AgentToolDeps, input: Record<string, unknown>): Promise<ToolResultBody> {
  const ids = (input.catalogIds as string[] | undefined) ?? [];
  const count = Math.min(Math.max(Number(input.count) || 0, 1), 200);
  if (ids.length === 0) {
    const treeId = getCatalogByCategory(ItemCategory.Tree)[0]?.id ?? 'tree';
    return argError('catalogIds must be a non-empty array of item ids from the CATALOG section.', `catalogIds: ["${treeId}"], count: 20`);
  }
  for (const id of ids) {
    if (!getCatalogItem(id)) return argError(`unknown catalogId "${id}", use ids from the CATALOG section or get_catalog_item.`);
  }
  const state = deps.getState();
  const rect = rectInput(input);
  const resolvedPool = rect ? resolveCells({ rect }, state) : [...deps.getRegion()];
  const { cells: pool, offZone } = clipBuildable(resolvedPool, state);
  if (pool.length === 0) {
    return argError('no area to scatter over, pass the rect corners or have the user select a region first.', 'x1: 10, y1: 10, x2: 20, y2: 18');
  }
  const pattern = input.pattern === 'fill' || input.pattern === 'grid' ? input.pattern : 'scatter';
  const spacing = pattern === 'scatter' ? Math.max(0, Number(input.spacing) || 0) : 0;
  if (pattern === 'grid') {
    // A lattice anchored at the pool's own top-left, so two adjacent grid calls with the same
    // step line up. The clamp mirrors the schema; a malformed step falls to the open default.
    const step = clamp(Number(input.step) || 2, 2, 6);
    let minX = Infinity, minY = Infinity;
    for (const c of pool) { if (c.x < minX) minX = c.x; if (c.y < minY) minY = c.y; }
    const kept = pool.filter((c) => (c.x - minX) % step === 0 && (c.y - minY) % step === 0);
    pool.length = 0;
    pool.push(...kept);
  }
  // Seeded from the pool's own ground: the same call over the same area replays exactly (a macro,
  // not a dice roll), and a different area draws a different arrangement.
  const rng = makeRng(pool.reduce((h, c) => (h * 31 + c.x * 7 + c.y * 13) | 0, pool.length + count));
  if (pattern === 'scatter') {
    // shuffle (Fisher-Yates) on the seeded stream
    for (let i = pool.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    }
  }
  // fill and grid keep resolveCells' row-major order: an ordered pattern lands as drawn.
  const exec = deps.getExecutor();
  const placedAt: MacroCoord[] = [];
  const failures: string[] = [];
  // Coated cells are skipped up front rather than placed onto: V-PLACE-COATED is a POST-STROKE
  // rule, so one edging cell clipping a road would otherwise revert the whole scatter.
  const roadAt = roadLookup(deps.getState());
  let onRoad = 0;
  const { reverted, violations, outOfRegion, detail } = await runStrokeBody(deps, () => {
    for (const cell of pool) {
      if (placedAt.length >= count) break;
      if (spacing > 0 && placedAt.some((p) => Math.abs(p.x - cell.x) <= spacing && Math.abs(p.y - cell.y) <= spacing)) continue;
      const id = rng.pick(ids);
      const road = roadAt(cell.x, cell.y);
      if (road && !standsOnCoating(getCatalogItem(id), getCatalogItem(road.catalogId)!)) { onRoad++; continue; }
      const cmd = buildPlaceCmd(deps, id, cell.x, cell.y, 0);
      if (typeof cmd === 'string') continue;
      const r = exec.execute(cmd);
      if (r.success) placedAt.push(cell);
      else failures.push(formatErrors(r.errors));
    }
  });
  if (outOfRegion) return outOfRegion;
  if (reverted) return { isError: true, content: `REVERTED:\n${formatErrors(violations)}` };
  if (placedAt.length > 0) deps.onFlash?.(placedAt);
  let why = placedAt.length < count && failures.length > 0 ? ` Most common rejections:\n${dedupe(failures).slice(0, 3).join('\n')}` : '';
  if (onRoad > 0) why += `\n${onRoad} cell(s) skipped: they carry a road, and objects cannot stand on one. Edging runs BESIDE a street, so offset the rect off the pavement.`;
  why += offZoneNote(offZone);
  if (placedAt.length === 0) {
    why += '\nNothing placed. Most items need flat grass clear of water, slopes, and other objects. Fixes: pick a flatter/emptier area (find_flat_areas), lower the spacing, or clear_area first. Flora/trees will not sit on water or mountains.';
  }
  // Said at the moment of the mistake, because a budget-capped run may never reach the
  // find_speckle sweep that would otherwise name it.
  if (pattern === 'fill' && rect && placedAt.length > 0 && ids.every((id) => getCatalogItem(id)?.category === ItemCategory.Flora)) {
    const w = Math.abs(rect.x2 - rect.x1) + 1, h = Math.abs(rect.y2 - rect.y1) + 1;
    if (Math.min(w, h) >= 3 && Math.max(w, h) >= 12 && Math.max(w, h) >= 3 * Math.min(w, h)) {
      why += `\nNote: a ${w}x${h} solid flower band reads as a FILL, not edging — street and bank edging is 1-2 cells wide in the reference style. Keep this only if a broad bed is truly intended.`;
    }
  }
  return {
    isError: placedAt.length === 0,
    content: `Scattered ${placedAt.length}/${count} object(s) over ${pool.length} candidate cell(s).${why}`,
    detail,
  };
}

/* ── the speckle finder: names the planting noise a token grid cannot show ── */

/**
 * find_speckle: the planting clusters that read as NOISE — scattered (no row, grid or solid fill)
 * or species-mixed — each named as a rect the model can clear_area or replant as one bed. Five
 * rounds of live judging showed models cannot SEE this defect in tokens ('o' says occupied, not
 * disordered), so the close-out sweep fixes what this names instead of guessing.
 */
function findSpeckle(deps: AgentToolDeps): ToolResultBody {
  const state = deps.getState();
  const { findings, plantCount } = speckleFindings(state);
  if (plantCount === 0) return { isError: false, content: 'No planting on the map yet; nothing to sweep.' };
  if (findings.length === 0) {
    return { isError: false, content: 'Planting sweep clean: every patch reads as a bed, row, lattice or specimen, species-pure.' };
  }
  const lines = findings.slice(0, 8).map((f) => `- ${f.rect}: ${f.n} plants, ${f.why}`);
  return {
    isError: false,
    content: `${findings.length} noisy planting patch(es) — clear_area the rect and leave it empty, replant it as ONE species in a fill/grid, or narrow a wide band to a 1-2 cell ribbon:\n${lines.join('\n')}`,
  };
}

/* ── figures: iconic ground shapes, symmetric by construction ─────────── */

/** The figure's cells, mirror-symmetric where the shape is (heart, ring): the right half is the
 *  left half reflected, so no freehand lobe can bulge. All shapes are centered on (cx,cy). */
function figureCells(shape: 'heart' | 'ring' | 'crescent', cx: number, cy: number, size: number): MacroCoord[] {
  const r = size / 2;
  const out: MacroCoord[] = [];
  const push = (dx: number, dy: number) => { out.push({ x: cx + dx, y: cy + dy }); };
  if (shape === 'heart') {
    // The classic implicit heart, sampled on the half-plane and mirrored. v points UP (screen -dy);
    // the curve spans u in [-1.15,1.15], v in [-1,1.25], so the scale maps size to the lobes' width.
    const s = r / 1.15;
    for (let dy = -Math.ceil(r * 1.15); dy <= Math.ceil(r * 1.15); dy++) {
      for (let dx = 0; dx <= Math.ceil(r); dx++) {
        const u = dx / s;
        const v = (-dy + r * 0.12) / s;
        const a = u * u + v * v - 1;
        if (a * a * a - u * u * v * v * v <= 0) { push(dx, dy); if (dx > 0) push(-dx, dy); }
      }
    }
  } else if (shape === 'ring') {
    const band = Math.max(2, Math.round(size / 6));
    for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) {
      for (let dx = 0; dx <= Math.ceil(r); dx++) {
        const d = Math.hypot(dx, dy);
        if (d <= r && d > r - band) { push(dx, dy); if (dx > 0) push(-dx, dy); }
      }
    }
  } else {
    // Crescent: the disc minus a same-size disc shifted toward the opening (east).
    for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) {
      for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
        const d0 = Math.hypot(dx, dy);
        const d1 = Math.hypot(dx - r * 0.55, dy);
        if (d0 <= r && d1 > r * 0.85) push(dx, dy);
      }
    }
  }
  return out;
}

/**
 * draw_figure: the reference maps' iconic marks (a heart lake, a ring pond, a crescent) painted as
 * ground water with true symmetry, plus an optional single-species ring of trees or flowers around
 * the outline — the peach ring around the expert island's heart pond, as one deterministic call.
 */
async function drawFigure(deps: AgentToolDeps, input: Record<string, unknown>): Promise<ToolResultBody> {
  const shape = input.shape === 'ring' || input.shape === 'crescent' ? input.shape : input.shape === 'heart' ? 'heart' : null;
  if (!shape) return argError('shape must be "heart", "ring" or "crescent".', 'shape: "heart", cx: 110, cy: 70, size: 22');
  const cx = Number(input.cx);
  const cy = Number(input.cy);
  const size = clamp(Number(input.size) || 0, 8, 48);
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || size < 8) {
    return argError('draw_figure needs cx, cy and size (8-48 cells across).', 'shape: "heart", cx: 110, cy: 70, size: 22');
  }
  const state = deps.getState();
  const { width: mw, height: mh } = state.template;
  // The spread is the tool's own, so it clips to an armed region like the organic terraformers do.
  const clip = regionClip(deps);
  const cells = figureCells(shape, Math.round(cx), Math.round(cy), size)
    .filter((c) => c.x >= 1 && c.y >= 1 && c.x < mw - 1 && c.y < mh - 1)
    .filter((c) => !clip || clip.has(`${c.x},${c.y}`));
  const zoned = clipOccupied(clipBuildable(cells, deps.getState()).cells, deps.getState()).cells;
  if (zoned.length === 0) return argError('the figure lies off the map, outside the selected region, or outside the buildable grass zone; move cx,cy.');
  if (zoned.length < cells.length) { cells.length = 0; cells.push(...zoned); }

  const ringId = typeof input.ringId === 'string' ? input.ringId : undefined;
  if (ringId && !getCatalogItem(ringId)) return argError(`unknown ringId "${ringId}", use a tree or flora id from the CATALOG section.`);
  // islandFor: keep a DRY island at the figure's heart sized for the item plus the flat trait's
  // margin, and stand the item on it in the same stroke — the reference's house-in-a-pond set
  // piece, which hand composition kept missing because the dry margin is invisible arithmetic.
  const islandFor = typeof input.islandFor === 'string' ? input.islandFor : undefined;
  const islandItem = islandFor ? getCatalogItem(islandFor) : undefined;
  if (islandFor && !islandItem) return argError(`unknown islandFor "${islandFor}", use a building id from the CATALOG section.`);
  let waterCells = cells;
  let islandPlace: { x: number; y: number } | null = null;
  if (islandItem) {
    const iw = islandItem.width + 2, ih = islandItem.height + 2;
    if (size < Math.max(iw, ih) + 8) {
      return argError(`a ${islandItem.width}x${islandItem.height} island home needs the figure at least ${Math.max(iw, ih) + 8} across (island + margin + a real water ring); raise size.`);
    }
    let mx = 0, my = 0;
    for (const c of cells) { mx += c.x; my += c.y; }
    const icx = Math.round(mx / cells.length), icy = Math.round(my / cells.length);
    const ix1 = icx - Math.floor(iw / 2), iy1 = icy - Math.floor(ih / 2);
    const island = new Set<string>();
    for (let y = iy1; y < iy1 + ih; y++) for (let x = ix1; x < ix1 + iw; x++) island.add(`${x},${y}`);
    waterCells = cells.filter((c) => !island.has(`${c.x},${c.y}`));
    islandPlace = { x: ix1 + 1, y: iy1 + 1 };
  }
  const commands: Command[] = [{ type: CommandType.PaintTerrain, timestamp: Date.now(), cells: waterCells, terrainType: TerrainType.Water, elevation: 0 }];
  if (islandPlace && islandFor) {
    const cmd = buildPlaceCmd(deps, islandFor, islandPlace.x, islandPlace.y, 0);
    if (typeof cmd !== 'string') commands.push(cmd);
  }
  let ringWanted = 0;
  if (ringId) {
    // The ring stands 2 cells off the outline, one placement every ~3 cells of arc, radially from
    // the centroid so a heart's ring follows the lobes rather than a circle.
    const inside = new Set(cells.map((c) => `${c.x},${c.y}`));
    const outline = cells.filter((c) =>
      !inside.has(`${c.x + 1},${c.y}`) || !inside.has(`${c.x - 1},${c.y}`) || !inside.has(`${c.x},${c.y + 1}`) || !inside.has(`${c.x},${c.y - 1}`));
    let mx = 0, my = 0;
    for (const c of cells) { mx += c.x; my += c.y; }
    mx /= cells.length; my /= cells.length;
    // Walked by ARC LENGTH, not by angle: equal-angle sampling starves the stretches far from the
    // centroid (a heart lobe's long flank got a 20-cell bare run), while equal-arc spaces the ring
    // evenly along the shore. And for the mirror-symmetric shapes the ring is PLACED symmetrically:
    // the left half's placements are reflected across the figure's own axis, so the ring cannot be
    // lopsided whatever the walk order — the local mirror the doctrine asks of a composed view.
    const byAngle = outline
      .map((c) => ({ c, a: Math.atan2(c.y - my, c.x - mx) }))
      .sort((p, q) => p.a - q.a);
    const ringPos: MacroCoord[] = [];
    // Trees ring a figure at intervals (the reference's peach ring breathes); a FLOWER ring is
    // EDGING and must trace the shore continuously, or it reads as a speckle halo.
    const gap = getCatalogItem(ringId)?.category === ItemCategory.Flora ? 1.2 : 3.2; // cells of shoreline per placement
    let walked = gap; // place at the first outline cell too
    for (let i = 0; i < byAngle.length; i++) {
      const { c } = byAngle[i]!;
      const prev = byAngle[(i - 1 + byAngle.length) % byAngle.length]!.c;
      walked += Math.hypot(c.x - prev.x, c.y - prev.y);
      if (walked < gap) continue;
      walked = 0;
      const d = Math.hypot(c.x - mx, c.y - my) || 1;
      ringPos.push({
        x: Math.round(mx + (c.x - mx) * (1 + 2.2 / d) + (c.x - mx) / d * 2),
        y: Math.round(my + (c.y - my) * (1 + 2.2 / d) + (c.y - my) / d * 2),
      });
    }
    const axis = Math.round(cx);
    const mirrored = shape === 'crescent' ? ringPos : [
      ...ringPos.filter((p) => p.x <= axis),
      ...ringPos.filter((p) => p.x <= axis).map((p) => ({ x: 2 * axis - p.x, y: p.y })),
    ];
    const seen = new Set<string>();
    for (const p of mirrored) {
      const key = `${p.x},${p.y}`;
      if (seen.has(key) || inside.has(key)) continue;
      if (p.x < 0 || p.y < 0 || p.x >= mw || p.y >= mh) continue;
      if (clip && !clip.has(key)) continue;
      seen.add(key);
      ringWanted++;
      const cmd = buildPlaceCmd(deps, ringId, p.x, p.y, 0);
      if (typeof cmd !== 'string') commands.push(cmd);
    }
  }
  return runStroke(
    deps,
    commands,
    (ok) => `Drew a ${shape} of ${waterCells.length} water cells at (${Math.round(cx)},${Math.round(cy)})`
      + `${islandPlace ? `; ${islandFor} stands on a dry island at (${islandPlace.x},${islandPlace.y}) — find_bridge_sites near it for the way across` : ''}`
      + `${ringId ? `; ring: ${ringWanted} ${ringId} positions around it (${Math.max(0, ok - 1 - (islandPlace ? 1 : 0))} landed)` : ''}. The shape is symmetric by construction.`,
    waterCells,
  );
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
  if (!item) return `Arguments: unknown catalogId "${catalogId}", use ids from the CATALOG section or get_catalog_item.`;
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
  const { reverted, violations, outOfRegion } = await runStrokeBody(deps, () => {
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
  if (outOfRegion) return outOfRegion;
  if (reverted) return { isError: true, content: `REVERTED:\n${formatErrors(violations)}` };
  if (failure) return { isError: true, content: `Rotation failed (object restored unchanged):\n${failure}` };
  return { isError: false, content: `Rotated ${obj.catalogId} to ${rotation} degrees.` };
}

function trimCorner(deps: AgentToolDeps, input: Record<string, unknown>): ToolResultBody {
  const x = Number(input.x);
  const y = Number(input.y);
  const layer = input.layer === 'road' ? 'road' as const : 'terrain' as const;
  const state = deps.getState();
  const cell = getCell(state.cells, x, y);
  const roadObj = layer === 'road'
    ? [...state.objects.values()].find((o) => getCatalogItem(o.catalogId)?.category === 'road' && o.position.x === x && o.position.y === y)
    : undefined;
  if (layer === 'terrain' && !cell?.terrain) return { isError: true, content: `No terrain at (${x},${y}) to trim.` };
  if (layer === 'road' && !roadObj) return { isError: true, content: `No road at (${x},${y}) to trim.` };
  const idx = CORNER_POS.indexOf(String(input.corner) as CornerPos);
  if (idx < 0) return argError('corner must be one of TL, TR, BL, BR.', 'corner: "TL"');
  const style = String(input.style);
  // The persisted CornerTrim value keeps the frozen compass suffix (TL→'tri-NW', same index).
  const value: CornerTrim = style === 'tri' ? (`tri-${CORNER_COMPASS[idx]}` as CornerTrim) : (style as CornerTrim);
  const before = layer === 'terrain' ? cell?.terrain?.corners : roadObj?.corners;
  const after = [...(before ?? (['square', 'square', 'square', 'square'] as Corners))] as Corners;
  after[idx] = value;
  // same gates as the manual edge-cut tool: structural locks (incl. the
  // waterfall-frame policy) and edge-contact validity
  if (value !== 'square') {
    const roads = roadLookup(state);
    const locked = computeLockedCorners(state, roads, x, y, layer);
    if (locked[idx]) {
      return { isError: true, content: `Corner ${String(input.corner)} of (${x},${y}) is structurally locked (interior corner, water boundary, or waterfall frame) — it must stay square.` };
    }
    if (!validateCut(state, roads, x, y, layer, after)) {
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
  if (!item) return argError(`unknown item id "${String(input.id)}", use ids from the CATALOG section.`);
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
  inspect_region: { handler: (deps, input) => {
    const x1 = Number(input.x1), y1 = Number(input.y1), x2 = Number(input.x2), y2 = Number(input.y2);
    // A missing corner must refuse, not read: NaN corners yield an empty grid that reads as a
    // successful blank answer, so a misnamed argument would go unnoticed for a whole turn.
    if ([x1, y1, x2, y2].some(Number.isNaN)) {
      return argError('inspect_region needs all four corners as numbers, x1 y1 x2 y2.', '{"x1":40,"y1":30,"x2":60,"y2":45}');
    }
    return { isError: false, content: regionTokens(deps.getState(), { x1, y1, x2, y2 }) };
  } },
  get_objects: { handler: (deps, input) => {
    const cat = input.category as string | undefined;
    const objs = [...deps.getState().objects.values()].filter((o) => !cat || getCatalogItem(o.catalogId)?.category === cat);
    return { isError: false, content: objs.length ? objs.map(objectLine).join('\n') : 'No objects placed.' };
  } },
  get_selection: { handler: (deps) => ({ isError: false, content: `${selectionContext(deps.getRegion())}\n${selectedBlockContext(deps)}` }) },
  get_catalog_item: { handler: (_deps, input) => getCatalogItemTool(input) },
  view_map: { handler: async (deps, input) => {
    const given = [input.x1, input.y1, input.x2, input.y2].filter((c) => c !== undefined).length;
    if (given > 0) {
      const x1 = Number(input.x1), y1 = Number(input.y1), x2 = Number(input.x2), y2 = Number(input.y2);
      if (given < 4 || [x1, y1, x2, y2].some(Number.isNaN)) {
        return argError('view_map takes either no region or all four corners as numbers, x1 y1 x2 y2.', '{"x1":40,"y1":30,"x2":60,"y2":45}');
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
  } },
  evaluate_map: { handler: (deps) => {
    const { report, prev } = evaluateWithTrend(deps.getState());
    // The scorecard grades the WHOLE map. Said explicitly on a region-locked job, because a
    // bounded build read against whole-map absolutes looks like it moved nothing and the model
    // then spends turns chasing dimensions its region cannot reach.
    const region = deps.getRegion();
    const note = region.length > 0
      ? `\nNote: these scores grade the WHOLE map, and your work is confined to the ${region.length}-cell selected region. Read the TRENDS ("was N") for what your edits moved; do not chase whole-map absolutes a bounded build cannot reach.`
      : '';
    return { isError: false, content: renderScorecard(report, prev) + note };
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
    if (!reply) return argError('reply must be a non-empty string.', 'reply: "Yes, go ahead"');
    return { isError: false, content: 'Suggestion noted.' };
  } },
  // The loop handles `update_plan` because it owns plan events and plan-scope approval.
  list_skills: { handler: () => ({ isError: false, content: `Available skills:\n${listSkills()}\nUse load_skill to get the full playbook.` }) },
  load_skill: { handler: (_deps, input) => {
    const name = String(input.name);
    const skill = SKILLS[name];
    // Required playbook stages are also filed as visible plan items.
    return skill
      ? { isError: false, content: `${skill.body}\n\n(system) These stages are the program: file them as your update_plan stages by name and finish each before the next. A stage the playbook calls "not optional" is a commitment, not a suggestion.`, detail: { skill: { name, kind: skill.kind, title: skill.title } } }
      : { isError: true, content: `Unknown skill "${name}". Call list_skills for the catalogue.` };
  } },
  find_flat_areas: { handler: findFlatAreas },
  find_speckle: { handler: findSpeckle },
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
  sculpt_wall: { write: true, handler: sculptWall },
  sink_pool: { write: true, handler: sinkPool },
  draw_figure: { write: true, handler: drawFigure },
  build_road: { write: true, handler: buildRoad },
  scatter_objects: { write: true, handler: scatterObjects },
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
  // THE CALL'S OWN IDENTITY REACHES THE PROVENANCE SOURCE HERE AND NOWHERE ELSE. `runStroke` is
  // handed `deps`, not the call, so without this the source cannot tell an edit a human approved at
  // this call's gate from one that ran under a session-wide allow-always — and the export
  // disclosure's `aiAccepted` count was permanently zero on a panel whose whole gate machinery
  // exists to obtain that approval.
  const scoped: AgentToolDeps = deps.getProvenanceSource
    ? { ...deps, getProvenanceSource: () => deps.getProvenanceSource!(call.id) }
    : deps;
  try {
    const def = TOOL_HANDLERS[call.name];
    body = def
      ? await def.handler(scoped, call.input ?? {})
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
  // Which of view_map's two answers this connection gets is a wiring fact the model cannot
  // otherwise learn until it calls: told up front, a sighted seat reaches for the picture at its
  // review step and a text seat never budgets a turn hoping for one.
  const eyes = deps?.snapshot
    ? '\nThis connection has VISION: view_map returns a rendered picture of the map, and view_map with x1,y1,x2,y2 returns a close-up crop of that region. Look before declaring a build done.'
    : '';
  return `${mapSummary(state)}\n${selectionContext(region)}${sel}${eyes}\n${mapOverview(state)}`;
}
