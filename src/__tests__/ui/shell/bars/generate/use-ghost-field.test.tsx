// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '../../../../../i18n/context';
import { CustomCard } from '../../../../../ui/shell/bars/generate/CustomCard';

afterEach(cleanup);

/** Each painted grapheme stands 10px wide from x = 0, since jsdom lays nothing out. */
const SPAN_WIDTH = 10;

function mount(field: 'number' | 'glyph', initial = '') {
  function Field() {
    const [draft, setDraft] = useState(initial);
    return (
      <CustomCard
        field={field} seed={null} draft={draft} shot={null} selected={false}
        onDraft={setDraft} onCommit={() => {}} onEdit={() => {}} onSelect={() => {}}
      />
    );
  }
  const { container } = render(<I18nProvider><Field /></I18nProvider>);
  const input = screen.getByRole('textbox') as HTMLInputElement;
  const spans = () => Array.from(container.querySelectorAll<HTMLElement>('[data-grapheme]'));
  const layOut = () => spans().forEach((span, i) => {
    const left = i * SPAN_WIDTH;
    const rect = { x: left, y: 0, left, top: 0, right: left + SPAN_WIDTH, bottom: 20, width: SPAN_WIDTH, height: 20 };
    span.getBoundingClientRect = () => ({ ...rect, toJSON: () => rect }) as DOMRect;
  });
  const caretAt = () => container.querySelector('[data-testid="ghost-caret"]')?.getAttribute('data-at') ?? null;
  const painted = () => spans().map(span => span.textContent).join('');
  const selected = () => spans().filter(span => span.hasAttribute('data-selected')).map(span => span.textContent).join('');
  act(() => { input.focus(); });
  return { input, caretAt, painted, selected, layOut };
}

/** Moves the real selection the way a keystroke would, then lets the field hear about it. */
function select(input: HTMLInputElement, start: number, end = start, direction: 'forward' | 'backward' = 'forward') {
  act(() => {
    input.setSelectionRange(start, end, direction);
    fireEvent.keyUp(input, { key: 'ArrowLeft' });
  });
}

/** Inserts text at the real selection, as typing does. */
function type(input: HTMLInputElement, text: string) {
  act(() => {
    input.setRangeText(text, input.selectionStart!, input.selectionEnd!, 'end');
    fireEvent.input(input);
  });
}

describe('the painted field shows the real selection', () => {
  it('paints the caret where the selection moved, and typing inserts there with the caret following', () => {
    const { input, caretAt, painted } = mount('number', '1234');
    select(input, 4);
    expect(caretAt()).toBe('4');
    select(input, 2);
    expect(caretAt()).toBe('2');
    type(input, '9');
    expect(input.value).toBe('12934');
    expect(painted()).toBe('12934');
    expect(caretAt()).toBe('3');
  });

  it('paints a range as highlighted graphemes and no caret', () => {
    const { input, caretAt, selected } = mount('number', '1234');
    select(input, 1, 3, 'backward');
    expect(caretAt()).toBeNull();
    expect(selected()).toBe('23');
  });

  it('keeps grapheme boundaries for surrogate pairs, emoji sequences and CJK', () => {
    const text = '\u8c37\u{1f469}\u200d\u{1f33e}\u{20bb7}e\u0301';
    const { input, caretAt, selected } = mount('glyph', text);
    select(input, 1);
    expect(caretAt()).toBe('1');
    select(input, 6);
    expect(caretAt()).toBe('2');
    select(input, 10);
    expect(caretAt()).toBe('4');
    select(input, 1, 8);
    expect(selected()).toBe('\u{1f469}\u200d\u{1f33e}\u{20bb7}');
  });

  it('stands the caret at the end of an IME preedit', () => {
    const { input, caretAt } = mount('glyph', '\u8c37\u5730');
    select(input, 1);
    act(() => { fireEvent.compositionStart(input); });
    act(() => {
      input.setRangeText('xing', 1, 1, 'start');
      fireEvent.input(input);
    });
    expect(input.value).toBe('\u8c37xing\u5730');
    expect(caretAt()).toBe('5');
  });

  it('places a click at the nearest boundary of the painted text, and shift extends it', () => {
    const { input, caretAt, selected, layOut } = mount('number', '1234');
    layOut();
    act(() => { fireEvent.mouseDown(input, { button: 0, clientX: 14, detail: 1 }); });
    expect(input.selectionStart).toBe(1);
    expect(caretAt()).toBe('1');
    act(() => { fireEvent.mouseDown(input, { button: 0, clientX: 16, detail: 1 }); });
    expect(caretAt()).toBe('2');
    act(() => { fireEvent.mouseDown(input, { button: 0, clientX: 38, shiftKey: true, detail: 1 }); });
    expect([input.selectionStart, input.selectionEnd]).toEqual([2, 4]);
    expect(selected()).toBe('34');
  });
});
