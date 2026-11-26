// @vitest-environment jsdom
/**
 * The welcome tips' Blueprint card: where it stands among the cards, how each step of its Show me
 * knows the visitor has done what it says, and what the Show me's end gives back, through the deck,
 * the watch a step reads and the editor's own Blueprint verbs on an in-memory library.
 */
import { afterEach, expect, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { spec } from '../../_support/spec';
import { I18nProvider, translateFor } from '../../../i18n/context';
import { InputModeProvider } from '../../../ui/design/input-mode';
import { __resetGlProbe } from '../../../platform/device/device-quality';
import { useEditorStore } from '../../../state/store';
import { explorerUnfolded } from '../../../state/slices/blueprint';
import { tourCards } from '../../../ui/chrome/tour/deck';
import { TOUR_VERSION } from '../../../state/tour-version';
import { Tour } from '../../../ui/chrome/tour/Tour';
import { offerTourAtStart, startTour } from '../../../editor/session/tour';
import { readTourWatch, type TourWatch } from '../../../ui/session/tour-watch';
import { mapFingerprint } from '../../../core/model/fingerprint';
import { terrainCellsUnder } from '../../../core/grid/footprint';
import {
  armBlueprint, beginBlueprintFrame, confirmBlueprintFrame, moveSelectedGroup, placeArmedAt, saveBlueprint, saveFramedBlueprint,
  turnSelectedGroup, unfoldBlueprintLibrary,
} from '../../../editor/editing/blueprint';
import { TOUR_SEEN_KEY } from '../../_support/tour';
import { blueprintEditor, open, scene, shift, type Scene } from '../blueprints/_blueprints';

vi.mock('../../../pipelines/moderation/text/reviewer', async (original) => ({
  ...(await original<typeof import('../../../pipelines/moderation/text/reviewer')>()),
  reviewText: vi.fn(async () => ({ allowed: true })),
}));

const editor = blueprintEditor();
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  __resetGlProbe();
  act(() => { useEditorStore.getState().finishTour(); });
  localStorage.clear();
});

const en = (key: Parameters<typeof translateFor>[1]) => translateFor('en', key);
const s = () => useEditorStore.getState();
const card = () => tourCards(true).find((c) => c.kind === 'blueprint')!;
const cardIndex = () => tourCards(true).findIndex((c) => c.kind === 'blueprint');
const stepOf = (id: string) => card().show!.find((step) => step.id === id)!;

/** Stands the Blueprint Show me at step `id` as the shell does, its pose first, and returns the
 *  watch the step starts from. */
function at(id: string): TourWatch {
  const index = card().show!.findIndex((step) => step.id === id);
  act(() => s().setTourPhase({ kind: 'show', card: cardIndex(), step: index }));
  const pose = card().show![index]!.pose;
  if (pose) act(() => s().poseTour(pose));
  return readTourWatch();
}
const doneSince = (id: string, from: TourWatch): boolean => stepOf(id).done!(from, readTourWatch(), { fit: false });

/** The scene's sample saved to the library as the blueprint the steps pick. */
async function saved(): Promise<{ sc: Scene; id: string }> {
  const sc = scene();
  open(sc.w);
  useEditorStore.setState({ locale: 'en' });
  const record = await saveBlueprint({ frame: sc.frame, name: 'Terrace', author: 'Mei', folder: null });
  if (typeof record === 'string') throw new Error(`refused: ${record}`);
  return { sc, id: record.id };
}

/** Walks the Show me through its tries on `sc`, up to the save step standing. */
function tryUpToSave(sc: Scene, id: string): void {
  at('open-blueprint');
  act(() => s().setEditMode({ mode: 'blueprint' }));
  at('pick');
  act(() => armBlueprint(id));
  at('place');
  act(() => { placeArmedAt(sc.free); });
  at('turn');
  act(() => { turnSelectedGroup(1); });
  at('move');
  act(() => { moveSelectedGroup(shift(sc.free, 8, 0)); });
  at('new');
  act(() => { beginBlueprintFrame(); });
  at('frame');
  act(() => { s().setRegion(terrainCellsUnder(sc.frame), 'blueprint'); confirmBlueprintFrame(); });
  at('save');
  expect(s().blueprintStep.at).toBe('save');
}

spec('UI-45', 'the cards follow one another as welcome, moving, shaping, houses and trees, Blueprint, 3D, Generate, the assistant and sharing', () => {
  expect(tourCards(true).map((c) => c.kind)).toEqual(['welcome', 'move', 'shape', 'objects', 'blueprint', 'view3d', 'generate', 'assistant', 'share']);
  expect(tourCards(false).map((c) => c.kind)).toEqual(['welcome', 'move', 'shape', 'objects', 'blueprint', 'generate', 'assistant', 'share']);
});

spec('UI-49', 'the Blueprint card stands on its words with its Show me in a form whose recording has not been made', async () => {
  const gl = { getExtension: () => null, getParameter: () => 1 };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((kind: string) => (kind === 'webgl2' || kind === 'webgl' ? gl : null)) as never);
  __resetGlProbe();
  act(() => startTour());
  render(<MotionConfig reducedMotion="always"><I18nProvider><InputModeProvider inputMode="touch" shape="portrait"><Tour /></InputModeProvider></I18nProvider></MotionConfig>);
  const deck = screen.getByTestId('tour-deck');
  act(() => { fireEvent.click(within(deck).getByRole('button', { name: translateFor('en', 'tour.dot', { n: cardIndex() + 1, total: tourCards(true).length }) })); });
  await waitFor(() => expect(within(deck).getAllByRole('heading').map((h) => h.textContent)).toEqual([en('tour.blueprint_title')]));
  expect(screen.getByTestId('tour-show-me')).toBeTruthy();
});

