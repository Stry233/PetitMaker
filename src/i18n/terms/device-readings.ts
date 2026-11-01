/*
 * Copy written for a mouse in the wide arrangement, read another way where that does not hold: a key
 * that names hovering, a mouse button or the wheel has a touch reading, and one that places a control
 * by the wide arrangement has an upright reading. Help, the tour and the shelf's brush bubble read
 * their keys through `readingKey`, so the reading follows the live input mode and layout shape.
 */
import type { InputMode } from '../../platform/device/input-mode';
import type { LayoutShape } from '../../platform/device/layout-shape';
import type { Translate, TextKey } from '../keys';

/** What a reader in touch mode reads instead. A touch reading takes the same params as its key. */
const TOUCH: Partial<Record<TextKey, TextKey>> = {
  'help.frame.a2': 'help.frame.a2_touch',
  'help.frame.rail_b2': 'help.frame.rail_b2_touch',
  'help.camera.entry': 'help.camera.entry_touch',
  'help.camera.drag_b1': 'help.camera.drag_b1_touch',
  'help.camera.drag_b2': 'help.camera.drag_b2_touch',
  'help.camera.wheel_t': 'help.camera.wheel_t_touch',
  'help.camera.wheel_b1': 'help.camera.wheel_b1_touch',
  'help.camera.wheel_b2': 'help.camera.wheel_b2_touch',
  'help.camera.touch_b1': 'help.camera.touch_b1_touch',
  'help.whats_this_tip': 'help.whats_this_tip_touch',
  'help.camera.a2': 'help.camera.a2_touch',
  'help.camera.a4': 'help.camera.a4_touch',
  'help.undo.a1': 'help.undo.a1_touch',
  'help.terrain.road_b1': 'help.terrain.road_b1_touch',
  'help.objects.tabs_b1': 'help.objects.tabs_b1_touch',
  'help.objects.rotate_b1': 'help.objects.rotate_b1_touch',
  'help.objects.a2': 'help.objects.a2_touch',
  'help.select.click_b1': 'help.select.click_b1_touch',
  'help.select.menu_t': 'help.select.menu_t_touch',
  'help.select.menu_b1': 'help.select.menu_b1_touch',
  'help.select.copy_b1': 'help.select.copy_b1_touch',
  'help.select.copy_b2': 'help.select.copy_b2_touch',
  'help.settings.figcap': 'help.settings.figcap_touch',
  'help.settings.scale_b1': 'help.settings.scale_b1_touch',
  'help.camera.view3d_b1': 'help.camera.view3d_b1_touch',
  'help.objects.place_b1': 'help.objects.place_b1_touch',
  'help.objects.lede': 'help.objects.lede_touch',
  'help.copy.entry': 'help.copy.entry_touch',
  'help.copy.drag_b1': 'help.copy.drag_b1_touch',
  'help.copy.q1': 'help.copy.q1_touch',
  'help.copy.a1': 'help.copy.a1_touch',
  'help.tour.reel_b1': 'help.tour.reel_b1_touch',
  'help.tour.walk_b1': 'help.tour.walk_b1_touch',
  'help.fig.welcome_1': 'help.fig.welcome_1_touch',
  'help.fig.camera_1': 'help.fig.camera_1_touch',
  'help.fig.undo_1': 'help.fig.undo_1_touch',
  'help.fig.smart1_1': 'help.fig.smart1_1_touch',
  'help.fig.camera_2': 'help.fig.camera_2_touch',
  'help.fig.camera_3': 'help.fig.camera_3_touch',
  'help.fig.notetext_1': 'help.fig.notetext_1_touch',
  'help.fig.notegrow_3': 'help.fig.notegrow_3_touch',
  'help.fig.noteselect_1': 'help.fig.noteselect_1_touch',
  'help.fig.noteselect_3': 'help.fig.noteselect_3_touch',
  'help.fig.rotate_1': 'help.fig.rotate_1_touch',
  'help.fig.rotate_2': 'help.fig.rotate_2_touch',
  'help.fig.select_1': 'help.fig.select_1_touch',
  'help.fig.select_ctrl': 'help.fig.select_ctrl_touch',
  'help.fig.terrain_2': 'help.fig.terrain_2_touch',
  'help.fig.curvebank_1': 'help.fig.curvebank_1_touch',
  'help.fig.curvebank_2': 'help.fig.curvebank_2_touch',
  'help.fig.trim_1': 'help.fig.trim_1_touch',
  'help.fig.trim_2': 'help.fig.trim_2_touch',
  'help.fig.trim_3': 'help.fig.trim_3_touch',
  'help.fig.roadtrim_1': 'help.fig.roadtrim_1_touch',
  'help.fig.roadtrim_2': 'help.fig.roadtrim_2_touch',
  'help.fig.trimmulti_1': 'help.fig.trimmulti_1_touch',
  'help.fig.trimmulti_2': 'help.fig.trimmulti_2_touch',
  'help.fig.trimmulti_3': 'help.fig.trimmulti_3_touch',
  'help.fig.trimnotch_2': 'help.fig.trimnotch_2_touch',
  'tour.move_body': 'tour.move_body_touch',
  'tour.shape_body': 'tour.shape_body_touch',
  'tour.objects_body': 'tour.objects_body_touch',
  'tour.view3d_body': 'tour.view3d_body_touch',
  'tour.recap_body': 'tour.recap_body_touch',
  'tour.show.move_pan': 'tour.show.move_pan_touch',
  'tour.show.move_zoom': 'tour.show.move_zoom_touch',
  'tour.show.move_fit': 'tour.show.move_fit_touch',
  'tour.show.mountain_open': 'tour.show.mountain_open_touch',
  'tour.show.mountain_paint': 'tour.show.mountain_paint_touch',
  'tour.show.mountain_erase': 'tour.show.mountain_erase_touch',
  'tour.show.mountain_layer': 'tour.show.mountain_layer_touch',
  'tour.show.mountain_higher': 'tour.show.mountain_higher_touch',
  'tour.show.objects_open': 'tour.show.objects_open_touch',
  'tour.show.objects_card': 'tour.show.objects_card_touch',
  'tour.show.objects_place': 'tour.show.objects_place_touch',
  'tour.show.view3d_switch': 'tour.show.view3d_switch_touch',
  'tour.show.view3d_turn': 'tour.show.view3d_turn_touch',
  'tour.show.view3d_zoom': 'tour.show.view3d_zoom_touch',
  'tour.show.view3d_move': 'tour.show.view3d_move_touch',
  'tour.show.view3d_flat': 'tour.show.view3d_flat_touch',
  'tour.show.generate_open': 'tour.show.generate_open_touch',
  'tour.show.generate_recipe': 'tour.show.generate_recipe_touch',
  'tour.show.share_open': 'tour.show.share_open_touch',
  'tour.reel.move.drag': 'tour.reel.move.drag_touch',
  'tour.reel.objects.plant': 'tour.reel.objects.plant_touch',
  'tour.reel.view3d.stand': 'tour.reel.view3d.stand_touch',
  'tour.reel.view3d.turn': 'tour.reel.view3d.turn_touch',
  'tour.reel.view3d.zoom': 'tour.reel.view3d.zoom_touch',
  'tour.reel.view3d.move': 'tour.reel.view3d.move_touch',
  'tour.reel.view3d.flat': 'tour.reel.view3d.flat_touch',
  'objects.brush_bubble': 'objects.brush_bubble_touch',
  'help.objects.brush_b2': 'help.objects.brush_b2_touch',
  'help.settings.feel_b1': 'help.settings.feel_b1_touch',
  'help.settings.keyboard_b1': 'help.settings.keyboard_b1_touch',
};

