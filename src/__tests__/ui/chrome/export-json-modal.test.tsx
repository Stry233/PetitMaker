import { captureImageAttribution } from '../../../core/provenance/image-attribution';
vi.mock('../../../ui/chrome/modals/export/review/use-map-review', () => ({ useMapReview: () => ({ result: { status: 'clear' }, pending: false, previewReady: true, revision: '0', check: async () => ({ status: 'clear' }), retry: vi.fn(), cancel: vi.fn() }) }));
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ExportJsonModal } from '../../../ui/chrome/modals/export/ExportJsonModal';
import { makeState } from '../../rules/_helpers';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules';
import { I18nProvider } from '../../../i18n/context';

vi.mock('../../../io/moderation/text/reviewer', async (original) => ({
  ...await original<typeof import('../../../io/moderation/text/reviewer')>(),
  reviewText: vi.fn(async () => ({ allowed: true })),
}));

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
  it('preserves original image notes and explains each locked field', async () => {
    const state = mount();
    state.notes = { title: 'Garden', description: 'A riverside walk' };
    state.imageAttribution = captureImageAttribution(state);
    render(<ExportJsonModal />, { wrapper: W });
    expect((screen.getByLabelText('Title') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('Description') as HTMLTextAreaElement).disabled).toBe(true);
    const toggle = screen.getByRole('switch', { name: 'Notes' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(toggle.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(screen.getAllByRole('button', { name: 'Help' })[0]!);
    expect(screen.getByText(/To respect the map creator’s original work/)).toBeTruthy();
  });
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
  it('edits the map\'s own title and description, offers no author field, and writes them only while Notes is on', async () => {
    const s = mount();
    s.notes = { title: 'River garden' };
    render(<ExportJsonModal />, { wrapper: W });
    fireEvent.click(screen.getByRole('switch', { name: /notes/i }));
    expect(screen.queryByLabelText(/author/i)).toBeNull();
    const title = screen.getByLabelText('Title') as HTMLInputElement;
    expect(title.value).toBe('River garden');
    expect(title.maxLength).toBe(48);
    expect((screen.getByLabelText('Description') as HTMLTextAreaElement).maxLength).toBe(200);
    fireEvent.change(title, { target: { value: 'River garden, revised' } });
    expect(s.notes).toEqual({ title: 'River garden, revised' });
    const button = screen.getByRole('button', { name: /export/i });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false), { timeout: 3000 });
    fireEvent.click(button);
    await waitFor(() => expect(vi.mocked(downloadJSON)).toHaveBeenCalled());
    const calls = vi.mocked(downloadJSON).mock.calls;
    const json = JSON.parse(calls[calls.length - 1]![0]!);
    expect(json.notes).toEqual({ title: 'River garden, revised' });
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
