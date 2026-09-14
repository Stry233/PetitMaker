/**
 * setup.test.tsx — the panel with no key in it, at the B-below shape.
 *
 * ONE FIELD AND ONE ROW, and the two of them are the whole screen: there is no Connect button, so
 * what this file mostly tests is TIMING and what the row SAYS. The idle gate is the piece nothing
 * else can prove — a screen that advanced while characters were still arriving swapped the field node
 * out from under the hands and truncated the key at whatever had landed — so it is driven on fake
 * timers, and the keystroke-at-800ms case is the CONTRACT: a character landing with 100ms to go must
 * buy the whole 900 again. (What makes that hold is the gate effect's own deps, since the callback
 * it arms closes over the draft. There is nothing here to catch a same-value input event, because
 * React drops one before it ever reaches `onChange`.)
 *
 * Renders through `I18nProvider` under `MotionConfig reducedMotion="always"` (the wrapper every
 * other panel suite uses, for the same reason: jsdom has no Web Animations API and this file only
 * needs the screen to mount quietly), with a Map-backed `localStorage` stub the settings slice's
 * persistence can write into.
 *
 * THE NETWORK IS NEVER TOUCHED. `probe` and `listModels` are both injected props, so what is under
 * test is the screen's own decision-making: what the key's format says, what the screen does while a
 * probe is out, what it does when nothing answers, and what a refusal does to the field.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, act, screen } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { I18nProvider } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { translations } from '../../../i18n/translations';
import { SetupScreen, withModelsDeadline, type ListModels } from '../../../ui/agent/SetupScreen';
import { classify } from '../../../agent/core/errors';
import { keyDestination, readKeyShape, stepSlide } from '../../../ui/agent/setup-parts';
import { framerMotion, seconds } from '../../../ui/agent/motion';
import { useAgentPanelSettings } from '../../../ui/agent/settings';
import { forgetRosters } from '../../../ui/agent/model-roster';
import { PROVIDER_IDS, PROVIDER_META, type ProviderId } from '../../../agent/providers/defaults';
import type { Locale } from '../../../core/model/types';

const backing = new Map<string, string>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).localStorage = {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
};

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="always">
      <I18nProvider>{children}</I18nProvider>
    </MotionConfig>
  );
}

function renderWithI18n(node: React.ReactElement) {
  return render(node, { wrapper: Wrapper });
}

const emptyModels = () =>
  Object.fromEntries(PROVIDER_IDS.map((id) => [id, ''])) as Record<ProviderId, string>;

/** A key of each shape, so a test never spells one inline and drifts from `readKeyShape`. */
const KEY = {
  claude: 'sk-ant-api03-abcdefghijkl',
  ambiguous: 'sk-9f2c0123456789abcdef0123456789ab',
  unknown: 'my-gateway-token-2f8a91',
};

const IDLE = 900;

beforeEach(() => {
  backing.clear();
  forgetRosters();
  useEditorStore.setState({ locale: 'en' });
  useAgentPanelSettings.setState({
    provider: 'claude', model: emptyModels(), oversight: 'checkpoint',
    customBaseUrl: '', endpointDown: '', formerModel: '', keyed: [], providerPinned: false, hydrated: true,
  });
  // The keyring is a MODULE global (deliberately, so no component can select a secret) and no test
  // may inherit another's key: clearing it through the store's own verb is the only way in.
  for (const id of PROVIDER_IDS) useAgentPanelSettings.getState().forgetKey(id);
  useAgentPanelSettings.setState({ provider: 'claude', providerPinned: false });
  backing.clear();
});

afterEach(() => { vi.useRealTimers(); });

/** A probe that never settles, for the state a screen holds WHILE it is waiting. */
const pendingProbe = () => new Promise<ProviderId | null>(() => {});

const phaseOf = () => screen.queryByTestId('manage-screen') ? 'manage' : screen.getByTestId('setup-screen').getAttribute('data-phase');
const pickDefault = () => {
  fireEvent.click(screen.getByTestId('manage-model-dd'));
  fireEvent.click(screen.getAllByRole('menuitemradio')[0]!);
};
const noteText = () => screen.queryByTestId('setup-note')?.textContent ?? null;
const rowFace = () => screen.getByTestId('setup-prov-face');

/* ── the shape reading, on its own ─────────────────────────── */

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

/**
 * WHERE A KEY IN THE FIELD IS OWED TO GO, as the one table the quiet and the press both read. Written
 * twice, the two drift: one branch tests a pin the other cannot see, and the shape it tests
 * for cannot occur while that pin stands.
 */
describe('keyDestination', () => {
  const dest = (over: Partial<Parameters<typeof keyDestination>[0]>) => keyDestination({
    shape: 'claude', usable: true, endpointFiled: false, explicit: false, ...over,
  });

  it('sends each shape one place, and the quiet and the press differ only where nothing can be read', () => {
    expect(dest({ shape: 'claude' })).toBe('commit');
    expect(dest({ shape: 'ambiguous' })).toBe('probe');
    expect(dest({ shape: 'unknown' })).toBe('ask');
    expect(dest({ shape: 'empty', usable: false })).toBe(null);
    expect(dest({ shape: 'partial' })).toBe(null);
    expect(dest({ shape: 'partial', explicit: true })).toBe('ask');
    expect(dest({ shape: 'claude', usable: false })).toBe(null);
    expect(dest({ shape: 'claude', usable: false, explicit: true })).toBe('commit');
  });

  /** A PIN IS NOT AN ADDRESS. `custom` reaches this table as a standing pick, and the key in the
   *  field is read AGAINST an endpoint: with none filed the destination is the address, not a check
   *  no request could carry. */
  it('asks the user\'s own server for its address before it reads a key against it', () => {
    expect(dest({ shape: 'custom', endpointFiled: false })).toBe('endpoint');
    expect(dest({ shape: 'custom', endpointFiled: false, explicit: true })).toBe('endpoint');
    expect(dest({ shape: 'custom', endpointFiled: true })).toBe('commit');
  });
});

/* ── the key masks at rest, and reveals on focus ─────────────── */

