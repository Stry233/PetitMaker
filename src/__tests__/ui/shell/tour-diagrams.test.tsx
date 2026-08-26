/**
 * The tour's gesture diagrams.
 *
 * What is pinned here is the POLICY rather than the drawing: a diagram exists for exactly the steps
 * that teach a gesture (and for none that merely name a panel, which is where an animation would be
 * decoration); "any button" is taught one button at a time rather than as a chord; a scroll is drawn
 * as a scroll and never as a held wheel; the pointer is the app's OWN cursor, placed by its hotspot;
 * and every moving part has a declared end state for reduced motion, since a loop that simply
 * stopped would leave the pointer at the start of a path and take the instruction with it.
 *
 * The loops are CSS keyframes, so the choreography itself is text in the sheet each drawing carries.
 * Percentages are structure and are deliberately not asserted; what a test can hold is that the
 * clock comes from the motion registry and that every rule the still drawing needs is present.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { SHELL_TOUR_STEPS } from '../../../ui/shell/tour-steps';
import { TOUR_DIAGRAM_H, TOUR_DIAGRAM_STEPS, tourDiagram } from '../../../ui/shell/tour-diagrams';
import { MOTIONS } from '../../../ui/shell/motion/registry';
import type { TourStep } from '../../../ui/chrome/tour/steps';

function stepById(id: string): TourStep {
  const step = SHELL_TOUR_STEPS.find((s) => s.id === id);
  if (!step) throw new Error(`no such step: ${id}`);
  return step;
}

function draw(id: string) {
  const drawn = tourDiagram(stepById(id));
  if (!drawn) throw new Error(`${id} draws nothing`);
  return render(<>{drawn.node}</>);
}

/** The stylesheet a drawing carries, which is where its loops and its still states are declared. */
function sheet(container: HTMLElement): string {
  return container.querySelector('style')?.textContent ?? '';
}

afterEach(cleanup);

