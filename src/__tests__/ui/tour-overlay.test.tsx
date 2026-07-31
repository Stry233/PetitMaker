import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useLayoutEffect } from 'react';
import { MotionConfig } from 'framer-motion';
import { render, screen, fireEvent, cleanup, waitFor, act, within } from '@testing-library/react';
import { TourOverlay, TRACK_MIN_FRAMES, TRACK_MAX_FRAMES } from '../../ui/chrome/tour/TourOverlay';
import { TOUR_SEEN_KEY, startTour } from '../../ui/chrome/tour/use-tour';
import { TOUR_STEPS, type TourStep, type TourTargetId } from '../../ui/chrome/tour/steps';
import { I18nProvider } from '../../i18n/context';
import { useEditorStore } from '../../state/store';
import { colors } from '../../ui/styles';
import { useChromeScale } from '../../ui/menu/scale';
import { __resetUiZoomAnim } from '../../ui/menu/ui-zoom-anim';
import { placeBubble } from '../../ui/chrome/tour/place-bubble';
import { setStoreState } from '../_store';
import { brandName } from '../../version';

const wrapper = ({ children }: { children: React.ReactNode }) => <I18nProvider>{children}</I18nProvider>;

/** Frames the tracking loop has read, so a test can wait on the loop's own progress rather than on
 *  a wall-clock guess about jsdom's rAF period. */
let framesRead = 0;

/** A 200x120 target rect at an arbitrary screen position. */
function rectAt(left: number, top: number): DOMRect {
  return {
    x: left, y: top, width: 200, height: 120,
    left, top, right: left + 200, bottom: top + 120, toJSON: () => ({}),
  } as DOMRect;
}

/**
 * Resolve `document.querySelector('[data-tour-target="id"]')` per target id, the way the real DOM
 * would: an id in `absent` reads as unmeasurable (same as the element being missing from the
 * page), and every present id gets a FRESH rect object on every call, since a real
 * `getBoundingClientRect` never returns the same object twice — a frozen shared rect hid the
 * focus-stealing bug (Finding 2) because `setRect` bailed out on an unchanged value.
 *
 * Returns the (live) `absent` set so a test can `delete` from it mid-run — that's how a test
 * simulates `menu: 'expand'` making a target exist only once its step has been announced (Finding 7).
 * `rectFor` overrides the rect a present target reports, so a test can make one move between reads.
 */
function stubTargets(absent: Iterable<TourTargetId> = [], rectFor?: (id: TourTargetId) => DOMRect): Set<TourTargetId> {
  const missing = new Set(absent);
  vi.spyOn(document, 'querySelector').mockImplementation(((selector: string) => {
    const id = /data-tour-target="([^"]+)"/.exec(selector)?.[1] as TourTargetId | undefined;
    framesRead += 1;
    if (!id || missing.has(id)) return null;
    return { getBoundingClientRect: () => rectFor?.(id) ?? rectAt(100, 100) } as unknown as Element;
  }) as unknown as typeof document.querySelector);
  return missing;
}

/** Reports the layout phase of the commit that mounts it. Rendered as a LATER SIBLING of the
 *  overlay, so every layout effect the overlay declares has already run when this one does. */
function LayoutProbe({ onLayout }: { onLayout: () => void }) {
  useLayoutEffect(() => { onLayout(); }, [onLayout]);
  return null;
}

/** The lit hole's box, in visual px: the mask rect the dim cuts out for the current step, or null
 *  while nothing is measured. */
function holeBox(container: HTMLElement): { left: number; top: number; width: number; height: number } | null {
  const hole = container.querySelector('mask rect[fill="#000"]');
  if (!hole) return null;
  return {
    left: Number(hole.getAttribute('x')),
    top: Number(hole.getAttribute('y')),
    width: Number(hole.getAttribute('width')),
    height: Number(hole.getAttribute('height')),
  };
}

/** The LIVE card. A step change REPLACES the card, and AnimatePresence keeps the outgoing one
 *  mounted for the length of its exit, appending the incoming one after it — so during that window
 *  there are two dialogs and the last is the one the visitor is being shown. */
function card(): HTMLElement {
  const all = screen.getAllByRole('dialog');
  return all[all.length - 1]!;
}

/** A control on the LIVE card. The outgoing card's controls are still clickable while it leaves,
 *  and a test that reached for one would be driving the step the visitor has already left. */
function cardButton(name: string): HTMLElement {
  return within(card()).getByRole('button', { name });
}

/** The 1-based step the live card is SHOWING, read off its progress line. The card keeps the
 *  previous step until the new one's target is measured, so "a dialog is on screen" does not mark a
 *  step change; this does. */
function shownStep(): number {
  return Number(/Step (\d+) of/.exec(card().textContent ?? '')?.[1] ?? 0);
}

/** jsdom lays nothing out, so `offsetHeight` is 0 everywhere and the card can never measure its
 *  copy. This gives every element a height derived from its own text, which is all the overlay's
 *  measurement asks of the DOM. Returns the undo. */
function stubHeights(heightOf: (text: string) => number): () => void {
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) { return heightOf(this.textContent ?? ''); },
  });
  return () => {
    if (original) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', original);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetHeight;
  };
}

/** The uniform scale in a transform string, or 1 for a transform that carries none. */
function scaleOf(transform: string): number {
  return Number(/scale\(([^,)]+)/.exec(transform)?.[1] ?? 1);
}

/** Click Next and wait for the card to actually turn over. The jump can be more than one step, when
 *  the step in between was passed over for want of a measurable target. */
async function clickNext() {
  const from = shownStep();
  fireEvent.click(cardButton('Next'));
  await waitFor(() => expect(shownStep()).toBeGreaterThan(from));
}

/** Advance to `open`, the first step that HAS a target. The two before it are targetless, so they
 *  never measure — anything about the measurement or the spotlight has to start from here. Both
 *  clicks land synchronously: a targetless step is shown on the commit that makes it current. */
