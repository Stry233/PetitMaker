// @vitest-environment jsdom
/**
 * Export without added text, the way out when the text check will not approve the words: the
 * picture leaves the words out and the window keeps them for later editing.
 */
import { beforeEach, describe, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { spec } from '../../_support/spec';
import { ShareWindow } from '../../../ui/chrome/modals/export/ShareWindow';
import { I18nProvider } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { createDefaultRegistry } from '../../../rules';
import { createExecutor } from '../../../state/executor';
import { setStoreState } from '../../_support/store';
import { makeState } from '../../_support/map-state';
import { DEFAULT_FOOTER } from '../../../io/export/footer-template';
import { reviewText } from '../../../pipelines/moderation/text/reviewer';
import { runImageExport } from '../../../io/export/run-image-export';
import { downloadBlob } from '../../../io/export/download';

vi.mock('../../../pipelines/moderation/text/reviewer', async (original) => ({
  ...await original<typeof import('../../../pipelines/moderation/text/reviewer')>(), reviewText: vi.fn(),
}));
vi.mock('../../../ui/chrome/modals/export/review/ExportNotice', () => ({
  useExportNotice: () => ({ request: async () => true, notice: null }),
}));
vi.mock('../../../io/export/run-image-export', () => ({
  runImageExport: vi.fn(async () => ({ status: 'done', blob: new Blob(['png']), carriesCode: false })),
}));
vi.mock('../../../io/export/download', async (original) => ({
  ...await original<typeof import('../../../io/export/download')>(), downloadBlob: vi.fn(),
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => <I18nProvider>{children}</I18nProvider>;

function openShareWindow() {
  const state = makeState(8, 8);
  setStoreState({ gridState: state, commandExecutor: createExecutor(state, createDefaultRegistry()), locale: 'en' });
  useEditorStore.getState().openShare('friend');
  return render(<ShareWindow />, { wrapper: Wrapper });
}

const textbox = (name: string) => screen.getByRole('textbox', { name }) as HTMLInputElement;

describe('export without added text', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(runImageExport).mockClear();
    vi.mocked(downloadBlob).mockClear();
  });

  for (const verdict of ['refused', 'unavailable'] as const) {
    spec('UI-18', `exports the picture without the title, description or custom footer when the check ${verdict === 'refused' ? 'refuses' : 'cannot finish'}, keeping the draft`, async () => {
      if (verdict === 'refused') vi.mocked(reviewText).mockReset().mockResolvedValue({ allowed: false, reason: 'website', fields: ['title'] });
      else vi.mocked(reviewText).mockReset().mockRejectedValue(new Error('Unavailable'));
      const { baseElement } = openShareWindow();
      fireEvent.change(textbox('Title'), { target: { value: 'garden.example.com' } });
      fireEvent.change(textbox('Description'), { target: { value: 'Beside the river' } });
      fireEvent.click(screen.getByText(/appearance/i));
      const footer = baseElement.querySelector('[contenteditable]')!;
      footer.textContent = 'By River';
      fireEvent.input(footer);
      fireEvent.click(screen.getByRole('button', { name: 'Export image' }));
      await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy(), { timeout: 3000 });
      expect(runImageExport).not.toHaveBeenCalled();

      const textless = screen.getByRole('button', { name: 'Export without added text' }) as HTMLButtonElement;
      expect(textless.disabled).toBe(false);
      await act(async () => { fireEvent.click(textless); });
      await waitFor(() => expect(downloadBlob).toHaveBeenCalledOnce());
      const painted = vi.mocked(runImageExport).mock.calls.map(([, input]) => input.options);
      expect(painted).toHaveLength(1);
      expect(painted[0]).toMatchObject({ title: '', description: '', footerTemplate: DEFAULT_FOOTER });

      expect(textbox('Title').value).toBe('garden.example.com');
      expect(textbox('Description').value).toBe('Beside the river');
      expect(baseElement.querySelector('[contenteditable]')!.textContent).toBe('By River');
    });
  }
});
