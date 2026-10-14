// @vitest-environment jsdom
/**
 * The gear's one door: five controls and two confirms. Each destructive verb becomes its own
 * question in place, so the landmark structure is identical before and after a press, the second
 * press on the same button reaches the vault, and a press elsewhere puts the words back.
 *
 * A held job's verbs: a gated job offers stop and never set-aside, since the loop honours a pause
 * only at a call boundary and a pause over a gate would deadlock.
 *
 * The endpoint address appears for `custom` alone. A changed address files itself after the quiet
 * (or on Enter) and its check may file a failed verdict; the fetch a gear press makes only notes a
 * failure and clears nothing.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { I18nProvider } from '../../../../i18n/context';
import { translations } from '../../../_support/locale-tables';
import { useEditorStore } from '../../../../state/store';
import { ManageScreen } from '../../../../ui/agent/connection/ManageScreen';
import { forgetRosters } from '../../../../agent/connection/model-roster';
import { __resetAgentConnection, isConnected, useAgentConnection } from '../../../../agent/connection/store';
import { prettyModel } from '../../../../ui/agent/connection/pretty-model';
import { endpointCheckVerdict } from '../../../../ui/agent/connection/setup-parts';
import { NO_ENDPOINT_ADDRESS } from '../../../../agent/core/errors';
import { PROVIDER_IDS, PROVIDER_META, type ProviderId } from '../../../../agent/providers/defaults';
import { radii } from '../../../../ui/design/styles';
import { roleFont } from '../../../../ui/design/text-weight';
import type { Locale } from '../../../../core/model/locale';
import { setToastPresenter } from '../../../../platform/channels/toast-bus';

const backing = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
};

const emptyModels = () =>
  Object.fromEntries(PROVIDER_IDS.map((id) => [id, ''])) as Record<ProviderId, string>;

/** A list request that never settles: the card is a settings surface, not a loader, and every
 *  assertion below is about what it does with what it already has. Pending rather than resolved-empty
 *  so no state update lands outside the test's own `act`. */
const noModels = () => new Promise<string[]>(() => {});

function mount(props: Partial<React.ComponentProps<typeof ManageScreen>> = {}) {
  return render(
    <MotionConfig reducedMotion="always">
      <I18nProvider>
        <ManageScreen jobCount={0} listModels={noModels} {...props} />
      </I18nProvider>
    </MotionConfig>,
  );
}

/** Every toast the card raises during one test. The note it owes a running job is the house toast,
 *  so this is where that half of the card's behaviour is read. */
let toasts: string[] = [];
let unsubscribeToasts: (() => void) | undefined;

beforeEach(async () => {
  toasts = [];
  unsubscribeToasts = setToastPresenter((text) => { toasts.push(text); });
  backing.clear();
  // The remembered rosters are a session fact and this module is one session for the whole file, so
  // one test's answered list would otherwise stand in for the next test's request.
  forgetRosters();
  useEditorStore.setState({ locale: 'en' });
  const model = emptyModels();
  model.claude = 'claude-sonnet-4-5';
  __resetAgentConnection();
  await useAgentConnection.getState().hydrate();
  useAgentConnection.setState({ provider: 'claude', model, oversight: 'checkpoint' });
  useAgentConnection.getState().connectKey('claude', 'sk-ant-api03-abcdefghijkl');
  backing.clear();
});

afterEach(() => { unsubscribeToasts?.(); cleanup(); });

describe('what stands behind the gear', () => {
  it('draws the provider row, the model list, oversight and both management verbs', () => {
    mount({ jobCount: 3 });
    expect(screen.getByTestId('manage-prov-face').getAttribute('data-provider')).toBe('claude');
    expect(screen.getByTestId('manage-model-face').textContent).toBeTruthy();
    expect(screen.getByTestId('manage-oversight-caption').textContent)
      .toBe(translations.en['agent.oversight_checkpoint_caption']);
    expect(screen.getByTestId('manage-forget-key')).toBeTruthy();
    expect(screen.getByTestId('manage-clear-jobs')).toBeTruthy();
    expect(screen.getByTestId('manage-done')).toBeTruthy();
  });

  /** The model row says what it is. The dropdown's face is a bare id, so the row carries the same
   *  small label the endpoint and oversight rows are titled by, whatever provider is armed. */
  it('titles the model row, in the card\'s own label idiom', () => {
    mount();
    expect(screen.getByTestId('manage-model-label').textContent)
      .toBe(translations.en['agent.setup_manage_model']);
  });

  /** Destructive details live in confirmation prompts, and endpoint verification runs automatically. */
  it('carries no standing explainer prose and no check button', () => {
    mount({ jobCount: 3 });
    for (const id of ['manage-forget-note', 'manage-clear-note', 'manage-endpoint-check']) {
      expect(screen.queryByTestId(id), id).toBeNull();
    }
  });

  /** Oversight lives here and nowhere else, and this is the half of that rule this file can hold
   *  (setup's own suite holds the other). */
  it('is where oversight is asked, and writes the settings slice', () => {
    mount();
    fireEvent.click(screen.getByText(translations.en['agent.oversight_strict']!));
    expect(useAgentConnection.getState().oversight).toBe('strict');
    expect(screen.getByTestId('manage-oversight-caption').textContent)
      .toBe(translations.en['agent.oversight_strict_caption']);

    fireEvent.click(screen.getByText(translations.en['agent.oversight_yolo']!));
    expect(useAgentConnection.getState().oversight).toBe('yolo');
  });

  it('pins the provider a press names, so no shape reading can overrule it later', () => {
    mount();
    fireEvent.click(screen.getByTestId('manage-prov-row'));
    fireEvent.click(screen.getByText(PROVIDER_META.gemini.name));
    expect(useAgentConnection.getState().provider).toBe('gemini');
    expect(useAgentConnection.getState().providerPinned).toBe(true);
  });

  it('keeps the selected model out of suggestions until the server lists it', () => {
    mount();
    fireEvent.click(screen.getByTestId('manage-model-dd'));
    expect(screen.queryAllByRole('menuitemradio')).toHaveLength(0);
    expect(screen.getByTestId('manage-model-face').textContent).toBe(prettyModel('claude-sonnet-4-5'));
    expect(useAgentConnection.getState().model.claude).toBe('claude-sonnet-4-5');
  });

  it('hands the caller its own Done', () => {
    const done = vi.fn();
    mount({ onDone: done });
    fireEvent.click(screen.getByTestId('manage-done'));
    expect(done).toHaveBeenCalledTimes(1);
  });

  /**
   * One row, one rung: the provider row, the model row and every list row are choices, drawn at one
   * size and weight; the yellow fill alone says which is chosen. `roleWeight` resolves through a
   * custom property, so the declared rung is compared rather than a number jsdom computes.
   */
  it('draws its rows and its list at one rung', () => {
    mount();
    const rung = roleFont('menu');
    const provider = screen.getByTestId('manage-prov-row');
    const model = screen.getByTestId('manage-model-dd');
    for (const [name, row] of [['provider', provider], ['model', model]] as const) {
      expect(row.style.fontWeight, `${name} weight`).toBe(String(rung.fontWeight));
      expect(row.style.fontSize, `${name} size`).toBe(`${rung.fontSize}px`);
    }

    fireEvent.click(provider);
    const rows = screen.getAllByRole('menuitemradio');
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) {
      const el = row as HTMLElement;
      expect(el.style.fontWeight, el.textContent ?? '').toBe(String(rung.fontWeight));
      expect(el.style.fontSize, el.textContent ?? '').toBe(`${rung.fontSize}px`);
    }
  });
});

