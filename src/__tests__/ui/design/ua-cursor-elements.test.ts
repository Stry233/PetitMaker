/**
 * `cursors.css` must name every element a browser's own stylesheet gives a cursor to.
 *
 * `cursor` is inherited, so the `html` rule covers the whole page — except on an element whose UA
 * stylesheet declares a cursor ITSELF, because a UA declaration on the element beats any value
 * inherited from an ancestor. Those elements are the entire coverage problem, and the list of them
 * cannot be reasoned out: it is whatever two shipping engines happen to declare, it differs between
 * them, and a sheet read by eye lets `label` (Firefox: `label { cursor: default }`) stay OS-
 * drawn behind every field caption in the export modals.
 *
 * ── How UA_STYLED was derived, and how to re-derive it ──────────────────────────────────────────
 * A throwaway page renders one probe of every HTML element that can carry a cursor — sectioning,
 * text, grouping, table and list elements, every interactive element, every `input[type]`, `a` with
 * and without `href`, `[contenteditable]`, `[role]`, `[aria-disabled]`, and a disabled variant of
 * every form control — sets ONE distinctive `cursor: url("data:…")` on `html` and nothing else, and
 * reads `getComputedStyle(el).cursor` for each. Anything that does not compute to that distinctive
 * value has a UA declaration on it, and is a row below.
 *
 * Run it in BOTH engines (a headless Firefox and a headless Chromium-family browser), POST the
 * results back to a local server, and take the UNION: `gecko` and `blink` below are what each one
 * answered, `null` where that engine left the element inheriting. To update this table, re-run that
 * enumeration on current browsers rather than adding a row by inspection.
 *
 * Elements the enumeration flagged that are absent: `track` and `input[type="hidden"]` generate no
 * box, so no pointer is ever over them and the value read back is a computed property on an
 * unrendered element rather than a cursor a user can see.
 */
import { describe, it, expect } from 'vitest';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readFileSync } from 'node:fs';
import { DOM_CURSORS, type DomCursorId } from '../../../core/runtime/cursor-spec';

declare const process: { cwd(): string };

const SHEET = readFileSync(`${process.cwd()}/src/ui/design/cursors/cursors.css`, 'utf8');

interface UaElement {
  /** The probe's name in the enumeration harness. */
  readonly probe: string;
  /** Markup for the probe, including whatever parent the element needs to keep its UA behaviour. */
  readonly html: string;
  /** What Gecko computed, or null where it left the element inheriting. */
  readonly gecko: string | null;
  /** What Blink computed, or null where it left the element inheriting. */
  readonly blink: string | null;
  /** The id our sheet must resolve it to. */
  readonly ours: DomCursorId;
}

