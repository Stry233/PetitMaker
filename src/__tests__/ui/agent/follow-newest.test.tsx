import { StrictMode, useLayoutEffect, useRef, type ReactNode } from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useFollowNewest } from '../../../ui/agent/use-follow-newest';

function Record({ length, active = true, initial = 'end', id = 'record', children }: { length: number; active?: boolean; initial?: 'start' | 'end'; id?: string; children?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    Object.defineProperties(ref.current, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: length },
    });
  }, [length]);
  useLayoutEffect(() => {
    const el = ref.current!;
    let top = 0;
    Object.defineProperty(el, 'scrollTop', {
      configurable: true,
      get: () => (top = Math.min(top, Math.max(0, el.scrollHeight - el.clientHeight))),
      set: (value: number) => { top = Math.max(0, Math.min(value, el.scrollHeight - el.clientHeight)); },
    });
  }, []);
  const read = useFollowNewest(ref, children ?? length, '', active, initial);
  return <div ref={ref} data-scroll-viewport="" data-testid={id}><div data-testid={`${id}-body`}>{children}</div><button onClick={read}>Read existing text</button></div>;
}

it('opens existing long text at its beginning and preserves it through incoming output', () => {
  const view = render(<Record length={800} initial="start" />);
  const record = view.getByTestId('record');
  expect(record.scrollTop).toBe(0);
  view.rerender(<Record length={1000} initial="start" />);
  expect(record.scrollTop).toBe(0);
});

it('pauses following before a reading action changes content size', () => {
  const view = render(<Record length={800} />);
  const record = view.getByTestId('record');
  fireEvent.click(view.getByRole('button'));
  view.rerender(<Record length={1400} />);
  expect(record.scrollTop).toBe(600);
});

it('starts at the newest output and follows streamed content', () => {
  const view = render(<Record length={800} />);
  const record = view.getByTestId('record');
  expect(record.scrollTop).toBe(600);
  view.rerender(<Record length={1000} />);
  expect(record.scrollTop).toBe(800);
});

it('preserves a reader’s scroll position until they return to the bottom', () => {
  const view = render(<Record length={800} />);
  const record = view.getByTestId('record');
  fireEvent.keyDown(record, { key: 'PageUp' });
  record.scrollTop = 100;
  fireEvent.scroll(record);
  view.rerender(<Record length={1000} />);
  expect(record.scrollTop).toBe(100);
  record.scrollTop = 800;
  fireEvent.scroll(record);
  view.rerender(<Record length={1200} />);
  expect(record.scrollTop).toBe(1000);
});

it.each([true, false])('pauses a small upward scroll even when its native event has arrived=%s', (delivered) => {
  const view = render(<Record length={240}><Record id="inner" length={600} /></Record>);
  const outer = view.getByTestId('record');
  const inner = view.getByTestId('inner');
  expect(outer.scrollTop).toBe(40);
  expect(inner.scrollTop).toBe(400);
  fireEvent.keyDown(outer, { key: 'PageUp' });
  outer.scrollTop = 28;
  if (delivered) fireEvent.scroll(outer);
  view.rerender(<Record length={240}><Record id="inner" length={800} /></Record>);
  expect(outer.scrollTop).toBe(28);
  expect(inner.scrollTop).toBe(600);
  fireEvent.scroll(inner);
  view.rerender(<Record length={240}><Record id="inner" length={1000} /></Record>);
  expect(outer.scrollTop).toBe(28);
  expect(inner.scrollTop).toBe(800);

  outer.scrollTop = 32;
  fireEvent.scroll(outer);
  view.rerender(<Record length={240}><Record id="inner" length={1200} /></Record>);
  expect(outer.scrollTop).toBe(32);
  outer.scrollTop = 40;
  fireEvent.scroll(outer);
  view.rerender(<Record length={260}><Record id="inner" length={1400} /></Record>);
  expect(outer.scrollTop).toBe(60);
  expect(inner.scrollTop).toBe(1200);
});

it('keeps the outer scroller following when only the inner scroller is being read', () => {
  const view = render(<Record length={240}><Record id="inner" length={600} /></Record>);
  const inner = view.getByTestId('inner');
  fireEvent.wheel(inner, { deltaY: -12 });
  inner.scrollTop = 388;
  fireEvent.scroll(inner);
  view.rerender(<Record length={260}><Record id="inner" length={800} /></Record>);
  expect(view.getByTestId('record').scrollTop).toBe(60);
  expect(inner.scrollTop).toBe(388);
});

