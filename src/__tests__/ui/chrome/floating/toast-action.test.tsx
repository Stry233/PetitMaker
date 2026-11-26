// @vitest-environment jsdom
/** A toast offering a press, such as a deleted blueprint's Undo: each stands alone with its own press,
 *  and plain toasts leave the band before it does. */
import { afterEach, expect } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { spec } from '../../../_support/spec';
import { I18nProvider } from '../../../../i18n/context';
import { ToastContainer } from '../../../../ui/chrome/floating/Toast';
import { showToast } from '../../../../platform/channels/toast-bus';

afterEach(cleanup);

const mount = () => render(<MotionConfig reducedMotion="always"><I18nProvider><ToastContainer /></I18nProvider></MotionConfig>);

spec('BLUE-10', 'two deletes with the same words keep two toasts, each undoing its own', async () => {
  mount();
  const undone: string[] = [];
  act(() => { showToast('Deleted “Pier”', 'info', { label: 'Undo', run: () => undone.push('first') }); });
  act(() => { showToast('Deleted “Pier”', 'info', { label: 'Undo', run: () => undone.push('second') }); });
  const toasts = screen.getAllByTestId('toast');
  expect(toasts).toHaveLength(2);
  act(() => { within(toasts[0]!).getByRole('button', { name: 'Undo' }).click(); });
  expect(undone).toEqual(['first']);
  await waitFor(() => expect(screen.getAllByTestId('toast')).toHaveLength(1));
});

spec('BLUE-10', 'plain toasts crowding the band leave before one offering Undo', async () => {
  mount();
  act(() => { showToast('Deleted “Pier”', 'info', { label: 'Undo', run: () => {} }); });
  for (const text of ['one', 'two', 'three']) act(() => { showToast(text, 'info'); });
  await waitFor(() => expect(screen.getAllByTestId('toast')).toHaveLength(3));
  const texts = screen.getAllByTestId('toast').map((t) => t.textContent);
  expect(texts[0]).toContain('Pier');
  expect(texts.slice(1)).toEqual(['two', 'three']);
});