/** Derived from Firefox 152 (Gecko) and Edge 150 (Blink) on 2026-07-28. See the header. */
const UA_STYLED: readonly UaElement[] = [
  { probe: 'select',                               html: '<select data-p><option>x</option></select>',
    gecko: 'default', blink: 'default', ours: 'clickable' },
  { probe: 'optgroup',                             html: '<select><optgroup data-p label="g"><option>x</option></optgroup></select>',
    gecko: 'default', blink: 'default', ours: 'default' },
  { probe: 'option',                               html: '<select><option data-p>x</option></select>',
    gecko: 'default', blink: 'default', ours: 'clickable' },
  { probe: 'textarea',                             html: '<textarea data-p></textarea>',
    gecko: 'text', blink: 'text', ours: 'text' },
  { probe: 'button',                               html: '<button data-p>x</button>',
    gecko: 'default', blink: 'default', ours: 'clickable' },
  { probe: 'label',                                html: '<label data-p>x</label>',
    gecko: 'default', blink: 'default', ours: 'default' },
  { probe: 'a[href]',                              html: '<a data-p href="#x">x</a>',
    gecko: 'pointer', blink: 'pointer', ours: 'clickable' },
  { probe: 'input[type=button]',                   html: '<input data-p type="button">',
    gecko: 'default', blink: 'default', ours: 'clickable' },
  { probe: 'input[type=button]:disabled',          html: '<input data-p type="button" disabled>',
    gecko: null, blink: 'default', ours: 'blocked' },
  { probe: 'input[type=checkbox]',                 html: '<input data-p type="checkbox">',
    gecko: 'default', blink: 'default', ours: 'clickable' },
  { probe: 'input[type=checkbox]:disabled',        html: '<input data-p type="checkbox" disabled>',
    gecko: null, blink: 'default', ours: 'blocked' },
  { probe: 'input[type=color]',                    html: '<input data-p type="color">',
    gecko: 'default', blink: 'default', ours: 'clickable' },
  { probe: 'input[type=color]:disabled',           html: '<input data-p type="color" disabled>',
    gecko: null, blink: 'default', ours: 'blocked' },
  { probe: 'input[type=date]',                     html: '<input data-p type="date">',
    gecko: 'default', blink: 'default', ours: 'default' },
  { probe: 'input[type=date]:disabled',            html: '<input data-p type="date" disabled>',
    gecko: 'default', blink: 'default', ours: 'blocked' },
  { probe: 'input[type=datetime-local]',           html: '<input data-p type="datetime-local">',
    gecko: 'default', blink: 'default', ours: 'default' },
  { probe: 'input[type=datetime-local]:disabled',  html: '<input data-p type="datetime-local" disabled>',
    gecko: 'default', blink: 'default', ours: 'blocked' },
  { probe: 'input[type=email]',                    html: '<input data-p type="email">',
    gecko: 'text', blink: 'text', ours: 'text' },
  { probe: 'input[type=email]:disabled',           html: '<input data-p type="email" disabled>',
    gecko: 'default', blink: 'default', ours: 'blocked' },
  { probe: 'input[type=file]',                     html: '<input data-p type="file">',
    gecko: 'default', blink: 'default', ours: 'clickable' },
  { probe: 'input[type=file]:disabled',            html: '<input data-p type="file" disabled>',
    gecko: 'default', blink: 'default', ours: 'blocked' },
  { probe: 'input[type=image]',                    html: '<input data-p type="image">',
    gecko: 'pointer', blink: 'pointer', ours: 'clickable' },
  { probe: 'input[type=image]:disabled',           html: '<input data-p type="image" disabled>',
    gecko: null, blink: 'default', ours: 'blocked' },
  { probe: 'input[type=month]',                    html: '<input data-p type="month">',
    gecko: 'text', blink: 'default', ours: 'default' },
  { probe: 'input[type=month]:disabled',           html: '<input data-p type="month" disabled>',
    gecko: 'default', blink: 'default', ours: 'blocked' },
  { probe: 'input[type=number]',                   html: '<input data-p type="number">',
    gecko: 'text', blink: 'text', ours: 'text' },
  { probe: 'input[type=number]:disabled',          html: '<input data-p type="number" disabled>',
    gecko: 'default', blink: 'default', ours: 'blocked' },
  { probe: 'input[type=password]',                 html: '<input data-p type="password">',
    gecko: 'text', blink: 'text', ours: 'text' },
  { probe: 'input[type=password]:disabled',        html: '<input data-p type="password" disabled>',
    gecko: 'default', blink: 'default', ours: 'blocked' },
  { probe: 'input[type=radio]',                    html: '<input data-p type="radio">',
    gecko: 'default', blink: 'default', ours: 'clickable' },
  { probe: 'input[type=radio]:disabled',           html: '<input data-p type="radio" disabled>',
    gecko: null, blink: 'default', ours: 'blocked' },
  { probe: 'input[type=range]',                    html: '<input data-p type="range">',
    gecko: 'default', blink: 'default', ours: 'clickable' },
  { probe: 'input[type=range]:disabled',           html: '<input data-p type="range" disabled>',
    gecko: 'default', blink: 'default', ours: 'blocked' },
  { probe: 'input[type=reset]',                    html: '<input data-p type="reset">',
    gecko: 'default', blink: 'default', ours: 'clickable' },
  { probe: 'input[type=reset]:disabled',           html: '<input data-p type="reset" disabled>',
    gecko: null, blink: 'default', ours: 'blocked' },
  { probe: 'input[type=search]',                   html: '<input data-p type="search">',
    gecko: 'text', blink: 'text', ours: 'text' },
  { probe: 'input[type=search]:disabled',          html: '<input data-p type="search" disabled>',
    gecko: 'default', blink: 'default', ours: 'blocked' },
  { probe: 'input[type=submit]',                   html: '<input data-p type="submit">',
    gecko: 'default', blink: 'default', ours: 'clickable' },
  { probe: 'input[type=submit]:disabled',          html: '<input data-p type="submit" disabled>',
    gecko: null, blink: 'default', ours: 'blocked' },
  { probe: 'input[type=tel]',                      html: '<input data-p type="tel">',
    gecko: 'text', blink: 'text', ours: 'text' },
  { probe: 'input[type=tel]:disabled',             html: '<input data-p type="tel" disabled>',
    gecko: 'default', blink: 'default', ours: 'blocked' },
  { probe: 'input[type=text]',                     html: '<input data-p type="text">',
    gecko: 'text', blink: 'text', ours: 'text' },
  { probe: 'input[type=text]:disabled',            html: '<input data-p type="text" disabled>',
    gecko: 'default', blink: 'default', ours: 'blocked' },
  { probe: 'input[type=time]',                     html: '<input data-p type="time">',
    gecko: 'default', blink: 'default', ours: 'default' },
  { probe: 'input[type=time]:disabled',            html: '<input data-p type="time" disabled>',
    gecko: 'default', blink: 'default', ours: 'blocked' },
  { probe: 'input[type=url]',                      html: '<input data-p type="url">',
    gecko: 'text', blink: 'text', ours: 'text' },
  { probe: 'input[type=url]:disabled',             html: '<input data-p type="url" disabled>',
    gecko: 'default', blink: 'default', ours: 'blocked' },
  { probe: 'input[type=week]',                     html: '<input data-p type="week">',
    gecko: 'text', blink: 'default', ours: 'default' },
  { probe: 'input[type=week]:disabled',            html: '<input data-p type="week" disabled>',
    gecko: 'default', blink: 'default', ours: 'blocked' },
  { probe: 'input (no type)',                      html: '<input data-p>',
    gecko: 'text', blink: 'text', ours: 'text' },
  { probe: 'input[readonly]',                      html: '<input data-p readonly>',
    gecko: 'text', blink: 'text', ours: 'text' },
  { probe: 'button:disabled',                      html: '<button data-p disabled>x</button>',
    gecko: null, blink: 'default', ours: 'blocked' },
  { probe: 'textarea:disabled',                    html: '<textarea data-p disabled></textarea>',
    gecko: 'default', blink: 'default', ours: 'blocked' },
  { probe: 'textarea[readonly]',                   html: '<textarea data-p readonly></textarea>',
    gecko: 'text', blink: 'text', ours: 'text' },
  { probe: 'select:disabled',                      html: '<select data-p disabled><option>x</option></select>',
    gecko: null, blink: 'default', ours: 'blocked' },
  { probe: 'select[multiple]',                     html: '<select data-p multiple><option>x</option></select>',
    gecko: 'default', blink: 'default', ours: 'clickable' },
  { probe: 'option:disabled',                      html: '<select><option data-p disabled>x</option></select>',
    gecko: 'default', blink: 'default', ours: 'blocked' },
  { probe: 'optgroup:disabled',                    html: '<select><optgroup data-p disabled label="g"><option>x</option></optgroup></select>',
    gecko: 'default', blink: 'default', ours: 'blocked' },
  { probe: 'button in disabled fieldset',          html: '<fieldset disabled><button data-p>x</button></fieldset>',
    gecko: null, blink: 'default', ours: 'blocked' },
  { probe: 'input in disabled fieldset',           html: '<fieldset disabled><input data-p></fieldset>',
    gecko: 'default', blink: 'default', ours: 'blocked' },
  { probe: 'label wrapping checkbox',              html: '<label data-p><input type="checkbox">x</label>',
    gecko: 'default', blink: 'default', ours: 'clickable' },
  { probe: 'label wrapping radio',                 html: '<label data-p><input type="radio">x</label>',
    gecko: 'default', blink: 'default', ours: 'clickable' },
  { probe: 'label wrapping text input',            html: '<label data-p><input type="text">x</label>',
    gecko: 'default', blink: 'default', ours: 'default' },
  { probe: 'label[for]',                           html: '<label data-p for="zz">x</label>',
    gecko: 'default', blink: 'default', ours: 'default' },
];