/** API keys mask at rest and reveal on focus on both entry and verification screens. */
describe('the key masks when the field rests, and reveals on focus', () => {
  it('rests masked once it holds a value, and reveals again on focus', () => {
    renderWithI18n(<SetupScreen probe={pendingProbe} />);
    const input = screen.getByTestId('setup-key-input') as HTMLInputElement;
    // TYPED, so the focus comes first: a value arriving into an UNFOCUSED field is the password
    // manager's shape and masks on arrival (its own test below).
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: KEY.claude } });
    expect(input.type).toBe('text');

    fireEvent.blur(input);
    expect(input.type).toBe('password');

    fireEvent.focus(input);
    expect(input.type).toBe('text');
  });

  /**
   * A VALUE CAN ARRIVE WITH NO FOCUS CYCLE. The mask moved on focus and blur only, and a password
   * manager (or any extension) filling an UNFOCUSED empty field reaches `onChange` and neither — so
   * the key stood on screen in plain text, unattended, until something happened to touch the field.
   */
  it('masks a value that arrives without the field ever being focused', () => {
    renderWithI18n(<SetupScreen probe={pendingProbe} />);
    const input = screen.getByTestId('setup-key-input') as HTMLInputElement;
    expect(document.activeElement, 'the field must be unfocused for this to mean anything')
      .not.toBe(input);
    fireEvent.change(input, { target: { value: KEY.claude } });
    expect(input.type).toBe('password');
    expect(input.value).toBe(KEY.claude);
  });

  it('never masks an empty field', () => {
    renderWithI18n(<SetupScreen probe={pendingProbe} />);
    const input = screen.getByTestId('setup-key-input') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(input.type).toBe('text');
  });

  it('leaves typing and pasting alone: the type stays text while the field is focused', () => {
    renderWithI18n(<SetupScreen probe={pendingProbe} />);
    const input = screen.getByTestId('setup-key-input') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: KEY.claude } });
    expect(input.type).toBe('text');
    expect(input.value).toBe(KEY.claude);
    // A paste is the same change event React sees, so the value lands whole.
    fireEvent.change(input, { target: { value: `${KEY.claude}-pasted` } });
    expect(input.value).toBe(`${KEY.claude}-pasted`);
    expect(input.type).toBe('text');
  });
});

/* ── the model list's own deadline ─────────────────────────── */

/**
 * THE KEY'S FIRST REQUEST IS THE ONE THAT CAN HANG. An endpoint that accepts the connection and then
 * says nothing leaves it pending with no error and no end, and the step it is made from has one word
 * ("Reading the key") and no verb: the wait ending by itself is what turns that into a face the user
 * can act on. The bound is the key probe's own ceiling, and the wording is classified `network` so a
 * silent endpoint reads like every other connection that stopped carrying anything.
 */
describe('a request for the model list ends by itself', () => {
  it('gives up at the deadline, aborts what it was waiting on, and reads as a network fault', async () => {
    vi.useFakeTimers();
    let handed: AbortSignal | undefined;
    const waiting = withModelsDeadline<string[]>((signal) => {
      handed = signal;
      return new Promise<string[]>(() => {});
    }, 8000);
    const outcome = waiting.then(() => 'answered').catch((err: unknown) => err);

    await act(async () => { vi.advanceTimersByTime(7999); });
    expect(handed?.aborted, 'the request stands while the deadline has not passed').toBe(false);

    await act(async () => { vi.advanceTimersByTime(2); });
    const err = await outcome;
    expect(err).toBeInstanceOf(Error);
    expect(handed?.aborted, 'a late answer is worth nothing, so the request goes').toBe(true);
    expect(classify({ message: (err as Error).message }).cls).toBe('network');
  });

  it('hands back the list an endpoint does answer, and leaves no clock behind', async () => {
    vi.useFakeTimers();
    const ids = await withModelsDeadline(() => Promise.resolve(['llama3.2']));
    expect(ids).toEqual(['llama3.2']);
    expect(vi.getTimerCount(), 'the deadline is cleared by the answer').toBe(0);
  });
});

/* ── the idle gate ─────────────────────────────────────────── */

describe('the field never leaves while the hands are moving', () => {
  it('holds a fully-typed Anthropic key until 900ms of quiet, and a keystroke at 800ms resets it', async () => {
    vi.useFakeTimers();
    const listModels = vi.fn(() => Promise.resolve(['claude-sonnet-4-5']));
    renderWithI18n(<SetupScreen probe={pendingProbe} listModels={listModels} />);

    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.claude } });
    // The row already SAYS the reading, which is the point of B-below: the screen answers without
    // moving.
    expect(rowFace().getAttribute('data-provider')).toBe('claude');
    expect(phaseOf()).toBe('key');

    await act(async () => { vi.advanceTimersByTime(IDLE - 100); });
    expect(phaseOf(), 'still short of the quiet').toBe('key');

    // A keystroke lands with 100ms to go: the gate starts over rather than firing on schedule.
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: `${KEY.claude}x` } });
    await act(async () => { vi.advanceTimersByTime(IDLE - 100); });
    expect(phaseOf(), 'the keystroke reset the quiet').toBe('key');
    expect(listModels).not.toHaveBeenCalled();

    await act(async () => { vi.advanceTimersByTime(200); });
    expect(phaseOf()).toBe('manage');
    expect(useAgentPanelSettings.getState().keyed).toContain('claude');
  });

  it('lets Enter release it at once', async () => {
    const listModels = vi.fn(() => Promise.resolve(['claude-sonnet-4-5']));
    renderWithI18n(<SetupScreen probe={pendingProbe} listModels={listModels} />);
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.claude } });
    await act(async () => { fireEvent.keyDown(screen.getByTestId('setup-key-input'), { key: 'Enter' }); });
    expect(phaseOf()).toBe('manage');
    expect(listModels).toHaveBeenCalledWith({ provider: 'claude', apiKey: KEY.claude });
  });

  it('sends a bare sk-hex key to the probe rather than to a guess', async () => {
    vi.useFakeTimers();
    const probe = vi.fn(pendingProbe);
    renderWithI18n(<SetupScreen probe={probe} candidates={['deepseek', 'openai']} />);
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.ambiguous } });
    // THE QUIET HAS NOT ASKED ANYBODY YET, and the screen's words wait with it: the shape's two
    // candidates stand named, in what the screen is about to do rather than in what it is doing.
    expect(noteText()).toBe(translations.en['agent3.setup_note_ambiguous_wait']);
    expect(screen.getByTestId('setup-prov-sub').textContent).toBe(translations.en['agent3.setup_row_sofar']);

    await act(async () => { vi.advanceTimersByTime(IDLE + 50); });
    expect(probe).toHaveBeenCalledTimes(1);
    // While the probe is out the row spins and the field's own mark says the same thing once.
    expect(noteText()).toBe(translations.en['agent3.setup_note_ambiguous']);
    expect(screen.getByTestId('setup-prov-sub').textContent).toBe(translations.en['agent3.setup_row_asking']);
    expect(phaseOf()).toBe('key');
  });

  it('keeps the WHOLE key in the field and opens the row for a shape nobody claims', async () => {
    vi.useFakeTimers();
    renderWithI18n(<SetupScreen probe={pendingProbe} />);
    const input = screen.getByTestId('setup-key-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: KEY.unknown } });
    expect(noteText()).toBe(translations.en['agent3.setup_note_unknown']);

    await act(async () => { vi.advanceTimersByTime(IDLE + 50); });
    // THE BAIL MUST NOT REPLACE THE FIELD NODE, which cuts the key at its twelfth character. The
    // field stands, whole, and the row is what opened.
    expect((screen.getByTestId('setup-key-input') as HTMLInputElement).value).toBe(KEY.unknown);
    expect(screen.getByTestId('setup-prov-row').getAttribute('aria-expanded')).toBe('true');
    expect(phaseOf()).toBe('key');
  });

  it('stops the gate at Back until the key changes again', async () => {
    vi.useFakeTimers();
    const listModels = vi.fn(() => Promise.resolve(['claude-sonnet-4-5']));
    renderWithI18n(<SetupScreen probe={pendingProbe} listModels={listModels} />);
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.claude } });

    // The waiting step carries Back, and pressing it means "I am still editing".
    fireEvent.click(screen.getByTestId('setup-act-reenter'));
    await act(async () => { vi.advanceTimersByTime(IDLE * 3); });
    expect(phaseOf(), 'a re-fired gate would undo the press').toBe('key');
    expect(listModels).not.toHaveBeenCalled();

    // Editing the field arms it again.
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: `${KEY.claude}9` } });
    await act(async () => { vi.advanceTimersByTime(IDLE + 50); });
    expect(phaseOf()).toBe('manage');
  });
});

