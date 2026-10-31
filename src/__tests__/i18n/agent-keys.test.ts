/**
 * Every string the assistant says, in every locale: what `parity.test.ts` set-equality cannot see.
 * The panel and the en table name exactly the same keys (a key missing from en passes parity while
 * the panel renders it raw), nothing is blank or left in English, and every `{token}` is filled by a
 * caller (an unfilled one reaches the user as literal braces in all seven locales).
 */
import { describe, it, expect } from 'vitest';
import { translations } from '../_support/locale-tables';
import { RESOLVED_TOKENS } from '../../i18n/context';
import type { Locale } from '../../core/model/locale';
import { countedBase } from '../_support/plural-keys';
import { TOOL_NAMES, skillTitleKey, toolVerbKey } from '../../agent/panel';
import { SKILLS } from '../../agent/skills';
import { SRC, posix, sourceText, walkFiles } from '../_support/source-graph';

const EN: Locale = 'en';
const locales = Object.keys(translations) as Locale[];
const agentKeys = Object.keys(translations[EN]).filter((k) => k.startsWith('agent.') && countedBase(k) === null).sort();

/** The panel's zones as key prefixes; each must stay populated, which set-equality cannot check. */
const ZONES = [
  'agent.action_', 'agent.answer_', 'agent.banner_', 'agent.composer_', 'agent.dock_', 'agent.dream_',
  'agent.gate_', 'agent.history_', 'agent.lane_', 'agent.op_', 'agent.oversight_', 'agent.setup_',
  'agent.sketch_', 'agent.stamp_', 'agent.steer_', 'agent.ticket_', 'agent.verb_',
];

/** Every source file under `src/`, tests and the locale tables excluded, as { path, text }. */
function sourceFiles(): { path: string; text: string }[] {
  return walkFiles(SRC, { skip: ['__tests__', 'locales'] }).map((path) => ({ path: posix(path), text: sourceText(path) }));
}

/** Every `agent.*` key named as a literal in the app, in any quote style: a key reaches `t()` as an
 *  argument, a JSX attribute and a table value alike. */
