/**
 * Every tool's name, in the order providers are shown them. Light on purpose: the panel's labels,
 * icons and descriptions key off `ToolName` without loading a single tool, and `registry.ts` must
 * define exactly these names.
 */
import { PROTOCOL } from '../core/protocol';

export const TOOL_NAMES = [
  'get_annotations',
  'set_annotation',
  'remove_annotation',
  'inspect_region',
  'get_objects',
  'get_selection',
  'get_catalog_item',
  'view_map',
  'evaluate_map',
  PROTOCOL.plan,
  'list_app_actions',
  'run_app_action',
  PROTOCOL.reply,
  'paint_terrain',
  'erase_terrain',
  'place_object',
  'remove_object',
  'rotate_object',
  'trim_corner',
  'find_flat_areas',
  'scatter_objects',
  'sculpt_terrace',
  'sculpt_wall',
  'sink_pool',
  'raise_platform',
  'copy_area',
  'replace_objects',
  'mirror_area',
  'check_build',
  'carve_river',
  'clear_area',
  'find_speckle',
  'find_bridge_sites',
  'find_ramp_sites',
  'build_road',
  'lay_route',
  'draw_area',
  'list_skills',
  'load_skill',
  PROTOCOL.delegate,
  'undo',
  'redo',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

const NAMES: ReadonlySet<string> = new Set(TOOL_NAMES);

export const isToolName = (name: string): name is ToolName => NAMES.has(name);
