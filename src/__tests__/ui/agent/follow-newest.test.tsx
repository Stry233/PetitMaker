import { useLayoutEffect, useRef } from 'react';
import { fireEvent, render } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useFollowNewest } from '../../../ui/agent/use-follow-newest';

function Record({ length, active = true }: { length: number; active?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    Object.defineProperties(ref.current, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: length },
    });
  }, [length]);
  useFollowNewest(ref, length, '', active);
  return <div ref={ref} data-testid="record" />;
}

it('starts at the newest output and follows streamed content', () => {
  const view = render(<Record length={800} />);
  const record = view.getByTestId('record');
  expect(record.scrollTop).toBe(800);
  view.rerender(<Record length={1000} />);
  expect(record.scrollTop).toBe(1000);
});

it('preserves a reader’s scroll position until they return to the bottom', () => {
  const view = render(<Record length={800} />);
  const record = view.getByTestId('record');
  record.scrollTop = 100;
  fireEvent.scroll(record);
  view.rerender(<Record length={1000} />);
  expect(record.scrollTop).toBe(100);
  record.scrollTop = 800;
  fireEvent.scroll(record);
  view.rerender(<Record length={1200} />);
  expect(record.scrollTop).toBe(1200);
});

it('does not follow while the enclosing surface is being read', () => {
  const view = render(<Record length={800} active={false} />);
  const record = view.getByTestId('record');
  record.scrollTop = 100;
  view.rerender(<Record length={1000} active={false} />);
  expect(record.scrollTop).toBe(100);
});
