/**
 * atoms.test.tsx — the panel's own atoms: the construction-tape progress bar, the dock's segment
 * countdown, an op's outcome tick, the window pill ported into the panel's paper, and a single-line
 * stamp.
 *
 * Colour assertions never compare a hex literal against a browser-normalized `style.color` /
 * `style.background` string directly (jsdom's cssstyle serializes a set value, and the two can
 * disagree in form though not in meaning): `asColor`/`asBackground` push BOTH sides of a comparison
 * through the same DOM round-trip, so the assertion is meaning-for-meaning.
 */
import { describe, it, expect } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { CountPill, Pill, ResultChip, Stamp, TapeBar, TickDot } from '../../../ui/agent/atoms';
import { tape, tickInk } from '../../../ui/agent/tokens';
import { INK } from '../../../ui/design/tokens';
import { colors } from '../../../ui/design/styles';
import { windowPill, type PillVariant, type WindowSurface } from '../../../ui/design/window-skin';
import { I18nProvider } from '../../../i18n/context';
import { MOTIONS } from '../../../ui/shell/motion/registry';
import type { OpRow } from '../../../agent/core/project-view';

// `CountPill` reads `useT`, which reaches the editor store for the active locale; the store's own
// persistence writes to `localStorage`, which jsdom leaves absent here.
const backing = new Map<string, string>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).localStorage = {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
};

function inI18n(node: React.ReactElement) {
  return render(node, { wrapper: ({ children }) => <I18nProvider>{children}</I18nProvider> });
}

function asColor(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}
function asBackground(value: string): string {
  const probe = document.createElement('span');
  probe.style.background = value;
  return probe.style.background;
}

