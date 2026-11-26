// @vitest-environment jsdom
/** Managing the library from the explorer by direct manipulation: the menu a folder opens on a right
 *  press or a hold, and the one a card or the selection opens on a right press or, in touch mode, from
 *  the one selected card's menu button, in the wide and the upright forms. */
import { afterEach, beforeEach, expect, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { spec } from '../../_support/spec';
import { setStoreState } from '../../_support/store';
import { I18nProvider } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import type { BlueprintRecord } from '../../../io/blueprint';
import type { InputMode } from '../../../platform/device/input-mode';
import type { LayoutShape } from '../../../platform/device/layout-shape';
import { InputModeProvider } from '../../../ui/design/input-mode';
import { FrameLayoutProvider } from '../../../ui/shell/frame-layout';
import { BlueprintShelf } from '../../../ui/shell/bars/blueprint/BlueprintShelf';
import { FrameStep } from '../../../ui/shell/bars/blueprint/FrameStep';
import { RUN } from '../../../editor/commands/commands';
import { giveBlueprintExamples } from '../../../editor/editing/blueprint/examples';
import { blueprintFolders } from '../../../editor/editing/blueprint';
import { loadLocale } from '../../../i18n/translations';
import { writePref } from '../../../platform/storage/prefs';
import { blueprintEditor, blueprintUi } from './_blueprints';

const download = vi.hoisted(() => ({ downloadJSON: vi.fn() }));
vi.mock('../../../io/export/download', async (original) => ({
  ...(await original<typeof import('../../../io/export/download')>()),
  downloadJSON: download.downloadJSON,
}));
// The notice in front of every export is accepted at once here; `export-notice.test.tsx` holds it.
vi.mock('../../../ui/chrome/modals/export/review/ExportNotice', () => ({
  useExportNotice: () => ({ request: async () => true, notice: null }),
}));
vi.mock('../../../pipelines/moderation/text/reviewer', async (original) => ({
  ...(await original<typeof import('../../../pipelines/moderation/text/reviewer')>()),
  reviewText: vi.fn(async () => ({ allowed: true })),
}));

const { lib, toasts, action } = blueprintEditor();
afterEach(cleanup);

const BODY = { w: 3, h: 2, cells: Array(6).fill(null), objects: [] } as unknown as BlueprintRecord['body'];

function record(id: string, name: string, folder: string | null, savedAt: number): BlueprintRecord {
  return {
    id, name, folder, author: null, origin: null, savedAt, appVersion: '0', body: BODY,
    thumbs: { flat: `data:image/png;base64,flat-${id}`, lifted: `data:image/png;base64,lifted-${id}` },
  };
}

beforeEach(async () => {
  download.downloadJSON.mockReset();
  await lib().save(record('a', 'Harbour', 'Docks', 4));
  await lib().save(record('b', 'Garden corner', 'Gardens', 3));
  await lib().save(record('c', 'Market street', null, 2));
  await lib().save(record('d', 'Pier', 'Docks', 1));
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
});

function mount(shape: LayoutShape = 'landscape', inputMode: InputMode = 'pc') {
  if (shape === 'portrait') {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
  }
  setStoreState({ locale: 'en' });
  useEditorStore.getState().setEditMode({ mode: 'blueprint' });
  useEditorStore.getState().unfoldBlueprintExplorer([], shape === 'portrait' ? { uprightHeight: 600 } : {});
  return render(
    <MotionConfig reducedMotion="always">
      <InputModeProvider inputMode={inputMode} shape={shape}>
        <I18nProvider><FrameLayoutProvider><BlueprintShelf /></FrameLayoutProvider></I18nProvider>
      </InputModeProvider>
    </MotionConfig>,
  );
}

const ui = blueprintUi;
const explorer = () => screen.getByTestId('blueprint-explorer');
const card = (name: string) => within(screen.getByTestId('blueprint-explorer-cards')).getByRole('button', { name });
const names = () => lib().records().map((r) => r.name).sort();
const folderTab = (folder: string) => within(explorer()).queryByRole('tab', { name: folder }) ?? screen.getByRole('tab', { name: folder });
/** Picks `item` from `folder`'s own menu, opened by a right press on its tab or entry. */
async function folderAction(folder: string, item: string) {
  act(() => { fireEvent.contextMenu(folderTab(folder)); });
  await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: item })); });
}
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

