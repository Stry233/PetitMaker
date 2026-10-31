// @vitest-environment jsdom
/**
 * `SegmentedControl` aims its plate at a share of its own box rather than a pixel box: a pixel target
 * moves on every tick of a host's resize glide, and a motion chasing a moving target reads as bounce.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { SegmentedControl } from '../../../ui/primitives/SegmentedControl';
import { spec } from '../../_support/spec';

afterEach(cleanup);

/** Lets the plate's slide finish: a value change animates on jsdom's real `requestAnimationFrame`. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 500)));

const OPTIONS = ['a', 'b', 'c'] as const;
type Opt = (typeof OPTIONS)[number];

/** The sliding plate is the control's one `aria-hidden` child. */
const pillOf = (container: HTMLElement) => container.querySelector('[aria-hidden]') as HTMLElement;

/** Button i of n in a 4px-gapped row sits at i*(W+gap)/n with width (W - gap*(n-1))/n, written in the
 *  CSSOM's factor-first order. */
const leftOf = (i: number, n: number) => `calc(${i / n} * (100% + 4px))`;
const widthOf = (n: number) => `calc(${1 / n} * (100% - ${4 * (n - 1)}px))`;

function Toggle({ value, onChange, options = OPTIONS }: { value: Opt; onChange: (o: Opt) => void; options?: readonly Opt[] }) {
  return <SegmentedControl idPrefix="probe" value={value} options={options} onChange={onChange} />;
}

describe('stretch mode (the default)', () => {
  it('aims the plate at a fraction of the track, not a measured pixel box', () => {
    const { container } = render(<Toggle value="b" onChange={() => {}} />);
    const pill = pillOf(container);
    expect(pill.style.left).toBe(leftOf(1, 3));
    expect(pill.style.width).toBe(widthOf(3));
  });

  it('places index 0 of n at the track\'s own left edge', () => {
    const { container } = render(<Toggle value="a" onChange={() => {}} />);
    expect(pillOf(container).style.left).toBe(leftOf(0, 3));
  });

  it('places the last index at (n-1)/n', () => {
    const { container } = render(<Toggle value="c" onChange={() => {}} />);
    expect(pillOf(container).style.left).toBe(leftOf(2, 3));
  });

  it('recomputes the fraction from the option count, not a fixed thirds', () => {
    const { container } = render(<Toggle value="b" onChange={() => {}} options={['a', 'b'] as const} />);
    const pill = pillOf(container);
    expect(pill.style.left).toBe(leftOf(1, 2));
    expect(pill.style.width).toBe(widthOf(2));
  });

  it('changing the selection moves only the fraction, to the new index\'s own slot', async () => {
    let value: Opt = 'a';
    const { container, rerender } = render(<Toggle value={value} onChange={(o) => { value = o; }} />);
    expect(pillOf(container).style.left).toBe(leftOf(0, 3));

    fireEvent.click(screen.getByText('c'));
    rerender(<Toggle value={value} onChange={() => {}} />);
    await settle();
    expect(pillOf(container).style.left).toBe(leftOf(2, 3));
    expect(pillOf(container).style.width).toBe(widthOf(3));
  });
});

/** Lays the control out as a browser would: `width` px wide at `left`, each slot at its own box, every
 *  reading scaled by `zoom` as a lifted surface draws it. */
type Slot = readonly [left: number, width: number];
function layOut(container: HTMLElement, slots: readonly Slot[], { left = 40, width = 300, zoom = 1 } = {}) {
  const h = 30 * zoom;
  const rect = (x: number, w: number) => ({ x, y: 0, left: x, top: 0, right: x + w, bottom: h, width: w, height: h, toJSON: () => ({}) }) as DOMRect;
  const wrap = container.firstElementChild as HTMLElement;
  wrap.getBoundingClientRect = () => rect(left * zoom, width * zoom);
  screen.getAllByRole('button').forEach((b, i) => {
    const [l, w] = slots[i]!;
    b.getBoundingClientRect = () => rect((left + l) * zoom, w * zoom);
  });
}