// ── The sheet, read as the browser reads it ─────────────────────────────────────────────────────

interface SheetRule { readonly selectors: readonly string[]; readonly id: DomCursorId }

/** Split a selector list on its TOP-level commas, so a comma inside `:has(…)` cannot cut one. */
function splitList(list: string): string[] {
  const out: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i]!;
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) { out.push(list.slice(start, i)); start = i + 1; }
  }
  out.push(list.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}

/** Every rule in the sheet that declares a cursor, in source order. */
function parseSheet(css: string): SheetRule[] {
  const byProperty = new Map(
    (Object.keys(DOM_CURSORS) as DomCursorId[]).map((id) => [DOM_CURSORS[id] as string, id]),
  );
  const rules: SheetRule[] = [];
  for (const block of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decl = /cursor\s*:\s*var\(\s*(--[a-z-]+)\s*,/.exec(block[2]!);
    if (!decl) continue;
    const id = byProperty.get(decl[1]!);
    // A rule pointing at a property nobody publishes resolves to its keyword fallback forever,
    // which is the OS cursor the whole system exists to replace.
    if (!id) throw new Error(`cursors.css reads an unpublished property: ${decl[1]}`);
    rules.push({ selectors: splitList(block[1]!), id });
  }
  return rules;
}

type Spec = readonly [number, number, number];

/** Strictly more specific: ids, then classes/attributes/pseudo-classes, then element names. */
const higher = (a: Spec, b: Spec): boolean => (a[0] - b[0] || a[1] - b[1] || a[2] - b[2]) > 0;

/** …or equal, which source order then settles in favour of the later rule. */
const atLeast = (a: Spec, b: Spec): boolean => (a[0] - b[0] || a[1] - b[1] || a[2] - b[2]) >= 0;

const nameEnd = (s: string, i: number): number => {
  while (i < s.length && /[\w-]/.test(s[i]!)) i++;
  return i;
};

/**
 * Specificity of one compound selector, per Selectors 4.
 *
 * Only compound selectors are supported, which is all this sheet uses; a combinator throws rather
 * than being silently mis-scored, because a wrong score would make this file agree with a cascade
 * no browser performs.
 */
function specificity(sel: string): Spec {
  if (/[\s>+~]/.test(sel.replace(/\([^)]*\)/g, ''))) throw new Error(`not a compound selector: ${sel}`);
  let a = 0, b = 0, c = 0, i = 0;
  while (i < sel.length) {
    const ch = sel[i]!;
    if (ch === '#') { a++; i = nameEnd(sel, i + 1); }
    else if (ch === '.') { b++; i = nameEnd(sel, i + 1); }
    else if (ch === '[') { b++; i = sel.indexOf(']', i) + 1; }
    else if (ch === '*') { i++; }
    else if (ch === ':') {
      if (sel[i + 1] === ':') { c++; i = nameEnd(sel, i + 2); continue; }
      const from = i + 1;
      let j = nameEnd(sel, from);
      const name = sel.slice(from, j);
      if (sel[j] !== '(') { b++; i = j; continue; }
      let depth = 0, k = j;
      for (; k < sel.length; k++) { if (sel[k] === '(') depth++; else if (sel[k] === ')' && --depth === 0) break; }
      const inner = sel.slice(j + 1, k);
      j = k + 1;
      // `:has()`, `:is()` and `:not()` take the specificity of their most specific argument;
      // `:where()` contributes none.
      if (name === 'has' || name === 'is' || name === 'not') {
        let best: Spec = [0, 0, 0];
        for (const part of splitList(inner)) {
          const s = specificity(part);
          if (higher(s, best)) best = s;
        }
        a += best[0]; b += best[1]; c += best[2];
      } else if (name !== 'where') b++;
      i = j;
    } else { c++; i = nameEnd(sel, i); }
  }
  return [a, b, c];
}

