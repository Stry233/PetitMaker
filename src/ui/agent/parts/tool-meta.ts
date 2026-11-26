/** Icons for panel progress and history; the operation names are `agent/panel.ts:toolVerbKey`. */
import type { IconId } from './sprite';
import { isToolName, type ToolName } from '../../../agent/panel';

const TOOL_ICONS: Record<ToolName, IconId> = {
  get_annotations: 'pw-inspect',
  set_annotation: 'pw-note',
  remove_annotation: 'pw-eraser',
  inspect_region: 'pw-inspect',
  get_objects: 'pw-inspect',
  get_selection: 'pw-region-frame',
  get_catalog_item: 'pw-note',
  view_map: 'pw-snapshot',
  evaluate_map: 'pw-evaluate',
  update_plan: 'pw-plan',
  list_app_actions: 'pw-inspect',
  run_app_action: 'pw-settings',
  suggest_reply: 'pw-send',
  paint_terrain: 'pw-terrain-raise',
  erase_terrain: 'pw-eraser',
  place_object: 'pw-object-place',
  remove_object: 'pw-object-remove',
  rotate_object: 'pw-rotate',
  trim_corner: 'pw-trim-corner',
  find_flat_areas: 'pw-search-sites',
  find_speckle: 'pw-search-sites',
  scatter_objects: 'pw-scatter',
  sculpt_terrace: 'pw-terrace-steps',
  sculpt_wall: 'pw-terrace-steps',
  sink_pool: 'pw-river',
  raise_platform: 'pw-terrace-steps',
  copy_area: 'pw-scatter',
  replace_objects: 'pw-scatter',
  mirror_area: 'pw-scatter',
  check_build: 'pw-scatter',
  carve_river: 'pw-river',
  clear_area: 'pw-clear',
  find_bridge_sites: 'pw-bridge',
  find_ramp_sites: 'pw-ramp',
  build_road: 'pw-road',
  lay_route: 'pw-road',
  draw_area: 'pw-decorate',
  list_skills: 'pw-skill',
  load_skill: 'pw-skill',
  delegate_task: 'pw-subagent',
  undo: 'pw-undo-arrow',
  redo: 'pw-skip-forward',
};

export function iconForTool(name: string): IconId {
  return isToolName(name) ? TOOL_ICONS[name] : 'pw-inspect';
}
