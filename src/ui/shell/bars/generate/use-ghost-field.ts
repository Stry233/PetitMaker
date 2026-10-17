/** A hidden input's real selection, read and steered so the text painted in its place tells the truth. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { graphemes } from '../../../../core/base/text';
import { visualRect } from '../../../design/visual-rect';
import { clientPoint } from '../../../../platform/device/viewport-space';

/** The attribute every painted grapheme carries, so a press can be placed against the painted text. */
export const GRAPHEME_ATTR = 'data-grapheme';

/** The UTF-16 offset of every grapheme boundary in `text`, from 0 to `text.length`. */
function graphemeBoundaries(text: string): number[] {
  const bounds = [0];
  for (const part of graphemes(text)) bounds.push(bounds[bounds.length - 1]! + part.length);
  return bounds;
}

/** The first grapheme boundary at or after a UTF-16 offset, as a boundary index. */
function boundaryIndex(bounds: readonly number[], offset: number): number {
  for (let i = 0; i < bounds.length; i++) if (bounds[i]! >= offset) return i;
  return bounds.length - 1;
}

/** The field's selection in UTF-16 offsets, and how many times it has moved (a caret restarts its blink on each). */
export interface GhostSelection { start: number; end: number; moves: number }

/**
 * Tracks a ghost input's focus and selection, and places presses on the painted text instead of the
 * input's own invisible glyphs. During IME composition the caret stands at the preedit's end.
 */
export function useGhostField(text: string) {
  const [input, setInput] = useState<HTMLInputElement | null>(null);
  const paintRef = useRef<HTMLElement | null>(null);
  const composing = useRef(false);
  const [focused, setFocused] = useState(false);
  const [selection, setSelection] = useState<GhostSelection>({ start: text.length, end: text.length, moves: 0 });
  const readRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!input) return;
    const el = input;
    /** The length of the text after the composition, fixed at its start: the preedit ends where it begins. */
    let tail: number | null = null;
    let dragAnchor: number | null = null;
    let pointerType = '';
    const timers = new Set<ReturnType<typeof setTimeout>>();

    const read = () => {
      let start = el.selectionStart ?? el.value.length;
      let end = el.selectionEnd ?? start;
      if (composing.current && tail !== null) start = end = Math.max(0, el.value.length - tail);
      setSelection(prev => (prev.start === start && prev.end === end ? prev : { start, end, moves: prev.moves + 1 }));
    };
    readRef.current = read;
    /** Reads once the event's default action (a caret move, an insertion) has run. */
    const readAfter = () => {
      const id = setTimeout(() => { timers.delete(id); read(); }, 0);
      timers.add(id);
    };
    /** The boundary of the painted text nearest a press, as a UTF-16 offset. */
    const offsetAt = (event: MouseEvent): number => {
      const bounds = graphemeBoundaries(el.value);
      const spans = paintRef.current?.querySelectorAll<HTMLElement>(`[${GRAPHEME_ATTR}]`) ?? [];
      const { x } = clientPoint(event);
      for (let i = 0; i < spans.length; i++) {
        const rect = visualRect(spans[i]!);
        if (x < (rect.left + rect.right) / 2) return bounds[Math.min(i, bounds.length - 1)]!;
      }
      return bounds[Math.min(spans.length, bounds.length - 1)]!;
    };
    const place = (anchor: number, head: number) => {
      el.setSelectionRange(Math.min(anchor, head), Math.max(anchor, head), head < anchor ? 'backward' : 'forward');
      read();
    };

    const onFocus = () => { setFocused(true); read(); };
    const onBlur = () => { setFocused(false); dragAnchor = null; };
    const onDocumentSelection = () => { if (document.activeElement === el) read(); };
    const onCompositionStart = () => {
      composing.current = true;
      tail = el.value.length - (el.selectionEnd ?? el.value.length);
    };
    const onCompositionEnd = () => { composing.current = false; tail = null; readAfter(); };
    const onPointerDown = (e: PointerEvent) => {
      pointerType = e.pointerType;
      if (e.button !== 0 || e.pointerType !== 'mouse') return;
      el.setPointerCapture?.(e.pointerId);
    };
    // A mouse press is placed here rather than by the browser, which would measure the invisible text.
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0 || composing.current) return;
      e.preventDefault();
      if (document.activeElement !== el) el.focus({ preventScroll: true });
      if (e.detail >= 2) { dragAnchor = null; el.select(); read(); return; }
      const head = offsetAt(e);
      const extending = e.shiftKey && el.selectionStart !== null;
      dragAnchor = extending ? (el.selectionDirection === 'backward' ? el.selectionEnd! : el.selectionStart!) : head;
      place(dragAnchor, head);
    };
    const onPointerMove = (e: PointerEvent) => { if (dragAnchor !== null && e.pointerType === 'mouse') place(dragAnchor, offsetAt(e)); };
    const onPointerUp = (e: PointerEvent) => {
      dragAnchor = null;
      if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
    };
    // A tap focuses natively; its caret then moves to the tapped place in the painted text.
    const onClick = (e: MouseEvent) => {
      if (pointerType === '' || pointerType === 'mouse' || composing.current || el.selectionStart !== el.selectionEnd) return;
      const at = offsetAt(e);
      place(at, at);
    };

    // `input` reads late: a state update in a native listener re-renders before React's own `onChange`,
    // which would write the old controlled value back over the keystroke.
    const own: [string, EventListener][] = [
      ['focus', onFocus], ['blur', onBlur], ['select', read], ['selectionchange', read], ['input', readAfter],
      ['keydown', readAfter], ['keyup', read], ['mouseup', read],
      ['compositionstart', onCompositionStart], ['compositionupdate', readAfter], ['compositionend', onCompositionEnd],
      ['pointerdown', onPointerDown as EventListener], ['mousedown', onMouseDown as EventListener],
      ['pointermove', onPointerMove as EventListener], ['pointerup', onPointerUp as EventListener],
      ['pointercancel', onPointerUp as EventListener], ['click', onClick as EventListener],
    ];
    for (const [type, listener] of own) el.addEventListener(type, listener);
    document.addEventListener('selectionchange', onDocumentSelection);
    if (document.activeElement === el) onFocus();
    return () => {
      for (const [type, listener] of own) el.removeEventListener(type, listener);
      document.removeEventListener('selectionchange', onDocumentSelection);
      for (const id of timers) clearTimeout(id);
      composing.current = false;
      readRef.current = () => {};
      setFocused(false);
    };
  }, [input]);

  // A controlled value written back (a filtered keystroke, a limit) can move the selection without an event.
  useLayoutEffect(() => { readRef.current(); }, [text]);

  const bounds = graphemeBoundaries(text);
  return {
    /** The callback ref for the hidden input. */
    inputRef: setInput,
    /** The ref for the painted text's root, whose `GRAPHEME_ATTR` spans presses are placed against. */
    paintRef,
    /** Whether an IME composition is open, set before React's own composition handlers run. */
    composing,
    focused,
    /** The selection in grapheme indices of `text`. */
    start: boundaryIndex(bounds, Math.min(selection.start, text.length)),
    end: boundaryIndex(bounds, Math.min(selection.end, text.length)),
    moves: selection.moves,
  };
}
