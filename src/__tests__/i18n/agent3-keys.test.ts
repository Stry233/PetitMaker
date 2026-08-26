/**
 * Every string the assistant panel says, in every locale.
 *
 * `parity.test.ts` already holds each locale's key SET equal to en's (and each key's `{token}` set
 * equal to en's), which catches a key added to one file and forgotten in six. The questions here are
 * the ones set-equality cannot answer:
 *
 *  - THE PANEL AND THE TABLE NAME THE SAME KEYS. A key nobody added is missing from en too, so
 *    parity passes while the panel renders the raw key; a key nothing reads is a string that will be
 *    translated seven times, reviewed, measured and never seen. Both directions are asserted, so the
 *    two sets are held IDENTICAL rather than one merely covering the other.
 *  - NOTHING IS BLANK, and no value carries the two punctuation marks the house style forbids.
 *  - EVERY `{token}` IS ACTUALLY FILLED. A placeholder no caller passes reaches the user as literal
 *    braces, and parity cannot see it: all seven locales carry the same unfilled token.
 *
 * Shaped after `parity.test.ts`: en is the source of truth and the other six are read against it.
 */
import { describe, it, expect } from 'vitest';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readFileSync, readdirSync, statSync } from 'node:fs';
// @ts-ignore - node:path is untyped here (no @types/node)
import { join, resolve } from 'node:path';
import { translations } from '../../i18n/translations';
import type { Locale } from '../../core/model/types';

declare const __dirname: string;

const EN: Locale = 'en';
const locales = Object.keys(translations) as Locale[];
const agent3Keys = Object.keys(translations[EN]).filter((k) => k.startsWith('agent3.')).sort();

/** The panel's zones, as key PREFIXES. A zone that lost every key it had would still pass a
 *  set-equality check, so each one is asserted to be populated. */
const ZONES = [
  'agent3.action_', 'agent3.answer_', 'agent3.banner_', 'agent3.composer_', 'agent3.dock_', 'agent3.dream_',
  'agent3.gate_', 'agent3.history_', 'agent3.lane_', 'agent3.op_', 'agent3.oversight_', 'agent3.setup_',
  'agent3.sketch_', 'agent3.stamp_', 'agent3.steer_', 'agent3.ticket_', 'agent3.verb_',
];

/** Every source file under `src/`, tests and the locale tables excluded, as { path, text }. */
function sourceFiles(): { path: string; text: string }[] {
  const src = resolve(__dirname, '../..');
  const out: { path: string; text: string }[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) { if (name !== '__tests__' && name !== 'locales') walk(full); }
      else if (/\.tsx?$/.test(name)) out.push({ path: full.replace(/\\/g, '/'), text: readFileSync(full, 'utf8') });
    }
  };
  walk(src);
  return out;
}

/** Every `agent3.*` key named as a literal anywhere in the app. Three quote styles, because a key
 *  reaches `t()` as an argument, a JSX attribute (`approveKey="agent3.gate_approve"`) and a table
 *  value alike. */
function referencedKeys(): Map<string, string[]> {
  const refs = new Map<string, string[]>();
  for (const { path, text } of sourceFiles()) {
    for (const m of text.matchAll(/['"`](agent3\.[A-Za-z0-9_]+)['"`]/g)) {
      const at = refs.get(m[1]!) ?? [];
      if (!at.includes(path)) at.push(path);
      refs.set(m[1]!, at);
    }
  }
  return refs;
}

/**
 * The argument text of every `t(...)` / `translate(...)` / `translateFor(...)` call in a file, cut by
 * a balanced-paren scan rather than a regex: the second argument is an object literal, so a
 * non-greedy match ends at the first `}` inside it and a greedy one swallows the rest of the line.
 */
function callArgs(text: string): string[] {
  const out: string[] = [];
  const re = /\b(?:t|translate|translateFor)\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < text.length && depth > 0; i++) {
      const c = text[i];
      if (c === '(') depth++;
      else if (c === ')') depth--;
    }
    out.push(text.slice(m.index + m[0].length, i - 1));
  }
  return out;
}

/** The top-level property names of the LAST object literal in a call's arguments (the params bag).
 *  Shorthand (`{ n, shown }`) counts, and a spread contributes nothing it can be read from. */
function paramNames(args: string): string[] {
  const open = args.lastIndexOf('{');
  const close = args.lastIndexOf('}');
  if (open === -1 || close < open) return [];
  const body = args.slice(open + 1, close);
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const c of body) {
    if ('({['.includes(c)) depth++;
    else if (')}]'.includes(c)) depth--;
    if (c === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += c;
  }
  parts.push(cur);
  return parts
    .map((p) => p.trim().split(':')[0]!.trim())
    .filter((n) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(n));
}

