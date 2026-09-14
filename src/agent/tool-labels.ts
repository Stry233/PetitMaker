/** Localized operation names shared by approvals and progress displays. */
export const TOOL_VERB_KEYS: Readonly<Record<string, string>> = {
  inspect_region: 'agent3.verb_inspect_region',
  get_objects: 'agent3.verb_get_objects',
  get_selection: 'agent3.verb_get_selection',
  get_catalog_item: 'agent3.verb_get_catalog_item',
  view_map: 'agent3.verb_view_map',
  evaluate_map: 'agent3.verb_evaluate_map',
  update_plan: 'agent3.verb_update_plan',
  export_map: 'agent3.verb_export_map',
  suggest_reply: 'agent3.verb_suggest_reply',
  paint_terrain: 'agent3.verb_paint_terrain',
  erase_terrain: 'agent3.verb_erase_terrain',
  place_object: 'agent3.verb_place_object',
  remove_object: 'agent3.verb_remove_object',
  rotate_object: 'agent3.verb_rotate_object',
  trim_corner: 'agent3.verb_trim_corner',
  find_flat_areas: 'agent3.verb_find_flat_areas',
  find_speckle: 'agent3.verb_find_speckle',
  scatter_objects: 'agent3.verb_scatter_objects',
  sculpt_terrace: 'agent3.verb_sculpt_terrace',
  sculpt_wall: 'agent3.verb_sculpt_wall',
  sink_pool: 'agent3.verb_sink_pool',
  draw_figure: 'agent3.verb_draw_figure',
  carve_river: 'agent3.verb_carve_river',
  clear_area: 'agent3.verb_clear_area',
  find_bridge_sites: 'agent3.verb_find_bridge_sites',
  find_ramp_sites: 'agent3.verb_find_ramp_sites',
  build_road: 'agent3.verb_build_road',
  list_skills: 'agent3.verb_list_skills',
  load_skill: 'agent3.verb_load_skill',
  delegate_task: 'agent3.verb_delegate_task',
  undo: 'agent3.verb_undo',
  decorate_zone: 'agent3.verb_decorate_zone',
  plant_forest: 'agent3.verb_plant_forest',
  build_road_network: 'agent3.verb_build_road_network',
  frame_crossing: 'agent3.verb_frame_crossing',
  redo: 'agent3.verb_redo',
 };

export function toolVerbKey(name: string): string {
  return TOOL_VERB_KEYS[name] ?? 'agent3.verb_operation';
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** Replaces operation identifiers only in displayed assistant text; provider history stays verbatim. */
export function displayAgentText(text: string, t: Translate): string {
  return text.replace(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g, (name) => t(toolVerbKey(name)));
}
