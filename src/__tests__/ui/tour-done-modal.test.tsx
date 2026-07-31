import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MotionConfig } from 'framer-motion';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { TourDoneModal } from '../../ui/chrome/tour/TourDoneModal';
import { I18nProvider } from '../../i18n/context';
import { useEditorStore } from '../../state/store';
import { colors } from '../../ui/styles';
import { setStoreState } from '../_store';

const wrapper = ({ children }: { children: React.ReactNode }) => <I18nProvider>{children}</I18nProvider>;

/** jsdom reports a style colour in its own normalized form, so a token has to be normalized the
 *  same way before it can be compared with what a piece actually rendered. */
function cssColor(value: string): string {
  const probe = document.createElement('div');
  probe.style.background = value;
  return probe.style.background;
}

/** The four menu-tile colours, and only those: the card is panelCream, so a piece in the card's own
 *  colour (or in white) is not a piece. */
const PALETTE = [
  colors.tileYellow, colors.tileGreen, colors.tilePaleYellow, colors.tileDeepGreen,
].map(cssColor);

function pieces(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-testid="tour-confetti"] > *'));
}

/** jsdom implements no Web Animations API, so the fall's driver has to be stood up by hand — which
 *  is also what lets a test read the keyframes each piece was actually given. */
function stubWaapi() {
  const animate = vi.fn((_frames: Keyframe[], _options: KeyframeAnimationOptions) => ({ cancel: () => {} }));
  Object.defineProperty(Element.prototype, 'animate', { value: animate, configurable: true, writable: true });
  return animate;
}

/** Every transform a piece is animated through, flattened across all its keyframes. */
function transforms(animate: ReturnType<typeof stubWaapi>): string[] {
  return animate.mock.calls.flatMap(([frames]) => frames.map((k) => String(k.transform)));
}

describe('TourDoneModal', () => {
  beforeEach(() => {
    setStoreState({ locale: 'en' });
    useEditorStore.getState().setModal('tourDone', false);
  });
  afterEach(() => {
    cleanup();
    useEditorStore.getState().setModal('tourDone', false);
    Reflect.deleteProperty(Element.prototype, 'animate');
  });

  it('stays out of the way until the tour opens it', () => {
    const { container } = render(<TourDoneModal />, { wrapper });
    expect(container.textContent).toBe('');
  });

  it('sends the visitor off with the emphasis on the app\'s own wavy underline', () => {
    useEditorStore.getState().setModal('tourDone', true);
    const { container } = render(<TourDoneModal />, { wrapper });
    const card = screen.getByRole('dialog');
    expect(card.textContent).toContain('Your island is ready');
    expect(container.querySelector('.pw-wavy')?.textContent).toBe('ready');
    expect(card.textContent).toContain('Build whatever you like.');
  });

  it('its one button closes it, so the send-off is a send-off and not a stop', () => {
    useEditorStore.getState().setModal('tourDone', true);
    render(<TourDoneModal />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'Have fun' }));
    expect(useEditorStore.getState().modals.tourDone).toBe(false);
  });

  it('throws a fall of flat tile-coloured paper, mostly thin strips', () => {
    useEditorStore.getState().setModal('tourDone', true);
    const { container } = render(<TourDoneModal />, { wrapper });
    const fall = pieces(container);
    // Below this a fall reads as countable objects rather than as confetti.
    expect(fall.length).toBeGreaterThanOrEqual(60);
    expect(fall.length).toBeLessThanOrEqual(90);
    let strips = 0;
    for (const p of fall) {
      // The menu tiles' own colours, as flat fills: a gradient here would be a light source.
      expect(PALETTE).toContain(p.style.background);
      expect(p.style.backgroundImage).toBe('');
      const w = parseFloat(p.style.width);
      const h = parseFloat(p.style.height);
      expect(Math.min(w, h)).toBeGreaterThanOrEqual(4);
      expect(Math.max(w, h)).toBeLessThanOrEqual(36);
      if (Math.max(w, h) / Math.min(w, h) >= 2) strips += 1;
    }
    expect(strips).toBeGreaterThan(fall.length / 2);
  });

  it('gives every piece its own fall, so no two drop as one object', () => {
    const animate = stubWaapi();
    useEditorStore.getState().setModal('tourDone', true);
    const { container } = render(<TourDoneModal />, { wrapper });
    expect(animate.mock.calls.length).toBe(pieces(container).length);
    const opts = animate.mock.calls.map(([, options]) => options);
    // Duration and delay are drawn per piece, so a run of them is a spread, not one value.
    expect(new Set(opts.map((o) => o.duration)).size).toBeGreaterThan(opts.length / 2);
    expect(new Set(opts.map((o) => o.delay)).size).toBeGreaterThan(opts.length / 2);
    // A dense leading wave, then a thinner trail: the whole fall does not start at once, and it is
    // over in about three seconds rather than looping behind a modal someone is reading.
    const ends = opts.map((o) => Number(o.delay) + Number(o.duration));
    expect(Math.min(...opts.map((o) => Number(o.delay)))).toBeLessThan(100);
    expect(Math.max(...ends)).toBeLessThanOrEqual(3400);
  });

  it('turns the pieces over as they fall, which is what makes them paper', () => {
    const animate = stubWaapi();
    useEditorStore.getState().setModal('tourDone', true);
    render(<TourDoneModal />, { wrapper });
    // scaleX swung through negative values: a flat strip seen edge-on is exactly scaleX 0.
    const faces = transforms(animate).map((tr) => parseFloat(/scaleX\((-?[\d.]+)\)/.exec(tr)?.[1] ?? '1'));
    expect(faces.some((s) => s < -0.5)).toBe(true);
    expect(faces.some((s) => s > 0.5)).toBe(true);
  });

  it('keeps the pieces flat and in the plane: no glow, no blur, no third dimension', () => {
    const animate = stubWaapi();
    useEditorStore.getState().setModal('tourDone', true);
    const { container } = render(<TourDoneModal />, { wrapper });
    for (const p of pieces(container)) {
      expect(p.style.boxShadow).toBe('');
      expect(p.style.filter).toBe('');
      expect(p.style.perspective).toBe('');
      expect(p.style.transformStyle).toBe('');
    }
    for (const tr of transforms(animate)) {
      expect(tr).not.toMatch(/rotate[XYZ3]|perspective|matrix3d|translateZ/);
    }
    for (const [frames] of animate.mock.calls) {
      for (const frame of frames) {
        expect(frame.filter).toBeUndefined();
        expect(frame.boxShadow).toBeUndefined();
      }
    }
  });

  it('under reduced motion nothing moves, and the message and its button read the same', async () => {
    const animate = stubWaapi();
    useEditorStore.getState().setModal('tourDone', true);
    const { container } = render(
      <MotionConfig reducedMotion="always"><TourDoneModal /></MotionConfig>,
      { wrapper },
    );
    // The pieces are driven by hand, so neither framer's gate nor the stylesheet's covers them:
    // this is the one that has to hold, and it is the failure that would ship silently.
    expect(container.querySelector('[data-testid="tour-confetti"]')).toBeNull();
    expect(animate).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog').textContent).toContain('Your island is ready');
    fireEvent.click(screen.getByRole('button', { name: 'Have fun' }));
    expect(useEditorStore.getState().modals.tourDone).toBe(false);
    // The shell's exit lands a commit after the click; let it settle inside the test.
    await act(async () => {});
  });
});
