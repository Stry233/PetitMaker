// @vitest-environment jsdom
/** The explorer's Export, and a folder's or a card's menu Export, opens the export notice every image
 *  and JSON export opens, and writes its file only once the notice is accepted. */
import { afterEach, beforeEach, expect, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { spec } from '../../_support/spec';
import { setStoreState } from '../../_support/store';
import { I18nProvider } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import type { BlueprintRecord } from '../../../io/blueprint';
import { InputModeProvider } from '../../../ui/design/input-mode';
import { FrameLayoutProvider } from '../../../ui/shell/frame-layout';
import { BlueprintShelf } from '../../../ui/shell/bars/blueprint/BlueprintShelf';
import { blueprintEditor } from './_blueprints';

const download = vi.hoisted(() => ({ downloadJSON: vi.fn() }));
vi.mock('../../../io/export/download', async (original) => ({
  ...(await original<typeof import('../../../io/export/download')>()),
  downloadJSON: download.downloadJSON,
}));

const { lib } = blueprintEditor();
afterEach(cleanup);

const BODY = { w: 3, h: 2, cells: Array(6).fill(null), objects: [] } as unknown as BlueprintRecord['body'];

beforeEach(async () => {
  download.downloadJSON.mockReset();
  await lib().save({
    id: 'a', name: 'Harbour', folder: 'Docks', author: null, origin: null, savedAt: 1, appVersion: '0', body: BODY,
    thumbs: { flat: 'data:image/png;base64,flat', lifted: 'data:image/png;base64,lifted' },
  });
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
});

function mount() {
  setStoreState({ locale: 'en' });
  useEditorStore.getState().setEditMode({ mode: 'blueprint' });
  useEditorStore.getState().unfoldBlueprintExplorer([]);
  render(
    <MotionConfig reducedMotion="always">
      <InputModeProvider inputMode="pc" shape="landscape">
        <I18nProvider><FrameLayoutProvider><BlueprintShelf /></FrameLayoutProvider></I18nProvider>
      </InputModeProvider>
    </MotionConfig>,
  );
}

spec('BLUE-11', 'a folder\'s or a card\'s menu Export opens the same notice, and going back writes nothing', async () => {
  mount();
  const explorer = screen.getByTestId('blueprint-explorer');
  for (const on of [within(explorer).getByRole('tab', { name: 'Docks' }), within(explorer).getByRole('button', { name: 'Harbour' })]) {
    act(() => { fireEvent.contextMenu(on); });
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'Export' })); });
    const notice = await screen.findByRole('dialog', { name: 'Before you export' });
    expect(download.downloadJSON).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(within(notice).getByRole('button', { name: 'Back to editing' })); });
    expect(screen.queryByRole('dialog', { name: 'Before you export' })).toBeNull();
  }
  expect(download.downloadJSON).not.toHaveBeenCalled();
});

spec('BLUE-11', 'Export opens the export notice before the file is written, and going back writes nothing', async () => {
  mount();
  await act(async () => { fireEvent.click(within(screen.getByTestId('blueprint-explorer')).getByRole('button', { name: 'Export the 1 blueprint' })); });
  const notice = await screen.findByRole('dialog', { name: 'Before you export' });
  expect(download.downloadJSON).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(within(notice).getByRole('button', { name: 'Back to editing' })); });
  expect(screen.queryByRole('dialog', { name: 'Before you export' })).toBeNull();
  expect(download.downloadJSON).not.toHaveBeenCalled();
});