/** The file the last export downloaded: its records' names, and the folder each names. */
function exported(): { names: string[]; folders: (string | null)[] } {
  const [json] = download.downloadJSON.mock.calls.at(-1) as [string, string];
  const file = JSON.parse(json) as { records: { name: string; folder: string | null }[] };
  return { names: file.records.map((r) => r.name), folders: file.records.map((r) => r.folder) };
}

/** Types `text` into the open name card and confirms it. */
async function name(text: string, confirm: string) {
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: text } });
  await waitFor(() => expect((within(dialog).getByRole('button', { name: confirm }) as HTMLButtonElement).disabled).toBe(false));
  await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: confirm })); });
  await settle();
}

const menuItems = () => screen.getAllByRole('menuitem').map((m) => m.textContent);
const cardsView = () => within(screen.getByTestId('blueprint-explorer-cards'));

spec('BLUE-10', 'with a mouse no card wears a button: a right press offers Rename for one blueprint, and a double click on its name renames', async () => {
  mount();
  // No action pills or status stand anywhere.
  for (const label of ['Move to…', 'Export', 'Folder…']) expect(within(explorer()).queryByRole('button', { name: label })).toBeNull();
  expect(within(explorer()).queryByText(/selected/)).toBeNull();
  act(() => { fireEvent.click(card('Market street')); });
  for (const label of ['More actions', 'Rename']) expect(within(explorer()).queryByRole('button', { name: label })).toBeNull();
  act(() => { fireEvent.contextMenu(card('Market street')); });
  expect(menuItems()).toEqual(['Rename', 'Move to…', 'Export', 'Delete']);
  await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' })); });
  await name('Main street', 'Rename');
  expect(names()).toEqual(['Garden corner', 'Harbour', 'Main street', 'Pier']);
  // Several selected: their menu renames none.
  act(() => { fireEvent.click(card('Harbour'), { ctrlKey: true }); });
  expect(within(explorer()).queryByRole('button', { name: 'More actions' })).toBeNull();
  act(() => { fireEvent.contextMenu(card('Harbour')); });
  expect(menuItems()).toEqual(['Move to…', 'Export', 'Delete']);
  act(() => { fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' }); });
  // A mouse's double click on a card's name renames it.
  act(() => { fireEvent.click(card('Pier')); });
  const label = within(card('Pier')).getByText('Pier');
  act(() => { fireEvent.click(label, { detail: 2 }); });
  await name('Jetty', 'Rename');
  expect(names()).toEqual(['Garden corner', 'Harbour', 'Jetty', 'Main street']);
  expect(ui().unfolded).toBe(true);
});

spec('BLUE-10', 'in touch mode the one selected blueprint wears a menu button, on its card and on its details row, opening its menu', async () => {
  mount('landscape', 'touch');
  expect(cardsView().queryByRole('button', { name: 'More actions' })).toBeNull();
  act(() => { fireEvent.click(card('Market street')); });
  const onCard = cardsView().getByRole('button', { name: 'More actions' });
  act(() => { fireEvent.click(onCard); });
  expect(onCard.getAttribute('aria-expanded')).toBe('true');
  expect(menuItems()).toEqual(['Rename', 'Move to…', 'Export', 'Delete']);
  await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' })); });
  await name('Main street', 'Rename');
  expect(names()).toEqual(['Garden corner', 'Harbour', 'Main street', 'Pier']);
  // The details list's selected row wears it too, and a second press puts the menu away.
  act(() => { fireEvent.click(within(explorer()).getByRole('button', { name: 'Details' })); });
  const onRow = cardsView().getByRole('button', { name: 'More actions' });
  act(() => { fireEvent.click(onRow); });
  expect(menuItems()).toEqual(['Rename', 'Move to…', 'Export', 'Delete']);
  act(() => { fireEvent.click(onRow); });
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  // Several selected wear none.
  act(() => { useEditorStore.getState().setBlueprintUi({ selected: ['a', 'c'] }); });
  expect(cardsView().queryByRole('button', { name: 'More actions' })).toBeNull();
});

spec('BLUE-13', 'the explorer names the examples and their folder in the interface language as it changes', async () => {
  writePref('blueprintExamplesGiven', false);
  await giveBlueprintExamples(lib());
  await loadLocale('zh');
  mount();
  expect(folderTab('Examples')).toBeTruthy();
  expect(card('Flower Garden')).toBeTruthy();
  act(() => { setStoreState({ locale: 'zh' }); });
  expect(within(explorer()).getByRole('tab', { name: '示例' })).toBeTruthy();
  expect(card('花园')).toBeTruthy();
  act(() => { fireEvent.click(within(explorer()).getByRole('tab', { name: '示例' })); });
  expect(within(explorer()).getAllByText('示例').length).toBeGreaterThan(1);
  act(() => { setStoreState({ locale: 'en' }); });
  expect(within(explorer()).getAllByText('Examples').length).toBeGreaterThan(1);
  expect(card('Flower Garden')).toBeTruthy();
});

const framing = () => useEditorStore.getState().selectingRegion && useEditorStore.getState().regionSelectionOwner === 'blueprint';
/** New blueprint pressed in the open explorer, or on the strip with `strip`. */
function newBlueprint(strip = false) {
  const on = strip ? screen.getByTestId('shell-blueprint-new') : within(screen.getByTestId('blueprint-explorer-cards')).getByRole('button', { name: 'New blueprint' });
  act(() => { fireEvent.click(on); });
}

spec('BLUE-03', 'New blueprint in the open explorer folds it first, then starts the frame step', () => {
  mount();
  newBlueprint();
  expect(ui().unfolded).toBe(false);
  expect(screen.queryByTestId('blueprint-explorer')).toBeNull();
  expect(framing()).toBe(true);
});

spec('BLUE-04', 'one Escape or Cancel leaves a frame step started in the explorer, which unfolds again', async () => {
  mount();
  newBlueprint();
  act(() => { RUN['selection.deselect']({ toggleMenu: () => {} }); });
  expect(framing()).toBe(false);
  await waitFor(() => expect(ui().unfolded).toBe(true));
  expect(screen.getByTestId('blueprint-explorer')).toBeTruthy();

  // Cancel on the frame step returns there too.
  newBlueprint();
  render(<MotionConfig reducedMotion="always"><I18nProvider><FrameLayoutProvider><FrameStep /></FrameLayoutProvider></I18nProvider></MotionConfig>);
  act(() => { fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); });
  expect(framing()).toBe(false);
  await waitFor(() => expect(ui().unfolded).toBe(true));
});

spec('BLUE-04', 'one Escape leaves a frame step started on the strip for the strip', async () => {
  mount();
  act(() => { useEditorStore.getState().foldBlueprintExplorer(); });
  newBlueprint(true);
  expect(framing()).toBe(true);
  act(() => { RUN['selection.deselect']({ toggleMenu: () => {} }); });
  expect(framing()).toBe(false);
  await settle();
  expect(ui().unfolded).toBe(false);
});

/** The head's Export button, named for what a press on it exports now. */
const exportButton = (name: string) => within(explorer()).getByRole('button', { name });

spec('BLUE-11', 'the head\'s one Export exports what the explorer shows, and its name says which', async () => {
  mount();
  // All: the whole library, newest saved first, carrying no folder.
  await act(async () => { fireEvent.click(exportButton('Export all 4 blueprints')); });
  expect(exported()).toEqual({ names: ['Harbour', 'Garden corner', 'Market street', 'Pier'], folders: ['Docks', 'Gardens', null, 'Docks'] });
  // A folder: the folder's file, carrying its name.
  act(() => { fireEvent.click(within(explorer()).getByRole('tab', { name: 'Docks' })); });
  await act(async () => { fireEvent.click(exportButton('Export the 2 blueprints in “Docks”')); });
  expect(exported()).toEqual({ names: ['Harbour', 'Pier'], folders: ['Docks', 'Docks'] });
  // One selected, then several.
  act(() => { fireEvent.click(card('Pier')); });
  await act(async () => { fireEvent.click(exportButton('Export “Pier”')); });
  expect(exported()).toEqual({ names: ['Pier'], folders: [null] });
  act(() => { fireEvent.click(card('Harbour'), { ctrlKey: true }); });
  await act(async () => { fireEvent.click(exportButton('Export 2 selected blueprints')); });
  expect(exported()).toEqual({ names: ['Harbour', 'Pier'], folders: ['Docks', 'Docks'] });
  // A search: what it found, across folders.
  act(() => { fireEvent.change(within(explorer()).getByRole('searchbox'), { target: { value: 'ar' } }); });
  await act(async () => { fireEvent.click(exportButton('Export the 3 blueprints found')); });
  expect(exported()).toEqual({ names: ['Harbour', 'Garden corner', 'Market street'], folders: ['Docks', 'Gardens', null] });
  // An empty folder has nothing to export.
  act(() => { fireEvent.change(within(explorer()).getByRole('searchbox'), { target: { value: '' } }); });
  act(() => { useEditorStore.getState().setBlueprintUi({ folder: lib().addFolder('Empty') }); });
  download.downloadJSON.mockReset();
  await act(async () => { fireEvent.click(exportButton('Export')); });
  expect(download.downloadJSON).not.toHaveBeenCalled();
});

spec('BLUE-10', 'a folder\'s menu exports the folder and a card\'s the blueprint or the selection it was opened on', async () => {
  mount();
  act(() => { fireEvent.contextMenu(folderTab('Docks')); });
  expect(menuItems()).toEqual(['Rename', 'Export', 'Delete']);
  await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'Export' })); });
  expect(exported()).toEqual({ names: ['Harbour', 'Pier'], folders: ['Docks', 'Docks'] });
  act(() => { fireEvent.contextMenu(card('Harbour')); });
  expect(menuItems()).toEqual(['Rename', 'Move to…', 'Export', 'Delete']);
  await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'Export' })); });
  expect(exported()).toEqual({ names: ['Harbour'], folders: [null] });
  act(() => { fireEvent.click(card('Harbour')); });
  act(() => { fireEvent.click(card('Garden corner'), { ctrlKey: true }); });
  act(() => { fireEvent.contextMenu(card('Garden corner')); });
  expect(menuItems()).toEqual(['Move to…', 'Export', 'Delete']);
  await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'Export' })); });
  expect(exported()).toEqual({ names: ['Harbour', 'Garden corner'], folders: ['Docks', 'Gardens'] });
  // A folder holding nothing has nothing to export.
  act(() => { lib().addFolder('Empty'); });
  act(() => { fireEvent.contextMenu(folderTab('Empty')); });
  expect(menuItems()).toEqual(['Rename', 'Delete']);
});

