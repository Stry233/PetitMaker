/*
 * The figure each Help page and section shows, by page id and section anchor. The pages' copy is
 * data below this layer (`editor/help/`); a figure names a scene or a surface drawn here.
 */
import type { HelpPageId } from '../../editor/help/page-schema';
import type { TextKey } from '../../i18n/keys';
import { forEdition, type EditionVariant } from '../../platform/build/edition';
import type { InputMode } from '../../platform/device/input-mode';
import type { LayoutShape } from '../../platform/device/layout-shape';
import type { TourKind } from '../chrome/tour/deck';
import { editionFigure } from './edition-help';

/** The input mode and shape a figure pictures where it is not the reader's own: a figure about touch
 *  mode or the upright layout. Absent, a figure pictures the reader's form. */
interface FigureForm { inputMode?: InputMode; shape?: LayoutShape }

/** A demo narrates itself (the animated caption inside the canvas), so only a surface figure
 *  carries a static caption — a second line under a demo said the same thing twice. */
export type HelpFigure = (
  | { kind: 'demo'; scene: string }
  /** The welcome tips' recording of `reel`, in the reader's locale and form, where it shows exactly
   *  what the section explains; `fallback` stands where no recording ships (the offline edition). */
  | { kind: 'reel'; reel: TourKind; fallback?: Exclude<HelpFigure, { kind: 'reel' }> }
  /** Several small demos side by side, each with its own label line. */
  | { kind: 'demos'; scenes: readonly { scene: string; labelKey: TextKey }[] }
  | { kind: 'surface'; surface: string; captionKey: TextKey }
) & { form?: FigureForm };

/** One page's figures: the one under its summary and those of its prose sections, by anchor. */
interface PageFigures {
  id: HelpPageId;
  figure?: HelpFigure;
  sections?: Readonly<Record<string, HelpFigure>>;
}

