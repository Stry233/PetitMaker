// @vitest-environment jsdom
/** Setup interactions with injected model discovery and no live provider requests. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, act, screen } from '@testing-library/react';
import { useEditorStore } from '../../../../state/store';
import { translations } from '../../../_support/locale-tables';
import { SetupScreen, type ListModels } from '../../../../ui/agent/connection/SetupScreen';
import { stepSlide } from '../../../../ui/agent/connection/setup-parts';
import { keyDestination, readKeyShape } from '../../../../agent/connection/key-grammar';
import { framerMotion, seconds } from '../../../../ui/design/motion';
import { runnerSettings, useAgentConnection } from '../../../../agent/connection/store';
import { forgetRosters } from '../../../../agent/connection/model-roster';
import { PROVIDER_IDS, PROVIDER_META, type ProviderId } from '../../../../agent/providers/defaults';
import { renderWithI18n } from '../../../_support/agent-panel';

const backing = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
};

const emptyModels = () =>
  Object.fromEntries(PROVIDER_IDS.map((id) => [id, ''])) as Record<ProviderId, string>;

/** A key of each shape, so a test never spells one inline and drifts from `readKeyShape`. */
const KEY = {
  claude: 'sk-ant-api03-abcdefghijkl',
  ambiguous: 'sk-9f2c0123456789abcdef0123456789ab',
  unknown: 'my-gateway-token-2f8a91',
};

const IDLE = 900;

beforeEach(async () => {
  backing.clear();
  forgetRosters();
  useEditorStore.setState({ locale: 'en' });
  useAgentConnection.setState({
    provider: 'claude', model: emptyModels(), oversight: 'checkpoint',
    customBaseUrl: '', keyed: [], providerPinned: false, hydrated: true,
  });
  // The keyring is a module global no component can select from, so it is cleared through the store's verb.
  for (const id of PROVIDER_IDS) useAgentConnection.getState().forgetKey(id);
  useAgentConnection.setState({ provider: 'claude', providerPinned: false });
  backing.clear();
  await useAgentConnection.getState().hydrate();
});

afterEach(() => { vi.useRealTimers(); });


const phaseOf = () => screen.queryByTestId('manage-screen') ? 'manage' : screen.getByTestId('setup-screen').getAttribute('data-phase');
const pickDefault = () => {
  fireEvent.click(screen.getByTestId('manage-model-dd'));
  fireEvent.click(screen.getAllByRole('menuitemradio')[0]!);
};
const noteText = () => screen.queryByTestId('setup-note')?.textContent ?? null;
const rowFace = () => screen.getByTestId('setup-prov-face');

describe('readKeyShape', () => {
  it('tells the three non-answers apart from a name', () => {
    expect(readKeyShape('')).toBe('empty');
    expect(readKeyShape('sk-')).toBe('partial');
    expect(readKeyShape('sk-9f2c0123')).toBe('partial');
    expect(readKeyShape(KEY.ambiguous)).toBe('ambiguous');
    expect(readKeyShape(KEY.claude)).toBe('claude');
    expect(readKeyShape('sk-or-v1-abcdef123456')).toBe('openrouter');
    expect(readKeyShape(KEY.unknown)).toBe('unknown');
  });
});

describe('local provider identification', () => {
  it.each([
    ['claude', KEY.claude],
    ['openai', 'sk-proj-abcdefghijklmnop'],
    ['openai', 'sk-svcacct-abcdefghijklmnop'],
    ['openrouter', 'sk-or-v1-abcdefghijklmnop'],
    ['gemini', 'AIzaSyD-abcdefghijklmnopqrst'],
    ['perplexity', 'pplx-abcdefghijklmnop'],
  ] as const)('automatically checks a distinctive %s key only with its provider', async (provider, key) => {
    vi.useFakeTimers();
    const listModels = vi.fn(() => Promise.resolve(['model']));
    renderWithI18n(<SetupScreen listModels={listModels} />);
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: key } });
    expect(rowFace().getAttribute('data-provider')).toBe(provider);
    expect(listModels).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(IDLE); });
    expect(listModels).toHaveBeenCalledExactlyOnceWith({ provider, apiKey: key });
    expect(phaseOf()).toBe('manage');
  });

  it('reuses a saved ambiguous key and its chosen regional endpoint', async () => {
    vi.useFakeTimers();
    const state = useAgentConnection.getState();
    state.setProviderRegion('qwen', 1);
    state.connectKey('qwen', KEY.ambiguous);
    state.setProvider('claude');
    const listModels = vi.fn(() => Promise.resolve(['model']));
    renderWithI18n(<SetupScreen listModels={listModels} />);
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.ambiguous } });
    expect(rowFace().getAttribute('data-provider')).toBe('qwen');
    await act(async () => { vi.advanceTimersByTime(IDLE); });
    expect(listModels).toHaveBeenCalledExactlyOnceWith({ provider: 'qwen', apiKey: KEY.ambiguous, region: 1 });
  });

  it('asks before routing a distinctive key saved for both a provider and a gateway', async () => {
    vi.useFakeTimers();
    const state = useAgentConnection.getState();
    state.connectKey('claude', KEY.claude);
    state.setCustomBaseUrl('https://gateway.example/v1');
    state.connectKey('custom', KEY.claude);
    state.setProvider('openai');
    const listModels = vi.fn(() => Promise.resolve(['model']));
    renderWithI18n(<SetupScreen listModels={listModels} />);
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.claude } });
    await act(async () => { vi.advanceTimersByTime(IDLE); });
    expect(screen.getAllByRole('menuitemradio').length).toBeGreaterThan(1);
    expect(rowFace().getAttribute('data-provider')).toBeNull();
    expect(listModels).not.toHaveBeenCalled();
  });

  it('keeps a detected regional provider visible while waiting for the region', async () => {
    vi.useFakeTimers();
    const key = '0123456789abcdef0123456789abcdef.AbCdEfGh12345678';
    const listModels = vi.fn(() => Promise.resolve(['model']));
    renderWithI18n(<SetupScreen listModels={listModels} />);
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: key } });
    await act(async () => { vi.advanceTimersByTime(IDLE); });
    expect(rowFace().getAttribute('data-provider')).toBe('zhipu');
    expect(noteText()).toBe(translations.en['agent.setup_note_region']!.replace('{name}', PROVIDER_META.zhipu.name));
    expect(screen.getAllByRole('menuitemradio').slice(0, 2).every(item => item.textContent?.includes(PROVIDER_META.zhipu.name))).toBe(true);
    expect(listModels).not.toHaveBeenCalled();
  });

  it('requires a region when management selects a keyless regional provider', async () => {
    vi.useFakeTimers();
    useAgentConnection.getState().pinProvider('moonshot');
    const listModels = vi.fn(() => Promise.resolve(['model']));
    renderWithI18n(<SetupScreen listModels={listModels} />);
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.unknown } });
    await act(async () => { vi.advanceTimersByTime(IDLE); });
    expect(rowFace().getAttribute('data-provider')).toBe('moonshot');
    expect(listModels).not.toHaveBeenCalled();
    const choice = screen.getAllByRole('menuitemradio').find(item => item.textContent?.includes(PROVIDER_META.moonshot.name)
      && item.textContent.includes(translations.en['agent.endpoint_cn']!));
    await act(async () => { fireEvent.click(choice!); });
    expect(listModels).toHaveBeenCalledExactlyOnceWith({ provider: 'moonshot', apiKey: KEY.unknown, region: 1 });
  });

  it('lets automatic detection replace a manual provider choice without sending to the old provider', async () => {
    vi.useFakeTimers();
    useAgentConnection.getState().pinProvider('openai');
    const listModels = vi.fn(() => Promise.resolve(['model']));
    renderWithI18n(<SetupScreen listModels={listModels} />);
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.claude } });
    fireEvent.click(screen.getByTestId('setup-prov-row'));
    fireEvent.click(screen.getByText(translations.en['agent.setup_detect_automatically']!));
    expect(rowFace().getAttribute('data-provider')).toBe('claude');
    await act(async () => { vi.advanceTimersByTime(IDLE); });
    expect(listModels).toHaveBeenCalledExactlyOnceWith({ provider: 'claude', apiKey: KEY.claude });
  });

  it('releases a manual choice when leaving setup so the next entry can detect another provider', async () => {
    const listModels = vi.fn(() => Promise.resolve(['model']));
    const view = renderWithI18n(<SetupScreen listModels={listModels} onLeave={() => {}} />);
    fireEvent.click(screen.getByTestId('setup-prov-row'));
    fireEvent.click(screen.getByText(PROVIDER_META.openai.name));
    fireEvent.click(screen.getByTestId('setup-leave'));
    expect(useAgentConnection.getState().providerPinned).toBe(false);
    view.unmount();
    renderWithI18n(<SetupScreen listModels={listModels} />);
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.claude } });
    expect(rowFace().getAttribute('data-provider')).toBe('claude');
    expect(listModels).not.toHaveBeenCalled();
  });

  it('releases a manual provider choice after a completed setup', async () => {
    const listModels = vi.fn(() => Promise.resolve(['model']));
    useAgentConnection.getState().pinProvider('deepseek');
    renderWithI18n(<SetupScreen listModels={listModels} />);
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.ambiguous } });
    await act(async () => { fireEvent.keyDown(screen.getByTestId('setup-key-input'), { key: 'Enter' }); });
    expect(phaseOf()).toBe('manage');
    expect(useAgentConnection.getState().providerPinned).toBe(false);
    expect(useAgentConnection.getState().provider).toBe('deepseek');
  });

  it('ignores a late authentication refusal after leaving the key check', async () => {
    let refuse!: (error: Error) => void;
    const listModels = vi.fn(() => new Promise<string[]>((_resolve, reject) => { refuse = reject; }));
    const view = renderWithI18n(<SetupScreen listModels={listModels} />);
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.claude } });
    await act(async () => { fireEvent.keyDown(screen.getByTestId('setup-key-input'), { key: 'Enter' }); });
    view.unmount();
    useAgentConnection.getState().connectKey('claude', `${KEY.claude}-replacement`);
    await act(async () => { refuse(Object.assign(new Error('Unauthorized'), { status: 401 })); });
    expect(runnerSettings(useAgentConnection.getState()).apiKey).toBe(`${KEY.claude}-replacement`);
  });
});