/** The rule a browser would apply: highest specificity, source order breaking a tie. */
function winner(el: Element, rules: readonly SheetRule[]): DomCursorId | null {
  let bestId: DomCursorId | null = null;
  let best: Spec = [-1, -1, -1];
  for (const rule of rules) {
    for (const sel of rule.selectors) {
      if (!el.matches(sel)) continue;
      const s = specificity(sel);
      if (atLeast(s, best)) { best = s; bestId = rule.id; }
    }
  }
  return bestId;
}

const RULES = parseSheet(SHEET);

/** The probe element itself, marked with `data-p`, mounted so ancestor selectors work. */
function probeElement(html: string): Element {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  const el = host.querySelector('[data-p]');
  if (!el) throw new Error(`probe markup has no [data-p]: ${html}`);
  return el;
}

describe('the elements a UA stylesheet gives a cursor to', () => {
  it('is a derived list, not a handful of guesses', () => {
    // The lower bound catches an incomplete derived table; `label` covers a commonly missed case.
    expect(UA_STYLED.length).toBeGreaterThanOrEqual(64);
    expect(UA_STYLED.map((e) => e.probe)).toContain('label');
    expect(new Set(UA_STYLED.map((e) => e.probe)).size).toBe(UA_STYLED.length);
    // Every row must be a real finding: at least one engine declared a cursor on it.
    for (const e of UA_STYLED) {
      expect(e.gecko !== null || e.blink !== null, `${e.probe} is in the table but neither engine styles it`).toBe(true);
    }
  });

  it('parses cursors.css into rules that all point at published properties', () => {
    expect(RULES.length).toBeGreaterThan(5);
    // The page default, which is what covers every surface no rule below names.
    expect(RULES[0]).toEqual({ selectors: ['html'], id: 'default' });
  });

  it('is named in full by cursors.css', () => {
    const unnamed = UA_STYLED.filter((e) => winner(probeElement(e.html), RULES) === null);
    // An element left out keeps the OS glyph on that control, whatever the rest of the sheet says.
    expect(unnamed.map((e) => `${e.probe} (gecko: ${e.gecko}, blink: ${e.blink})`)).toEqual([]);
  });

  it('resolves each one to the cursor it is meant to have', () => {
    const wrong: string[] = [];
    for (const e of UA_STYLED) {
      const got = winner(probeElement(e.html), RULES);
      if (got !== e.ours) wrong.push(`${e.probe}: expected ${e.ours}, sheet gives ${got}`);
    }
    expect(wrong).toEqual([]);
  });
});

