/**
 * The on-device packs run through ONNX Runtime, which ships here in its SIMD build only. An engine
 * whose WebAssembly has no SIMD cannot load them, so they are not offered there.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, act, screen, within } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import type { StylizeDirection } from '../../../io/stylize';

let simdAnswer = true;
vi.mock('wasm-feature-detect', () => ({ simd: () => Promise.resolve(simdAnswer) }));

const NEURAL = ['Soft watercolor', 'Ink wash', 'Night lights', 'Crayon', 'Old atlas'];
const LOCAL = ['Watercolor', 'Pencil drawing'];

/** Mount the booklet with a fresh capability probe and let it answer. */
async function booklet() {
  vi.resetModules();
  const { DirectionBooklet } = await import('../../../ui/chrome/modals/export/stylize/DirectionBooklet');
  const { I18nProvider } = await import('../../../i18n/context');
  render(
    <MotionConfig reducedMotion="always">
      <I18nProvider>
        <DirectionBooklet value={'aquarelle' as StylizeDirection} onPick={() => {}} />
      </I18nProvider>
    </MotionConfig>,
  );
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  return within(screen.getByTestId('stylize-direction-scroll'));
}

beforeEach(() => { simdAnswer = true; });
afterEach(() => vi.restoreAllMocks());

describe('the on-device style list', () => {
  it('offers every built-in style on an engine with SIMD', async () => {
    const scroller = await booklet();
    for (const name of [...LOCAL, ...NEURAL]) expect(scroller.getByText(name)).toBeTruthy();
    expect(scroller.getByText('Forest watercolor'), 'the online styles are untouched').toBeTruthy();
  });

  it('leaves the model-drawn styles out where WebAssembly has no SIMD', async () => {
    simdAnswer = false;
    const scroller = await booklet();
    for (const name of NEURAL) expect(scroller.queryByText(name)).toBeNull();
    for (const name of LOCAL) expect(scroller.getByText(name)).toBeTruthy();
    expect(scroller.getByText('Forest watercolor'), 'the online styles still work').toBeTruthy();
  });

  it('counts only the styles it offers in the group heading', async () => {
    simdAnswer = false;
    const scroller = await booklet();
    expect(scroller.getByText('Built-in styles').parentElement!.textContent).toContain(String(LOCAL.length));
  });
});