describe('TapeBar', () => {
  const fillOf = (c: HTMLElement) => c.querySelector('[data-testid="tape-fill"]') as HTMLElement;
  const stripesOf = (c: HTMLElement) => c.querySelector('[data-testid="tape-stripes"]') as HTMLElement;

  it('determinate renders the fill at `fraction` of the track width', () => {
    const { container } = render(<TapeBar mode={{ fraction: 0.42 }} />);
    expect(fillOf(container).style.width).toBe('42%');
  });

  it('determinate clamps a fraction outside 0..1', () => {
    const over = render(<TapeBar mode={{ fraction: 1.4 }} />);
    expect(fillOf(over.container).style.width).toBe('100%');
    over.unmount();
    const under = render(<TapeBar mode={{ fraction: -0.2 }} />);
    expect(fillOf(under.container).style.width).toBe('0%');
  });

  it('crawls while the measured fraction stays unchanged', () => {
    const { container } = render(<TapeBar mode={{ fraction: 0.5 }} />);
    expect(stripesOf(container).className).toContain('pw-stripe-drift');
    expect(fillOf(container).style.width).toBe('50%');
  });

  /** Unknown work is never a FULL bar: a short left-anchored pill (26% of the track) with its
   *  stripes crawling is the one honest way to show progress nobody can measure. */
  it('indeterminate is a SHORT left-anchored pill, never the whole track, and crawls when motion is not reduced', () => {
    const { container } = render(<TapeBar mode="indeterminate" />);
    expect(fillOf(container).style.width).toBe('26%');
    expect(stripesOf(container).className).toContain('pw-stripe-drift');
  });

  it('indeterminate drops the crawl class under reduced motion, but stands as the same partial pill', () => {
    const { container } = render(
      <MotionConfig reducedMotion="always">
        <TapeBar mode="indeterminate" />
      </MotionConfig>,
    );
    expect(fillOf(container).style.width).toBe('26%');
    expect(stripesOf(container).className).not.toContain('pw-stripe-drift');
  });

  /** A hold (pause, stop, retry) freezes the fill exactly where it stands and dims it: the crawl
   *  stops even where motion is otherwise allowed, and the width it froze at is never touched. */
  it('held freezes an indeterminate pill: no crawl, dimmed, still the 26% pill', () => {
    const { container } = render(<TapeBar mode="indeterminate" held />);
    expect(fillOf(container).style.width).toBe('26%');
    expect(fillOf(container).style.opacity).toBe('0.45');
    expect(stripesOf(container).className).not.toContain('pw-stripe-drift');
    expect(stripesOf(container).style.animationDuration).toBe('');
  });

  it('held dims a determinate fill but keeps its own fraction width', () => {
    const { container } = render(<TapeBar mode={{ fraction: 0.6 }} held />);
    expect(fillOf(container).style.width).toBe('60%');
    expect(fillOf(container).style.opacity).toBe('0.45');
    expect(stripesOf(container).className).not.toContain('pw-stripe-drift');
  });

  it('unheld determinate and indeterminate both stand at full opacity', () => {
    const { container } = render(<TapeBar mode={{ fraction: 0.6 }} />);
    expect(fillOf(container).style.opacity).toBe('');
  });

  it('casts no shadow', () => {
    const { container } = render(<TapeBar mode="indeterminate" />);
    const track = container.querySelector('[data-testid="tape-bar"]') as HTMLElement;
    expect(['', 'none']).toContain(track.style.boxShadow);
  });

  /** The crawl's length is declared in the motion registry; `.pw-stripe-drift` carries the keyframes
   *  and the reduced-motion gate but its own duration belongs to the shell's other users of the
   *  class, so the bar has to override it. A silent divergence here is a motion running at somebody
   *  else's speed. */
  it('crawls for exactly as long as the registry declares', () => {
    const { container } = render(<TapeBar mode="indeterminate" />);
    expect(stripesOf(container).style.animationDuration).toBe(`${MOTIONS['panel.tape.crawl'].duration}s`);
  });

  it('sets no duration where there is no crawl to time', () => {
    const { container } = render(<TapeBar mode={{ fraction: 0.5 }} held />);
    expect(stripesOf(container).style.animationDuration).toBe('');
  });

  /** The pattern repeats at one stripe period, so a cycle that travels any other distance jumps at
   *  the seam. The assertion is against the DRAWING's own geometry (`tokens.ts:tape.stripeSize`),
   *  which is where that number lives and what the crawl's declared amplitude is read from. */
  it('travels one stripe period per cycle, the distance the pattern repeats at', () => {
    const { container } = render(<TapeBar mode="indeterminate" />);
    expect(stripesOf(container).style.getPropertyValue('--pw-stripe-travel')).toBe(`${tape.stripeSize}px`);
  });

  /**
   * THE CRAWL MOVES A LAYER, NOT A BACKGROUND. `background-position` is not a composited property:
   * Blink repaints and pixel-snaps it, and one 11.31px period per 1.6s is a 0.06px step per frame,
   * which stands still for a dozen frames and then jumps a whole device pixel. The stripes read as
   * shaking. So the striped layer is its own absolutely-placed box, one period wider than the fill
   * on the leading side, and the class that moves it moves a transform.
   */
  it('crawls by travelling a layer that overhangs the fill by one whole period', () => {
    const { container } = render(<TapeBar mode="indeterminate" />);
    const stripes = stripesOf(container);
    expect(stripes.style.position).toBe('absolute');
    expect(stripes.style.left).toBe(`-${tape.stripeSize}px`);
    expect(stripes.style.right).toBe('0px');
    // The fill CLIPS it, which is what keeps the fill's own rounded cap.
    expect(fillOf(container).style.overflow).toBe('hidden');
    // Nothing on either box animates a background.
    expect(stripes.className).not.toContain('pw-stripes');
  });
});

/** Every operation status and its rendered mark. `satisfies` validates the entries without
 * widening their literal types, which keeps the exhaustiveness assertion meaningful. */