/** Which params each key is passed, where the key stands as a LITERAL in the same call. */
function passedParams(): Map<string, Set<string>> {
  const passed = new Map<string, Set<string>>();
  for (const { text } of sourceFiles()) {
    for (const args of callArgs(text)) {
      const keys = [...args.matchAll(/['"`](agent3\.[A-Za-z0-9_]+)['"`]/g)].map((x) => x[1]!);
      if (keys.length === 0) continue;
      const names = paramNames(args);
      for (const k of keys) {
        const got = passed.get(k) ?? new Set<string>();
        for (const n of names) got.add(n);
        passed.set(k, got);
      }
    }
  }
  return passed;
}

const tokensOf = (s: string): string[] => [...new Set([...s.matchAll(/\{([a-z]+)\}/g)].map((m) => m[1]!))].sort();

/**
 * THE TWO WAYS A TOKEN IS FILLED WITHOUT A CALL THAT NAMES IT, and the blind spot this test declares
 * rather than hides. A key here is exempt from the coverage assertion above; a NEW param-bearing key
 * is not, so adding one means either a call site that passes its tokens or a line here saying why
 * there cannot be.
 *
 * `node`: the placeholder is deliberately NOT interpolated. The caller splits the template on it and
 * renders the value as its own DOM leaf, which is what keeps a ticking number (or a bolded fragment)
 * from re-rendering the sentence around it — see `DeskHeader.splitOnToken` and `OpRow.withFragment`.
 *
 * `table`: the key is a value in a lookup table (a dock face's `word`/`meta`, a gate verdict, a
 * sketch idea's `capKey`/`orderKey`) and reaches `t()` as a variable, so no call site names it.
 */
const INDIRECT: Record<string, 'node' | 'table'> = {
  'agent3.dock_retrying': 'node',
  'agent3.op_detail_put_back': 'node',
  'agent3.op_detail_sent_back': 'node',
  'agent3.banner_model': 'table',
  'agent3.dock_setup_confirmed': 'table',
  'agent3.dock_setup_shaped': 'table',
  'agent3.gate_verdict_quick': 'table',
  'agent3.sketch_bridge_cap': 'table',
  'agent3.sketch_bridge_order': 'table',
  'agent3.sketch_grove_cap': 'table',
  'agent3.sketch_grove_order': 'table',
  'agent3.sketch_lane_cap': 'table',
  'agent3.sketch_lane_order': 'table',
  'agent3.sketch_pond_cap': 'table',
  'agent3.sketch_pond_order': 'table',
};

describe('the assistant panel speaks every locale', () => {
  it('has panel keys at all, and one per zone', () => {
    expect(agent3Keys.length).toBeGreaterThan(0);
    for (const zone of ZONES) {
      expect(agent3Keys.filter((k) => k.startsWith(zone)).length, `no keys under ${zone}`).toBeGreaterThan(0);
    }
  });

  it('names the same keys in the table and in the panel, both ways', () => {
    const refs = referencedKeys();
    const undefinedKeys = [...refs.keys()].filter((k) => translations[EN][k] === undefined).sort();
    const unread = agent3Keys.filter((k) => !refs.has(k));
    expect({ undefinedKeys, unread }).toEqual({ undefinedKeys: [], unread: [] });
  });

  it('defines every agent3 key in all seven locales, with nothing blank', () => {
    for (const loc of locales) {
      const missing = agent3Keys.filter((k) => translations[loc][k] === undefined);
      const blank = agent3Keys.filter((k) => (translations[loc][k] ?? '').trim() === '');
      expect({ locale: loc, missing, blank }).toEqual({ locale: loc, missing: [], blank: [] });
    }
  });

  /** A translation identical to the English is a key that was copied rather than translated. Not an
   *  error in itself — a brand, a protocol name or a bare number is the same word everywhere — so
   *  this only holds the ones that are PROSE, taken as anything with a space in the English. */
  it('translates the sentences rather than carrying the English through', () => {
    const prose = agent3Keys.filter((k) => (translations[EN][k] ?? '').includes(' '));
    for (const loc of locales) {
      if (loc === EN) continue;
      const untranslated = prose.filter((k) => translations[loc][k] === translations[EN][k]);
      expect({ locale: loc, untranslated }).toEqual({ locale: loc, untranslated: [] });
    }
  });

  it('carries no em dash and no dot separator in any locale', () => {
    for (const loc of locales) {
      const offenders = agent3Keys.filter((k) => /[—·•]/.test(translations[loc][k] ?? ''));
      expect({ locale: loc, offenders }).toEqual({ locale: loc, offenders: [] });
    }
  });

  it('fills every {token} it declares, or declares why it cannot', () => {
    const passed = passedParams();
    const gaps = agent3Keys
      .filter((k) => tokensOf(translations[EN][k] ?? '').length > 0 && INDIRECT[k] === undefined)
      .map((k) => {
        const got = passed.get(k) ?? new Set<string>();
        const missing = tokensOf(translations[EN][k]!).filter((tok) => !got.has(tok));
        return missing.length ? `${k}: {${missing.join('} {')}}` : null;
      })
      .filter((x): x is string => x !== null);
    expect(gaps).toEqual([]);
  });

  /** The declared blind spot stays honest: an entry whose key is gone, or whose tokens ARE passed by
   *  a call site now, is a line that has stopped saying anything true. */
  it('keeps the indirect list to keys that are really indirect', () => {
    const passed = passedParams();
    const stale = Object.keys(INDIRECT).filter((k) => {
      if (translations[EN][k] === undefined) return true;
      const got = passed.get(k) ?? new Set<string>();
      return tokensOf(translations[EN][k]!).every((tok) => got.has(tok));
    });
    expect(stale).toEqual([]);
  });
});
