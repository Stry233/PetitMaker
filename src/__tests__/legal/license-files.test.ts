import { describe, it, expect } from 'vitest';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { existsSync, readFileSync } from 'node:fs';
import { APP_NAME } from '../../version';
import { LEGAL } from '../../legal/config';

// LICENSE is the official Apache-2.0 text from
// https://www.apache.org/licenses/LICENSE-2.0.txt, with ONE deliberate edit: the appendix's
// "how to apply" template carries this project's actual copyright line instead of the
// bracketed `[yyyy] [name of copyright owner]` placeholder, which reads as unfinished in a
// shipped file. The terms themselves (sections 1-9) are untouched and asserted below, and the
// line matches NOTICE exactly, so the project states its copyright once and in two places
// that cannot drift apart. Canonical is 201 lines / 11,357 bytes; the substitution is 4 shorter.
const LICENSE = readFileSync('LICENSE', 'utf8');

// NOTICE is narrow BY DESIGN: Apache-2.0 section 4(d) makes downstream reproduce whatever it
// holds, so it carries attribution and pointers, never terms. It exists at all because
// shipping one is what creates that propagation duty in the first place.
const NOTICE = readFileSync('NOTICE', 'utf8');

describe('LICENSE — Apache-2.0 verbatim', () => {
  it('starts with the Apache License 2.0 title block', () => {
    expect(LICENSE.startsWith('                                 Apache License\n                           Version 2.0, January 2004')).toBe(true);
  });

  it('is exactly 201 lines', () => {
    // The file ends with a trailing newline (one per line, incl. the last),
    // so split('\n') yields one extra empty trailing element — strip it
    // before counting, matching `wc -l`.
    expect(LICENSE.replace(/\n$/, '').split('\n').length).toBe(201);
  });

  it('is the canonical length, less the copyright substitution', () => {
    const PLACEHOLDER = '   Copyright [yyyy] [name of copyright owner]';
    const ACTUAL = `   Copyright 2026 ${APP_NAME} contributors`;
    expect(LICENSE).toContain(ACTUAL);
    expect(LICENSE).not.toContain(PLACEHOLDER); // an unfilled placeholder in a shipped file
    const restored = LICENSE.replace(ACTUAL, PLACEHOLDER);
    expect(new TextEncoder().encode(restored).length).toBe(11357);
  });

  it('states the same copyright as NOTICE, so the two cannot drift apart', () => {
    const line = `Copyright 2026 ${APP_NAME} contributors`;
    expect(LICENSE).toContain(line);
    expect(NOTICE).toContain(line);
  });

  it('contains all section titles 1-9', () => {
    expect(LICENSE).toContain('1. Definitions.');
    expect(LICENSE).toContain('2. Grant of Copyright License.');
    expect(LICENSE).toContain('3. Grant of Patent License.');
    expect(LICENSE).toContain('4. Redistribution.');
    expect(LICENSE).toContain('5. Submission of Contributions.');
    expect(LICENSE).toContain('6. Trademarks.');
    expect(LICENSE).toContain('7. Disclaimer of Warranty.');
    expect(LICENSE).toContain('8. Limitation of Liability.');
    expect(LICENSE).toContain('9. Accepting Warranty or Additional Liability.');
  });

  it('contains the closing terms marker', () => {
    expect(LICENSE).toContain('END OF TERMS AND CONDITIONS');
  });

  it('fills the appendix placeholder, since a shipped file should not read as a template', () => {
    // The appendix is the license's own "how to apply this" example, not part of the terms,
    // so filling it changes nothing legally while removing an unfinished-looking line. The
    // owner is the collective "contributors", matching NOTICE and naming no individual.
    expect(LICENSE).not.toContain('[yyyy]');
    expect(LICENSE).not.toContain('[name of copyright owner]');
    expect(LICENSE).toMatch(/^   Copyright 2026 \S.* contributors$/m);
  });

  it('pins full content by SHA-256 hash', async () => {
    // Full-content pin: byte/line counts alone can't catch same-length internal edits.
    const buffer = new TextEncoder().encode(LICENSE);
    // @ts-ignore - crypto.subtle is untyped in vitest
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    const hash = Array.from(new Uint8Array(digest))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    expect(hash).toBe(
      '62ab8bbc137efb9dfef98bcb5a876a27fa250d07fedb58eb8eb9fa284535eba9');
  });
});

describe('NOTICE — narrow attribution, and every reference real', () => {
  it('names the product and states the copyright', () => {
    expect(NOTICE.split('\n')[0]).toBe(`${APP_NAME} (谷地工坊)`);
    expect(NOTICE).toContain(`Copyright 2026 ${APP_NAME} contributors`);
  });

  it('points at documents that exist, by a path a reader can follow', () => {
    // A NOTICE travels in source tarballs and downstream forks, so a bare "/about" is
    // unresolvable there: site references have to be absolute.
    for (const path of ['LICENSE', 'docs/THIRD_PARTY_NOTICES.md', 'docs/ASSET_LICENSES.md']) {
      expect(NOTICE).toContain(path);
      expect(existsSync(path), `${path} is referenced by NOTICE`).toBe(true);
    }
    // Every site reference is the full URL, and pinned to the configured origin so a domain
    // change cannot leave NOTICE pointing at the old one.
    expect(NOTICE).toContain(`${LEGAL.canonicalOrigin}/about`);
    expect((NOTICE.match(/\/about/g) ?? []).length)
      .toBe((NOTICE.match(new RegExp(`${LEGAL.canonicalOrigin}/about`, 'g')) ?? []).length);
    for (const url of NOTICE.match(/https?:\/\/[^\s)]+/g) ?? []) {
      expect(url.startsWith(LEGAL.canonicalOrigin), `${url} is not on the canonical origin`).toBe(true);
    }
  });

  it('carries no terms, because downstream must reproduce whatever it holds', () => {
    for (const phrase of ['All Rights Reserved', 'must not', 'endorsed', 'you may not']) {
      expect(NOTICE, `NOTICE should not impose terms ("${phrase}")`).not.toContain(phrase);
    }
  });
});
