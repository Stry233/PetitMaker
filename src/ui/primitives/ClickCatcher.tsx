// Shared floating-popover plumbing: an invisible full-viewport click-catcher that dismisses an
// open popover on any outside click, plus the viewport clamps for positioning it. Anything that
// opens a fixed-position panel anchored to a button or a caret uses these two together.
import type { CSSProperties } from 'react';

/** Invisible fixed full-viewport div that calls `onDismiss` on any click. Render it BEHIND the
 *  popover it guards (the popover needs a higher zIndex, typically `zIndex + 1`). */
export function ClickCatcher({ onDismiss, zIndex = 300 }: { onDismiss(): void; zIndex?: number }) {
  const style: CSSProperties = { position: 'fixed', inset: 0, zIndex };
  return <div onClick={onDismiss} style={style} />;
}

/** Clamp a floating panel's `left` so it stays inside the viewport. The panel renders under the
 *  page's chrome `zoom` scale, so its VISUAL width is `widthPx * zoom` — clamp against that, not
 *  the raw css width. `viewportWidth` defaults to the live window; pass it to keep a caller pure. */
export function clampLeft(left: number, widthPx: number, zoom: number, margin = 8, viewportWidth = window.innerWidth): number {
  return Math.max(margin, Math.min(left, viewportWidth - widthPx * zoom - margin));
}

/** The vertical twin of `clampLeft` — same VISUAL-px reasoning (a panel's height * zoom is what
 *  actually occupies screen), clamped against the viewport height instead of the width. */
export function clampTop(top: number, heightPx: number, zoom: number, margin = 8, viewportHeight = window.innerHeight): number {
  return Math.max(margin, Math.min(top, viewportHeight - heightPx * zoom - margin));
}