const WRITTEN: readonly (PageFigures & EditionVariant<PageFigures>)[] = [
  {
    id: 'welcome',
    figure: { kind: 'reel', reel: 'welcome', fallback: { kind: 'demo', scene: 'welcome' } },
    sections: {
      'welcome-promise': { kind: 'surface', surface: 'checklist-full', captionKey: 'help.welcome.list_cap' },
      'welcome-island': { kind: 'surface', surface: 'arrival', captionKey: 'help.welcome.arrival_cap' },
    },
    lite: { figure: { kind: 'surface', surface: 'frame-overview', captionKey: 'help.frame.figcap' } },
  },
  {
    id: 'frame',
    figure: { kind: 'surface', surface: 'frame-overview', captionKey: 'help.frame.figcap' },
    sections: {
      'frame-modes': { kind: 'surface', surface: 'frame-modes', captionKey: 'help.frame.modes_cap' },
      'frame-assistant': { kind: 'surface', surface: 'frame-agent', captionKey: 'help.frame.agent_cap' },
      'frame-bar': { kind: 'surface', surface: 'frame-bar', captionKey: 'help.frame.bar_cap' },
      'frame-topright': { kind: 'surface', surface: 'frame-topright', captionKey: 'help.frame.topright_cap' },
      'frame-rail': { kind: 'surface', surface: 'frame-rail', captionKey: 'help.frame.rail_cap' },
      'frame-layers': { kind: 'surface', surface: 'layers', captionKey: 'help.frame.layers_cap' },
    },
  },
  {
    id: 'camera',
    figure: { kind: 'reel', reel: 'move', fallback: { kind: 'demo', scene: 'camera' } },
    sections: {
      'camera-3d': { kind: 'reel', reel: 'view3d' },
    },
  },
  {
    id: 'touch',
    figure: { kind: 'surface', surface: 'frame-overview', captionKey: 'help.touch.figcap', form: { inputMode: 'touch', shape: 'portrait' } },
    sections: {
      'touch-upright': { kind: 'surface', surface: 'frame-shelf', captionKey: 'help.touch.shelf_cap', form: { inputMode: 'touch', shape: 'portrait' } },
      'touch-move': { kind: 'reel', reel: 'move', fallback: { kind: 'demo', scene: 'camera' }, form: { inputMode: 'touch' } },
      'touch-place': { kind: 'reel', reel: 'objects', fallback: { kind: 'demo', scene: 'objects' }, form: { inputMode: 'touch' } },
      'touch-menu': { kind: 'surface', surface: 'context-menu', captionKey: 'help.touch.menu_cap', form: { inputMode: 'touch' } },
    },
  },
  {
    id: 'tour',
    figure: { kind: 'surface', surface: 'tour', captionKey: 'help.tour.figcap' },
  },
  {
    id: 'terrain',
    figure: { kind: 'reel', reel: 'shape', fallback: { kind: 'demo', scene: 'terrain' } },
    sections: {
      'terrain-brush': { kind: 'demo', scene: 'brushfree' },
      'terrain-width': { kind: 'demo', scene: 'brushwidth' },
      'terrain-eraser': { kind: 'demo', scene: 'eraseline' },
      'terrain-line': { kind: 'demo', scene: 'lineridge' },
      'terrain-curve': { kind: 'demo', scene: 'curvebank' },
      'terrain-rect': { kind: 'demo', scene: 'rectpad' },
      'terrain-circle': { kind: 'demo', scene: 'circlepond' },
      'terrain-water': { kind: 'demo', scene: 'water' },
      'terrain-autotrim': { kind: 'demo', scene: 'autotrim' },
      'terrain-autotrim-chip': { kind: 'surface', surface: 'autotrim-modes', captionKey: 'help.terrain.autotrim_modes_figcap' },
      'terrain-road': { kind: 'demo', scene: 'road' },
    },
  },
  {
    id: 'trim',
    figure: { kind: 'demo', scene: 'trim' },
    sections: {
      'trim-multi': { kind: 'demo', scene: 'trimmulti' },
      'trim-notch': { kind: 'demo', scene: 'trimnotch' },
      'trim-road': { kind: 'demo', scene: 'roadtrim' },
    },
  },
  {
    id: 'objects',
    figure: { kind: 'reel', reel: 'objects', fallback: { kind: 'demo', scene: 'objects' } },
    sections: {
      'objects-tabs': { kind: 'surface', surface: 'object-shelf', captionKey: 'help.objects.shelf_figcap' },
      'objects-place': { kind: 'demo', scene: 'spacing' },
      'objects-limit': { kind: 'demo', scene: 'objlimit' },
      'objects-batch': { kind: 'demo', scene: 'objpaint' },
      'objects-brush': { kind: 'surface', surface: 'object-brush', captionKey: 'help.objects.brush_figcap' },
      'objects-mix': { kind: 'demo', scene: 'objmix' },
      'objects-rotate': { kind: 'demo', scene: 'rotate' },
      'objects-ramp': { kind: 'demo', scene: 'ramp' },
    },
  },
  {
    id: 'search',
    figure: { kind: 'surface', surface: 'search', captionKey: 'help.search.figcap' },
  },
  {
    id: 'select',
    figure: { kind: 'demo', scene: 'select' },
    sections: {
      'select-rotate': { kind: 'demo', scene: 'grouprotate' },
      'select-menu': { kind: 'surface', surface: 'context-menu', captionKey: 'help.select.menu_figcap' },
      'select-confirm': { kind: 'surface', surface: 'delete-confirm', captionKey: 'help.select.confirm_figcap' },
      'select-locked': { kind: 'demo', scene: 'locked' },
    },
  },
  {
    id: 'copy',
    figure: { kind: 'demo', scene: 'copypaste' },
    sections: {
      'copy-paste': { kind: 'demo', scene: 'pasteblock' },
      'copy-drag': { kind: 'demo', scene: 'copydrag' },
    },
  },
  {
    id: 'smart',
    figure: { kind: 'demos', scenes: [ { scene: 'smart1', labelKey: 'help.smart.fig1' }, { scene: 'smart2', labelKey: 'help.smart.fig2' }, ], },
    sections: {
      'smart-stream': { kind: 'demo', scene: 'stream' },
      'smart-plant': { kind: 'demo', scene: 'smartpatch' },
      'smart-delight': { kind: 'demo', scene: 'delight' },
    },
  },
  {
    id: 'blueprint',
    figure: { kind: 'demo', scene: 'bploop' },
    sections: {
      'blueprint-where': { kind: 'surface', surface: 'blueprint-strip', captionKey: 'help.blueprint.strip_figcap' },
    },
  },
  {
    id: 'blueprint-save',
    sections: {
      'bpsave-frame': { kind: 'demo', scene: 'bpframe' },
      'bpsave-selection': { kind: 'demo', scene: 'bpsavesel' },
      'bpsave-panel': { kind: 'surface', surface: 'blueprint-save', captionKey: 'help.bpsave.panel_figcap' },
      'bpsave-pictures': { kind: 'surface', surface: 'blueprint-save-pictures', captionKey: 'help.bpsave.pictures_figcap' },
    },
  },
  {
    id: 'blueprint-place',
    figure: { kind: 'demo', scene: 'bpplace' },
    sections: {
      'bpplace-pick': { kind: 'surface', surface: 'blueprint-strip', captionKey: 'help.blueprint.strip_figcap' },
      'bpplace-surface': { kind: 'demos', scenes: [ { scene: 'bpflat', labelKey: 'help.bpplace.fig_flat' }, { scene: 'bpraised', labelKey: 'help.bpplace.fig_raised' }, ], },
      'bpplace-skip': { kind: 'demo', scene: 'bpskip' },
      'bpplace-turn': { kind: 'demo', scene: 'bpturn', form: { inputMode: 'pc' } },
    },
  },
  {
    id: 'blueprint-groups',
    figure: { kind: 'demo', scene: 'bpwhole' },
    sections: {
      'bpgroups-narrow': { kind: 'demo', scene: 'bpnarrow' },
      'bpgroups-turn': { kind: 'demo', scene: 'bpgroupturn' },
      'bpgroups-copy': { kind: 'demos', scenes: [{ scene: 'bpcopywhole', labelKey: 'help.bpgroups.fig_whole' }, { scene: 'bpcopykind', labelKey: 'help.bpgroups.fig_kind' }] },
      'bpgroups-delete': { kind: 'demo', scene: 'bpdelete' },
    },
  },
  {
    id: 'blueprint-library',
    figure: { kind: 'surface', surface: 'blueprint-strip', captionKey: 'help.bplibrary.strip_figcap' },
    sections: {
      'bplibrary-explorer': { kind: 'surface', surface: 'blueprint-explorer', captionKey: 'help.bplibrary.explorer_figcap' },
      'bplibrary-list': { kind: 'surface', surface: 'blueprint-explorer-list', captionKey: 'help.bplibrary.list_figcap' },
      'bplibrary-menu': { kind: 'surface', surface: 'blueprint-menus', captionKey: 'help.bplibrary.menus_figcap' },
    },
  },
  {
    id: 'blueprint-files',
    figure: { kind: 'surface', surface: 'blueprint-export', captionKey: 'help.bpfiles.export_figcap' },
    sections: {
      'bpfiles-import': { kind: 'surface', surface: 'import', captionKey: 'help.bpfiles.import_figcap' },
    },
  },
  {
    id: 'generate',
    figure: { kind: 'surface', surface: 'generate-shelf', captionKey: 'help.generate.figcap' },
    sections: {
      'generate-kinds': { kind: 'reel', reel: 'generate' },
      'generate-scope': { kind: 'demo', scene: 'scope' },
    },
    lite: { figure: undefined },
  },
  {
    id: 'gen-island',
    figure: { kind: 'surface', surface: 'generate-shelf-island', captionKey: 'help.genplanet.figcap' },
    sections: {
      'genisland-what': { kind: 'demo', scene: 'generate' },
      'genisland-rich': { kind: 'surface', surface: 'island-richness', captionKey: 'help.genplanet.rich_figcap' },
      'genisland-tall': { kind: 'surface', surface: 'island-height', captionKey: 'help.genplanet.tall_figcap' },
    },
  },
  {
    id: 'maze',
    figure: { kind: 'demo', scene: 'maze' },
    sections: {
      'maze-knobs': { kind: 'demos', scenes: [{ scene: 'mazew1', labelKey: 'help.maze.fig1' }, { scene: 'mazew2', labelKey: 'help.maze.fig2' }] },
    },
  },
  {
    id: 'gen-letter',
    figure: { kind: 'demo', scene: 'stencil' },
    sections: {
      'genletter-material': { kind: 'surface', surface: 'letter-materials', captionKey: 'help.genletter.materials_figcap' },
    },
  },
  {
    id: 'gen-picture',
    figure: { kind: 'surface', surface: 'stencil-picture', captionKey: 'help.genpicture.figcap' },
    sections: {
      'genpicture-material': { kind: 'surface', surface: 'picture-materials', captionKey: 'help.genpicture.materials_figcap' },
      'genpicture-tune': { kind: 'surface', surface: 'picture-tuning', captionKey: 'help.genpicture.tune_figcap' },
    },
  },
  {
    id: 'candidates',
    figure: { kind: 'surface', surface: 'candidates', captionKey: 'help.candidates.figcap' },
  },
  {
    id: 'region',
    figure: { kind: 'demo', scene: 'region' },
    sections: {
      'region-brushes': { kind: 'surface', surface: 'region-bar', captionKey: 'help.region.bar_figcap' },
      'region-ground': { kind: 'demo', scene: 'ground' },
    },
  },
  {
    id: 'notes',
    figure: { kind: 'surface', surface: 'notes-entry', captionKey: 'help.notes.entry_tools' },
    sections: {
      'notes-zone': { kind: 'demo', scene: 'notezone' },
      'notes-edit': { kind: 'demo', scene: 'notegrow' },
      'notes-chip': { kind: 'demo', scene: 'notetext' },
      'notes-measure': { kind: 'demo', scene: 'measurement' },
      'notes-route': { kind: 'demo', scene: 'noteroute' },
      'notes-select': { kind: 'demo', scene: 'noteselect' },
      'notes-manage': { kind: 'surface', surface: 'notes-row', captionKey: 'help.notes.manage_figcap' },
    },
  },
  {
    id: 'layers',
    figure: { kind: 'surface', surface: 'layers', captionKey: 'help.layers.figcap' },
  },
  {
    id: 'load',
    figure: { kind: 'demo', scene: 'load' },
  },
  {
    id: 'undo',
    figure: { kind: 'demo', scene: 'undo' },
  },
  {
    id: 'save',
    figure: { kind: 'surface', surface: 'save', captionKey: 'help.save.figcap' },
  },
  {
    id: 'share',
    figure: { kind: 'surface', surface: 'share-window', captionKey: 'help.share.window_figcap' },
    sections: {
      'share-tabs': { kind: 'reel', reel: 'share' },
      'share-preset': { kind: 'surface', surface: 'export-controls', captionKey: 'help.share.controls_figcap' },
      'share-header': { kind: 'surface', surface: 'pic-header', captionKey: 'help.sharelook.header_figcap' },
      'share-layers': { kind: 'surface', surface: 'pic-layers', captionKey: 'help.sharelook.layers_figcap' },
      'share-shots': { kind: 'surface', surface: 'pic-shots', captionKey: 'help.sharelook.shots_figcap' },
      'share-notesgrid': { kind: 'surface', surface: 'export-controls-open', captionKey: 'help.sharelook.notes_figcap' },
      'share-footer': { kind: 'surface', surface: 'footer-editor', captionKey: 'help.sharelook.footer_figcap' },
      'share-glyph': { kind: 'surface', surface: 'pic-code', captionKey: 'help.share.glyph_figcap' },
      'share-import': { kind: 'surface', surface: 'import', captionKey: 'help.share.import_figcap' },
      'share-brand': { kind: 'surface', surface: 'pic-brand', captionKey: 'help.share.brand_figcap' },
      'share-preview': { kind: 'surface', surface: 'share', captionKey: 'help.sharelook.figcap' },
      'share-stylize': { kind: 'surface', surface: 'stylize-window', captionKey: 'help.stylize.figcap' },
      'share-stylize-directions': { kind: 'surface', surface: 'stylize-directions', captionKey: 'help.stylize.booklet_figcap' },
    },
  },
  {
    id: 'json',
    figure: { kind: 'surface', surface: 'json', captionKey: 'help.json.figcap' },
  },
  {
    id: 'checklist',
    figure: { kind: 'surface', surface: 'checklist', captionKey: 'help.checklist.figcap' },
  },
  {
    id: 'planet',
    figure: { kind: 'surface', surface: 'planet', captionKey: 'help.planet.figcap' },
  },
  {
    id: 'agent-intro',
    figure: { kind: 'surface', surface: 'agent-dream', captionKey: 'help.agentintro.figcap' },
  },
  {
    id: 'agent-setup',
    figure: { kind: 'surface', surface: 'agent-setup', captionKey: 'help.agentsetup.figcap' },
    sections: {
      'agsetup-paste': { kind: 'surface', surface: 'agent-setup-detect', captionKey: 'help.agentsetup.detect_figcap' },
    },
  },
  {
    id: 'agent-run',
    figure: { kind: 'surface', surface: 'agent-plan', captionKey: 'help.agentrun.figcap' },
    sections: {
      'agrun-oversight': { kind: 'surface', surface: 'agent-oversight', captionKey: 'help.agentrun.oversight_figcap' },
      'agrun-mapplan': { kind: 'reel', reel: 'assistant' },
      'agrun-steer': { kind: 'surface', surface: 'agent-steer', captionKey: 'help.agentrun.steer_figcap' },
    },
  },
  {
    id: 'agent-trail',
    figure: { kind: 'surface', surface: 'agent-trail', captionKey: 'help.agenttrail.figcap' },
  },
  {
    id: 'agent-region',
    figure: { kind: 'surface', surface: 'agent-region', captionKey: 'help.agentregion.figcap' },
  },
  {
    id: 'agent-trouble',
    figure: { kind: 'surface', surface: 'agent-trouble', captionKey: 'help.agenttrouble.figcap' },
    sections: {
      'agtrouble-banners': { kind: 'surface', surface: 'agent-banner', captionKey: 'help.agenttrouble.banner_figcap' },
    },
  },
  {
    id: 'agent-undo',
    figure: { kind: 'surface', surface: 'agent-undo', captionKey: 'help.agentundo.figcap' },
  },
  {
    id: 'settings',
    figure: { kind: 'surface', surface: 'settings', captionKey: 'help.settings.figcap' },
  },
  {
    id: 'shortcuts',
    figure: { kind: 'surface', surface: 'keyboard', captionKey: 'help.shortcuts.figcap' },
  },
  {
    id: 'faq',
    figure: { kind: 'demo', scene: 'faq' },
  },
];

/** A page's figures as this edition shows them. */
function editionFigures(page: PageFigures): PageFigures {
  return {
    ...page,
    figure: editionFigure(page.figure),
    sections: Object.fromEntries(Object.entries(page.sections ?? {}).flatMap(([anchor, figure]) => {
      const shown = editionFigure(figure);
      return shown ? [[anchor, shown]] : [];
    })),
  };
}

export const HELP_FIGURES: Readonly<Partial<Record<HelpPageId, PageFigures>>> = Object.fromEntries(
  forEdition<PageFigures>(WRITTEN).map((page) => [page.id, editionFigures(page)]),
);

/** The figure under the page's summary. */
export const pageFigure = (page: HelpPageId): HelpFigure | undefined => HELP_FIGURES[page]?.figure;

/** The figure of the prose section at `anchor`. */
export const sectionFigure = (page: HelpPageId, anchor: string): HelpFigure | undefined => HELP_FIGURES[page]?.sections?.[anchor];
