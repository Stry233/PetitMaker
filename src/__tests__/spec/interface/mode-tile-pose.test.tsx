// @vitest-environment jsdom
/** Picking a mode grows its tile's drawing into the chosen pose, and leaving it shrinks it back, rather
 *  than either size standing at once. */
import { afterEach, beforeEach, expect } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import type { BuildMode } from '../../../state/editing/edit-mode';
import { spec } from '../../_support/spec';
import { resetStore, setStoreState } from '../../_support/store';
import { I18nProvider } from '../../../i18n/context';
import { InputModeProvider } from '../../../ui/design/input-mode';
import { ModeRow, type ChromeSwap } from '../../../ui/shell/controls/ModeRow';
import { MODES } from '../../../ui/shell/frame';
import { MODE_SCALE } from '../../../ui/shell/units';

function Row({ mode }: { mode: BuildMode | null }) {
  return (
    <MotionConfig reducedMotion="never">
      <InputModeProvider inputMode="pc" shape="landscape"><I18nProvider>
        <ModeRow modes={MODES} mode={mode} swap={{} as ChromeSwap} onPick={() => {}} />
      </I18nProvider></InputModeProvider>
    </MotionConfig>
  );
}
const art = MODES.find((m) => m.id === 'mountain')!;
const drawing = () => screen.getByRole('button', { name: 'Mountains' }).querySelector('img')!;
const width = () => parseFloat(drawing().style.width);
const frames = (n: number) => act(() => new Promise<void>((done) => {
  let left = n;
  const tick = () => { if (--left <= 0) done(); else requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}));

beforeEach(() => { resetStore(); setStoreState({ locale: 'en', inputMode: 'pc', layoutShape: 'landscape' }); });
afterEach(cleanup);

spec('UI-07', 'picking a mode grows its drawing into the chosen pose, and leaving it shrinks it back', async () => {
  const rest = art.w * MODE_SCALE, chosen = art.selected.w * MODE_SCALE;
  expect(chosen, 'the chosen pose is larger').toBeGreaterThan(rest + 4);
  const view = render(<Row mode={null} />);
  expect(width()).toBeCloseTo(rest, 1);
  view.rerender(<Row mode="mountain" />);
  await frames(2);
  expect(width(), 'on its way to the chosen pose').toBeGreaterThan(rest);
  expect(width(), 'not standing there at once').toBeLessThan(chosen - 0.5);
  await frames(40);
  expect(width()).toBeCloseTo(chosen, 1);
  view.rerender(<Row mode={null} />);
  await frames(2);
  expect(width(), 'on its way back').toBeLessThan(chosen);
  expect(width(), 'not standing back at once').toBeGreaterThan(rest + 0.5);
});