function gotoTargetedStep() {
  fireEvent.click(cardButton('Next')); // welcome -> camera
  fireEvent.click(cardButton('Next')); // camera -> open
}

/** The host's side of the choreography, exactly as App.handleTourStep does it. */
function applyMenuAction(step: TourStep) {
  if (step.menu === 'expand') useEditorStore.getState().setMenuCollapsed(false);
  if (step.menu === 'collapse') useEditorStore.getState().setMenuCollapsed(true);
}

/** Wait until a step's target has been measured and the dim has a lit hole cut for it. */
async function waitForSpotlight(container: HTMLElement) {
  await waitFor(() => expect(holeBox(container)).not.toBeNull());
}

/** Wait until the tracking loop has let go of its target: two animation frames with no read. A
 *  spotlight now appears on the loop's FIRST frame, so a test that wants a fresh run out of an
 *  event has to let the one in flight finish — an event during a run is deliberately ignored. The
 *  gap is measured in FRAMES, not waitFor polls: the card animates, so its style mutations drive
 *  waitFor at frame rate and two of its checks can land inside one frame and call a live loop idle. */
async function waitForTrackingIdle() {
  for (let i = 0; i < 60; i++) {
    const before = framesRead;
    await frames(2);
    if (framesRead === before) return;
  }
  throw new Error('the tracking loop never let go');
}

/** Every distinct value `read` takes from now until `stop()`, sampled once a frame, in the live
 *  array `seen` so a test can wait until the sampler itself has caught up. Whether something GLIDES
 *  is exactly this: a cut shows the two endpoints, a glide shows the way between them. */
function startSampler<T>(read: () => T): { seen: T[]; stop(): void } {
  const seen: T[] = [];
  let id = 0;
  const tick = () => {
    const v = read();
    if (!seen.includes(v)) seen.push(v);
    id = requestAnimationFrame(tick);
  };
  tick();
  return { seen, stop: () => cancelAnimationFrame(id) };
}

/** Let `n` animation frames pass, so a sampler covers the whole of a motion that has just been
 *  triggered rather than stopping on the commit that triggered it. */
