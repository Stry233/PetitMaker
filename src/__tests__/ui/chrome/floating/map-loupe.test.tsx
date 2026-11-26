// @vitest-environment jsdom
/** The magnifier rises over a touch press and fades when the finger lifts, rather than vanishing. */
import { afterEach, expect, it } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { hideLoupe, showLoupe, type LoupeSource } from '../../../../view/shared/overlay/loupe';
import { MapLoupe } from '../../../../ui/chrome/floating/MapLoupe';

const source: LoupeSource = { canvas: document.createElement('canvas'), requestFrame: () => {} };

afterEach(() => { act(() => { hideLoupe(); }); cleanup(); });

it('fades the magnifier away when the finger lifts', async () => {
  render(<MotionConfig reducedMotion="never"><MapLoupe /></MotionConfig>);
  act(() => { showLoupe(source, { x: 200, y: 300 }); });
  expect(screen.getByTestId('map-loupe')).toBeTruthy();
  act(() => { hideLoupe(); });
  const loupe = screen.getByTestId('map-loupe');
  await waitFor(() => expect(loupe.isConnected, 'removed once its fade has run').toBe(false));
});
