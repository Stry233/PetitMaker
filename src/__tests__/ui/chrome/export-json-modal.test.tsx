vi.mock('../../../ui/chrome/modals/export/review/use-map-review', () => ({ useMapReview: () => ({ result: { status: 'clear' }, pending: false, previewReady: true, revision: '0', check: async () => ({ status: 'clear' }), retry: vi.fn(), cancel: vi.fn() }) }));
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ExportJsonModal } from '../../../ui/chrome/modals/export/ExportJsonModal';
import { makeState } from '../../rules/_helpers';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules';
import { I18nProvider } from '../../../i18n/context';

vi.mock('../../../ui/chrome/modals/export/review/ExportNotice', () => ({
  useExportNotice: () => ({ request: async () => true, notice: null }),
}));

vi.mock('../../../io/image-export', async (orig) => ({ ...(await orig<typeof import('../../../io/image-export')>()), downloadJSON: vi.fn() }));
import { downloadJSON } from '../../../io/image-export';
import { setStoreState, setStoreModal } from '../../_store';
import { roadLookup } from '../../../state/object-index';

function mount() {
  const s = makeState(8, 8);
  const e = new CommandExecutor(s, new EventBus(), createDefaultRegistry(), roadLookup(s));
  setStoreState({ gridState: s, commandExecutor: e, locale: 'en' });
  setStoreModal('exportJson');
  return s;
}
const W = ({ children }: { children: React.ReactNode }) => <I18nProvider>{children}</I18nProvider>;

describe('ExportJsonModal', () => {
  it('renders all section rows with size chips; generation disabled without a recipe', async () => {
    mount();
    render(<ExportJsonModal />, { wrapper: W });
    for (const label of ['Map', 'Planning annotations', 'Notes', 'Generation recipe', 'Step history', 'Editor session', 'Statistics', 'Catalog info']) {
      expect(screen.getByText(label, { exact: true })).toBeTruthy();
    }
    await waitFor(() => expect(screen.getAllByText(/KB|B$/).length).toBeGreaterThan(0));
    const gen = screen.getByRole('switch', { name: /generation/i });
    expect(gen.getAttribute('aria-disabled')).toBe('true');
  });
  it.each([true, false])('exports annotations according to their switch (%s)', async (include) => {
    vi.mocked(downloadJSON).mockClear();
    const state = mount();
    state.annotations = { items: [{ kind: 'chip', id: 'garden', tag: 'garden', x: 2, y: 3, size: 'm', color: '#B4D8A2' }], visible: false, locked: true };
    const { unmount } = render(<ExportJsonModal />, { wrapper: W });
    const toggle = screen.getByRole('switch', { name: 'Planning annotations' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    if (!include) fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('button', { name: /export/i }));
    await waitFor(() => expect(downloadJSON).toHaveBeenCalledOnce());
    const saved = JSON.parse(vi.mocked(downloadJSON).mock.calls[0]![0]);
    expect(saved.annotations).toEqual(include ? state.annotations : undefined);
    expect(state.annotations.items).toHaveLength(1);
    unmount();
    vi.mocked(downloadJSON).mockClear();
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
