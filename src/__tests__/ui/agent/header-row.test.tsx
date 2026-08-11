/**
 * HeaderRow (Site Log) — reset disabled on an empty log, the expanding region
 * button, the model dropdown (rows from the store's modelList + setModel), and
 * the start-fresh confirm flow.
 *
 * './atoms' is mocked (parallel work on the shared atoms must never block or
 * restyle these assertions); i18n keys not yet authored render as raw keys, so
 * assertions use the key strings.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { I18nProvider } from '../../../i18n/context';
import { useAgentStore } from '../../../agent/store';
import { HeaderRow } from '../../../ui/agent/HeaderRow';

vi.mock('../../../ui/agent/atoms', () => ({
  prettyModel: (id: string) => id,
  GBtn: ({ label, onClick }: { label: string; onClick: () => void }) => (
    <button type="button" onClick={onClick}>{label}</button>
  ),
  CaretDownIcon: () => <span data-testid="ico-caret" />,
  GearIcon: () => <span data-testid="ico-gear" />,
  RestartIcon: () => <span data-testid="ico-restart" />,
  RegionFrameIcon: () => <span data-testid="ico-frame" />,
  HoverTip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  CARD_LINE: '#eee2cf',
}));

// Deterministic storage for the settings persistence the store performs.
const backing = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
});

function Wrapper({ children }: { children: React.ReactNode }) {
  return <I18nProvider>{children}</I18nProvider>;
}

const noop = () => {};

function renderRow(over: Partial<React.ComponentProps<typeof HeaderRow>> = {}) {
  return render(
    <HeaderRow
      top={0}
      regionCells={0}
      onRegionToggle={noop}
      onSetup={noop}
      onReset={noop}
      canReset={false}
      {...over}
    />,
    { wrapper: Wrapper },
  );
}

describe('HeaderRow', () => {
  beforeEach(() => {
    backing.clear();
    useAgentStore.setState((s) => ({
      settings: { ...s.settings, provider: 'claude', model: { ...s.settings.model, claude: 'claude-opus-4-8' } },
      modelList: {},
    }));
  });

  it('renders start fresh always, disabled on an empty log', () => {
    renderRow({ canReset: false });
    const btn = screen.getByLabelText('Start fresh') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.disabled).toBe(true);
    // disabled tap never opens the confirm
    fireEvent.click(btn);
    expect(screen.queryByText('Start fresh?')).toBeNull();
  });

  it('enables start fresh when the log has entries', () => {
    renderRow({ canReset: true });
    expect((screen.getByLabelText('Start fresh') as HTMLButtonElement).disabled).toBe(false);
  });

  it('region button shows the live cell count when a region is active', () => {
    renderRow({ regionCells: 42 });
    // missing i18n keys render raw, so the count line is the raw key
    expect(screen.getByText('42 cells')).toBeTruthy();
    const btn = screen.getByLabelText('Select a region');
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });

  it('region button stays a plain square with no region', () => {
    renderRow({ regionCells: 0 });
    expect(screen.queryByText('42 cells')).toBeNull();
    expect(screen.getByLabelText('Select a region').getAttribute('aria-pressed')).toBe('false');
  });

  it('dropdown lists the store model list and setModel fires on pick', () => {
    useAgentStore.getState().setModelList('claude', ['model-alpha', 'model-beta']);
    renderRow();
    fireEvent.click(screen.getByTitle('Model')); // the model pill (t('agent.model'))
    // rows show friendly name + mono id (prettyModel mocked to identity)
    expect(screen.getAllByText('model-alpha').length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByText('model-beta')[0]!);
    expect(useAgentStore.getState().settings.model.claude).toBe('model-beta');
    // picking closes the dropdown
    expect(screen.queryByText('Change platform…')).toBeNull();
  });

  it('dropdown lists NO placeholder models without a live fetch, and offers Change platform… → onSetup', () => {
    const onSetup = vi.fn();
    renderRow({ onSetup }); // modelList empty (no successful fetch)
    fireEvent.click(screen.getByTitle('Model'));
    // no invented fallback models appear
    expect(screen.queryByText('claude-sonnet-4-6')).toBeNull();
    fireEvent.click(screen.getByText('Change platform…'));
    expect(onSetup).toHaveBeenCalledTimes(1);
  });

  it('custom model id row commits on Enter', () => {
    renderRow();
    fireEvent.click(screen.getByTitle('Model'));
    const input = screen.getByPlaceholderText('custom-model-id…') as HTMLInputElement;
    input.value = 'my-custom-model';
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(useAgentStore.getState().settings.model.claude).toBe('my-custom-model');
  });

  it('confirm flow: reset opens the card, Clear calls onReset, Keep dismisses', () => {
    const onReset = vi.fn();
    renderRow({ canReset: true, onReset });
    fireEvent.click(screen.getByLabelText('Start fresh'));
    expect(screen.getByText('Start fresh?')).toBeTruthy();
    expect(screen.getByText('The map keeps everything built. Only this conversation is cleared.')).toBeTruthy();
    // Keep first: dismisses without clearing
    fireEvent.click(screen.getByText('Keep'));
    expect(onReset).not.toHaveBeenCalled();
    expect(screen.queryByText('Start fresh?')).toBeNull();
    // now Clear
    fireEvent.click(screen.getByLabelText('Start fresh'));
    fireEvent.click(screen.getByText('Clear'));
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Start fresh?')).toBeNull();
  });
});
