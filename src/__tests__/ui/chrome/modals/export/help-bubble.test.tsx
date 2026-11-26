// @vitest-environment jsdom
/** A field's help bubble opens on its button and is put away in a fade nothing can reach. */
import { afterEach, beforeEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { resetStore, setStoreState } from '../../../../_support/store';
import { I18nProvider } from '../../../../../i18n/context';
import { HelpBubble } from '../../../../../ui/chrome/modals/export/HelpBubble';

beforeEach(() => { resetStore(); setStoreState({ locale: 'en' }); });
afterEach(cleanup);

it('puts the bubble away in a fade that nothing can reach, then removes it', async () => {
  render(<MotionConfig reducedMotion="never"><I18nProvider><HelpBubble text="What this does" /></I18nProvider></MotionConfig>);
  const button = screen.getByRole('button', { name: 'Help' });
  fireEvent.click(button);
  expect(screen.getByRole('tooltip').textContent).toBe('What this does');
  fireEvent.click(button);
  const leaving = screen.getByRole('tooltip', { hidden: true });
  expect(screen.queryByRole('tooltip'), 'gone for assistive technology at once').toBeNull();
  expect(leaving.closest('[inert]'), 'and for presses').not.toBeNull();
  await waitFor(() => expect(leaving.isConnected, 'removed once its fade has run').toBe(false));
});
