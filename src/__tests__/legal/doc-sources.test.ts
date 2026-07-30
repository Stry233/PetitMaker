/**
 * Where each legal document's body lives.
 *
 * The registry renders ten documents from two kinds of place, and that is
 * deliberate: four are authored for the app under `src/legal/content/`, while the
 * rest ARE a repo file that exists for its own sake (`LICENSE` is byte-exact
 * upstream text, `SECURITY.md` is where GitHub looks for a vulnerability policy,
 * `ASSET_LICENSES`/`CHANGELOG` are public docs the READMEs link) or are generated
 * by a script. The app renders those files directly so the GitHub view, the static
 * page, and the in-app view cannot drift; copying them under `content/` would mean
 * two files per document plus a guard to hold them equal.
 *
 * What must not happen is the split being left to guesswork. Every entry DECLARES
 * its `sourceKind` and `sourcePath`, and these tests hold the declaration to the
 * filesystem: the declared path must exist and its bytes must be the bytes the
 * registry imported, the path must match the kind, and `src/legal/content/` must
 * contain exactly the authored bodies — so a new doc cannot be wired up in a third
 * arrangement without a test failing.
 */
import { describe, it, expect } from 'vitest';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { DOCS, type DocMeta } from '../../legal/registry';
import { LEGAL } from '../../legal/config';

const entries = Object.values(DOCS) as DocMeta[];
const CONTENT_DIR = 'src/legal/content';
/** Files a script writes; hand-editing them is the mistake the kind warns about. */
const GENERATED = new Set(['docs/THIRD_PARTY_NOTICES.md']);

describe('doc sources — the declaration matches the filesystem', () => {
  it.each(entries.map((d) => [d.id, d] as const))('%s: every declared path holds the imported body', (_id, doc) => {
    for (const lang of ['en', 'zh'] as const) {
      const path = doc.sourcePath[lang];
      const src = doc.source[lang];
      // A doc without a zh body declares no zh path, and vice versa.
      expect(path === null).toBe(src === null);
      if (path === null || src === null) continue;
      expect(existsSync(path), `${path} does not exist`).toBe(true);
      expect(readFileSync(path, 'utf8')).toBe(src);
    }
  });

  it.each(entries.map((d) => [d.id, d] as const))('%s: the path matches the declared kind', (_id, doc) => {
    const paths = [doc.sourcePath.en, doc.sourcePath.zh].filter((p): p is string => p !== null);
    for (const path of paths) {
      if (doc.sourceKind === 'authored') {
        expect(path.startsWith(`${CONTENT_DIR}/`), `${path} is authored but not under ${CONTENT_DIR}`).toBe(true);
        expect(path.endsWith('.md')).toBe(true);
        expect(GENERATED.has(path)).toBe(false);
      } else if (doc.sourceKind === 'generated') {
        expect(GENERATED.has(path), `${path} is declared generated but nothing generates it`).toBe(true);
      } else {
        // canonical-root: the file exists for its own sake, so it must NOT be a
        // body written for the app, nor one a script owns.
        expect(path.startsWith(`${CONTENT_DIR}/`), `${path} is canonical-root but sits in ${CONTENT_DIR}`).toBe(false);
        expect(GENERATED.has(path)).toBe(false);
      }
    }
  });

  it('src/legal/content holds exactly the authored bodies (plus its README)', () => {
    const onDisk = readdirSync(CONTENT_DIR).filter((f: string) => f.endsWith('.md')).sort();
    const declared = entries
      .filter((d) => d.sourceKind === 'authored')
      .flatMap((d) => [d.sourcePath.en, d.sourcePath.zh])
      .filter((p): p is string => p !== null)
      .map((p) => p.slice(CONTENT_DIR.length + 1));
    expect(onDisk).toEqual([...declared, 'README.md'].sort());
  });

  it('the README points at the docs that live elsewhere', () => {
    const readme = readFileSync(`${CONTENT_DIR}/README.md`, 'utf8');
    for (const doc of entries.filter((d) => d.sourceKind !== 'authored')) {
      expect(readme, `README should name ${doc.sourcePath.en}`).toContain(doc.sourcePath.en);
    }
  });
});

describe('the team roster lives only in config', () => {
  // A hand-listed roster in contact.{en,zh}.md drifts: it orders differently from the
  // About table and the About modal, and it is a third copy of every profile URL to keep
  // in sync. Generating it from LEGAL.team is what stops that.
  it('no authored doc hardcodes a member name or profile URL', () => {
    const authored = readdirSync(CONTENT_DIR).filter((f: string) => f.endsWith('.md') && f !== 'README.md');
    for (const file of authored) {
      const body = readFileSync(`${CONTENT_DIR}/${file}`, 'utf8');
      for (const m of LEGAL.team) {
        expect(body, `${file} hardcodes ${m.name} — use the {team} token`).not.toContain(m.name);
        expect(body, `${file} hardcodes ${m.url} — use the {team} token`).not.toContain(m.url);
      }
    }
  });
});