spec('BLUE-10', 'a folder\'s menu offers only what the folder allows: nothing to rename or delete on My Blueprints, no Delete on Examples', async () => {
  writePref('blueprintExamplesGiven', false);
  await giveBlueprintExamples(lib());
  mount();
  const offered = (folder: string): string[] => {
    act(() => { fireEvent.contextMenu(folderTab(folder)); });
    const items = screen.queryAllByRole('menuitem').map((m) => m.textContent ?? '');
    act(() => { fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' }); });
    return items;
  };
  expect(offered('My Blueprints')).toEqual([]);
  expect(offered('Examples')).toEqual(['Rename', 'Export']);
  expect(offered('Docks')).toEqual(['Rename', 'Export', 'Delete']);
  await act(async () => { await lib().move(['a'], blueprintFolders()[0]!); });
  expect(offered('My Blueprints')).toEqual(['Export']);
});

spec('BLUE-10', 'renaming a folder keeps it open and says when the name is taken', async () => {
  mount();
  act(() => { fireEvent.click(within(explorer()).getByRole('tab', { name: 'Docks' })); });
  await folderAction('Docks', 'Rename');
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Gardens' } });
  expect(within(dialog).getByRole('alert').textContent).toBe('A folder with this name already exists. Please choose another name.');
  expect((within(dialog).getByRole('button', { name: 'Rename' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: ' ' } });
  expect(within(dialog).getByRole('alert').textContent).toBe('Please enter a folder name.');
  await name('Harbourside', 'Rename');
  expect(lib().folders()).toEqual(['Harbourside', 'Gardens']);
  expect(lib().records().filter((r) => r.folder === 'Harbourside').map((r) => r.id).sort()).toEqual(['a', 'd']);
  expect(ui().folder).toBe('Harbourside');
});

spec('BLUE-10', 'deleting a folder asks first and removes its blueprints', async () => {
  mount();
  act(() => { fireEvent.click(within(explorer()).getByRole('tab', { name: 'Docks' })); });
  await folderAction('Docks', 'Delete');
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('Delete the folder “Docks” and the 2 blueprints in it?')).toBeTruthy();
  // Cancel leaves everything.
  await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' })); });
  expect(lib().folders()).toContain('Docks');
  await folderAction('Docks', 'Delete');
  await act(async () => { fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' })); });
  await settle();
  expect(lib().folders()).toEqual(['Gardens']);
  expect(names()).toEqual(['Garden corner', 'Market street']);
  expect(ui().folder).toBeNull();
});

spec('BLUE-10', 'the upright explorer offers the same folder menu, a hold on a tab opening it', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    mount('portrait', 'touch');
    const tab = screen.getByRole('tab', { name: 'Gardens' });
    fireEvent.pointerDown(tab, { pointerType: 'touch', pointerId: 5, clientX: 10, clientY: 10 });
    act(() => { vi.advanceTimersByTime(600); });
    fireEvent.pointerUp(tab, { pointerType: 'touch', pointerId: 5, clientX: 10, clientY: 10 });
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Rename', 'Export', 'Delete']);
    act(() => { fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' }); });
  } finally { vi.useRealTimers(); }
  // The upright explorer's Export exports the folder it shows.
  act(() => { fireEvent.click(screen.getByRole('tab', { name: 'Gardens' })); });
  await act(async () => { fireEvent.click(exportButton('Export the 1 blueprint in “Gardens”')); });
  expect(exported()).toEqual({ names: ['Garden corner'], folders: [null] });
  await folderAction('Gardens', 'Delete');
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('Delete the folder “Gardens” and the 1 blueprint in it?')).toBeTruthy();
  await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' })); });
  await settle();
  expect(lib().folders()).toEqual(['Docks']);
});

spec('BLUE-10', 'a finger held on a folder opens its menu and leaves the open folder as it was, wide and upright', () => {
  for (const shape of ['landscape', 'portrait'] as const) {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mount(shape, 'touch');
      expect(ui().folder).toBeNull();
      const held = folderTab('Gardens');
      fireEvent.pointerDown(held, { pointerType: 'touch', pointerId: 7, button: 0, clientX: 10, clientY: 10 });
      act(() => { vi.advanceTimersByTime(600); });
      // The release completes the press as a click on the folder, which is the end of the hold.
      fireEvent.pointerUp(held, { pointerType: 'touch', pointerId: 7, button: 0, clientX: 10, clientY: 10 });
      act(() => { fireEvent.click(held, { detail: 1 }); });
      expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Rename', 'Export', 'Delete']);
      expect(ui().folder).toBeNull();
      // A plain tap on the folder afterwards still opens it.
      act(() => { fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' }); });
      fireEvent.pointerDown(held, { pointerType: 'touch', pointerId: 8, button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerUp(held, { pointerType: 'touch', pointerId: 8, button: 0, clientX: 10, clientY: 10 });
      act(() => { fireEvent.click(held, { detail: 1 }); });
      expect(ui().folder).toBe('Gardens');
    } finally { vi.useRealTimers(); }
    cleanup();
    act(() => { useEditorStore.getState().setBlueprintUi({ folder: null }); });
  }
});

spec('BLUE-10', 'a right press on a selected card opens the selection\'s menu, and in the details list on a row, moving it to a folder', async () => {
  mount();
  act(() => { fireEvent.click(card('Harbour')); });
  act(() => { fireEvent.click(card('Market street'), { ctrlKey: true }); });
  // Several selected wear the selection's look alone: no count stands on any of them at rest.
  expect(within(screen.getByTestId('blueprint-explorer-cards')).queryByText('2')).toBeNull();
  act(() => { fireEvent.contextMenu(card('Market street')); });
  expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Move to…', 'Export', 'Delete']);
  act(() => { fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' }); });
  act(() => { fireEvent.click(within(explorer()).getByRole('button', { name: 'Details' })); });
  const rows = screen.getByTestId('blueprint-explorer-cards');
  act(() => { fireEvent.contextMenu(rows.querySelector('[data-blueprint-id="c"]')!); });
  await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'Move to…' })); });
  await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'Gardens' })); });
  await settle();
  expect(lib().records().filter((r) => r.folder === 'Gardens').map((r) => r.id).sort()).toEqual(['a', 'b', 'c']);
  // The same toast a drop onto the folder raises.
  expect(toasts()).toContain('2 blueprints moved to Gardens');
});

