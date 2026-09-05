/**
 * The Save/Share toggle bounce: in stretch mode, animating `SegmentedControl`'s pill to a PIXEL box
 * measured off the active button's DOM offset re-measures on every tick of a host card's resize (e.g.
 * tweening to fit a new panel) and re-aims the pill's spring at a moving target — a spring chasing a
 * moving destination reads as bounce no matter how the resize itself is eased.
 *
 * The target is instead a FRACTION of the track — gap-aware, since the buttons flex in a
 * `gap`ped row: `left: calc((100% + gap) * i/n)`, `width: calc((100% - gap*(n-1)) / n)` — which a
 * resize cannot move: the fraction is exact by construction and the track carries the pill
 * passively under a resize. These assertions pin the DOM fraction for each index and ensure track
 * measurements cannot perturb it.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SegmentedControl } from '../../../ui/primitives/SegmentedControl';

afterEach(cleanup);

/** Let the pill's spring actually settle: jsdom's real `requestAnimationFrame` needs real time to
 *  tick, which a value change (as opposed to the instant first paint) genuinely animates through. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 500)));

const OPTIONS = ['a', 'b', 'c'] as const;
type Opt = (typeof OPTIONS)[number];

/** The sliding pill is the control's one `aria-hidden` child. */
const pillOf = (container: HTMLElement) => container.querySelector('[aria-hidden]') as HTMLElement;

/** The gap-aware fraction the component aims at (TRACK_GAP = 4): button i of n in a gapped flex
 *  row sits at i*(W+gap)/n with width (W - gap*(n-1))/n. */
// Serialized in the CSSOM's normalized factor-first order.
const leftOf = (i: number, n: number) => `calc(${i / n} * (100% + 4px))`;
const widthOf = (n: number) => `calc(${1 / n} * (100% - ${4 * (n - 1)}px))`;

function Toggle({ value, onChange, options = OPTIONS }: { value: Opt; onChange: (o: Opt) => void; options?: readonly Opt[] }) {
  return <SegmentedControl idPrefix="probe" value={value} options={options} onChange={onChange} />;
}

describe('stretch mode (the default)', () => {
  it('aims the pill at a fraction of the track, not a measured pixel box', () => {
    const { container } = render(<Toggle value="b" onChange={() => {}} />);
    const pill = pillOf(container);
    // index 1 of 3: the gap-aware thirds — fractional calc strings, never measured px.
    expect(pill.style.left).toBe(leftOf(1, 3));
    expect(pill.style.width).toBe(widthOf(3));
  });

  it('places index 0 of n at the track\'s own left edge', () => {
    const { container } = render(<Toggle value="a" onChange={() => {}} />);
    const pill = pillOf(container);
    expect(pill.style.left).toBe(leftOf(0, 3));
  });

  it('places the last index at (n-1)/n', () => {
    const { container } = render(<Toggle value="c" onChange={() => {}} />);
    const pill = pillOf(container);
    expect(pill.style.left).toBe(leftOf(2, 3));
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
    // The width is the same equal share at every index — only the position travelled.
    expect(pillOf(container).style.width).toBe(widthOf(3));
  });

  it('a track width change does not move the animate target', () => {
    // A pill aimed at the active button's `offsetLeft`/`offsetWidth` re-measures
    // on every resize. Stretch mode reads neither: stub them to prove the pill's target is
    // computed purely from index/count and cannot see a DOM box at all.
    Object.defineProperty(HTMLElement.prototype, 'offsetLeft', { configurable: true, value: 999 });
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 999 });
    try {
      const { container } = render(<Toggle value="b" onChange={() => {}} />);
      const pill = pillOf(container);
      expect(pill.style.left).toBe(leftOf(1, 3));
      expect(pill.style.width).toBe(widthOf(3));
    } finally {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetLeft;
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetWidth;
    }
  });
});

describe('non-stretch mode (content-sized)', () => {
  it('still measures a pixel box, not a fraction', () => {
    // jsdom lays nothing out, so offsetLeft/offsetWidth read 0 for every element — but the point
    // here is only that the pill's style comes from that measured (unitless-in-jsdom) box rather
    // than from a percentage string, i.e. the two modes stay genuinely different code paths.
    const { container } = render(
      <SegmentedControl idPrefix="probe-inline" value="b" options={OPTIONS} onChange={() => {}} stretch={false} />,
    );
    const pill = pillOf(container);
    expect(pill.style.left.includes('%')).toBe(false);
    expect(pill.style.width.includes('%')).toBe(false);
  });
});
