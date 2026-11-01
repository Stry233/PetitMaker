// @vitest-environment jsdom
/**
 * The shared size glide's still cases, on stubbed sizes since jsdom has no layout; the glide itself
 * is judged in a real browser.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { useSizeGlide, type GlideAxis } from '../../../ui/primitives/use-size-glide';

/** The stubbed layout: one number both axes report, changed between renders. */
let size = 100;

function stubLayout() {
  for (const prop of ['offsetWidth', 'offsetHeight'] as const) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => size });
  }
}

function Box({ change, axis }: { change: unknown; axis: GlideAxis }) {
  const glide = useSizeGlide<HTMLDivElement>(change, { axis, motionId: 'notice.resize' });
  return <div ref={glide.ref} data-testid="box" data-gliding={String(glide.gliding)} />;
}

function mount(change: unknown, axis: GlideAxis, reduced = false) {
  stubLayout();
  const view = render(
    <MotionConfig reducedMotion={reduced ? 'always' : 'never'}>
      <Box change={change} axis={axis} />
    </MotionConfig>,
  );
  const show = (next: unknown) => view.rerender(
    <MotionConfig reducedMotion={reduced ? 'always' : 'never'}>
      <Box change={next} axis={axis} />
    </MotionConfig>,
  );
  return { show };
}

const box = () => screen.getByTestId('box');
const gliding = () => box().dataset.gliding === 'true';

afterEach(() => {
  cleanup();
  size = 100;
  for (const prop of ['offsetWidth', 'offsetHeight'] as const) {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)[prop];
  }
});

describe('the size glide', () => {
  it('takes the first size it measures without travelling to it', () => {
    mount('a', 'width');
    expect(gliding()).toBe(false);
    expect(box().style.width).toBe('');
  });

  it('stays still for a change that did not move the box', () => {
    const { show } = mount('a', 'width');
    show('b'); // same stubbed size
    expect(gliding()).toBe(false);
    expect(box().style.width).toBe('');
  });

  it('takes the new size outright under reduced motion', () => {
    const { show } = mount('a', 'height', true);
    size = 260;
    show('b');
    expect(gliding()).toBe(false);
    expect(box().style.height).toBe('');
  });
});