/**
 * The verb becomes its own question. One press turns the button's words into the locale's question
 * form and its fill danger; a second press on the same button is the answer, and anything else
 * cancels. So the card cannot grow for a question at all, which is what these tests hold: the
 * landmark structure before and after a press is the same nodes, in the same order, in the same
 * parents.
 */
describe('the two destructive verbs ask first', () => {
  /** Where every landmark in the card stands: nothing inserted, removed, reordered or remounted. */
  function landmarks(): { id: string; parent: Element | null; index: number }[] {
    return [...screen.getByTestId('manage-screen').querySelectorAll<HTMLElement>('[data-testid]')]
      .map((el) => ({
        id: el.dataset.testid ?? '',
        parent: el.parentElement,
        index: [...(el.parentElement?.children ?? [])].indexOf(el),
      }));
  }
  const question = (id: string) => document.querySelector(`[data-testid="${id}-ask"] h2`)?.textContent ?? '';
  const answer = (id: string) => fireEvent.click(document.querySelector<HTMLElement>(`[data-testid="${id}-confirm"]`)!);

  it('asks before forgetting the key, then clears the vault and lands disconnected', () => {
    mount();
    expect(isConnected(useAgentConnection.getState())).toBe(true);

    fireEvent.click(screen.getByTestId('manage-forget-key'));
    // The question unrolls from the pill, which keeps its own words.
    expect(question('manage-forget-key')).toBe(translations.en['agent.setup_manage_forget_q']);
    expect(screen.getByTestId('manage-forget-key').textContent).toContain(translations.en['agent.setup_manage_forget_key']);
    expect(useAgentConnection.getState().keyed, 'nothing has happened yet').toContain('claude');

    answer('manage-forget-key');
    expect(useAgentConnection.getState().keyed).toEqual([]);
    expect(isConnected(useAgentConnection.getState())).toBe(false);
    // The pin goes with the key: a provider named for a key that is gone must not answer for the next one.
    expect(useAgentConnection.getState().providerPinned).toBe(false);
  });

  /** The card does not ask for space: the question stands beside it. */
  it('adds and takes away nothing when either verb asks', async () => {
    mount({ jobCount: 4, stoppable: true, parkable: true });
    for (const verb of ['manage-forget-key', 'manage-clear-jobs']) {
      const before = landmarks();
      fireEvent.click(screen.getByTestId(verb));
      expect(question(verb), verb).not.toBe('');
      expect(landmarks(), verb).toEqual(before);
      fireEvent.pointerDown(screen.getByTestId('manage-done'));
      fireEvent.pointerUp(screen.getByTestId('manage-done'));
      await waitFor(() => expect(question(verb), `${verb} cancelled`).toBe(''));
      expect(landmarks(), `${verb} cancelled`).toEqual(before);
    }
  });

  it('cancels when the press lands anywhere else', async () => {
    mount();
    fireEvent.click(screen.getByTestId('manage-forget-key'));
    fireEvent.pointerDown(screen.getByTestId('manage-oversight-caption'));
    fireEvent.pointerUp(screen.getByTestId('manage-oversight-caption'));
    await waitFor(() => expect(question('manage-forget-key')).toBe(''));
    expect(useAgentConnection.getState().keyed).toContain('claude');
  });

  it('names the count the clear verb would take, and only fires on the answer', () => {
    const cleared = vi.fn();
    mount({ jobCount: 4, onClearJobs: cleared });
    expect(screen.getByTestId('manage-clear-jobs').textContent)
      .toContain(translations.en['agent.setup_manage_clear_jobs']!.replace('{n}', '4'));

    fireEvent.click(screen.getByTestId('manage-clear-jobs'));
    expect(cleared).not.toHaveBeenCalled();
    expect(question('manage-clear-jobs')).toBe(translations.en['agent.setup_manage_clear_q']!.replace('{n}', '4'));

    answer('manage-clear-jobs');
    expect(cleared).toHaveBeenCalledTimes(1);
  });

  it('explains that clearing records pauses an active job', () => {
    const cleared = vi.fn();
    mount({ jobCount: 2, stoppable: true, onClearJobs: cleared });
    fireEvent.click(screen.getByTestId('manage-clear-jobs'));
    expect(question('manage-clear-jobs')).toBe(translations.en['agent.setup_manage_clear_pause_q']!.replace('{n}', '2'));
    expect(cleared).not.toHaveBeenCalled();
    answer('manage-clear-jobs');
    expect(cleared).toHaveBeenCalledTimes(1);
  });

  it('refuses to ask about a record that is not there', () => {
    mount({ jobCount: 0 });
    expect((screen.getByTestId('manage-clear-jobs') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('manage-clear-jobs'));
    expect(question('manage-clear-jobs')).toBe('');
  });

  it('holds one question at a time', () => {
    mount({ jobCount: 2 });
    fireEvent.click(screen.getByTestId('manage-forget-key'));
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  });
});

describe('the held job, from the manage card', () => {
  it('offers stop over a job in flight, and nothing over a session at rest', () => {
    const resting = mount();
    expect(screen.queryByTestId('manage-held')).toBeNull();
    resting.unmount();

    mount({ stoppable: true });
    expect(screen.getByTestId('manage-stop')).toBeTruthy();
  });

  /**
   * The one thing this card may not offer. A pause withholds the gate card and the loop honours a
   * pause only at a call boundary, so over a job that is waiting on the user's own answer both doors
   * are locked: the gate cannot be answered because its card is gone, and the pause cannot land
   * because the call has not returned. Set-aside is for a job waiting on a clock.
   */
  it('never offers set-aside except where the job is waiting on a clock', () => {
    const gated = mount({ stoppable: true, parkable: false });
    expect(screen.getByTestId('manage-stop')).toBeTruthy();
    expect(screen.queryByTestId('manage-set-aside'), 'a gate must not be offered a pause').toBeNull();
    gated.unmount();

    mount({ stoppable: true, parkable: true });
    expect(screen.getByTestId('manage-set-aside')).toBeTruthy();
  });

  /**
   * And the guard is the verb, not the testid. A deadlock is a class of control rather than one
   * named button: a second pill offered under any other name, wired to the same pause, ships past an
   * assertion that only looks for `manage-set-aside`. So every control the card renders over a gated
   * job is pressed, and the pause verb must never be reached — and the card's own words must not
   * offer one either, since a control this test cannot press is still a promise to the reader.
   */
  it('reaches the pause verb from no control at all while the job waits on the user', () => {
    const park = vi.fn();
    const props = { stoppable: true, parkable: false, jobCount: 2, onSetAside: park, onStopJob: vi.fn() };
    const buttons = () => [...screen.getByTestId('manage-screen').querySelectorAll('button')];

    const first = mount(props);
    const count = buttons().length;
    const words = screen.getByTestId('manage-screen').textContent ?? '';
    expect(count, 'nothing was pressed, so nothing is proven').toBeGreaterThan(3);
    first.unmount();

    // One press per mount, because a press can take another control away with it (a confirm
    // replaces its trigger), and a control detached by an earlier press is a control this would
    // never have tried. Whatever a press reveals is pressed too, in that same mount.
    for (let i = 0; i < count; i++) {
      const view = mount(props);
      fireEvent.click(buttons()[i]!);
      for (const revealed of buttons()) fireEvent.click(revealed);
      view.unmount();
    }
    expect(park, 'a control on this card reached the pause').not.toHaveBeenCalled();
    expect(/\bpause\b/i.test(words), words).toBe(false);
  });

  it('calls the caller\'s verbs, which own the runner', () => {
    const stop = vi.fn();
    const park = vi.fn();
    mount({ stoppable: true, parkable: true, onStopJob: stop, onSetAside: park });
    fireEvent.click(screen.getByTestId('manage-stop'));
    fireEvent.click(screen.getByTestId('manage-set-aside'));
    expect(stop).toHaveBeenCalledTimes(1);
    expect(park).toHaveBeenCalledTimes(1);
  });

  /** A standing question outranks them, and they stand hushed for it rather than leaving: a row that
   *  withdraws is the card changing height under the question it has just been asked. */
  it('leaves them where they stand while a question is up', () => {
    mount({ stoppable: true, parkable: true, jobCount: 1 });
    const held = screen.getByTestId('manage-held');
    fireEvent.click(screen.getByTestId('manage-forget-key'));
    expect(screen.getByTestId('manage-held')).toBe(held);
    expect(held.style.opacity).toBe('');
  });
});

describe('the list the card asks for', () => {
  it('asks for the armed provider\'s models, and survives a refusal', async () => {
    const listModels = vi.fn(() => Promise.reject(new Error('offline')));
    await act(async () => { mount({ listModels }); });
    expect(listModels).toHaveBeenCalledWith({ provider: 'claude', apiKey: 'sk-ant-api03-abcdefghijkl' });
    // Still a usable settings card: the list is a convenience, not a gate.
    expect(screen.getByTestId('manage-oversight-caption')).toBeTruthy();
    expect(screen.getByTestId('manage-forget-key')).toBeTruthy();
  });

  it('shows what a live list answers', async () => {
    await act(async () => {
      mount({ listModels: () => Promise.resolve(['claude-opus-4-1', 'claude-haiku-4-5']) });
    });
    fireEvent.click(screen.getByTestId('manage-model-dd'));
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(2);
  });

  it('filters models by ID or display name without changing the selection', async () => {
    await act(async () => {
      mount({ listModels: () => Promise.resolve(['claude-opus-4-1', 'claude-haiku-4-5']) });
    });
    expect(screen.queryByTestId('manage-model-input')).toBeNull();
    fireEvent.click(screen.getByTestId('manage-model-dd'));
    const input = screen.getByTestId('manage-model-input');
    fireEvent.change(input, { target: { value: 'Haiku 4.5' } });
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(1);
    expect(useAgentConnection.getState().model.claude).toBe('claude-sonnet-4-5');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(useAgentConnection.getState().model.claude).toBe('claude-haiku-4-5');
    expect(screen.queryByTestId('manage-model-input')).toBeNull();
  });

  it('keeps manual IDs in the same list as suggestions and confirms only once', async () => {
    useAgentConnection.getState().setCustomBaseUrl('https://gateway.example/v1');
    useAgentConnection.getState().connectKey('custom', 'custom-test-key');
    await act(async () => { mount({ listModels: () => Promise.resolve(['qwen3:32b']) }); });
    fireEvent.click(screen.getByTestId('manage-model-dd'));
    const input = screen.getByTestId('manage-model-input');
    fireEvent.change(input, { target: { value: '  owner/model:latest  ' } });
    expect(screen.getByTestId('manage-model-input')).toBe(input);
    expect(useAgentConnection.getState().model.custom).toBe('');
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(useAgentConnection.getState().model.custom).toBe('');
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Use owner/model:latest' }));
    expect(useAgentConnection.getState().model.custom).toBe('owner/model:latest');
    fireEvent.click(screen.getByTestId('manage-model-dd'));
    fireEvent.change(screen.getByTestId('manage-model-input'), { target: { value: 'qwen3:32b' } });
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(1);
    fireEvent.keyDown(screen.getByTestId('manage-model-input'), { key: 'Enter' });
    expect(useAgentConnection.getState().model.custom).toBe('qwen3:32b');
  });

  it('lets arrow keys reach suggestions and keeps an unmatched search uncommitted', async () => {
    await act(async () => {
      mount({ listModels: () => Promise.resolve(['claude-opus-4-1', 'claude-haiku-4-5']) });
    });
    fireEvent.click(screen.getByTestId('manage-model-dd'));
    const input = screen.getByTestId('manage-model-input');
    input.focus();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getAllByRole('menuitemradio')[0]);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: 'missing' } });
    expect(screen.getByRole('status').textContent).toBe(translations.en['agent.setup_model_no_matches']);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(useAgentConnection.getState().model.claude).toBe('claude-sonnet-4-5');
  });

  /**
   * One request per endpoint per session. The gear is the panel's one settings door, so a fetch per
   * mount is a provider request every time the user glances at the oversight caption — free on most
   * platforms and counted on a rate-limited one, for an answer that does not change between two
   * presses of the same gear.
   */
  it('asks the endpoint once and answers the next visit from what it already knows', async () => {
    const listModels = vi.fn(() => Promise.resolve(['claude-opus-4-1', 'claude-haiku-4-5']));
    await act(async () => { mount({ listModels }); });
    expect(listModels).toHaveBeenCalledTimes(1);
    cleanup();

    await act(async () => { mount({ listModels }); });
    expect(listModels).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('manage-model-dd'));
    expect(screen.getAllByRole('menuitemradio'), 'the list it already had').toHaveLength(2);
  });

  /** What an endpoint can run is an answer about the credential that asked, so it goes with the key. */
  it('forgets the roster when the key it belongs to is forgotten', async () => {
    const listModels = vi.fn(() => Promise.resolve(['claude-opus-4-1']));
    await act(async () => { mount({ listModels }); });
    fireEvent.click(screen.getByTestId('manage-forget-key'));
    await act(async () => { fireEvent.click(screen.getByTestId('manage-forget-key')); });
    cleanup();

    useAgentConnection.getState().connectKey('claude', 'sk-ant-api03-anotherkey1');
    await act(async () => { mount({ listModels }); });
    expect(listModels).toHaveBeenCalledTimes(2);
  });
});

