/** Never-throwing JSON for streamed tool arguments. The repair closes what the stream has not
 *  finished; it never invents values, so a dangling `"y":` is dropped rather than nulled. */
export function parsePartial(raw: string): Record<string, unknown> {
  return parseArgs(raw) ?? {};
}

export function parseArgs(raw: string): Record<string, unknown> | undefined {
  return tryParse(raw) ?? tryParse(repair(raw));
}

function tryParse(s: string): Record<string, unknown> | undefined {
  if (!s.trim().startsWith('{')) return undefined;
  try {
    const v: unknown = JSON.parse(s);
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

// Characters that mean "this number is not finished yet" when they follow a digit.
const NUM_TAIL = /[\d.eE+-]/;

/** One scan tracking string/escape state and a bracket stack. `safeEnd` follows the end of the
 *  last fully-formed VALUE: a closed value string, a finished number or literal, or a closed
 *  nested structure. A closed KEY string does NOT advance it, since the pair's value may still be
 *  missing (a key is only ever a quoted string, so any bare number/literal/`{`/`[` is always a
 *  value). Once scanned, the text is cut back to that point, or, mid-string on a VALUE, the
 *  string is closed in place instead of dropped; the bracket stack for whatever survives is then
 *  recomputed from scratch, since brackets opened or closed past the cut no longer apply. */
function repair(raw: string): string {
  const stack: string[] = [];
  let inStr = false;
  let openIsKey = false;
  let safeEnd = 0;
  // Index of the backslash starting an escape still being consumed (-1 once it completes): a cut
  // landing here can't just close the string in place, since the appended quote would itself be
  // read as escaped data rather than a terminator.
  let escStart = -1;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i] ?? '';
    if (inStr) {
      if (escStart >= 0) {
        const need = raw[escStart + 1] === 'u' ? 5 : 1; // \uXXXX takes 4 chars past the backslash, any other escape takes 1
        if (i === escStart + need) escStart = -1;
      } else if (c === '\\') {
        escStart = i;
      } else if (c === '"') {
        inStr = false;
        if (!openIsKey) safeEnd = i + 1;
      }
      continue;
    }
    if (c === '"') {
      inStr = true;
      // A quote opens a KEY only inside an object and only where a value isn't already expected
      // (i.e. it does not immediately follow a `:`); everywhere else a string is a value.
      openIsKey = stack[stack.length - 1] === '}' && precedingSignificant(raw, i) !== ':';
    } else if (c === '{' || c === '[') {
      stack.push(c === '{' ? '}' : ']');
    } else if (c === '}' || c === ']') {
      stack.pop();
      safeEnd = i + 1;
    } else if (/\d/.test(c) && !NUM_TAIL.test(raw[i + 1] ?? '')) {
      safeEnd = i + 1;
    } else if (
      (i >= 3 && c === 'e' && raw.slice(i - 3, i + 1) === 'true') ||
      (i >= 4 && c === 'e' && raw.slice(i - 4, i + 1) === 'false') ||
      (i >= 3 && c === 'l' && raw.slice(i - 3, i + 1) === 'null')
    ) {
      safeEnd = i + 1;
    }
  }

  let s: string;
  if (!inStr) s = raw.slice(0, safeEnd);
  else if (openIsKey) s = raw.slice(0, safeEnd); // dangling key: drop it whole, escape or not
  else if (escStart >= 0) s = raw.slice(0, escStart) + '"'; // drop the incomplete escape, keep the value up to it
  else s = raw + '"'; // ordinary unterminated value: close as-is
  return s + restack(s).reverse().join('');
}

/** Recomputes which brackets are still open across a prefix already cut to a safe point. */
function restack(s: string): string[] {
  const stack: string[] = [];
  let inStr = false;
  let esc = false;
  for (const c of s) {
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') stack.push(c === '{' ? '}' : ']');
    else if (c === '}' || c === ']') stack.pop();
  }
  return stack;
}

function precedingSignificant(raw: string, idx: number): string {
  let j = idx - 1;
  while (j >= 0 && /\s/.test(raw[j] ?? '')) j--;
  return j >= 0 ? raw[j] ?? '' : '';
}