spec('BLUE-10', 'Delete in a card\'s or the selection\'s menu deletes as a drop on the delete target does, with its Undo', async () => {
  mount();
  act(() => { fireEvent.contextMenu(card('Market street')); });
  await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' })); });
  await settle();
  expect(names()).toEqual(['Garden corner', 'Harbour', 'Pier']);
  expect(toasts()).toContain('Deleted “Market street”');
  act(() => { fireEvent.click(card('Harbour')); });
  act(() => { fireEvent.click(card('Pier'), { ctrlKey: true }); });
  act(() => { fireEvent.contextMenu(card('Harbour')); });
  await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' })); });
  await settle();
  expect(names()).toEqual(['Garden corner']);
  expect(toasts()).toContain('2 blueprints deleted');
  await act(async () => { action()!.run(); });
  await settle();
  expect(names()).toEqual(['Garden corner', 'Harbour', 'Pier']);
  expect(lib().records().find((r) => r.id === 'a')!.folder).toBe('Docks');
});

spec('BLUE-10', 'a finger\'s hold on a card lifts it rather than opening a menu', () => {
  mount('landscape', 'touch');
  act(() => { fireEvent.click(card('Harbour')); });
  const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'pointerType', { value: 'touch' });
  act(() => { card('Harbour').dispatchEvent(e); });
  expect(screen.queryByRole('menu')).toBeNull();
});

spec('BLUE-10', 'the Delete key deletes the explorer\'s selection with an Undo, as a drop does', async () => {
  mount();
  act(() => { fireEvent.click(card('Harbour')); });
  act(() => { fireEvent.click(card('Pier'), { ctrlKey: true }); });
  act(() => { RUN['selection.delete']({ toggleMenu: () => {} }); });
  await settle();
  expect(names()).toEqual(['Garden corner', 'Market street']);
  expect(toasts()).toContain('2 blueprints deleted');
  expect(ui().selected).toEqual([]);
});