/** Where a key in the field goes: the one table both the idle gate and Enter read. */
describe('keyDestination', () => {
  const dest = (over: Partial<Parameters<typeof keyDestination>[0]>) => keyDestination({
    shape: 'claude', usable: true, endpointFiled: false, explicit: false, ...over,
  });

  it('sends each shape one place, and the quiet and the press differ only where nothing can be read', () => {
    expect(dest({ shape: 'claude' })).toBe('commit');
    expect(dest({ shape: 'ambiguous' })).toBe('ask');
    expect(dest({ shape: 'unknown' })).toBe('ask');
    expect(dest({ shape: 'empty', usable: false })).toBe(null);
    expect(dest({ shape: 'partial' })).toBe(null);
    expect(dest({ shape: 'partial', explicit: true })).toBe('ask');
    expect(dest({ shape: 'claude', usable: false })).toBe(null);
    expect(dest({ shape: 'claude', usable: false, explicit: true })).toBe('commit');
  });

  /** A pinned `custom` with no endpoint filed goes to the address step, not to a check no request
   *  could carry. */
  it('asks the user\'s own server for its address before it reads a key against it', () => {
    expect(dest({ shape: 'custom', endpointFiled: false })).toBe('endpoint');
    expect(dest({ shape: 'custom', endpointFiled: false, explicit: true })).toBe('endpoint');
    expect(dest({ shape: 'custom', endpointFiled: true })).toBe('commit');
  });
});

describe('the key masks when the field rests, and reveals on focus', () => {
  it('rests masked once it holds a value, and reveals again on focus', () => {
    renderWithI18n(<SetupScreen />);
    const input = screen.getByTestId('setup-key-input') as HTMLInputElement;
    // Focus first: a value arriving in an unfocused field masks at once (tested below).
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: KEY.claude } });
    expect(input.type).toBe('text');

    fireEvent.blur(input);
    expect(input.type).toBe('password');

    fireEvent.focus(input);
    expect(input.type).toBe('text');
  });

  /** A password manager filling an unfocused field fires `onChange` with no focus or blur, so the
   *  mask cannot wait for a blur. */
  it('masks a value that arrives without the field ever being focused', () => {
    renderWithI18n(<SetupScreen />);
    const input = screen.getByTestId('setup-key-input') as HTMLInputElement;
    expect(document.activeElement, 'the field must be unfocused for this to mean anything')
      .not.toBe(input);
    fireEvent.change(input, { target: { value: KEY.claude } });
    expect(input.type).toBe('password');
    expect(input.value).toBe(KEY.claude);
  });

  it('never masks an empty field', () => {
    renderWithI18n(<SetupScreen />);
    const input = screen.getByTestId('setup-key-input') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(input.type).toBe('text');
  });

  it('leaves typing and pasting alone: the type stays text while the field is focused', () => {
    renderWithI18n(<SetupScreen />);
    const input = screen.getByTestId('setup-key-input') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: KEY.claude } });
    expect(input.type).toBe('text');
    expect(input.value).toBe(KEY.claude);
    // A paste is the same change event to React.
    fireEvent.change(input, { target: { value: `${KEY.claude}-pasted` } });
    expect(input.value).toBe(`${KEY.claude}-pasted`);
    expect(input.type).toBe('text');
  });
});

