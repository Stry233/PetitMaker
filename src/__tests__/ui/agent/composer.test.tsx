/**
 * composer.test.tsx — the composer: four routes in one well, suggestions as ghosts.
 *
 * Renders through `I18nProvider` (matches `gates.test.tsx`'s own wrapper) with a stubbed
 * `localStorage` the store's persisted locale pref can read/write safely in jsdom.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { I18nProvider, translate } from '../../../i18n/context';
import {
  CLUSTER_SIZE, COMPOSER_HEIGHT, Composer, FIELD_MAX_LINES, WELL_PAD,
} from '../../../ui/agent/Composer';
import { MOTIONS } from '../../../ui/shell/motion/registry';
import { z } from '../../../ui/design/styles';
import { TRACK } from '../../../ui/design/tokens';
import type { ComposerRoute } from '../../../agent/session/composer-routing';

const backing = new Map<string, string>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).localStorage = {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
};

function Wrapper({ children }: { children: React.ReactNode }) {
  return <I18nProvider>{children}</I18nProvider>;
}

function renderWithI18n(node: React.ReactElement) {
  return render(node, { wrapper: Wrapper });
}

function noop() {}

/** Pushes a colour through the same DOM round-trip on both sides of a comparison, since jsdom's
 *  cssstyle can normalize a hex differently from a var()-free literal though the two agree in
 *  meaning (matches `trouble.test.tsx`'s own `asBackground`). */
function asBackground(value: string): string {
  const probe = document.createElement('span');
  probe.style.background = value;
  return probe.style.background;
}

/**
 * WHAT THE FIELD WOULD MEASURE, supplied: jsdom lays nothing out, so `scrollHeight` — the one
 * reading the grow clamp and the door both depend on — answers 0 for every element and no amount of
 * text can outgrow the well.
 *
 * A single mutable number behind the prototype getter, so a test can hand in "this much text" and
 * fire a change to have the field read it again. Restored after every test.
 */
let measured = 0;
const ownScrollHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight');
function measureField(px: number): void {
  measured = px;
  Object.defineProperty(Element.prototype, 'scrollHeight', {
    configurable: true,
    get(this: Element) { return this.tagName === 'TEXTAREA' ? measured : 0; },
  });
}
afterEach(() => {
  if (ownScrollHeight) Object.defineProperty(Element.prototype, 'scrollHeight', ownScrollHeight);
  measured = 0;
});

/** The field's own line box in px, read off the element the component drew rather than restated: the
 *  cap the door and the clamp are both arithmetic over is `FIELD_MAX_LINES` of exactly this. */
function lineBox(field: HTMLElement): number {
  return Number.parseFloat(field.style.fontSize) * Number(field.style.lineHeight);
}

describe('Composer: placeholder per route', () => {
  const EXPECT: Record<ComposerRoute, string> = {
    order: 'Give an order',
    steer: 'Add a note for the next step',
    'gate-words': 'Or answer in words',
    'resume-note': 'Add instructions and resume',
  };

  for (const route of Object.keys(EXPECT) as ComposerRoute[]) {
    it(`route "${route}" shows its own placeholder`, () => {
      const { getByTestId } = renderWithI18n(
        <Composer route={route} running={false} onSend={noop} onStop={noop} onDropSuggestion={noop} />,
      );
      expect((getByTestId('composer-input') as HTMLInputElement).placeholder).toBe(EXPECT[route]);
    });
  }

  /**
   * A SETTLED JOB'S STANDING QUESTION. The submission is an ORDER and takes exactly that route — a
   * fifth route would be a lie about where the words go — but "Give an order" over the one card
   * whose whole purpose is a question offered nothing that reads as answering it, and that card
   * carries no quick answers of its own, so the field was the only reply and did not say so. The
   * SHORT sentence is the one it says: the full one does not fit the field even undocked (measured
   * clipped mid-word at en, zoom 1), which is why the route has no long form.
   */
  it('says the answer is welcome too while a question stands, on the order route only', () => {
    const answering = renderWithI18n(
      <Composer route="order" answering running={false} onSend={noop} onStop={noop} onDropSuggestion={noop} />,
    );
    expect((answering.getByTestId('composer-input') as HTMLInputElement).placeholder)
      .toBe('Answer, or a new order');
    answering.unmount();

    // The other three already name what they carry, so the flag does not reach them.
    const steering = renderWithI18n(
      <Composer route="steer" answering running onSend={noop} onStop={noop} onDropSuggestion={noop} />,
    );
    expect((steering.getByTestId('composer-input') as HTMLInputElement).placeholder).toBe(EXPECT.steer);
  });
});

