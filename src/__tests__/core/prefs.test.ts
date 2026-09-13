/**
 * Preferences are declared once. A key that is read or written anywhere in src/ but not
 * declared here is a preference nothing can enumerate, reset, or reason about.
 */
import { describe, it, expect, beforeEach } from 'vitest';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readFileSync, readdirSync, statSync } from 'node:fs';
// @ts-ignore - node:path is untyped here (no @types/node)
import { join, resolve } from 'node:path';
import { readPref, writePref, PREF_STORAGE_KEYS } from '../../core/runtime/prefs';

declare const __dirname: string;

/** Every source file under src/, tests excluded, as { path, text }. */
function sourceFiles(): { path: string; text: string }[] {
  const src = resolve(__dirname, '../..');
  const out: { path: string; text: string }[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) { if (name !== '__tests__') walk(full); }
      else if (/\.tsx?$/.test(name)) out.push({ path: full.replace(/\\/g, '/'), text: readFileSync(full, 'utf8') });
    }
  };
  walk(src);
  return out;
}

beforeEach(() => localStorage.clear());

describe('prefs', () => {
  it('uses defaults when the storage property itself is denied', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')!;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() { throw new DOMException('Storage denied', 'SecurityError'); },
    });
    try {
      expect(readPref('uiZoom')).toBe(1);
      expect(writePref('uiZoom', 1.4)).toBe(false);
    } finally {
      Object.defineProperty(globalThis, 'localStorage', descriptor);
    }
  });

  it('falls back when nothing is stored', () => {
    expect(readPref('uiZoom')).toBe(1);
  });

  it('round-trips a written value', () => {
    writePref('uiZoom', 1.4);
    expect(readPref('uiZoom')).toBe(1.4);
  });

  it('falls back when the stored value is out of range', () => {
    localStorage.setItem('petit-planet-ui-zoom', '99');
    expect(readPref('uiZoom')).toBe(1);
  });

  it('falls back when the stored value is not a member of the union', () => {
    localStorage.setItem('petit-planet-view-mode', 'holograph');
    expect(readPref('viewMode')).toBe('2d');
  });

  // `localStorage['k']` reaches the same slot the getItem/setItem/removeItem calls do — Storage is
  // an index-getter interface — so both scans below read the bracket form as a call site too.
  it('declares every storage key written as a literal', () => {
    const LITERAL = /(?:localStorage|sessionStorage)(?:\.(?:getItem|setItem|removeItem)\(|\[)\s*'([^']+)'/g;
    const used = new Set<string>();
    for (const { path, text } of sourceFiles()) {
      if (path.endsWith('core/runtime/prefs.ts')) continue;
      for (const m of text.matchAll(LITERAL)) used.add(m[1]!);
    }
    expect([...used].filter((k) => !PREF_STORAGE_KEYS.includes(k)).sort()).toEqual([]);
  });

  // A literal scan alone cannot see `localStorage.getItem(LS_KEY)`, and that is exactly how the
  // keymap read its key. Every call site therefore has to name its key one of two ways: a literal
  // the table declares, or a `PREFS.<id>.key` reference. A bare local constant is what drifts.
  it('names every storage key through the table', () => {
    const CALL = /(?:localStorage|sessionStorage)(?:\.(?:getItem|setItem|removeItem)\(\s*([^,)]+)|\[\s*([^\]]+)\])/g;
    const offenders: string[] = [];
    for (const { path, text } of sourceFiles()) {
      if (path.endsWith('core/runtime/prefs.ts')) continue;
      for (const m of text.matchAll(CALL)) {
        const arg = (m[1] ?? m[2])!.trim();
        const literal = /^'([^']+)'$/.exec(arg);
        if (literal && PREF_STORAGE_KEYS.includes(literal[1]!)) continue;
        if (/^PREFS\.\w+\.key$/.test(arg)) continue;
        offenders.push(`${path.slice(path.indexOf('/src/') + 5)} -> ${arg}`);
      }
    }
    expect(offenders.sort()).toEqual([]);
  });
});
