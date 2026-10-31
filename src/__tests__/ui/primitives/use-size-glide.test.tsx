// @vitest-environment jsdom
/**
 * The shared size glide, on stubbed sizes since jsdom has no layout. No inline size may remain once
 * the box arrives, or the next measurement would read it. Real timers throughout: Framer's frame
 * loop stops for the rest of a file once fake timers are installed.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
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

/** A caller that outlives the box it watches, so one hook instance can be handed a second element. */
function Owner({ change, axis, box }: { change: unknown; axis: GlideAxis; box: boolean }) {
  const glide = useSizeGlide<HTMLDivElement>(change, { axis, motionId: 'notice.resize' });
  return (
    <div data-testid="owner" data-gliding={String(glide.gliding)}>
      {box && <div ref={glide.ref} data-testid="box" />}
    </div>
  );
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
/** The gliding flag read off the owner, for a box that comes and goes. */
const owning = () => screen.getByTestId('owner').dataset.gliding === 'true';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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

  it('eases the box when a change makes it a different size, and leaves nothing behind', async () => {
    const { show } = mount('a', 'width');
    size = 260;
    show('b');
    expect(gliding()).toBe(true);
    expect(box().style.width).toBe('100px');
    await waitFor(() => expect(box().style.width).toBe(''), { timeout: 3000 });
    expect(gliding()).toBe(false);
  });

  it('writes the axis it was asked for and no other', async () => {
    const { show } = mount('a', 'height');
    size = 260;
    show('b');
    await waitFor(() => expect(box().style.height).not.toBe(''), { timeout: 3000 });
    expect(box().style.width).toBe('');
    await waitFor(() => expect(box().style.height).toBe(''), { timeout: 3000 });
  });

  it('starts from the settled size after idle content changes', async () => {
    let resized = () => {};
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resized = callback; }
      observe() {}
      disconnect() {}
    });
    const { show } = mount('a', 'height');
    size = 140;
    resized();
    size = 260;
    show('b');
    expect(box().style.height).toBe('140px');
    await waitFor(() => expect(box().style.height).toBe(''), { timeout: 3000 });
  });

  it('eases the change after a glide too, and the one after that', async () => {
    const { show } = mount('a', 'width');
    // A landed glide's effect is torn down as the next change commits; re-reading the size there
    // would make every second change snap, so three in a row rule out alternation.
    for (const [next, size2] of [['b', 260], ['c', 180], ['d', 420]] as const) {
      size = size2;
      show(next);
      expect(gliding()).toBe(true);
      await waitFor(() => expect(gliding()).toBe(false), { timeout: 3000 });
      expect(box().style.width).toBe('');
    }
  });

  /**
   * Content can settle mid-flight (a font arrives, an image decodes). Landing on the planned size
   * and then clearing it would jump the rest in one frame and record a size the box never had.
   */
  it('lands on the size the box is, not the size it set off for', async () => {
    const { show } = mount('a', 'width');
    const drawn: string[] = [];
    const writes = new MutationObserver(() => drawn.push(box().style.width));
    writes.observe(box(), { attributes: true, attributeFilter: ['style'] });
    size = 260;
    show('b');
    await waitFor(() => expect(box().style.width).not.toBe(''), { timeout: 3000 });
    size = 300; // the content settles wider, mid-flight
    await waitFor(() => expect(gliding()).toBe(false), { timeout: 3000 });
    writes.disconnect();
    expect(box().style.width).toBe('');

    expect(Number.parseFloat(drawn.filter((w) => w !== '').pop()!)).toBeGreaterThan(261);
    // It recorded where it landed, so the same size again does not glide.
    show('c');
    expect(gliding()).toBe(false);
  });

  it('takes its own size when the box it watches is a different box', async () => {
    // The owner stays mounted while the box comes and goes, as a modal card between opens does.
    stubLayout();
    const draw = (change: unknown, box: boolean) => (
      <MotionConfig reducedMotion="never"><Owner change={change} axis="height" box={box} /></MotionConfig>
    );
    const view = render(draw('a', true));
    size = 260;
    view.rerender(draw('b', true));
    await waitFor(() => expect(owning()).toBe(false), { timeout: 3000 });

    view.rerender(draw('b', false)); // the box goes away, the hook does not
    size = 500;
    view.rerender(draw('c', true));
    expect(owning()).toBe(false);
    expect(box().style.height).toBe('');
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
