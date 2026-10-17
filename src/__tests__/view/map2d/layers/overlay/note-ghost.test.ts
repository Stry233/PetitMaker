// @vitest-environment jsdom
/** The 2D note ghost through the overlay: one rebuild per frame in its own slot, faded in through
 *  the registry motion (at once under reduced motion), and taken down at once by clearGhost. */
import '../../../../_support/pixi-env';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OverlayLayer } from '../../../../../view/map2d/layers/overlay-layer';
import { overlayPart } from '../../../../_support/overlay-parts';
import { setReducedMotion } from '../../../../../platform/channels/motion-state';
import { animConfig } from '../../../../../view/shared/motion/anim-config';
import { NOTE_GHOST_ALPHA } from '../../../../../view/shared/overlay/ghost-geometry';
import type { ChipNote } from '../../../../../core/model/annotations';

const CHIP: ChipNote = { kind: 'chip', id: 'g', x: 5.3, y: 6.7, tag: 'plaza', size: 'm', color: '#FFB347' };

type Slot = { visible: boolean; alpha: number; children: Array<{ children: unknown[] }> };

let frames: FrameRequestCallback[];
let now: number;
/** Runs the frames queued so far, `ms` after the last. */
function frame(ms = 16): void {
  now += ms;
  const queued = frames;
  frames = [];
  for (const f of queued) f(now);
}

beforeEach(() => {
  frames = [];
  now = 0;
  vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => frames.push(f));
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});

afterEach(() => {
  setReducedMotion(false);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The note nodes the ghost's own notes layer stands: its passes' children. */
const drawn = (slot: Slot): number => slot.children[0]!.children.reduce<number>((n, pass) => n + (pass as { children: unknown[] }).children.length, 0);

describe('the 2D note ghost', () => {
  it('draws the note on the next frame and fades in over the registry motion', () => {
    const overlay = new OverlayLayer(() => {});
    const slot = overlayPart<Slot>(overlay, 'noteSlot');
    overlay.showNoteGhost(CHIP, 'Plaza');
    expect(slot.visible).toBe(false);
    frame();
    expect(slot.visible).toBe(true);
    expect(drawn(slot)).toBe(1);
    expect(slot.alpha).toBe(0);
    frame(animConfig.noteGhost.fadeInMs / 2);
    expect(slot.alpha).toBeGreaterThan(0);
    expect(slot.alpha).toBeLessThan(NOTE_GHOST_ALPHA);
    frame(animConfig.noteGhost.fadeInMs);
    expect(slot.alpha).toBeCloseTo(NOTE_GHOST_ALPHA);
    overlay.showNoteGhost({ ...CHIP, x: 9 }, 'Plaza');
    frame();
    expect(slot.alpha).toBeCloseTo(NOTE_GHOST_ALPHA);
    expect(drawn(slot)).toBe(1);
  });

  it('lands at its strength at once under reduced motion', () => {
    setReducedMotion(true);
    const overlay = new OverlayLayer(() => {});
    const slot = overlayPart<Slot>(overlay, 'noteSlot');
    overlay.showNoteGhost(CHIP, 'Plaza');
    frame();
    expect(slot.alpha).toBe(NOTE_GHOST_ALPHA);
    expect(frames).toHaveLength(0);
  });

  it('goes at once on clearGhost, the call a leave or a pan makes', () => {
    const overlay = new OverlayLayer(() => {});
    const slot = overlayPart<Slot>(overlay, 'noteSlot');
    overlay.showNoteGhost(CHIP, 'Plaza');
    frame();
    overlay.clearGhost();
    frame();
    expect(slot.visible).toBe(false);
    expect(drawn(slot)).toBe(0);
  });
});
