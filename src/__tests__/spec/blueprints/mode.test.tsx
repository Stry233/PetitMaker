// @vitest-environment jsdom
/** Blueprint is the mode row's sixth tile, before Generate, and opens its own strip. */
import { afterEach, beforeEach, expect } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { spec } from '../../_support/spec';
import { setStoreState } from '../../_support/store';
import { I18nProvider } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { Shell } from '../../../ui/shell/Shell';

beforeEach(() => {
  setStoreState({ locale: 'en' });
  useEditorStore.getState().setEditMode({ mode: null });
  useEditorStore.getState().setAssistantOpen(false);
});
afterEach(cleanup);

spec('BLUE-01', 'the mode row offers Blueprint before Generate and opens its strip', () => {
  render(<I18nProvider><Shell><div data-testid="map-views" /></Shell></I18nProvider>);
  const row = screen.getByRole('group', { name: 'Modes' });
  const names = [...row.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'));
  expect(names).toEqual(['Objects', 'Roads', 'Mountains', 'Water', 'Blueprint', 'Generate']);
  expect(screen.queryByTestId('shell-blueprint-shelf')).toBeNull();
  act(() => { fireEvent.click(screen.getByRole('button', { name: 'Blueprint' })); });
  expect(useEditorStore.getState().editMode.mode).toBe('blueprint');
  expect(screen.getByTestId('shell-blueprint-shelf')).toBeTruthy();
});
