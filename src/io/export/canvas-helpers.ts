// Canvas 2D text fitting for the export painters: ellipsis and line wrapping in the current font.

/** Trim `text` in the current font to `maxW`. `force` adds the ellipsis that marks line-clamped text. */
export function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxW: number, force = false): string {
  if (!force && ctx.measureText(text).width <= maxW) return text;
  const E = '…';
  // Cut between code points, so a character outside the basic plane is never split in half.
  const chars = Array.from(text);
  let lo = 0, hi = chars.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(chars.slice(0, mid).join('') + E).width <= maxW) lo = mid; else hi = mid - 1;
  }
  return (chars.slice(0, lo).join('').trimEnd() || (chars[0] ?? '')) + E;
}

/** Break `text` into lines no wider than `maxW` in the current font: at spaces where it has them,
 *  and between code points inside a run too wide for one line (Chinese and Japanese use no spaces). */
export function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const fits = (s: string) => ctx.measureText(s).width <= maxW;
  const lines: string[] = [];
  let cur = '';
  for (const word of text.split(/\s+/)) {
    if (!word) continue;
    const joined = cur ? `${cur} ${word}` : word;
    if (fits(joined)) { cur = joined; continue; }
    if (cur) lines.push(cur);
    cur = '';
    for (const ch of Array.from(word)) {
      if (cur && !fits(cur + ch)) { lines.push(cur); cur = ch; } else { cur += ch; }
    }
  }
  if (cur) lines.push(cur);
  return lines;
}