describe('the field never leaves while the hands are moving', () => {
  it('holds a fully-typed Anthropic key until 900ms of quiet, and a keystroke at 800ms resets it', async () => {
    vi.useFakeTimers();
    const listModels = vi.fn(() => Promise.resolve(['claude-sonnet-4-5']));
    renderWithI18n(<SetupScreen listModels={listModels} />);

    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.claude } });
    // The row shows the reading at once while the step waits.
    expect(rowFace().getAttribute('data-provider')).toBe('claude');
    expect(phaseOf()).toBe('key');

    await act(async () => { vi.advanceTimersByTime(IDLE - 100); });
    expect(phaseOf(), 'still short of the quiet').toBe('key');

    // A keystroke with 100ms to go restarts the gate.
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: `${KEY.claude}x` } });
    await act(async () => { vi.advanceTimersByTime(IDLE - 100); });
    expect(phaseOf(), 'the keystroke reset the quiet').toBe('key');
    expect(listModels).not.toHaveBeenCalled();

    await act(async () => { vi.advanceTimersByTime(200); });
    expect(phaseOf()).toBe('manage');
    expect(useAgentConnection.getState().keyed).toContain('claude');
  });

  it('lets Enter release it at once', async () => {
    const listModels = vi.fn(() => Promise.resolve(['claude-sonnet-4-5']));
    renderWithI18n(<SetupScreen listModels={listModels} />);
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.claude } });
    await act(async () => { fireEvent.keyDown(screen.getByTestId('setup-key-input'), { key: 'Enter' }); });
    expect(phaseOf()).toBe('manage');
    expect(listModels).toHaveBeenCalledWith({ provider: 'claude', apiKey: KEY.claude });
  });
  it('[ASST-02] keeps ambiguous credentials local until an explicit provider selection', async () => {
 vi.useFakeTimers(); const listModels = vi.fn((_cfg: { provider: ProviderId; apiKey: string; region?: 0 | 1 }) => Promise.resolve(['m']));
 renderWithI18n(<SetupScreen listModels={listModels} />);
 fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.ambiguous } });
 await act(async () => { vi.advanceTimersByTime(IDLE * 5); });
 expect(listModels).not.toHaveBeenCalled();
 expect(useAgentConnection.getState().keyed).toEqual([]);
 expect(screen.getByTestId('setup-prov-row').getAttribute('aria-expanded')).toBe('true');
 await act(async () => { fireEvent.click(screen.getByText(PROVIDER_META.deepseek.name)); });
 expect(listModels).toHaveBeenCalledExactlyOnceWith({ provider: 'deepseek', apiKey: KEY.ambiguous });
});

  it('keeps the WHOLE key in the field and opens the row for a shape nobody claims', async () => {
    vi.useFakeTimers();
    renderWithI18n(<SetupScreen />);
    const input = screen.getByTestId('setup-key-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: KEY.unknown } });
    expect(noteText()).toBe(translations.en['agent.setup_note_unknown']);

    await act(async () => { vi.advanceTimersByTime(IDLE + 50); });
    // The field node is not replaced, so the key stays whole, and the row opens.
    expect((screen.getByTestId('setup-key-input') as HTMLInputElement).value).toBe(KEY.unknown);
    expect(screen.getByTestId('setup-prov-row').getAttribute('aria-expanded')).toBe('true');
    expect(phaseOf()).toBe('key');
  });

  it('stops the gate at Back until the key changes again', async () => {
    vi.useFakeTimers();
    const listModels = vi.fn(() => Promise.resolve(['claude-sonnet-4-5']));
    renderWithI18n(<SetupScreen listModels={listModels} />);
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.claude } });

    // Back on the waiting step means "I am still editing".
    fireEvent.click(screen.getByTestId('setup-act-reenter'));
    await act(async () => { vi.advanceTimersByTime(IDLE * 3); });
    expect(phaseOf(), 'a re-fired gate would undo the press').toBe('key');
    expect(listModels).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: `${KEY.claude}9` } });
    await act(async () => { vi.advanceTimersByTime(IDLE + 50); });
    expect(phaseOf()).toBe('manage');
  });
});

