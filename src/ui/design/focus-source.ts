/*
 * focus-source.ts — what put the focus where it is, which is what decides whether a ring is drawn.
 *
 * `:focus-visible` is the browser's answer to that question and it is nearly the one this interface
 * wants, except for one heuristic in it: a browser also promotes the element that is ALREADY focused
 * as soon as any key goes down (CSS UI 4, "if the user interacts with the page via the keyboard, the
 * currently focused element should match :focus-visible"). A control here is focused by the click
 * that chose it and then stays focused, so the next key press — Enter, or the control's own shortcut
 * — draws a ring around a control the yellow plate already marks as chosen. Two boxes, and the outer
 * one appeared for pressing a key that had nothing to do with it.
 *
 * So the source is recorded when focus is ACQUIRED and never re-read after: a pointer press arms
 * 'pointer', a key press arms 'keyboard', and whichever is armed at the next `focusin` is stamped on
 * the document. A key pressed at a standing focus moves nothing, which is the whole point, and a Tab
 * still stamps 'keyboard' because it moves the focus itself. `animations.css` reads the stamp.
 *
 * Capture phase, on the document, so a handler that stops propagation cannot hide an input from it.
 */
import { useEffect } from 'react';

/** The attribute `animations.css` reads, on the document element. */
export const FOCUS_SOURCE_ATTR = 'data-focus-source';

export type FocusSource = 'pointer' | 'keyboard';

/**
 * Stamp every focus with what put it there, for as long as the caller is mounted.
 *
 * Exported for the test as well as for the shell: the sequence it has to get right is a press, a
 * focus and then a key at that standing focus, which is three events and one attribute.
 */
export function trackFocusSource(root: HTMLElement = document.documentElement): () => void {
  let armed: FocusSource | null = null;
  const arm = (source: FocusSource) => () => { armed = source; };
  const onPointer = arm('pointer');
  const onKey = arm('keyboard');
  const onFocusIn = () => { if (armed) root.setAttribute(FOCUS_SOURCE_ATTR, armed); };

  document.addEventListener('pointerdown', onPointer, true);
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('focusin', onFocusIn, true);
  return () => {
    document.removeEventListener('pointerdown', onPointer, true);
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('focusin', onFocusIn, true);
    root.removeAttribute(FOCUS_SOURCE_ATTR);
  };
}

export function useFocusSource(): void {
  useEffect(() => trackFocusSource(), []);
}