describe('the tour draws the gesture a step teaches', () => {
  it('draws one for every step whose content is a gesture, and for no other', () => {
    const drawn = SHELL_TOUR_STEPS.filter((s) => tourDiagram(s) !== null).map((s) => s.id);
    expect(drawn).toEqual([...TOUR_DIAGRAM_STEPS]);
  });

  it('names only steps this interface actually has', () => {
    const ids = SHELL_TOUR_STEPS.map((s) => s.id);
    for (const id of TOUR_DIAGRAM_STEPS) expect(ids).toContain(id);
  });

  it('leaves the steps that only name a panel to their words', () => {
    // A drawing invented for "here is the menu" would be the decoration these deliberately are not.
    for (const id of ['welcome', 'modes', 'assistant', 'share', 'menu']) {
      expect(tourDiagram(stepById(id))).toBeNull();
    }
  });

  it('reports the height the card grows by, so the placement can fit the bubble', () => {
    for (const id of TOUR_DIAGRAM_STEPS) {
      expect(tourDiagram(stepById(id))?.height).toBe(TOUR_DIAGRAM_H);
    }
  });

  it('hides the drawing from a screen reader, which is what keeps the words complete', () => {
    const { container } = draw('camera');
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('runs every diagram on the clock the registry declares', () => {
    for (const id of TOUR_DIAGRAM_STEPS) {
      const { container } = draw(id);
      expect(sheet(container)).toContain(`--pw-tg-rep:${MOTIONS['tour.gesture.drag'].duration}s`);
      cleanup();
    }
  });

  it('declares every motion it makes, each one saying what it says', () => {
    for (const id of [
      'tour.gesture.drag', 'tour.gesture.cycle', 'tour.gesture.wheel',
      'tour.gesture.stroke', 'tour.gesture.orbit', 'tour.gesture.tilt',
    ] as const) {
      const motion = MOTIONS[id];
      expect(motion.tier).toBe('inform');
      expect(motion.loop).toBe(true);
      expect('says' in motion && motion.says.length).toBeTruthy();
    }
  });

  it('points with the app\'s own cursor, hung from its hotspot', () => {
    const { container } = draw('camera');
    const cursor = container.querySelector('[data-testid="tour-cursor"]') as HTMLImageElement;
    expect(cursor.getAttribute('src')).toMatch(/^(data:image|blob:|\/|\.|https?:)/);
    // The hotspot is what sits on the gesture point, so the image hangs up and left of the origin.
    expect(parseFloat(cursor.style.left)).toBeLessThan(0);
    expect(parseFloat(cursor.style.top)).toBeLessThan(0);
  });
});

describe('"any button" is three demonstrations, never a chord', () => {
  for (const id of ['camera', 'orbit']) {
    it(`${id} lights one key per rep, each on the cycle's own clock`, () => {
      const { container } = draw(id);
      const keys = [...container.querySelectorAll('[data-testid="tour-key"]')];
      expect(keys.map((k) => k.getAttribute('data-key'))).toEqual(['left', 'right', 'wheel']);
      // One long animation per key, wound forward a rep apart: the cycle's length is what keeps a
      // rep whole, and the delay is what makes the next rep the next button. Which rep a key ends
      // up lit in is the delay read back the way the browser reads it — a negative delay of d reps
      // out of REPS lands the window in rep ((REPS - d) mod REPS) + 1 — so the ORDER is asserted
      // rather than the offsets, and the plain-looking `-(rep - 1)` (which teaches left, middle,
      // right) fails it.
      const reps = Math.round(
        MOTIONS['tour.gesture.cycle'].duration / MOTIONS['tour.gesture.drag'].duration,
      );
      const litIn = keys.map((k) => {
        const ad = (k as HTMLElement).style.getPropertyValue('--pw-tg-ad');
        const back = ad === '0ms' ? 0 : -Number(/\*\s*(-?[\d.]+)/.exec(ad)![1]);
        return ((reps - back) % reps) + 1;
      });
      expect(litIn).toEqual([1, 2, 3]);
      for (const key of keys) {
        expect((key as HTMLElement).style.animationDuration).toBe('var(--pw-tg-cycle)');
      }
      cleanup();
    });
  }

  it('leaves exactly ONE key standing lit in the still drawing', () => {
    const { container } = draw('camera');
    const keys = [...container.querySelectorAll('[data-testid="tour-key"]')];
    expect(keys.filter((k) => k.getAttribute('data-rm') === 'end')).toHaveLength(1);
  });

  it('draws the scroll beat as a rolling wheel with no key held', () => {
    const { container } = draw('camera');
    const scroll = container.querySelector('[data-testid="tour-scroll"]')!;
    // A FILLED wheel means the middle button is down. The scroll badge fills nothing.
    expect(scroll.querySelectorAll('[data-testid="tour-key"]')).toHaveLength(0);
    expect(sheet(container)).toContain('@keyframes pw-tg-wheelroll');
  });

  it('teaches one held button where there is only one to teach', () => {
    const { container } = draw('bar');
    const keys = [...container.querySelectorAll('[data-testid="tour-key"]')];
    expect(keys.map((k) => k.getAttribute('data-key'))).toEqual(['left']);
    expect(container.querySelector('[data-testid="tour-scroll"]')).toBeNull();
  });
});

describe('under reduced motion a diagram is the same gesture, standing still', () => {
  /** The rules the collapsed loops leave behind: `animations.css` stops the animation, and each of
   *  these stands one part of the drawing at the end of its travel. */
  const ENDS = [
    'pw-tg-pan', // the map carried across, and the hand that carried it
    'pw-tg-yaw', // the island turned
    'pw-tg-tilt', // the flat map standing up
    'pw-tg-drawn', // the trail drawn
    'pw-tg-reach', // the pointer arrived at the button it presses
    "[data-rm='end']", // the badge, the key that is lit, the ground laid
  ];

  it('declares an end state for every part that moves', () => {
    const { container } = draw('camera');
    const css = sheet(container);
    for (const end of ENDS) expect(css).toContain(`[data-reduced-motion='1'] .pw-tg ${end.startsWith('[') ? end : `.${end}`}`);
  });

  it('leaves the ground the stroke lays drawn, so the diagram still shows what a stroke does', () => {
    const { container } = draw('bar');
    const laid = [...container.querySelectorAll('[data-testid="tour-laid"]')];
    expect(laid.length).toBeGreaterThan(0);
    for (const cell of laid) expect(cell.getAttribute('data-rm')).toBe('end');
  });

  it('carries the pointer, its badge and the trail into the still drawing', () => {
    const { container } = draw('camera');
    expect(container.querySelector(`.pw-tg-pan[style*="--pw-tg-amp"]`)).not.toBeNull();
    expect(container.querySelector('[data-testid="tour-badge"][data-rm="end"]')).not.toBeNull();
    expect(container.querySelector('.pw-tg-drawn')).not.toBeNull();
  });

  it('stands the 3D steps in perspective, moving or not', () => {
    draw('view3d');
    // The view3d card TIPS, so its end angle is in the sheet rather than on the element.
    expect(screen.getByTestId('tour-plane').className).toContain('pw-tg-tilt');
    cleanup();
    draw('build3d');
    // The 3D building step's card is already standing, which is a plain transform either way.
    expect(screen.getByTestId('tour-plane').style.transform).toContain('rotateX(');
  });
});
