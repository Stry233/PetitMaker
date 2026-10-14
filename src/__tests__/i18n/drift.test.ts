/**
 * An i18n key with no call site is dead weight that multiplies across all seven locales, and
 * nobody notices because no test asserts on translated text. This test is the detector: it
 * decides what counts as "used" and fails on anything in en.ts that doesn't.
 *
 * A key is not always the literal argument of a `t(...)`/`translate(...)` call — plenty are held
 * as data and translated later at a different site (`config/catalog/categories.ts` holds
 * `placeKey: 'menu.place_building'`; `rules/*.ts` hold `message: 'error.zone_restricted'`; several
 * UI files hold a key behind a ternary or pass it as a bare positional argument to a helper that
 * calls `t()` internally). A matcher that only follows direct call arguments misses all of those
 * and would recommend deleting a live key, which blanks a UI string in seven languages with no
 * test failure to catch it. So "used" here means the literal, key-shaped string appears anywhere
 * in application source, not only inside a translate call — the safe direction for a detector
 * whose false positive is a silent deletion.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { translations } from '../../i18n/translations';
import { translateFor } from '../../i18n/context';
import type { Translate } from '../../i18n/keys';
import { countedBase } from '../_support/plural-keys';
import { walkFiles } from '../_support/source-graph';

const SRC = resolve(__dirname, '..', '..');

/** Every .ts/.tsx under src, excluding tests (which quote keys for reasons unrelated to using
 *  them — assertion fixtures, the export-keys-parity list) and the locale data itself. */
const sourceFiles = (dir: string): string[] => walkFiles(dir, { skip: ['__tests__', 'i18n/locales'] });

const FILES = sourceFiles(SRC);
const SOURCE_TEXT = FILES.map((f) => readFileSync(f, 'utf8'));

// namespace.name / namespace.sub.name — dot-joined segments, first char a letter. Excludes
// import specifiers (they contain '/'), CSS-ish hyphenated strings, and version numbers.
const KEY_SHAPE = /^[a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9_]+)+$/;
const QUOTED_RE = /['"]([a-zA-Z][a-zA-Z0-9_.]*)['"]/g;

/** Every key-shaped quoted string in the given source texts. */
function keyLikeStrings(texts: string[]): Set<string> {
  const found = new Set<string>();
  for (const text of texts) {
    QUOTED_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = QUOTED_RE.exec(text))) {
      const candidate = m[1]!;
      if (KEY_SHAPE.test(candidate)) found.add(candidate);
    }
  }
  return found;
}

function usedKeys(): Set<string> {
  return keyLikeStrings([...SOURCE_TEXT, ...SCRIPT_TEXT]);
}

/** Every .mts under scripts/, recursively. The offline README-figure pipeline drives the live app
 *  and reads i18n keys straight out of `translations` to build captions, so a key it reads must
 *  still exist even though quoting it here is not a reason to keep that key translated. */
const scriptFiles = (dir: string): string[] => walkFiles(dir, { accept: /\.mts$/ });

const SCRIPTS = resolve(__dirname, '..', '..', '..', 'scripts');
const SCRIPT_TEXT = scriptFiles(SCRIPTS).map((f) => readFileSync(f, 'utf8'));

/** Key-shaped strings from scripts/, narrowed to the namespaces en.ts actually declares (first dot
 *  segment) — scripts/ is full of unrelated dotted literals that happen to fit KEY_SHAPE (CDP method
 *  names like `Page.navigate`, filenames like `README.md`), and none of those share a namespace with
 *  a real i18n key. A DYNAMIC_PREFIXES entry (e.g. `agent.prov_` before a script concatenates an id
 *  onto it) is a deliberately incomplete key, not a reference to a missing one. */
function keysReferencedFromScripts(enKeySet: Set<string>): string[] {
  const namespaces = new Set([...enKeySet].map((k) => k.split('.')[0]));
  return [...keyLikeStrings(SCRIPT_TEXT)].filter((k) => namespaces.has(k.split('.')[0]) && !isDynamic(k));
}

