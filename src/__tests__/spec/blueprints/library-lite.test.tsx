// @vitest-environment jsdom
/** The offline edition writes no files, so the explorer offers no blueprint export there. */
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

vi.mock('../../../platform/build/edition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../platform/build/edition')>()),
  SUPPORTS_JSON_FILES: false,
}));

const { lib } = blueprintEditor();
afterEach(cleanup);

const BODY = { w: 3, h: 2, cells: Array(6).fill(null), objects: [] } as unknown as BlueprintRecord['body'];

beforeEach(async () => {
  await lib().save({
    id: 'a', name: 'Harbour', folder: 'Docks', author: null, origin: null, savedAt: 1, appVersion: '0', body: BODY,
    thumbs: { flat: 'data:image/png;base64,flat', lifted: 'data:image/png;base64,lifted' },
  });
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
});

spec('BLUE-11', 'the offline edition offers no export of a blueprint, a selection or a folder', () => {
  setStoreState({ locale: 'en' });
  useEditorStore.getState().setEditMode({ mode: 'blueprint' });
  render(
    <MotionConfig reducedMotion="always">
      <InputModeProvider inputMode="pc" shape="landscape">
        <I18nProvider><FrameLayoutProvider><BlueprintShelf /></FrameLayoutProvider></I18nProvider>
      </InputModeProvider>
    </MotionConfig>,
  );
  // The armed blueprint's menu renames, moves and deletes.
  const harbour = within(screen.getByTestId('blueprint-cards')).getByRole('button', { name: 'Harbour' });
  act(() => { fireEvent.click(harbour); });
  expect(screen.queryByRole('button', { name: 'Export' })).toBeNull();
  act(() => { fireEvent.contextMenu(harbour); });
  expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Rename', 'Move to…', 'Delete']);
  act(() => { fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' }); });
  // The explorer, a selection's menu and a folder's menu.
  act(() => { fireEvent.click(screen.getByTestId('shell-blueprint-unfold')); });
  const explorer = screen.getByTestId('blueprint-explorer');
  expect(within(explorer).queryByRole('button', { name: /^Export/ })).toBeNull();
  expect(within(explorer).queryByRole('button', { name: 'Import' })).toBeNull();
  act(() => { fireEvent.contextMenu(within(explorer).getByRole('tab', { name: 'Docks' })); });
  expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Rename', 'Delete']);
});