/* ── the row as the manual override ────────────────────────── */

describe('the row is the chooser, and an explicit pick outranks the shape', () => {
  /** THE ROW IS THE ONLY DOOR TO THE ROSTER. The empty field stands quiet under it: no second
   *  entry point below the note, and no line of prose standing in the note's own place. */
  it('offers no roster door of its own on the empty field', () => {
    renderWithI18n(<SetupScreen />);
    expect(screen.queryByTestId('setup-open-roster')).toBeNull();
    expect(noteText()).toBeNull();
  });

  it('pins the provider a press names, and a later reading does not overrule it', async () => {
    vi.useFakeTimers();
    const listModels = vi.fn(() => Promise.resolve(['gpt-5.1']));
    renderWithI18n(<SetupScreen probe={pendingProbe} listModels={listModels} />);

    fireEvent.click(screen.getByTestId('setup-prov-row'));
    fireEvent.click(screen.getByText(PROVIDER_META.openai.name));
    expect(useAgentPanelSettings.getState().providerPinned).toBe(true);
    expect(useAgentPanelSettings.getState().provider).toBe('openai');

    // An ANTHROPIC-shaped key now: the pin stands, and the row says whose pick it is.
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.claude } });
    expect(rowFace().getAttribute('data-provider')).toBe('openai');
    expect(noteText()).toBe(
      translations.en['agent3.setup_note_pinned_checking']!.replace('{name}', PROVIDER_META.openai.name),
    );

    await act(async () => { vi.advanceTimersByTime(IDLE + 50); });
    expect(listModels).toHaveBeenCalledWith({ provider: 'openai', apiKey: KEY.claude });
    expect(useAgentPanelSettings.getState().keyed).toContain('openai');
  });

  it('connects the key in hand the moment a platform is named', async () => {
    const listModels = vi.fn(() => Promise.resolve(['glm-4']));
    renderWithI18n(<SetupScreen probe={pendingProbe} listModels={listModels} />);
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.unknown } });
    fireEvent.click(screen.getByTestId('setup-prov-row'));
    await act(async () => { fireEvent.click(screen.getByText(PROVIDER_META.zhipu.name)); });

    expect(phaseOf()).toBe('manage');
    expect(screen.getByTestId('manage-prov-face').getAttribute('data-provider')).toBe('zhipu');
    expect(useAgentPanelSettings.getState().keyed).toContain('zhipu');


  });

  /**
   * PICKING A PROVIDER THAT IS ALREADY CONNECTED IS THE END OF SETUP, NOT THE START OF IT.
   *
   * The trap it avoids: connected on one provider, the manage row picks a keyless one, the panel
   * drops to setup — and picking the first one BACK leaves the screen standing over a live key with
   * no way out. There is no draft to commit, so a pick that merely pins and returns strands the
   * user on a deliberately gearless surface whose only door is pasting the key again.
   */
  it('leaves setup when the pick is a provider already keyed, with a model filed', () => {
    const onDone = vi.fn();
    useAgentPanelSettings.getState().connectKey('claude', KEY.claude);
    useAgentPanelSettings.getState().setModel('claude-sonnet-4-5');
    // The keyless provider the user tried, which is what put the screen up.
    useAgentPanelSettings.getState().pinProvider('openai');

    renderWithI18n(<SetupScreen probe={pendingProbe} onDone={onDone} />);
    fireEvent.click(screen.getByTestId('setup-prov-row'));
    fireEvent.click(screen.getByText(PROVIDER_META.claude.name));

    expect(useAgentPanelSettings.getState().provider).toBe('claude');
    expect(onDone).not.toHaveBeenCalled();
    expect(phaseOf()).toBe('manage');
  });

  it('opens management for an existing key without selecting a model', async () => {
    const onDone = vi.fn();
    const listModels = vi.fn(() => Promise.resolve(['claude-sonnet-4-5']));
    useAgentPanelSettings.getState().connectKey('claude', KEY.claude);
    useAgentPanelSettings.getState().pinProvider('openai');

    renderWithI18n(<SetupScreen probe={pendingProbe} listModels={listModels} onDone={onDone} />);
    fireEvent.click(screen.getByTestId('setup-prov-row'));
    await act(async () => { fireEvent.click(screen.getByText(PROVIDER_META.claude.name)); });

    expect(phaseOf()).toBe('manage');
    expect(listModels).toHaveBeenCalledWith({ provider: 'claude', apiKey: KEY.claude });
    expect(onDone).not.toHaveBeenCalled();
    // AND THE WAY OUT IS LIVE. A step whose only control refuses is the strand this branch exists to
    // avoid: the key is filed, the provider is armed, and nothing else is owed.
    expect((screen.getByTestId('manage-done') as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps an explicit provider and its refusal together when the key has another provider format', async () => {
    vi.useFakeTimers();
    const probe = vi.fn(pendingProbe);
    const listModels = vi.fn(({ provider }: { provider: ProviderId; apiKey: string }) => provider === 'openai'
      ? Promise.reject(Object.assign(new Error('Unauthorized'), { status: 401 }))
      : Promise.resolve(['claude-sonnet-4-5']));
    renderWithI18n(<SetupScreen probe={probe} listModels={listModels} />);
    fireEvent.click(screen.getByTestId('setup-prov-row'));
    fireEvent.click(screen.getByText(PROVIDER_META.openai.name));
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.claude } });
    await act(async () => { vi.advanceTimersByTime(IDLE + 50); });
    expect(screen.getByTestId('setup-row-cross')).toBeTruthy();
    expect(rowFace().getAttribute('data-provider')).toBe('openai');
    expect(useAgentPanelSettings.getState().providerPinned).toBe(true);
    expect(useAgentPanelSettings.getState().provider).toBe('openai');
    await act(async () => { vi.advanceTimersByTime(IDLE * 3); });
    expect(listModels).toHaveBeenCalledTimes(1);
    expect(probe).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('setup-act-manual'));
    await act(async () => { fireEvent.click(screen.getByText(PROVIDER_META.claude.name)); });
    expect(phaseOf()).toBe('manage');
    expect(screen.queryByTestId('setup-row-cross')).toBeNull();
    expect(useAgentPanelSettings.getState().model.claude).toBe('');
  });

  it('leaves the management mount to the parent during handoff', async () => {
    const onManage = vi.fn();
    const listModels = vi.fn(() => Promise.resolve(['claude-sonnet-4-5']));
    renderWithI18n(<SetupScreen probe={pendingProbe} listModels={listModels} onManage={onManage} />);
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.claude } });
    await act(async () => { fireEvent.keyDown(screen.getByTestId('setup-key-input'), { key: 'Enter' }); });
    expect(onManage).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('manage-screen')).toBeNull();
    expect(screen.getByTestId('setup-key-input')).toBeTruthy();
    expect(listModels).toHaveBeenCalledTimes(1);
  });

  it('names the two candidates on their own entries when the shape fits two', () => {
    renderWithI18n(<SetupScreen probe={pendingProbe} />);
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.ambiguous } });
    fireEvent.click(screen.getByTestId('setup-prov-row'));
    expect(screen.getByText(translations.en['agent3.setup_fits_this_key']!)).toBeTruthy();
    expect(screen.getByText(translations.en['agent3.setup_gateway_fits']!)).toBeTruthy();
  });

  it('opens the endpoint field below the row from the row\'s own Custom entry', () => {
    renderWithI18n(<SetupScreen probe={pendingProbe} />);
    fireEvent.click(screen.getByTestId('setup-prov-row'));
    fireEvent.click(screen.getByText(translations.en['agent3.setup_custom_endpoint']!));
    expect(phaseOf()).toBe('custom');

    // The advancing control is GATED until the address is one the app could reach.
    expect((screen.getByTestId('setup-endpoint-save') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId('setup-endpoint-input'), { target: { value: 'http://localhost:11434/v1' } });
    expect((screen.getByTestId('setup-endpoint-save') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId('setup-endpoint-save'));

    expect(useAgentPanelSettings.getState().customBaseUrl).toBe('http://localhost:11434/v1');
    expect(useAgentPanelSettings.getState().provider).toBe('custom');
    expect(useAgentPanelSettings.getState().providerPinned).toBe(true);
    expect(phaseOf()).toBe('key');
  });

  it('refuses an address it cannot use, and says so in the note it already has', () => {
    renderWithI18n(<SetupScreen probe={pendingProbe} />);
    fireEvent.click(screen.getByTestId('setup-prov-row'));
    fireEvent.click(screen.getByText(translations.en['agent3.setup_custom_endpoint']!));
    // Sanitization is the store's; the shape gate only reads the prefix, so an address that LOOKS
    // like one and cannot be parsed passes the gate and is refused by the verb.
    fireEvent.change(screen.getByTestId('setup-endpoint-input'), { target: { value: 'https://[' } });
    fireEvent.click(screen.getByTestId('setup-endpoint-save'));
    expect(useAgentPanelSettings.getState().customBaseUrl).toBe('');
    expect(phaseOf()).toBe('custom');
    expect(screen.getByTestId('setup-endpoint-note').textContent)
      .toBe(translations.en['agent3.setup_endpoint_invalid']);
  });
});