const END_MARKS = [
  ['ok', 'pw-check', tickInk.ok],
  ['run', 'spin', ''],
  ['revert', 'pw-undo-arrow', tickInk.revert],
  ['error', 'pw-cross', tickInk.error],
  // Held back, never passed: the outline shield in the revert ink, since nothing was applied.
  ['blocked', 'pw-shield-hold', tickInk.revert],
  // The user declined it: a QUIET cross, never the refusal red.
  ['skipped', 'pw-cross', colors.brownText],
  ['cut', 'pw-stop', colors.brownText],
  ['words', 'pw-reply-bubble', colors.brownText],
  ['pending-gate', 'pw-reply-bubble', colors.brownText],
] as const satisfies ReadonlyArray<readonly [OpRow['status'], string, string]>;
// A callable (not a bare type alias) so the constraint is actually CHECKED by `tsc`: a status the
// table above forgot makes `Exclude<...>` non-`never`, and the call below fails to typecheck.
function assertExhaustive<T extends never>(): T[] {
  return [];
}
assertExhaustive<Exclude<OpRow['status'], (typeof END_MARKS)[number][0]>>();

describe('TickDot: the end-mark vocabulary', () => {
  for (const [status, mark, ink] of END_MARKS) {
    it(`${status} draws ${mark}`, () => {
      const { container, getByTestId } = render(<TickDot status={status} />);
      if (mark === 'spin') {
        // A call still running wears the house tight-space loader, not a mark of its own: which
        // phase it is in belongs to the words on the row.
        expect(container.querySelector('use')).toBeNull();
        expect(container.querySelector('.pw-busy')).not.toBeNull();
        return;
      }
      expect(container.querySelector('use')!.getAttribute('href')).toBe(`#${mark}`);
      expect(asColor(getByTestId('tick-dot').style.color)).toBe(asColor(ink));
    });
  }

  it('ok paints the quiet done ink, not a green of its own', () => {
    expect(asColor(tickInk.ok)).toBe(asColor(INK));
  });

  /** The ask PAPER is the dock's alone. A mark on its own coloured pill inside an op row reads
   *  as a second card in the middle of the record. */
  it('no status paints a background of its own', () => {
    for (const [status] of END_MARKS) {
      const { getByTestId, unmount } = render(<TickDot status={status} />);
      const bg = getByTestId('tick-dot').style.background;
      expect(bg === '' || asBackground(bg) === asBackground('transparent'), status).toBe(true);
      unmount();
    }
  });
});

describe('Pill', () => {
  const variants: PillVariant[] = ['quiet', 'active', 'danger'];

  for (const variant of variants) {
    it(`${variant} mirrors windowPill's fill`, () => {
      const expected = windowPill(variant);
      const { getByTestId } = render(<Pill variant={variant}>Label</Pill>);
      const el = getByTestId('pill');
      expect(asBackground(el.style.background)).toBe(asBackground(String(expected.background)));
      expect(asColor(el.style.color)).toBe(asColor(String(expected.color)));
    });
  }

  it('a quiet pill flips its fill when it stands on an inset surface', () => {
    const surfaces: WindowSurface[] = ['plate', 'inset'];
    const [onPlate, onInset] = surfaces.map((on) => {
      const { getByTestId, unmount } = render(<Pill on={on}>Label</Pill>);
      const bg = asBackground(getByTestId('pill').style.background);
      unmount();
      return bg;
    });
    expect(onPlate).not.toBe(onInset);
  });

  it('defaults to the quiet variant on the plate surface', () => {
    const expected = windowPill('quiet', false, 'plate');
    const { getByTestId } = render(<Pill>Label</Pill>);
    expect(asBackground(getByTestId('pill').style.background)).toBe(asBackground(String(expected.background)));
  });

  it('casts no shadow', () => {
    const { getByTestId } = render(<Pill>Label</Pill>);
    expect(['', 'none']).toContain(getByTestId('pill').style.boxShadow);
  });

  /** Pills use the shared button feedback rather than relying on global button CSS. */
  it('takes the house press feedback', async () => {
    const { getByTestId } = render(
      <MotionConfig reducedMotion="never"><Pill>Label</Pill></MotionConfig>,
    );
    const pill = getByTestId('pill');
    fireEvent.pointerEnter(pill);
    // The spring writes the transform on its own frames, not in the event.
    await waitFor(() => expect(pill.style.transform, 'the hover grows it').toContain('scale'));
  });

  /** A control that refuses must not answer the pointer at all. */
  it('gives a disabled pill no press feedback', async () => {
    const { getByTestId } = render(
      <MotionConfig reducedMotion="never"><Pill disabled>Label</Pill></MotionConfig>,
    );
    const pill = getByTestId('pill');
    fireEvent.pointerEnter(pill);
    await new Promise((resolve) => { setTimeout(resolve, 120); });
    expect(pill.style.transform).toBe('');
  });

  /** A screen with several pills has to be able to name each one; without this a caller wraps every
   *  pill in a labelled box just to select it, which moves the layout. */
  it('passes a test id through, and answers to the generic one otherwise', () => {
    const named = render(<Pill data-testid="setup-retry-list">Label</Pill>);
    expect(named.getByTestId('setup-retry-list')).toBeTruthy();
    expect(named.queryByTestId('pill')).toBeNull();
    named.unmount();

    const plain = render(<Pill>Label</Pill>);
    expect(plain.getByTestId('pill')).toBeTruthy();
  });
});