describe('Composer: an empty submit on the resume route continues the job', () => {
  it('sends nothing and calls onResume', () => {
    const onSend = vi.fn();
    const onResume = vi.fn();
    const { getByTestId } = renderWithI18n(
      <Composer route="resume-note" running={false} onSend={onSend} onStop={noop} onDropSuggestion={noop} onResume={onResume} />,
    );
    fireEvent.click(getByTestId('composer-send'));
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('takes the typed note instead when there is one, and never resumes twice over', () => {
    const onSend = vi.fn();
    const onResume = vi.fn();
    const { getByTestId } = renderWithI18n(
      <Composer route="resume-note" running={false} onSend={onSend} onStop={noop} onDropSuggestion={noop} onResume={onResume} />,
    );
    const input = getByTestId('composer-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'use stone' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('use stone');
    expect(onResume).not.toHaveBeenCalled();
  });

  /** Every other route's empty submit is still a no-op: only a PAUSED job has something to carry on. */
  it('does nothing on the other three routes', () => {
    for (const route of ['order', 'steer', 'gate-words'] as ComposerRoute[]) {
      const onSend = vi.fn();
      const onResume = vi.fn();
      const { getByTestId, unmount } = renderWithI18n(
        <Composer route={route} running={false} onSend={onSend} onStop={noop} onDropSuggestion={noop} onResume={onResume} />,
      );
      fireEvent.click(getByTestId('composer-send'));
      expect(onResume, route).not.toHaveBeenCalled();
      expect(onSend, route).not.toHaveBeenCalled();
      unmount();
    }
  });
});

describe('Composer: sending', () => {
  it('Enter sends the trimmed text through onSend and clears the field', () => {
    const onSend = vi.fn();
    const { getByTestId } = renderWithI18n(
      <Composer route="order" running={false} onSend={onSend} onStop={noop} onDropSuggestion={noop} />,
    );
    const input = getByTestId('composer-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '  Build a pond  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('Build a pond');
    expect(input.value).toBe('');
  });

  it('clicking send does the same as Enter', () => {
    const onSend = vi.fn();
    const { getByTestId } = renderWithI18n(
      <Composer route="order" running={false} onSend={onSend} onStop={noop} onDropSuggestion={noop} />,
    );
    const input = getByTestId('composer-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Plant a forest' } });
    fireEvent.click(getByTestId('composer-send'));
    expect(onSend).toHaveBeenCalledWith('Plant a forest');
    expect(input.value).toBe('');
  });

  it('Enter on a blank (or whitespace-only) field is a no-op: no onSend, nothing to clear', () => {
    const onSend = vi.fn();
    const { getByTestId } = renderWithI18n(
      <Composer route="order" running={false} onSend={onSend} onStop={noop} onDropSuggestion={noop} />,
    );
    const input = getByTestId('composer-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
  });
});

describe('Composer: the stop square, geometry held stable', () => {
  it('the stop button is disabled and invisible (opacity 0) while idle, but stays MOUNTED (reserved slot)', () => {
    const { getByTestId } = renderWithI18n(
      <Composer route="order" running={false} onSend={noop} onStop={noop} onDropSuggestion={noop} />,
    );
    const stop = getByTestId('composer-stop') as HTMLButtonElement;
    expect(stop.isConnected).toBe(true);
    expect(stop.disabled).toBe(true);
    expect(stop.style.opacity).toBe('0');
  });

  it('the stop button becomes enabled and visible while running, and calls onStop when clicked', () => {
    const onStop = vi.fn();
    const { getByTestId } = renderWithI18n(
      <Composer route="steer" running={true} onSend={noop} onStop={onStop} onDropSuggestion={noop} />,
    );
    const stop = getByTestId('composer-stop') as HTMLButtonElement;
    expect(stop.disabled).toBe(false);
    expect(stop.style.opacity).toBe('1');
    fireEvent.click(stop);
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  /** THE WELL NEVER GOES DEAD AS A GROUP: the field is what an off state turns off, and every other
   *  control in it answers a press. A running job's stop is genuinely pressable while the map holds
   *  the pencil, which is the state that turns the field off without ending the run. */
  it('keeps the stop live while the map holds the pencil', () => {
    const onStop = vi.fn();
    const { getByTestId } = renderWithI18n(
      <Composer route="steer" running marking onSend={noop} onStop={onStop} onDropSuggestion={noop} />,
    );
    const stop = getByTestId('composer-stop') as HTMLButtonElement;
    expect(stop.disabled).toBe(false);
    fireEvent.click(stop);
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('clicking the stop button while idle (disabled) never fires onStop', () => {
    const onStop = vi.fn();
    const { getByTestId } = renderWithI18n(
      <Composer route="order" running={false} onSend={noop} onStop={onStop} onDropSuggestion={noop} />,
    );
    fireEvent.click(getByTestId('composer-stop'));
    expect(onStop).not.toHaveBeenCalled();
  });

  it('REGRESSION: the well and the send circle keep the exact same box across idle <-> running — the stop button never displaces them', () => {
    const { getByTestId, rerender } = renderWithI18n(
      <Composer route="order" running={false} onSend={noop} onStop={noop} onDropSuggestion={noop} />,
    );
    const wellIdle = getByTestId('composer-well').getAttribute('style');
    const sendIdle = getByTestId('composer-send').getAttribute('style');
    const childCountIdle = getByTestId('composer-well').children.length;

    rerender(
      <Wrapper>
        <Composer route="order" running={true} onSend={noop} onStop={noop} onDropSuggestion={noop} />
      </Wrapper>,
    );

    const wellRunning = getByTestId('composer-well').getAttribute('style');
    const sendRunning = getByTestId('composer-send').getAttribute('style');
    const childCountRunning = getByTestId('composer-well').children.length;

    expect(wellRunning).toBe(wellIdle);
    expect(sendRunning).toBe(sendIdle);
    expect(childCountRunning).toBe(childCountIdle);
  });
});

describe('Composer: the suggestion ghost', () => {
  it('renders as ghost text only when the field is empty and a suggestion stands', () => {
    const { getByTestId, queryByTestId } = renderWithI18n(
      <Composer route="order" running={false} suggestion="Yes, add the bridge" onSend={noop} onStop={noop} onDropSuggestion={noop} />,
    );
    expect(getByTestId('composer-ghost').textContent).toBe('Yes, add the bridge');

    fireEvent.change(getByTestId('composer-input'), { target: { value: 'x' } });
    expect(queryByTestId('composer-ghost')).toBeNull();
  });

  /**
   * THE ONE CLIP IN THE PANEL HAS A WAY TO BE READ, AND ITS BUDGET IS TRUE.
   *
   * The ghost is `nowrap` + `overflow: hidden` + ellipsis, so unlike the says line (which expands on
   * a tap) and a stage label (which wraps) a suggestion past the field's width is LOST. The tool
   * licensed 60 characters into a field that holds about 30 in a Latin script and about 15 in CJK,
   * and it was also the one model-authored string with no state in the fidelity matrix and a
   * 19-character fixture standing in for its own bound. Fixture AT the bound here, and the whole
   * sentence reachable from the field's own title.
   */
  it('carries the whole suggestion in the field s title, however much of it fits', () => {
    // A reply at the real bound: what a compliant model writes for a "shall I add a pier?" close.
    const AT_BOUND = 'Yes, add a pier on the south end';
    const { getByTestId } = renderWithI18n(
      <Composer route="order" running={false} suggestion={AT_BOUND} onSend={noop} onStop={noop} onDropSuggestion={noop} />,
    );
    const ghost = getByTestId('composer-ghost');
    expect(ghost.textContent).toBe(AT_BOUND);
    // The clip is real, so the reading has to come from somewhere. The title is on the FIELD's own
    // wrapper, not the ghost: the ghost takes no pointer events, and a tooltip resolves against the
    // nearest ancestor carrying one.
    expect(ghost.style.textOverflow).toBe('ellipsis');
    expect(ghost.style.pointerEvents).toBe('none');
    expect(ghost.parentElement!.getAttribute('title')).toBe(AT_BOUND);
  });

  it('renders no ghost when there is no standing suggestion', () => {
    const { getByTestId, queryByTestId } = renderWithI18n(
      <Composer route="order" running={false} suggestion={null} onSend={noop} onStop={noop} onDropSuggestion={noop} />,
    );
    expect(queryByTestId('composer-ghost')).toBeNull();
    expect(getByTestId('composer-input').parentElement!.getAttribute('title')).toBeNull();
  });

  it('Enter on an empty field sends the ghost itself and drops it', () => {
    const onSend = vi.fn();
    const onDrop = vi.fn();
    const { getByTestId } = renderWithI18n(
      <Composer route="order" running={false} suggestion="Yes, add the bridge" onSend={onSend} onStop={noop} onDropSuggestion={onDrop} />,
    );
    fireEvent.keyDown(getByTestId('composer-input'), { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('Yes, add the bridge');
    expect(onDrop).toHaveBeenCalledTimes(1);
  });

  it('Escape drops the ghost without sending anything', () => {
    const onSend = vi.fn();
    const onDrop = vi.fn();
    const { getByTestId } = renderWithI18n(
      <Composer route="order" running={false} suggestion="Yes, add the bridge" onSend={onSend} onStop={noop} onDropSuggestion={onDrop} />,
    );
    fireEvent.keyDown(getByTestId('composer-input'), { key: 'Escape' });
    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('Tab inserts the ghost into the field as real, editable text and drops the standing suggestion (without sending)', () => {
    const onSend = vi.fn();
    const onDrop = vi.fn();
    const { getByTestId } = renderWithI18n(
      <Composer route="order" running={false} suggestion="Yes, add the bridge" onSend={onSend} onStop={noop} onDropSuggestion={onDrop} />,
    );
    const input = getByTestId('composer-input') as HTMLInputElement;
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(input.value).toBe('Yes, add the bridge');
    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('Tab with no standing suggestion does nothing special (field stays empty)', () => {
    const onDrop = vi.fn();
    const { getByTestId } = renderWithI18n(
      <Composer route="order" running={false} onSend={noop} onStop={noop} onDropSuggestion={onDrop} />,
    );
    const input = getByTestId('composer-input') as HTMLInputElement;
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(input.value).toBe('');
    expect(onDrop).not.toHaveBeenCalled();
  });
});

describe('Composer: off', () => {
  it('disables the input and the send button, and leaves the box itself pressable', () => {
    const { getByTestId } = renderWithI18n(
      <Composer route="order" running={false} marking onSend={noop} onStop={noop} onDropSuggestion={noop} />,
    );
    expect((getByTestId('composer-input') as HTMLInputElement).disabled).toBe(true);
    expect((getByTestId('composer-send') as HTMLButtonElement).disabled).toBe(true);
    expect(getByTestId('composer').style.pointerEvents).toBe('');
  });

  /**
   * THE OFF WELL IS A SURFACE, NOT A FADE (the artifact's `.comp.off`: full opacity, no pointer, the
   * empty-groove fill, with `.send:disabled` on the house `primary:disabled` idiom).
   *
   * The whole of the argument is what the field is still carrying. An off composer's placeholder is
   * the one line saying WHY it is off and what to do about it — fix the endpoint, change the
   * provider, the map has the pencil — and a fade over the group is the first thing that takes it
   * away. The panel then refuses and explains nothing.
   */
  it('says the refusal in the tokens, and leaves the words readable', () => {
    const { getByTestId } = renderWithI18n(
      <Composer route="order" running={false} marking onSend={noop} onStop={noop} onDropSuggestion={noop} />,
    );
    for (const id of ['composer', 'composer-well', 'composer-send']) {
      const fade = getByTestId(id).style.opacity;
      expect(fade === '' || fade === '1', `${id} opacity ${fade}`).toBe(true);
    }
    expect(getByTestId('composer-well').style.background).toBe(asBackground(TRACK));
    expect(getByTestId('composer-send').style.background).toBe(asBackground(TRACK));
  });

  /** WHY THE FIELD IS OFF IS NOT ONE STATE, so it is not one sentence: an unrepaired fault says its
   *  own repair where the invitation would be. There is no state where a field with nowhere to send
   *  stands at all — the setup family draws no composer (`PanelShell`). */
  it('says the fault\'s own repair rather than the route\'s invitation', () => {
    const { getByTestId } = renderWithI18n(
      <Composer
        route="order" running={false}
        blocked={{ key: 'agent3.composer_blocked_endpoint', off: true }}
        onSend={noop} onStop={noop} onDropSuggestion={noop}
      />,
    );
    expect((getByTestId('composer-input') as HTMLInputElement).placeholder)
      .toBe(translate('agent3.composer_blocked_endpoint'));
    expect((getByTestId('composer-input') as HTMLInputElement).disabled).toBe(true);
  });

  /** The map holding the pencil keeps its own sentence, and the well stays live for the one control
   *  that can end the marking. */
  it('names the pencil, and keeps the well reachable while it is held', () => {
    const { getByTestId } = renderWithI18n(
      <Composer route="order" running={false} marking onSend={noop} onStop={noop} onDropSuggestion={noop} />,
    );
    expect((getByTestId('composer-input') as HTMLInputElement).placeholder)
      .toBe(translate('agent3.composer_marking'));
    expect(getByTestId('composer').style.pointerEvents).toBe('');
  });
});

/**
 * THE GHOST AND THE PLACEHOLDER PAINT IN THE SAME BOX, and only one of them may hold it: both show
 * only on an EMPTY field, the ghost as an overlay over the input's own placeholder, so a standing
 * suggestion and an invitation to write one landed one on top of the other and neither could be read.
 */
describe('Composer: the suggestion ghost and the placeholder', () => {
  it('gives the line to the ghost while one stands, and takes it back when it goes', () => {
    const { getByTestId, queryByTestId, rerender } = renderWithI18n(
      <Composer
        route="order" running={false} suggestion="Yes, add the bridge"
        onSend={noop} onStop={noop} onDropSuggestion={noop}
      />,
    );
    const field = () => getByTestId('composer-input') as HTMLInputElement;
    expect(queryByTestId('composer-ghost')).not.toBeNull();
    expect(field().placeholder).toBe('');

    rerender(
      <Composer
        route="order" running={false} suggestion={null}
        onSend={noop} onStop={noop} onDropSuggestion={noop}
      />,
    );
    expect(queryByTestId('composer-ghost')).toBeNull();
    expect(field().placeholder).toBe(translate('agent3.composer_order'));
  });

  it('takes it back the moment something is typed over the ghost', () => {
    const { getByTestId, queryByTestId } = renderWithI18n(
      <Composer
        route="order" running={false} suggestion="Yes, add the bridge"
        onSend={noop} onStop={noop} onDropSuggestion={noop}
      />,
    );
    const field = getByTestId('composer-input') as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'a' } });
    expect(queryByTestId('composer-ghost')).toBeNull();
    // A field with words in it shows no placeholder either way; what matters is that the invitation
    // is back the moment the field is empty again.
    fireEvent.change(field, { target: { value: '' } });
    expect(field.placeholder).toBe('');
    expect(queryByTestId('composer-ghost')).not.toBeNull();
  });
});

/**
 * AN ORDER IS AS LONG AS IT NEEDS TO BE, and ONE FIELD carries it: the well's field grows to a
 * bounded number of lines and then hands its own box to a floating card, which is the same field at
 * the size a paragraph needs rather than a second one.
 *
 * jsdom lays nothing out, so the reading the growth depends on is supplied (`measureField`); what the
 * numbers then pin is the arithmetic over it, which is where the row count and the door both come
 * from.
 */
describe('Composer: long text', () => {
  const PARAGRAPH = 'Build a fishing village along the south shore, with a jetty at the river mouth, '
    + 'four cottages set back from the water, and a path joining them to the road that already runs east.';

  it('takes its text in a bounded, scrolling, multi-line field', () => {
    const { getByTestId } = renderWithI18n(
      <Composer route="order" running={false} onSend={noop} onStop={noop} onDropSuggestion={noop} />,
    );
    const field = getByTestId('composer-input') as HTMLTextAreaElement;
    expect(field.tagName).toBe('TEXTAREA');
    expect(field.rows).toBe(1);
    // Its own scroller once there is something in it to scroll, and never the corner grabber: the
    // well is a pill of a fixed shape and a hand-dragged field would tear straight out of it.
    fireEvent.change(field, { target: { value: PARAGRAPH } });
    expect(field.style.overflowY).toBe('auto');
    expect(field.style.resize).toBe('none');
    // The cap is arithmetic over a DECLARED line box, or it would be a different number of lines on
    // every platform.
    expect(field.style.lineHeight).toBeTruthy();
    expect(FIELD_MAX_LINES).toBeGreaterThan(1);
  });

  /** ENTER SENDS AND A MODIFIER BREAKS THE LINE. Enter is the send key everywhere in the app, so the
   *  newline is what the modifier buys rather than the other way round. */
  it('sends on Enter and writes a newline on Shift+Enter', () => {
    const onSend = vi.fn();
    const { getByTestId } = renderWithI18n(
      <Composer route="order" running={false} onSend={onSend} onStop={noop} onDropSuggestion={noop} />,
    );
    const field = getByTestId('composer-input');
    fireEvent.change(field, { target: { value: 'first line' } });

    fireEvent.keyDown(field, { key: 'Enter', shiftKey: true });
    expect(onSend, 'a modifier means a line').not.toHaveBeenCalled();
    fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true });
    fireEvent.keyDown(field, { key: 'Enter', metaKey: true });
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('first line');
  });

  describe('the floating field', () => {
    function open() {
      const onSend = vi.fn();
      const view = renderWithI18n(
        <Composer route="order" running={false} onSend={onSend} onStop={noop} onDropSuggestion={noop} />,
      );
      const field = view.getByTestId('composer-input');
      measureField(lineBox(field) * (FIELD_MAX_LINES + 2));
      fireEvent.change(field, { target: { value: PARAGRAPH } });
      fireEvent.click(view.getByTestId('composer-expand'));
      return { ...view, onSend };
    }

    /** ONE VALUE, ONE FIELD AT A TIME: the card opens with what the well held, and the well is a seat
     *  while it stands — so there is no second copy of the text and no direction for a sync to drift
     *  in, because there is no second field to sync with. */
    it('opens with what the well already holds, and hands edits back to it on the way home', async () => {
      const { getByTestId, queryByTestId } = open();
      const big = getByTestId('composer-expanded-input') as HTMLTextAreaElement;
      expect(big.value).toBe(PARAGRAPH);
      expect(queryByTestId('composer-input')).toBeNull();

      fireEvent.change(big, { target: { value: `${PARAGRAPH} And a bench.` } });
      fireEvent.click(getByTestId('composer-expanded-done'));
      await waitFor(() => expect(queryByTestId('composer-expanded')).toBeNull());
      expect((getByTestId('composer-input') as HTMLTextAreaElement).value)
        .toBe(`${PARAGRAPH} And a bench.`);
    });

    /**
     * EXPANDED AND DOCKED NEVER CO-EXIST. The card is the docked field at another size, so while it
     * stands the well is an empty SEAT: no field in it, and the box it held kept, since the card
     * morphs out of that box and has to morph back into it.
     */
    it('leaves the well standing as an empty seat, holding the box it had', () => {
      const { getByTestId, queryAllByTestId } = open();
      const well = getByTestId('composer-well');
      expect(well.dataset.seat).toBe('1');
      expect(well.childElementCount).toBe(0);
      expect(well.style.height).not.toBe('');
      // One field in the document, and it is the card's.
      expect(queryAllByTestId('composer-input')).toHaveLength(0);
      expect(queryAllByTestId('composer-expanded-input')).toHaveLength(1);
    });

    /** The morph runs both ways off ONE declaration, and reads its own numbers from the registry. */
    it('morphs from the seat s own box and back into it, on a declared motion', async () => {
      const { getByTestId, queryByTestId } = open();
      expect(MOTIONS['panel.composer.unfold'].tier).toBe('inform');
      const card = getByTestId('composer-expanded');
      // Both boxes are the same two style objects the morph tweens between: a fixed card whose
      // corner, box and radius are animated values rather than a class swap.
      expect(card.style.position).toBe('fixed');

      fireEvent.click(getByTestId('composer-expanded-done'));
      // The card is still there the frame after the press: it is folding back into the well rather
      // than being taken away, which is the whole of what the collapse has to say.
      expect(queryByTestId('composer-expanded')).not.toBeNull();
      await waitFor(() => expect(queryByTestId('composer-expanded')).toBeNull());
    });

    it('stands over the panel rather than under a backdrop, on the popover rung', () => {
      const { getByTestId } = open();
      const card = getByTestId('composer-expanded');
      expect(card.style.position).toBe('fixed');
      expect(card.style.zIndex).toBe(String(z.popover));
      // Writing an order does not disable the record it is about, so there is no dimming plane.
      expect(document.querySelectorAll('[data-testid="modal-backdrop"]')).toHaveLength(0);
    });

    /** IT IS A VIEW, NOT A DIALOG. Closing it keeps what is written, whichever way it is closed. */
    it.each([
      ['its own Done', (el: HTMLElement) => fireEvent.click(el)],
      ['Escape', () => fireEvent.keyDown(window, { key: 'Escape' })],
    ])('closes on %s and keeps the text', async (_name, close) => {
      const { getByTestId, queryByTestId } = open();
      close(getByTestId('composer-expanded-done'));

      await waitFor(() => expect(queryByTestId('composer-expanded')).toBeNull());
      expect((getByTestId('composer-input') as HTMLTextAreaElement).value).toBe(PARAGRAPH);
    });

    it('sends from the card, and the card goes with the words', async () => {
      const { getByTestId, queryByTestId, onSend } = open();
      fireEvent.click(getByTestId('composer-expanded-send'));

      expect(onSend).toHaveBeenCalledWith(PARAGRAPH);
      await waitFor(() => expect(queryByTestId('composer-expanded')).toBeNull());
      expect((getByTestId('composer-input') as HTMLTextAreaElement).value).toBe('');
    });

    it('sends on Enter there too, and breaks the line on a modifier', () => {
      const { getByTestId, onSend } = open();
      const big = getByTestId('composer-expanded-input');
      fireEvent.keyDown(big, { key: 'Enter', shiftKey: true });
      expect(onSend).not.toHaveBeenCalled();
      fireEvent.keyDown(big, { key: 'Enter' });
      expect(onSend).toHaveBeenCalledWith(PARAGRAPH);
    });

    /** THE DOOR STANDS WHATEVER THE WELL IS DOING, once there is text it cannot hold: an order too
     *  long for the pill is exactly the one a blocked or marking well still has in it. */
    it.each([
      ['marking', { marking: true }],
      ['blocked', { blocked: { key: 'agent3.composer_blocked_provider', off: true } }],
    ])('offers the door with the well %s, once the text outgrows it', (_name, extra) => {
      const { getByTestId } = renderWithI18n(
        <Composer route="order" running={false} {...extra} onSend={noop} onStop={noop} onDropSuggestion={noop} />,
      );
      const field = getByTestId('composer-input');
      measureField(lineBox(field) * (FIELD_MAX_LINES + 1));
      fireEvent.change(field, { target: { value: PARAGRAPH } });
      expect(getByTestId('composer-expand')).toBeTruthy();
    });
  });
});

/**
 * THE DOOR SHOWS WHEN IT IS OF USE AND NOT BEFORE: the well holds `FIELD_MAX_LINES` of text, and a
 * second surface is only the better surface once the text has outgrown that. On a short order the
 * button is a control with nothing behind it, sitting between the region frame and the send.
 */
describe('Composer: when the door to the bigger field appears', () => {
  function fieldOf(view: ReturnType<typeof renderWithI18n>): HTMLElement {
    return view.getByTestId('composer-input');
  }

  it('offers no door on an empty field', () => {
    const view = renderWithI18n(
      <Composer route="order" running={false} onSend={noop} onStop={noop} onDropSuggestion={noop} />,
    );
    expect(view.queryByTestId('composer-expand')).toBeNull();
  });

  it('offers no door while the text still fits the well', () => {
    const view = renderWithI18n(
      <Composer route="order" running={false} onSend={noop} onStop={noop} onDropSuggestion={noop} />,
    );
    const field = fieldOf(view);
    measureField(lineBox(field) * FIELD_MAX_LINES);
    fireEvent.change(field, { target: { value: 'a short order' } });
    expect(view.queryByTestId('composer-expand')).toBeNull();
  });

  it('opens the door the line after the text outgrows the well, and takes it away again', async () => {
    const view = renderWithI18n(
      <Composer route="order" running={false} onSend={noop} onStop={noop} onDropSuggestion={noop} />,
    );
    const field = fieldOf(view);
    const line = lineBox(field);

    measureField(line * (FIELD_MAX_LINES + 1));
    fireEvent.change(field, { target: { value: 'a paragraph' } });
    expect(view.queryByTestId('composer-expand')).not.toBeNull();

    // Deleted back down to what the well holds: the door folds away with the overflow that
    // justified it, so it is still there the frame after and gone once the fold has run.
    measureField(line);
    fireEvent.change(field, { target: { value: 'short again' } });
    await waitFor(() => expect(view.queryByTestId('composer-expand')).toBeNull());
  });
});

/**
 * THE GREY TEXT NEVER DECIDES THE ROW COUNT.
 *
 * A placeholder and a ghost are both drawn in the field's own box, and a wrapped one takes THREE
 * lines of it at the docked width — which the field then grows to hold, so a field standing empty
 * was two or three rows tall and snapped back to one the moment a character was typed into it. The
 * field's height is arithmetic over the VALUE: an empty field is one row, whatever grey line is
 * standing in it, and the grey line is clamped to that row rather than the row grown to the line.
 */
describe('Composer: the field s own line rules', () => {
  it('stands one row tall while it is empty, however much grey text it is showing', () => {
    const view = renderWithI18n(
      <Composer
        route="order"
        running={false}
        suggestion="Yes, add a pier on the south end of the boardwalk"
        onSend={noop}
        onStop={noop}
        onDropSuggestion={noop}
      />,
    );
    const field = view.getByTestId('composer-input') as HTMLTextAreaElement;
    // Three rows' worth of grey line, measured: the row count does not read it.
    measureField(lineBox(field) * 3);
    fireEvent.change(field, { target: { value: '' } });
    // An empty field takes its height from its own `rows`, which is one, rather than from a
    // measurement any grey line contributes to.
    expect(field.style.height).toBe('');
    expect(field.rows).toBe(1);
    // And nothing scrolls in a field with nothing in it, so no scrollbar rides the grey line.
    expect(field.style.overflowY).toBe('hidden');
  });

  it('takes its height from what is typed, and scrolls once that outgrows the cap', () => {
    const view = renderWithI18n(
      <Composer route="order" running={false} onSend={noop} onStop={noop} onDropSuggestion={noop} />,
    );
    const field = view.getByTestId('composer-input') as HTMLTextAreaElement;
    const line = lineBox(field);

    measureField(line * 2);
    fireEvent.change(field, { target: { value: 'two lines of order' } });
    expect(field.style.height).toBe(`${line * 2}px`);
    expect(field.style.overflowY).toBe('auto');

    // Past the cap the height stops and the field's own scroller takes over.
    measureField(line * (FIELD_MAX_LINES + 3));
    fireEvent.change(field, { target: { value: 'a paragraph of order' } });
    expect(field.style.height).toBe(`${line * FIELD_MAX_LINES}px`);
  });

  /** The growth is a TWEEN and the number is the panel's own: the well's foot and the panel's box are
   *  one movement, so the field travels on the same declaration the panel's height does. */
  it('animates the growth on the panel s own declared height motion', () => {
    const view = renderWithI18n(
      <Composer route="order" running={false} onSend={noop} onStop={noop} onDropSuggestion={noop} />,
    );
    const field = view.getByTestId('composer-input');
    expect(field.style.transition).toContain('height');
    expect(field.style.transition).toContain(`${MOTIONS['panel.height'].duration}s`);
  });
});

/**
 * THE SEND CLUSTER IS CENTRED IN THE WELL AND STAYS IN IT, at every height the field reaches.
 *
 * jsdom lays nothing out, so the contract is pinned from both ends: the STYLE facts that produce the
 * centring (the well centres its row, and nothing in it overrides that), and the ARITHMETIC those
 * facts imply at one, two, three and four lines, over the well's own padding, the tallest control in
 * the cluster and the field's declared line box.
 */
describe('Composer: the well s layout contract', () => {
  function well() {
    const view = renderWithI18n(
      <Composer route="order" running={false} onSend={noop} onStop={noop} onDropSuggestion={noop} />,
    );
    return { view, box: view.getByTestId('composer-well') };
  }

  it('centres its row, and nothing inside it asks to sit anywhere else', () => {
    const { view, box } = well();
    expect(box.style.alignItems).toBe('center');
    // A padding under the field is exactly the offset that pushed the cluster off the middle when
    // the row was seated on its last line instead of centred.
    expect(view.getByTestId('composer-input').parentElement!.style.paddingBottom).toBe('');
    for (const id of ['composer-stop', 'composer-send']) {
      expect(view.getByTestId(id).style.alignSelf).toBe('');
    }
  });

  it.each([1, 2, 3, 4])('keeps the cluster centred and inside the well at %i lines', (lines) => {
    const { view, box } = well();
    const field = view.getByTestId('composer-input');
    const fieldHeight = lineBox(field) * lines;

    // The well is a flex row of its padding plus the taller of the field and the cluster.
    const inner = Math.max(fieldHeight, CLUSTER_SIZE);
    const height = Math.max(COMPOSER_HEIGHT, inner + WELL_PAD * 2);
    expect(Number.parseFloat(String(box.style.minHeight))).toBe(COMPOSER_HEIGHT);

    // Centred: the air above the cluster is the air below it.
    const top = (height - CLUSTER_SIZE) / 2;
    expect(top).toBeCloseTo(height - (top + CLUSTER_SIZE));
    // And inside: never nearer either edge than the well's own padding.
    expect(top).toBeGreaterThanOrEqual(WELL_PAD - 0.001);
    expect(top + CLUSTER_SIZE).toBeLessThanOrEqual(height - WELL_PAD + 0.001);
  });
});
