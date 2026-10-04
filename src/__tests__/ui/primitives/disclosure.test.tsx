import { useState } from 'react';
import { fireEvent, render } from '@testing-library/react';
import { AnimatePresence, MotionConfig } from 'framer-motion';
import { expect, it } from 'vitest';
import { Disclosure } from '../../../ui/primitives/Disclosure';

function Form({ open }: { open: boolean }) {
  const [value, setValue] = useState('');
  return <Disclosure open={open} testId="fold"><input aria-label="Draft" value={value} onChange={e => setValue(e.target.value)} /></Disclosure>;
}

it('keeps a draft mounted while excluding closed fields from interaction', () => {
  const view = render(<MotionConfig reducedMotion="always"><Form open /></MotionConfig>);
  fireEvent.change(view.getByLabelText('Draft'), { target: { value: 'A retained draft' } });
  view.rerender(<MotionConfig reducedMotion="always"><Form open={false} /></MotionConfig>);
  expect(view.getByTestId('fold').hasAttribute('inert')).toBe(true);
  view.rerender(<MotionConfig reducedMotion="always"><Form open /></MotionConfig>);
  expect((view.getByLabelText('Draft') as HTMLInputElement).value).toBe('A retained draft');
  expect(view.getByTestId('fold').hasAttribute('inert')).toBe(false);
});

it('excludes departing controls before their exit completes', () => {
  const content = (open: boolean) => <AnimatePresence>{open && <Disclosure key="row" testId="fold"><button>Recall</button></Disclosure>}</AnimatePresence>;
  const view = render(content(true));
  view.rerender(content(false));
  expect(view.getByTestId('fold').hasAttribute('inert')).toBe(true);
  expect(view.getByTestId('fold').style.pointerEvents).toBe('none');
});