spec('UI-50', 'a browser offered the tips before the Blueprint card sees them once more, and not again after', () => {
  localStorage.setItem(TOUR_SEEN_KEY, '2');
  act(() => offerTourAtStart(true));
  expect(s().tourRunning).toBe(true);
  expect(localStorage.getItem(TOUR_SEEN_KEY)).toBe(String(TOUR_VERSION));
  act(() => { s().finishTour(); });
  cleanup();
  act(() => offerTourAtStart(true));
  expect(s().tourRunning).toBe(false);
});

spec('UI-47', 'each step of the Blueprint Show me moves on once the visitor has done what it says, and not before', async () => {
  const { sc, id } = await saved();
  act(() => s().setEditMode({ mode: null }));
  act(() => s().startTour(TOUR_VERSION));

  let from = at('open-blueprint');
  expect(doneSince('open-blueprint', from)).toBe(false);
  act(() => s().setEditMode({ mode: 'blueprint' }));
  expect(doneSince('open-blueprint', from)).toBe(true);

  from = at('pick');
  expect(doneSince('pick', from)).toBe(false);
  act(() => armBlueprint(id));
  expect(doneSince('pick', from)).toBe(true);

  from = at('place');
  expect(doneSince('place', from)).toBe(false);
  act(() => { placeArmedAt(sc.free); });
  expect(doneSince('place', from)).toBe(true);

  from = at('turn');
  expect(doneSince('turn', from)).toBe(false);
  act(() => { turnSelectedGroup(1); });
  expect(doneSince('turn', from)).toBe(true);

  // A turn about the placement's centre is not a move; a drag to another spot is.
  from = at('move');
  act(() => { turnSelectedGroup(1); });
  expect(doneSince('move', from)).toBe(false);
  act(() => { moveSelectedGroup(shift(sc.free, 8, 0)); });
  expect(doneSince('move', from)).toBe(true);

  from = at('new');
  expect(doneSince('new', from)).toBe(false);
  act(() => { beginBlueprintFrame(); });
  expect(doneSince('new', from)).toBe(true);

  // A frame drawn is not yet finished: the step moves on once Done reaches the save panel.
  from = at('frame');
  act(() => { s().setRegion(terrainCellsUnder(sc.frame), 'blueprint'); });
  expect(doneSince('frame', from)).toBe(false);
  act(() => { confirmBlueprintFrame(); });
  expect(doneSince('frame', from)).toBe(true);

  // The save panel's step only points, so nothing there is pressed to move on.
  expect(stepOf('save').done).toBeUndefined();

  from = at('unfold');
  expect(s().blueprintStep.at).toBe('strip');
  expect(doneSince('unfold', from)).toBe(false);
  act(() => { unfoldBlueprintLibrary(true); });
  expect(doneSince('unfold', from)).toBe(true);
  expect(stepOf('library').done).toBeUndefined();
});

spec('UI-47', 'the Blueprint Show me reaches the save panel without storing anything, whatever is pressed there', async () => {
  const { sc, id } = await saved();
  const records = editor.lib().records().map((r) => r.id);
  act(() => s().setEditMode({ mode: null }));
  act(() => s().startTour(TOUR_VERSION));
  tryUpToSave(sc, id);
  expect(await saveFramedBlueprint({ frame: sc.frame, name: 'Copy', author: 'Mei', folder: null })).toBe(false);
  expect(editor.lib().records().map((r) => r.id)).toEqual(records);
  act(() => s().leaveShowMe());
  expect(editor.lib().records().map((r) => r.id)).toEqual(records);
  expect(s().blueprintStep.at).not.toBe('save');
  expect(s().mapStandIn).toBeNull();
});

spec('UI-47', 'the end of the Blueprint Show me leaves the map, its history, the library, the armed blueprint and the explorer as they stood', async () => {
  const { sc, id } = await saved();
  act(() => { armBlueprint(id); unfoldBlueprintLibrary(true); });
  const before = {
    map: mapFingerprint(s().gridState!), depth: s().commandExecutor!.historyDepth(), records: editor.lib().records(),
    blueprint: s().blueprint, step: s().blueprintStep, mode: s().editMode.mode,
  };
  expect(explorerUnfolded(before.step)).toBe(true);
  act(() => s().startTour(TOUR_VERSION));
  tryUpToSave(sc, id);
  at('unfold');
  act(() => { unfoldBlueprintLibrary(true); s().setBlueprintUi({ view: 'list', folder: 'Elsewhere' }); });
  at('library');
  expect(mapFingerprint(s().gridState!)).not.toBe(before.map);
  act(() => s().leaveShowMe());
  expect(mapFingerprint(s().gridState!)).toBe(before.map);
  expect(s().commandExecutor!.historyDepth()).toBe(before.depth);
  expect(editor.lib().records()).toEqual(before.records);
  expect(s().blueprint).toEqual(before.blueprint);
  expect(s().blueprintStep).toEqual(before.step);
  expect(s().editMode.mode).toBe(before.mode);
});