it.each([
  { strict: false, lag: 0 }, { strict: true, lag: 0 },
  { strict: false, lag: 27 }, { strict: true, lag: 27 },
])('resumes the gesture’s painted edge after content grows with $lag pixels of lag, Strict Mode=$strict', ({ strict, lag }) => {
  const content = (length: number) => strict ? <StrictMode><Record length={length} /></StrictMode> : <Record length={length} />;
  const view = render(content(800));
  const record = view.getByTestId('record');
  fireEvent.keyDown(record, { key: 'PageUp' });
  record.scrollTop = 100;
  fireEvent.scroll(record);
  fireEvent.wheel(record, { deltaY: 1000 });
  view.rerender(content(1000));
  record.scrollTop = 600 - lag;
  fireEvent.scroll(record);
  view.rerender(content(1200));
  expect(record.scrollTop).toBe(1000);
});

it('keeps following when the offset drops with no input of the reader’s', () => {
  // A cancelled height animation hands the box its natural size for a moment, and the browser
  // resets the offset to 0 by itself.
  const view = render(<Record length={800} />);
  const record = view.getByTestId('record');
  record.scrollTop = 0;
  fireEvent.scroll(record);
  view.rerender(<Record length={1000} />);
  expect(record.scrollTop).toBe(800);
});

it('keeps following when a click at the foot is followed by a browser offset reset', () => {
  const view = render(<Record length={800} />);
  const record = view.getByTestId('record');
  fireEvent.pointerDown(view.getByTestId('record-body'));
  record.scrollTop = 0;
  fireEvent.scroll(record);
  view.rerender(<Record length={1200} />);
  expect(record.scrollTop).toBe(1000);
});

it('pauses following when the reader presses the scrollbar at the foot and scrolls up', () => {
  // Scrollbar presses target the scroll viewport itself rather than its content.
  const view = render(<Record length={800} />);
  const record = view.getByTestId('record');
  fireEvent.pointerDown(record);
  record.scrollTop = 300;
  fireEvent.scroll(record);
  view.rerender(<Record length={1200} />);
  expect(record.scrollTop).toBe(300);
});

it('forgets input that has scrolled back to the foot', () => {
  const view = render(<Record length={800} />);
  const record = view.getByTestId('record');
  fireEvent.keyDown(record, { key: 'End' });
  fireEvent.scroll(record);
  record.scrollTop = 0;
  fireEvent.scroll(record);
  view.rerender(<Record length={1200} />);
  expect(record.scrollTop).toBe(1000);
});

it('keeps following when content contraction clamps the scroll offset', () => {
  const view = render(<Record length={800} />);
  view.rerender(<Record length={500} />);
  expect(view.getByTestId('record').scrollTop).toBe(300);
  fireEvent.scroll(view.getByTestId('record'));
  view.rerender(<Record length={900} />);
  expect(view.getByTestId('record').scrollTop).toBe(700);
});

it('does not follow while the enclosing surface is being read', () => {
  const view = render(<Record length={800} active={false} />);
  const record = view.getByTestId('record');
  record.scrollTop = 100;
  view.rerender(<Record length={1000} active={false} />);
  expect(record.scrollTop).toBe(100);
});

it('follows animated content inside a fixed scroller until the reader scrolls away', () => {
  const watched = new Set<Element>();
  let resized = () => {};
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resized = callback; }
    observe(el: Element) { watched.add(el); }
    unobserve(el: Element) { watched.delete(el); }
    disconnect() { watched.clear(); }
  });
  try {
    const view = render(<Record length={800} />);
    const record = view.getByTestId('record');
    expect(watched.has(view.getByTestId('record-body'))).toBe(true);
    Object.defineProperty(record, 'scrollHeight', { configurable: true, value: 1000 });
    act(() => resized());
    expect(record.scrollTop).toBe(800);
    fireEvent.keyDown(record, { key: 'PageUp' });
    record.scrollTop = 100;
    fireEvent.scroll(record);
    Object.defineProperty(record, 'scrollHeight', { configurable: true, value: 1200 });
    act(() => resized());
    expect(record.scrollTop).toBe(100);
    view.unmount();
    expect(watched.size).toBe(0);
  } finally {
    vi.unstubAllGlobals();
  }
});