describe('the row is the chooser, and an explicit pick outranks the shape', () => {
  /** The row is the only way to the roster; the empty field shows no second entry and no note. */
  it('offers no roster door of its own on the empty field', () => {
    renderWithI18n(<SetupScreen />);
    expect(screen.queryByTestId('setup-open-roster')).toBeNull();
    expect(noteText()).toBeNull();
  });

  it('pins the provider a press names, and a later reading does not overrule it', async () => {
    vi.useFakeTimers();
    const listModels = vi.fn(() => Promise.resolve(['gpt-5.1']));
    renderWithI18n(<SetupScreen listModels={listModels} />);

    fireEvent.click(screen.getByTestId('setup-prov-row'));
    fireEvent.click(screen.getByText(PROVIDER_META.openai.name));
    expect(useAgentConnection.getState().providerPinned).toBe(true);
    expect(useAgentConnection.getState().provider).toBe('openai');

    // An Anthropic-shaped key: the pin stands, and the note says whose pick it is.
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.claude } });
    expect(rowFace().getAttribute('data-provider')).toBe('openai');
    expect(noteText()).toBe(
      translations.en['agent.setup_note_pinned_checking']!.replace('{name}', PROVIDER_META.openai.name),
    );

    await act(async () => { vi.advanceTimersByTime(IDLE + 50); });
    expect(listModels).toHaveBeenCalledWith({ provider: 'openai', apiKey: KEY.claude });
    expect(useAgentConnection.getState().keyed).toContain('openai');
  });

  it('connects the key in hand the moment a platform is named', async () => {
    const listModels = vi.fn(() => Promise.resolve(['glm-4']));
    renderWithI18n(<SetupScreen listModels={listModels} />);
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.unknown } });
    fireEvent.click(screen.getByTestId('setup-prov-row'));
    await act(async () => { fireEvent.click(screen.getAllByText(PROVIDER_META.zhipu.name)[0]!); });

    expect(phaseOf()).toBe('manage');
    expect(screen.getByTestId('manage-prov-face').getAttribute('data-provider')).toBe('zhipu');
    expect(useAgentConnection.getState().keyed).toContain('zhipu');


  });

  /** Picking back a provider that is already keyed ends setup; pinning it alone would leave setup
   *  standing over a live key whose only way out is pasting the key again. */
  it('leaves setup when the pick is a provider already keyed, with a model filed', () => {
    const onDone = vi.fn();
    useAgentConnection.getState().connectKey('claude', KEY.claude);
    useAgentConnection.getState().setModel('claude-sonnet-4-5');
    // The keyless provider that put the screen up.
    useAgentConnection.getState().pinProvider('openai');

    renderWithI18n(<SetupScreen onDone={onDone} />);
    fireEvent.click(screen.getByTestId('setup-prov-row'));
    fireEvent.click(screen.getByText(PROVIDER_META.claude.name));

    expect(useAgentConnection.getState().provider).toBe('claude');
    expect(onDone).not.toHaveBeenCalled();
    expect(phaseOf()).toBe('manage');
  });

  it('opens management for an existing key without selecting a model', async () => {
    const onDone = vi.fn();
    const listModels = vi.fn(() => Promise.resolve(['claude-sonnet-4-5']));
    useAgentConnection.getState().connectKey('claude', KEY.claude);
    useAgentConnection.getState().pinProvider('openai');

    renderWithI18n(<SetupScreen listModels={listModels} onDone={onDone} />);
    fireEvent.click(screen.getByTestId('setup-prov-row'));
    await act(async () => { fireEvent.click(screen.getByText(PROVIDER_META.claude.name)); });

    expect(phaseOf()).toBe('manage');
    expect(listModels).toHaveBeenCalledWith({ provider: 'claude', apiKey: KEY.claude });
    expect(onDone).not.toHaveBeenCalled();
    // Done waits for a model, since none is selected on the user's behalf.
    expect((screen.getByTestId('manage-done') as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps an explicit provider and its refusal together when the key has another provider format', async () => {
    vi.useFakeTimers();
    const listModels = vi.fn(({ provider }: { provider: ProviderId; apiKey: string }) => provider === 'openai'
      ? Promise.reject(Object.assign(new Error('Unauthorized'), { status: 401 }))
      : Promise.resolve(['claude-sonnet-4-5']));
    renderWithI18n(<SetupScreen listModels={listModels} />);
    fireEvent.click(screen.getByTestId('setup-prov-row'));
    fireEvent.click(screen.getByText(PROVIDER_META.openai.name));
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.claude } });
    await act(async () => { vi.advanceTimersByTime(IDLE + 50); });
    expect(screen.getByTestId('setup-row-cross')).toBeTruthy();
    expect(rowFace().getAttribute('data-provider')).toBe('openai');
    expect(useAgentConnection.getState().providerPinned).toBe(true);
    expect(useAgentConnection.getState().provider).toBe('openai');
    await act(async () => { vi.advanceTimersByTime(IDLE * 3); });
    expect(listModels).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('setup-act-manual'));
    await act(async () => { fireEvent.click(screen.getByText(PROVIDER_META.claude.name)); });
    expect(phaseOf()).toBe('manage');
    expect(screen.queryByTestId('setup-row-cross')).toBeNull();
    expect(useAgentConnection.getState().model.claude).toBe('');
  });

  it('leaves the management mount to the parent during handoff', async () => {
    const onManage = vi.fn();
    const listModels = vi.fn(() => Promise.resolve(['claude-sonnet-4-5']));
    renderWithI18n(<SetupScreen listModels={listModels} onManage={onManage} />);
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.claude } });
    await act(async () => { fireEvent.keyDown(screen.getByTestId('setup-key-input'), { key: 'Enter' }); });
    expect(onManage).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('manage-screen')).toBeNull();
    expect(screen.getByTestId('setup-key-input')).toBeTruthy();
    expect(listModels).toHaveBeenCalledTimes(1);
  });
  it.each([0, 1] as const)('sends an ambiguous key only to the selected Qwen region %s', async region => {
 const listModels = vi.fn(() => Promise.reject(new Error('offline')));
 renderWithI18n(<SetupScreen listModels={listModels} onManage={() => {}} />);
 fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.ambiguous } });
 await act(async () => { fireEvent.keyDown(screen.getByTestId('setup-key-input'), { key: 'Enter' }); });
 expect(listModels).not.toHaveBeenCalled();
 await act(async () => { fireEvent.click(screen.getAllByText(PROVIDER_META.qwen.name)[region]!); });
 expect(listModels).toHaveBeenCalledExactlyOnceWith({ provider: 'qwen', apiKey: KEY.ambiguous, ...(region === 1 ? { region: 1 } : {}) });
 expect(runnerSettings(useAgentConnection.getState()).region ?? 0).toBe(region);
});

  it('opens the endpoint field below the row from the row\'s own Custom entry', () => {
    renderWithI18n(<SetupScreen listModels={() => new Promise(() => {})} />);
    fireEvent.click(screen.getByTestId('setup-prov-row'));
    fireEvent.click(screen.getByText(translations.en['agent.setup_custom_endpoint']!));
    expect(phaseOf()).toBe('custom');

    // Save stays disabled until the address has a usable shape.
    expect((screen.getByTestId('setup-endpoint-save') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId('setup-endpoint-input'), { target: { value: 'http://localhost:11434/v1' } });
    expect((screen.getByTestId('setup-endpoint-save') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId('setup-endpoint-save'));

    expect(useAgentConnection.getState().customBaseUrl).toBe('http://localhost:11434/v1');
    expect(useAgentConnection.getState().provider).toBe('custom');
    expect(useAgentConnection.getState().providerPinned).toBe(true);
    expect(phaseOf()).toBe('checking');
  });

  it('refuses an address it cannot use, and says so in the note it already has', () => {
    renderWithI18n(<SetupScreen />);
    fireEvent.click(screen.getByTestId('setup-prov-row'));
    fireEvent.click(screen.getByText(translations.en['agent.setup_custom_endpoint']!));
    // The shape gate reads only the prefix, so an unparseable address passes it and the store refuses it.
    fireEvent.change(screen.getByTestId('setup-endpoint-input'), { target: { value: 'https://[' } });
    fireEvent.click(screen.getByTestId('setup-endpoint-save'));
    expect(useAgentConnection.getState().customBaseUrl).toBe('');
    expect(phaseOf()).toBe('custom');
    expect(screen.getByTestId('setup-endpoint-note').textContent)
      .toBe(translations.en['agent.setup_endpoint_invalid']);
  });
});

describe('the chooser outranks the check it was opened over', () => {
  it('holds the advance while the list is open, and after Back', async () => {
    vi.useFakeTimers();
    const listModels = vi.fn(() => Promise.resolve(['claude-sonnet-4-5']));
    renderWithI18n(<SetupScreen listModels={listModels} />);

    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.claude } });
    // Open the list while the shape's advance is armed.
    fireEvent.click(screen.getByTestId('setup-prov-row'));
    await act(async () => { vi.advanceTimersByTime(IDLE * 3); });
    expect(phaseOf(), 'the list is what the user is reading').toBe('key');
    expect(listModels).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: 'Escape' });
    await act(async () => { vi.advanceTimersByTime(IDLE * 3); });
    expect(phaseOf()).toBe('key');
    expect(listModels).not.toHaveBeenCalled();
    expect(useAgentConnection.getState().keyed).toEqual([]);
  });
  it('leaving an unanswered provider choice does not send or retain the key', async () => {
 const listModels = vi.fn((_cfg: { provider: ProviderId; apiKey: string; region?: 0 | 1 }) => Promise.resolve(['m']));
 renderWithI18n(<SetupScreen listModels={listModels} />);
 fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.ambiguous } });
 await act(async () => { fireEvent.keyDown(screen.getByTestId('setup-key-input'), { key: 'Enter' }); });
 fireEvent.click(screen.getByTestId('setup-act-reenter'));
 expect(listModels).not.toHaveBeenCalled(); expect(useAgentConnection.getState().keyed).toEqual([]);
});

  /** The hold is on the key that was stepped off, so a keystroke re-arms the advance. */
  it('advances again on the next keystroke', async () => {
    vi.useFakeTimers();
    const listModels = vi.fn(() => Promise.resolve(['claude-sonnet-4-5']));
    renderWithI18n(<SetupScreen listModels={listModels} />);
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.claude } });
    fireEvent.click(screen.getByTestId('setup-prov-row'));
    await act(async () => { vi.advanceTimersByTime(IDLE * 2); });
    expect(phaseOf()).toBe('key');

    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: `${KEY.claude}x` } });
    await act(async () => { vi.advanceTimersByTime(IDLE + 50); });
    expect(phaseOf()).toBe('manage');
  });
});


