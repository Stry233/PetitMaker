// @vitest-environment jsdom
/** An armed card's ring rises on arming and fades on disarming, rather than leaving at once. */
import { afterEach, beforeEach, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { resetStore, setStoreState } from '../../../../_support/store';
import { I18nProvider } from '../../../../../i18n/context';
import { ScaleProvider } from '../../../../../ui/design/scale';
import { SmartCard } from '../../../../../ui/shell/bars/objects/ItemCard';

function Card({ selected }: { selected: boolean }) {
  return (
    <MotionConfig reducedMotion="never"><I18nProvider><ScaleProvider value={0.5}>
      <SmartCard selected={selected} onToggle={() => {}} onReach={() => {}} />
    </ScaleProvider></I18nProvider></MotionConfig>
  );
}

beforeEach(() => { resetStore(); setStoreState({ locale: 'en' }); });
afterEach(cleanup);

it('fades the armed ring away when the card is disarmed', async () => {
  const view = render(<Card selected />);
  expect(screen.getByTestId('armed-ring')).toBeTruthy();
  view.rerender(<Card selected={false} />);
  const ring = screen.getByTestId('armed-ring');
  await waitFor(() => expect(ring.isConnected, 'removed once its fade has run').toBe(false));
});
