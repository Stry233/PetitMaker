/**
 * The tool surface: every `ToolSpec` by name, and everything derived from them. The wire schemas,
 * the tool facts the approval gate reads, the helper surface and dispatch all read `TOOLS`, so a tool
 * cannot be offered without a handler, run without a schema, or edit the map without passing the gate.
 */
import { getAnnotationsTool, removeAnnotationTool, setAnnotationTool } from './annotations';
import { buildRoadNetworkTool, decorateZoneTool, frameCrossingTool, plantForestTool } from './director';
import { argError } from './feedback';
import { drawFigureTool } from './figure';
import {
  delegateTaskTool, exportMapTool, listSkillsTool, loadSkillTool, redoTool, suggestReplyTool, undoTool, updatePlanTool,
} from './harness';
import { toolCrashed, unknownTool } from '../core/nudges';
import type { GuideTools, ToolFacts } from '../core/tool-facts';
import type { AgentToolDeps } from './deps';
import { callFootprint } from './geometry';
import {
  evaluateMapTool, findSpeckleTool, getCatalogItemTool, getObjectsTool, getSelectionTool, inspectRegionTool, viewMapTool,
} from './inspect';
import { TOOL_NAMES, type ToolName } from './names';
import { buildRoadTool, placeObjectTool, removeObjectTool, rotateObjectTool, scatterObjectsTool } from './objects';
import { checkArgs, toJsonSchema, type Shape } from './schema';
import { findBridgeSitesTool, findFlatAreasTool, findRampSitesTool } from './search';
import type { ToolCall, ToolOutcome, ToolResult, ToolSchema, ToolSpec } from './spec';
import { clearAreaTool, eraseTerrainTool, paintTerrainTool, trimCornerTool } from './terrain';
import { carveRiverTool, sculptTerraceTool, sculptWallTool, sinkPoolTool } from './terraform';

export const TOOLS = {
  get_annotations: getAnnotationsTool,
  set_annotation: setAnnotationTool,
  remove_annotation: removeAnnotationTool,
  inspect_region: inspectRegionTool,
  get_objects: getObjectsTool,
  get_selection: getSelectionTool,
  get_catalog_item: getCatalogItemTool,
  view_map: viewMapTool,
  evaluate_map: evaluateMapTool,
  update_plan: updatePlanTool,
  export_map: exportMapTool,
  suggest_reply: suggestReplyTool,
  paint_terrain: paintTerrainTool,
  erase_terrain: eraseTerrainTool,
  place_object: placeObjectTool,
  remove_object: removeObjectTool,
  rotate_object: rotateObjectTool,
  trim_corner: trimCornerTool,
  find_flat_areas: findFlatAreasTool,
  scatter_objects: scatterObjectsTool,
  sculpt_terrace: sculptTerraceTool,
  sculpt_wall: sculptWallTool,
  sink_pool: sinkPoolTool,
  draw_figure: drawFigureTool,
  carve_river: carveRiverTool,
  clear_area: clearAreaTool,
  find_speckle: findSpeckleTool,
  find_bridge_sites: findBridgeSitesTool,
  find_ramp_sites: findRampSitesTool,
  build_road: buildRoadTool,
  list_skills: listSkillsTool,
  load_skill: loadSkillTool,
  delegate_task: delegateTaskTool,
  undo: undoTool,
  decorate_zone: decorateZoneTool,
  plant_forest: plantForestTool,
  build_road_network: buildRoadNetworkTool,
  frame_crossing: frameCrossingTool,
  redo: redoTool,
} satisfies Record<ToolName, ToolSpec<Shape>>;

/** The spec a name declares, or undefined for a name no tool has. */
function toolSpec(name: string): ToolSpec<Shape> | undefined {
  return (TOOLS as Partial<Record<string, ToolSpec<Shape>>>)[name];
}

const schemaOf = (name: ToolName): ToolSchema => {
  const spec = TOOLS[name] as ToolSpec<Shape>;
  return {
    name,
    description: spec.description,
    input: spec.input,
    // Emitted on read: an enum may come from data registered after this module loads.
    get inputSchema() { return toJsonSchema(spec.input); },
  };
};

/** Every tool as the parent job's provider is shown it, in wire order. */
const TOOL_SCHEMAS: ToolSchema[] = TOOL_NAMES.map(schemaOf);

/** The parent's tools minus the parent-only ones: what a delegated helper is offered. */
const SUBAGENT_TOOL_SCHEMAS: ToolSchema[] = TOOL_SCHEMAS.filter((t) => toolSpec(t.name)?.parentOnly !== true);

/** A search family's wildcard, typed so the family must still have a member. */
type FamilyWildcard<P extends string> = Extract<ToolName, `${P}_${string}`> extends never ? never : `${P}_*`;

/** The tools the loop's advice names, by what each offers. */
const GUIDES = {
  inspect: 'inspect_region', view: 'view_map', score: 'evaluate_map', skill: 'load_skill', search: 'find_*',
} as const satisfies { [K in keyof GuideTools]: K extends 'search' ? FamilyWildcard<'find'> : ToolName };

/** The registry as the harness reads it, without naming a tool. */
export const TOOL_FACTS: ToolFacts = {
  access: (name) => toolSpec(name)?.access,
  verifies: (name) => toolSpec(name)?.verifies === true,
  footprint: callFootprint,
  guides: GUIDES,
};

/** The schemas a provider is sent at the requested execution depth. */
export function wireSchemas(opts?: { subagent?: boolean }): { name: string; description: string; parameters: Record<string, unknown> }[] {
  const schemas = opts?.subagent ? SUBAGENT_TOOL_SCHEMAS : TOOL_SCHEMAS;
  return schemas.map((s) => ({ name: s.name, description: s.description, parameters: s.inputSchema }));
}

/** A call's arguments checked against its tool's schema before anything runs: the accepted
 *  arguments, or the refusal naming the first problem. A name with no tool passes through. */
export function checkToolArgs(name: string, input: Record<string, unknown> | undefined): { input: Record<string, unknown> } | { refusal: ToolOutcome } {
  const spec = toolSpec(name);
  if (!spec) return { input: input ?? {} };
  const checked = checkArgs(spec.input, input);
  if (checked.ok) return { input: checked.value };
  const example = typeof spec.example === 'function' ? spec.example() : spec.example;
  return { refusal: argError(`${checked.problem} Nothing was changed.`, example) };
}

export async function executeToolCall(call: ToolCall, deps: AgentToolDeps): Promise<ToolResult> {
  let body: ToolOutcome;
  // The only place the call id reaches the provenance source, which tells an edit approved at this
  // call's gate from one run under allow-always for the export disclosure's `aiAccepted` count.
  const scoped: AgentToolDeps = deps.getProvenanceSource
    ? { ...deps, getProvenanceSource: () => deps.getProvenanceSource!(call.id) }
    : deps;
  try {
    const spec = toolSpec(call.name);
    const args = checkToolArgs(call.name, call.input);
    body = !spec?.run
      ? { isError: true, content: unknownTool(call.name) }
      : 'refusal' in args ? args.refusal : await spec.run(scoped, args.input);
  } catch (err) {
    body = { isError: true, content: toolCrashed(err) };
  }
  return { toolCallId: call.id, ...body };
}