describe('a model answer is dropped once the user steps off its reading', () => {
  /** One resolvable/rejectable list request per provider, so the abandoned one can answer last. */
  function heldLists() {
    const held: Partial<Record<ProviderId, { resolve: (ids: string[]) => void; reject: (e: unknown) => void }>> = {};
    const listModels = vi.fn(({ provider }: { provider: ProviderId; apiKey: string }) =>
      new Promise<string[]>((resolve, reject) => { held[provider] = { resolve, reject }; }));
    return { held, listModels };
  }

  /** Walks commit(claude) → Back → pick(openai), leaving claude's list request abandoned in flight. */
  async function stepOffClaudeOntoOpenai(listModels: ListModels) {
    renderWithI18n(<SetupScreen listModels={listModels} />);
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.claude } });
    await act(async () => { fireEvent.keyDown(screen.getByTestId('setup-key-input'), { key: 'Enter' }); });
    expect(phaseOf()).toBe('checking');

    fireEvent.click(screen.getByTestId('setup-act-reenter'));
    expect(phaseOf()).toBe('key');

    fireEvent.click(screen.getByTestId('setup-prov-row'));
    await act(async () => { fireEvent.click(screen.getByText(PROVIDER_META.openai.name)); });
    expect(phaseOf()).toBe('checking');
    expect(useAgentConnection.getState().provider).toBe('openai');
  }

  it('files no default model off a list that lands after the step-off', async () => {
    const { held, listModels } = heldLists();
    await stepOffClaudeOntoOpenai(listModels);

    await act(async () => { held.claude!.resolve(['claude-sonnet-4-5']); });
    expect(useAgentConnection.getState().model.openai).toBe('');
    expect(useAgentConnection.getState().model.claude).toBe('');
  });

  it('leaves the new check standing when the abandoned reading is refused', async () => {
    const { held, listModels } = heldLists();
    await stepOffClaudeOntoOpenai(listModels);

    await act(async () => { held.claude!.reject(Object.assign(new Error('Unauthorized'), { status: 401 })); });
    expect(phaseOf()).toBe('checking');
    expect(screen.getByTestId('setup-prov-face').getAttribute('data-provider')).toBe('openai');
    expect(useAgentConnection.getState().keyed).toContain('openai');
  });
});

describe('a check that failed says so on the row it failed at', () => {
  it('asks for an ambiguous provider without reporting an authentication failure', async () => {
 renderWithI18n(<SetupScreen />);
 fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.ambiguous } });
 await act(async () => { fireEvent.keyDown(screen.getByTestId('setup-key-input'), { key: 'Enter' }); });
 expect(screen.queryByTestId('setup-row-cross')).toBeNull();
 expect(noteText()).toBe(translations.en['agent.setup_note_unknown_pick']);
 expect(useAgentConnection.getState().keyed).toEqual([]);
});


  it('keeps the custom endpoint choice free of an authentication error', async () => {
    const seen: (string | null)[] = [];
    renderWithI18n(
      <SetupScreen
        onFace={(face) => { seen.push(face?.step ?? null); }}
        listModels={() => new Promise(() => {})}
      />,
    );
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.ambiguous } });
    await act(async () => { fireEvent.keyDown(screen.getByTestId('setup-key-input'), { key: 'Enter' }); });
    expect(seen[seen.length - 1]).toBe('unknown');

    fireEvent.click(screen.getByText(translations.en['agent.setup_custom_endpoint']!));

    expect(phaseOf()).toBe('custom');
    expect(screen.queryByTestId('setup-row-cross'), 'the step the user just chose is not a failure').toBeNull();
    expect(screen.getByTestId('setup-prov-sub').textContent).toBe(translations.en['agent.setup_row_openai_compat']);
    expect(seen[seen.length - 1], 'the card describes the screen that is standing').toBe('endpoint');

    fireEvent.change(screen.getByTestId('setup-endpoint-input'), { target: { value: 'https://gateway.example/v1' } });
    fireEvent.click(screen.getByTestId('setup-endpoint-save'));

    expect(phaseOf()).toBe('checking');
    expect(screen.queryByTestId('setup-row-cross')).toBeNull();
    expect(screen.getByTestId('setup-prov-face').getAttribute('data-provider')).toBe('custom');
    expect(screen.getByTestId('setup-prov-sub').textContent).toBe(translations.en['agent.setup_row_pinned_checking']);
    expect(seen[seen.length - 1]).not.toBe('no-answer');
  });
  it('requires a region choice even for the distinctive Zhipu key format', async () => {
 const listModels = vi.fn((_cfg: { provider: ProviderId; apiKey: string; region?: 0 | 1 }) => Promise.resolve(['m']));
 renderWithI18n(<SetupScreen listModels={listModels} />);
 fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: '0123456789abcdef0123456789abcdef.AbCdEfGh12345678' } });
 await act(async () => { fireEvent.keyDown(screen.getByTestId('setup-key-input'), { key: 'Enter' }); });
 expect(listModels).not.toHaveBeenCalled();
 await act(async () => {
   fireEvent.click(screen.getAllByRole('menuitemradio').find(item => item.textContent?.includes(PROVIDER_META.zhipu.name)
     && item.textContent.includes(translations.en['agent.endpoint_cn']!))!);
 });
 expect(listModels.mock.calls[0]![0]).toMatchObject({ provider: 'zhipu', region: 1 });
 expect(listModels).toHaveBeenCalledTimes(1);
});

  /** A refused key is not an unavailable list: the model list is the key's first request, and routing
   *  a refusal to "type a model id" would leave a panel that claims to be connected. */
  it('sends a refused key back to the field, un-filed, in danger, with the row crossed', async () => {
    const refusal = Object.assign(new Error('Unauthorized'), { status: 401 });
    renderWithI18n(<SetupScreen listModels={() => Promise.reject(refusal)} />);
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.claude } });
    await act(async () => { fireEvent.keyDown(screen.getByTestId('setup-key-input'), { key: 'Enter' }); });

    expect(phaseOf()).toBe('key');
    expect(screen.getByTestId('setup-key-field').getAttribute('data-danger')).toBe('true');
    expect(screen.getByTestId('setup-row-cross')).toBeTruthy();
    expect(screen.getByTestId('setup-prov-sub').textContent)
      .toBe(translations.en['agent.setup_row_refused']);
    expect(noteText()).toBe(translations.en['agent.setup_key_refused']);
    expect(screen.queryByTestId('setup-models-unavailable')).toBeNull();
    expect(useAgentConnection.getState().keyed).toEqual([]);

    // Editing the field clears the warning.
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: `${KEY.claude}z` } });
    expect(screen.getByTestId('setup-key-field').getAttribute('data-danger')).toBeNull();
    expect(noteText()).not.toBe(translations.en['agent.setup_key_refused']);
  });

  it('routes a connection with no model and no list coming to the settings card', async () => {
    const onManage = vi.fn();
    renderWithI18n(
      <SetupScreen
        listModels={() => Promise.reject(Object.assign(new Error('teapot'), { status: 418 }))}
        onManage={onManage}
      />,
    );
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.claude } });
    await act(async () => { fireEvent.keyDown(screen.getByTestId('setup-key-input'), { key: 'Enter' }); });
    expect(phaseOf()).toBe('manage');
    expect(onManage).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('setup-models-unavailable')).toBeNull();
    expect(screen.queryByTestId('setup-need-model')).toBeNull();
    expect(screen.queryByTestId('setup-model-input')).toBeNull();
    expect(screen.queryByTestId('setup-done')).toBeNull();
  });
});

