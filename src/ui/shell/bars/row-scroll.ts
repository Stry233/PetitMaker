/** Tabs are direct children of a positioned row, so offsets and scrollLeft share local pixels.
 * Only the row moves: scrollIntoView would also scroll enclosing articles and windows. */
export function reveal(el: HTMLElement | null | undefined): void {
  const row = el?.parentElement;
  if (!el || !row || row.clientWidth === 0) return;
  const left = el.offsetLeft - row.scrollLeft;
  const right = left + el.offsetWidth - row.clientWidth;
  // A tab spanning both edges already fills the viewport.
  if (left < 0 && right > 0) return;
  if (left < 0) row.scrollLeft += Math.max(left, right);
  else if (right > 0) row.scrollLeft += Math.min(left, right);
}
