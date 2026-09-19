import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { useEditorStore } from '../../state/store';
import { I18nProvider } from '../../i18n/context';
import { LiteWindows } from '../../ui/lite/LiteWindows';

const lifetime = vi.hoisted(() => ({ mount: vi.fn(), unmount: vi.fn() }));
vi.mock('../../ui/shell/windows/EditorWindows', () => ({ EditorWindows: () => null }));
vi.mock('../../ui/lite/LiteShareWindow', () => ({ LiteShareWindow: () => null }));
vi.mock('../../ui/chrome/modals/import/ImportModal', async () => {
  const { useEffect } = await import('react');
  const { useEditorStore: store } = await import('../../state/store');
  return {
    ImportModal() {
      const open = store(s => s.modals.import);
      useEffect(() => { lifetime.mount(); return () => { lifetime.unmount(); }; }, []);
      return <div data-testid="import-card" data-open={String(open)} />;
    },
  };
});

afterEach(() => { cleanup(); useEditorStore.getState().setModal('import', false); vi.clearAllMocks(); });

it('loads Import on demand and lets its card finish closing before another open', async () => {
  useEditorStore.getState().setModal('import', false);
  render(<I18nProvider><LiteWindows /></I18nProvider>);
  expect(screen.queryByTestId('import-card')).toBeNull();
  await act(async () => { useEditorStore.getState().setModal('import', true); });
  expect((await screen.findByTestId('import-card')).getAttribute('data-open')).toBe('true');
  act(() => { useEditorStore.getState().setModal('import', false); });
  expect(screen.getByTestId('import-card').getAttribute('data-open')).toBe('false');
  expect(lifetime.unmount).not.toHaveBeenCalled();
  act(() => { useEditorStore.getState().setModal('import', true); });
  expect(screen.getByTestId('import-card').getAttribute('data-open')).toBe('true');
  expect(lifetime.mount).toHaveBeenCalledTimes(1);
});
