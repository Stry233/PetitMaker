// @vitest-environment jsdom
/**
 * A floating card follows an anchor that moves with no scale glide (a morphing or sliding piece) in
 * the frame that moved it, never a frame behind. jsdom lays nothing out, so the anchor's box is stubbed.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { frame } from 'framer-motion';
import { useRef } from 'react';
import { useFloatingPosition } from '../../../ui/primitives/use-floating-position';

let anchorBox = { left: 100, top: 100, width: 40, height: 20 };

function stubAnchor(el: HTMLElement): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => {
      const { left, top, width, height } = anchorBox;
      return { left, top, width, height, x: left, y: top, right: left + width, bottom: top + height, toJSON: () => ({}) };
    },
  });
}

function Card() {
  const anchor = useRef<HTMLDivElement | null>(null);
  const { ref, style } = useFloatingPosition({ open: true, anchor, zoom: 1, width: 120 });
  return (
    <>
      <div ref={(el) => { anchor.current = el; if (el) stubAnchor(el); }} />
      <div ref={ref} data-testid="card" style={style} />
    </>
  );
}

/** Runs `read` after this frame's measures, inside the same frame. */
const afterThisFrame = <T,>(read: () => T) => new Promise<T>((r) => { frame.postRender(() => r(read())); });

afterEach(cleanup);

describe('a floating card at rest', () => {
  it('lands beside an anchor that moved in the same frame', async () => {
    anchorBox = { left: 100, top: 100, width: 40, height: 20 };
    const view = render(<Card />);
    await act(async () => { await afterThisFrame(() => {}); });
    const card = view.getByTestId('card');
    const before = card.style.left;

    anchorBox = { ...anchorBox, left: 400 };
    const during = await afterThisFrame(() => card.style.left);
    expect(during).not.toBe(before);
  });
});