/** Prefixes composed at runtime via a template literal (`` `prefix${suffix}` ``), so no exact
 *  quoted match of the full key exists anywhere. A key under a declared prefix counts as used.
 *  Each entry names the call site that composes it, and an entry whose call site is gone fails the
 *  "still composed" check below: an unbacked prefix protects every key under it from detection. */
const DYNAMIC_PREFIXES: readonly string[] = [
  'modal.settings_motion_', // ui/chrome/modals/settings/SettingsModal.tsx: t(`modal.settings_motion_${pref}`) per motion-pref row
  'modal.settings_quality3d_', // ui/chrome/modals/settings/SettingsModal.tsx: t(`modal.settings_quality3d_${q}`) per 3D-quality row
  'export.preset_', // ui/chrome/modals/export/ExportControls.tsx: t(`export.preset_${preset}`) and `${preset}_desc`
  'export.res_', // ui/chrome/modals/export/ExportControls.tsx: t(`export.res_${resolutionKey}`) per resolution option
  'kbd.cat.', // ui/chrome/modals/keyboard/KeyboardModal.tsx: t(`kbd.cat.${category}`) per keybind category heading
  'hint.sep.', // ui/help/hints/hint-marks.tsx: t(`hint.sep.${separator}`) for the combo-token separator glyph
  'context.rotate_', // ui/chrome/floating/ContextMenu.tsx: t(`context.rotate_${axis}`) for the rotate-object menu row
  'agent.verb_', // agent/tools/labels.ts: toolVerbKey composes `agent.verb_${name}` per tool
  'agent.skill_', // agent/skills/titles.ts: skillTitleKey composes the title key per skill name
];

const isDynamic = (key: string): boolean => DYNAMIC_PREFIXES.some((p) => key.startsWith(p));

describe('i18n drift: an orphaned key fails the suite', () => {
  const used = usedKeys();
  const enKeys = Object.keys(translations.en);

  it('every en key is referenced, directly or via a declared dynamic prefix', () => {
    // A plural variant `base_one` or the exact-one `base_single` is read through its base key's
    // count, so the base's use covers it.
    const variantOfUsed = (k: string) => { const base = countedBase(k); return base !== null && used.has(base); };
    const orphans = enKeys.filter((k) => !used.has(k) && !isDynamic(k) && !variantOfUsed(k));
    expect(orphans).toEqual([]);
  });

  it('every declared dynamic prefix is still composed somewhere', () => {
    // The only source shape that produces `prefix + arbitrary-suffix` at runtime is a template
    // literal whose static portion is the prefix, so the prefix text immediately followed by the
    // interpolation start is the fact to search for.
    const stale = DYNAMIC_PREFIXES.filter((p) => !SOURCE_TEXT.some((text) => text.includes(`${p}\${`)));
    expect(stale).toEqual([]);
  });

  it('every i18n key referenced from scripts/ resolves in en', () => {
    const enSet = new Set(enKeys);
    const missing = keysReferencedFromScripts(enSet).filter((k) => !enSet.has(k));
    expect(missing).toEqual([]);
  });
});

/**
 * The other direction: a key asked for must be declared, or its label reads as the key itself. The
 * type checker holds it: `Translate`, `translate` and `translateFor` take only `TextKey`, so an
 * undeclared literal, a key-holding field typed `string` or a composed family with a missing member
 * fails `npm run lint`. Locale key-set parity is `parity.test.ts`'s.
 */
describe('i18n gaps: a key asked for and never declared fails the type check', () => {
  it('rejects an undeclared key at every translate entry point', () => {
    const asks = (t: Translate) => {
      // @ts-expect-error an undeclared key
      t('no.such_key');
      // @ts-expect-error an undeclared key
      translateFor('en', 'no.such_key');
      return t('app.name');
    };
    expect(asks((key) => translateFor('en', key))).toBe(translateFor('en', 'app.name'));
  });
});