/* ── the two dead ends ─────────────────────────────────────── */

/**
 * AN EXPLICIT "LET ME CHOOSE" OUTRANKS THE READING IT WAS OPENED OVER.
 *
 * The key's shape arms an idle advance and a bare `sk-` shape sends a real request, and neither of
 * those knows the user has since asked for the list. Pressing the row over a detected key and then
 * stepping back walked them straight into the model list of the platform they were walking away from:
 * the standing gate fired 900ms later, and the probe's own answer committed whenever it landed.
 */
describe('the chooser outranks the check it was opened over', () => {
  it('holds the advance while the list is open, and after Back', async () => {
    vi.useFakeTimers();
    const listModels = vi.fn(() => Promise.resolve(['claude-sonnet-4-5']));
    renderWithI18n(<SetupScreen probe={pendingProbe} listModels={listModels} />);

    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.claude } });
    // The list, by hand, while the shape's own advance is armed.
    fireEvent.click(screen.getByTestId('setup-prov-row'));
    await act(async () => { vi.advanceTimersByTime(IDLE * 3); });
    expect(phaseOf(), 'the list is what the user is reading').toBe('key');
    expect(listModels).not.toHaveBeenCalled();

    // And out of it again: still the key step, still nothing committed.
    fireEvent.keyDown(window, { key: 'Escape' });
    await act(async () => { vi.advanceTimersByTime(IDLE * 3); });
    expect(phaseOf()).toBe('key');
    expect(listModels).not.toHaveBeenCalled();
    expect(useAgentPanelSettings.getState().keyed).toEqual([]);
  });

  /** A PROBE CANNOT BE RECALLED, so its answer is DROPPED rather than acted on: it lands after the
   *  user has left the reading it was asked about. */
  it('discards a probe that comes back after the user has stepped off it', async () => {
    let answer: (id: ProviderId | null) => void = () => {};
    const probe = () => new Promise<ProviderId | null>((resolve) => { answer = resolve; });
    const listModels = vi.fn(() => Promise.resolve(['deepseek-chat']));
    renderWithI18n(
      <SetupScreen probe={probe} candidates={['deepseek']} listModels={listModels} />,
    );
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.ambiguous } });
    await act(async () => { fireEvent.keyDown(screen.getByTestId('setup-key-input'), { key: 'Enter' }); });
    expect(screen.getByTestId('setup-row-spin')).toBeTruthy();

    // Back, and only then does the platform answer.
    fireEvent.click(screen.getByTestId('setup-act-reenter'));
    await act(async () => { answer('deepseek'); });
    expect(phaseOf()).toBe('key');
    expect(listModels).not.toHaveBeenCalled();
    expect(useAgentPanelSettings.getState().keyed).toEqual([]);
  });

  /** AND A KEYSTROKE RE-ARMS IT. The hold is on the key that was stepped off, not on the screen. */
  it('advances again on the next keystroke', async () => {
    vi.useFakeTimers();
    const listModels = vi.fn(() => Promise.resolve(['claude-sonnet-4-5']));
    renderWithI18n(<SetupScreen probe={pendingProbe} listModels={listModels} />);
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.claude } });
    fireEvent.click(screen.getByTestId('setup-prov-row'));
    await act(async () => { vi.advanceTimersByTime(IDLE * 2); });
    expect(phaseOf()).toBe('key');

    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: `${KEY.claude}x` } });
    await act(async () => { vi.advanceTimersByTime(IDLE + 50); });
    expect(phaseOf()).toBe('manage');
  });
});

/**
 * THE MODEL REQUEST CANNOT BE RECALLED EITHER, and its answer carries more than the probe's: the
 * list files a default model and its refusal un-files the key and takes the screen back. Landing
 * either after the user has stepped off the reading acts on a connection the answer was never
 * about — the walk here is commit, Back, a pick of a different platform with the same key in hand,
 * and only then does the first platform answer.
 */
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
    renderWithI18n(<SetupScreen probe={pendingProbe} listModels={listModels} />);
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.claude } });
    await act(async () => { fireEvent.keyDown(screen.getByTestId('setup-key-input'), { key: 'Enter' }); });
    expect(phaseOf()).toBe('checking');

    fireEvent.click(screen.getByTestId('setup-act-reenter'));
    expect(phaseOf()).toBe('key');

    fireEvent.click(screen.getByTestId('setup-prov-row'));
    await act(async () => { fireEvent.click(screen.getByText(PROVIDER_META.openai.name)); });
    expect(phaseOf()).toBe('checking');
    expect(useAgentPanelSettings.getState().provider).toBe('openai');
  }

  it('files no default model off a list that lands after the step-off', async () => {
    const { held, listModels } = heldLists();
    await stepOffClaudeOntoOpenai(listModels);

    await act(async () => { held.claude!.resolve(['claude-sonnet-4-5']); });
    expect(useAgentPanelSettings.getState().model.openai).toBe('');
    expect(useAgentPanelSettings.getState().model.claude).toBe('');
  });

  it('leaves the new check standing when the abandoned reading is refused', async () => {
    const { held, listModels } = heldLists();
    await stepOffClaudeOntoOpenai(listModels);

    await act(async () => { held.claude!.reject(Object.assign(new Error('Unauthorized'), { status: 401 })); });
    expect(phaseOf()).toBe('checking');
    expect(screen.getByTestId('setup-prov-face').getAttribute('data-provider')).toBe('openai');
    expect(useAgentPanelSettings.getState().keyed).toContain('openai');
  });
});

