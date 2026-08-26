/**
 * manage.test.tsx — the gear's one door.
 *
 * FIVE CONTROLS AND TWO CONFIRMS, and the file is mostly about the two: a destructive verb that
 * fires on the first press is the one defect a settings card cannot ship with, and a card that grows
 * for a question moves the target the hand is already travelling toward. Each verb BECOMES its own
 * question, so what is asserted is that the landmark structure is identical before and after a press,
 * that the second press on the same button is what reaches the vault, and that a press anywhere else
 * puts the words back.
 *
 * THE HELD JOB'S VERBS ARE THE OTHER HALF, and the assertion there is a NEGATIVE one: a gated job
 * offers stop and never set-aside. Pausing withholds the gate card and the loop honours a pause only
 * at a call boundary, so a pause offered over a gate is a deadlock with two locked doors.
 *
 * THE ENDPOINT ADDRESS IS HERE TOO, for `custom` alone: this card is the way BACK to an address the
 * connection screen has already taken, and its own section below holds what that costs. THE CHECK
 * RUNS ITSELF — there is no button for it — so what the sections below pin is the trigger boundary:
 * a CHANGED address files itself after the quiet (or on Enter) and its check carries the authority
 * to file a failed verdict, while the fetch a mere gear press makes notes a failure and clears
 * nothing.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { I18nProvider } from '../../../i18n/context';
import { translations } from '../../../i18n/translations';
import { useEditorStore } from '../../../state/store';
import { ManageScreen } from '../../../ui/agent/ManageScreen';
import { forgetRosters } from '../../../ui/agent/model-roster';
import { isConnected, useAgentPanelSettings } from '../../../ui/agent/settings';
import { prettyModel } from '../../../ui/agent/pretty-model';
import { endpointCheckVerdict } from '../../../ui/agent/setup-parts';
import { NO_ENDPOINT_ADDRESS } from '../../../agent/core/errors';
import { PROVIDER_IDS, PROVIDER_META, type ProviderId } from '../../../agent/providers/defaults';
import { colors, UNAVAILABLE } from '../../../ui/design/styles';
import { radii } from '../../../ui/design/styles';
import { roleFont } from '../../../ui/design/text-weight';
import type { Locale } from '../../../core/model/types';
import { setToastPresenter } from '../../../core/runtime/toast-bus';

const backing = new Map<string, string>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).localStorage = {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
};

/** jsdom normalizes a colour to `rgb()`, so a declared token is compared by writing it to a
 *  throwaway element and reading back the same form. */
function asCss(color: string): string {
  const probe = document.createElement('span');
  probe.style.color = color;
  return probe.style.color;
}

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

beforeEach(() => {
  toasts = [];
  unsubscribeToasts = setToastPresenter((text) => { toasts.push(text); });
  backing.clear();
  // The remembered rosters are a SESSION fact and this module is one session for the whole file, so
  // one test's answered list would otherwise stand in for the next test's request.
  forgetRosters();
  useEditorStore.setState({ locale: 'en' });
  const model = emptyModels();
  model.claude = 'claude-sonnet-4-5';
  useAgentPanelSettings.setState({
    provider: 'claude', model, oversight: 'checkpoint',
    customBaseUrl: '', endpointDown: '', formerModel: '', keyed: [], providerPinned: false, hydrated: true,
  });
  for (const id of PROVIDER_IDS) useAgentPanelSettings.getState().forgetKey(id);
  useAgentPanelSettings.getState().connectKey('claude', 'sk-ant-api03-abcdefghijkl');
  backing.clear();
});

afterEach(() => { unsubscribeToasts?.(); cleanup(); });

