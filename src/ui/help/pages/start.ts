/*
 * The Getting started group: welcome, the frame, the camera, the tour.
 *
 * Descriptor data only: copy uses full i18n key literals, key tables name command ids and figures
 * name renderable help scenes or surfaces.
 */
import type { HelpPage } from '../page-schema';

export const START_PAGES: readonly HelpPage[] = [
  {
    id: 'welcome',
    group: 'start',
    lite: { figure: { kind: 'surface', surface: 'frame-overview', captionKey: 'help.frame.figcap' } },
    hero: true,
    titleKey: 'help.welcome.title',
    navKey: 'help.welcome.nav',
    ledeKey: 'help.welcome.lede',
    entryKey: 'help.welcome.entry',
    figure: { kind: 'reel', reel: 'welcome', fallback: { kind: 'demo', scene: 'welcome' } },
    sections: [
      { kind: 'prose', anchor: 'welcome-start', titleKey: 'help.welcome.start_t', bodyKeys: ['help.welcome.start_b1'], lite: { bodyKeys: ['lite.edit_help'] } },
      {
        kind: 'prose', anchor: 'welcome-promise', titleKey: 'help.welcome.promise_t', bodyKeys: ['help.welcome.promise_b1'],
        figure: { kind: 'surface', surface: 'checklist-full', captionKey: 'help.welcome.list_cap' }, lite: { bodyKeys: ['help.welcome.promise_lite'] },
      },
      {
        kind: 'prose', anchor: 'welcome-island', titleKey: 'help.welcome.island_t', bodyKeys: ['help.welcome.island_b1'],
        figure: { kind: 'surface', surface: 'arrival', captionKey: 'help.welcome.arrival_cap' },
      },
      { kind: 'prose', anchor: 'welcome-resume', titleKey: 'help.welcome.resume_t', bodyKeys: ['help.welcome.resume_b1'] },
      { kind: 'prose', anchor: 'welcome-help', titleKey: 'help.welcome.help_t', bodyKeys: ['help.welcome.help_b1'] },
      { kind: 'keys', anchor: 'welcome-help-keys', titleKey: 'help.share.keys_t', rows: [{ doKey: 'shortcut.whats_this', tokens: [{ kind: 'cmd', id: 'app.whats_this' }] }], afterKeys: ['help.whats_this_keys'] },
      { kind: 'callout', bodyKey: 'help.welcome.co1' },
    ],
    qa: [
      { qKey: 'help.welcome.q1', aKey: 'help.welcome.a1' },
      { qKey: 'help.welcome.q2', aKey: 'help.welcome.a2', lite: { aKey: 'lite.save_hint' } },
      { qKey: 'help.welcome.q3', aKey: 'help.welcome.a3' },
      { qKey: 'help.welcome.q4', aKey: 'help.welcome.a4' },
    ],
    seeAlso: ['frame', 'tour', 'camera', 'save', 'planet', 'checklist'],
  },
  {
    id: 'frame',
    group: 'start',
    titleKey: 'help.frame.title',
    ledeKey: 'help.frame.lede',
    entryKey: 'help.frame.entry',
    figure: { kind: 'surface', surface: 'frame-overview', captionKey: 'help.frame.figcap' },
    sections: [
      {
        kind: 'prose', anchor: 'frame-modes', titleKey: 'help.frame.modes_t', bodyKeys: ['help.frame.modes_b1', 'help.frame.modes_b2'],
        figure: { kind: 'surface', surface: 'frame-modes', captionKey: 'help.frame.modes_cap' },
      },
      {
        kind: 'prose', anchor: 'frame-assistant', titleKey: 'help.frame.assistant_t', bodyKeys: ['help.frame.assistant_b1'],
        figure: { kind: 'surface', surface: 'frame-agent', captionKey: 'help.frame.agent_cap' }, lite: false,
      },
      {
        kind: 'prose', anchor: 'frame-bar', titleKey: 'help.frame.bar_t', bodyKeys: ['help.frame.bar_b1'],
        figure: { kind: 'surface', surface: 'frame-bar', captionKey: 'help.frame.bar_cap' },
      },
      {
        kind: 'prose', anchor: 'frame-topright', titleKey: 'help.frame.topright_t', bodyKeys: ['help.frame.topright_b1'],
        figure: { kind: 'surface', surface: 'frame-topright', captionKey: 'help.frame.topright_cap' }, lite: { bodyKeys: ['lite.tour_menu'] },
      },
      {
        kind: 'prose', anchor: 'frame-rail', titleKey: 'help.frame.rail_t', bodyKeys: ['help.frame.rail_b1', 'help.frame.rail_b2'],
        figure: { kind: 'surface', surface: 'frame-rail', captionKey: 'help.frame.rail_cap' },
      },
      { kind: 'prose', anchor: 'frame-fold', titleKey: 'help.frame.fold_t', bodyKeys: ['help.frame.fold_b1'] },
      { kind: 'prose', anchor: 'frame-hideui', titleKey: 'help.frame.hideui_t', bodyKeys: ['help.frame.hideui_b1', 'help.frame.hideui_b2'] },
      {
        kind: 'prose', anchor: 'frame-layers', titleKey: 'help.frame.layers_t', bodyKeys: ['help.frame.layers_b1'],
        figure: { kind: 'surface', surface: 'layers', captionKey: 'help.frame.layers_cap' },
      },
    ],
    qa: [
      { qKey: 'help.frame.q1', aKey: 'help.frame.a1' },
      { qKey: 'help.frame.q2', aKey: 'help.frame.a2' },
      { qKey: 'help.frame.q3', aKey: 'help.frame.a3' },
      { qKey: 'help.frame.q5', aKey: 'help.frame.a5' },
    ],
    seeAlso: ['touch', 'camera', 'layers', 'settings', 'shortcuts'],
  },
  {
    id: 'camera',
    group: 'start',
    titleKey: 'help.camera.title',
    ledeKey: 'help.camera.lede',
    entryKey: 'help.camera.entry',
    figure: { kind: 'reel', reel: 'move', fallback: { kind: 'demo', scene: 'camera' } },
    sections: [
      { kind: 'prose', anchor: 'camera-drag', titleKey: 'help.camera.drag_t', bodyKeys: ['help.camera.drag_b1', 'help.camera.drag_b2'] },
      {
        kind: 'prose', anchor: 'camera-3d', titleKey: 'help.camera.view3d_t', bodyKeys: ['help.camera.view3d_b1'],
        figure: { kind: 'reel', reel: 'view3d' }, lite: false,
      },
      { kind: 'prose', anchor: 'camera-wheel', titleKey: 'help.camera.wheel_t', bodyKeys: ['help.camera.wheel_b1', 'help.camera.wheel_b2'] },
      {
        kind: 'keys',
        anchor: 'camera-keys',
        titleKey: 'help.camera.keys_t',
        rows: [
          { doKey: 'help.camera.k_pan', tokens: [{ kind: 'pan-keys' }] },
          { doKey: 'help.camera.k_creep', tokens: [{ kind: 'cmd', id: 'tool.constrain', held: true }] },
          { doKey: 'help.camera.k_space', tokens: [{ kind: 'cmd', id: 'camera.pan_drag', held: true }, { kind: 'sep', sep: 'plus' }, { kind: 'mouse', button: 'left', mark: 'drag' }] },
          { doKey: 'help.camera.k_fit', tokens: [{ kind: 'cmd', id: 'camera.fit' }] },
          { doKey: 'help.camera.k_view', tokens: [{ kind: 'cmd', id: 'view.toggle' }] },
        ],
        afterKeys: ['help.camera.keys_b1'],
      },
      { kind: 'prose', anchor: 'camera-buttons', titleKey: 'help.camera.buttons_t', bodyKeys: ['help.camera.buttons_b1', 'help.camera.buttons_b2', 'help.camera.support_b1'] },
    ],
    qa: [
      { qKey: 'help.camera.q1', aKey: 'help.camera.a1' },
      { qKey: 'help.camera.q2', aKey: 'help.camera.a2' },
      { qKey: 'help.camera.q4', aKey: 'help.camera.a4' },
    ],
    seeAlso: ['touch', 'frame', 'shortcuts', 'settings'],
  },
  {
    id: 'touch',
    group: 'start',
    titleKey: 'help.touch.title',
    navKey: 'help.touch.nav',
    ledeKey: 'help.touch.lede',
    entryKey: 'help.touch.entry',
    figure: { kind: 'surface', surface: 'frame-overview', captionKey: 'help.touch.figcap', form: { inputMode: 'touch', shape: 'portrait' } },
    sections: [
      { kind: 'prose', anchor: 'touch-switch', titleKey: 'help.touch.switch_t', bodyKeys: ['help.touch.switch_b1', 'help.touch.switch_b2'] },
      {
        kind: 'prose', anchor: 'touch-upright', titleKey: 'help.touch.upright_t', bodyKeys: ['help.touch.upright_b1', 'help.touch.upright_b2'],
        figure: { kind: 'surface', surface: 'frame-shelf', captionKey: 'help.touch.shelf_cap', form: { inputMode: 'touch', shape: 'portrait' } },
      },
      {
        kind: 'list', anchor: 'touch-gestures', titleKey: 'help.camera.gestures_t',
        items: [
          { key: 'help.camera.g_tap' }, { key: 'help.camera.g_double' }, { key: 'help.camera.g_hold' }, { key: 'help.camera.g_multi' },
          { key: 'help.camera.g_shelf' }, { key: 'help.camera.g_loupe' }, { key: 'help.camera.g_undo' },
        ],
      },
      {
        kind: 'prose', anchor: 'touch-move', titleKey: 'help.touch.move_t', bodyKeys: ['help.camera.touch_b1'],
        figure: { kind: 'reel', reel: 'move', fallback: { kind: 'demo', scene: 'camera' }, form: { inputMode: 'touch' } },
      },
      {
        kind: 'prose', anchor: 'touch-place', titleKey: 'help.touch.place_t', bodyKeys: ['help.touch.place_b1'],
        figure: { kind: 'reel', reel: 'objects', fallback: { kind: 'demo', scene: 'objects' }, form: { inputMode: 'touch' } },
      },
      {
        kind: 'prose', anchor: 'touch-menu', titleKey: 'help.select.menu_t_touch', bodyKeys: ['help.touch.menu_b1'],
        figure: { kind: 'surface', surface: 'context-menu', captionKey: 'help.touch.menu_cap', form: { inputMode: 'touch' } },
      },
    ],
    qa: [
      { qKey: 'help.touch.q1', aKey: 'help.touch.a1' },
      { qKey: 'help.touch.q2', aKey: 'help.touch.a2' },
    ],
    seeAlso: ['frame', 'camera', 'objects', 'select', 'settings'],
  },
  {
    id: 'tour',
    group: 'start',
    lite: { ledeKey: 'lite.help_tour' },
    titleKey: 'help.tour.title',
    ledeKey: 'help.tour.lede',
    entryKey: 'help.tour.entry',
    figure: { kind: 'surface', surface: 'tour', captionKey: 'help.tour.figcap' },
    action: { kind: 'replay-tour', labelKey: 'modal.settings_tour' },
    sections: [
      { kind: 'prose', anchor: 'tour-moves', titleKey: 'help.tour.moves_t', bodyKeys: ['help.tour.moves_b1', 'help.tour.moves_b2'], lite: false },
      { kind: 'prose', anchor: 'tour-once', titleKey: 'help.tour.once_t', bodyKeys: ['help.tour.once_b1', 'help.tour.once_b2'] },
      { kind: 'prose', anchor: 'tour-walk', titleKey: 'help.tour.walk_t', bodyKeys: ['help.tour.walk_b1'] },
      { kind: 'prose', anchor: 'tour-reel', titleKey: 'help.tour.reel_t', bodyKeys: ['help.tour.reel_b1'], lite: false },
      { kind: 'prose', anchor: 'tour-again', titleKey: 'help.tour.again_t', bodyKeys: ['help.tour.again_b1'] },
      { kind: 'prose', anchor: 'tour-during', titleKey: 'help.tour.during_t', bodyKeys: ['help.tour.during_b1'] },
    ],
    qa: [
      { qKey: 'help.tour.q2', aKey: 'help.tour.a2' },
    ],
    seeAlso: ['welcome', 'frame', 'settings'],
  },
];