describe('a check that failed says so on the row it failed at', () => {
  it('crosses the row and asks, when nobody accepts the key', async () => {
    renderWithI18n(
      <SetupScreen probe={() => Promise.resolve<ProviderId | null>(null)} candidates={['deepseek']} />,
    );
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.ambiguous } });
    await act(async () => { fireEvent.keyDown(screen.getByTestId('setup-key-input'), { key: 'Enter' }); });

    expect(screen.getByTestId('setup-row-cross')).toBeTruthy();
    expect(screen.getByTestId('setup-prov-sub').textContent)
      .toBe(translations.en['agent3.setup_row_no_answer']);

    /* THE ROW'S TWO HALVES BOTH GIVE WAY. Held at its natural width, the provider NAME left the sub
       as the only shrinkable thing on the line, and on the custom-endpoint face in French the sub
       was cut from 112px to 54 — more than half the label gone. Same ruling the dock's own crowded
       meta line already follows. */
    const name = screen.getByTestId('setup-prov-face').querySelector('span:not([data-testid])') as HTMLElement;
    expect(name.style.minWidth).toBe('0');
    expect(name.style.textOverflow).toBe('ellipsis');
    expect(screen.getByTestId('setup-prov-sub').style.textOverflow).toBe('ellipsis');
    expect(noteText()).toBe(translations.en['agent3.setup_note_probe_failed']);
    expect(useAgentPanelSettings.getState().keyed).toEqual([]);

    // And the two ways on are the foot's own, both inside setup.
    expect(screen.getByTestId('setup-act-recheck')).toBeTruthy();
    fireEvent.click(screen.getByTestId('setup-act-manual'));
    expect(screen.getByTestId('setup-prov-row').getAttribute('aria-expanded')).toBe('true');
  });

  /**
   * A PIN OUTRANKS A READING, on the row and on the card above it alike.
   *
   * The route: a bare `sk-` key, an honest failure, then "Pick the provider myself" and the
   * Custom endpoint. A probe verdict that outlived the pick would leave the endpoint step wearing
   * the crossed row and the desk saying "No provider answered" about a question the user had just
   * answered themselves — with the cross riding the Custom row itself, marking the step they chose
   * as failed before it had been tried.
   */
  it('retires the failed probe when the user picks a provider, on the endpoint step and after it', async () => {
    const seen: (string | null)[] = [];
    renderWithI18n(
      <SetupScreen
        probe={() => Promise.resolve<ProviderId | null>(null)}
        candidates={['deepseek']}
        onFace={(face) => { seen.push(face?.step ?? null); }}
      />,
    );
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.ambiguous } });
    await act(async () => { fireEvent.keyDown(screen.getByTestId('setup-key-input'), { key: 'Enter' }); });
    expect(seen[seen.length - 1]).toBe('no-answer');

    fireEvent.click(screen.getByTestId('setup-act-manual'));
    fireEvent.click(screen.getByText(translations.en['agent3.setup_custom_endpoint']!));

    expect(phaseOf()).toBe('custom');
    expect(screen.queryByTestId('setup-row-cross'), 'the step the user just chose is not a failure').toBeNull();
    expect(screen.getByTestId('setup-prov-sub').textContent).toBe(translations.en['agent3.setup_row_openai_compat']);
    expect(seen[seen.length - 1], 'the card describes the screen that is standing').toBe('endpoint');

    fireEvent.change(screen.getByTestId('setup-endpoint-input'), { target: { value: 'https://gateway.example/v1' } });
    fireEvent.click(screen.getByTestId('setup-endpoint-save'));

    expect(phaseOf()).toBe('key');
    expect(screen.queryByTestId('setup-row-cross')).toBeNull();
    expect(screen.getByTestId('setup-prov-face').getAttribute('data-provider')).toBe('custom');
    // The key is still in the field, so the pinned row is on its way to committing it — the face a
    // pick that was never probed wears, which is the point.
    expect(screen.getByTestId('setup-prov-sub').textContent).toBe(translations.en['agent3.setup_row_pinned_checking']);
    expect(seen[seen.length - 1]).not.toBe('no-answer');
  });

  it('a probe that throws is the same answer as one that refuses', async () => {
    renderWithI18n(
      <SetupScreen probe={() => Promise.reject(new Error('offline'))} candidates={['deepseek']} />,
    );
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.ambiguous } });
    await act(async () => { fireEvent.keyDown(screen.getByTestId('setup-key-input'), { key: 'Enter' }); });
    expect(noteText()).toBe(translations.en['agent3.setup_note_probe_failed']);
  });

  /**
   * A REFUSED KEY IS NOT AN UNAVAILABLE LIST. The first request a key ever makes is the model list,
   * so a dead key lands in that same catch — and "type a model id instead" would let it be pressed
   * through to Done, leaving a panel that claims to be connected and fails on the first order.
   */
  it('sends a refused key back to the field, un-filed, in danger, with the row crossed', async () => {
    const refusal = Object.assign(new Error('Unauthorized'), { status: 401 });
    renderWithI18n(<SetupScreen probe={pendingProbe} listModels={() => Promise.reject(refusal)} />);
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.claude } });
    await act(async () => { fireEvent.keyDown(screen.getByTestId('setup-key-input'), { key: 'Enter' }); });

    expect(phaseOf()).toBe('key');
    expect(screen.getByTestId('setup-key-field').getAttribute('data-danger')).toBe('true');
    expect(screen.getByTestId('setup-row-cross')).toBeTruthy();
    expect(screen.getByTestId('setup-prov-sub').textContent)
      .toBe(translations.en['agent3.setup_row_refused']);
    expect(noteText()).toBe(translations.en['agent3.setup_key_refused']);
    expect(screen.queryByTestId('setup-models-unavailable')).toBeNull();
    // The key is no longer filed, so the panel is back to disconnected rather than half-connected.
    expect(useAgentPanelSettings.getState().keyed).toEqual([]);

    // Editing the field clears the accusation: the field is the action.
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: `${KEY.claude}z` } });
    expect(screen.getByTestId('setup-key-field').getAttribute('data-danger')).toBeNull();
    expect(noteText()).not.toBe(translations.en['agent3.setup_key_refused']);
  });

  /** A LIST THAT WILL NOT COME IS NOT A STEP OF THIS SCREEN. The settings card's model row owns the
   *  state (the typed id, the unverified note), so the flow ROUTES there by itself: no dead-end note,
   *  no door to press, no Done into a panel with no model. */
  it('routes a connection with no model and no list coming to the settings card', async () => {
    const onManage = vi.fn();
    renderWithI18n(
      <SetupScreen
        probe={pendingProbe}
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
    renderWithI18n(<SetupScreen probe={pendingProbe} listModels={listModels} />);
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.claude } });
    await act(async () => { fireEvent.keyDown(screen.getByTestId('setup-key-input'), { key: 'Enter' }); });
  }

  it('offers the default as an unselected list entry and waits for an explicit choice', async () => {
    await toManage(() => Promise.resolve(['claude-sonnet-4-5', 'claude-opus-4-1']));
    expect(phaseOf()).toBe('manage');
    expect(screen.queryByTestId('setup-screen')).toBeNull();
    expect(useAgentPanelSettings.getState().model.claude).toBe('');
    expect((screen.getByTestId('manage-done') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('manage-model-dd'));
    const entries = screen.getAllByRole('menuitemradio');
    expect(entries[0]!.textContent).toContain('Default model (Claude Sonnet 4.5)');
    expect(entries.every((entry) => entry.getAttribute('aria-checked') === 'false')).toBe(true);
    fireEvent.click(entries[1]!);
    expect(useAgentPanelSettings.getState().model.claude).toBe('claude-opus-4-1');
    expect((screen.getByTestId('manage-done') as HTMLButtonElement).disabled).toBe(false);
  });

  /** A PICK ALREADY MADE OUTRANKS THE LIST. The filed model is the user's own answer from a past
   *  session, and the settings card is the only place one is chosen. */
  it('leaves a model already filed for the provider exactly where it was', async () => {
    useAgentPanelSettings.getState().setModel('claude-haiku-4-5');
    await toManage(() => Promise.resolve(['claude-sonnet-4-5', 'claude-opus-4-1']));
    expect(useAgentPanelSettings.getState().model.claude).toBe('claude-haiku-4-5');
  });

  it('reads an empty list as no list at all, and routes to the card that takes a typed id', async () => {
    const onManage = vi.fn();
    renderWithI18n(
      <SetupScreen probe={pendingProbe} listModels={() => Promise.resolve([])} onManage={onManage} />,
    );
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.claude } });
    await act(async () => { fireEvent.keyDown(screen.getByTestId('setup-key-input'), { key: 'Enter' }); });
    expect(useAgentPanelSettings.getState().model.claude).toBe('');
    expect(onManage).toHaveBeenCalledTimes(1);
  });

  it('leaves on Done, with the key filed and the provider armed', async () => {
    const onDone = vi.fn();
    renderWithI18n(
      <SetupScreen probe={pendingProbe} listModels={() => Promise.resolve(['claude-sonnet-4-5'])} onDone={onDone} />,
    );
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.claude } });
    await act(async () => { fireEvent.keyDown(screen.getByTestId('setup-key-input'), { key: 'Enter' }); });
    pickDefault();
    fireEvent.click(screen.getByTestId('manage-done'));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(useAgentPanelSettings.getState().keyed).toContain('claude');
  });
});