describe('model selection on the management page', () => {
  async function toManage(listModels: () => Promise<string[]>) {
    renderWithI18n(<SetupScreen listModels={listModels} />);
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.claude } });
    await act(async () => { fireEvent.keyDown(screen.getByTestId('setup-key-input'), { key: 'Enter' }); });
  }

  it('offers the default as an unselected list entry and waits for an explicit choice', async () => {
    await toManage(() => Promise.resolve(['claude-sonnet-4-5', 'claude-opus-4-1']));
    expect(phaseOf()).toBe('manage');
    expect(screen.queryByTestId('setup-screen')).toBeNull();
    expect(useAgentConnection.getState().model.claude).toBe('');
    expect((screen.getByTestId('manage-done') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('manage-model-dd'));
    const entries = screen.getAllByRole('menuitemradio');
    expect(entries[0]!.textContent).toContain('Default model (Claude Sonnet 4.5)');
    expect(entries.every((entry) => entry.getAttribute('aria-checked') === 'false')).toBe(true);
    fireEvent.click(entries[1]!);
    expect(useAgentConnection.getState().model.claude).toBe('claude-opus-4-1');
    expect((screen.getByTestId('manage-done') as HTMLButtonElement).disabled).toBe(false);
  });

  /** A model filed in a past session is the user's own pick and outranks the list. */
  it('leaves a model already filed for the provider exactly where it was', async () => {
    useAgentConnection.getState().setModel('claude-haiku-4-5');
    await toManage(() => Promise.resolve(['claude-sonnet-4-5', 'claude-opus-4-1']));
    expect(useAgentConnection.getState().model.claude).toBe('claude-haiku-4-5');
  });

  it('reads an empty list as no list at all, and routes to the card that takes a typed id', async () => {
    const onManage = vi.fn();
    renderWithI18n(
      <SetupScreen listModels={() => Promise.resolve([])} onManage={onManage} />,
    );
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.claude } });
    await act(async () => { fireEvent.keyDown(screen.getByTestId('setup-key-input'), { key: 'Enter' }); });
    expect(useAgentConnection.getState().model.claude).toBe('');
    expect(onManage).toHaveBeenCalledTimes(1);
  });

  it('leaves on Done, with the key filed and the provider armed', async () => {
    const onDone = vi.fn();
    renderWithI18n(
      <SetupScreen listModels={() => Promise.resolve(['claude-sonnet-4-5'])} onDone={onDone} />,
    );
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.claude } });
    await act(async () => { fireEvent.keyDown(screen.getByTestId('setup-key-input'), { key: 'Enter' }); });
    pickDefault();
    fireEvent.click(screen.getByTestId('manage-done'));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(useAgentConnection.getState().keyed).toContain('claude');
  });
});

/** The screen reports its step upward, since setup stands over a session that has not begun; the
 *  dock owns how each step looks (`DeskHeader`). */
describe('the step the screen reports upward', () => {
  const faces = () => {
    const seen: (string | null)[] = [];
    const onFace = vi.fn((face: { step: string } | null) => { seen.push(face?.step ?? null); });
    return { onFace, seen, last: () => seen[seen.length - 1] ?? null };
  };

  /** The first step reports awake: asleep belongs to a desk with no screen open. */
  it('says it is awake at the mouth, where the screen is standing and asking', () => {
    const f = faces();
    renderWithI18n(<SetupScreen onFace={f.onFace} />);
    expect(f.last()).toBe('awake');
  });

  it('reports key validation until management takes over', async () => {
    const f = faces();
    let settle: (ids: string[]) => void = () => {};
    const listModels = () => new Promise<string[]>((resolve) => { settle = resolve; });
    renderWithI18n(<SetupScreen listModels={listModels} onFace={f.onFace} />);

    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: 'sk-' } });
    expect(f.last()).toBe('typing');

    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.claude } });
    expect(f.last()).toBe('shaped');
    expect(f.onFace.mock.calls[f.onFace.mock.calls.length - 1]![0])
      .toEqual({ step: 'shaped', name: PROVIDER_META.claude.name });

    await act(async () => { fireEvent.keyDown(screen.getByTestId('setup-key-input'), { key: 'Enter' }); });
    expect(f.last()).toBe('shaped');

    // Management owns the desk once discovery settles, without implying a model was selected.
    await act(async () => { settle(['claude-sonnet-4-5']); });
    expect(f.onFace.mock.calls[f.onFace.mock.calls.length - 1]![0])
      .toBeNull();
  });

  it('says the ambiguity once it is being asked, the shape nobody claims, and each dead end', async () => {
    const f = faces();
    vi.useFakeTimers();
    const view = renderWithI18n(
      <SetupScreen onFace={f.onFace} />,
    );
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.ambiguous } });
    // During the idle gate the key is still being read.
    expect(f.last()).toBe('typing');
    await act(async () => { vi.advanceTimersByTime(IDLE + 50); });
    expect(f.last()).toBe('unknown');
    vi.useRealTimers();
    view.unmount();

    const unknown = faces();
    const asked = renderWithI18n(<SetupScreen onFace={unknown.onFace} />);
    vi.useFakeTimers();
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.unknown } });
    await act(async () => { vi.advanceTimersByTime(IDLE + 50); });
    expect(unknown.last(), 'the quiet opened the row, which is the question').toBe('unknown');
    vi.useRealTimers();
    asked.unmount();

    const failed = faces();
    renderWithI18n(
      <SetupScreen
        onFace={failed.onFace}
      />,
    );
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.ambiguous } });
    await act(async () => { fireEvent.keyDown(screen.getByTestId('setup-key-input'), { key: 'Enter' }); });
    expect(failed.last()).toBe('unknown');
  });

  it('says a refusal, so the card above the field stops looking calm', async () => {
    const f = faces();
    const refusal = Object.assign(new Error('Unauthorized'), { status: 401 });
    renderWithI18n(
      <SetupScreen listModels={() => Promise.reject(refusal)} onFace={f.onFace} />,
    );
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.claude } });
    await act(async () => { fireEvent.keyDown(screen.getByTestId('setup-key-input'), { key: 'Enter' }); });
    expect(f.last()).toBe('refused');
  });

  it('says the endpoint step with the host it is pointed at', () => {
    const f = faces();
    renderWithI18n(<SetupScreen onFace={f.onFace} />);
    fireEvent.click(screen.getByTestId('setup-prov-row'));
    fireEvent.click(screen.getByText(translations.en['agent.setup_custom_endpoint']!));
    fireEvent.change(screen.getByTestId('setup-endpoint-input'), { target: { value: 'http://localhost:11434/v1' } });
    expect(f.onFace.mock.calls[f.onFace.mock.calls.length - 1]![0])
      .toEqual({ step: 'endpoint', name: 'localhost:11434' });
  });

  /** Discovery failures hand off to management without a separate setup status. */
  it('reports no dead step for the list that would not load', async () => {
    const noList = faces();
    const onManage = vi.fn();
    renderWithI18n(
      <SetupScreen
        listModels={() => Promise.reject(Object.assign(new Error('teapot'), { status: 418 }))}
        onFace={noList.onFace}
        onManage={onManage}
      />,
    );
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.claude } });
    await act(async () => { fireEvent.keyDown(screen.getByTestId('setup-key-input'), { key: 'Enter' }); });
    expect(noList.last()).toBeNull();
    expect(onManage).toHaveBeenCalledTimes(1);
  });
});

