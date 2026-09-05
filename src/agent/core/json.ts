/** Parses streamed tool arguments, closing complete partial values without inventing missing ones. */
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

/**
 * Trims to the last complete value, closes an unfinished value string when possible, then balances
 * the surviving brackets. A complete key alone is not a safe cut because its value is still absent.
 */
function repair(raw: string): string {
  const stack: string[] = [];
  let inStr = false;
  let openIsKey = false;
  let safeEnd = 0;
  // Index of an incomplete escape; a closing quote cannot be appended inside it.
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
      // A quoted object member is a key unless it follows a value separator.
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
  else if (openIsKey) s = raw.slice(0, safeEnd); // Drop a dangling key.
  else if (escStart >= 0) s = raw.slice(0, escStart) + '"'; // Drop the incomplete escape.
  else s = raw + '"'; // Close an unterminated value string.
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
