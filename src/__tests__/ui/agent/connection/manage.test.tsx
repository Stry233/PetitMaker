// @vitest-environment jsdom
/**
 * The manage card behind the gear: provider, endpoint address (for `custom` only), model, oversight,
 * the two destructive verbs (each asks in a question that unrolls from its pill without moving the
 * card) and a held job's stop and set-aside.
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

/** A list request that never settles, so no state update lands outside the test's own `act`. */
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

/** Every toast the card raises during one test. */
let toasts: string[] = [];
let unsubscribeToasts: (() => void) | undefined;

beforeEach(async () => {
  toasts = [];
  unsubscribeToasts = setToastPresenter((text) => { toasts.push(text); });
  backing.clear();
  // Rosters are remembered per session, and this file is one session.
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

  /** The dropdown's face is a bare id, so the row carries a label like the other rows. */
  it('titles the model row, in the card\'s own label idiom', () => {
    mount();
    expect(screen.getByTestId('manage-model-label').textContent)
      .toBe(translations.en['agent.setup_manage_model']);
  });

  /** Oversight is set here and nowhere else; setup's suite holds the other half of that rule. */
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

});

/** A destructive verb opens a question anchored to its pill; its confirm answers and a press
 *  elsewhere cancels. The card's landmarks stay the same nodes in the same places throughout. */
describe('the two destructive verbs ask first', () => {
  /** Where every test id in the card stands, to compare before and after a question. */
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
    expect(question('manage-forget-key')).toBe(translations.en['agent.setup_manage_forget_q']);
    expect(screen.getByTestId('manage-forget-key').textContent).toContain(translations.en['agent.setup_manage_forget_key']);
    expect(useAgentConnection.getState().keyed, 'nothing has happened yet').toContain('claude');

    answer('manage-forget-key');
    expect(useAgentConnection.getState().keyed).toEqual([]);
    expect(isConnected(useAgentConnection.getState())).toBe(false);
    // The provider pin goes with the key.
    expect(useAgentConnection.getState().providerPinned).toBe(false);
  });

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

  /** A pause over a gated job deadlocks: the pause hides the gate card, and the loop honours a pause
   *  only at a call boundary, which the gate never reaches. */
  it('never offers set-aside except where the job is waiting on a clock', () => {
    const gated = mount({ stoppable: true, parkable: false });
    expect(screen.getByTestId('manage-stop')).toBeTruthy();
    expect(screen.queryByTestId('manage-set-aside'), 'a gate must not be offered a pause').toBeNull();
    gated.unmount();

    mount({ stoppable: true, parkable: true });
    expect(screen.getByTestId('manage-set-aside')).toBeTruthy();
  });

  /** Guards the verb rather than the test id: every control over a gated job is pressed, and none
   *  may reach the pause or offer one in its words. */
  it('reaches the pause verb from no control at all while the job waits on the user', () => {
    const park = vi.fn();
    const props = { stoppable: true, parkable: false, jobCount: 2, onSetAside: park, onStopJob: vi.fn() };
    const buttons = () => [...screen.getByTestId('manage-screen').querySelectorAll('button')];

    const first = mount(props);
    const count = buttons().length;
    const words = screen.getByTestId('manage-screen').textContent ?? '';
    expect(count, 'nothing was pressed, so nothing is proven').toBeGreaterThan(3);
    first.unmount();

    // One press per mount, since a press can detach other controls; whatever it reveals is pressed too.
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

  /** The held-job row stays put while a question is up, so the card does not change height. */
  it('leaves them where they stand while a question is up', () => {
    mount({ stoppable: true, parkable: true, jobCount: 1 });
    const held = screen.getByTestId('manage-held');
    fireEvent.click(screen.getByTestId('manage-forget-key'));
    expect(screen.getByTestId('manage-held')).toBe(held);
  });
});

describe('the list the card asks for', () => {
  it('asks for the armed provider\'s models, and survives a refusal', async () => {
    const listModels = vi.fn(() => Promise.reject(new Error('offline')));
    await act(async () => { mount({ listModels }); });
    expect(listModels).toHaveBeenCalledWith({ provider: 'claude', apiKey: 'sk-ant-api03-abcdefghijkl' });
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

  /** One list request per endpoint per session, so opening the gear does not spend rate limit. */
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

  /** A roster belongs to the credential that asked for it. */
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

/** The endpoint address, shown while `custom` is armed. The connection screen owns first entry and
 *  this card every later change; an edit is filed and re-checked with a model-list request once
 *  typing pauses, or at once on Enter. */
describe('the address of the user\'s own server', () => {
  /** Arms `custom` with a key and an address. */
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

  /** The quiet is the key field's `IDLE_MS` and restarts per keystroke, so typing a URL costs one
   *  check. */
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

    fireEvent.change(input(), { target: { value: 'https://new.example/v1' } });
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(listModels).toHaveBeenCalledTimes(1);

    await act(async () => { vi.advanceTimersByTime(450); });
    expect(useAgentConnection.getState().customBaseUrl).toBe('https://new.example/v1');
    expect(listModels).toHaveBeenCalledTimes(2);
    expect(listModels).toHaveBeenLastCalledWith(expect.objectContaining({ customBaseUrl: 'https://new.example/v1' }));
    vi.useRealTimers();
  });

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

  /** Enter is a deliberate re-check, so the remembered list does not answer it. */
  it('re-asks the same address on Enter', async () => {
    armCustom();
    const listModels = vi.fn(() => Promise.resolve(['a']));
    await act(async () => { mount({ listModels }); });
    expect(listModels).toHaveBeenCalledTimes(1);
    await act(async () => { enter(); });
    expect(listModels).toHaveBeenCalledTimes(2);
  });

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

  /** The wait shows as one spinner inside the address pill; the note below carries only verdicts. */
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

  /** The address is stored and read back sanitized on the next boot. */
  it('is on disk after the check, and comes back from disk', async () => {
    armCustom('https://gw.example/v1');
    await act(async () => { mount({ listModels: () => Promise.resolve(['a']) }); });
    fireEvent.change(input(), { target: { value: 'https://kept.example/v1/' } });
    await act(async () => { enter(); });

    // A fresh boot: store defaults, hydrated from the same storage.
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

/** A connection change reaches only the next job (`agent/exec/runner-host.ts`), so over a running job
 *  the card says so in a toast, once per live job. */
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

  /** Oversight is read live at every gate decision, so it does reach the running job. */
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

  /** Files a new address with Enter and lets its list settle. */
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

  /** A server that refuses (here auth) is still reachable, so no failure note is shown. */
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
    expect(useAgentConnection.getState().model.custom, 'a glance clears nothing').toBe('kept-model');

    answer = () => Promise.resolve(['only-this']);
    await fileAddress('https://fixed.example/v1');
    expect(useAgentConnection.getState().model.custom).toBe('kept-model');
    expect(toasts).toEqual([]);
  });
});

/** `setup-parts.ts:endpointCheckVerdict`: an endpoint fails when nothing answered or no request could
 *  be built; any server answer, however unhelpful, only makes the list unavailable. */
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

/** The rows follow their dependencies: provider, then the address, then the models it offers. */
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