describe('one leave verb per screen', () => {
  /** Every step the screen can stand in, and how to reach it. */
  it('draws exactly one, on every step', async () => {
    const steps: [string, () => Promise<void> | void][] = [
      ['mouth', () => {}],
      ['reading', () => {
        fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.claude } });
      }],
      ['provider-choice', async () => {
        fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.ambiguous } });
        await act(async () => { fireEvent.keyDown(screen.getByTestId('setup-key-input'), { key: 'Enter' }); });
      }],
      ['custom', () => {
        fireEvent.click(screen.getByTestId('setup-prov-row'));
        fireEvent.click(screen.getByText(translations.en['agent.setup_custom_endpoint']!));
      }],
    ];

    for (const [name, drive] of steps) {
      const view = renderWithI18n(
        <SetupScreen
          onLeave={() => {}}
        />,
      );
      await drive();
      const leaves = [
        ...screen.queryAllByTestId('setup-leave'),
        ...screen.queryAllByTestId('setup-act-reenter'),
      ];
      expect(leaves, name).toHaveLength(1);
      view.unmount();
    }
  });

  it('presses the caller\'s own way back, and draws nothing without one', () => {
    const left = vi.fn();
    const withLeave = renderWithI18n(<SetupScreen onLeave={left} />);
    fireEvent.click(screen.getByTestId('setup-leave'));
    expect(left).toHaveBeenCalledTimes(1);
    withLeave.unmount();

    renderWithI18n(<SetupScreen />);
    expect(screen.queryByTestId('setup-leave')).toBeNull();
  });

  /** The screen is entered from the keyless rest, so a prior step always exists and the verb is Back,
   *  never a decline such as "Not now". */
  it('says Back wherever it stands, never a decline', async () => {
    const steps: [string, () => Promise<void> | void][] = [
      ['mouth', () => {}],
      ['provider-choice', async () => {
        fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.ambiguous } });
        await act(async () => { fireEvent.keyDown(screen.getByTestId('setup-key-input'), { key: 'Enter' }); });
      }],
    ];
    for (const [name, drive] of steps) {
      const view = renderWithI18n(
        <SetupScreen
          onLeave={() => {}}
        />,
      );
      await drive();
      expect((screen.queryByTestId('setup-leave') ?? screen.getByTestId('setup-act-reenter')).textContent, name)
        .toBe(translations.en['agent.setup_back']);
      view.unmount();
    }
  });

  /** Every step draws Back as the same footer ghost button; the underlined text idiom is for tight
   *  spaces only. */
  it('draws Back as the footer ghost button, the same on every step that has one', async () => {
    const ghost = (el: HTMLElement) => ({
      background: el.style.background,
      color: el.style.color,
      borderRadius: el.style.borderRadius,
      fontSize: el.style.fontSize,
      fontWeight: el.style.fontWeight,
    });

    const mouth = renderWithI18n(<SetupScreen onLeave={() => {}} />);
    const atMouth = screen.getByTestId('setup-leave');
    expect(atMouth.tagName).toBe('BUTTON');
    expect(atMouth.style.textDecoration).not.toBe('underline');
    const shape = ghost(atMouth);
    expect(shape.background, 'the footer ghost brings its own fill').not.toBe('');
    mouth.unmount();

    // The waiting step's Back must match.
    vi.useFakeTimers();
    renderWithI18n(<SetupScreen listModels={() => Promise.resolve(['m'])} onLeave={() => {}} />);
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.claude } });
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(ghost(screen.getByTestId('setup-act-reenter'))).toEqual(shape);
    vi.useRealTimers();
  });

  /** A first-time visitor cannot judge oversight yet, so it defaults and lives on the manage card. */
  it('never asks for oversight, on any step', async () => {
    renderWithI18n(<SetupScreen listModels={() => Promise.resolve(['claude-sonnet-4-5'])} />);
    const segments = () => [
      translations.en['agent.oversight_strict']!,
      translations.en['agent.oversight_checkpoint']!,
      translations.en['agent.oversight_yolo']!,
    ].flatMap((label) => screen.queryAllByText(label));

    expect(segments()).toHaveLength(0);
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.claude } });
    await act(async () => { fireEvent.keyDown(screen.getByTestId('setup-key-input'), { key: 'Enter' }); });
    expect(phaseOf()).toBe('manage');
    expect(screen.getByTestId('manage-oversight-caption')).toBeTruthy();
    expect(screen.queryByTestId('setup-oversight-caption')).toBeNull();
  });
});

