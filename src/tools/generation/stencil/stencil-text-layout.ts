interface TextRow { start: number; end: number }

/** Grapheme indices remain intact; whitespace offers preferred breaks and is trimmed at row edges. */
export function wrapTextRows(length: number, capacity: number, space: (index: number) => boolean): TextRow[] {
  if (capacity < 1) return [];
  const rows: TextRow[] = [];
  let start = 0;
  while (start < length) {
    while (start < length && space(start)) start++;
    if (start === length) break;
    const remaining = length - start;
    const count = Math.ceil(remaining / capacity);
    let end = Math.min(length, start + Math.ceil(remaining / count));
    if (end < length && !space(end)) {
      let before = end, after = end;
      while (before > start && !space(before)) before--;
      while (after < Math.min(length, start + capacity) && !space(after)) after++;
      if (after === length || space(after)) end = after;
      else if (before > start) end = before;
    }
    const next = end;
    while (end > start && space(end - 1)) end--;
    rows.push({ start, end });
    start = next;
  }
  return rows;
}
