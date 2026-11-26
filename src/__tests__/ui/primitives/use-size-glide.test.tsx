// @vitest-environment jsdom
/**
 * When the shared size glide travels and when it takes a size at once, on stubbed sizes and a stubbed
 * Web Animation since jsdom has neither; the glide itself is judged in a real browser.
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
  Object.defineProperty(HTMLElement.prototype, 'animate', {
    configurable: true,
    value: () => ({
      playState: 'running', currentTime: 0, onfinish: null,
      cancel() { this.playState = 'idle'; }, play() { this.playState = 'running'; },
    }),
  });
}

interface BoxProps { change?: unknown; axis: GlideAxis; disabled?: boolean; resetKey?: unknown; tick?: number }

function Box({ axis, tick, ...rest }: BoxProps) {
  const glide = useSizeGlide<HTMLDivElement>({ axis, motionId: 'notice.resize', ...rest });
  return <div ref={glide.ref} data-testid="box" data-gliding={String(glide.gliding)} data-tick={tick} />;
}

function mountBox(props: BoxProps, reduced = false) {
  stubLayout();
  const tree = (p: BoxProps) => (
    <MotionConfig reducedMotion={reduced ? 'always' : 'never'}>
      <Box {...p} />
    </MotionConfig>
  );
  const view = render(tree(props));
  return { show: (next: BoxProps) => view.rerender(tree(next)) };
}

function mount(change: unknown, axis: GlideAxis, reduced = false) {
  const { show } = mountBox({ change, axis }, reduced);
  return { show: (next: unknown) => show({ change: next, axis }) };
}

const box = () => screen.getByTestId('box');
const gliding = () => box().dataset.gliding === 'true';

afterEach(() => {
  cleanup();
  size = 100;
  for (const prop of ['offsetWidth', 'offsetHeight', 'animate'] as const) {
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

  it('travels to an announced change that moved the box', () => {
    const { show } = mount('a', 'height');
    size = 260;
    show('b');
    expect(gliding()).toBe(true);
  });

  it('stays still for a move the caller did not announce', () => {
    const { show } = mountBox({ change: 'a', axis: 'height', tick: 0 });
    size = 260;
    show({ change: 'a', axis: 'height', tick: 1 });
    expect(gliding()).toBe(false);
  });

  it('without a change to watch, travels on any commit that moved the box', () => {
    const { show } = mountBox({ axis: 'height', tick: 0 });
    size = 260;
    show({ axis: 'height', tick: 1 });
    expect(gliding()).toBe(true);
  });

  it('takes every size at once while disabled', () => {
    const { show } = mountBox({ axis: 'height', disabled: true, tick: 0 });
    size = 260;
    show({ axis: 'height', disabled: true, tick: 1 });
    expect(gliding()).toBe(false);
  });

  it('takes the size a new reset key brings at once', () => {
    const { show } = mountBox({ axis: 'height', resetKey: 'narrow' });
    size = 260;
    show({ axis: 'height', resetKey: 'wide' });
    expect(gliding()).toBe(false);
  });
});
