/*
 * pages/plan.ts — the 规划 group: notes, layers, load, undo.
 *
 * Descriptor data only: copy uses full i18n key literals and figures name renderable help scenes or
 * surfaces.
 */
import type { HelpPage } from '../page-schema';

export const PLAN_PAGES: readonly HelpPage[] = [
  {
    id: 'notes',
    group: 'plan',
    titleKey: 'help.notes.title',
    ledeKey: 'help.notes.lede',
    figure: { kind: 'demo', scene: 'notes' },
    sections: [
      { kind: 'prose', anchor: 'notes-zone', titleKey: 'help.notes.zone_t', bodyKeys: ['help.notes.zone_b1'], figure: { kind: 'demo', scene: 'notezone' } },
      { kind: 'prose', anchor: 'notes-edit', titleKey: 'help.notes.edit_t', bodyKeys: ['help.notes.edit_b1'], figure: { kind: 'demo', scene: 'notegrow' } },
      { kind: 'prose', anchor: 'notes-chip', titleKey: 'help.notes.chip_t', bodyKeys: ['help.notes.chip_b1'], figure: { kind: 'demo', scene: 'notetext' } },
      { kind: 'prose', anchor: 'notes-route', titleKey: 'help.notes.route_t', bodyKeys: ['help.notes.route_b1'], figure: { kind: 'demo', scene: 'noteroute' } },
      { kind: 'prose', anchor: 'notes-select', titleKey: 'help.notes.select_t', bodyKeys: ['help.notes.select_b1'], figure: { kind: 'demo', scene: 'noteselect' } },
      { kind: 'prose', anchor: 'notes-manage', titleKey: 'help.notes.manage_t', bodyKeys: ['help.notes.manage_b1'], figure: { kind: 'surface', surface: 'notes-row', captionKey: 'help.notes.manage_figcap' } },
      { kind: 'callout', bodyKey: 'help.notes.co1' },
    ],
    qa: [
      { qKey: 'help.notes.q1', aKey: 'help.notes.a1' },
      { qKey: 'help.notes.q2', aKey: 'help.notes.a2' },
      { qKey: 'help.notes.q3', aKey: 'help.notes.a3' },
      { qKey: 'help.notes.q4', aKey: 'help.notes.a4' },
      { qKey: 'help.notes.q5', aKey: 'help.notes.a5' },
    ],
    seeAlso: ['layers', 'select', 'share', 'undo'],
  },
  {
    id: 'layers',
    group: 'plan',
    titleKey: 'help.layers.title',
    ledeKey: 'help.layers.lede',
    figure: { kind: 'surface', surface: 'layers', captionKey: 'help.layers.figcap' },
    sections: [
      { kind: 'prose', anchor: 'layers-floors', titleKey: 'help.layers.floors_t', bodyKeys: ['help.layers.floors_b1'] },
      { kind: 'prose', anchor: 'layers-sizes', titleKey: 'help.layers.sizes_t', bodyKeys: ['help.layers.sizes_b1'] },
      { kind: 'prose', anchor: 'layers-toggle', titleKey: 'help.layers.toggle_t', bodyKeys: ['help.layers.toggle_b1'] },
      { kind: 'prose', anchor: 'layers-annotrow', titleKey: 'help.layers.annotrow_t', bodyKeys: ['help.layers.annotrow_b1'] },
      { kind: 'prose', anchor: 'layers-numbers', titleKey: 'help.layers.numbers_t', bodyKeys: ['help.layers.numbers_b1'] },
    ],
    qa: [
      { qKey: 'help.layers.q1', aKey: 'help.layers.a1' },
      { qKey: 'help.layers.q2', aKey: 'help.layers.a2' },
      { qKey: 'help.layers.q3', aKey: 'help.layers.a3' },
      { qKey: 'help.layers.q4', aKey: 'help.layers.a4' },
    ],
    seeAlso: ['notes', 'load', 'frame'],
  },
  {
    id: 'load',
    group: 'plan',
    titleKey: 'help.load.title',
    ledeKey: 'help.load.lede',
    figure: { kind: 'demo', scene: 'load' },
    sections: [
      { kind: 'prose', anchor: 'load-disc', titleKey: 'help.load.disc_t', bodyKeys: ['help.load.disc_b1'] },
      { kind: 'prose', anchor: 'load-follow', titleKey: 'help.load.follow_t', bodyKeys: ['help.load.follow_b1'] },
      { kind: 'prose', anchor: 'load-window', titleKey: 'help.load.window_t', bodyKeys: ['help.load.window_b1'] },
      { kind: 'prose', anchor: 'load-limit', titleKey: 'help.load.limit_t', bodyKeys: ['help.load.limit_b1'] },
    ],
    qa: [
      { qKey: 'help.load.q1', aKey: 'help.load.a1' },
      { qKey: 'help.load.q2', aKey: 'help.load.a2' },
      { qKey: 'help.load.q3', aKey: 'help.load.a3' },
      { qKey: 'help.load.q4', aKey: 'help.load.a4' },
    ],
    seeAlso: ['layers', 'checklist', 'generate'],
  },
  {
    id: 'undo',
    group: 'plan',
    titleKey: 'help.undo.title',
    ledeKey: 'help.undo.lede',
    figure: { kind: 'demo', scene: 'undo' },
    sections: [
      { kind: 'prose', anchor: 'undo-step', titleKey: 'help.undo.step_t', bodyKeys: ['help.undo.step_b1'] },
      { kind: 'prose', anchor: 'undo-gone', titleKey: 'help.undo.gone_t', bodyKeys: ['help.undo.gone_b1'] },
      { kind: 'prose', anchor: 'undo-skip', titleKey: 'help.undo.skip_t', bodyKeys: ['help.undo.skip_b1'] },
      { kind: 'prose', anchor: 'undo-scope', titleKey: 'help.undo.scope_t', bodyKeys: ['help.undo.scope_b1'] },
      { kind: 'prose', anchor: 'undo-agent', titleKey: 'help.undo.agent_t', bodyKeys: ['help.undo.agent_b1'] },
    ],
    qa: [
      { qKey: 'help.undo.q1', aKey: 'help.undo.a1' },
      { qKey: 'help.undo.q2', aKey: 'help.undo.a2' },
      { qKey: 'help.undo.q3', aKey: 'help.undo.a3' },
      { qKey: 'help.undo.q4', aKey: 'help.undo.a4' },
    ],
    seeAlso: ['agent-undo', 'region', 'faq'],
  },
];
