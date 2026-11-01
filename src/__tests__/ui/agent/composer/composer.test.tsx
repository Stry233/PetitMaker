// @vitest-environment jsdom
/** The composer: four routes in one well, suggestions as ghosts. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { I18nProvider, translate } from '../../../../i18n/context';
import { Composer } from '../../../../ui/agent/composer/Composer';
import { FIELD_MAX_LINES } from '../../../../ui/agent/composer/metrics';
import type { ComposerRoute } from '../../../../agent/session/composer-routing';

const backing = new Map<string, string>();
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

/** jsdom has no layout, so tests supply the textarea's measured height. */
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

/** The field's line box in px, read off the rendered element; the cap is `FIELD_MAX_LINES` of it. */
function lineBox(field: HTMLElement): number {
  return Number.parseFloat(field.style.fontSize) * Number(field.style.lineHeight);
}

describe('Composer: placeholder per route', () => {
  const EXPECT: Record<ComposerRoute, string> = {
    order: 'Enter a task or question',
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

  it('says the answer is welcome too while a question stands, on the order route only', () => {
    const answering = renderWithI18n(
      <Composer route="order" answering running={false} onSend={noop} onStop={noop} onDropSuggestion={noop} />,
    );
    expect((answering.getByTestId('composer-input') as HTMLInputElement).placeholder)
      .toBe('Answer, or a new order');
    answering.unmount();

    // The other routes' placeholders already name what they carry.
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

describe('Composer: IME input', () => {
  it.each(['inline', 'expanded'])('keeps confirmation and candidate keys inside the %s field', (surface) => {
    const onSend = vi.fn();
    const onDrop = vi.fn();
    const view = renderWithI18n(
      <Composer route="order" running={false} onSend={onSend} onStop={noop} onDropSuggestion={onDrop} />,
    );
    let field = view.getByTestId('composer-input') as HTMLTextAreaElement;
    if (surface === 'expanded') {
      measureField(lineBox(field) * (FIELD_MAX_LINES + 2));
      fireEvent.change(field, { target: { value: '长篇草稿' } });
      fireEvent.click(view.getByTestId('composer-expand'));
      field = view.getByTestId('composer-expanded-input') as HTMLTextAreaElement;
    }
    fireEvent.compositionStart(field);
    fireEvent.change(field, { target: { value: '建造花园' } });
    for (const key of ['Enter', 'Escape', 'Tab']) fireEvent.keyDown(field, { key });
    expect(field.value).toBe('建造花园');
    expect(field.isConnected).toBe(true);
    expect(onSend).not.toHaveBeenCalled();
    expect(onDrop).not.toHaveBeenCalled();
    fireEvent.compositionEnd(field);
    fireEvent.keyDown(field, { key: 'Enter', keyCode: 229, isComposing: false });
    fireEvent.keyDown(field, { key: 'Enter', isComposing: true });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(field, { key: 'Enter' });
    if (surface === 'expanded') {
      expect(onSend).not.toHaveBeenCalled();
      fireEvent.click(view.getByTestId('composer-expanded-send'));
    }
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('建造花园');
  });
});

describe('Composer: the stop square, geometry held stable', () => {

  it('the stop button becomes enabled and visible while running, and calls onStop when clicked', () => {
    const onStop = vi.fn();
    const { getByTestId } = renderWithI18n(
      <Composer route="steer" running={true} onSend={noop} onStop={onStop} onDropSuggestion={noop} />,
    );
    const stop = getByTestId('composer-stop') as HTMLButtonElement;
    expect(stop.disabled).toBe(false);
    fireEvent.click(stop);
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  /** Marking turns the field off without ending the run, so the stop stays pressable. */
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

  it('the well and the send circle keep the exact same box across idle <-> running — the stop button never displaces them', () => {
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
   * The ghost is one clipped line, about 30 Latin or 15 CJK characters wide, so the fixture sits at
   * that bound and the whole sentence stays readable in the field's title.
   */
  it('carries the whole suggestion in the field s title, however much of it fits', () => {
    const AT_BOUND = 'Yes, add a pier on the south end';
    const { getByTestId } = renderWithI18n(
      <Composer route="order" running={false} suggestion={AT_BOUND} onSend={noop} onStop={noop} onDropSuggestion={noop} />,
    );
    const ghost = getByTestId('composer-ghost');
    expect(ghost.textContent).toBe(AT_BOUND);
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
  });

  it('says the fault\'s own repair rather than the route\'s invitation', () => {
    const { getByTestId } = renderWithI18n(
      <Composer
        route="order" running={false}
        blocked={{ key: 'agent.composer_blocked_endpoint', off: true }}
        onSend={noop} onStop={noop} onDropSuggestion={noop}
      />,
    );
    expect((getByTestId('composer-input') as HTMLInputElement).placeholder)
      .toBe(translate('agent.composer_blocked_endpoint'));
    expect((getByTestId('composer-input') as HTMLInputElement).disabled).toBe(true);
  });

  it('names the pencil, and keeps the well reachable while it is held', () => {
    const { getByTestId } = renderWithI18n(
      <Composer route="order" running={false} marking onSend={noop} onStop={noop} onDropSuggestion={noop} />,
    );
    expect((getByTestId('composer-input') as HTMLInputElement).placeholder)
      .toBe(translate('agent.composer_marking'));
  });
});

/** The ghost overlays the input's placeholder, so only one of them may show. */
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
    expect(field().placeholder).toBe(translate('agent.composer_order'));
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
    fireEvent.change(field, { target: { value: '' } });
    expect(field.placeholder).toBe('');
    expect(queryByTestId('composer-ghost')).not.toBeNull();
  });
});

/**
 * The well's field grows to a bounded number of lines, then hands its box to a floating card that
 * is the same field at paragraph size. `measureField` overflows the well to reach the card.
 */
describe('Composer: long text', () => {
  const PARAGRAPH = 'Build a fishing village along the south shore, with a jetty at the river mouth, '
    + 'four cottages set back from the water, and a path joining them to the road that already runs east.';

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

    it('folds the card back into the well on Done', async () => {
      const { getByTestId, queryByTestId } = open();

      fireEvent.click(getByTestId('composer-expanded-done'));
      // Still present the frame after the press, folding back into the well.
      expect(queryByTestId('composer-expanded')).not.toBeNull();
      await waitFor(() => expect(queryByTestId('composer-expanded')).toBeNull());
    });

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

    it('leaves Enter and modified Enter to insert line breaks, and sends only from the button', () => {
      const { getByTestId, onSend } = open();
      const big = getByTestId('composer-expanded-input');
      fireEvent.keyDown(big, { key: 'Enter', shiftKey: true });
      expect(onSend).not.toHaveBeenCalled();
      expect(fireEvent.keyDown(big, { key: 'Enter' })).toBe(true);
      expect(onSend).not.toHaveBeenCalled();
      fireEvent.click(getByTestId('composer-expanded-send'));
      expect(onSend).toHaveBeenCalledWith(PARAGRAPH);
    });
  });
});

describe('Composer: when the door to the bigger field appears', () => {
  it('offers no door on an empty field', () => {
    const view = renderWithI18n(
      <Composer route="order" running={false} onSend={noop} onStop={noop} onDropSuggestion={noop} />,
    );
    expect(view.queryByTestId('composer-expand')).toBeNull();
  });
});

/**
 * The grey text never decides the row count: a wrapped placeholder or ghost would otherwise grow an
 * empty field to three rows that snap to one at the first keystroke.
 */
describe('Composer: the field s own line rules', () => {
  it('declares one row while it is empty, however much grey text it is showing', () => {
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
    fireEvent.change(field, { target: { value: '' } });
    expect(field.rows).toBe(1);
  });

});
