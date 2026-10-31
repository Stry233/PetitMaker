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
};

/** What a reader of the upright arrangement reads instead, where the modes stand in the bottom bar. */
const UPRIGHT: Partial<Record<TextKey, TextKey>> = {
  'help.welcome.start_b1': 'help.welcome.start_b1_upright',
  'help.welcome.entry': 'help.welcome.entry_upright',
  'help.frame.entry': 'help.frame.entry_upright',
  'help.terrain.entry': 'help.terrain.entry_upright',
  'help.objects.entry': 'help.objects.entry_upright',
  'help.generate.entry': 'help.generate.entry_upright',
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
