/*
 * pages/build.ts — descriptors for this catalog group. See start.ts for the pattern.
 */
import type { HelpPage } from '../page-schema';

export const BUILD_PAGES: readonly HelpPage[] = [
  {
    id: 'terrain',
    group: 'build',
    titleKey: 'help.terrain.title',
    ledeKey: 'help.terrain.lede',
    entryKey: 'help.terrain.entry',
    figure: { kind: 'demo', scene: 'terrain' },
    sections: [
      {
        kind: 'prose', anchor: 'terrain-brush', titleKey: 'help.terrain.brush_t', bodyKeys: ['help.terrain.brush_b1', 'help.terrain.tools_b1'],
        figure: { kind: 'demo', scene: 'brushfree' },
      },
      {
        kind: 'prose', anchor: 'terrain-width', titleKey: 'help.terrain.width_t', bodyKeys: ['help.terrain.width_b1'],
        figure: { kind: 'demo', scene: 'brushwidth' },
      },
      {
        kind: 'prose', anchor: 'terrain-eraser', titleKey: 'help.terrain.eraser_t', bodyKeys: ['help.terrain.eraser_b1'],
        figure: { kind: 'demo', scene: 'eraseline' },
      },
      {
        kind: 'prose', anchor: 'terrain-line', titleKey: 'help.terrain.line_t', bodyKeys: ['help.terrain.line_b1'],
        figure: { kind: 'demo', scene: 'lineridge' },
      },
      {
        kind: 'prose', anchor: 'terrain-curve', titleKey: 'help.terrain.curve_t', bodyKeys: ['help.terrain.curve_b1'],
        figure: { kind: 'demo', scene: 'curvebank' },
      },
      {
        kind: 'prose', anchor: 'terrain-rect', titleKey: 'help.terrain.rect_t', bodyKeys: ['help.terrain.rect_b1'],
        figure: { kind: 'demo', scene: 'rectpad' },
      },
      {
        kind: 'prose', anchor: 'terrain-circle', titleKey: 'help.terrain.circle_t', bodyKeys: ['help.terrain.circle_b1'],
        figure: { kind: 'demo', scene: 'circlepond' },
      },
      { kind: 'keys', anchor: 'terrain-keys', titleKey: 'help.share.keys_t', rows: [
        { doKey: 'terrain.brush', tokens: [{ kind: 'cmd', id: 'tool.brush' }] },
        { doKey: 'design.eraser', tokens: [{ kind: 'cmd', id: 'tool.eraser' }] },
        { doKey: 'design.edge_cut', tokens: [{ kind: 'cmd', id: 'tool.edgecut' }] },
        { doKey: 'smart.build', tokens: [{ kind: 'cmd', id: 'tool.smart' }] },
        { doKey: 'terrain.shapes', tokens: [{ kind: 'cmd', id: 'tool.shape_cycle' }] },
        { doKey: 'edgecut.auto', tokens: [{ kind: 'cmd', id: 'tool.auto_trim' }] },
      ] },
      { kind: 'prose', anchor: 'terrain-mountain', titleKey: 'help.terrain.mountain_t', bodyKeys: ['help.terrain.mountain_b1'] },
      {
        kind: 'prose', anchor: 'terrain-water', titleKey: 'help.terrain.water_t', bodyKeys: ['help.terrain.water_b1'],
        figure: { kind: 'demo', scene: 'water' },
      },
      {
        kind: 'prose', anchor: 'terrain-autotrim', titleKey: 'help.terrain.autotrim_t', bodyKeys: ['help.terrain.autotrim_b1'],
        figure: { kind: 'demo', scene: 'autotrim' },
      },
      {
        kind: 'prose', anchor: 'terrain-autotrim-chip', titleKey: 'help.terrain.autotrim2_t', bodyKeys: ['help.terrain.autotrim2_b1'],
        figure: { kind: 'surface', surface: 'autotrim-modes', captionKey: 'help.terrain.autotrim_modes_figcap' },
      },
      {
        kind: 'prose', anchor: 'terrain-road', titleKey: 'help.terrain.road_t', bodyKeys: ['help.terrain.road_b1', 'help.terrain.road_b2'],
        figure: { kind: 'demo', scene: 'road' },
      },
    ],
    qa: [
      { qKey: 'help.terrain.q1', aKey: 'help.terrain.a1' },
      { qKey: 'help.terrain.q2', aKey: 'help.terrain.a2' },
      { qKey: 'help.terrain.q3', aKey: 'help.terrain.a3' },
      { qKey: 'help.terrain.q4', aKey: 'help.terrain.a4' },
      { qKey: 'help.terrain.q5', aKey: 'help.terrain.a5' },
    ],
    seeAlso: ['trim', 'smart', 'undo', 'shortcuts'],
  },
  {
    id: 'trim',
    group: 'build',
    titleKey: 'help.trim.title',
    ledeKey: 'help.trim.lede',
    entryKey: 'help.trim.entry',
    figure: { kind: 'demo', scene: 'trim' },
    sections: [
      { kind: 'prose', anchor: 'trim-click', titleKey: 'help.trim.click_t', bodyKeys: ['help.trim.click_b1'] },
      {
        kind: 'prose', anchor: 'trim-multi', titleKey: 'help.trim.multi_t', bodyKeys: ['help.trim.multi_b1'],
        figure: { kind: 'demo', scene: 'trimmulti' },
      },
      {
        kind: 'prose', anchor: 'trim-notch', titleKey: 'help.trim.notch_t', bodyKeys: ['help.trim.notch_b1'],
        figure: { kind: 'demo', scene: 'trimnotch' },
      },
      {
        kind: 'prose', anchor: 'trim-road', titleKey: 'help.trim.road_t', bodyKeys: ['help.trim.road_b1'],
        figure: { kind: 'demo', scene: 'roadtrim' },
      },
    ],
    qa: [
      { qKey: 'help.trim.q1', aKey: 'help.trim.a1' },
      { qKey: 'help.trim.q2', aKey: 'help.trim.a2' },
      { qKey: 'help.trim.q3', aKey: 'help.trim.a3' },
      { qKey: 'help.trim.q4', aKey: 'help.trim.a4' },
    ],
    seeAlso: ['terrain', 'undo', 'shortcuts'],
  },
  {
    id: 'objects',
    group: 'build',
    titleKey: 'help.objects.title',
    ledeKey: 'help.objects.lede',
    entryKey: 'help.objects.entry',
    figure: { kind: 'demo', scene: 'objects' },
    sections: [
      { kind: 'prose', anchor: 'objects-tabs', titleKey: 'help.objects.tabs_t', bodyKeys: ['help.objects.tabs_b1'], figure: { kind: 'surface', surface: 'object-shelf', captionKey: 'help.objects.shelf_figcap' } },
      { kind: 'prose', anchor: 'objects-pick', titleKey: 'help.select.pick_t', bodyKeys: ['help.select.pick_b1'] },
      {
        kind: 'prose', anchor: 'objects-place', titleKey: 'help.objects.place_t', bodyKeys: ['help.objects.place_b1', 'help.objects.place_b2'],
        figure: { kind: 'demo', scene: 'spacing' },
      },
      {
        kind: 'prose', anchor: 'objects-rotate', titleKey: 'help.objects.rotate_t', bodyKeys: ['help.objects.rotate_b1'],
        figure: { kind: 'demo', scene: 'rotate' },
      },
      { kind: 'prose', anchor: 'objects-bridge', titleKey: 'help.objects.bridge_t', bodyKeys: ['help.objects.bridge_b1', 'help.objects.bridge_b2'] },
      {
        kind: 'prose', anchor: 'objects-ramp', titleKey: 'help.objects.ramp_t', bodyKeys: ['help.objects.ramp_b1'],
        figure: { kind: 'demo', scene: 'ramp' },
      },
      {
        kind: 'prose', anchor: 'objects-planting', titleKey: 'help.objects.planting_t', bodyKeys: ['help.objects.planting_b1'],
        figure: { kind: 'demo', scene: 'smartpatch' },
      },
      { kind: 'callout', bodyKey: 'help.objects.co1' },
    ],
    qa: [
      { qKey: 'help.objects.q1', aKey: 'help.objects.a1' },
      { qKey: 'help.objects.q2', aKey: 'help.objects.a2' },
      { qKey: 'help.objects.q3', aKey: 'help.objects.a3' },
      { qKey: 'help.objects.q4', aKey: 'help.objects.a4' },
      { qKey: 'help.objects.q5', aKey: 'help.objects.a5' },
    ],
    seeAlso: ['search', 'select', 'smart', 'faq'],
  },
  {
    id: 'search',
    group: 'build',
    titleKey: 'help.search.title',
    ledeKey: 'help.search.lede',
    entryKey: 'help.search.entry',
    figure: { kind: 'surface', surface: 'search', captionKey: 'help.search.figcap' },
    sections: [
      { kind: 'prose', anchor: 'search-basic', titleKey: 'help.search.basic_t', bodyKeys: ['help.search.basic_b1'] },
      { kind: 'prose', anchor: 'search-typo', titleKey: 'help.search.typo_t', bodyKeys: ['help.search.typo_b1'] },
      { kind: 'prose', anchor: 'search-multiword', titleKey: 'help.search.multiword_t', bodyKeys: ['help.search.multiword_b1'] },
      { kind: 'prose', anchor: 'search-alias', titleKey: 'help.search.alias_t', bodyKeys: ['help.search.alias_b1'] },
      { kind: 'prose', anchor: 'search-miss', titleKey: 'help.search.miss_t', bodyKeys: ['help.search.miss_b1'] },
    ],
    qa: [
      { qKey: 'help.search.q1', aKey: 'help.search.a1' },
      { qKey: 'help.search.q2', aKey: 'help.search.a2' },
      { qKey: 'help.search.q3', aKey: 'help.search.a3' },
      { qKey: 'help.search.q4', aKey: 'help.search.a4' },
    ],
    seeAlso: ['objects', 'select', 'smart'],
  },
  {
    id: 'select',
    group: 'build',
    titleKey: 'help.select.title',
    ledeKey: 'help.select.lede',
    entryKey: 'help.select.entry',
    figure: { kind: 'demo', scene: 'select' },
    sections: [
      { kind: 'prose', anchor: 'select-click', titleKey: 'help.select.click_t', bodyKeys: ['help.select.click_b1'] },
      { kind: 'prose', anchor: 'select-pick', titleKey: 'help.select.pick_t', bodyKeys: ['help.select.pick_b1'] },
      { kind: 'prose', anchor: 'select-multi', titleKey: 'help.select.multi_t', bodyKeys: ['help.select.multi_b1'] },
      { kind: 'prose', anchor: 'select-group', titleKey: 'help.select.group_t', bodyKeys: ['help.select.group_b1', 'help.select.move3d_b1'] },
      {
        kind: 'prose', anchor: 'select-rotate', titleKey: 'help.select.rotate_t', bodyKeys: ['help.select.rotate_b1'],
        figure: { kind: 'demo', scene: 'grouprotate' },
      },
      {
        kind: 'prose', anchor: 'select-menu', titleKey: 'help.select.menu_t', bodyKeys: ['help.select.menu_b1'],
        figure: { kind: 'surface', surface: 'context-menu', captionKey: 'help.select.menu_figcap' },
      },
      {
        kind: 'prose', anchor: 'select-confirm', titleKey: 'help.select.confirm_t', bodyKeys: ['help.select.confirm_b1'],
        figure: { kind: 'surface', surface: 'delete-confirm', captionKey: 'help.select.confirm_figcap' },
      },
      {
        kind: 'prose', anchor: 'select-locked', titleKey: 'help.select.locked_t', bodyKeys: ['help.select.locked_b1'],
        figure: { kind: 'demo', scene: 'locked' },
      },
    ],
    qa: [
      { qKey: 'help.select.q1', aKey: 'help.select.a1' },
      { qKey: 'help.select.q2', aKey: 'help.select.a2' },
      { qKey: 'help.select.q3', aKey: 'help.select.a3' },
      { qKey: 'help.select.q4', aKey: 'help.select.a4' },
      { qKey: 'help.select.q5', aKey: 'help.select.a5' },
    ],
    seeAlso: ['objects', 'undo', 'shortcuts'],
  },
  {
    id: 'smart',
    group: 'build',
    titleKey: 'help.smart.title',
    ledeKey: 'help.smart.lede',
    entryKey: 'help.smart.entry',
    figure: {
      kind: 'demos',
      scenes: [
        { scene: 'smart1', labelKey: 'help.smart.fig1' },
        { scene: 'smart2', labelKey: 'help.smart.fig2' },
      ],
    },
    sections: [
      { kind: 'prose', anchor: 'smart-open', titleKey: 'help.smart.open_t', bodyKeys: ['help.smart.open_b1'] },
      { kind: 'prose', anchor: 'smart-raise', titleKey: 'help.smart.raise_t', bodyKeys: ['help.smart.raise_b1'] },
      {
        kind: 'prose', anchor: 'smart-stream', titleKey: 'help.smart.stream_t', bodyKeys: ['help.smart.stream_b1'],
        figure: { kind: 'demo', scene: 'stream' },
      },
      { kind: 'prose', anchor: 'smart-roads', titleKey: 'help.smart.roads_t', bodyKeys: ['help.smart.roads_b1'] },
      {
        kind: 'prose', anchor: 'smart-plant', titleKey: 'help.smart.plant_t', bodyKeys: ['help.smart.plant_b1'],
        figure: { kind: 'demo', scene: 'smartpatch' },
      },
      {
        kind: 'prose', anchor: 'smart-delight', titleKey: 'help.smart.delight_t', bodyKeys: ['help.smart.delight_b1'],
        figure: { kind: 'demo', scene: 'delight' },
      },
      { kind: 'callout', bodyKey: 'help.smart.co1' },
      { kind: 'callout', bodyKey: 'help.smart.co2' },
    ],
    qa: [
      { qKey: 'help.smart.q1', aKey: 'help.smart.a1' },
      { qKey: 'help.smart.q2', aKey: 'help.smart.a2' },
      { qKey: 'help.smart.q3', aKey: 'help.smart.a3' },
      { qKey: 'help.smart.q4', aKey: 'help.smart.a4' },
      { qKey: 'help.smart.q5', aKey: 'help.smart.a5' },
    ],
    seeAlso: ['terrain', 'objects', 'region', 'undo'],
  },
];
