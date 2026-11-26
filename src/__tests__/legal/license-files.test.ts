import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { APP_NAME } from '../../i18n/terms/brand';
import { LEGAL } from '../../legal/config';

// `LICENSE` is the official FSL-1.1-ALv2 template (getsentry/fsl.software, `FSL-1.1-ALv2.template.md`,
// sha256 36b6082235c0a2105174927fc57cc6ae9c41f45a08af2bdcaee18a8dace56177) with its two placeholders
// filled: the year and the licensor, the collective "contributors", the same line as in `NOTICE`.
const LICENSE = readFileSync('LICENSE', 'utf8');

// `NOTICE` travels with every copy (FSL's Redistribution keeps its copyright notices), so it carries
// attribution and pointers, never terms.
const NOTICE = readFileSync('NOTICE', 'utf8');

const sha256 = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
};

describe('LICENSE: FSL-1.1-ALv2 verbatim', () => {
  const COPYRIGHT = `Copyright 2026 ${APP_NAME} contributors`;

  it('is the official template, byte for byte, once its two placeholders are put back', async () => {
    expect(LICENSE).toContain(COPYRIGHT);
    const template = LICENSE.replace(COPYRIGHT, 'Copyright ${year} ${licensor name}');
    expect(await sha256(template)).toBe('36b6082235c0a2105174927fc57cc6ae9c41f45a08af2bdcaee18a8dace56177');
  });

  it('fills both placeholders, since a shipped file should not read as a template', () => {
    expect(LICENSE).not.toContain('${year}');
    expect(LICENSE).not.toContain('${licensor name}');
  });

  it('states the same copyright as NOTICE, so the two cannot drift apart', () => {
    expect(NOTICE).toContain(COPYRIGHT);
  });

  it('grants the Apache License, Version 2.0 as its future license', () => {
    expect(LICENSE.startsWith('# Functional Source License, Version 1.1, ALv2 Future License\n')).toBe(true);
    expect(LICENSE).toContain('## Grant of Future License');
    expect(LICENSE).toContain('the Apache License, Version 2.0 that is effective on the second anniversary');
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
