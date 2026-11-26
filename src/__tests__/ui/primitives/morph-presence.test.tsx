// @vitest-environment jsdom
/** A piece on its way out of an `AnimatePresence` leaves on its own exit, not as a piece of the morph. */
import { afterEach, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { AnimatePresence, motion } from 'framer-motion';
import { useMorph } from '../../../ui/primitives/morph';

afterEach(cleanup);

function Panel({ id }: { id: string }) {
  return <motion.div data-testid={id} {...useMorph('assistant')} exit={{ opacity: 0, transition: { duration: 10 } }} />;
}

it('[UI-27] frees a piece\'s id while the piece leaves, so the one arriving under it is the only piece', () => {
  const view = render(<AnimatePresence><Panel key="a" id="a" /></AnimatePresence>);
  expect(view.getByTestId('a').getAttribute('data-morph')).toBe('assistant');
  view.rerender(<AnimatePresence><Panel key="b" id="b" /></AnimatePresence>);
  expect(view.getByTestId('a').hasAttribute('data-morph'), 'the leaving panel').toBe(false);
  expect(view.getByTestId('b').getAttribute('data-morph')).toBe('assistant');
});