describe('the disabled backstop', () => {
  /** `disabled` is only an attribute on form controls; `'disabled' in el` is exactly that set. */
  const disableable = UA_STYLED.filter((e) => e.ours !== 'blocked' && 'disabled' in probeElement(e.html));

  it('covers a control this sheet would otherwise call clickable or text', () => {
    expect(disableable.length).toBeGreaterThan(20);
    const wrong: string[] = [];
    for (const e of disableable) {
      const el = probeElement(e.html);
      el.setAttribute('disabled', '');
      const got = winner(el, RULES);
      if (got !== 'blocked') wrong.push(`${e.probe} disabled: sheet gives ${got}`);
    }
    expect(wrong).toEqual([]);
  });

  it('outranks every rule above it, rather than only tying with them', () => {
    // Source order settles a tie, so a rule ABOVE with higher specificity would beat the backstop
    // and pin the enabled cursor onto a control that is refusing. `aria-disabled` is meaningful on
    // a widget or a link, so that is the set swept; `<label>` carries no role that supports it.
    const aria = UA_STYLED.filter((e) => probeElement(e.html).matches('button, input, select, textarea, option, optgroup, a[href]'));
    expect(aria.length).toBeGreaterThan(20);
    const wrong: string[] = [];
    for (const e of aria) {
      const el = probeElement(e.html);
      el.setAttribute('aria-disabled', 'true');
      const got = winner(el, RULES);
      if (got !== 'blocked') wrong.push(`${e.probe}[aria-disabled]: sheet gives ${got}`);
    }
    expect(wrong).toEqual([]);
  });
});

describe('the specificity model this file cascades with', () => {
  it('scores the shapes cursors.css actually uses', () => {
    expect(specificity('button')).toEqual([0, 0, 1]);
    expect(specificity('a:any-link')).toEqual([0, 1, 1]);
    expect(specificity('input[type="file"]')).toEqual([0, 1, 1]);
    expect(specificity('[aria-disabled="true"]')).toEqual([0, 1, 0]);
    // `:has()` contributes its most specific argument, so this outranks a bare `label`.
    expect(specificity('label:has(input[type="checkbox"])')).toEqual([0, 1, 2]);
    expect(specificity('label')).toEqual([0, 0, 1]);
  });

  it('refuses a selector it cannot score', () => {
    expect(() => specificity('div button')).toThrow();
    expect(() => specificity('div > button')).toThrow();
  });
});
