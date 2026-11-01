// @vitest-environment jsdom
/** `SegmentedControl`: a pressed-state choice whose plate slides to the chosen slot. */
import { describe, it, expect, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { SegmentedControl } from '../../../ui/primitives/SegmentedControl';
import { spec } from '../../_support/spec';

afterEach(cleanup);

const OPTIONS = ['a', 'b', 'c'] as const;
type Opt = (typeof OPTIONS)[number];

/** The sliding plate is the control's one `aria-hidden` child. */
const pillOf = (container: HTMLElement) => container.querySelector('[aria-hidden]') as HTMLElement;

function Toggle({ value, onChange, options = OPTIONS }: { value: Opt; onChange: (o: Opt) => void; options?: readonly Opt[] }) {
  return <SegmentedControl idPrefix="probe" value={value} options={options} onChange={onChange} />;
}

describe('choosing an option', () => {
  it('reports the pressed option and marks only the chosen one pressed', () => {
    const chosen: Opt[] = [];
    const { rerender } = render(<Toggle value="a" onChange={(o) => chosen.push(o)} />);
    fireEvent.click(screen.getByRole('button', { name: 'c' }));
    expect(chosen).toEqual(['c']);
    rerender(<Toggle value="c" onChange={() => {}} />);
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true']);
  });
});

/** Gives the control and each slot a box, so the measured plate has somewhere to travel: jsdom lays
 *  nothing out. Three slots inside a 300 px control. */
const SLOTS = [[3, 80], [87, 120], [211, 86]] as const;
function layOut(container: HTMLElement) {
  const rect = (x: number, w: number) => ({ x, y: 0, left: x, top: 0, right: x + w, bottom: 30, width: w, height: 30, toJSON: () => ({}) }) as DOMRect;
  (container.firstElementChild as HTMLElement).getBoundingClientRect = () => rect(40, 300);
  screen.getAllByRole('button').forEach((b, i) => {
    const [l, w] = SLOTS[i]!;
    b.getBoundingClientRect = () => rect(40 + l, w);
  });
}

function Measured({ value }: { value: Opt }) {
  return <SegmentedControl idPrefix="probe-measured" value={value} options={OPTIONS} onChange={() => {}} stretch={false} />;
}

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
    layOut(container);
    rerender(<Measured value="a" />);
    const from = parseFloat(pillOf(container).style.left);
    rerender(<Measured value="c" />);
    const seen = await sampleSlide(pillOf(container));
    const to = seen.at(-1)!;
    expect(to).toBeGreaterThan(from);
    // It travelled through frames between its ends, each no further back than the one before and none past where it stopped.
    expect(seen.some((x) => x > from + 1 && x < to - 1)).toBe(true);
    for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]! - 1e-6);
    expect(Math.max(...seen)).toBeLessThanOrEqual(to + 1e-6);
  });

  spec('UI-08', 'under reduced motion the plate lands on the chosen slot at once', async () => {
    const view = (value: Opt) => <MotionConfig reducedMotion="always"><Measured value={value} /></MotionConfig>;
    const { container, rerender } = render(view('a'));
    layOut(container);
    rerender(view('a'));
    const from = parseFloat(pillOf(container).style.left);
    rerender(view('c'));
    const seen = await sampleSlide(pillOf(container));
    expect(seen[0]).toBeGreaterThan(from);
    expect(seen.every((x) => x === seen[0])).toBe(true);
  });
});
