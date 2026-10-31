/**
 * Every en key is used somewhere. "Used" means the key-shaped literal appears anywhere in application
 * source, not only as a `t(...)` argument, because many keys are held as data and translated elsewhere
 * (`placeKey` in the catalog, rule `message` fields); a stricter matcher would call live keys orphans.
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

/** Every source file under src except tests (which quote keys without using them) and the locales. */
const sourceFiles = (dir: string): string[] => walkFiles(dir, { skip: ['__tests__', 'i18n/locales'] });

const FILES = sourceFiles(SRC);
const SOURCE_TEXT = FILES.map((f) => readFileSync(f, 'utf8'));

// Dot-joined segments starting with a letter; excludes import specifiers, hyphenated strings and versions.
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

/** Every .mts under scripts/: some read keys from `translations` to build captions, so a key they
 *  read must exist. */
const scriptFiles = (dir: string): string[] => walkFiles(dir, { accept: /\.mts$/ });

const SCRIPTS = resolve(__dirname, '..', '..', '..', 'scripts');
const SCRIPT_TEXT = scriptFiles(SCRIPTS).map((f) => readFileSync(f, 'utf8'));

/** Key-shaped strings from scripts/ in a namespace en declares, which drops dotted literals such as
 *  `Page.navigate` or `README.md`; a `DYNAMIC_PREFIXES` entry is an incomplete key, not a missing one. */
function keysReferencedFromScripts(enKeySet: Set<string>): string[] {
  const namespaces = new Set([...enKeySet].map((k) => k.split('.')[0]));
  return [...keyLikeStrings(SCRIPT_TEXT)].filter((k) => namespaces.has(k.split('.')[0]) && !isDynamic(k));
}

/** Prefixes composed at runtime in a template literal; a key under one counts as used. Each names its
 *  call site, and one whose site is gone fails the "still composed" check, since it would hide orphans. */
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
    // Plural variants (`base_one`, `base_single`) are read through their base key.
    const variantOfUsed = (k: string) => { const base = countedBase(k); return base !== null && used.has(base); };
    const orphans = enKeys.filter((k) => !used.has(k) && !isDynamic(k) && !variantOfUsed(k));
    expect(orphans).toEqual([]);
  });

  it('every declared dynamic prefix is still composed somewhere', () => {
    // Searches for the prefix followed directly by a template interpolation.
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
 * A key asked for must be declared. The type checker holds it: every translate entry point takes only
 * `TextKey`, so an undeclared key fails `npm run lint`. Locale parity is `parity.test.ts`'s.
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
