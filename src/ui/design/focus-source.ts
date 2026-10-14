/*
 * What put the focus where it is, which decides whether a ring is drawn. `:focus-visible` would do
 * except that a browser also promotes the already focused element as soon as any key goes down
 * (CSS UI 4), and a control here stays focused after the click that chose it, so Enter or a
 * shortcut would ring a control the yellow plate already marks.
 *
 * Focus acquisition records the last input source; a pointer press also clears a standing keyboard
 * ring, since clicking an already focused control emits no `focusin`. A key at standing focus keeps
 * its source; Tab moves focus and stamps 'keyboard'. `animations.css` reads it.
 *
 * Focus arriving with neither source armed was moved by the page (the tour card, a modal on mount)
 * and stamps 'program', which draws no ring. A script focus while a source stands armed keeps it,
 * so a modal opened by shortcut rings for a keyboard user. Capture phase on the document, so a
 * handler that stops propagation cannot hide an input.
 */
import { useEffect } from 'react';
import { anyOverlayOpen } from '../../platform/channels/overlay-state';

/** The attribute `animations.css` reads, on the document element. */
const FOCUS_SOURCE_ATTR = 'data-focus-source';

/**
 * The ring belongs to the box that has the shape: an outline follows its own element's radius, so in
 * a wrapped field `FIELD_INPUT_CLASS` takes the ring off the bare input and `FIELD_WRAP_CLASS` puts it
 * on the rounded wrapper (`animations.css` holds both rules). One pair: a wrapper without its input
 * rings twice, an input without its wrapper not at all. A field carrying its own radius needs
 * neither (the export modal's boxes, the candidate card's ghost field), hence a marker rather than a
 * global rule.
 */
export const FIELD_WRAP_CLASS = 'pw-field-wrap';
export const FIELD_INPUT_CLASS = 'pw-field-input';

type FocusSource = 'pointer' | 'keyboard' | 'program';

/** Stamp every focus with what put it there, until the returned stop runs. */
function trackFocusSource(root: HTMLElement = document.documentElement): () => void {
  let armed: FocusSource | null = null;
  const onPointer = () => {
    armed = 'pointer';
    root.setAttribute(FOCUS_SOURCE_ATTR, 'pointer');
  };
  const onKey = (e: KeyboardEvent) => {
    // Pointer-focused buttons retain focus; Space belongs to map panning, not another click.
    if (e.code === 'Space' && !anyOverlayOpen() && root.getAttribute(FOCUS_SOURCE_ATTR) === 'pointer'
      && e.target instanceof HTMLButtonElement) e.preventDefault();
    armed = 'keyboard';
  };
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

/** Stamp every focus with what put it there, for as long as the caller is mounted. */
export function useFocusSource(): void {
  useEffect(() => trackFocusSource(), []);
}
