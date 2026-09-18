import type { HelpPage, HelpPageId } from './page-schema';

const omitted = new Set<HelpPageId>(['gen-letter', 'gen-picture', 'json', 'checklist', 'agent-intro', 'agent-setup', 'agent-run', 'agent-trail', 'agent-region', 'agent-trouble', 'agent-undo']);
export const liteHelpPage = (id: HelpPageId): boolean => !omitted.has(id);

const replacements: Record<string, string> = {
  'help.share.import_b1': 'lite.import_hint',
  'help.generate.lede': 'lite.help_generate',
  'help.generate.clear_b1': 'help.generate.a3',
  'help.generate.a4': 'help.generate.a3',
  'help.notes.manage_b1': 'help.frame.layers_b2',
  'help.sharelook.preview_b1': 'lite.help_export_preview',
  'help.planet.unsaved_b1': 'lite.save_hint',
  'help.welcome.start_b1': 'lite.edit_help',
  'help.welcome.promise_b1': 'help.welcome.a1',
  'help.welcome.island_b1': 'help.planet.choose_b1',
  'help.welcome.a2': 'lite.save_hint',
  'help.frame.topright_b1': 'lite.tour_menu',
  'help.tour.lede': 'lite.help_tour',
  'help.tour.moves_b1': 'lite.help_tour',
  'help.save.caution_b1': 'lite.save_hint',
  'help.save.co1': 'lite.save_hint',
  'help.save.a2': 'lite.save_hint',
  'help.share.lede': 'lite.save_hint',
  'help.share.preset_b1': 'lite.preset_share_desc',
  'help.share.size_b1': 'lite.help_export_size',
  'help.sharelook.header_b1': 'lite.help_export_header',
  'help.settings.map_b1': 'lite.help_settings_map',
  'help.settings.reset_b1': 'lite.help_reset',
  'help.settings.a3': 'lite.help_reset',
  'help.generate.kinds_b1': 'lite.help_generate',
  'help.generate.a1': 'lite.help_generate',
  'help.generate.a2': 'help.genisland.tall_b1',
  'help.genisland.recipe_b1': 'help.candidates.own_b1',
  'help.candidates.a2': 'lite.help_generate',
  'help.region.brushes_b1': 'lite.help_region',
  'help.region.done_b1': 'help.region.a3',
};
const excludedSections = new Set([
  'frame-assistant', 'share-tabs', 'share-note', 'share-stylize',
  'share-stylize-connect', 'share-stylize-directions', 'share-stylize-takes', 'share-stylize-mark',
  'shortcuts-presets', 'undo-agent',
]);
const excludedKeys = new Set(['help.stylize.co1', 'help.share.co1', 'help.region.co1', 'help.candidates.own_b2']);
const replace = (key: string) => replacements[key] ?? key;

export const LITE_HELP_SURFACE_IDS = ['frame-overview', 'frame-modes', 'frame-topright', 'frame-rail', 'frame-bar', 'tour', 'layers', 'notes-row', 'object-shelf', 'autotrim-modes', 'context-menu', 'delete-confirm', 'generate-shelf', 'generate-shelf-island', 'island-height', 'island-richness'] as const;
export type LiteHelpSurfaceId = typeof LITE_HELP_SURFACE_IDS[number];
const surfaces = new Set<string>(LITE_HELP_SURFACE_IDS);
const figure = (fig: HelpPage['figure']) => fig?.kind === 'surface' && !surfaces.has(fig.surface) ? undefined : fig;


/** Share the editor documentation while removing instructions for unavailable actions. */
export function liteHelpContent(page: HelpPage): HelpPage {
  return {
    ...page,
    ...(page.id === 'share' ? { titleKey: 'share.title', navKey: 'share.title' } : {}),
    ledeKey: replace(page.ledeKey),
    figure: page.id === 'welcome' ? { kind: 'surface', surface: 'frame-overview', captionKey: 'help.frame.figcap' } : page.id === 'generate' ? undefined : figure(page.figure),
    sections: page.sections.filter(section => section.kind !== 'steps' && (section.kind === 'callout'
      ? !excludedKeys.has(section.bodyKey)
      : !excludedSections.has(section.anchor))).map(section => {
      if (section.kind === 'callout') return { ...section, bodyKey: replace(section.bodyKey) };
      if (section.kind === 'prose') return { ...section, figure: figure(section.figure), bodyKeys: section.anchor === 'share-preset' ? ['lite.preset_share_desc', 'lite.preset_plain_desc'] : section.bodyKeys.filter(key => !excludedKeys.has(key)).map(replace) };
      if (section.kind === 'keys') return { ...section, rows: section.rows.filter(row => row.doKey !== 'help.share.key_json') };
      return section;
    }),
    qa: page.qa.filter(qa => !['help.settings.q2', 'help.share.q1', 'help.share.q2', 'help.share.q3', 'help.region.q4', 'help.notes.q3', 'help.shortcuts.q5'].includes(qa.qKey) && !qa.qKey.startsWith('help.stylize.')).map(qa => ({ ...qa, aKey: replace(qa.aKey) })),
  };
}
