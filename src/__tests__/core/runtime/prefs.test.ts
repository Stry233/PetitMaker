/**
 * Preferences are declared once. A key that is read or written anywhere in src/ but not
 * declared here is a preference nothing can enumerate, reset, or reason about.
 */
import { describe, it, expect, beforeEach } from 'vitest';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readFileSync, readdirSync, statSync } from 'node:fs';
// @ts-ignore - node:path is untyped here (no @types/node)
import { join, resolve } from 'node:path';
import { PREFS, prefStorageAvailable, readPref, readStoredPref, removePref, writePref } from '../../../core/runtime/prefs';

declare const __dirname: string;

/** Every source file under src/, tests excluded, as { path, text }. */
function sourceFiles(): { path: string; text: string }[] {
  const src = resolve(__dirname, '../../..');
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

/** Source text without comments; a `//` right after `:` (a URL) is kept. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}

/** Files outside prefs.ts that name web storage at all. The full reset may call `.clear()` on each
 *  store, and nothing else. */
function storageOffenders(files: { path: string; text: string }[]): string[] {
  const offenders: string[] = [];
  for (const { path, text } of files) {
    if (path.endsWith('core/runtime/prefs.ts')) continue;
    let code = stripComments(text);
    if (path.endsWith('io/local-reset.ts')) code = code.replace(/\b(?:localStorage|sessionStorage)\.clear\(\)/g, '');
    if (/\b(?:localStorage|sessionStorage)\b/.test(code)) offenders.push(path.slice(path.indexOf('/src/') + 5));
  }
  return offenders.sort();
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

  it('reaches web storage only through the prefs module', () => {
    expect(storageOffenders(sourceFiles())).toEqual([]);
  });

  it('flags storage reached through an alias, a bracket or a global, and allows the reset its clear()', () => {
    const planted = (text: string, path = '/repo/src/io/planted.ts') => storageOffenders([{ path, text }]);
    expect(planted('const s = localStorage;\ns.getItem(k);')).toEqual(['io/planted.ts']);
    expect(planted("window['sessionStorage'].length;")).toEqual(['io/planted.ts']);
    expect(planted('globalThis.localStorage?.setItem(k, v);')).toEqual(['io/planted.ts']);
    expect(planted('// localStorage is mentioned here\n/* sessionStorage too */ const url = "https://x";')).toEqual([]);
    expect(planted('localStorage.clear();\nsessionStorage.clear();', '/repo/src/io/local-reset.ts')).toEqual([]);
    expect(planted('localStorage.removeItem(k);', '/repo/src/io/local-reset.ts')).toEqual(['io/local-reset.ts']);
  });
});

describe('stored prefs', () => {
  const denyStorage = (run: () => void): void => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')!;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() { throw new DOMException('Storage denied', 'SecurityError'); },
    });
    try { run(); } finally { Object.defineProperty(globalThis, 'localStorage', descriptor); }
  };

  it('tells an unset key from unavailable storage', () => {
    expect(readStoredPref('tourSeen')).toEqual({ available: true, raw: null });
    localStorage.setItem(PREFS.tourSeen.key, '1');
    expect(readStoredPref('tourSeen')).toEqual({ available: true, raw: '1' });
    expect(prefStorageAvailable()).toBe(true);
    denyStorage(() => {
      expect(readStoredPref('tourSeen')).toEqual({ available: false });
      expect(prefStorageAvailable()).toBe(false);
    });
  });

  it('removes a key and reports a refused removal', () => {
    writePref('autosave', 'map');
    expect(removePref('autosave')).toBe(true);
    expect(localStorage.getItem(PREFS.autosave.key)).toBeNull();
    denyStorage(() => expect(removePref('autosave')).toBe(false));
  });
});
