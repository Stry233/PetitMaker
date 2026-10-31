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

/** Scrolls `container` alone so `el` stands at its middle along `axis`: `el`'s offset is summed up its
 *  offset parents to `container`, which must be positioned, so the zoom never enters it. */
export function centreIn(container: HTMLElement, el: HTMLElement, axis: 'x' | 'y'): void {
  let at = 0;
  for (let node: HTMLElement | null = el; node && node !== container; node = node.offsetParent as HTMLElement | null) {
    at += axis === 'x' ? node.offsetLeft : node.offsetTop;
  }
  if (axis === 'x') container.scrollLeft = at + el.offsetWidth / 2 - container.clientWidth / 2;
  else container.scrollTop = at + el.offsetHeight / 2 - container.clientHeight / 2;
}