describe('custom providers use the same management page', () => {
  /** Confirms the custom address and starts model discovery with the current credential. */
  async function armEndpoint(): Promise<void> {
    fireEvent.click(screen.getByTestId('setup-prov-row'));
    fireEvent.click(screen.getByText(translations.en['agent.setup_custom_endpoint']!));
    fireEvent.change(screen.getByTestId('setup-endpoint-input'), { target: { value: 'http://localhost:11434/v1' } });
    await act(async () => { fireEvent.click(screen.getByTestId('setup-endpoint-save')); });
  }

  it.each(['', 'x', 'lms+opaque/token=='])('connects custom endpoints with an optional opaque key %j', async apiKey => {
    const listModels = vi.fn(() => Promise.resolve(['local-model']));
    renderWithI18n(<SetupScreen listModels={listModels} />);
    fireEvent.click(screen.getByTestId('setup-prov-row'));
    fireEvent.click(screen.getByText(translations.en['agent.setup_custom_endpoint']!));
    expect(screen.getByTestId('setup-key-input').getAttribute('placeholder')).toBe(translations.en['agent.setup_key_optional']);
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: apiKey } });
    fireEvent.change(screen.getByTestId('setup-endpoint-input'), { target: { value: 'http://localhost:1234/v1' } });
    expect(listModels).not.toHaveBeenCalled();
    await act(async () => { fireEvent.keyDown(screen.getByTestId('setup-endpoint-input'), { key: 'Enter' }); });
    expect(phaseOf()).toBe('manage');
    expect(listModels).toHaveBeenCalledExactlyOnceWith({ provider: 'custom', apiKey, customBaseUrl: 'http://localhost:1234/v1' });
    expect(useAgentConnection.getState().customAuth).toBe(apiKey ? 'key' : 'none');
    expect(screen.getByTestId('manage-forget-key').textContent).toBe(translations.en[apiKey ? 'agent.setup_manage_forget_key' : 'agent.setup_manage_disconnect']);
    pickDefault();
    expect((screen.getByTestId('manage-done') as HTMLButtonElement).disabled).toBe(false);
  });

  it.each(['', 'lms+opaque/token=='])('keeps the custom provider selected when authentication fails with %j', async apiKey => {
    const listModels = vi.fn((): Promise<string[]> => Promise.reject(Object.assign(new Error('Unauthorized'), { status: 401 })));
    renderWithI18n(<SetupScreen listModels={listModels} />);
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: apiKey } });
    await armEndpoint();
    expect(phaseOf()).toBe('key');
    expect(screen.getByTestId('setup-key-input').getAttribute('value')).toBe(apiKey);
    expect(noteText()).toBe(translations.en['agent.setup_key_refused']);
    expect(useAgentConnection.getState()).toMatchObject({ provider: 'custom', providerPinned: true, customAuth: 'key' });
    expect(listModels).toHaveBeenCalledTimes(1);
    listModels.mockResolvedValueOnce(['local-model']);
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: 'fixed/token==' } });
    await act(async () => { fireEvent.keyDown(screen.getByTestId('setup-key-input'), { key: 'Enter' }); });
    expect(phaseOf()).toBe('manage');
    expect(listModels).toHaveBeenLastCalledWith({ provider: 'custom', apiKey: 'fixed/token==', customBaseUrl: 'http://localhost:11434/v1' });
  });

  it('retries an unauthenticated connection only when the user asks after a refusal', async () => {
    const listModels = vi.fn((): Promise<string[]> => Promise.reject(Object.assign(new Error('Unauthorized'), { status: 401 })));
    renderWithI18n(<SetupScreen listModels={listModels} />);
    await armEndpoint();
    expect(phaseOf()).toBe('key');
    expect(listModels).toHaveBeenCalledTimes(1);
    listModels.mockResolvedValueOnce(['local-model']);
    await act(async () => { fireEvent.click(screen.getByTestId('setup-act-recheck')); });
    expect(phaseOf()).toBe('manage');
    expect(listModels).toHaveBeenCalledTimes(2);
    expect(listModels).toHaveBeenLastCalledWith({ provider: 'custom', apiKey: '', customBaseUrl: 'http://localhost:11434/v1' });
  });

  it('opens management without choosing the endpoint\'s first model', async () => {
    const done = vi.fn();
    const asked = vi.fn(() => Promise.resolve(['qwen2.5-coder:14b', 'llama3.2']));
    renderWithI18n(<SetupScreen listModels={asked} onDone={done} />);
    await armEndpoint();
    expect(useAgentConnection.getState().provider).toBe('custom');

    expect(phaseOf()).toBe('manage');
    expect(asked).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'custom', customBaseUrl: 'http://localhost:11434/v1',
    }));
    expect(useAgentConnection.getState().model.custom).toBe('');
    expect(screen.queryByTestId('setup-screen')).toBeNull();
    expect((screen.getByTestId('manage-done') as HTMLButtonElement).disabled).toBe(true);

    pickDefault();
    fireEvent.click(screen.getByTestId('manage-done'));
    expect(done).toHaveBeenCalledTimes(1);
  });

  /** A gateway that lists nothing has a live key and a filed address, so only the model is owed and
   *  the flow hands off to the manage card, which takes a typed id. */
  it('hands an endpoint that names nothing to the manage card', async () => {
    const done = vi.fn();
    const manage = vi.fn();
    renderWithI18n(
      <SetupScreen
        listModels={() => Promise.reject(Object.assign(new Error('teapot'), { status: 418 }))}
        onDone={done}
        onManage={manage}
      />,
    );
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.unknown } });
    await armEndpoint();

    expect(phaseOf()).toBe('manage');
    expect(screen.queryByTestId('setup-models-unavailable'), 'no unavailable-model dead end').toBeNull();
    expect(screen.queryByTestId('setup-model-note')).toBeNull();
    expect(useAgentConnection.getState().keyed).toContain('custom');
    expect(manage).toHaveBeenCalledTimes(1);
    expect(done).not.toHaveBeenCalled();
  });

  /** The usual order: paste a gateway's key no platform claims, pick the custom endpoint, then file
   *  the address, which reads the key already in the field against it. */
  it('reads the key already in the field once the address is filed', async () => {
    vi.useFakeTimers();
    const asked = vi.fn(() => Promise.resolve(['qwen2.5-coder:14b']));
    renderWithI18n(<SetupScreen listModels={asked} />);

    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.unknown } });
    // Opening the row by hand stops the idle gate for the key in the field.
    fireEvent.click(screen.getByTestId('setup-prov-row'));
    fireEvent.click(screen.getByText(translations.en['agent.setup_custom_endpoint']!));
    fireEvent.change(screen.getByTestId('setup-endpoint-input'), { target: { value: 'https://gateway.example/v1' } });
    fireEvent.click(screen.getByTestId('setup-endpoint-save'));
    expect(phaseOf()).toBe('checking');

    await act(async () => {});
    expect(phaseOf()).toBe('manage');
    expect(asked).toHaveBeenCalledWith({
      provider: 'custom', apiKey: KEY.unknown, customBaseUrl: 'https://gateway.example/v1',
    });
    expect(useAgentConnection.getState().keyed).toContain('custom');
  });

  /** Whatever a gateway answers, the flow never rests on a reading step, which has no verb and says
   *  nothing about what to do next. */
  it('lands on a step that finishes or points somewhere, for every answer a gateway gives', async () => {
    const READING = new Set(['awake', 'typing', 'shaped', 'ambiguous']);
    // A refusal returns to the key; every other failure hands off to the manage card.
    const cases: [string, () => Promise<string[]>, string][] = [
      ['lists its models', () => Promise.resolve(['llama3.2']), 'manage'],
      ['names nothing', () => Promise.resolve([]), 'manage'],
      ['is unreachable', () => Promise.reject(new Error('Failed to fetch')), 'manage'],
      ['refuses at CORS', () => Promise.reject(Object.assign(new Error('blocked'), { status: 0 })), 'manage'],
      ['refuses the key', () => Promise.reject(Object.assign(new Error('Unauthorized'), { status: 401 })), 'refused'],
    ];

    for (const [name, listModels, want] of cases) {
      const seen: (string | null)[] = [];
      const onManage = vi.fn();
      const view = renderWithI18n(
        <SetupScreen
          listModels={listModels}
          onManage={onManage}
          onFace={(face) => { seen.push(face?.step ?? null); }}
        />,
      );
      vi.useFakeTimers();
      fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.unknown } });
      fireEvent.click(screen.getByTestId('setup-prov-row'));
      fireEvent.click(screen.getByText(translations.en['agent.setup_custom_endpoint']!));
      fireEvent.change(screen.getByTestId('setup-endpoint-input'), { target: { value: 'https://gateway.example/v1' } });
      fireEvent.click(screen.getByTestId('setup-endpoint-save'));
      await act(async () => { vi.advanceTimersByTime(IDLE * 4); });
      vi.useRealTimers();
      await act(async () => {});

      const last = seen[seen.length - 1];
      if (want === 'manage') expect(onManage, name).toHaveBeenCalledTimes(1);
      else expect(last, name).toBe(want);
      expect(READING.has(last ?? ''), `${name}: the card is still saying it reads the key`).toBe(false);
      view.unmount();
      useAgentConnection.getState().forgetKey('custom');
      useAgentConnection.setState({
        customBaseUrl: '', providerPinned: false, provider: 'claude',
      });
    }
  });
});

/** The first character typed retires the line above the field, so the groups move up; they slide
 *  rather than jump, so the screen does not read as a new one under the caret. */
describe('a step change is a movement', () => {
  const template = (_v: object, generated: string) => generated;

  it('travels the groups on the declared motion, and only their position', () => {
    const slide = stepSlide(false, template);
    expect(slide.layout, 'a size tween would stretch the field and its radius').toBe('position');
    expect(slide.transition).toEqual(framerMotion('panel.setup.step'));
    // One movement with the plate's height change, so the same length.
    expect(seconds('panel.setup.step')).toBe(seconds('panel.height'));
  });

  it('takes nothing at all under reduced motion', () => {
    expect(stepSlide(true, template)).toEqual({});
  });
});

describe('the key screen points at Help', () => {
  it('opens the setup page at its key steps from Learn more', () => {
    useEditorStore.getState().setHelpTarget(null);
    renderWithI18n(<SetupScreen />);
    fireEvent.click(screen.getByRole('button', { name: translations.en['agent.learn_more'] }));
    expect(useEditorStore.getState().helpTarget).toEqual({ page: 'agent-setup', anchor: 'agsetup-keys' });
    expect(useEditorStore.getState().modals.help).toBe(true);
  });
});
