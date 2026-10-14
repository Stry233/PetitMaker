/**
 * Every string the assistant says, in every locale.
 *
 * `parity.test.ts` already holds each locale's key set equal to en's (and each key's `{token}` set
 * equal to en's), which catches a key added to one file and forgotten in six. The questions here are
 * the ones set-equality cannot answer:
 *
 *  - the panel and the table name the same keys. A key nobody added is missing from en too, so
 *    parity passes while the panel renders the raw key; a key nothing reads is a string that will be
 *    translated seven times, reviewed, measured and never seen. Both directions are asserted, so the
 *    two sets are held identical rather than one merely covering the other.
 *  - nothing is blank, and no value carries the two punctuation marks the house style forbids.
 *  - every           is actually filled. A placeholder no caller passes reaches the user as literal
 *    braces, and parity cannot see it: all seven locales carry the same unfilled token.
 *
 * Shaped after `parity.test.ts`: en is the source of truth and the other six are read against it.
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

/** The panel's zones, as key prefixes. A zone that lost every key it had would still pass a
 *  set-equality check, so each one is asserted to be populated. */
const ZONES = [
  'agent.action_', 'agent.answer_', 'agent.banner_', 'agent.composer_', 'agent.dock_', 'agent.dream_',
  'agent.gate_', 'agent.history_', 'agent.lane_', 'agent.op_', 'agent.oversight_', 'agent.setup_',
  'agent.sketch_', 'agent.stamp_', 'agent.steer_', 'agent.ticket_', 'agent.verb_',
];

/** Every source file under `src/`, tests and the locale tables excluded, as { path, text }. */
function sourceFiles(): { path: string; text: string }[] {
  return walkFiles(SRC, { skip: ['__tests__', 'locales'] }).map((path) => ({ path: posix(path), text: sourceText(path) }));
}

/** Every `agent.*` key named as a literal anywhere in the app. Three quote styles, because a key
 *  reaches `t()` as an argument, a JSX attribute (`approveKey="agent.gate_approve"`) and a table
 *  value alike. */
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
 * Keys whose tokens are filled without a call naming them, exempt from the coverage assertion
 * above; a new param-bearing key needs a call site or a line here.
 *
 * `node`: the caller splits the template on the placeholder and renders the value as its own DOM
 * leaf, so a ticking number does not re-render the sentence (`DeskHeader.splitOnToken`,
 * `OpRow.withFragment`). `table`: the key is a lookup-table value reaching `t()` as a variable.
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
    // Operation names are composed per tool by `toolVerbKey`, so each tool reads its own key.
    for (const name of TOOL_NAMES) refs.set(toolVerbKey(name), ['toolVerbKey']);
    // Skill titles are composed per skill by `skillTitleKey` the same way.
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

  /** A translation identical to the English is a key that was copied rather than translated. Not an
   *  error in itself — a brand, a protocol name or a bare number is the same word everywhere — so
   *  this only holds the ones that are prose, taken as anything with a space in the English that
   *  holds a letter outside its placeholders (`{phase} {clock}` and `{helper}: {summary}` have no
   *  words to translate). */
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

  /** The declared blind spot stays honest: an entry whose key is gone, or whose tokens are passed by
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
