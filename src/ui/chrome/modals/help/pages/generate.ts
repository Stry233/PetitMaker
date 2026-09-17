/*
 * pages/generate.ts — the 生成 group, one page per kind the shelf itself offers: the overview of
 * the shared machinery, then Planet, Maze, Letter and Picture, then the two deep dives every kind
 * leans on (recipes and the region).
 *
 * Descriptor data only: copy uses full i18n key literals, key tables name command ids and figures
 * name renderable help scenes or surfaces.
 */
import type { HelpPage } from '../page-schema';
import { hasCustomCard } from '../../../../shell/bars/generate-shelf';

export const GENERATE_PAGES: readonly HelpPage[] = [
  {
    id: 'generate',
    group: 'generate',
    titleKey: 'help.generate.title',
    ledeKey: 'help.generate.lede',
    figure: { kind: 'surface', surface: 'generate-shelf', captionKey: 'help.generate.figcap' },
    sections: [
      { kind: 'prose', anchor: 'generate-kinds', titleKey: 'help.generate.kinds_t', bodyKeys: ['help.generate.kinds_b1'] },
      { kind: 'prose', anchor: 'generate-scope', titleKey: 'help.generate.scope_t', bodyKeys: ['help.generate.scope_b1'], figure: { kind: 'demo', scene: 'scope' } },
      { kind: 'prose', anchor: 'generate-batch', titleKey: 'help.generate.batch_t', bodyKeys: ['help.generate.batch_b1'] },
      { kind: 'prose', anchor: 'generate-clear', titleKey: 'help.generate.clear_t', bodyKeys: ['help.generate.clear_b1'] },
      { kind: 'prose', anchor: 'generate-empty', titleKey: 'help.generate.empty_t', bodyKeys: ['help.generate.empty_b1'] },
      { kind: 'callout', bodyKey: 'help.generate.co1' },
    ],
    qa: [
      { qKey: 'help.generate.q1', aKey: 'help.generate.a1' },
      { qKey: 'help.generate.q2', aKey: 'help.generate.a2' },
      { qKey: 'help.generate.q3', aKey: 'help.generate.a3' },
      { qKey: 'help.generate.q4', aKey: 'help.generate.a4' },
    ],
    seeAlso: ['gen-island', 'maze', 'gen-letter', 'gen-picture', 'candidates', 'region'],
  },
  {
    id: 'gen-island',
    group: 'generate',
    titleKey: 'help.genisland.title',
    navKey: 'help.genisland.nav',
    ledeKey: 'help.genisland.lede',
    figure: { kind: 'surface', surface: 'generate-shelf-island', captionKey: 'help.genisland.figcap' },
    sections: [
      { kind: 'prose', anchor: 'genisland-what', titleKey: 'help.genisland.what_t', bodyKeys: ['help.genisland.what_b1'], figure: { kind: 'demo', scene: 'generate' } },
      { kind: 'prose', anchor: 'genisland-rich', titleKey: 'help.genisland.rich_t', bodyKeys: ['help.genisland.rich_b1'], figure: { kind: 'surface', surface: 'island-richness', captionKey: 'help.genisland.rich_figcap' } },
      { kind: 'prose', anchor: 'genisland-tall', titleKey: 'help.genisland.tall_t', bodyKeys: ['help.genisland.tall_b1'], figure: { kind: 'surface', surface: 'island-height', captionKey: 'help.genisland.tall_figcap' } },
      { kind: 'prose', anchor: 'genisland-recipe', titleKey: 'help.genisland.recipe_t', bodyKeys: ['help.genisland.recipe_b1'] },
    ],
    qa: [
      { qKey: 'help.genisland.q1', aKey: 'help.genisland.a1' },
      { qKey: 'help.genisland.q2', aKey: 'help.genisland.a2' },
      { qKey: 'help.genisland.q3', aKey: 'help.genisland.a3' },
    ],
    seeAlso: ['generate', 'candidates', 'region'],
  },
  {
    id: 'maze',
    group: 'generate',
    titleKey: 'help.maze.title',
    ledeKey: 'help.maze.lede',
    figure: { kind: 'demo', scene: 'maze' },
    sections: [
      { kind: 'prose', anchor: 'maze-shape', titleKey: 'help.maze.shape_t', bodyKeys: ['help.maze.shape_b1'] },
      { kind: 'prose', anchor: 'maze-knobs', titleKey: 'help.maze.knobs_t', bodyKeys: ['help.maze.knobs_b1'], figure: { kind: 'demos', scenes: [{ scene: 'mazew1', labelKey: 'help.maze.fig1' }, { scene: 'mazew2', labelKey: 'help.maze.fig2' }] } },
      { kind: 'prose', anchor: 'maze-ends', titleKey: 'help.maze.ends_t', bodyKeys: ['help.maze.ends_b1'] },
      { kind: 'prose', anchor: 'maze-marks', titleKey: 'help.maze.marks_t', bodyKeys: ['help.maze.marks_b1'] },
      { kind: 'prose', anchor: 'maze-drag', titleKey: 'help.maze.drag_t', bodyKeys: ['help.maze.drag_b1'] },
      { kind: 'prose', anchor: 'maze-way', titleKey: 'help.maze.way_t', bodyKeys: ['help.maze.way_b1'] },
    ],
    qa: [
      { qKey: 'help.maze.q1', aKey: 'help.maze.a1' },
      { qKey: 'help.maze.q2', aKey: 'help.maze.a2' },
      { qKey: 'help.maze.q3', aKey: 'help.maze.a3' },
      { qKey: 'help.maze.q4', aKey: 'help.maze.a4' },
    ],
    seeAlso: ['generate', 'candidates', 'region'],
  },
  {
    id: 'gen-letter',
    group: 'generate',
    titleKey: 'help.genletter.title',
    navKey: 'help.genletter.nav',
    ledeKey: 'help.genletter.lede',
    figure: { kind: 'demo', scene: 'stencil' },
    sections: [
      { kind: 'prose', anchor: 'genletter-what', titleKey: 'help.genletter.what_t', bodyKeys: ['help.genletter.what_b1'] },
      { kind: 'prose', anchor: 'genletter-material', titleKey: 'help.genletter.material_t', bodyKeys: ['help.genletter.material_b1'], figure: { kind: 'surface', surface: 'letter-materials', captionKey: 'help.genletter.materials_figcap' } },
      { kind: 'prose', anchor: 'genletter-room', titleKey: 'help.genletter.room_t', bodyKeys: ['help.genletter.room_b1'] },
      { kind: 'prose', anchor: 'genletter-partial', titleKey: 'help.genletter.partial_t', bodyKeys: ['help.genletter.partial_b1'] },
    ],
    qa: [
      { qKey: 'help.genletter.q1', aKey: 'help.genletter.a1' },
      { qKey: 'help.genletter.q2', aKey: 'help.genletter.a2' },
      { qKey: 'help.genletter.q3', aKey: 'help.genletter.a3' },
    ],
    seeAlso: ['generate', 'gen-picture', 'region'],
  },
  {
    id: 'gen-picture',
    group: 'generate',
    titleKey: 'help.genpicture.title',
    navKey: 'help.genpicture.nav',
    ledeKey: 'help.genpicture.lede',
    figure: { kind: 'surface', surface: 'stencil-picture', captionKey: 'help.genpicture.figcap' },
    sections: [
      { kind: 'prose', anchor: 'genpicture-what', titleKey: 'help.genpicture.what_t', bodyKeys: ['help.genpicture.what_b1', ...(hasCustomCard('image') ? ['help.genpicture.what_b2'] : [])] },
      { kind: 'prose', anchor: 'genpicture-material', titleKey: 'help.genpicture.material_t', bodyKeys: ['help.genpicture.material_b1'], figure: { kind: 'surface', surface: 'picture-materials', captionKey: 'help.genpicture.materials_figcap' } },
      { kind: 'prose', anchor: 'genpicture-tune', titleKey: 'help.genpicture.tune_t', bodyKeys: ['help.genpicture.tune_b1'], figure: { kind: 'surface', surface: 'picture-tuning', captionKey: 'help.genpicture.tune_figcap' } },
      { kind: 'prose', anchor: 'genpicture-room', titleKey: 'help.genpicture.room_t', bodyKeys: ['help.genpicture.room_b1'] },
    ],
    qa: [
      ...(hasCustomCard('image') ? [{ qKey: 'help.genpicture.q1', aKey: 'help.genpicture.a1' }] : []),
      { qKey: 'help.genpicture.q2', aKey: 'help.genpicture.a2' },
      { qKey: 'help.genpicture.q3', aKey: 'help.genpicture.a3' },
    ],
    seeAlso: ['generate', 'gen-letter', 'region'],
  },
  {
    id: 'candidates',
    group: 'generate',
    titleKey: 'help.candidates.title',
    ledeKey: 'help.candidates.lede',
    figure: { kind: 'surface', surface: 'candidates', captionKey: 'help.candidates.figcap' },
    sections: [
      { kind: 'prose', anchor: 'candidates-real', titleKey: 'help.candidates.real_t', bodyKeys: ['help.candidates.real_b1'] },
      { kind: 'prose', anchor: 'candidates-click', titleKey: 'help.candidates.click_t', bodyKeys: ['help.candidates.click_b1'] },
      { kind: 'prose', anchor: 'candidates-own', titleKey: 'help.candidates.own_t', bodyKeys: ['help.candidates.own_b1', ...(hasCustomCard('text') ? ['help.candidates.own_b2'] : [])] },
      { kind: 'prose', anchor: 'candidates-stale', titleKey: 'help.candidates.stale_t', bodyKeys: ['help.candidates.stale_b1'] },
      { kind: 'prose', anchor: 'candidates-notes', titleKey: 'help.candidates.notes_t', bodyKeys: ['help.candidates.notes_b1'] },
    ],
    qa: [
      { qKey: 'help.candidates.q1', aKey: 'help.candidates.a1' },
      { qKey: 'help.candidates.q2', aKey: 'help.candidates.a2' },
      { qKey: 'help.candidates.q3', aKey: 'help.candidates.a3' },
      { qKey: 'help.candidates.q4', aKey: 'help.candidates.a4' },
    ],
    seeAlso: ['generate', 'region', 'undo'],
  },
  {
    id: 'region',
    group: 'generate',
    titleKey: 'help.region.title',
    ledeKey: 'help.region.lede',
    figure: { kind: 'demo', scene: 'region' },
    sections: [
      { kind: 'prose', anchor: 'region-open', titleKey: 'help.region.open_t', bodyKeys: ['help.region.open_b1'] },
      { kind: 'prose', anchor: 'region-brushes', titleKey: 'help.region.brushes_t', bodyKeys: ['help.region.brushes_b1'] },
      { kind: 'prose', anchor: 'region-ground', titleKey: 'help.region.ground_t', bodyKeys: ['help.region.ground_b1'], figure: { kind: 'demo', scene: 'ground' } },
      { kind: 'prose', anchor: 'region-move', titleKey: 'help.region.move_t', bodyKeys: ['help.region.move_b1'] },
      { kind: 'prose', anchor: 'region-undo', titleKey: 'help.region.undo_t', bodyKeys: ['help.region.undo_b1'] },
      { kind: 'prose', anchor: 'region-done', titleKey: 'help.region.done_t', bodyKeys: ['help.region.done_b1'] },
      { kind: 'callout', bodyKey: 'help.region.co1' },
    ],
    qa: [
      { qKey: 'help.region.q1', aKey: 'help.region.a1' },
      { qKey: 'help.region.q2', aKey: 'help.region.a2' },
      { qKey: 'help.region.q3', aKey: 'help.region.a3' },
      { qKey: 'help.region.q4', aKey: 'help.region.a4' },
      { qKey: 'help.region.q5', aKey: 'help.region.a5' },
    ],
    seeAlso: ['generate', 'agent-region', 'gen-letter'],
  },
];
