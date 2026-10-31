import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { APP_NAME } from '../../i18n/terms/brand';
import { LEGAL } from '../../legal/config';

// `LICENSE` is the official Apache-2.0 text (https://www.apache.org/licenses/LICENSE-2.0.txt,
// 201 lines, 11,357 bytes) with one edit: the appendix template carries the project's copyright
// line, the same as in `NOTICE`, in place of the `[yyyy] [name of copyright owner]` placeholder.
const LICENSE = readFileSync('LICENSE', 'utf8');

// Apache-2.0 section 4(d) makes downstream reproduce whatever `NOTICE` holds, so it carries
// attribution and pointers, never terms.
const NOTICE = readFileSync('NOTICE', 'utf8');

describe('LICENSE — Apache-2.0 verbatim', () => {
  it('starts with the Apache License 2.0 title block', () => {
    expect(LICENSE.startsWith('                                 Apache License\n                           Version 2.0, January 2004')).toBe(true);
  });

  it('is exactly 201 lines', () => {
    // Strip the final newline so the count matches `wc -l`.
    expect(LICENSE.replace(/\n$/, '').split('\n').length).toBe(201);
  });

  it('is the canonical length, less the copyright substitution', () => {
    const PLACEHOLDER = '   Copyright [yyyy] [name of copyright owner]';
    const ACTUAL = `   Copyright 2026 ${APP_NAME} contributors`;
    expect(LICENSE).toContain(ACTUAL);
    expect(LICENSE).not.toContain(PLACEHOLDER);
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
    // The appendix is an example, not part of the terms, so filling it changes nothing legally.
    // The owner is the collective "contributors", naming no individual.
    expect(LICENSE).not.toContain('[yyyy]');
    expect(LICENSE).not.toContain('[name of copyright owner]');
    expect(LICENSE).toMatch(/^   Copyright 2026 \S.* contributors$/m);
  });

  it('pins full content by SHA-256 hash', async () => {
    // Byte and line counts cannot catch a same-length edit.
    const buffer = new TextEncoder().encode(LICENSE);
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
    // `NOTICE` travels in tarballs and forks, where a bare "/about" cannot resolve.
    for (const path of ['LICENSE', 'docs/THIRD_PARTY_NOTICES.md', 'docs/ASSET_LICENSES.md']) {
      expect(NOTICE).toContain(path);
      expect(existsSync(path), `${path} is referenced by NOTICE`).toBe(true);
    }
    // Every site reference is a full URL on the configured origin.
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