function frames(n: number): Promise<void> {
  return new Promise((resolve) => {
    let left = n;
    const tick = () => { if (--left <= 0) resolve(); else requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
}

describe('TourOverlay', () => {
  beforeEach(() => {
    setStoreState({ locale: 'en' });
    localStorage.removeItem(TOUR_SEEN_KEY);
    useEditorStore.getState().setTourRunning(false);
    useEditorStore.getState().setMenuCollapsed(true); // the app opens collapsed
    framesRead = 0;
    stubTargets();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    // The UI-zoom tween is a module singleton, so a test that moved the zoom has to put both the
    // store field and the live value back or the next test starts mid-animation.
    useEditorStore.getState().setUiZoom(1);
    __resetUiZoomAnim();
  });

  it('renders nothing while the tour is not running', () => {
    const { container } = render(<TourOverlay />, { wrapper });
    expect(container.textContent).toBe('');
  });

  it('opens on the welcome step', async () => {
    startTour();
    render(<TourOverlay />, { wrapper });
    // The first paint's target rect lands on a rAF; every step transition re-clears it the same
    // way, so every interaction below waits for the next bubble rather than reading synchronously.
    await waitFor(() => expect(card().textContent).toContain('Welcome to PetitMaker'));
    expect(screen.getByText(`Step 1 of ${TOUR_STEPS.length}`)).toBeTruthy();
  });

  it('gives the app name in the welcome title the wavy underline, from the configured brand', async () => {
    // The name is never hardcoded in a string: every locale writes `{app}`, which resolves to
    // APP_NAME, and the title is split around the resolved name so a locale that leads with it
    // still underlines only the name.
    startTour();
    const { container } = render(<TourOverlay />, { wrapper });
    await waitFor(() => card());
    expect(container.querySelector('.pw-wavy')?.textContent).toBe(brandName('en'));
    expect(card().textContent).toContain(`Welcome to ${brandName('en')}`);
  });

  it('underlines the brand name in a locale that writes it differently', async () => {
    setStoreState({ locale: 'zh' });
    startTour();
    const { container } = render(<TourOverlay />, { wrapper });
    await waitFor(() => card());
    expect(container.querySelector('.pw-wavy')?.textContent).toBe(brandName('zh'));
  });

  it('leaves a title that does not carry the brand name unwaved', async () => {
    startTour();
    const { container } = render(<TourOverlay />, { wrapper });
    await waitFor(() => cardButton('Next'));
    await clickNext();
    // The welcome content leaves on a transition, so the wave goes with it rather than at the click.
    await waitFor(() => expect(container.querySelector('.pw-wavy')).toBeNull());
  });

  it('advances through the steps', async () => {
    startTour();
    render(<TourOverlay />, { wrapper });
    await waitFor(() => cardButton('Next'));
    await clickNext();
    expect(screen.getByText('Moving around')).toBeTruthy();
  });

  it('keeps the card where a step change does not move it, and crosses its copy over inside it', async () => {
    // welcome -> camera: both steps are centred, so the card is in the same place before and after.
    // An exit and an entrance there accomplish nothing visible.
    startTour();
    render(<TourOverlay />, { wrapper });
    await waitFor(() => card());
    const kept = card();
    fireEvent.click(cardButton('Next'));
    expect(screen.getAllByRole('dialog').length).toBe(1); // never two cards on one spot
    expect(card()).toBe(kept);
    // Both copies are inside that one card for the length of the change: the step being left LEAVES.
    expect(kept.textContent).toContain('Welcome to PetitMaker');
    expect(kept.textContent).toContain('Moving around');
    await waitFor(() => expect(kept.textContent).not.toContain('Welcome to PetitMaker'));
    expect(card()).toBe(kept);
  });

  it('grows or shrinks a kept card to the copy coming in, rather than snapping to it', async () => {
    // The welcome step carries the brand lockup, so its copy is the taller of the two, and the card
    // has to travel between the two heights while the copy crosses over. The end state is what the
    // measurement produces; what this pins is the sizes in between.
    const undo = stubHeights((text) => (text.includes('Welcome') ? 180 : 120));
    try {
      startTour();
      render(<TourOverlay />, { wrapper });
      await waitFor(() => card());
      const box = () => (card().firstElementChild as HTMLElement); // the copy's box, under the card
      await waitFor(() => expect(box().style.height).toBe('180px'));
      const sampler = startSampler(() => box().style.height);
      fireEvent.click(cardButton('Next'));
      await waitFor(() => expect(box().style.height).toBe('120px'));
      sampler.stop();
      const heights = sampler.seen.map(parseFloat);
      expect(heights.some((h) => h < 180 && h > 120)).toBe(true); // through the sizes ...
      expect(new Set(heights).size).toBeGreaterThan(2);           // ... not across them
    } finally {
      undo();
    }
  });

  it('replaces the card where a step change MOVES it: the old one leaves as the new one arrives', async () => {
    startTour();
    const { container } = render(<TourOverlay />, { wrapper });
    await waitFor(() => card());
    fireEvent.click(cardButton('Next')); // -> camera, the same place: still the same card
    const leaving = card();
    fireEvent.click(cardButton('Next')); // -> open, beside the phone: a card of its own
    await waitFor(() => expect(screen.getAllByRole('dialog').length).toBe(2));
    const both = screen.getAllByRole('dialog');
    expect(both[0]).toBe(leaving);              // the old card is still on screen, leaving
    expect(both[1]).not.toBe(leaving);
    await waitForSpotlight(container);
    await waitFor(() => expect(screen.getAllByRole('dialog').length).toBe(1));
    expect(card()).not.toBe(leaving);
  });

  it('keeps focus on the card through both kinds of step change', async () => {
    // A remount drops focus to <body>, so the card that is replaced takes focus as it mounts; the
    // card that is KEPT never loses it. Between them this is the whole of the keyboard path.
    startTour();
    const { container } = render(<TourOverlay />, { wrapper });
    await waitFor(() => card());
    const first = card();
    expect(document.activeElement).toBe(first);
    await clickNext(); // welcome -> camera: the card is kept ...
    expect(card()).toBe(first);
    expect(document.activeElement).toBe(first); // ... so focus was never taken again
    await clickNext(); // camera -> open: a new card ...
    await waitForSpotlight(container);
    expect(card()).not.toBe(first);
    expect(document.activeElement).toBe(card()); // ... which takes focus as it mounts
    // Escape reaching the tour from there is what "completable from the keyboard" rests on.
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useEditorStore.getState().tourRunning).toBe(false);
  });

  it('Next pressed before the next step has been measured advances from the step on the card', async () => {
    startTour();
    const { container } = render(<TourOverlay />, { wrapper });
    gotoTargetedStep(); // `open` is current, but the card shows `camera` until open is measured
    expect(shownStep()).toBe(2);
    fireEvent.click(cardButton('Next'));
    await waitForSpotlight(container);
    expect(shownStep()).toBe(3); // `open`, the step that was read — not the one after it
  });

  it('reads Start building on the last step, and finishes', async () => {
    startTour();
    render(<TourOverlay />, { wrapper });
    await waitFor(() => cardButton('Next'));
    for (let i = 0; i < TOUR_STEPS.length - 1; i++) await clickNext();
    const last = cardButton('Start building');
    fireEvent.click(last);
    expect(useEditorStore.getState().tourRunning).toBe(false);
    expect(localStorage.getItem(TOUR_SEEN_KEY)).toBe('1');
  });

  it('skipping counts as seen', async () => {
    startTour();
    render(<TourOverlay />, { wrapper });
    await waitFor(() => cardButton('Skip tour'));
    fireEvent.click(cardButton('Skip tour'));
    expect(useEditorStore.getState().tourRunning).toBe(false);
    expect(localStorage.getItem(TOUR_SEEN_KEY)).toBe('1');
  });

  it('Escape skips, like every other overlay', () => {
    startTour();
    render(<TourOverlay />, { wrapper });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useEditorStore.getState().tourRunning).toBe(false);
  });

  it('reports each step it enters, so the app can open the menu for the one that needs it', async () => {
    const seen: string[] = [];
    startTour();
    render(<TourOverlay onStepEnter={(s) => seen.push(s.id)} />, { wrapper });
    await waitFor(() => cardButton('Next'));
    await clickNext();
    await clickNext();
    expect(seen).toEqual(['welcome', 'camera', 'open']);
  });

  it('shows the brand on the welcome step and not afterwards', async () => {
    startTour();
    const { container } = render(<TourOverlay />, { wrapper });
    await waitFor(() => expect(container.querySelectorAll('img').length).toBe(1));
    await clickNext();
    // The lockup goes out with the welcome step's content, on its transition rather than at the click.
    await waitFor(() => expect(container.querySelectorAll('img').length).toBe(0));
    expect(screen.getByText('Moving around')).toBeTruthy();
  });

  it('passes over a step whose target is not on screen', async () => {
    vi.restoreAllMocks(); // no stubbed targets: nothing is measurable in jsdom
    startTour();
    render(<TourOverlay />, { wrapper });
    gotoTargetedStep();
    // From here every step names a target, and none can be measured, so each is passed over in
    // turn, which ends the tour rather than pointing at the origin.
    await waitFor(() => expect(useEditorStore.getState().tourRunning).toBe(false));
  });

  it('the un-showable step is still announced (it never gets to reveal its own target) but is passed over, without swallowing the step after it', async () => {
    stubTargets(['menu-tiles']); // only the menu step is unmeasurable, and nothing reveals it here
    const seenIds: string[] = [];
    startTour();
    render(<TourOverlay onStepEnter={(s) => seenIds.push(s.id)} />, { wrapper });
    await waitFor(() => cardButton('Next')); // welcome
    await clickNext(); // -> camera
    await clickNext(); // -> open
    await clickNext(); // -> menu: announced, but its own measurement never lands, so it's skipped
    // collapse's own target was present, so it must actually have been shown, not swallowed by
    // the same skip that passed over menu (the Finding 1 regression).
    expect(screen.getByText('Putting it away')).toBeTruthy();
    await clickNext(); // -> layers
    await clickNext(); // -> view
    fireEvent.click(cardButton('Start building'));
    expect(useEditorStore.getState().tourRunning).toBe(false);
    expect(seenIds).toEqual(['welcome', 'camera', 'open', 'menu', 'collapse', 'layers', 'view']);
  });

  it('announces the menu step even though its target starts absent, so the host can bring it into being (Finding 7)', async () => {
    // The app's only hook for `menu: 'expand'` IS onStepEnter, so onStepEnter must fire before the
    // target exists — this simulates the app expanding the menu from inside that callback.
    const absent = stubTargets(['menu-tiles']);
    const seenIds: string[] = [];
    startTour();
    render(
      <TourOverlay
        onStepEnter={(s) => {
          seenIds.push(s.id);
          if (s.id === 'menu') absent.delete('menu-tiles');
        }}
      />,
      { wrapper },
    );
    await waitFor(() => cardButton('Next')); // welcome
    await clickNext(); // -> camera
    await clickNext(); // -> open
    await clickNext(); // -> menu: announced while absent, revealed by the callback, then measured present
    expect(screen.getByText('Everything starts here')).toBeTruthy(); // shown, not passed over
    expect(seenIds).toEqual(['welcome', 'camera', 'open', 'menu']);
  });

  it('announces a step from the layout phase, so a host that reveals its target gets there before the measurement', () => {
    // jsdom cannot reproduce the browser's rAF-before-paint vs passive-flush-after-paint ordering
    // (its rAF is a ~16ms timer, so the passive flush always wins here and always loses in a
    // browser). What IS observable is the phase: sibling layout effects run in tree order within
    // one commit, so a probe mounted after the overlay sees the overlay's layout effects as
    // already done. A passive announcement runs after EVERY layout effect in the commit, and this
    // order flips.
    const order: string[] = [];
    startTour();
    render(
      <>
        <TourOverlay onStepEnter={(s) => { order.push(`enter:${s.id}`); }} />
        <LayoutProbe onLayout={() => { order.push('layout-probe'); }} />
      </>,
      { wrapper },
    );
    expect(order).toEqual(['enter:welcome', 'layout-probe']);
  });

  it('shows a step while its target is still moving, rather than waiting for it to stop', async () => {
    // The phone card expands under a spring and getBoundingClientRect reports the TRANSFORMED box,
    // so the target keeps moving for the length of that animation. Waiting for it to hold still is
    // half a second of nothing at the moment the visitor has just done what the step asked; the
    // step goes up on the first frame there is anything to light at all.
    let left = 100;
    let moving = true;
    stubTargets([], () => { if (moving) left += 40; return rectAt(left, 100); });
    startTour();
    const { container } = render(<TourOverlay />, { wrapper });
    gotoTargetedStep();
    // The target never comes to rest on its own, so getting here at all is the assertion: the step
    // is on the card and lit well inside the window, not at the end of it.
    await waitFor(() => expect(shownStep()).toBe(3));
    expect(holeBox(container)).not.toBeNull();
    expect(framesRead).toBeLessThan(TRACK_MAX_FRAMES);
  });

  it('keeps following a target that is still animating in, so a mid-flight first read is not a latch', async () => {
    // The first read lands on a box the target is still leaving. Tracking IS the correction: the
    // spotlight glides after every later read, so it ends up where the target came to rest (240)
    // rather than where it was first caught (100).
    const boxes = [100, 140, 180, 220, 240];
    let read = 0;
    stubTargets([], () => rectAt(boxes[Math.min(read++, boxes.length - 1)]!, 100));
    startTour();
    const { container } = render(<TourOverlay />, { wrapper });
    const sampler = startSampler(() => holeBox(container)?.left ?? null);
    gotoTargetedStep();
    // The lit hole insets 8px around the measured rect, so 240 comes out as 232.
    await waitFor(() => expect(sampler.seen).toContain(232));
    sampler.stop();
    // It was lit before it got there: the first read is published, not held back.
    expect(sampler.seen.some((v) => v != null && v < 232)).toBe(true);
  });

  it('does not let go of a target that has not started moving yet, even though its first frames agree', async () => {
    // An animation writes its t=0 keyframe on the animator's first tick, which is AFTER the loop's
    // first frame: the first two reads are both the pre-animation box. Without a floor under the
    // agreement the loop would stop there, and the spotlight would keep the box the target STARTED
    // from (left 100) instead of following it to where it comes to rest (left 240).
    const boxes = [100, 100, 160, 200, 240];
    let read = 0;
    stubTargets([], () => rectAt(boxes[Math.min(read++, boxes.length - 1)]!, 100));
    startTour();
    const { container } = render(<TourOverlay />, { wrapper });
    gotoTargetedStep();
    await waitForSpotlight(container);
    await waitFor(() => expect(holeBox(container)?.left).toBe(232));
  });

  it('keeps the app dimmed and the card up before a step has been measured, rather than blinking either away', async () => {
    startTour();
    const { container } = render(<TourOverlay />, { wrapper });
    gotoTargetedStep();
    // Before the new step's measurement lands there is no ring for it yet...
    expect(holeBox(container)).toBeNull();
    // ...but the dim already covers the viewport, the same one the lit hole is later cut out of, so
    // the app never shows through undimmed in the frame before a target is measured.
    const scrim = screen.getByTestId('tour-dim');
    expect(scrim.style.position).toBe('fixed');
    expect(scrim.style.inset).toBe('0');
    expect(scrim.querySelector('rect[mask]')?.getAttribute('fill')).toBe(colors.surfaceOverlay);
    // ...and the card is still up, still holding the step the visitor last read, so it never
    // unmounts mid-tour (which replayed its entrance and dropped focus to <body>).
    expect(shownStep()).toBe(2);
    await waitForSpotlight(container); // the lit hole and the new step take over once it is read
    expect(shownStep()).toBe(3);
  });

  it('paints the dim at viewport size, never as a spread that outgrows a compositor texture', async () => {
    // A `0 0 0 9999px` shadow gives its element a paint box ~20000px on a side, which past a device
    // pixel ratio of 2 is larger than the maximum texture a compositor will allocate, and this
    // element sits over a composited WebGL canvas. The mask is the viewport whatever the hole is.
    startTour();
    const { container } = render(<TourOverlay />, { wrapper });
    gotoTargetedStep();
    await waitForSpotlight(container);
    const dim = screen.getByTestId('tour-dim');
    expect(dim.style.inset).toBe('0');
    expect(dim.getAttribute('width')).toBe('100%');
    expect(dim.getAttribute('height')).toBe('100%');
    for (const el of container.querySelectorAll('*')) {
      expect((el as HTMLElement).style?.boxShadow ?? '').not.toContain('9999px');
    }
    expect(holeBox(container)).not.toBeNull(); // the hole is cut, not shadowed around
  });

  it('a targetless step dims everything and centres its bubble, with no spotlight ring', () => {
    startTour();
    const { container } = render(<TourOverlay />, { wrapper }); // welcome names no target
    const dim = screen.getByTestId('tour-dim');
    expect(dim.style.inset).toBe('0');
    expect(dim.querySelector('rect[mask]')?.getAttribute('fill')).toBe(colors.surfaceOverlay);
    expect(holeBox(container)).toBeNull(); // no lit hole
    expect(dim.querySelector('rect[stroke]')).toBeNull(); // and so no ring around one
    const bubble = card();
    expect(bubble.style.left).toBe('50%');
    expect(bubble.style.top).toBe('50%');
  });

  it('a targetless step is showing on the first commit, without waiting on a measurement', () => {
    // No waitFor anywhere: there is nothing to measure, so spending even one frame would be a bug.
    startTour();
    render(<TourOverlay />, { wrapper });
    expect(card().textContent).toContain('Welcome to PetitMaker');
    expect(framesRead).toBe(0);
  });

  it('the bubble carries the chrome zoom, with that zoom divided back out of its position', async () => {
    // Every chrome surface in the app scales by useChromeScale as a css `zoom` (ContextMenu,
    // DeletePopover, FloatingCluster). The bubble's anchor comes from a getBoundingClientRect, which
    // is in VISUAL px, so it is placed in visual px and then divided by the zoom to land in the
    // css px of the zoomed subtree.
    let chrome = 0;
    function ChromeProbe() { chrome = useChromeScale(); return null; }
    startTour();
    const { container } = render(<><TourOverlay /><ChromeProbe /></>, { wrapper });
    gotoTargetedStep(); // open: side 'right', so the bubble anchors GAP past the lit box's right edge
    await waitForSpotlight(container);
    const bubble = card();
    expect(chrome).not.toBe(1); // otherwise this test cannot tell a divided coord from a raw one
    expect(Number(bubble.style.zoom)).toBeCloseTo(chrome);
    const lit = { left: 92, top: 92, width: 216, height: 136 }; // rectAt(100, 100) grown by the 8px inset
    const placed = placeBubble(lit, { width: 340 * chrome, height: 200 * chrome }, 'right', 18, {
      width: window.innerWidth, height: window.innerHeight,
    });
    expect(parseFloat(bubble.style.left)).toBeCloseTo(placed.left / chrome);
    expect(parseFloat(bubble.style.top)).toBeCloseTo(placed.top / chrome);
  });

  it('puts the bubble on the far side of a target near the viewport edge, never over it', async () => {
    // The reported defect: `side` only clamped, so a bubble that did not fit on its preferred side
    // was pushed back INTO the control the step was describing.
    stubTargets([], () => rectAt(window.innerWidth - 60, 40));
    startTour();
    const { container } = render(<TourOverlay />, { wrapper });
    gotoTargetedStep(); // `open` prefers 'right', where there is no room at all
    await waitForSpotlight(container);
    const bubble = card();
    // jsdom does no layout, so the width used below is only the real one if the padding is inside
    // it: under content-box the card is 40px wider than BUBBLE_W and creeps back over the spotlight.
    expect(bubble.style.boxSizing).toBe('border-box');
    const zoom = Number(bubble.style.zoom);
    const bubbleBox = {
      left: parseFloat(bubble.style.left) * zoom,
      top: parseFloat(bubble.style.top) * zoom,
      width: 340 * zoom,
      height: 200 * zoom,
    };
    const spot = holeBox(container)!;
    expect(bubbleBox.left + bubbleBox.width).toBeLessThanOrEqual(spot.left);
    const overlaps = bubbleBox.left < spot.left + spot.width && spot.left < bubbleBox.left + bubbleBox.width
      && bubbleBox.top < spot.top + spot.height && spot.top < bubbleBox.top + bubbleBox.height;
    expect(overlaps).toBe(false);
  });

  it('opening the menu for real advances the step that asked for it, with no Next press', async () => {
    startTour();
    const { container } = render(<TourOverlay onStepEnter={applyMenuAction} />, { wrapper });
    gotoTargetedStep(); // -> `open`: "tap the phone to open it"
    await waitForSpotlight(container);
    expect(shownStep()).toBe(3);
    // Exactly what CollapsedPhone's onExpand does. The dim takes no pointer events, so the phone
    // itself is live during the tour; this is the tour noticing.
    act(() => useEditorStore.getState().setMenuCollapsed(false));
    await waitFor(() => expect(shownStep()).toBe(4));
  });

  it('putting the menu away for real advances the step that asked for it', async () => {
    startTour();
    const { container } = render(<TourOverlay onStepEnter={applyMenuAction} />, { wrapper });
    gotoTargetedStep();
    await waitForSpotlight(container);
    act(() => useEditorStore.getState().setMenuCollapsed(false)); // through `open`
    await waitFor(() => expect(shownStep()).toBe(4));
    await clickNext(); // -> `collapse`: "press the bar to tuck the menu away"
    expect(shownStep()).toBe(5);
    act(() => useEditorStore.getState().setMenuCollapsed(true)); // what the home pill does
    await waitFor(() => expect(shownStep()).toBe(6));
  });

  it('does not advance a step whose condition already holds the moment it opens', async () => {
    // Nothing expands the card in this test, so `collapse` ("press the bar to tuck the menu away")
    // opens with the menu already down. Advancing on that would credit the visitor with a gesture
    // they never made, so a condition arms only once it has been seen unsatisfied.
    startTour();
    const { container } = render(<TourOverlay />, { wrapper });
    gotoTargetedStep();
    await waitForSpotlight(container);
    await clickNext(); // -> menu
    await clickNext(); // -> collapse, whose condition ("menu closed") is already true
    expect(shownStep()).toBe(5);
    await waitForTrackingIdle();
    const before = framesRead;
    useEditorStore.getState().eventBus.emit('viewport-changed', { zoom: 1 }); // pump real frames
    await waitFor(() => expect(framesRead).toBeGreaterThanOrEqual(before + TRACK_MIN_FRAMES));
    expect(shownStep()).toBe(5);
    // ...and it arms as soon as the condition goes false, so the gesture still works afterwards.
    act(() => useEditorStore.getState().setMenuCollapsed(false));
    act(() => useEditorStore.getState().setMenuCollapsed(true));
    await waitFor(() => expect(shownStep()).toBe(6));
  });

  it('keeps Next on every step that also takes a gesture, so the gesture is never a gate', async () => {
    startTour();
    const { container } = render(<TourOverlay onStepEnter={applyMenuAction} />, { wrapper });
    gotoTargetedStep();
    await waitForSpotlight(container);
    expect(TOUR_STEPS[shownStep() - 1]?.advanceWhen).toBe('menu-open');
    await clickNext(); // the button advances it just the same
    expect(shownStep()).toBe(4);
  });

  it('a resize does not steal focus back from an already-focused control', async () => {
    startTour();
    const { container } = render(<TourOverlay />, { wrapper });
    gotoTargetedStep();
    await waitForSpotlight(container);
    await waitForTrackingIdle();
    const skipBtn = cardButton('Skip tour');
    skipBtn.focus();
    expect(document.activeElement).toBe(skipBtn);
    const before = framesRead;
    fireEvent(window, new Event('resize'));
    // The remeasure is what could steal focus, so wait for it to have actually run — on the loop's
    // own frame count, not on a wall-clock guess that would silently stop covering a raised floor.
    await waitFor(() => expect(framesRead).toBeGreaterThanOrEqual(before + TRACK_MIN_FRAMES));
    expect(document.activeElement).toBe(skipBtn);
  });

  it('a viewport-changed event does not steal focus back from an already-focused control', async () => {
    startTour();
    const { container } = render(<TourOverlay />, { wrapper });
    gotoTargetedStep();
    await waitForSpotlight(container);
    await waitForTrackingIdle();
    const skipBtn = cardButton('Skip tour');
    skipBtn.focus();
    expect(document.activeElement).toBe(skipBtn);
    const before = framesRead;
    useEditorStore.getState().eventBus.emit('viewport-changed', { zoom: 1 });
    await waitFor(() => expect(framesRead).toBeGreaterThanOrEqual(before + TRACK_MIN_FRAMES));
    expect(document.activeElement).toBe(skipBtn);
  });

  it('re-measures when the UI scale changes, which fires no resize and no viewport event', async () => {
    // Ctrl +/- (and the Settings slider) rescale the menu and every chrome surface with it, so
    // every target moves, and the browser reports none of it.
    let left = 100;
    stubTargets([], () => rectAt(left, 100));
    startTour();
    const { container } = render(<TourOverlay />, { wrapper });
    gotoTargetedStep();
    await waitForSpotlight(container);
    expect(holeBox(container)?.left).toBe(92); // the 8px inset around rectAt(100, …)
    left = 260;
    act(() => useEditorStore.getState().setUiZoom(1.2));
    await waitFor(() => expect(holeBox(container)?.left).toBe(252));
  });

  it('glides the spotlight to a new geometry rather than cutting to it', async () => {
    // A UI-scale change rescales every target at once, and the highlight has to follow rather than
    // reappear somewhere else. This is also the control for the reduced-motion case below: it is
    // what proves the sampler can see a glide at all.
    let left = 100;
    stubTargets([], () => rectAt(left, 100));
    startTour();
    const { container } = render(<TourOverlay />, { wrapper });
    gotoTargetedStep();
    await waitForSpotlight(container);
    const sampler = startSampler(() => holeBox(container)?.left ?? null);
    left = 260;
    act(() => useEditorStore.getState().setUiZoom(1.2));
    await waitFor(() => expect(sampler.seen).toContain(252), { timeout: 2000 });
    sampler.stop();
    expect(sampler.seen[0]).toBe(92);
    expect(sampler.seen.some((v) => v != null && v > 92 && v < 252)).toBe(true);
  });

  it('cuts the spotlight to a box far across the screen rather than dragging it there', async () => {
    // Past a third of the viewport diagonal the eye saccades to the new position instead of
    // tracking the box across it, so the glide is played to someone already looking at the
    // destination. jsdom's window is 1024x768, a diagonal of 1280: this 700px move is well over
    // that third, where the 160px move in the test above is well under it.
    let left = 100;
    stubTargets([], () => rectAt(left, 100));
    startTour();
    const { container } = render(<TourOverlay />, { wrapper });
    gotoTargetedStep();
    await waitForSpotlight(container);
    const sampler = startSampler(() => holeBox(container)?.left ?? null);
    left = 800;
    act(() => useEditorStore.getState().setUiZoom(1.2));
    await waitFor(() => expect(sampler.seen).toContain(792), { timeout: 2000 });
    sampler.stop();
    expect(sampler.seen).toEqual([92, 792]); // the two ends, and nothing in between
  });

  it('measures that distance against the viewport, so it means the same thing on any screen', async () => {
    // The move that cut on a 1024x768 window is a short one on a large monitor, and glides there. A
    // bare pixel threshold would cut on a laptop and glide on a desktop for the same two controls.
    const [w, h] = [window.innerWidth, window.innerHeight];
    Object.assign(window, { innerWidth: 4000, innerHeight: 3000 }); // diagonal 5000
    try {
      let left = 100;
      stubTargets([], () => rectAt(left, 100));
      startTour();
      const { container } = render(<TourOverlay />, { wrapper });
      gotoTargetedStep();
      await waitForSpotlight(container);
      const sampler = startSampler(() => holeBox(container)?.left ?? null);
      left = 800;
      act(() => useEditorStore.getState().setUiZoom(1.2));
      await waitFor(() => expect(sampler.seen).toContain(792), { timeout: 2000 });
      sampler.stop();
      expect(sampler.seen.some((v) => v != null && v > 92 && v < 792)).toBe(true);
    } finally {
      Object.assign(window, { innerWidth: w, innerHeight: h });
    }
  });

  it('under reduced motion the spotlight is at its new geometry outright, never gliding to it', async () => {
    // The glide is the animation reduced motion has to switch off, and a highlight that crawls to
    // its target is exactly what the people who asked for less motion asked not to have.
    let left = 100;
    stubTargets([], () => rectAt(left, 100));
    startTour();
    const { container } = render(
      <MotionConfig reducedMotion="always"><TourOverlay /></MotionConfig>,
      { wrapper },
    );
    gotoTargetedStep();
    await waitForSpotlight(container);
    const sampler = startSampler(() => holeBox(container)?.left ?? null);
    left = 260;
    act(() => useEditorStore.getState().setUiZoom(1.2));
    await waitFor(() => expect(sampler.seen).toContain(252), { timeout: 2000 });
    sampler.stop();
    expect(sampler.seen).toEqual([92, 252]);
  });

  it('pops a moved card in and eases the old one out, on the tokens every other panel uses', async () => {
    // springs.bouncy on the way in, exitTransition on the way out, the SpokeShell/RestoreBubble
    // idiom. Sampling the live card's scale is what tells a pop from a cut — a cut shows 1 and
    // nothing else. It has to be a step change that MOVES the card; the two centred steps keep
    // theirs, and the first card's own entrance would stand in for a transition that never ran.
    startTour();
    const { container } = render(<TourOverlay />, { wrapper });
    await waitFor(() => card());
    fireEvent.click(cardButton('Next')); // -> camera, still the same card
    await waitFor(() => expect(shownStep()).toBe(2));
    const sampler = startSampler(() => card().style.transform);
    fireEvent.click(cardButton('Next')); // -> open, which lands beside the phone
    await waitForSpotlight(container);
    await waitFor(() => expect(screen.getAllByRole('dialog').length).toBe(1)); // the old one leaves
    // springs.bouncy overshoots, so "settled" is a wait, not a frame count.
    await waitFor(() => expect(scaleOf(card().style.transform)).toBe(1));
    sampler.stop();
    const scales = sampler.seen.map(scaleOf);
    expect(scales.some((v) => v < 1)).toBe(true);   // it grew into place ...
    expect(scales.some((v) => v > 1)).toBe(true);   // ... overshooting, which is the token's own life
    expect(new Set(scales).size).toBeGreaterThan(2); // ... through the sizes, not across them
  });

  it('under reduced motion the card is simply there, with no pop and no lingering exit', async () => {
    // Has to be a step change that MOVES the card (camera -> open): welcome -> camera keeps the same
    // card, so neither a pop nor an exit ever runs there and the dialog-count assertion would hold
    // whether or not the reduced-motion gate worked at all.
    const undo = stubHeights((text) => (text.includes('Welcome') ? 180 : 120));
    try {
      startTour();
      const { container } = render(
        <MotionConfig reducedMotion="always"><TourOverlay /></MotionConfig>,
        { wrapper },
      );
      await waitFor(() => card());
      const box = () => (card().firstElementChild as HTMLElement);
      await waitFor(() => expect(box().style.height).toBe('180px'));
      const heightSampler = startSampler(() => box().style.height);
      const copySampler = startSampler(() => card().textContent ?? '');
      fireEvent.click(cardButton('Next')); // -> camera, still the same card: copy and height cross over
      await waitFor(() => expect(shownStep()).toBe(2));
      await waitFor(() => expect(box().style.height).toBe('120px'));
      heightSampler.stop();
      copySampler.stop();
      // Reduced motion collapses both tweens to duration 0: the height is only ever seen at its two
      // endpoints, never in between, and no sampled frame shows both steps' copy at once.
      expect(new Set(heightSampler.seen.map(parseFloat))).toEqual(new Set([180, 120]));
      expect(copySampler.seen.some((t) => t.includes('Welcome') && t.includes('Moving'))).toBe(false);

      const sampler = startSampler(() => card().style.transform);
      // Sampled continuously, not just at the end: exitTransition is 160ms of real wall time, well
      // inside a 20-frame window, so a lingering exit would show up as a SECOND dialog mid-window
      // even though it is gone by the time the window closes.
      const dialogCount = startSampler(() => screen.getAllByRole('dialog').length);
      fireEvent.click(cardButton('Next')); // -> open, which lands beside the phone: this MOVES the card
      await waitForSpotlight(container);
      await frames(20); // a pop would still be playing here; an instant arrival has nothing to show
      sampler.stop();
      dialogCount.stop();
      for (const transform of sampler.seen) expect(scaleOf(transform)).toBe(1);
      expect(Math.max(...dialogCount.seen)).toBe(1); // never two dialogs at once: no lingering exit
    } finally {
      undo();
    }
  });

  it('re-measures when the phone card opens or closes, so a spotlight never outlives its target', async () => {
    const absent = stubTargets();
    startTour();
    const { container } = render(<TourOverlay onStepEnter={applyMenuAction} />, { wrapper });
    gotoTargetedStep();
    await waitForSpotlight(container);
    act(() => useEditorStore.getState().setMenuCollapsed(false)); // through `open`
    await waitFor(() => expect(shownStep()).toBe(4)); // `menu`, lighting the card's tiles
    // The visitor puts the card away again, and its tiles leave the DOM with it. Nothing else
    // announces that, so without the card's own state as a trigger the ring would stay lit over
    // the empty corner where the tiles used to be.
    absent.add('menu-tiles');
    act(() => useEditorStore.getState().setMenuCollapsed(true));
    await waitFor(() => expect(shownStep()).toBe(5));
  });

  it('claims no modality, because the app under the dim stays operable', () => {
    // aria-modal would tell a screen reader to hide the rest of the app, and there is no focus
    // trap to back that up: the dim takes no pointer events, and two steps advance on the visitor
    // working the real control underneath it.
    startTour();
    render(<TourOverlay />, { wrapper });
    expect(card().getAttribute('aria-modal')).toBeNull();
    expect(screen.getByTestId('tour-dim').style.pointerEvents).toBe('none');
  });

  it('a replay opens on step one, never announcing and acting on the step the last run stopped at', async () => {
    // Reading the hook's settled index cannot see this: the reset used to be a passive effect, so
    // `act()` had already flushed it by the time a test looked. What a passive reset CANNOT undo is
    // the work the commit before it did — the stale step is announced, and the host applies its
    // menu action, which puts the phone card away in front of the visitor.
    const entered: string[] = [];
    startTour();
    render(<TourOverlay onStepEnter={(s) => { entered.push(s.id); applyMenuAction(s); }} />, { wrapper });
    await waitFor(() => cardButton('Next'));
    gotoTargetedStep(); // -> `open`, which collapses the card
    fireEvent.click(cardButton('Skip tour'));
    expect(useEditorStore.getState().tourRunning).toBe(false);

    // A replay comes from the Settings gear, which is on the EXPANDED card.
    act(() => useEditorStore.getState().setMenuCollapsed(false));
    entered.length = 0;
    act(() => { startTour(); });

    expect(entered).toEqual(['welcome']);
    expect(useEditorStore.getState().menuCollapsed).toBe(false);
    // Six, not seven: this replay opens with the card up, so the step that teaches opening it is
    // not part of the run at all.
    expect(card().textContent).toContain('Step 1 of 6');
  });

  it('a replay with the card already open leaves that step out and numbers the run it gives', async () => {
    // Settings opens from the gear on the EXPANDED card, so a replay always begins with the menu
    // up. There is nothing to teach about opening a card that is open, and closing it to make the
    // point would undo the gesture that got the visitor here. The step is left out of the RUN, so
    // the counter reads 1..6 with no gap where it would have been.
    const entered: string[] = [];
    useEditorStore.getState().setMenuCollapsed(false);
    startTour();
    render(<TourOverlay onStepEnter={(s) => { entered.push(s.id); applyMenuAction(s); }} />, { wrapper });
    const counters: string[] = [];
    const readCounter = () => {
      counters.push(/Step \d+ of \d+/.exec(card().textContent ?? '')?.[0] ?? '?');
    };
    await waitFor(() => card());
    readCounter();
    expect(useEditorStore.getState().menuCollapsed).toBe(false); // the tour did not put it away
    for (let i = 0; i < 5; i++) { await clickNext(); readCounter(); }
    expect(counters).toEqual([1, 2, 3, 4, 5, 6].map((n) => `Step ${n} of 6`));
    expect(entered).toEqual(['welcome', 'camera', 'menu', 'collapse', 'layers', 'view']);
  });

  it('a second run through the SAME overlay starts clean, not on the last run\'s leftovers', async () => {
    // The overlay is mounted for the app's whole life and TOUR_STEPS entries are module singletons,
    // so a run's ANNOUNCED and ARMED refs, if left behind, would be read by the next run as its own:
    // `open` arms for its gesture, going past it by the BUTTON never spends that arming. Every other
    // test in this file mounts a fresh overlay, which is the only reason none of them can see it.
    const entered: string[] = [];
    startTour();
    const { container } = render(
      <TourOverlay onStepEnter={(s) => { entered.push(s.id); applyMenuAction(s); }} />, { wrapper },
    );
    gotoTargetedStep(); // -> `open`, which arms while the card is down
    await waitForSpotlight(container);
    await clickNext();
    fireEvent.click(cardButton('Skip tour'));

    entered.length = 0;
    act(() => useEditorStore.getState().setMenuCollapsed(true));
    act(() => { startTour(); });
    // One step announced, and it is the first: the new run neither inherits an announcement nor
    // falls through a step on arrival.
    expect(entered).toEqual(['welcome']);
    expect(card().textContent).toContain(`Step 1 of ${TOUR_STEPS.length}`);
    await clickNext();
    await clickNext();
    expect(shownStep()).toBe(3);
    expect(entered).toEqual(['welcome', 'camera', 'open']);
  });

  it('a stream of viewport changes does not starve the tracking', async () => {
    // A drag-resize fires an event per frame, faster than frames arrive. Restarting the loop on
    // each one would cancel every run before its first frame ever ran, so nothing would be read at
    // all and the spotlight would sit at its pre-drag position for the whole drag.
    let left = 100;
    stubTargets([], () => rectAt(left, 100));
    startTour();
    const { container } = render(<TourOverlay />, { wrapper });
    gotoTargetedStep();
    await waitForSpotlight(container);
    const bus = useEditorStore.getState().eventBus;
    left = 300;
    const stream = setInterval(() => bus.emit('viewport-changed', { zoom: 1 }), 5);
    try {
      await waitFor(() => expect(holeBox(container)?.left).toBe(292));
    } finally {
      clearInterval(stream);
    }
  });
});