/** What a reader of the upright arrangement reads instead, where the modes stand in the bottom bar. */
const UPRIGHT: Partial<Record<TextKey, TextKey>> = {
  'help.welcome.start_b1': 'help.welcome.start_b1_upright',
  'help.welcome.entry': 'help.welcome.entry_upright',
  'help.frame.entry': 'help.frame.entry_upright',
  'help.frame.modes_b1': 'help.frame.modes_b1_upright',
  'help.frame.bar_b1': 'help.frame.bar_b1_upright',
  'help.terrain.entry': 'help.terrain.entry_upright',
  'help.objects.entry': 'help.objects.entry_upright',
  'help.generate.entry': 'help.generate.entry_upright',
  'help.frame.modes_b2': 'help.frame.modes_b2_upright',
  'help.frame.assistant_b1': 'help.frame.assistant_b1_upright',
  'help.agentintro.where_b1': 'help.agentintro.where_b1_upright',
  'help.objects.batch_b1': 'help.objects.batch_b1_upright',
};

/** The input mode and layout shape a reader sees the interface in. */
export interface Reading { inputMode: InputMode; shape: LayoutShape }

/** The key `key` is read as under `reading`; no key has both a touch and an upright reading. */
export function readingKey(key: TextKey, reading: Reading): TextKey {
  if (reading.inputMode === 'touch') {
    const touch = TOUCH[key];
    if (touch) return touch;
  }
  return (reading.shape === 'portrait' ? UPRIGHT[key] : undefined) ?? key;
}

/** `t`, reading every key as `reading` reads it. */
export function readingTranslator(t: Translate, reading: Reading): Translate {
  const read = ((key, params) => t(readingKey(key, reading), params as never)) as Translate;
  return Object.assign(read, { locale: t.locale });
}