function referencedKeys(): Map<string, string[]> {
  const refs = new Map<string, string[]>();
  for (const { path, text } of sourceFiles()) {
    for (const m of text.matchAll(/['"`](agent\.[A-Za-z0-9_.]+)['"`]/g)) {
      const at = refs.get(m[1]!) ?? [];
      if (!at.includes(path)) at.push(path);
      refs.set(m[1]!, at);
    }
  }
  return refs;
}

/** The argument text of every `t`, `translate` and `translateFor` call, cut by a balanced-paren scan
 *  because the params object defeats a regex. */
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

/** The top-level property names of the last object literal in a call's arguments (the params bag),
 *  matched by brace depth so a template literal's `${...}` inside it does not end the scan.
 *  Shorthand (`{ n, shown }`) counts, and a spread contributes nothing it can be read from. */
function paramNames(args: string): string[] {
  const close = args.lastIndexOf('}');
  let open = close;
  for (let depth = 0; open >= 0; open--) {
    if (args[open] === '}') depth++;
    else if (args[open] === '{' && --depth === 0) break;
  }
  if (close === -1 || open < 0) return [];
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

/** Which params each key is passed, where the key stands as a literal in the same call. */
function passedParams(): Map<string, Set<string>> {
  const passed = new Map<string, Set<string>>();
  for (const { text } of sourceFiles()) {
    for (const args of callArgs(text)) {
      const keys = [...args.matchAll(/['"`](agent\.[A-Za-z0-9_.]+)['"`]/g)].map((x) => x[1]!);
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

/** The tokens a caller must pass: the translator fills `RESOLVED_TOKENS` itself. */
const tokensOf = (s: string): string[] =>
  [...new Set([...s.matchAll(/\{([a-z]+)\}/g)].map((m) => m[1]!))].filter((t) => !(t in RESOLVED_TOKENS)).sort();

/**
 * Keys whose tokens are filled without a call naming them; a new param-bearing key needs a call site
 * or a line here. `node`: the caller splits the template on the placeholder and renders the value as
 * its own DOM leaf (`desk-face.ts:splitOnToken`, `OpRow.withFragment`). `table`: the key is a
 * lookup-table value reaching `t()` as a variable.
 */
const INDIRECT: Record<string, 'node' | 'table'> = {
  'agent.dock_retrying': 'node',
  'agent.op_detail_put_back': 'node',
  'agent.op_detail_sent_back': 'node',
  'agent.banner_model': 'table',
  'agent.setup_manage_clear_q': 'table',
  'agent.setup_manage_clear_pause_q': 'table',
  'agent.dock_setup_shaped': 'table',
  'agent.gate_verdict_quick': 'table',
  'agent.sketch_bridge_cap': 'table',
  'agent.sketch_bridge_order': 'table',
  'agent.sketch_grove_cap': 'table',
  'agent.sketch_grove_order': 'table',
  'agent.sketch_lane_cap': 'table',
  'agent.sketch_lane_order': 'table',
  'agent.sketch_pond_cap': 'table',
  'agent.sketch_pond_order': 'table',
};

describe('the assistant panel speaks every locale', () => {
  it('has panel keys at all, and one per zone', () => {
    expect(agentKeys.length).toBeGreaterThan(0);
    for (const zone of ZONES) {
      expect(agentKeys.filter((k) => k.startsWith(zone)).length, `no keys under ${zone}`).toBeGreaterThan(0);
    }
  });

  it('names the same keys in the table and in the panel, both ways', () => {
    const refs = referencedKeys();
    // Tool verb and skill title keys are composed at runtime, so they are named here.
    for (const name of TOOL_NAMES) refs.set(toolVerbKey(name), ['toolVerbKey']);
    for (const name of Object.keys(SKILLS)) refs.set(skillTitleKey(name) ?? `missing title key: ${name}`, ['skillTitleKey']);
    const undefinedKeys = [...refs.keys()].filter((k) => translations[EN][k] === undefined).sort();
    const unread = agentKeys.filter((k) => !refs.has(k));
    expect({ undefinedKeys, unread }).toEqual({ undefinedKeys: [], unread: [] });
  });

  it('defines every agent key in all seven locales, with nothing blank', () => {
    for (const loc of locales) {
      const missing = agentKeys.filter((k) => translations[loc][k] === undefined);
      const blank = agentKeys.filter((k) => (translations[loc][k] ?? '').trim() === '');
      expect({ locale: loc, missing, blank }).toEqual({ locale: loc, missing: [], blank: [] });
    }
  });

  /** Only prose is held: English with a space and a letter outside its placeholders. A brand or a
   *  bare number may stay the same word everywhere. */
  it('translates the sentences rather than carrying the English through', () => {
    const prose = agentKeys.filter((k) => {
      const english = translations[EN][k] ?? '';
      return english.includes(' ') && /\p{L}/u.test(english.replace(/\{[^}]*\}/g, ''));
    });
    for (const loc of locales) {
      if (loc === EN) continue;
      const untranslated = prose.filter((k) => translations[loc][k] === translations[EN][k]);
      expect({ locale: loc, untranslated }).toEqual({ locale: loc, untranslated: [] });
    }
  });

  it('fills every {token} it declares, or declares why it cannot', () => {
    const passed = passedParams();
    const gaps = agentKeys
      .filter((k) => tokensOf(translations[EN][k] ?? '').length > 0 && INDIRECT[k] === undefined)
      .map((k) => {
        const got = passed.get(k) ?? new Set<string>();
        const missing = tokensOf(translations[EN][k]!).filter((tok) => !got.has(tok));
        return missing.length ? `${k}: {${missing.join('} {')}}` : null;
      })
      .filter((x): x is string => x !== null);
    expect(gaps).toEqual([]);
  });

  /** An entry whose key is gone, or whose tokens a call site passes, is stale. */
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
