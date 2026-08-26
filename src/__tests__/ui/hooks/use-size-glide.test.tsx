/**
 * The shared size glide: what it does when the box it watches becomes a different size.
 *
 * jsdom lays nothing out, so the sizes are stubbed and what is pinned is the DECISION and the
 * BOOKKEEPING — that a first measurement never glides, that a change of size does, that the axis
 * asked for is the one written, and above all that nothing is left behind once the box has arrived
 * (a stale inline size is what would make the NEXT measurement lie). How the travel feels is carried
 * by the comment on the hook.
 *
 * REAL TIMERS throughout: the glide runs on Framer's own frame loop, which stops running for the
 * rest of any file that has installed fake timers even once.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { useSizeGlide, type GlideAxis } from '../../../ui/hooks/use-size-glide';

/** The stubbed layout: one number both axes report, changed between renders. */
let size = 100;

function stubLayout() {
  for (const prop of ['offsetWidth', 'offsetHeight'] as const) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => size });
  }
}

function Box({ change, axis }: { change: unknown; axis: GlideAxis }) {
  const glide = useSizeGlide<HTMLDivElement>(change, { axis });
  return <div ref={glide.ref} data-testid="box" data-gliding={String(glide.gliding)} />;
}

/** A caller that outlives the box it watches, so one hook instance can be handed a second element. */
function Owner({ change, axis, box }: { change: unknown; axis: GlideAxis; box: boolean }) {
  const glide = useSizeGlide<HTMLDivElement>(change, { axis });
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
/** The same reading taken off the owner, for the box that is not always there to carry it. */
const owning = () => screen.getByTestId('owner').dataset.gliding === 'true';

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
    // There is nothing to glide FROM: a surface arriving is simply its own size.
    expect(gliding()).toBe(false);
    expect(box().style.width).toBe('');
  });

  it('eases the box when a change makes it a different size, and leaves nothing behind', async () => {
    const { show } = mount('a', 'width');
    size = 260;
    show('b');
    // The decision is taken in the same commit; the first WRITE lands a frame later, so it is
    // waited for (waitFor re-checks on every DOM mutation, which is what a size write is).
    expect(gliding()).toBe(true);
    await waitFor(() => expect(box().style.width).not.toBe(''), { timeout: 3000 });
    // And the box arrives carrying nothing: a leftover inline size is what would make the NEXT
    // measurement describe the last glide instead of the content.
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

  it('eases the change after a glide too, and the one after that', async () => {
    const { show } = mount('a', 'width');
    // Re-reading the bookkeeping when a landed glide's effect is torn down — which happens as the
    // NEXT change commits — records the box's new size as the size to start from, so every second
    // change snaps. Three in a row is what tells a fix from an alternation.
    for (const [next, size2] of [['b', 260], ['c', 180], ['d', 420]] as const) {
      size = size2;
      show(next);
      expect(gliding()).toBe(true);
      await waitFor(() => expect(gliding()).toBe(false), { timeout: 3000 });
      expect(box().style.width).toBe('');
    }
  });

  /**
   * THE TARGET IS MEASURED WHEN THE GLIDE IS PLANNED, and the content can settle under it while it
   * flies: a web font arrives, an image decodes, a line finishes its crossfade. Landing on that
   * stale number and then clearing the inline size steps the remaining distance in one frame, which
   * is the jump this hook exists to remove — and it also leaves the bookkeeping describing a size
   * the box never had, so the NEXT change travels from the wrong place.
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

    // The last width it drew is one it travelled to, not the one it was aimed at.
    expect(Number.parseFloat(drawn.filter((w) => w !== '').pop()!)).toBeGreaterThan(261);
    // And it knows where it landed: a change to the size the box already is has nothing to travel.
    show('c');
    expect(gliding()).toBe(false);
  });

  it('takes its own size when the box it watches is a different box', async () => {
    // The OWNER stays mounted while the box comes and goes, which is the shape that makes this a
    // question at all (a modal card between opens, a notice between arrivals): the hook and its
    // bookkeeping survive, and only the element it measures is replaced.
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
    // Whatever the box that went away had settled at is not a size the new one can travel from.
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
    // The change has already said what it had to say, so the travel is decoration and is dropped.
    expect(gliding()).toBe(false);
    expect(box().style.height).toBe('');
  });
});
