/**
 * wheelGlider's state machine, driven directly with a pumped rAF: the integration tests run on
 * jsdom's unclamped scrollLeft, which cannot exercise the one condition the glider exists to
 * survive — a browser whose real maximum offset sits short of `scrollWidth - clientWidth`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { wheelGlider } from '../../../ui/shell/bars/row-scroll';

let queue: FrameRequestCallback[] = [];
let now = 0;

/** Run one frame: advance the clock and fire everything scheduled before it. */
function pump(ms = 16): void {
  now += ms;
  const q = queue;
  queue = [];
  for (const cb of q) cb(now);
}

/** A row whose browser clamps scrollLeft at `max`, like a zoomed element whose real stop sits
 *  short of scrollWidth - clientWidth. */
function clampedRow(max: number, scrollWidth = 300, clientWidth = 100) {
  let pos = 0;
  return {
    scrollWidth, clientWidth, isConnected: true,
    get scrollLeft() { return pos; },
    set scrollLeft(v: number) { pos = Math.max(0, Math.min(max, v)); },
  } as unknown as HTMLElement;
}

beforeEach(() => {
  queue = [];
  now = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { queue.push(cb); return queue.length; });
  vi.stubGlobal('cancelAnimationFrame', () => { queue = []; });
  vi.stubGlobal('performance', { now: () => now });
});
afterEach(() => vi.unstubAllGlobals());

describe('wheelGlider', () => {
  it('glides to a reachable target and stops scheduling frames', () => {
    const row = clampedRow(200);
    const glide = wheelGlider();
    glide.wheel(row, 100, false);
    for (let i = 0; i < 200 && queue.length; i++) pump();
    expect(row.scrollLeft).toBe(100);
    expect(queue.length, 'the run ends when it arrives').toBe(0);
  });

  it('stops at a clamped edge short of the computed maximum instead of spinning forever', () => {
    // Computed room is 200 but the browser stops at 197: the remaining 3px shrink the step below
    // any magnitude gate, so only "the write did not stick" can end the run.
    const row = clampedRow(197);
    const glide = wheelGlider();
    glide.wheel(row, 500, false);
    for (let i = 0; i < 500 && queue.length; i++) pump();
    expect(queue.length, 'no frame is scheduled once the edge pins the row').toBe(0);
    expect(row.scrollLeft).toBeGreaterThan(190);
  });

  it('lands at once under reduced motion and schedules nothing', () => {
    const row = clampedRow(200);
    wheelGlider().wheel(row, 60, true);
    expect(row.scrollLeft).toBe(60);
    expect(queue.length).toBe(0);
  });

  it('yields when another hand moves the row mid-run', () => {
    const row = clampedRow(200);
    const glide = wheelGlider();
    glide.wheel(row, 100, false);
    pump();
    row.scrollLeft = 10; // a scrollbar drag between frames
    pump();
    const after = row.scrollLeft;
    for (let i = 0; i < 50 && queue.length; i++) pump();
    expect(row.scrollLeft, 'the abandoned run writes nothing more').toBe(after);
  });

  it('survives a first frame whose timestamp precedes the run start, on a row still at 0', () => {
    // requestAnimationFrame's timestamp is the FRAME's start; a wheel handler runs mid-frame, so
    // the run's performance.now() stamp can sit AFTER the first callback's time. A negative dt
    // stepped backward, could not stick at 0, and read as the clamped-edge stop: the first notch
    // on a fresh row did nothing until something else had scrolled it.
    const row = clampedRow(200);
    const glide = wheelGlider();
    now = 100;
    glide.wheel(row, 80, false);
    pump(-10); // the frame started before the wheel handler ran
    for (let i = 0; i < 200 && queue.length; i++) pump();
    expect(row.scrollLeft).toBe(80);
  });

  it('survives a same-timestamp frame without ending the run', () => {
    const row = clampedRow(200);
    const glide = wheelGlider();
    glide.wheel(row, 100, false);
    pump(0); // dt = 0: a zero step proves nothing and must not read as a clamped edge
    expect(queue.length, 'the run continues past the empty frame').toBe(1);
    for (let i = 0; i < 200 && queue.length; i++) pump();
    expect(row.scrollLeft).toBe(100);
  });
});
