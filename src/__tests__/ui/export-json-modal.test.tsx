import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ExportJsonModal } from '../../ui/chrome/export/ExportJsonModal';
import { makeState } from '../rules/_helpers';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules/index';
import { I18nProvider } from '../../i18n/context';

vi.mock('../../io/image-export', async (orig) => ({ ...(await orig<typeof import('../../io/image-export')>()), downloadJSON: vi.fn() }));
import { downloadJSON } from '../../io/image-export';
import { setStoreState } from '../_store';

function mount() {
  const s = makeState(8, 8);
  const e = new CommandExecutor(s, new EventBus(), createDefaultRegistry());
  setStoreState({ gridState: s, commandExecutor: e, exportJsonModalOpen: true, locale: 'en' });
}
const W = ({ children }: { children: React.ReactNode }) => <I18nProvider>{children}</I18nProvider>;

describe('ExportJsonModal', () => {
  it('renders all section rows with size chips; generation disabled without a recipe', async () => {
    mount();
    render(<ExportJsonModal />, { wrapper: W });
    for (const label of ['Map', 'Notes', 'Generation recipe', 'Step history', 'Editor session', 'Statistics', 'Catalog info']) {
      expect(screen.getByText(label, { exact: false })).toBeTruthy();
    }
    await waitFor(() => expect(screen.getAllByText(/KB|B$/).length).toBeGreaterThan(0));
    const gen = screen.getByRole('switch', { name: /generation/i });
    expect(gen.getAttribute('aria-disabled')).toBe('true');
  });
  it('exports only the chosen sections', async () => {
    mount();
    render(<ExportJsonModal />, { wrapper: W });
    fireEvent.click(screen.getByRole('switch', { name: /statistics/i }));
    fireEvent.click(screen.getByRole('button', { name: /export/i }));
    await waitFor(() => expect(vi.mocked(downloadJSON)).toHaveBeenCalled());
    const json = JSON.parse(vi.mocked(downloadJSON).mock.calls[0]![0]!);
    expect(json.stats).toBeTruthy();
    expect(json.history).toBeUndefined();
    expect(json.manifest.appVersion).toBeTruthy();
  });
});
