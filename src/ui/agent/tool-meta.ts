/*
 * tool-meta.ts — the ONE table from a tool's wire name to the glyph and the present-participle
 * phrase the panel says it with. Read by the op row, by the helper lane's own line and by the past-
 * jobs strip (which marks each record with the glyph of the work it did), so it lives beside them
 * rather than inside any one of them — a second copy would let two surfaces name one tool two ways.
 *
 * THE KEYS ARE LITERAL STRINGS, never composed via a template: the i18n drift detector
 * (`__tests__/i18n/drift.test.ts`) reads any quoted key-shaped string in a source file as "used", so
 * a literal table needs no declared dynamic prefix the way a templated lookup would — and a caller
 * that wants a phrase asks `verbKeyForTool` rather than building `agent3.verb_${name}` itself.
 */
import type { IconId } from './icons';

/** Icon + the i18n key for its present-participle phrase, one per tool the registry exposes
 *  (`agent/tools/tools.ts`'s `TOOL_HANDLERS`). */
export const TOOL_META: Record<string, { icon: IconId; verbKey: string }> = {
  inspect_region: { icon: 'pw-inspect', verbKey: 'agent3.verb_inspect_region' },
  get_objects: { icon: 'pw-inspect', verbKey: 'agent3.verb_get_objects' },
  get_selection: { icon: 'pw-region-frame', verbKey: 'agent3.verb_get_selection' },
  get_catalog_item: { icon: 'pw-note', verbKey: 'agent3.verb_get_catalog_item' },
  view_map: { icon: 'pw-snapshot', verbKey: 'agent3.verb_view_map' },
  evaluate_map: { icon: 'pw-evaluate', verbKey: 'agent3.verb_evaluate_map' },
  update_plan: { icon: 'pw-plan', verbKey: 'agent3.verb_update_plan' },
  export_map: { icon: 'pw-export', verbKey: 'agent3.verb_export_map' },
  suggest_reply: { icon: 'pw-send', verbKey: 'agent3.verb_suggest_reply' },
  paint_terrain: { icon: 'pw-terrain-raise', verbKey: 'agent3.verb_paint_terrain' },
  erase_terrain: { icon: 'pw-eraser', verbKey: 'agent3.verb_erase_terrain' },
  place_object: { icon: 'pw-object-place', verbKey: 'agent3.verb_place_object' },
  remove_object: { icon: 'pw-object-remove', verbKey: 'agent3.verb_remove_object' },
  rotate_object: { icon: 'pw-rotate', verbKey: 'agent3.verb_rotate_object' },
  trim_corner: { icon: 'pw-trim-corner', verbKey: 'agent3.verb_trim_corner' },
  find_flat_areas: { icon: 'pw-search-sites', verbKey: 'agent3.verb_find_flat_areas' },
  find_speckle: { icon: 'pw-search-sites', verbKey: 'agent3.verb_find_speckle' },
  scatter_objects: { icon: 'pw-scatter', verbKey: 'agent3.verb_scatter_objects' },
  sculpt_terrace: { icon: 'pw-terrace-steps', verbKey: 'agent3.verb_sculpt_terrace' },
  sculpt_wall: { icon: 'pw-terrace-steps', verbKey: 'agent3.verb_sculpt_wall' },
  sink_pool: { icon: 'pw-river', verbKey: 'agent3.verb_sink_pool' },
  draw_figure: { icon: 'pw-river', verbKey: 'agent3.verb_draw_figure' },
  carve_river: { icon: 'pw-river', verbKey: 'agent3.verb_carve_river' },
  clear_area: { icon: 'pw-clear', verbKey: 'agent3.verb_clear_area' },
  find_bridge_sites: { icon: 'pw-bridge', verbKey: 'agent3.verb_find_bridge_sites' },
  find_ramp_sites: { icon: 'pw-ramp', verbKey: 'agent3.verb_find_ramp_sites' },
  build_road: { icon: 'pw-road', verbKey: 'agent3.verb_build_road' },
  list_skills: { icon: 'pw-skill', verbKey: 'agent3.verb_list_skills' },
  load_skill: { icon: 'pw-skill', verbKey: 'agent3.verb_load_skill' },
  delegate_task: { icon: 'pw-subagent', verbKey: 'agent3.verb_delegate_task' },
  undo: { icon: 'pw-undo-arrow', verbKey: 'agent3.verb_undo' },
  decorate_zone: { icon: 'pw-decorate', verbKey: 'agent3.verb_decorate_zone' },
  plant_forest: { icon: 'pw-forest', verbKey: 'agent3.verb_plant_forest' },
  build_road_network: { icon: 'pw-road', verbKey: 'agent3.verb_build_road_network' },
  frame_crossing: { icon: 'pw-region-frame', verbKey: 'agent3.verb_frame_crossing' },
  redo: { icon: 'pw-skip-forward', verbKey: 'agent3.verb_redo' },
};

/** A tool name the registry has not (yet) taught this table about a name. Should not happen in
 *  practice (the table is exhaustive over `TOOL_HANDLERS`), so the row still renders sensibly
 *  rather than throwing: the raw tool name stands in for the phrase, and the icon reads as a
 *  plain inspection. */
const FALLBACK_ICON: IconId = 'pw-inspect';

function metaFor(name: string): { icon: IconId; verbKey: string | null } {
  const found = TOOL_META[name];
  return found ? found : { icon: FALLBACK_ICON, verbKey: null };
}

/** The glyph a tool name draws, for the surfaces that want the icon without the row: `HistoryStrip`
 *  marks each past job with the glyph of the work it did. Exported so `TOOL_META` stays the one
 *  tool-to-icon table. */
export function iconForTool(name: string): IconId {
  return metaFor(name).icon;
}

/** The i18n key naming what a tool is DOING, or null for a name this table does not know (whose
 *  caller says the raw wire name instead — wrong-looking on purpose, rather than blank). */
export function verbKeyForTool(name: string): string | null {
  return metaFor(name).verbKey;
}