/** Three slots inside a 300 px control: 3 px of track, 80, a 4 px gap, 120, 4, 86, 3. */
const SLOTS = [[3, 80], [87, 120], [211, 86]] as const;
const shareOf = (px: number) => (px / 300) * 100;

function Measured({ value, wrapLabels = false }: { value: Opt; wrapLabels?: boolean }) {
  return <SegmentedControl idPrefix="probe-measured" value={value} options={OPTIONS} onChange={() => {}} stretch={wrapLabels} wrapLabels={wrapLabels} />;
}

describe.each([
  ['content-sized slots', false],
  ['wrapping slots', true],
] as const)('%s', (_name, wrapLabels) => {
  spec('UI-59', 'the plate covers exactly the chosen slot, as its share of the control', () => {
    const { container, rerender } = render(<Measured value="b" wrapLabels={wrapLabels} />);
    layOut(container, SLOTS);
    rerender(<Measured value="b" wrapLabels={wrapLabels} />);
    const pill = pillOf(container);
    expect(pill.style.left.endsWith('%')).toBe(true);
    expect(parseFloat(pill.style.left)).toBeCloseTo(shareOf(87));
    expect(parseFloat(pill.style.width)).toBeCloseTo(shareOf(120));
  });

  spec('UI-59', 'the plate stays on its slot while the control is drawn larger or the window holding it moves', () => {
    const { container, rerender } = render(<Measured value="c" wrapLabels={wrapLabels} />);
    layOut(container, SLOTS);
    rerender(<Measured value="c" wrapLabels={wrapLabels} />);
    const before = { left: pillOf(container).style.left, width: pillOf(container).style.width };
    // The same layout lifted to 1.3 and carried across the screen by a window's glide.
    layOut(container, SLOTS, { left: 140, zoom: 1.3 });
    rerender(<Measured value="c" wrapLabels={wrapLabels} />);
    expect({ left: pillOf(container).style.left, width: pillOf(container).style.width }).toEqual(before);
  });
});

/** Samples the plate's left edge, in percent of the control, until it has stood still for 200 ms. */
async function sampleSlide(pill: HTMLElement): Promise<number[]> {
  const seen: number[] = [];
  await act(() => new Promise<void>((resolve) => {
    let still = 0;
    const timer = setInterval(() => {
      const now = parseFloat(pill.style.left);
      still = seen.length && now === seen[seen.length - 1] ? still + 4 : 0;
      seen.push(now);
      if (still >= 200 || seen.length > 500) { clearInterval(timer); resolve(); }
    }, 4);
  }));
  return seen;
}

describe('the slide', () => {
  spec('UI-59', 'the plate slides to the newly chosen slot and stops there without passing it or swinging back', async () => {
    const { container, rerender } = render(<Measured value="a" />);
    layOut(container, SLOTS);
    rerender(<Measured value="a" />);
    const from = parseFloat(pillOf(container).style.left);
    rerender(<Measured value="c" />);
    const seen = await sampleSlide(pillOf(container));
    const to = shareOf(211);
    expect(seen.at(-1)).toBeCloseTo(to);
    // It travelled through frames between its ends, each no further back than the one before and none past the slot.
    expect(seen.some((x) => x > from + 1 && x < to - 1)).toBe(true);
    for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]! - 1e-6);
    expect(Math.max(...seen)).toBeLessThanOrEqual(to + 1e-6);
  });

  spec('UI-08', 'under reduced motion the plate lands on the chosen slot at once', async () => {
    const view = (value: Opt) => <MotionConfig reducedMotion="always"><Measured value={value} /></MotionConfig>;
    const { container, rerender } = render(view('a'));
    layOut(container, SLOTS);
    rerender(view('a'));
    rerender(view('c'));
    const seen = await sampleSlide(pillOf(container));
    expect(seen[0]).toBeCloseTo(shareOf(211));
  });
});
