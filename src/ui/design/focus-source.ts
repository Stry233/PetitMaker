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
 * A focus that arrives with NEITHER armed was moved by the page itself — the tour card and the
 * modals take focus on mount, before any input exists — and stamps 'program', which draws no ring
 * either: a browser matches `:focus-visible` on a script-focused element too, and the ring's whole
 * contract is that it marks where the KEYBOARD put the focus. A script focus while a source stands
 * armed keeps that source, which is what lets a modal opened by shortcut ring for a keyboard user.
 *
 * Capture phase, on the document, so a handler that stops propagation cannot hide an input from it.
 */
import { useEffect } from 'react';

/** The attribute `animations.css` reads, on the document element. */
export const FOCUS_SOURCE_ATTR = 'data-focus-source';

/**
 * THE RING BELONGS TO THE BOX THAT HAS THE SHAPE, which is the other half of drawing focus in this
 * interface, and this pair of class names is how a wrapped field says it (`animations.css` holds
 * both rules).
 *
 * An outline follows its OWN element's `border-radius`. In a wrapped field the radius belongs to the
 * pill and the focus to the bare input inside it, so the house ring was drawn as a rectangle within
 * the rounded box, corners and all. `FIELD_INPUT_CLASS` takes the ring off the input;
 * `FIELD_WRAP_CLASS` puts it on the wrapper, at the same offset and the wrapper's own radius.
 *
 * THEY ARE ONE PAIR AND HALF OF IT IS THE BUG: a wrapper marked without its input rings twice, an
 * input marked without its wrapper rings not at all. Every text field in the app whose radius lives
 * on a parent wears both; a field carrying its own radius needs neither, and several do (the export
 * modal's boxes, the candidate card's ghost field), which is why this is a marker rather than a
 * global rule over inputs.
 */
export const FIELD_WRAP_CLASS = 'pw-field-wrap';
export const FIELD_INPUT_CLASS = 'pw-field-input';

export type FocusSource = 'pointer' | 'keyboard' | 'program';

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
  const onFocusIn = () => { root.setAttribute(FOCUS_SOURCE_ATTR, armed ?? 'program'); };

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
