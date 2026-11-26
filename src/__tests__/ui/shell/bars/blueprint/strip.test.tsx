// @vitest-environment jsdom
/** The Blueprint strip at rest: its folder tabs, its cards and what an armed card offers. */
import { useLayoutEffect } from 'react';
import { afterEach, expect, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { spec } from '../../../../_support/spec';
import { setStoreState } from '../../../../_support/store';
import { I18nProvider } from '../../../../../i18n/context';
import { useEditorStore } from '../../../../../state/store';
import { regionRequestOf } from '../../../../../state/editing/region';
import type { BlueprintRecord } from '../../../../../io/blueprint';
import { backOut } from '../../../../../editor/back/back-out';
import { __setBlueprintLibrary, renameBlueprint } from '../../../../../editor/editing/blueprint';
import { createBlueprintLibrary, memoryBlueprintBackend, memoryBlueprintLists } from '../../../../../io/storage/blueprint-library';
import { BlueprintShelf } from '../../../../../ui/shell/bars/blueprint/BlueprintShelf';
import { InputModeProvider } from '../../../../../ui/design/input-mode';
import type { InputMode } from '../../../../../platform/device/input-mode';
import { blueprintEditor } from '../../../../spec/blueprints/_blueprints';

vi.mock('../../../../../pipelines/moderation/text/reviewer', async (original) => ({
  ...(await original<typeof import('../../../../../pipelines/moderation/text/reviewer')>()),
  reviewText: vi.fn(async () => ({ allowed: true })),
}));

const { lib, toasts } = blueprintEditor();
afterEach(cleanup);

const BODY = { w: 1, h: 1, cells: [{ type: 'grass', rise: 0 }], objects: [] } as unknown as BlueprintRecord['body'];

/** A stored record named `name` in `folder`, its two pictures told apart by their data. */
function record(id: string, name: string, folder: string | null, savedAt: number): BlueprintRecord {
  return {
    id, name, folder, author: null, origin: null, savedAt, appVersion: '0', body: BODY,
    thumbs: { flat: `data:image/png;base64,flat-${id}`, lifted: `data:image/png;base64,lifted-${id}` },
  };
}

async function seed(): Promise<void> {
  await lib().save(record('a', 'Harbour', 'Docks', 3));
  await lib().save(record('b', 'Garden corner', 'Gardens', 2));
  await lib().save(record('c', 'Market street', null, 1));
}

function mount(inputMode: InputMode = 'pc') {
  setStoreState({ locale: 'en' });
  useEditorStore.getState().setEditMode({ mode: 'blueprint' });
  return render(
    <MotionConfig reducedMotion="always">
      <InputModeProvider inputMode={inputMode}><I18nProvider><BlueprintShelf /></I18nProvider></InputModeProvider>
    </MotionConfig>,
  );
}

/** The blueprints the row shows, after the New blueprint card that leads it. */
const cards = (): string[] => [...screen.getByTestId('blueprint-cards').querySelectorAll('[data-blueprint-id]')].map((b) => b.getAttribute('aria-label') ?? '');

spec('BLUE-02', 'lists folders as tabs and filters the cards', async () => {
  await seed();
  mount();
  const tabs = within(screen.getByRole('tablist', { name: 'Blueprint' })).getAllByRole('tab').map((t) => t.textContent);
  expect(tabs).toEqual(['All', 'Docks', 'Gardens']);
  expect(screen.getByRole('button', { name: 'New folder' })).toBeTruthy();
  expect(cards()).toEqual(['Harbour', 'Garden corner', 'Market street']);
  act(() => { fireEvent.click(screen.getByRole('tab', { name: 'Gardens' })); });
  expect(cards()).toEqual(['Garden corner']);
  expect(useEditorStore.getState().blueprint.folder).toBe('Gardens');
  act(() => { fireEvent.click(screen.getByRole('tab', { name: 'All' })); });
  act(() => { fireEvent.change(screen.getByRole('searchbox', { name: 'Search' }), { target: { value: 'street' } }); });
  expect(cards()).toEqual(['Market street']);
});

spec('BLUE-02', 'an armed card wears nothing on its corner or under the row, and its right press offers Rename', async () => {
  await seed();
  mount();
  act(() => { fireEvent.click(screen.getByRole('button', { name: 'Harbour' })); });
  expect(useEditorStore.getState().blueprint.armed).toBe('a');
  expect(screen.getByRole('button', { name: 'Harbour' }).getAttribute('aria-pressed')).toBe('true');
  // No buttons on the card and no action pills: the row under the cards stays the scrollbar.
  for (const name of ['More actions', 'Rename', 'Move to…', 'Export', 'Delete']) expect(screen.queryByRole('button', { name })).toBeNull();
  expect(screen.queryByTestId('blueprint-armed-row')).toBeNull();
  // The card's right press opens its menu, whose Rename opens the name card for the armed blueprint.
  act(() => { fireEvent.contextMenu(screen.getByRole('button', { name: 'Harbour' })); });
  expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Rename', 'Move to…', 'Export', 'Delete']);
  act(() => { fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' })); });
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Quay' } });
  await waitFor(() => expect((within(dialog).getByRole('button', { name: 'Rename' }) as HTMLButtonElement).disabled).toBe(false));
  await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Rename' })); });
  await waitFor(() => expect(lib().records().find((r) => r.id === 'a')?.name).toBe('Quay'));
  // Pressing the armed card again disarms it, as Escape does.
  act(() => { fireEvent.click(screen.getByRole('button', { name: 'Market street' })); });
  act(() => { fireEvent.click(screen.getByRole('button', { name: 'Market street' })); });
  expect(useEditorStore.getState().blueprint.armed).toBeNull();
  act(() => { fireEvent.click(screen.getByRole('button', { name: 'Market street' })); });
  act(() => { expect(backOut()).toBe(true); });
  expect(useEditorStore.getState().blueprint.armed).toBeNull();
});

spec('BLUE-02', 'in touch mode an armed card wears no button on its corner either', async () => {
  await seed();
  mount('touch');
  act(() => { fireEvent.click(screen.getByRole('button', { name: 'Harbour' })); });
  expect(useEditorStore.getState().blueprint.armed).toBe('a');
  for (const name of ['More actions', 'Rename']) expect(screen.queryByRole('button', { name })).toBeNull();
});

spec('BLUE-02', 'shows the 3D thumbnail in the 3D view', async () => {
  await seed();
  setStoreState({ viewMode: '2d' });
  mount();
  const picture = () => screen.getByRole('button', { name: 'Harbour' }).querySelector('img[src^="data:"]')?.getAttribute('src');
  expect(picture()).toBe('data:image/png;base64,flat-a');
  act(() => { setStoreState({ viewMode: '3d' }); });
  expect(picture()).toBe('data:image/png;base64,lifted-a');
});

spec('BLUE-02', 'an empty library offers only 新建蓝图', () => {
  mount();
  expect(within(screen.getByTestId('blueprint-cards')).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['New blueprint']);
  const offer = within(screen.getByTestId('blueprint-cards')).getByRole('button', { name: 'New blueprint' });
  act(() => { fireEvent.click(offer); });
  expect(regionRequestOf(useEditorStore.getState()).tools).toEqual(['rect']);
});

spec('BLUE-02', 'a change the browser refuses to store says so', async () => {
  const backend = memoryBlueprintBackend();
  const failing = createBlueprintLibrary({ ...backend, put: async (r) => { if (r.name === 'Pier') throw new Error('quota'); await backend.put(r); } }, memoryBlueprintLists());
  const restore = __setBlueprintLibrary(failing);
  try {
    await failing.save(record('a', 'Harbour', null, 1));
    expect(await renameBlueprint('a', 'Pier')).toBe(false);
    expect(toasts()).toEqual(['Blueprints: this browser could not save the change']);
    expect(failing.records()[0]!.name).toBe('Harbour');
  } finally { restore(); }
});

spec('BLUE-02', 'a folder the library gains while the strip first draws shows as a tab', async () => {
  await seed();
  /** Adds a folder in the commit that mounts the strip, before the strip's passive effects run. */
  function AddsFolder(): null {
    useLayoutEffect(() => { lib().addFolder('Ponds'); }, []);
    return null;
  }
  setStoreState({ locale: 'en' });
  useEditorStore.getState().setEditMode({ mode: 'blueprint' });
  render(<MotionConfig reducedMotion="always"><I18nProvider><BlueprintShelf /><AddsFolder /></I18nProvider></MotionConfig>);
  const tabs = within(screen.getByRole('tablist', { name: 'Blueprint' })).getAllByRole('tab').map((t) => t.textContent);
  expect(tabs).toEqual(['All', 'Docks', 'Gardens', 'Ponds']);
});
