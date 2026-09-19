/*
 * pages/start.ts — the 上手 group: welcome, the frame, the camera, the tour.
 *
 * Descriptor data only: copy uses full i18n key literals, key tables name command ids and figures
 * name renderable help scenes or surfaces.
 */
import type { HelpPage } from '../page-schema';

export const START_PAGES: readonly HelpPage[] = [
  {
    id: 'welcome',
    group: 'start',
    hero: true,
    titleKey: 'help.welcome.title',
    navKey: 'help.welcome.nav',
    ledeKey: 'help.welcome.lede',
    entryKey: 'help.welcome.entry',
    figure: { kind: 'demo', scene: 'welcome' },
    sections: [
      { kind: 'prose', anchor: 'welcome-start', titleKey: 'help.welcome.start_t', bodyKeys: ['help.welcome.start_b1'] },
      {
        kind: 'prose', anchor: 'welcome-promise', titleKey: 'help.welcome.promise_t', bodyKeys: ['help.welcome.promise_b1'],
        figure: { kind: 'surface', surface: 'checklist-full', captionKey: 'help.welcome.list_cap' },
      },
      {
        kind: 'prose', anchor: 'welcome-island', titleKey: 'help.welcome.island_t', bodyKeys: ['help.welcome.island_b1'],
        figure: { kind: 'surface', surface: 'arrival', captionKey: 'help.welcome.arrival_cap' },
      },
      {
        kind: 'prose', anchor: 'welcome-resume', titleKey: 'help.welcome.resume_t', bodyKeys: ['help.welcome.resume_b1'],
        figure: { kind: 'surface', surface: 'save', captionKey: 'help.welcome.resume_cap' },
      },
      { kind: 'keys', anchor: 'welcome-help', titleKey: 'help.welcome.help_t', rows: [{ doKey: 'shortcut.whats_this', tokens: [{ kind: 'cmd', id: 'app.whats_this' }] }], afterKeys: ['help.whats_this_keys', 'help.welcome.help_b1'] },
      { kind: 'callout', bodyKey: 'help.welcome.co1' },
    ],
    qa: [
      { qKey: 'help.welcome.q1', aKey: 'help.welcome.a1' },
      { qKey: 'help.welcome.q2', aKey: 'help.welcome.a2' },
      { qKey: 'help.welcome.q3', aKey: 'help.welcome.a3' },
      { qKey: 'help.welcome.q4', aKey: 'help.welcome.a4' },
    ],
    seeAlso: ['frame', 'tour', 'camera', 'checklist'],
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
        figure: { kind: 'surface', surface: 'frame-agent', captionKey: 'help.frame.agent_cap' },
      },
      {
        kind: 'prose', anchor: 'frame-bar', titleKey: 'help.frame.bar_t', bodyKeys: ['help.frame.bar_b1'],
        figure: { kind: 'surface', surface: 'frame-bar', captionKey: 'help.frame.bar_cap' },
      },
      {
        kind: 'prose', anchor: 'frame-topright', titleKey: 'help.frame.topright_t', bodyKeys: ['help.frame.topright_b1'],
        figure: { kind: 'surface', surface: 'frame-topright', captionKey: 'help.frame.topright_cap' },
      },
      {
        kind: 'prose', anchor: 'frame-rail', titleKey: 'help.frame.rail_t', bodyKeys: ['help.frame.rail_b1', 'help.frame.rail_b2'],
        figure: { kind: 'surface', surface: 'frame-rail', captionKey: 'help.frame.rail_cap' },
      },
      { kind: 'prose', anchor: 'frame-hideui', titleKey: 'help.frame.hideui_t', bodyKeys: ['help.frame.hideui_b1', 'help.frame.hideui_b2'] },
      {
        kind: 'prose', anchor: 'frame-layers', titleKey: 'help.frame.layers_t', bodyKeys: ['help.frame.layers_b1', 'help.frame.layers_b2'],
        figure: { kind: 'surface', surface: 'layers', captionKey: 'help.frame.layers_cap' },
      },
    ],
    qa: [
      { qKey: 'help.frame.q1', aKey: 'help.frame.a1' },
      { qKey: 'help.frame.q2', aKey: 'help.frame.a2' },
      { qKey: 'help.frame.q3', aKey: 'help.frame.a3' },
      { qKey: 'help.frame.q4', aKey: 'help.frame.a4' },
      { qKey: 'help.frame.q5', aKey: 'help.frame.a5' },
    ],
    seeAlso: ['camera', 'layers', 'settings', 'shortcuts'],
  },
  {
    id: 'camera',
    group: 'start',
    titleKey: 'help.camera.title',
    ledeKey: 'help.camera.lede',
    entryKey: 'help.camera.entry',
    figure: { kind: 'demo', scene: 'camera' },
    sections: [
      {
        kind: 'prose', anchor: 'camera-drag', titleKey: 'help.camera.drag_t', bodyKeys: ['help.camera.drag_b1', 'help.camera.drag_b2'],
        figure: { kind: 'surface', surface: 'camera-3d', captionKey: 'help.camera.threed_figcap' },
      },
      { kind: 'prose', anchor: 'camera-wheel', titleKey: 'help.camera.wheel_t', bodyKeys: ['help.camera.wheel_b1', 'help.camera.wheel_b2', 'help.camera.touch_b1'] },
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
      {
        kind: 'prose', anchor: 'camera-buttons', titleKey: 'help.camera.buttons_t', bodyKeys: ['help.camera.buttons_b1', 'help.camera.buttons_b2', 'help.camera.support_b1'],
        figure: { kind: 'surface', surface: 'frame-rail', captionKey: 'help.camera.rail_cap' },
      },
    ],
    qa: [
      { qKey: 'help.camera.q1', aKey: 'help.camera.a1' },
      { qKey: 'help.camera.q2', aKey: 'help.camera.a2' },
      { qKey: 'help.camera.q3', aKey: 'help.camera.a3' },
      { qKey: 'help.camera.q4', aKey: 'help.camera.a4' },
      { qKey: 'help.camera.q5', aKey: 'help.camera.a5' },
    ],
    seeAlso: ['frame', 'shortcuts', 'settings'],
  },
  {
    id: 'tour',
    group: 'start',
    titleKey: 'help.tour.title',
    ledeKey: 'help.tour.lede',
    entryKey: 'help.tour.entry',
    figure: { kind: 'surface', surface: 'tour', captionKey: 'help.tour.figcap' },
    action: { kind: 'replay-tour', labelKey: 'modal.settings_tour' },
    sections: [
      { kind: 'prose', anchor: 'tour-moves', titleKey: 'help.tour.moves_t', bodyKeys: ['help.tour.moves_b1', 'help.tour.moves_b2'] },
      { kind: 'prose', anchor: 'tour-once', titleKey: 'help.tour.once_t', bodyKeys: ['help.tour.once_b1', 'help.tour.once_b2'] },
      { kind: 'prose', anchor: 'tour-walk', titleKey: 'help.tour.walk_t', bodyKeys: ['help.tour.walk_b1'] },
      { kind: 'prose', anchor: 'tour-again', titleKey: 'help.tour.again_t', bodyKeys: ['help.tour.again_b1'] },
      { kind: 'prose', anchor: 'tour-during', titleKey: 'help.tour.during_t', bodyKeys: ['help.tour.during_b1'] },
    ],
    qa: [
      { qKey: 'help.tour.q1', aKey: 'help.tour.a1' },
      { qKey: 'help.tour.q2', aKey: 'help.tour.a2' },
      { qKey: 'help.tour.q3', aKey: 'help.tour.a3' },
      { qKey: 'help.tour.q4', aKey: 'help.tour.a4' },
    ],
    seeAlso: ['welcome', 'frame', 'settings'],
  },
];