/* ── the step, reported up to the desk ─────────────────────── */

/**
 * THE DESK HAS TO KNOW WHICH STEP THE SCREEN IS ON, and the session's phase cannot tell it: setup
 * stands over a session that has not begun. So the screen REPORTS its step, and the dock owns what
 * that step looks like (`DeskHeader`'s own table). What is asserted here is the reading only.
 */
describe('the step the screen reports upward', () => {
  const faces = () => {
    const seen: (string | null)[] = [];
    const onFace = vi.fn((face: { step: string } | null) => { seen.push(face?.step ?? null); });
    return { onFace, seen, last: () => seen[seen.length - 1] ?? null };
  };

  /** THE MOUTH IS A STEP LIKE THE REST OF THEM. A standing connection screen over a card reading
   *  "Not connected / a key wakes me" said the character was asleep while she was plainly up and
   *  asking; the sleep belongs to a desk with no screen under it. */
  it('says it is awake at the mouth, where the screen is standing and asking', () => {
    const f = faces();
    renderWithI18n(<SetupScreen probe={pendingProbe} onFace={f.onFace} />);
    expect(f.last()).toBe('awake');
  });

  it('reports key validation until management takes over', async () => {
    const f = faces();
    let settle: (ids: string[]) => void = () => {};
    const listModels = () => new Promise<string[]>((resolve) => { settle = resolve; });
    renderWithI18n(<SetupScreen probe={pendingProbe} listModels={listModels} onFace={f.onFace} />);

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
      <SetupScreen probe={pendingProbe} candidates={['deepseek']} onFace={f.onFace} />,
    );
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.ambiguous } });
    // "Asking both" is the request being out. During the idle gate the key is still being READ,
    // which is what the card says until the probe actually leaves.
    expect(f.last()).toBe('typing');
    await act(async () => { vi.advanceTimersByTime(IDLE + 50); });
    expect(f.last()).toBe('ambiguous');
    vi.useRealTimers();
    view.unmount();

    const unknown = faces();
    const asked = renderWithI18n(<SetupScreen probe={pendingProbe} onFace={unknown.onFace} />);
    vi.useFakeTimers();
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.unknown } });
    await act(async () => { vi.advanceTimersByTime(IDLE + 50); });
    expect(unknown.last(), 'the quiet opened the row, which is the question').toBe('unknown');
    vi.useRealTimers();
    asked.unmount();

    const failed = faces();
    renderWithI18n(
      <SetupScreen
        probe={() => Promise.resolve<ProviderId | null>(null)}
        candidates={['deepseek']}
        onFace={failed.onFace}
      />,
    );
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.ambiguous } });
    await act(async () => { fireEvent.keyDown(screen.getByTestId('setup-key-input'), { key: 'Enter' }); });
    expect(failed.last()).toBe('no-answer');
  });

  it('says a refusal, so the card above the field stops looking calm', async () => {
    const f = faces();
    const refusal = Object.assign(new Error('Unauthorized'), { status: 401 });
    renderWithI18n(
      <SetupScreen probe={pendingProbe} listModels={() => Promise.reject(refusal)} onFace={f.onFace} />,
    );
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.claude } });
    await act(async () => { fireEvent.keyDown(screen.getByTestId('setup-key-input'), { key: 'Enter' }); });
    expect(f.last()).toBe('refused');
  });

  it('says the endpoint step with the host it is pointed at', () => {
    const f = faces();
    renderWithI18n(<SetupScreen probe={pendingProbe} onFace={f.onFace} />);
    fireEvent.click(screen.getByTestId('setup-prov-row'));
    fireEvent.click(screen.getByText(translations.en['agent3.setup_custom_endpoint']!));
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
        probe={pendingProbe}
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

/* ── the leave verb, and what setup does NOT ask ───────────── */

describe('one leave verb per screen', () => {
  /** Every step this screen can stand in, and how to get there. The count is the assertion: a step
   *  with two ways out asks the user which of them is the way out. */
  it('draws exactly one, on every step', async () => {
    const steps: [string, () => Promise<void> | void][] = [
      ['mouth', () => {}],
      ['reading', () => {
        fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.claude } });
      }],
      ['probe-failed', async () => {
        fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.ambiguous } });
        await act(async () => { fireEvent.keyDown(screen.getByTestId('setup-key-input'), { key: 'Enter' }); });
      }],
      ['custom', () => {
        fireEvent.click(screen.getByTestId('setup-prov-row'));
        fireEvent.click(screen.getByText(translations.en['agent3.setup_custom_endpoint']!));
      }],
    ];

    for (const [name, drive] of steps) {
      const view = renderWithI18n(
        <SetupScreen
          probe={() => Promise.resolve<ProviderId | null>(null)}
          candidates={['deepseek']}
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
    const withLeave = renderWithI18n(<SetupScreen probe={pendingProbe} onLeave={left} />);
    fireEvent.click(screen.getByTestId('setup-leave'));
    expect(left).toHaveBeenCalledTimes(1);
    withLeave.unmount();

    renderWithI18n(<SetupScreen probe={pendingProbe} />);
    expect(screen.queryByTestId('setup-leave')).toBeNull();
  });

  /** AND IT SAYS BACK, on every step that draws it. The form is walked into from the keyless rest, so
   *  a prior step always exists and no step of this screen is a mouth: a decline ("Not now")
   *  presumes a first screen of the flow's own, which this screen is not. */
  it('says Back wherever it stands, never a decline', async () => {
    const steps: [string, () => Promise<void> | void][] = [
      ['mouth', () => {}],
      ['probe-failed', async () => {
        fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.ambiguous } });
        await act(async () => { fireEvent.keyDown(screen.getByTestId('setup-key-input'), { key: 'Enter' }); });
      }],
    ];
    for (const [name, drive] of steps) {
      const view = renderWithI18n(
        <SetupScreen
          probe={() => Promise.resolve<ProviderId | null>(null)}
          candidates={['deepseek']}
          onLeave={() => {}}
        />,
      );
      await drive();
      expect(screen.getByTestId('setup-leave').textContent, name)
        .toBe(translations.en['agent3.setup_back']);
      view.unmount();
    }
  });

  /**
   * AND IT IS THE HOUSE BUTTON, NOT AN UNDERLINED LINE.
   *
   * The steps of this flow are as closely joined as two screens get, and the house has two back
   * idioms: the quiet underlined text where space is genuinely tight, and the footer's ghost button
   * everywhere else. So every step of the family draws the same control, which is what makes the
   * mouth's Back and the waiting step's Back one verb rather than two.
   */
  it('draws Back as the footer ghost button, the same on every step that has one', async () => {
    const ghost = (el: HTMLElement) => ({
      background: el.style.background,
      color: el.style.color,
      borderRadius: el.style.borderRadius,
      fontSize: el.style.fontSize,
      fontWeight: el.style.fontWeight,
    });

    const mouth = renderWithI18n(<SetupScreen probe={pendingProbe} onLeave={() => {}} />);
    const atMouth = screen.getByTestId('setup-leave');
    expect(atMouth.tagName).toBe('BUTTON');
    // Never the underlined text idiom, which belongs where the room genuinely is not there.
    expect(atMouth.style.textDecoration).not.toBe('underline');
    const shape = ghost(atMouth);
    expect(shape.background, 'the footer ghost brings its own fill').not.toBe('');
    mouth.unmount();

    // The waiting step's own Back, which is the foot's ghost verb: the two must be one control.
    vi.useFakeTimers();
    renderWithI18n(<SetupScreen probe={pendingProbe} listModels={() => Promise.resolve(['m'])} onLeave={() => {}} />);
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.claude } });
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(ghost(screen.getByTestId('setup-act-reenter'))).toEqual(shape);
    vi.useRealTimers();
  });

  /** OVERSIGHT IS NOT ASKED AT SETUP. A visitor pasting their first key has no way to judge the
   *  answer, so it defaults quietly and lives on the manage card. */
  it('never asks for oversight, on any step', async () => {
    renderWithI18n(<SetupScreen probe={pendingProbe} listModels={() => Promise.resolve(['claude-sonnet-4-5'])} />);
    const segments = () => [
      translations.en['agent3.oversight_strict']!,
      translations.en['agent3.oversight_checkpoint']!,
      translations.en['agent3.oversight_yolo']!,
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
  /** Walks the chooser to the custom endpoint and files an address, which lands back on the key step
   *  with `custom` pinned. */
  function armEndpoint(): void {
    fireEvent.click(screen.getByTestId('setup-prov-row'));
    fireEvent.click(screen.getByText(translations.en['agent3.setup_custom_endpoint']!));
    fireEvent.change(screen.getByTestId('setup-endpoint-input'), { target: { value: 'http://localhost:11434/v1' } });
    fireEvent.click(screen.getByTestId('setup-endpoint-save'));
  }

  it('opens management without choosing the endpoint\'s first model', async () => {
    const done = vi.fn();
    const asked = vi.fn(() => Promise.resolve(['qwen2.5-coder:14b', 'llama3.2']));
    renderWithI18n(<SetupScreen probe={pendingProbe} listModels={asked} onDone={done} />);
    armEndpoint();
    expect(phaseOf()).toBe('key');
    expect(useAgentPanelSettings.getState().provider).toBe('custom');

    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.unknown } });
    await act(async () => { fireEvent.keyDown(screen.getByTestId('setup-key-input'), { key: 'Enter' }); });

    expect(phaseOf()).toBe('manage');
    // The list was asked against the endpoint's own address, and its first id is what got filed.
    expect(asked).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'custom', customBaseUrl: 'http://localhost:11434/v1',
    }));
    expect(useAgentPanelSettings.getState().model.custom).toBe('');
    expect(screen.queryByTestId('setup-screen')).toBeNull();
    expect((screen.getByTestId('manage-done') as HTMLButtonElement).disabled).toBe(true);

    pickDefault();
    fireEvent.click(screen.getByTestId('manage-done'));
    expect(done).toHaveBeenCalledTimes(1);
  });

  /** AND A GATEWAY THAT WILL NOT LIST GOES TO THE CARD THAT TAKES A TYPED ID, BY ITSELF. The key is
   *  live (it was not refused) and the address stands, so the one thing still owed is the model, and
   *  the flow routes to the surface that takes one rather than standing a dead end of its own. */
  it('hands an endpoint that names nothing to the manage card', async () => {
    const done = vi.fn();
    const manage = vi.fn();
    renderWithI18n(
      <SetupScreen
        probe={pendingProbe}
        listModels={() => Promise.reject(Object.assign(new Error('teapot'), { status: 418 }))}
        onDone={done}
        onManage={manage}
      />,
    );
    armEndpoint();
    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.unknown } });
    await act(async () => { fireEvent.keyDown(screen.getByTestId('setup-key-input'), { key: 'Enter' }); });

    expect(phaseOf()).toBe('manage');
    expect(screen.queryByTestId('setup-models-unavailable'), 'no unavailable-model dead end').toBeNull();
    expect(screen.queryByTestId('setup-model-note')).toBeNull();
    // The key stayed filed: an unlisted model is not a refusal.
    expect(useAgentPanelSettings.getState().keyed).toContain('custom');
    expect(manage).toHaveBeenCalledTimes(1);
    expect(done).not.toHaveBeenCalled();
  });

  /**
   * THE KEY IS USUALLY IN THE FIELD BEFORE THE ADDRESS IS, and that order is the one this path is
   * walked in: paste a gateway's key, find that no platform claims its shape, open the row, pick the
   * custom endpoint, then say where the server is. Filing the address ANSWERS the reading the key
   * was waiting on, so the key already in the field is read against it.
   */
  it('reads the key already in the field once the address is filed', async () => {
    vi.useFakeTimers();
    const asked = vi.fn(() => Promise.resolve(['qwen2.5-coder:14b']));
    renderWithI18n(<SetupScreen probe={pendingProbe} listModels={asked} />);

    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.unknown } });
    // BY HAND, which is what puts the idle gate down for the key in the field.
    fireEvent.click(screen.getByTestId('setup-prov-row'));
    fireEvent.click(screen.getByText(translations.en['agent3.setup_custom_endpoint']!));
    fireEvent.change(screen.getByTestId('setup-endpoint-input'), { target: { value: 'https://gateway.example/v1' } });
    fireEvent.click(screen.getByTestId('setup-endpoint-save'));
    expect(phaseOf()).toBe('key');

    await act(async () => { vi.advanceTimersByTime(IDLE + 50); });
    expect(phaseOf(), 'a gate still held would leave the screen reading a key forever').toBe('manage');
    expect(asked).toHaveBeenCalledWith({
      provider: 'custom', apiKey: KEY.unknown, customBaseUrl: 'https://gateway.example/v1',
    });
    expect(useAgentPanelSettings.getState().keyed).toContain('custom');
  });

  /**
   * NO STEP OF THIS PATH RESTS ON A READING, whatever the gateway does with the key.
   *
   * The screen's own words for a reading in progress are the dock's "Reading the key", and a reading
   * that never lands is the one failure this flow cannot report: there is no verb on that step and
   * nothing on screen says what to do next. So every answer a gateway can give is walked here, and
   * each one has to arrive at a step that either finishes or says where to go.
   */
  it('lands on a step that finishes or points somewhere, for every answer a gateway gives', async () => {
    const READING = new Set(['awake', 'typing', 'shaped', 'ambiguous']);
    // A gateway that ANSWERS badly lands on the step that repairs what it proved: no list from a
    // server that answered is the model's problem, so the flow routes to the card that takes a typed
    // id, while a check nothing answered is the ADDRESS's (`endpointCheckVerdict`) — the failed
    // check files the endpoint gap, so the step is the address.
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
          probe={pendingProbe}
          listModels={listModels}
          onManage={onManage}
          onFace={(face) => { seen.push(face?.step ?? null); }}
        />,
      );
      vi.useFakeTimers();
      fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.unknown } });
      fireEvent.click(screen.getByTestId('setup-prov-row'));
      fireEvent.click(screen.getByText(translations.en['agent3.setup_custom_endpoint']!));
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
      useAgentPanelSettings.getState().forgetKey('custom');
      useAgentPanelSettings.setState({
        customBaseUrl: '', providerPinned: false, provider: 'claude', endpointDown: '', formerModel: '',
      });
    }
  });
});

