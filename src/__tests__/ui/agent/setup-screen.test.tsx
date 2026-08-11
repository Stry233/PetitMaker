/**
 * SetupScreen (Site Log) — idle shows the 9-provider roster + key field; valid
 * shows the config reveal (Start building + the Oversight 3-segment control
 * reflecting/updating the setting); a notice renders the incident card instead
 * of the connect content.
 *
 * './atoms' is mocked so the parallel atoms work never blocks these tests;
 * i18n keys not yet authored render as raw keys, so assertions use key strings.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { I18nProvider } from '../../../i18n/context';
import { useAgentStore } from '../../../agent/store';
import { PROVIDER_IDS } from '../../../agent/providers/defaults';
import { SetupScreen } from '../../../ui/agent/SetupScreen';
import type { ProviderSettings } from '../../../ui/agent/useProviderSettings';

vi.mock('../../../ui/agent/atoms', () => ({
  prettyModel: (id: string) => id,
  GoArrowIcon: () => <span data-testid="ico-go" />,
  CheckIcon: () => <span data-testid="ico-check" />,
  CaretDownIcon: () => <span data-testid="ico-caret" />,
  HoverTip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  pulseProps: () => ({ animate: { opacity: 1 } }),
  OK_GREEN: '#4CA42A',
  REVERT_AMBER: '#E0A32E',
  CARD_LINE: '#eee2cf',
  FIELD_DEEP: '#E8E1D2',
}));

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

const makePs = (over: Partial<ProviderSettings> = {}): ProviderSettings => ({
  keyDraft: '',
  setKeyDraft: vi.fn(),
  detecting: false,
  chooserOpen: false,
  setChooserOpen: vi.fn(),
  saveKey: vi.fn(async () => {}),
  commitKey: vi.fn(),
  refreshModels: vi.fn(async () => {}),
  skipDetection: vi.fn(),
  ...over,
});

function renderSetup(over: Partial<React.ComponentProps<typeof SetupScreen>> = {}) {
  return render(
    <SetupScreen
      top={0}
      height={1000}
      ps={makePs()}
      notice={null}
      onClearNotice={() => {}}
      onStartBuilding={() => {}}
      {...over}
    />,
    { wrapper: Wrapper },
  );
}

describe('SetupScreen', () => {
  beforeEach(() => {
    backing.clear();
    useAgentStore.setState((s) => ({
      settings: {
        ...s.settings,
        provider: 'claude',
        keys: {},
        oversight: 'checkpoint',
        askBeforeEdits: false,
        model: { ...s.settings.model, claude: 'claude-opus-4-8' },
      },
      modelList: {},
    }));
  });

  it('idle: masks all but the last 4 of the draft live, and reconstructs the real key on edit', () => {
    const setKeyDraft = vi.fn();
    const ps = makePs({ keyDraft: 'sk-ant-abcdefgh', setKeyDraft });
    renderSetup({ ps });
    const field = screen.getByPlaceholderText('Paste your API key') as HTMLInputElement;
    // last 4 visible, everything before dotted (dot run scales with length)
    expect(field.value).toBe('•'.repeat(11) + 'efgh');
    // appending to the display rebuilds the REAL key (no dots leak into the value)
    fireEvent.change(field, { target: { value: '•'.repeat(11) + 'efghZ' } });
    expect(setKeyDraft).toHaveBeenCalledWith('sk-ant-abcdefghZ');
  });

  it('idle: shows the key field and all 9 roster cards; platform cards link out, custom selects', () => {
    renderSetup();
    expect(screen.getByPlaceholderText('Paste your API key')).toBeTruthy();
    for (const id of PROVIDER_IDS) expect(screen.getByTestId(`roster-${id}`)).toBeTruthy();
    expect(PROVIDER_IDS).toHaveLength(9);
    // platform cards are OUTBOUND LINKS to the key-generation page (auto-detect owns selection)
    const gemini = screen.getByTestId('roster-gemini');
    expect(gemini.tagName).toBe('A');
    expect(gemini.getAttribute('href')).toContain('aistudio.google.com');
    expect(gemini.getAttribute('target')).toBe('_blank');
    // custom has no page — it stays a button that selects itself
    const custom = screen.getByTestId('roster-custom');
    expect(custom.tagName).toBe('BUTTON');
    fireEvent.click(custom);
    expect(useAgentStore.getState().settings.provider).toBe('custom');
  });

  it('idle: the accent connect slot fires ps.saveKey', () => {
    const ps = makePs({ keyDraft: 'sk-something' });
    renderSetup({ ps });
    fireEvent.click(screen.getByLabelText('Connect'));
    expect(ps.saveKey).toHaveBeenCalled();
  });

  it('valid: shows Start building; the oversight segment reflects and updates the setting', () => {
    useAgentStore.getState().setKey('claude', 'sk-ant-test-key');
    const onStartBuilding = vi.fn();
    renderSetup({ onStartBuilding });
    // config reveal present, roster gone
    expect(screen.getByText('Start building')).toBeTruthy();
    expect(screen.queryByTestId('roster-claude')).toBeNull();
    // oversight seg reflects the stored setting…
    expect(screen.getByText('Checkpoint').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Strict').getAttribute('aria-pressed')).toBe('false');
    // …and updates it (plus the askBeforeEdits back-compat mirror)
    fireEvent.click(screen.getByText('Strict'));
    expect(useAgentStore.getState().settings.oversight).toBe('strict');
    expect(useAgentStore.getState().settings.askBeforeEdits).toBe(true);
    expect(screen.getByText('Strict').getAttribute('aria-pressed')).toBe('true');
    // Start building exits back to the log
    fireEvent.click(screen.getByText('Start building'));
    expect(onStartBuilding).toHaveBeenCalledTimes(1);
  });

  it('valid: Start building is disabled until a real model is selected (no fake default)', () => {
    useAgentStore.getState().setKey('claude', 'sk-ant-test-key');
    useAgentStore.setState((s) => ({ settings: { ...s.settings, model: { ...s.settings.model, claude: '' } } }));
    const onStartBuilding = vi.fn();
    renderSetup({ onStartBuilding });
    const btn = screen.getByText('Start building').closest('button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(onStartBuilding).not.toHaveBeenCalled();
    // the model selector shows a two-row placeholder rather than a fake model id
    expect(screen.getByText('No model selected')).toBeTruthy();
    expect(screen.getByText('tap to choose or enter one')).toBeTruthy();
  });

  it('valid: Start building stays disabled for a Custom provider with no endpoint URL, even with a typed model', () => {
    useAgentStore.setState((s) => ({
      settings: {
        ...s.settings,
        provider: 'custom',
        keys: { custom: 'sk-x' },
        model: { ...s.settings.model, custom: 'my-typed-model' },
        customBaseUrl: undefined,
      },
    }));
    const onStartBuilding = vi.fn();
    renderSetup({ onStartBuilding });
    const btn = screen.getByText('Start building').closest('button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(onStartBuilding).not.toHaveBeenCalled();
  });

  it('valid: key shows masked with last 4; recheck fires saveKey + refreshModels', async () => {
    useAgentStore.getState().setKey('claude', 'sk-ant-test-key');
    const ps = makePs();
    renderSetup({ ps });
    // masked display keeps the last 4 characters visible (dot run scales with length)
    const field = screen.getByLabelText('API Key') as HTMLInputElement;
    expect(field.value).toBe('•'.repeat(11) + '-key');
    expect(field.disabled).toBe(false);
    // the check slot re-checks the current key (re-detect, then refresh models)
    fireEvent.click(screen.getByLabelText('Recheck the key'));
    expect(ps.saveKey).toHaveBeenCalledWith(false, 'sk-ant-test-key');
    await Promise.resolve();
    expect(ps.refreshModels).toHaveBeenCalled();
  });

  it('valid: editing the masked field rebuilds the real key in place (no leak, no wipe) and rechecks it', () => {
    useAgentStore.getState().setKey('claude', 'sk-ant-test-key');
    const ps = makePs();
    renderSetup({ ps });
    const field = screen.getByLabelText('API Key') as HTMLInputElement;
    // append '2' to the visible tail: the real key is rebuilt as key+2, and the
    // display still masks all but the last 4 of the edited key
    fireEvent.change(field, { target: { value: '•'.repeat(11) + '-key2' } });
    expect(field.value).toBe('•'.repeat(12) + 'key2');
    // Enter rechecks the rebuilt real key
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(ps.saveKey).toHaveBeenCalledWith(false, 'sk-ant-test-key2');
  });

  it('valid: clearing the masked field forgets the key and returns to the greeting', async () => {
    useAgentStore.getState().setKey('claude', 'sk-ant-test-key');
    renderSetup();
    const field = screen.getByLabelText('API Key') as HTMLInputElement;
    fireEvent.change(field, { target: { value: '' } });
    expect(useAgentStore.getState().settings.keys.claude ?? '').toBe('');
    // back on the greeting page (async: the configured screen slides out first)
    expect(await screen.findByTestId('roster-claude')).toBeTruthy();
  });

  it('valid: locked endpoint for a known platform; model dropdown picks via setModel', () => {
    useAgentStore.getState().setKey('claude', 'sk-ant-test-key');
    useAgentStore.getState().setModelList('claude', ['model-alpha', 'model-beta']);
    renderSetup();
    // locked endpoint row carries the platform URL
    expect(screen.getByDisplayValue('https://api.anthropic.com')).toBeTruthy();
    // open the model menu, pick a row
    fireEvent.click(screen.getByLabelText('Model'));
    fireEvent.click(screen.getAllByText('model-beta')[0]!);
    expect(useAgentStore.getState().settings.model.claude).toBe('model-beta');
  });

  it('detecting: masked field + skipDetection slot', () => {
    const ps = makePs({ detecting: true });
    renderSetup({ ps });
    expect(screen.getByText('Connecting')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Choose provider manually')); // t('agent.choose_manually')
    expect(ps.skipDetection).toHaveBeenCalled();
  });

  it('pick (change platform): grid commits the key under the chosen provider', () => {
    const ps = makePs({ chooserOpen: true, keyDraft: 'sk-ambiguous' });
    renderSetup({ ps });
    // reworded as the manual platform switcher
    expect(screen.getByText('Change platform')).toBeTruthy();
    fireEvent.click(screen.getByText('DeepSeek'));
    expect(ps.commitKey).toHaveBeenCalledWith('deepseek', 'sk-ambiguous', false);
  });

  it('pick (change platform): the key field is editable and rechecks the fixed key (leaving to the detected or Custom platform)', () => {
    const setKeyDraft = vi.fn();
    const ps = makePs({ chooserOpen: true, keyDraft: 'sk-typ', setKeyDraft });
    renderSetup({ ps });
    const field = screen.getByLabelText('API Key') as HTMLInputElement;
    expect(field.readOnly).toBe(false);
    // editing reconstructs the real key (masked live), and the recheck slot re-detects it
    fireEvent.change(field, { target: { value: 'sk-typo' } });
    expect(setKeyDraft).toHaveBeenCalledWith('sk-typo');
    fireEvent.click(screen.getByLabelText('Recheck the key'));
    expect(ps.saveKey).toHaveBeenCalledWith(false);
  });

  it('valid: tapping the connection card opens the platform chooser seeded with the current key', () => {
    useAgentStore.getState().setKey('claude', 'sk-ant-test-key');
    const setKeyDraft = vi.fn();
    const setChooserOpen = vi.fn();
    const ps = makePs({ setKeyDraft, setChooserOpen });
    renderSetup({ ps });
    fireEvent.click(screen.getByRole('button', { name: 'Change platform' })); // the card
    expect(setKeyDraft).toHaveBeenCalledWith('sk-ant-test-key');
    expect(setChooserOpen).toHaveBeenCalledWith(true);
  });

  it('incident: a notice renders the error card instead of the connect content', () => {
    useAgentStore.getState().setKey('claude', 'sk-ant-test-key');
    const onClearNotice = vi.fn();
    renderSetup({ notice: 'invalid_key', onClearNotice });
    expect(screen.getByText('That key was refused')).toBeTruthy();
    expect(screen.queryByText('Start building')).toBeNull();
    fireEvent.click(screen.getByText('Re-enter key'));
    expect(onClearNotice).toHaveBeenCalledTimes(1);
  });

  it('incident: rate limited offers Retry now', () => {
    const onClearNotice = vi.fn();
    renderSetup({ notice: 'rate_limited', onClearNotice });
    expect(screen.getByText('Taking a short break')).toBeTruthy();
    fireEvent.click(screen.getByText('Retry now'));
    expect(onClearNotice).toHaveBeenCalledTimes(1);
  });
});