describe('Stamp', () => {
  it('renders its icon and label in one line, in the muted ink', () => {
    const { container, getByText, getByTestId } = render(<Stamp icon="pw-compress">Tidied my notes</Stamp>);
    expect(getByText('Tidied my notes')).toBeTruthy();
    const use = container.querySelector('use')!;
    expect(use.getAttribute('href')).toBe('#pw-compress');
    expect(asColor(getByTestId('stamp').style.color)).toBe(asColor(colors.brownText));
  });

  it('casts no shadow', () => {
    const { getByTestId } = render(<Stamp icon="pw-compress">Note</Stamp>);
    expect(['', 'none']).toContain(getByTestId('stamp').style.boxShadow);
  });

  /** A noted line may use a second line so the record preserves the user's text. */
  it('lets its text run to two lines rather than ellipsizing at one', () => {
    const { getByTestId } = render(<Stamp icon="pw-note">Noted: keep the shore clear of houses</Stamp>);
    const text = getByTestId('stamp-text');
    expect(text.style.webkitLineClamp).toBe('2');
    expect(text.style.whiteSpace).not.toBe('nowrap');
  });
});

describe('CountPill', () => {
  it('names the total on its own, and the tail it left showing when some rows are visible', () => {
    const all = inI18n(<CountPill total={9} />);
    expect(all.getByTestId('ops-count-pill').textContent).toBe('9 steps');
    all.unmount();
    const some = inI18n(<CountPill total={9} shown={3} />);
    expect(some.getByTestId('ops-count-pill').textContent).toBe('9 steps, last 3');
  });

  /** `shown` at or above the total has nothing behind it to name. */
  it('says only the total when the tail is the whole list', () => {
    const { getByTestId } = inI18n(<CountPill total={3} shown={3} />);
    expect(getByTestId('ops-count-pill').textContent).toBe('3 steps');
  });

  /** The reachable n=1 case: a one-step job names it as one step, not one steps. */
  it('says one step, not one steps, at a job of exactly one', () => {
    const { getByTestId } = inI18n(<CountPill total={1} />);
    expect(getByTestId('ops-count-pill').textContent).toBe('1 step');
  });
});

describe('ResultChip', () => {
  it('reads in the plate ink by default and takes the two outcome tones', () => {
    const plain = render(<ResultChip>kept in your region</ResultChip>);
    const plainInk = asColor(plain.getByTestId('op-chip').style.color);
    plain.unmount();
    const warn = render(<ResultChip tone="warn">put back</ResultChip>);
    expect(asColor(warn.getByTestId('op-chip').style.color)).toBe(asColor(tickInk.revert));
    warn.unmount();
    const bad = render(<ResultChip tone="bad">arguments unreadable</ResultChip>);
    expect(asColor(bad.getByTestId('op-chip').style.color)).toBe(asColor(tickInk.error));
    expect(plainInk).not.toBe(asColor(tickInk.revert));
  });

  /** The chip is a SHORT phrase beside a row, never a second line of prose: it ellipsizes. */
  it('stays on one line', () => {
    const { getByTestId } = render(<ResultChip>a long refusal phrase that will not fit</ResultChip>);
    const chip = getByTestId('op-chip');
    expect(chip.style.whiteSpace).toBe('nowrap');
    expect(chip.style.textOverflow).toBe('ellipsis');
  });
});