describe('what stands behind the gear', () => {
  it('draws the provider row, the model list, oversight and both management verbs', () => {
    mount({ jobCount: 3 });
    expect(screen.getByTestId('manage-prov-face').getAttribute('data-provider')).toBe('claude');
    expect(screen.getByTestId('manage-model-face').textContent).toBeTruthy();
    expect(screen.getByTestId('manage-oversight-caption').textContent)
      .toBe(translations.en['agent3.oversight_checkpoint_caption']);
    expect(screen.getByTestId('manage-forget-key')).toBeTruthy();
    expect(screen.getByTestId('manage-clear-jobs')).toBeTruthy();
    expect(screen.getByTestId('manage-done')).toBeTruthy();
  });

  /** THE MODEL ROW SAYS WHAT IT IS. The dropdown's face is a bare id, so the row carries the same
   *  small label the endpoint and oversight rows are titled by, whatever provider is armed. */
  it('titles the model row, in the card\'s own label idiom', () => {
    mount();
    expect(screen.getByTestId('manage-model-label').textContent)
      .toBe(translations.en['agent3.setup_manage_model']);
  });

  /** THE CARD'S TEXTS SAY ONLY WHAT THE STATE NEEDS. The standing explainers are retired — what a
   *  destructive verb does not take is carried by its own question — and so is the endpoint's
   *  press-to-verify button: the check runs itself off the same events that re-judge the connection. */
  it('carries no standing explainer prose and no check button', () => {
    mount({ jobCount: 3 });
    for (const id of ['manage-forget-note', 'manage-clear-note', 'manage-endpoint-check']) {
      expect(screen.queryByTestId(id), id).toBeNull();
    }
  });

  /** OVERSIGHT LIVES HERE AND NOWHERE ELSE, and this is the half of that rule this file can hold
   *  (setup's own suite holds the other). */
  it('is where oversight is asked, and writes the settings slice', () => {
    mount();
    fireEvent.click(screen.getByText(translations.en['agent3.oversight_strict']!));
    expect(useAgentPanelSettings.getState().oversight).toBe('strict');
    expect(screen.getByTestId('manage-oversight-caption').textContent)
      .toBe(translations.en['agent3.oversight_strict_caption']);

    fireEvent.click(screen.getByText(translations.en['agent3.oversight_yolo']!));
    expect(useAgentPanelSettings.getState().oversight).toBe('yolo');
  });

  it('pins the provider a press names, so no shape reading can overrule it later', () => {
    mount();
    fireEvent.click(screen.getByTestId('manage-prov-row'));
    fireEvent.click(screen.getByText(PROVIDER_META.gemini.name));
    expect(useAgentPanelSettings.getState().provider).toBe('gemini');
    expect(useAgentPanelSettings.getState().providerPinned).toBe(true);
  });

  it('offers the model already filed when no list arrives, rather than an empty row', () => {
    mount();
    fireEvent.click(screen.getByTestId('manage-model-dd'));
    const rows = screen.getAllByRole('menuitemradio');
    expect(rows).toHaveLength(1);
    fireEvent.click(rows[0]!);
    expect(useAgentPanelSettings.getState().model.claude).toBe('claude-sonnet-4-5');
  });

  it('hands the caller its own Done', () => {
    const done = vi.fn();
    mount({ onDone: done });
    fireEvent.click(screen.getByTestId('manage-done'));
    expect(done).toHaveBeenCalledTimes(1);
  });

  /**
   * ONE ROW, ONE RUNG. The provider row, the model row and every row inside the list they open are
   * the same kind of thing — a choice being named — and they are drawn at one size and one weight.
   *
   * A split rendering (closed rows and inactive list rows at `label`, the active row at `menu`) says
   * "which is chosen" twice (the yellow fill AND a heavier face) while saying "these are all choices"
   * at two ranks; on the glass that reads as the rows being a rung lighter than the pills and the
   * footer around them.
   *
   * A rung is a (size, weight) pair, so both are asserted: `roleWeight` resolves through a custom
   * property the surface publishes, so what is compared is the DECLARED rung rather than a number
   * jsdom happens to compute.
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
 * THE VERB BECOMES ITS OWN QUESTION. One press turns the button's words into the locale's question
 * form and its fill danger; a second press on the SAME button is the answer, and anything else
 * cancels. So the card cannot grow for a question at all, which is what these tests hold: the
 * landmark structure before and after a press is the same nodes, in the same order, in the same
 * parents.
 */
describe('the two destructive verbs ask first', () => {
  /** Where every landmark in the card stands. jsdom lays nothing out, so a rect comparison is a
   *  comparison of zeroes; what is checkable is the thing that MAKES the geometry stable, which is
   *  that nothing was inserted, removed, reordered or remounted. */
  function landmarks(): { id: string; parent: Element | null; index: number }[] {
    return [...screen.getByTestId('manage-screen').querySelectorAll<HTMLElement>('[data-testid]')]
      .map((el) => ({
        id: el.dataset.testid ?? '',
        parent: el.parentElement,
        index: [...(el.parentElement?.children ?? [])].indexOf(el),
      }));
  }

  it('asks before forgetting the key, then clears the vault and lands disconnected', () => {
    mount();
    expect(isConnected(useAgentPanelSettings.getState())).toBe(true);

    fireEvent.click(screen.getByTestId('manage-forget-key'));
    // The SAME button, now asking: its words are the question and its fill is the danger one.
    const armed = screen.getByTestId('manage-forget-key');
    expect(armed.textContent).toContain(translations.en['agent3.setup_manage_forget_q']);
    expect(armed.style.color).toBe(asCss(colors.dangerText));
    expect(useAgentPanelSettings.getState().keyed, 'nothing has happened yet').toContain('claude');

    fireEvent.click(screen.getByTestId('manage-forget-key'));
    expect(useAgentPanelSettings.getState().keyed).toEqual([]);
    expect(isConnected(useAgentPanelSettings.getState())).toBe(false);
    // The pin goes with the key: a provider named for a key that is gone must not answer for the
    // next one.
    expect(useAgentPanelSettings.getState().providerPinned).toBe(false);
  });

  /** THE CARD DOES NOT ASK FOR SPACE. Nothing appears, nothing is withdrawn, and what each verb
   *  spares was already standing under it before the first press. */
  it('adds and takes away nothing when either verb is armed', () => {
    mount({ jobCount: 4, stoppable: true, parkable: true });
    for (const verb of ['manage-forget-key', 'manage-clear-jobs']) {
      const before = landmarks();
      fireEvent.click(screen.getByTestId(verb));
      expect(landmarks(), verb).toEqual(before);
      // The held job's verbs stand where they were, hushed rather than withdrawn.
      expect(screen.getByTestId('manage-held').style.opacity).toBe(String(UNAVAILABLE));
      fireEvent.pointerDown(screen.getByTestId('manage-done'));
      expect(landmarks(), `${verb} cancelled`).toEqual(before);
    }
  });

  it('puts the words back when the press lands anywhere else', () => {
    mount();
    fireEvent.click(screen.getByTestId('manage-forget-key'));
    fireEvent.pointerDown(screen.getByTestId('manage-oversight-caption'));
    expect(screen.getByTestId('manage-forget-key').textContent)
      .toContain(translations.en['agent3.setup_manage_forget_key']);
    expect(useAgentPanelSettings.getState().keyed).toContain('claude');
  });

  it('names the count the clear verb would take, and only fires on the answer', () => {
    const cleared = vi.fn();
    mount({ jobCount: 4, onClearJobs: cleared });
    expect(screen.getByTestId('manage-clear-jobs').textContent)
      .toContain(translations.en['agent3.setup_manage_clear_jobs']!.replace('{n}', '4'));

    fireEvent.click(screen.getByTestId('manage-clear-jobs'));
    expect(cleared).not.toHaveBeenCalled();
    expect(screen.getByTestId('manage-clear-jobs').textContent)
      .toContain(translations.en['agent3.setup_manage_clear_q']!.replace('{n}', '4'));

    fireEvent.click(screen.getByTestId('manage-clear-jobs'));
    expect(cleared).toHaveBeenCalledTimes(1);
  });

  it('refuses to ask about a record that is not there', () => {
    mount({ jobCount: 0 });
    expect((screen.getByTestId('manage-clear-jobs') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('manage-clear-jobs'));
    expect(screen.getByTestId('manage-clear-jobs').textContent)
      .toContain(translations.en['agent3.setup_manage_clear_jobs']!.replace('{n}', '0'));
  });

  it('holds one question at a time', () => {
    mount({ jobCount: 2 });
    fireEvent.click(screen.getByTestId('manage-forget-key'));
    expect(
      [...screen.getByTestId('manage-screen').querySelectorAll('[data-confirm-armed]')],
    ).toHaveLength(1);
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
   * THE ONE THING THIS CARD MAY NOT OFFER. A pause withholds the gate card and the loop honours a
   * pause only at a call boundary, so over a job that is waiting on the user's own answer both doors
   * are locked: the gate cannot be answered because its card is gone, and the pause cannot land
   * because the call has not returned. Set-aside is for a job waiting on a CLOCK.
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
   * AND THE GUARD IS THE VERB, NOT THE TESTID. A deadlock is a class of control rather than one
   * named button: a second pill offered under any other name, wired to the same pause, ships past an
   * assertion that only looks for `manage-set-aside`. So every control the card renders over a GATED
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

    // ONE PRESS PER MOUNT, because a press can take another control away with it (a confirm
    // replaces its trigger), and a control detached by an earlier press is a control this would
    // never have tried. Whatever a press REVEALS is pressed too, in that same mount.
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

  /** A standing question outranks them, and they stand HUSHED for it rather than leaving: a row that
   *  withdraws is the card changing height under the question it has just been asked. */
  it('hushes them where they stand while a question is up', () => {
    mount({ stoppable: true, parkable: true, jobCount: 1 });
    const held = screen.getByTestId('manage-held');
    expect(held.style.opacity).toBe('');

    fireEvent.click(screen.getByTestId('manage-forget-key'));
    expect(screen.getByTestId('manage-held')).toBe(held);
    expect(held.style.opacity).toBe(String(UNAVAILABLE));
    expect(held.style.pointerEvents).toBe('none');
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

  /**
   * ONE REQUEST PER ENDPOINT PER SESSION. The gear is the panel's one settings door, so a fetch per
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

    useAgentPanelSettings.getState().connectKey('claude', 'sk-ant-api03-anotherkey1');
    await act(async () => { mount({ listModels }); });
    expect(listModels).toHaveBeenCalledTimes(2);
  });
});

/**
 * THE ENDPOINT ADDRESS, WHICH IS ONLY ON THIS CARD WHILE THE USER'S OWN SERVER IS ARMED.
 *
 * The connection screen owns first entry and this card owns every change after, which is what makes a
 * filed address reachable for the rest of the panel's life: without it a gateway that had moved could
 * only be repaired by dropping the key. Editing RE-VERIFIES BY ITSELF — the same request the card
 * already makes for the model list, asked again at the new address once the hands are still (or on
 * Enter, now) — so an address that answers nothing says so here rather than on the next order, and
 * there is no button to remember to press.
 */
describe('the address of the user\'s own server', () => {
  /** Arms `custom` with a key and an address, which is the state the control is drawn in. */
  const armCustom = (url = 'https://gw.example/v1') => {
    useAgentPanelSettings.getState().setCustomBaseUrl(url);
    useAgentPanelSettings.getState().pinProvider('custom');
    useAgentPanelSettings.getState().connectKey('custom', 'sk-9f2c0123456789abcdef0123456789ab');
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

    expect(useAgentPanelSettings.getState().customBaseUrl).toBe('https://new.example/v1');
    expect(listModels).toHaveBeenLastCalledWith({
      provider: 'custom', apiKey: 'sk-9f2c0123456789abcdef0123456789ab', customBaseUrl: 'https://new.example/v1',
    });
  });

  /**
   * THE CHECK RUNS ITSELF. A changed address is filed and asked once the hands are still, on the
   * same quiet the key field advances on: verification is not a step the user takes, it is what the
   * card does with an address it has been given. The quiet RESTARTS per keystroke, so a URL typed a
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
    expect(useAgentPanelSettings.getState().customBaseUrl, 'still typing: nothing filed')
      .toBe('https://old.example/v1');

    // A second keystroke inside the quiet restarts it, so the half-typed address is never asked.
    fireEvent.change(input(), { target: { value: 'https://new.example/v1' } });
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(listModels).toHaveBeenCalledTimes(1);

    await act(async () => { vi.advanceTimersByTime(450); });
    expect(useAgentPanelSettings.getState().customBaseUrl).toBe('https://new.example/v1');
    expect(listModels).toHaveBeenCalledTimes(2);
    expect(listModels).toHaveBeenLastCalledWith(expect.objectContaining({ customBaseUrl: 'https://new.example/v1' }));
    vi.useRealTimers();
  });

  /** AN UNCHANGED ADDRESS IS LEFT ALONE: the quiet only ever fires for a draft that differs from
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

  /** Enter on an UNCHANGED address is a deliberate re-check, and the remembered list must not
   *  answer it: the address may have come back since. */
  it('re-asks the same address on Enter', async () => {
    armCustom();
    const listModels = vi.fn(() => Promise.resolve(['a']));
    await act(async () => { mount({ listModels }); });
    expect(listModels).toHaveBeenCalledTimes(1);
    await act(async () => { enter(); });
    expect(listModels).toHaveBeenCalledTimes(2);
  });

  /** AN UNUSABLE STRING IS REFUSED IN PLACE once the hands are still: nothing is filed, and the
   *  note under the field says the address cannot be used. */
  it('refuses an address the app could not reach, and files nothing', async () => {
    armCustom();
    const listModels = vi.fn(() => Promise.resolve(['a']));
    await act(async () => { mount({ listModels }); });

    vi.useFakeTimers();
    fireEvent.change(input(), { target: { value: 'not a url' } });
    await act(async () => { vi.advanceTimersByTime(950); });
    expect(screen.getByTestId('manage-endpoint-note').textContent)
      .toBe(translations.en['agent3.setup_endpoint_invalid']);
    expect(useAgentPanelSettings.getState().customBaseUrl).toBe('https://gw.example/v1');
    expect(listModels).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  /** The wait rides the pill itself, trailing the text — the check is about this field, so its
   *  sign stands inside it rather than opening a row — and the sub-line carries verdicts alone:
   *  an address that answered nothing, and QUIET where the address answered. The wait is the
   *  loading idiom, never a sentence of its own. */
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
      .toBe(translations.en['agent3.setup_manage_endpoint_failed']);
  });

  /** THE ADDRESS SURVIVES THE PAGE, which is the other half of being able to change it: it is written
   *  through the one storage door and read back sanitized on the next boot. */
  it('is on disk after the check, and comes back from disk', async () => {
    armCustom('https://gw.example/v1');
    await act(async () => { mount({ listModels: () => Promise.resolve(['a']) }); });
    fireEvent.change(input(), { target: { value: 'https://kept.example/v1/' } });
    await act(async () => { enter(); });

    // A FRESH BOOT: the store is put back to its defaults and hydrated off the same disk.
    await act(async () => {
      useAgentPanelSettings.setState({ customBaseUrl: '', provider: 'claude', hydrated: false });
      await useAgentPanelSettings.getState().hydrate();
    });
    await act(async () => {});
    expect(useAgentPanelSettings.getState().customBaseUrl, 'the trailing slash is the sanitizer\'s')
      .toBe('https://kept.example/v1');
    expect(useAgentPanelSettings.getState().provider).toBe('custom');
  });
});

/**
 * WHAT A CHANGE ON THIS CARD APPLIES TO, and what it says about it.
 *
 * A CONNECTION CHANGE REACHES THE NEXT JOB (the rule and its argument live at the config-read seam,
 * `ui/agent/panel-runner.ts`), so the card's job is to SAY so at the moment of the press and never to
 * pretend the running job has moved. The note is the house toast rather than a line on the card: the
 * fact is about a moment, and a row that appeared would move the card at the instant it was being
 * used, which is the same rule the destructive verbs' spacer exists for.
 *
 * SAID ONCE PER LIVE JOB, not once per press. A model typed a character at a time is one change, and
 * the note is a note rather than forty of them.
 */
describe('a change made over a running job says which job it reaches', () => {
  const LIVE = { providerId: 'claude' as const, model: 'claude-sonnet-4-5' };

  it('says nothing at all while no job is running', async () => {
    await act(async () => { mount({ listModels: () => Promise.resolve(['a', 'b']) }); });
    await act(async () => { fireEvent.click(screen.getByTestId('manage-model-dd')); });
    await act(async () => { fireEvent.click(screen.getByText(prettyModel('b'))); });
    expect(toasts).toEqual([]);
    expect(useAgentPanelSettings.getState().model.claude).toBe('b');
  });

  it('says it once when the model is changed over a live job, and not again for the same job', async () => {
    await act(async () => { mount({ liveConnection: LIVE, listModels: () => Promise.resolve(['a', 'b']) }); });
    await act(async () => { fireEvent.click(screen.getByTestId('manage-model-dd')); });
    await act(async () => { fireEvent.click(screen.getByText(prettyModel('b'))); });
    expect(toasts).toEqual([translations.en['agent3.setup_manage_next_job']]);

    await act(async () => { fireEvent.click(screen.getByTestId('manage-model-dd')); });
    await act(async () => { fireEvent.click(screen.getByText(prettyModel('a'))); });
    expect(toasts, 'one note per job, not per press').toHaveLength(1);
  });

  it('says it when the provider is changed over a live job', async () => {
    await act(async () => { mount({ liveConnection: LIVE, listModels: () => Promise.resolve(['a']) }); });
    await act(async () => { fireEvent.click(screen.getByTestId('manage-prov-row')); });
    await act(async () => { fireEvent.click(screen.getByText(PROVIDER_META.openai.name)); });
    expect(toasts).toEqual([translations.en['agent3.setup_manage_next_job']]);
  });

  /** OVERSIGHT IS THE EXCEPTION and must NOT be noted: it is read live at every gate decision, so it
   *  reaches the next write of the job already running. A note saying otherwise would be false. */
  it('says nothing for oversight, which the running job does answer to', async () => {
    await act(async () => { mount({ liveConnection: LIVE, listModels: () => Promise.resolve(['a']) }); });
    await act(async () => { fireEvent.click(screen.getByText(translations.en['agent3.oversight_yolo']!)); });
    expect(useAgentPanelSettings.getState().oversight).toBe('yolo');
    expect(toasts).toEqual([]);
  });
});

/**
 * THE ENDPOINT DECIDES WHICH MODELS EXIST, so a newly filed address is asked whether it serves the
 * one on file and the answer is ACTED ON here rather than left for the next order to discover.
 *
 * FOUR OUTCOMES, AND A MODEL STANDS IN THE FIRST THREE: the list names it (kept, and the arriving
 * list is the confirmation), the list answers without it (replaced by the address's own first offer,
 * and the swap is said), the server answers without a list (proof of nothing, so the typed id stands
 * and the row says it is unverified). The fourth is the check FAILING OUTRIGHT, and it is the one
 * place readiness drops: the model empties, the dropdown offers nothing, the endpoint is the named
 * gap and Done blocks until the address answers and the user picks again.
 */
describe('changing the address re-judges the model', () => {
  const armCustom = (url = 'https://gw.example/v1') => {
    useAgentPanelSettings.getState().setCustomBaseUrl(url);
    useAgentPanelSettings.getState().pinProvider('custom');
    useAgentPanelSettings.getState().connectKey('custom', 'sk-9f2c0123456789abcdef0123456789ab');
    useAgentPanelSettings.setState({ model: { ...emptyModels(), custom: 'kept-model' } });
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
    expect(useAgentPanelSettings.getState().model.custom).toBe('kept-model');
    expect(toasts).toEqual([]);
  });

  it('replaces the model where the new address answers without it, and says both names', async () => {
    armCustom();
    await act(async () => { mount({ listModels: () => Promise.resolve(['served-a', 'served-b']) }); });
    await fileAddress('https://new.example/v1');

    expect(useAgentPanelSettings.getState().model.custom, 'the address\'s own first offer').toBe('served-a');
    expect(toasts).toEqual([
      translations.en['agent3.setup_manage_model_swapped']!
        .replace('{now}', prettyModel('served-a')).replace('{was}', prettyModel('kept-model')),
    ]);
    // The face reads the new model, so the row and the connection agree.
    expect(screen.getByTestId('manage-model-face').textContent).toBe(prettyModel('served-a'));
  });

  it('keeps the typed model where the address lists nothing, and says the row is unverified', async () => {
    armCustom();
    await act(async () => { mount({ listModels: () => Promise.resolve([]) }); });
    await fileAddress('https://bare.example/v1');

    expect(useAgentPanelSettings.getState().model.custom, 'an absent list proves nothing').toBe('kept-model');
    expect(toasts).toEqual([]);
    expect(screen.getByTestId('manage-endpoint-note').textContent)
      .toBe(translations.en['agent3.setup_manage_endpoint_unlisted']);
  });

  /** A GEAR PRESS IS NOT AN ADDRESS CHANGE. The card is opened to read the oversight caption as often
   *  as to change anything, and re-picking a model the user chose because a partial catalogue omits it
   *  would be the card overruling them. */
  it('leaves the filed model alone when the card merely opens on a list that omits it', async () => {
    armCustom();
    await act(async () => { mount({ listModels: () => Promise.resolve(['served-a']) }); });
    expect(useAgentPanelSettings.getState().model.custom).toBe('kept-model');
    expect(toasts).toEqual([]);
  });

  /**
   * BOTH VALIDITY TRANSITIONS, and no note or verdict outlives the state it described.
   *
   * BREAKING is the fourth outcome acted on in full: the pick is GONE (not flagged), the sub-line
   * says the address must answer first, the dropdown offers nothing at all — the dead endpoint's
   * list included — the typed-id fallback stands down, and Done blocks with the endpoint named.
   * FIXING re-runs the check and retires the failure, and the arriving list OFFERS the cleared pick
   * (marked as the user's own earlier one) without restoring it: the row emptied, so the re-pick is
   * theirs, at the cost of one press.
   */
  it('walks valid to invalid and back: the model empties, the door blocks, and the re-pick is offered', async () => {
    armCustom();
    let answer: () => Promise<string[]> = () => Promise.resolve(['kept-model']);
    await act(async () => { mount({ listModels: () => answer() }); });
    const note = () => screen.getByTestId('manage-endpoint-note').textContent;
    const done = () => screen.getByTestId('manage-done') as HTMLButtonElement;
    expect(note(), 'the address answered, so nothing stands under it').toBe('');
    expect(done().disabled, 'a ready connection may leave').toBe(false);

    // VALID → INVALID.
    answer = () => Promise.reject(new Error('Failed to fetch'));
    await fileAddress('https://broken.example/v1');
    expect(note()).toBe(translations.en['agent3.setup_manage_endpoint_failed']);
    expect(useAgentPanelSettings.getState().model.custom, 'the pick is gone').toBe('');
    expect(screen.getByTestId('manage-model-face').textContent)
      .toBe(translations.en['agent3.setup_model_pick']);
    expect(screen.getByTestId('manage-model-blocked').textContent)
      .toBe(translations.en['agent3.setup_manage_model_needs_endpoint']);
    expect(screen.queryByTestId('manage-model-input'), 'no typed id against a server that is not there')
      .toBeNull();
    fireEvent.click(screen.getByTestId('manage-model-dd'));
    expect(screen.queryAllByRole('menuitemradio'), 'the dead endpoint offers no list').toEqual([]);
    fireEvent.click(screen.getByTestId('manage-model-dd'));
    expect(done().disabled, 'the door out blocks').toBe(true);
    expect(done().getAttribute('data-gap'), 'with the endpoint as the named gap').toBe('endpoint');

    // INVALID → VALID.
    answer = () => Promise.resolve(['kept-model', 'other']);
    await fileAddress('https://fixed.example/v1');
    expect(note(), 'no failure note survives the fix').toBe('');
    expect(useAgentPanelSettings.getState().model.custom, 'nothing is restored silently').toBe('');
    expect(toasts, 'an empty row swaps nothing').toEqual([]);
    expect(done().disabled, 'no model stands yet').toBe(true);
    expect(done().getAttribute('data-gap'), 'the model is what is owed now').toBe('model');

    fireEvent.click(screen.getByTestId('manage-model-dd'));
    const rows = screen.getAllByRole('menuitemradio');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent, 'the old pick is offered visibly').toContain(prettyModel('kept-model'));
    expect(rows[0]!.textContent, 'as the user\'s own earlier one')
      .toContain(translations.en['agent3.setup_model_former']!);
    fireEvent.click(rows[0]!);
    expect(useAgentPanelSettings.getState().model.custom, 'one press restores the old name').toBe('kept-model');
    expect(done().disabled, 'and the door opens').toBe(false);
  });

  /** THE OTHER SIDE OF THE BOUNDARY: a server that ANSWERS badly (here an auth refusal) is reachable,
   *  so the typed id keeps the trust an empty catalogue earns and the door stays open. */
  it('keeps the model where the server answers without a list, whatever the refusal was', async () => {
    armCustom();
    await act(async () => {
      mount({ listModels: () => Promise.reject(Object.assign(new Error('Unauthorized'), { status: 401 })) });
    });
    await fileAddress('https://auth.example/v1');
    expect(useAgentPanelSettings.getState().model.custom).toBe('kept-model');
    expect(screen.getByTestId('manage-endpoint-note').textContent)
      .toBe(translations.en['agent3.setup_manage_endpoint_unlisted']);
    expect((screen.getByTestId('manage-done') as HTMLButtonElement).disabled).toBe(false);
  });

  it('swaps on the way back up where the fixed address does not serve what was standing', async () => {
    armCustom();
    let answer: () => Promise<string[]> = () => Promise.reject(new Error('Failed to fetch'));
    await act(async () => { mount({ listModels: () => answer() }); });
    expect(screen.getByTestId('manage-endpoint-note').textContent)
      .toBe(translations.en['agent3.setup_manage_endpoint_failed']);
    // A GEAR PRESS IS NOT A CHECK: the fetch this card makes on mount failing must not empty a pick
    // the user made — only a check they pressed carries that authority.
    expect(useAgentPanelSettings.getState().model.custom, 'a glance clears nothing').toBe('kept-model');

    answer = () => Promise.resolve(['only-this']);
    await fileAddress('https://fixed.example/v1');
    expect(useAgentPanelSettings.getState().model.custom).toBe('only-this');
    expect(toasts).toHaveLength(1);
  });
});

/**
 * THE BOUNDARY BETWEEN A FAILED ENDPOINT AND AN UNAVAILABLE LIST, as one table over the failure
 * shapes the deadline-bounded check settles with (`setup-parts.ts:endpointCheckVerdict`). A failed
 * endpoint is a check NOTHING answered (or that no request could be built for); everything with a
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

/** THE ROWS READ TOP-DOWN IN THE ORDER THEY DEPEND ON EACH OTHER: the provider names the platform, the
 *  address decides which models exist, the model is chosen from what the address offers. A model row
 *  above the address would ask the user to choose from a list the row below has not established. */
describe('the card reads in dependency order', () => {
  it('stands the address between the provider and the model', async () => {
    useAgentPanelSettings.getState().setCustomBaseUrl('https://gw.example/v1');
    useAgentPanelSettings.getState().pinProvider('custom');
    useAgentPanelSettings.getState().connectKey('custom', 'sk-9f2c0123456789abcdef0123456789ab');
    await act(async () => { mount({ listModels: () => Promise.resolve(['a']) }); });

    const card = screen.getByTestId('manage-screen');
    const order = ['manage-prov-row', 'manage-endpoint-input', 'manage-model-dd']
      .map((id) => [...card.querySelectorAll('[data-testid]')]
        .findIndex((el) => el.getAttribute('data-testid') === id));
    expect(order.every((n) => n >= 0), 'all three rows are drawn').toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

/**
 * EVERY LIST ON THIS CARD IS THE SHARED FLOATING MENU, and its card is round on all four corners.
 *
 * The panel's two dropdowns are the longest lists in the app (nine platforms, a provider's whole
 * model roster), so they are where a hand-rolled popover would be tempting and where a clipped or
 * partially-declared radius shows first. Both facts are asserted: the card is the house one (its own
 * `role`, its own rung), and its four corners resolve to the same declared radius, so an asymmetric
 * corner cannot come from this surface's own styling.
 *
 * WHAT THIS CANNOT SEE is the glass: jsdom paints nothing, so a corner squared by a scrollbar gutter,
 * by an ancestor's clip or by a fractional device scale is the fidelity rig's measurement, not this
 * one. What it does hold is the layer below that — nothing here declares its own card.
 */
describe('the dropdowns on this card are the house menu', () => {
  /** The radius AS DECLARED. jsdom does not expand the shorthand into the four longhands, so what is
   *  read is the declaration itself — which is the thing a partial one would show up in: a single
   *  token is all four corners, and anything with a space in it is naming them separately. */
  const declaredRadius = (el: HTMLElement) => el.style.borderRadius;

  it.each(['manage-prov-row', 'manage-model-dd'])('opens a round-cornered house card from %s', (row) => {
    mount({ jobCount: 1 });
    fireEvent.click(screen.getByTestId(row));

    const card = screen.getByRole('menu');
    expect(card.getAttribute('aria-label')).toBeTruthy();
    // ONE radius, four corners: `radii.lg` as the shared card declares it, with nothing partial.
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
    'agent3.setup_manage_forget_key', 'agent3.setup_manage_forget_q',
    'agent3.setup_manage_clear_jobs', 'agent3.setup_manage_clear_q',
    'agent3.setup_manage_stop_job', 'agent3.setup_manage_set_aside',
    'agent3.dock_connection', 'agent3.action_cancel', 'agent3.setup_oversight',
    'agent3.setup_manage_endpoint', 'agent3.setup_manage_model',
    'agent3.setup_manage_endpoint_failed', 'agent3.setup_manage_model_needs_endpoint',
    'agent3.setup_model_former',
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
      for (const key of ['agent3.setup_manage_clear_jobs', 'agent3.setup_manage_clear_q']) {
        expect(translations[loc][key], `${loc}/${key}`).toContain('{n}');
      }
    }
  });
});
