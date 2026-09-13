/** Icons and localized operation names for panel progress and history. */
import type { IconId } from './icons';
import { TOOL_VERB_KEYS, toolVerbKey } from '../../agent/tool-labels';

const TOOL_ICONS: Record<string, IconId> = {
  inspect_region: 'pw-inspect',
  get_objects: 'pw-inspect',
  get_selection: 'pw-region-frame',
  get_catalog_item: 'pw-note',
  view_map: 'pw-snapshot',
  evaluate_map: 'pw-evaluate',
  update_plan: 'pw-plan',
  export_map: 'pw-export',
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
  draw_figure: 'pw-river',
  carve_river: 'pw-river',
  clear_area: 'pw-clear',
  find_bridge_sites: 'pw-bridge',
  find_ramp_sites: 'pw-ramp',
  build_road: 'pw-road',
  list_skills: 'pw-skill',
  load_skill: 'pw-skill',
  delegate_task: 'pw-subagent',
  undo: 'pw-undo-arrow',
  decorate_zone: 'pw-decorate',
  plant_forest: 'pw-forest',
  build_road_network: 'pw-road',
  frame_crossing: 'pw-region-frame',
  redo: 'pw-skip-forward',
};

export const TOOL_META: Record<string, { icon: IconId; verbKey: string }> = Object.fromEntries(
  Object.entries(TOOL_ICONS).map(([name, icon]) => [name, { icon, verbKey: TOOL_VERB_KEYS[name]! }]),
);

export function iconForTool(name: string): IconId {
  return TOOL_ICONS[name] ?? 'pw-inspect';
}

export const verbKeyForTool = toolVerbKey;
