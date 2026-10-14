/**
 * `src/core` is the engine a port to another game keeps: plain data and functions that run the same
 * in a browser, a worker, Node and a test. It reads no browser globals, starts no timers, reads neither
 * the wall clock nor `Math.random`, touches no storage, spawns no workers and imports neither React
 * nor zustand. What still does is listed in `purity-allowlist.json`, by repository path with the
 * names it uses and its reason.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SRC, allSpecifiers, sourceFiles, srcRelative } from '../_support/source-graph';
import allowlist from './purity-allowlist.json';

const CORE = join(SRC, 'core');

/** Runtime names that exist only in a browser or tie code to the host's clock, storage or threads. */
const GLOBALS = [
  'window', 'document', 'navigator', 'location', 'screen', 'matchMedia', 'getComputedStyle',
  'localStorage', 'sessionStorage', 'indexedDB', 'caches',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame',
  'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'queueMicrotask',
  'Worker', 'SharedWorker', 'BroadcastChannel', 'MessageChannel', 'postMessage',
  'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource',
  'Image', 'OffscreenCanvas', 'createImageBitmap', 'crypto', 'performance', 'Date', 'Math.random',
] as const;

/** Packages core never imports. */
const PACKAGES = ['react', 'react-dom', 'zustand', 'framer-motion', 'three', 'pixi.js', 'pixi.js-legacy'] as const;

const ALLOW: Readonly<Record<string, { uses: string[]; reason: string }>> = allowlist;

/** `text` with comments, string literals and template literals blanked out. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g, ' ');
}

// A name read as a value: not a property access (`.window`), not a key or an optional field
// (`window:`, `window?:`), not part of a longer identifier.
const GLOBAL_RE = new RegExp(`(?<![\\w$.])(${GLOBALS.map((g) => g.replace('.', '\\.')).join('|')})\\b(?!\\s*\\??:)`, 'g');

/** Every impure use in core, as `file: name`. */
function impureUses(): Map<string, Set<string>> {
  const uses = new Map<string, Set<string>>();
  const add = (file: string, name: string): void => {
    if (!uses.has(file)) uses.set(file, new Set());
    uses.get(file)!.add(name);
  };
  for (const file of sourceFiles(CORE)) {
    const rel = `src/${srcRelative(file)}`;
    for (const m of code(readFileSync(file, 'utf8')).matchAll(GLOBAL_RE)) add(rel, m[1]!);
    for (const spec of allSpecifiers(file)) {
      const pkg = PACKAGES.find((p) => spec === p || spec.startsWith(`${p}/`));
      if (pkg) add(rel, pkg);
      if (spec.includes('?worker')) add(rel, 'Worker');
    }
  }
  return uses;
}

describe('core purity', () => {
  it('reads no browser globals, timers, clock, randomness, storage or workers and imports neither React nor zustand', () => {
    const offenders: string[] = [];
    for (const [file, names] of impureUses()) {
      const allowed = new Set(ALLOW[file]?.uses ?? []);
      for (const name of names) if (!allowed.has(name)) offenders.push(`${file}: ${name}`);
    }
    expect(offenders).toEqual([]);
  });

  it('every allowlist entry is still needed', () => {
    const uses = impureUses();
    const stale: string[] = [];
    for (const [file, entry] of Object.entries(ALLOW)) {
      for (const name of entry.uses) if (!uses.get(file)?.has(name)) stale.push(`${file}: ${name}`);
    }
    expect(stale).toEqual([]);
  });

  it('sees what it is looking for', () => {
    expect(code('const a = 1; // window\nwindow.alert("setTimeout")').match(GLOBAL_RE)).toEqual(['window']);
    expect(code('const o = { window: 3, crypto?: 1 }; o.setTimeout(); xWorker();').match(GLOBAL_RE)).toBeNull();
    expect(code('setTimeout(f, 0); new Worker(u);').match(GLOBAL_RE)).toEqual(['setTimeout', 'Worker']);
    expect(code('Date.now(); Math.random(); Math.floor(x); type T = { Date: 1 }; xDate;').match(GLOBAL_RE)).toEqual(['Date', 'Math.random']);
  });
});
