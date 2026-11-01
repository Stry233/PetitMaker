// @vitest-environment jsdom
/**
 * The stepped slider's glide: the knob and fill travel to each new stop past React and stand exactly at
 * the value's share at rest; reduced motion places them at once. Real timers throughout: Framer's frame
 * loop stops for the rest of a file once fake timers are installed.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MotionConfig, motion } from 'framer-motion';
import { useSliderGlide } from '../../../ui/primitives/use-slider-glide';
import { spec } from '../../_support/spec';

let renders = 0;

function Knob({ share }: { share: number }) {
  renders++;
  const glide = useSliderGlide(share);
  return <motion.div data-testid="knob" style={{ left: glide.percent }} />;
}

function mount(share: number, reduced: boolean) {
  const tree = (s: number) => (
    <MotionConfig reducedMotion={reduced ? 'always' : 'never'}><Knob share={s} /></MotionConfig>
  );
  const view = render(tree(share));
  return { show: (next: number) => view.rerender(tree(next)) };
}

const nextFrame = () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
const left = () => parseFloat(screen.getByTestId('knob').style.left);

afterEach(() => { cleanup(); renders = 0; });

describe('the slider glide', () => {
  it('stands at the first value it is given without travelling to it', () => {
    mount(0.25, false);
    expect(screen.getByTestId('knob').style.left).toBe('25%');
  });

  spec('UI-07', 'a slider stepping to a new stop glides there and rests exactly on it, rendering only for the step', async () => {
    const { show } = mount(0, false);
    show(0.5);
    const after = renders;
    await nextFrame();
    expect(left()).toBeGreaterThan(0);
    expect(left()).toBeLessThan(50);
    await waitFor(() => expect(screen.getByTestId('knob').style.left).toBe('50%'), { timeout: 2000 });
    expect(renders).toBe(after);
  });

  spec('UI-08', 'under reduced motion a slider steps to its new stop at once', async () => {
    const { show } = mount(0, true);
    show(0.75);
    // Framer writes a motion value to the element on its next frame.
    await nextFrame();
    expect(screen.getByTestId('knob').style.left).toBe('75%');
  });

});