/**
 * The endpoint address, which is only on this card while the user's own server is armed.
 *
 * The connection screen owns first entry and this card owns every change after, which is what makes a
 * filed address reachable for the rest of the panel's life: without it a gateway that had moved could
 * only be repaired by dropping the key. Editing re-verifies by itself — the same request the card
 * already makes for the model list, asked again at the new address once the hands are still (or on
 * Enter, now) — so an address that answers nothing says so here rather than on the next order, and
 * there is no button to remember to press.
 */
describe('the address of the user\'s own server', () => {
  /** Arms `custom` with a key and an address, which is the state the control is drawn in. */
  const armCustom = (url = 'https://gw.example/v1') => {
    useAgentConnection.getState().setCustomBaseUrl(url);
    useAgentConnection.getState().pinProvider('custom');
    useAgentConnection.getState().connectKey('custom', 'sk-9f2c0123456789abcdef0123456789ab');
  };
  const input = () => screen.getByTestId('manage-endpoint-input');
  const enter = () => { fireEvent.keyDown(input(), { key: 'Enter' }); };

  it('is drawn for custom and for no other provider', async () => {
    await act(async () => { mount(); });
    expect(screen.queryByTestId('manage-endpoint-input'), 'a platform has no address to type').toBeNull();
    cleanup();

    armCustom();
    await act(async () => { mount(); });
    expect((input() as HTMLInputElement).value).toBe('https://gw.example/v1');
  });

  it('opens holding the filed address, so the way back to it is reading it', async () => {
    armCustom('https://old.example/v1');
    await act(async () => { mount({ listModels: () => Promise.resolve(['a']) }); });
    expect((input() as HTMLInputElement).value).toBe('https://old.example/v1');
  });

  it('files a new address on Enter and asks THAT one what it can run', async () => {
    armCustom('https://old.example/v1');
    const listModels = vi.fn(() => Promise.resolve(['a']));
    await act(async () => { mount({ listModels }); });
    expect(listModels).toHaveBeenLastCalledWith({
      provider: 'custom', apiKey: 'sk-9f2c0123456789abcdef0123456789ab', customBaseUrl: 'https://old.example/v1',
    });

    fireEvent.change(input(), { target: { value: 'https://new.example/v1' } });
    await act(async () => { enter(); });

    expect(useAgentConnection.getState().customBaseUrl).toBe('https://new.example/v1');
    expect(listModels).toHaveBeenLastCalledWith({
      provider: 'custom', apiKey: 'sk-9f2c0123456789abcdef0123456789ab', customBaseUrl: 'https://new.example/v1',
    });
  });

  /**
   * The check runs itself. A changed address is filed and asked once the hands are still, on the
   * same quiet the key field advances on: verification is not a step the user takes, it is what the
   * card does with an address it has been given. The quiet restarts per keystroke, so a URL typed a
   * character at a time is one check and not thirty.
   */
  it('files and checks a changed address by itself once the hands are still', async () => {
    armCustom('https://old.example/v1');
    const listModels = vi.fn(() => Promise.resolve(['a']));
    await act(async () => { mount({ listModels }); });
    expect(listModels).toHaveBeenCalledTimes(1);

    vi.useFakeTimers();
    fireEvent.change(input(), { target: { value: 'https://half.example/v1' } });
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(useAgentConnection.getState().customBaseUrl, 'still typing: nothing filed')
      .toBe('https://old.example/v1');

    // A second keystroke inside the quiet restarts it, so the half-typed address is never asked.
    fireEvent.change(input(), { target: { value: 'https://new.example/v1' } });
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(listModels).toHaveBeenCalledTimes(1);

    await act(async () => { vi.advanceTimersByTime(450); });
    expect(useAgentConnection.getState().customBaseUrl).toBe('https://new.example/v1');
    expect(listModels).toHaveBeenCalledTimes(2);
    expect(listModels).toHaveBeenLastCalledWith(expect.objectContaining({ customBaseUrl: 'https://new.example/v1' }));
    vi.useRealTimers();
  });

  /** An unchanged address is left alone: the quiet only ever fires for a draft that differs from
   *  what is filed, so glancing at the card costs no request beyond the mount's own. */
  it('never re-checks an address that has not changed', async () => {
    armCustom();
    const listModels = vi.fn(() => Promise.resolve(['a']));
    await act(async () => { mount({ listModels }); });
    expect(listModels).toHaveBeenCalledTimes(1);
    vi.useFakeTimers();
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(listModels).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  /** Enter on an unchanged address is a deliberate re-check, and the remembered list must not
   *  answer it: the address may have come back since. */
  it('re-asks the same address on Enter', async () => {
    armCustom();
    const listModels = vi.fn(() => Promise.resolve(['a']));
    await act(async () => { mount({ listModels }); });
    expect(listModels).toHaveBeenCalledTimes(1);
    await act(async () => { enter(); });
    expect(listModels).toHaveBeenCalledTimes(2);
  });

  /** An unusable string is refused in place once the hands are still: nothing is filed, and the
   *  note under the field says the address cannot be used. */
  it('refuses an address the app could not reach, and files nothing', async () => {
    armCustom();
    const listModels = vi.fn(() => Promise.resolve(['a']));
    await act(async () => { mount({ listModels }); });

    vi.useFakeTimers();
    fireEvent.change(input(), { target: { value: 'not a url' } });
    await act(async () => { vi.advanceTimersByTime(950); });
    expect(screen.getByTestId('manage-endpoint-note').textContent)
      .toBe(translations.en['agent.setup_endpoint_invalid']);
    expect(useAgentConnection.getState().customBaseUrl).toBe('https://gw.example/v1');
    expect(listModels).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  /** The wait rides the pill itself, trailing the text — the check is about this field, so its
   *  sign stands inside it rather than opening a row — and the sub-line carries verdicts alone:
   *  an address that answered nothing, and quiet where the address answered. The wait is the
   *  loading idiom, never a sentence of its own. */
  it('stands one spinner for the listing even with the model menu open', async () => {
    armCustom();
    await act(async () => { mount({ listModels: () => new Promise<string[]>(() => {}) }); });
    fireEvent.click(screen.getByTestId('manage-model-dd'));
    expect(document.querySelectorAll('.pw-busy')).toHaveLength(1);
  });

  it('spins inside the pill while the request is out, and says nothing where the address answered', async () => {
    armCustom();
    let settle: (ids: string[]) => void = () => {};
    await act(async () => {
      mount({ listModels: () => new Promise<string[]>((resolve) => { settle = resolve; }) });
    });
    const pill = () => screen.getByTestId('manage-endpoint-input').closest('label')!;
    const note = () => screen.getByTestId('manage-endpoint-note');
    expect(pill().querySelector('.pw-busy'), 'the request is out: the spinner in the pill').toBeTruthy();
    expect(note().querySelector('.pw-busy'), 'the note row carries no spinner').toBeNull();
    expect(note().textContent, 'the wait carries no sentence').toBe('');
    await act(async () => { settle(['a']); });
    expect(pill().querySelector('.pw-busy'), 'the spinner leaves with the request').toBeNull();
    expect(note().textContent, 'an address that answered has nothing to explain').toBe('');

    cleanup();
    forgetRosters();
    await act(async () => { mount({ listModels: () => Promise.reject(new Error('Failed to fetch')) }); });
    expect(screen.getByTestId('manage-endpoint-note').textContent)
      .toBe(translations.en['agent.setup_list_unavailable']);
  });

  /** The address survives the page, which is the other half of being able to change it: it is written
   *  through the one storage door and read back sanitized on the next boot. */
  it('is on disk after the check, and comes back from disk', async () => {
    armCustom('https://gw.example/v1');
    await act(async () => { mount({ listModels: () => Promise.resolve(['a']) }); });
    fireEvent.change(input(), { target: { value: 'https://kept.example/v1/' } });
    await act(async () => { enter(); });

    // A fresh boot: the store is put back to its defaults and hydrated off the same disk.
    await act(async () => {
      useAgentConnection.setState({ customBaseUrl: '', provider: 'claude', hydrated: false });
      await useAgentConnection.getState().hydrate();
    });
    await act(async () => {});
    expect(useAgentConnection.getState().customBaseUrl, 'the trailing slash is the sanitizer\'s')
      .toBe('https://kept.example/v1');
    expect(useAgentConnection.getState().provider).toBe('custom');
  });
});

/**
 * What a change on this card applies to, and what it says about it.
 *
 * A connection change reaches the next job (the rule and its argument live at the config-read seam,
 * `agent/exec/runner-host.ts`), so the card's job is to say so at the moment of the press and never to
 * pretend the running job has moved. The note is the house toast rather than a line on the card: the
 * fact is about a moment, and a row that appeared would move the card at the instant it was being
 * used, which is the same rule the destructive verbs' spacer exists for.
 *
 * Said once per live job, not once per press. A model typed a character at a time is one change, and
 * the note is a note rather than forty of them.
 */
describe('a change made over a running job says which job it reaches', () => {
  const LIVE = { providerId: 'claude' as const, model: 'claude-sonnet-4-5' };

  it('says nothing at all while no job is running', async () => {
    await act(async () => { mount({ listModels: () => Promise.resolve(['a', 'b']) }); });
    await act(async () => { fireEvent.click(screen.getByTestId('manage-model-dd')); });
    await act(async () => { fireEvent.click(screen.getByText(prettyModel('b'))); });
    expect(toasts).toEqual([]);
    expect(useAgentConnection.getState().model.claude).toBe('b');
  });

  it('says it once when the model is changed over a live job, and not again for the same job', async () => {
    await act(async () => { mount({ liveConnection: LIVE, listModels: () => Promise.resolve(['a', 'b']) }); });
    await act(async () => { fireEvent.click(screen.getByTestId('manage-model-dd')); });
    await act(async () => { fireEvent.click(screen.getByText(prettyModel('b'))); });
    expect(toasts).toEqual([translations.en['agent.setup_manage_next_job']]);

    await act(async () => { fireEvent.click(screen.getByTestId('manage-model-dd')); });
    await act(async () => { fireEvent.click(screen.getByText('Default model (A)')); });
    expect(toasts, 'one note per job, not per press').toHaveLength(1);
  });

  it('says it when the provider is changed over a live job', async () => {
    await act(async () => { mount({ liveConnection: LIVE, listModels: () => Promise.resolve(['a']) }); });
    await act(async () => { fireEvent.click(screen.getByTestId('manage-prov-row')); });
    await act(async () => { fireEvent.click(screen.getByText(PROVIDER_META.openai.name)); });
    expect(toasts).toEqual([translations.en['agent.setup_manage_next_job']]);
  });

  /** Oversight is the exception and must not be noted: it is read live at every gate decision, so it
   *  reaches the next write of the job already running. A note saying otherwise would be false. */
  it('says nothing for oversight, which the running job does answer to', async () => {
    await act(async () => { mount({ liveConnection: LIVE, listModels: () => Promise.resolve(['a']) }); });
    await act(async () => { fireEvent.click(screen.getByText(translations.en['agent.oversight_yolo']!)); });
    expect(useAgentConnection.getState().oversight).toBe('yolo');
    expect(toasts).toEqual([]);
  });
});

describe('model discovery preserves explicit selections', () => {
  const armCustom = (url = 'https://gw.example/v1') => {
    useAgentConnection.getState().setCustomBaseUrl(url);
    useAgentConnection.getState().pinProvider('custom');
    useAgentConnection.getState().connectKey('custom', 'sk-9f2c0123456789abcdef0123456789ab');
    useAgentConnection.setState({ model: { ...emptyModels(), custom: 'kept-model' } });
  };

  /** Files a new address (Enter is the immediate spelling of the same self-running check) and lets
   *  the list for it settle. */
  const fileAddress = async (url: string) => {
    fireEvent.change(screen.getByTestId('manage-endpoint-input'), { target: { value: url } });
    await act(async () => { fireEvent.keyDown(screen.getByTestId('manage-endpoint-input'), { key: 'Enter' }); });
  };

  it('keeps the model where the new address serves it, and says nothing about a swap', async () => {
    armCustom();
    await act(async () => { mount({ listModels: () => Promise.resolve(['kept-model', 'other']) }); });
    await fileAddress('https://new.example/v1');
    expect(useAgentConnection.getState().model.custom).toBe('kept-model');
    expect(toasts).toEqual([]);
  });

  it('preserves the chosen model when a new address lists different models', async () => {
    armCustom();
    await act(async () => { mount({ listModels: () => Promise.resolve(['served-a', 'served-b']) }); });
    await fileAddress('https://new.example/v1');
    expect(useAgentConnection.getState().model.custom).toBe('kept-model');
    expect(toasts).toEqual([]);
    expect(screen.getByTestId('manage-model-face').textContent).toBe(prettyModel('kept-model'));
  });

  it('keeps a typed model when the address lists nothing without adding it to suggestions', async () => {
    armCustom();
    await act(async () => { mount({ listModels: () => Promise.resolve([]) }); });
    await fileAddress('https://bare.example/v1');

    expect(useAgentConnection.getState().model.custom, 'an absent list proves nothing').toBe('kept-model');
    expect(toasts).toEqual([]);
    expect(screen.getByTestId('manage-endpoint-note').textContent).toBe('');
    fireEvent.click(screen.getByTestId('manage-model-dd'));
    expect(screen.queryAllByRole('menuitemradio')).toHaveLength(0);
  });

  it.each(['listed', 'failed'])('shows only loading feedback while refreshing a %s response', async (previous) => {
    armCustom();
    let resolveList!: (models: string[]) => void;
    const refreshing = new Promise<string[]>((resolve) => { resolveList = resolve; });
    const listModels = vi.fn().mockImplementationOnce(() => previous === 'listed'
      ? Promise.resolve(['listed-model']) : Promise.reject(new Error('Failed to fetch')))
      .mockImplementationOnce(() => refreshing);
    await act(async () => { mount({ listModels }); });
    expect(screen.getByTestId('manage-endpoint-note').textContent)
      .toBe(previous === 'listed' ? '' : translations.en['agent.setup_list_unavailable']);

    fireEvent.click(screen.getByTestId('manage-refresh-models'));
    expect((screen.getByTestId('manage-refresh-models') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('manage-endpoint-note').textContent).toBe('');
    fireEvent.click(screen.getByTestId('manage-model-dd'));
    expect(screen.queryAllByRole('menuitemradio')).toHaveLength(0);
    expect(screen.getByTestId('manage-model-face').textContent).toBe(prettyModel('kept-model'));

    await act(async () => { resolveList(['fresh-model']); });
    expect(screen.getByTestId('manage-endpoint-note').textContent).toBe('');
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(1);
    expect(screen.getByRole('menuitemradio').textContent).toContain(prettyModel('fresh-model'));
    expect(useAgentConnection.getState().model.custom).toBe('kept-model');
  });

  /** A gear press is not an address change. The card is opened to read the oversight caption as often
   *  as to change anything, and re-picking a model the user chose because a partial catalogue omits it
   *  would be the card overruling them. */
  it('leaves the filed model alone when the card merely opens on a list that omits it', async () => {
    armCustom();
    await act(async () => { mount({ listModels: () => Promise.resolve(['served-a']) }); });
    expect(useAgentConnection.getState().model.custom).toBe('kept-model');
    expect(toasts).toEqual([]);
  });

  it('keeps a model editable when discovery fails and preserves it when the list returns', async () => {
    armCustom();
    let answer: () => Promise<string[]> = () => Promise.resolve(['kept-model']);
    await act(async () => { mount({ listModels: () => answer() }); });
    const done = () => screen.getByTestId('manage-done') as HTMLButtonElement;
    answer = () => Promise.reject(new Error('Failed to fetch'));
    await fileAddress('https://listless.example/v1');
    expect(screen.getByTestId('manage-endpoint-note').textContent).toBe(translations.en['agent.setup_list_unavailable']);
    expect(useAgentConnection.getState().model.custom).toBe('kept-model');
    expect(done().disabled).toBe(false);
    expect(screen.queryByTestId('manage-model-blocked')).toBeNull();
    fireEvent.click(screen.getByTestId('manage-model-dd'));
    for (const value of ['e', 'ep', 'ep-', 'ep-my-model']) {
      fireEvent.change(screen.getByTestId('manage-model-input'), { target: { value } });
      expect((screen.getByTestId('manage-model-input') as HTMLInputElement).value).toBe(value);
    }
    expect(useAgentConnection.getState().model.custom).toBe('kept-model');
    fireEvent.keyDown(screen.getByTestId('manage-model-input'), { key: 'Enter' });
    expect(useAgentConnection.getState().model.custom).toBe('ep-my-model');
    answer = () => Promise.resolve(['ep-my-model', 'other']);
    await fileAddress('https://listed.example/v1');
    expect(screen.getByTestId('manage-endpoint-note').textContent).toBe('');
    expect(useAgentConnection.getState().model.custom).toBe('ep-my-model');
    expect(done().disabled).toBe(false);
    expect(toasts).toEqual([]);
  });

  /** The other side of the boundary: a server that answers badly (here an auth refusal) is reachable,
   *  so the typed id keeps the trust an empty catalogue earns and the door stays open. */
  it('keeps the model where the server answers without a list, whatever the refusal was', async () => {
    armCustom();
    await act(async () => {
      mount({ listModels: () => Promise.reject(Object.assign(new Error('Unauthorized'), { status: 401 })) });
    });
    await fileAddress('https://auth.example/v1');
    expect(useAgentConnection.getState().model.custom).toBe('kept-model');
    expect(screen.getByTestId('manage-endpoint-note').textContent).toBe('');
    expect((screen.getByTestId('manage-done') as HTMLButtonElement).disabled).toBe(false);
  });

  it('preserves the chosen model when a repaired address lists different models', async () => {
    armCustom();
    let answer: () => Promise<string[]> = () => Promise.reject(new Error('Failed to fetch'));
    await act(async () => { mount({ listModels: () => answer() }); });
    expect(screen.getByTestId('manage-endpoint-note').textContent)
      .toBe(translations.en['agent.setup_list_unavailable']);
    // A gear press is not a check: the fetch this card makes on mount failing must not empty a pick
    // the user made — only a check they pressed carries that authority.
    expect(useAgentConnection.getState().model.custom, 'a glance clears nothing').toBe('kept-model');

    answer = () => Promise.resolve(['only-this']);
    await fileAddress('https://fixed.example/v1');
    expect(useAgentConnection.getState().model.custom).toBe('kept-model');
    expect(toasts).toEqual([]);
  });
});

/**
 * The boundary between a failed endpoint and an unavailable list, as one table over the failure
 * shapes the deadline-bounded check settles with (`setup-parts.ts:endpointCheckVerdict`). A failed
 * endpoint is a check nothing answered (or that no request could be built for); everything with a
 * server behind it, however unhelpful the answer, is a list that is merely unavailable.
 */
describe('what counts as the endpoint failing its check', () => {
  const UNREACHABLE: [string, unknown][] = [
    ['a fetch that failed', new Error('Failed to fetch')],
    ['a check the deadline ended', new Error('The endpoint answered nothing in 8s; the request timed out.')],
    ['a CORS-shaped opaque refusal', Object.assign(new Error('blocked'), { status: 0 })],
    ['a request that could not be built', new Error(NO_ENDPOINT_ADDRESS)],
  ];
  const ANSWERED: [string, unknown][] = [
    ['an auth refusal', Object.assign(new Error('Unauthorized'), { status: 401 })],
    ['a rate limit', Object.assign(new Error('Too many requests'), { status: 429 })],
    ['a gateway with no models route', Object.assign(new Error('Not Found'), { status: 404 })],
    ['a server fault', Object.assign(new Error('Internal Server Error'), { status: 500 })],
  ];

  it.each(UNREACHABLE)('%s is the endpoint failing', (_name, err) => {
    expect(endpointCheckVerdict(err)).toBe('unreachable');
  });

  it.each(ANSWERED)('%s is a server that answered, so only the list is unavailable', (_name, err) => {
    expect(endpointCheckVerdict(err)).toBe('no-list');
  });
});

/** The rows read top-down in the order they depend on each other: the provider names the platform, the
 *  address decides which models exist, the model is chosen from what the address offers. A model row
 *  above the address would ask the user to choose from a list the row below has not established. */
describe('the card reads in dependency order', () => {
  it('stands the address between the provider and the model', async () => {
    useAgentConnection.getState().setCustomBaseUrl('https://gw.example/v1');
    useAgentConnection.getState().pinProvider('custom');
    useAgentConnection.getState().connectKey('custom', 'sk-9f2c0123456789abcdef0123456789ab');
    await act(async () => { mount({ listModels: () => Promise.resolve(['a']) }); });

    const card = screen.getByTestId('manage-screen');
    const order = ['manage-prov-row', 'manage-endpoint-input', 'manage-model-dd']
      .map((id) => [...card.querySelectorAll('[data-testid]')]
        .findIndex((el) => el.getAttribute('data-testid') === id));
    expect(order.every((n) => n >= 0), 'all three rows are drawn').toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

/** Both dropdowns use the shared floating-menu card and its uniform radius. */
describe('the dropdowns on this card are the house menu', () => {
  /** jsdom preserves the shorthand rather than expanding its four sides. */
  const declaredRadius = (el: HTMLElement) => el.style.borderRadius;

  it.each(['manage-prov-row', 'manage-model-dd'])('opens a round-cornered house card from %s', (row) => {
    mount({ jobCount: 1 });
    fireEvent.click(screen.getByTestId(row));

    const card = screen.getByRole(row === 'manage-model-dd' ? 'group' : 'menu');
    expect(card.getAttribute('aria-label')).toBeTruthy();
    // One radius, four corners: `radii.lg` as the shared card declares it, with nothing partial.
    expect(declaredRadius(card)).toBe(`${radii.lg}px`);
    expect(declaredRadius(card).trim().split(/\s+/), 'a per-corner declaration').toHaveLength(1);
    // And the card is border-box, which is what keeps its own padding and edge from carrying its
    // right corners past the row it hangs from.
    expect(getComputedStyle(card).boxSizing).toBe('border-box');
  });

  /** A second popover of this card's own making would be a second answer to how a list looks. */
  it('renders no card of its own beside it', () => {
    mount({ jobCount: 1 });
    const own = [...screen.getByTestId('manage-screen').querySelectorAll<HTMLElement>('*')]
      .filter((el) => getComputedStyle(el).position === 'fixed');
    expect(own, 'the manage card mounts no floating surface itself').toEqual([]);
  });
});

describe('manage copy, in every locale', () => {
  const KEYS = [
    'agent.setup_manage_forget_key', 'agent.setup_manage_forget_q',
    'agent.setup_manage_clear_jobs', 'agent.setup_manage_clear_q',
    'agent.setup_manage_stop_job', 'agent.setup_manage_set_aside',
    'agent.dock_connection', 'agent.action_cancel', 'agent.setup_oversight',
    'agent.setup_manage_endpoint', 'agent.setup_manage_model',
    'agent.setup_list_unavailable', 'agent.setup_manage_model_needs_endpoint',
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

  it('keeps the {n} token in both counted lines', () => {
    for (const loc of locales) {
      for (const key of ['agent.setup_manage_clear_jobs', 'agent.setup_manage_clear_q']) {
        expect(translations[loc][key], `${loc}/${key}`).toContain('{n}');
      }
    }
  });
});
