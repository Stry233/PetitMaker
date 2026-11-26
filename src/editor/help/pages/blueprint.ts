/*
 * The Blueprints group: the overview, saving and placing a blueprint, a placed blueprint, the
 * library and blueprint files.
 *
 * Descriptor data only: copy uses full i18n key literals and key tables name command ids.
 */
import type { HelpPage } from '../page-schema';

export const BLUEPRINT_PAGES: readonly HelpPage[] = [
  {
    id: 'blueprint',
    group: 'blueprint',
    titleKey: 'help.blueprint.title',
    navKey: 'help.blueprint.nav',
    ledeKey: 'help.blueprint.lede',
    entryKey: 'help.blueprint.entry',
    sections: [
      { kind: 'prose', anchor: 'blueprint-what', titleKey: 'help.blueprint.what_t', bodyKeys: ['help.blueprint.what_b1'] },
      { kind: 'prose', anchor: 'blueprint-where', titleKey: 'help.blueprint.where_t', bodyKeys: ['help.blueprint.where_b1'] },
    ],
    qa: [
      { qKey: 'help.blueprint.q1', aKey: 'help.blueprint.a1' },
    ],
    seeAlso: ['blueprint-save', 'blueprint-place', 'blueprint-groups', 'blueprint-library', 'blueprint-files', 'copy'],
  },
  {
    id: 'blueprint-save',
    group: 'blueprint',
    titleKey: 'help.bpsave.title',
    navKey: 'help.bpsave.nav',
    ledeKey: 'help.bpsave.lede',
    entryKey: 'help.bpsave.entry',
    sections: [
      { kind: 'prose', anchor: 'bpsave-frame', titleKey: 'help.bpsave.frame_t', bodyKeys: ['help.bpsave.frame_b1'] },
      { kind: 'prose', anchor: 'bpsave-selection', titleKey: 'help.bpsave.selection_t', bodyKeys: ['help.bpsave.selection_b1'] },
      { kind: 'prose', anchor: 'bpsave-panel', titleKey: 'help.bpsave.panel_t', bodyKeys: ['help.bpsave.panel_b1'] },
      { kind: 'prose', anchor: 'bpsave-pictures', titleKey: 'help.bpsave.pictures_t', bodyKeys: ['help.bpsave.pictures_b1'] },
    ],
    qa: [
      { qKey: 'help.bpsave.q1', aKey: 'help.bpsave.a1' },
      { qKey: 'help.bpsave.q2', aKey: 'help.bpsave.a2' },
    ],
    seeAlso: ['blueprint', 'blueprint-place', 'blueprint-library', 'select'],
  },
  {
    id: 'blueprint-place',
    group: 'blueprint',
    titleKey: 'help.bpplace.title',
    navKey: 'help.bpplace.nav',
    ledeKey: 'help.bpplace.lede',
    entryKey: 'help.bpplace.entry',
    sections: [
      { kind: 'prose', anchor: 'bpplace-pick', titleKey: 'help.bpplace.pick_t', bodyKeys: ['help.bpplace.pick_b1'] },
      { kind: 'prose', anchor: 'bpplace-surface', titleKey: 'help.bpplace.surface_t', bodyKeys: ['help.bpplace.surface_b1'] },
      { kind: 'prose', anchor: 'bpplace-skip', titleKey: 'help.bpplace.skip_t', bodyKeys: ['help.bpplace.skip_b1'] },
      { kind: 'prose', anchor: 'bpplace-turn', titleKey: 'help.bpplace.turn_t', bodyKeys: ['help.bpplace.turn_b1'] },
      { kind: 'keys', anchor: 'bpplace-keys', titleKey: 'help.share.keys_t', rows: [
        { doKey: 'shortcut.rotate_cw', tokens: [{ kind: 'cmd', id: 'selection.rotate_cw' }] },
        { doKey: 'shortcut.rotate_ccw', tokens: [{ kind: 'cmd', id: 'selection.rotate_ccw' }] },
        { doKey: 'shortcut.flip', tokens: [{ kind: 'cmd', id: 'selection.flip' }] },
      ] },
    ],
    qa: [
      { qKey: 'help.bpplace.q1', aKey: 'help.bpplace.a1' },
      { qKey: 'help.bpplace.q2', aKey: 'help.bpplace.a2' },
    ],
    seeAlso: ['blueprint', 'blueprint-save', 'blueprint-groups', 'blueprint-library', 'layers', 'undo'],
  },
  {
    id: 'blueprint-groups',
    group: 'blueprint',
    titleKey: 'help.bpgroups.title',
    ledeKey: 'help.bpgroups.lede',
    entryKey: 'help.bpgroups.entry',
    sections: [
      { kind: 'prose', anchor: 'bpgroups-whole', titleKey: 'help.bpgroups.whole_t', bodyKeys: ['help.bpgroups.whole_b1'] },
      { kind: 'prose', anchor: 'bpgroups-narrow', titleKey: 'help.bpgroups.narrow_t', bodyKeys: ['help.bpgroups.narrow_b1'] },
      { kind: 'prose', anchor: 'bpgroups-turn', titleKey: 'help.bpgroups.turn_t', bodyKeys: ['help.bpgroups.turn_b1'] },
      { kind: 'prose', anchor: 'bpgroups-copy', titleKey: 'help.bpgroups.copy_t', bodyKeys: ['help.bpgroups.copy_b1'] },
      { kind: 'prose', anchor: 'bpgroups-delete', titleKey: 'help.bpgroups.delete_t', bodyKeys: ['help.bpgroups.delete_b1'] },
      { kind: 'prose', anchor: 'bpgroups-leave', titleKey: 'help.bpgroups.leave_t', bodyKeys: ['help.bpgroups.leave_b1'] },
      { kind: 'keys', anchor: 'bpgroups-keys', titleKey: 'help.share.keys_t', rows: [
        { doKey: 'shortcut.rotate_cw', tokens: [{ kind: 'cmd', id: 'selection.rotate_cw' }] },
        { doKey: 'shortcut.flip', tokens: [{ kind: 'cmd', id: 'selection.flip' }] },
        { doKey: 'shortcut.delete', tokens: [{ kind: 'cmd', id: 'selection.delete' }] },
        { doKey: 'shortcut.copy', tokens: [{ kind: 'cmd', id: 'selection.copy' }] },
        { doKey: 'shortcut.paste', tokens: [{ kind: 'cmd', id: 'selection.paste' }] },
      ] },
    ],
    qa: [
      { qKey: 'help.bpgroups.q1', aKey: 'help.bpgroups.a1' },
      { qKey: 'help.bpgroups.q2', aKey: 'help.bpgroups.a2' },
    ],
    seeAlso: ['blueprint', 'blueprint-place', 'blueprint-library', 'select', 'copy'],
  },
  {
    id: 'blueprint-library',
    group: 'blueprint',
    titleKey: 'help.bplibrary.title',
    ledeKey: 'help.bplibrary.lede',
    entryKey: 'help.bplibrary.entry',
    sections: [
      { kind: 'prose', anchor: 'bplibrary-strip', titleKey: 'help.bplibrary.strip_t', bodyKeys: ['help.bplibrary.strip_b1'] },
      { kind: 'prose', anchor: 'bplibrary-explorer', titleKey: 'help.bplibrary.explorer_t', bodyKeys: ['help.bplibrary.explorer_b1'] },
      { kind: 'prose', anchor: 'bplibrary-list', titleKey: 'help.bplibrary.list_t', bodyKeys: ['help.bplibrary.list_b1'] },
      { kind: 'prose', anchor: 'bplibrary-folders', titleKey: 'help.bplibrary.folders_t', bodyKeys: ['help.bplibrary.folders_b1'] },
      { kind: 'prose', anchor: 'bplibrary-drag', titleKey: 'help.bplibrary.drag_t', bodyKeys: ['help.bplibrary.drag_b1'] },
      { kind: 'prose', anchor: 'bplibrary-menu', titleKey: 'help.bplibrary.menu_t', bodyKeys: ['help.bplibrary.menu_b1'] },
    ],
    qa: [
      { qKey: 'help.bplibrary.q1', aKey: 'help.bplibrary.a1', lite: { aKey: 'help.bplibrary.a1_lite' } },
      { qKey: 'help.bplibrary.q2', aKey: 'help.bplibrary.a2' },
    ],
    seeAlso: ['blueprint', 'blueprint-save', 'blueprint-place', 'blueprint-groups', 'blueprint-files'],
  },
  {
    id: 'blueprint-files',
    lite: false,
    group: 'blueprint',
    titleKey: 'help.bpfiles.title',
    ledeKey: 'help.bpfiles.lede',
    entryKey: 'help.bpfiles.entry',
    sections: [
      { kind: 'prose', anchor: 'bpfiles-export', titleKey: 'help.bpfiles.export_t', bodyKeys: ['help.bpfiles.export_b1'] },
      { kind: 'prose', anchor: 'bpfiles-import', titleKey: 'help.bpfiles.import_t', bodyKeys: ['help.bpfiles.import_b1'] },
      { kind: 'prose', anchor: 'bpfiles-folders', titleKey: 'help.bpfiles.folders_t', bodyKeys: ['help.bpfiles.folders_b1'] },
      { kind: 'prose', anchor: 'bpfiles-review', titleKey: 'help.bpfiles.review_t', bodyKeys: ['help.bpfiles.review_b1'] },
    ],
    qa: [
      { qKey: 'help.bpfiles.q1', aKey: 'help.bpfiles.a1' },
      { qKey: 'help.bpfiles.q2', aKey: 'help.bpfiles.a2' },
    ],
    seeAlso: ['blueprint', 'blueprint-library', 'json', 'share'],
  },
];
