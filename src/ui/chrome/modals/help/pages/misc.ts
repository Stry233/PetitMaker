/*
 * pages/misc.ts — the 其他 group: settings, keyboard shortcuts, FAQ.
 *
 * Descriptor data only: copy uses full i18n key literals, key tables name command ids and figures
 * name renderable help scenes or surfaces.
 */
import type { HelpPage } from '../page-schema';

export const MISC_PAGES: readonly HelpPage[] = [
  {
    id: 'settings',
    group: 'misc',
    titleKey: 'help.settings.title',
    ledeKey: 'help.settings.lede',
    figure: { kind: 'surface', surface: 'settings', captionKey: 'help.settings.figcap' },
    sections: [
      { kind: 'prose', anchor: 'settings-language', titleKey: 'help.settings.language_t', bodyKeys: ['help.settings.language_b1'] },
      { kind: 'prose', anchor: 'settings-map', titleKey: 'help.settings.map_t', bodyKeys: ['help.settings.map_b1'] },
      { kind: 'prose', anchor: 'settings-scale', titleKey: 'help.settings.scale_t', bodyKeys: ['help.settings.scale_b1'] },
      { kind: 'prose', anchor: 'settings-feel', titleKey: 'help.settings.feel_t', bodyKeys: ['help.settings.feel_b1'] },
      { kind: 'prose', anchor: 'settings-keyboard', titleKey: 'help.settings.keyboard_t', bodyKeys: ['help.settings.keyboard_b1'] },
      { kind: 'prose', anchor: 'settings-reset', titleKey: 'help.settings.reset_t', bodyKeys: ['help.settings.reset_b1'] },
    ],
    qa: [
      { qKey: 'help.settings.q1', aKey: 'help.settings.a1' },
      { qKey: 'help.settings.q2', aKey: 'help.settings.a2' },
      { qKey: 'help.settings.q3', aKey: 'help.settings.a3' },
      { qKey: 'help.settings.q4', aKey: 'help.settings.a4' },
      { qKey: 'help.settings.q5', aKey: 'help.settings.a5' },
    ],
    seeAlso: ['frame', 'shortcuts', 'tour'],
  },
  {
    id: 'shortcuts',
    group: 'misc',
    titleKey: 'help.shortcuts.title',
    ledeKey: 'help.shortcuts.lede',
    figure: { kind: 'surface', surface: 'keyboard', captionKey: 'help.shortcuts.figcap' },
    action: { kind: 'open-keyboard', labelKey: 'help.shortcuts.open_board' },
    sections: [
      { kind: 'prose', anchor: 'shortcuts-board', titleKey: 'help.shortcuts.board_t', bodyKeys: ['help.shortcuts.board_b1'] },
      { kind: 'prose', anchor: 'shortcuts-search', titleKey: 'help.shortcuts.search_t', bodyKeys: ['help.shortcuts.search_b1'] },
      { kind: 'prose', anchor: 'shortcuts-rebind', titleKey: 'help.shortcuts.rebind_t', bodyKeys: ['help.shortcuts.rebind_b1'] },
      { kind: 'prose', anchor: 'shortcuts-reserved', titleKey: 'help.shortcuts.reserved_t', bodyKeys: ['help.shortcuts.reserved_b1'] },
      { kind: 'prose', anchor: 'shortcuts-presets', titleKey: 'help.shortcuts.presets_t', bodyKeys: ['help.shortcuts.presets_b1'] },
    ],
    qa: [
      { qKey: 'help.shortcuts.q1', aKey: 'help.shortcuts.a1' },
      { qKey: 'help.shortcuts.q2', aKey: 'help.shortcuts.a2' },
      { qKey: 'help.shortcuts.q3', aKey: 'help.shortcuts.a3' },
      { qKey: 'help.shortcuts.q4', aKey: 'help.shortcuts.a4' },
      { qKey: 'help.shortcuts.q5', aKey: 'help.shortcuts.a5' },
    ],
    seeAlso: ['camera', 'terrain', 'settings'],
  },
  {
    id: 'faq',
    group: 'misc',
    titleKey: 'help.faq.title',
    ledeKey: 'help.faq.lede',
    figure: { kind: 'demo', scene: 'faq' },
    sections: [
      { kind: 'prose', anchor: 'faq-refuse', titleKey: 'help.faq.refuse_t', bodyKeys: ['help.faq.refuse_b1'] },
      { kind: 'prose', anchor: 'faq-mountain', titleKey: 'help.faq.mountain_t', bodyKeys: ['help.faq.mountain_b1'] },
      { kind: 'prose', anchor: 'faq-water', titleKey: 'help.faq.water_t', bodyKeys: ['help.faq.water_b1'] },
      { kind: 'prose', anchor: 'faq-span', titleKey: 'help.faq.span_t', bodyKeys: ['help.faq.span_b1'] },
      { kind: 'prose', anchor: 'faq-revert', titleKey: 'help.faq.revert_t', bodyKeys: ['help.faq.revert_b1'] },
      { kind: 'prose', anchor: 'faq-undo', titleKey: 'help.faq.undo_t', bodyKeys: ['help.faq.undo_b1'] },
      { kind: 'callout', bodyKey: 'help.faq.co1' },
    ],
    qa: [
      { qKey: 'help.faq.q1', aKey: 'help.faq.a1' },
      { qKey: 'help.faq.q2', aKey: 'help.faq.a2' },
      { qKey: 'help.faq.q3', aKey: 'help.faq.a3' },
      { qKey: 'help.faq.q4', aKey: 'help.faq.a4' },
      { qKey: 'help.faq.q5', aKey: 'help.faq.a5' },
    ],
    seeAlso: ['terrain', 'objects', 'undo'],
  },
];