/**
 * THE STEP MOVES THE GROUPS, IT DOES NOT REDRAW THEM SOMEWHERE ELSE.
 *
 * The first character typed retires the line above the field, so the field, the row and the note all
 * stand ~57px higher for it while the plate's own edge comes up by the same distance. Jump-cutting the
 * inside of that read as a different screen arriving under the hands, with the caret in it.
 */
describe('a step change is a movement', () => {
  const template = (_v: object, generated: string) => generated;

  it('travels the groups on the declared motion, and only their position', () => {
    const slide = stepSlide(false, template);
    expect(slide.layout, 'a size tween would stretch the field and its radius').toBe('position');
    expect(slide.transition).toEqual(framerMotion('panel.setup.step'));
    // The plate's own height move and this are ONE movement, so they run the same length.
    expect(seconds('panel.setup.step')).toBe(seconds('panel.height'));
  });

  /** THE FRAME'S ZOOM IS DIVIDED BACK OUT. Framer measures a layout move in page px and applies it as
   *  a transform read in the frame's own, so an uncorrected travel is `zoom` times too long. */
  it('carries the frame\'s own transform template', () => {
    expect(stepSlide(false, template).transformTemplate).toBe(template);
  });

  /** AND NOTHING MOVES UNDER REDUCED MOTION: the step is said by what the groups hold. */
  it('takes nothing at all under reduced motion', () => {
    expect(stepSlide(true, template)).toEqual({});
  });
});

