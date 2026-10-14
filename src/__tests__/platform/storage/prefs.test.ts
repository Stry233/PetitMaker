/**
 * Preferences are declared once. A key that is read or written anywhere in src/ but not
 * declared here is a preference nothing can enumerate, reset, or reason about.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { clampUiZoom, jsonObject, jsonPref, PREFS, prefStorageAvailable, readPref, readStoredPref, removePref, writeJsonPref, writePref } from '../../../platform/storage/prefs';
import { posix, sourceFiles as listSources, sourceText } from '../../_support/source-graph';

/** Every source file under src/, tests excluded, as { path, text }. */
function sourceFiles(): { path: string; text: string }[] {
  return listSources().map((path) => ({ path: posix(path), text: sourceText(path) }));
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
    if (path.endsWith('platform/storage/prefs.ts')) continue;
    let code = stripComments(text);
    if (path.endsWith('io/storage/local-reset.ts')) code = code.replace(/\b(?:localStorage|sessionStorage)\.clear\(\)/g, '');
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
    expect(planted('localStorage.clear();\nsessionStorage.clear();', '/repo/src/io/storage/local-reset.ts')).toEqual([]);
    expect(planted('localStorage.removeItem(k);', '/repo/src/io/storage/local-reset.ts')).toEqual(['io/storage/local-reset.ts']);
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

describe('json record prefs', () => {
  const asList = (data: unknown) => (Array.isArray(data) ? data as unknown[] : null);

  it('round-trips a record and reads an unset, non-JSON or refused one as null', () => {
    expect(jsonPref('ownImageExports', asList)).toBeNull();
    expect(writeJsonPref('ownImageExports', ['a'])).toBe(true);
    expect(jsonPref('ownImageExports', asList)).toEqual(['a']);
    localStorage.setItem(PREFS.ownImageExports.key, '{"broken');
    expect(jsonPref('ownImageExports', asList)).toBeNull();
    localStorage.setItem(PREFS.ownImageExports.key, '{"a":1}');
    expect(jsonPref('ownImageExports', asList)).toBeNull();
    expect(jsonPref('ownImageExports', jsonObject)).toEqual({ a: 1 });
  });

  it('unwraps the envelope its owner wrote, and lets a failing decode reach the caller', () => {
    writeJsonPref('customPlanets', { v: 1 }, (json) => 'env:' + json);
    expect(localStorage.getItem(PREFS.customPlanets.key)).toBe('env:{"v":1}');
    expect(jsonPref('customPlanets', jsonObject, (stored) => stored.slice(4))).toEqual({ v: 1 });
    const fault = new TypeError('decoder bug');
    expect(() => jsonPref('customPlanets', jsonObject, () => { throw fault; })).toThrow(fault);
  });

  it('accepts only plain objects as records', () => {
    expect(jsonObject([])).toBeNull();
    expect(jsonObject(null)).toBeNull();
    expect(jsonObject(3)).toBeNull();
    expect(jsonObject({ v: 1 })).toEqual({ v: 1 });
  });
});

describe('clampUiZoom', () => {
  it('leaves an in-range, already-2dp value untouched', () => {
    expect(clampUiZoom(1.05)).toBe(1.05);
  });

  it('rounds to 2 decimals then clamps to the 1.8 ceiling', () => {
    expect(clampUiZoom(1.834)).toBe(1.8);
  });

  it('clamps below the floor up to 0.6 and above the ceiling down to 1.8', () => {
    expect(clampUiZoom(0.4)).toBe(0.6);
    expect(clampUiZoom(2.5)).toBe(1.8);
  });

  it('accumulates against the target without float drift', () => {
    let t = 1.0;
    for (let i = 0; i < 5; i++) t = clampUiZoom(t + 0.1);
    expect(t).toBe(1.5);
    const result = Array.from({ length: 10 }).reduce<number>((acc) => clampUiZoom(acc + 0.1), 1.0);
    expect(result).toBeLessThanOrEqual(1.8);
    expect(result).toBe(+result.toFixed(2));
  });
});