/* ── the copy ──────────────────────────────────────────────── */

describe('setup copy, in every locale', () => {
  const KEYS = [
    'agent3.setup_say_key', 'agent3.setup_key_placeholder', 'agent3.setup_note_probe_failed',
    'agent3.setup_custom_endpoint', 'agent3.setup_pick_provider', 'agent3.setup_say_custom',
    'agent3.setup_note_custom', 'agent3.setup_endpoint_placeholder', 'agent3.setup_endpoint_invalid',
    'agent3.setup_endpoint_check', 'agent3.setup_model_placeholder',
    'agent3.setup_model_pick', 'agent3.setup_models_unavailable',
    'agent3.setup_manage_endpoint', 'agent3.setup_list_unavailable',
    'agent3.setup_give_address',
    'agent3.setup_done',
    'agent3.setup_default_model_entry', 'agent3.setup_back', 'agent3.setup_use_this_key',
    'agent3.setup_fits_this_key', 'agent3.setup_gateway_fits',
    'agent3.setup_row_any', 'agent3.setup_row_any_sub', 'agent3.setup_row_asking',
    'agent3.setup_row_checking', 'agent3.setup_row_no_answer', 'agent3.setup_row_pinned',
    'agent3.setup_row_pinned_checking', 'agent3.setup_row_provider', 'agent3.setup_row_refused',
    'agent3.setup_row_sofar', 'agent3.setup_row_two',
    'agent3.setup_note_ambiguous', 'agent3.setup_note_partial', 'agent3.setup_note_pinned_checking',
    'agent3.setup_note_replaces', 'agent3.setup_note_shaped', 'agent3.setup_note_unknown',
    'agent3.setup_key_refused',
  ];
  const locales = Object.keys(translations) as Locale[];

  it('is present in all seven and carries no em dash or dot separator', () => {
    for (const loc of locales) {
      for (const key of KEYS) {
        const value = translations[loc][key];
        expect(value, `${loc}/${key}`).toBeTruthy();
        expect(value, `${loc}/${key}`).not.toMatch(/[—·•]/);
      }
    }
  });

  /** The two `{name}` sentences are the only interpolated ones here, and a locale that dropped the
   *  token would render a sentence with the provider missing rather than throwing. */
  it('keeps the {name} token in both notes, in every locale', () => {
    for (const loc of locales) {
      for (const key of ['agent3.setup_note_shaped', 'agent3.setup_note_pinned_checking']) {
        expect(translations[loc][key], `${loc}/${key}`).toContain('{name}');
      }
    }
  });
});
