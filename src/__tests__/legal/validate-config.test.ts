import { describe, it, expect } from 'vitest';
import type { LegalConfig } from '../../legal/config';
import { LEGAL } from '../../legal/config';
import { validateLegalConfig } from '../../legal/validate-config';

// A fully-resolved fixture — every validated field filled with a plausible real
// value, so it passes cleanly in both modes.
function resolvedConfig(overrides: Partial<LegalConfig> = {}): LegalConfig {
  return {
    canonicalOrigin: 'https://petitmaker.app',
    legacyOrigins: [],
    productName: 'PetitMaker',
    operatorDisplayName: 'PetitMaker Team / 谷地工坊团队',
    privacyContactEmail: 'legal@petitmaker.app',
    securityContactEmail: 'security@petitmaker.app',
    qqFeedbackGroup: '123456789',
    icpNumber: null,
    icpUrl: null,
    psbNumber: null,
    psbUrl: null,
    effectiveDates: { privacy: '2026-07-14', terms: '2026-07-14' },
    policyVersions: { privacy: '1.0', terms: '1.0' },
    team: [
      { name: 'Jane Doe', sort: 'janedoe', url: 'https://example.com/jane' },
    ],
    acknowledgements: [{ name: 'Sam Roe', sort: 'samroe', url: 'https://example.com/sam' }],
    repoUrl: 'https://github.com/example/petitmaker',
    sponsorship: { patreon: 'https://www.patreon.com/c/example', afdian: 'https://afdian.com/a/example' },
    ...overrides,
  };
}

describe('validateLegalConfig — canonicalOrigin', () => {
  it('release mode rejects an empty/placeholder origin', () => {
    const problems = validateLegalConfig(resolvedConfig({ canonicalOrigin: '' }), 'release');
    expect(problems.length).toBeGreaterThan(0);
  });

  it('release mode rejects a non-https origin', () => {
    const problems = validateLegalConfig(
      resolvedConfig({ canonicalOrigin: 'http://petitmaker.app' }),
      'release',
    );
    expect(problems.length).toBeGreaterThan(0);
  });

  it('release mode rejects an origin with a trailing slash', () => {
    const problems = validateLegalConfig(
      resolvedConfig({ canonicalOrigin: 'https://petitmaker.app/' }),
      'release',
    );
    expect(problems.length).toBeGreaterThan(0);
  });

  it('release mode rejects an origin with a path', () => {
    const problems = validateLegalConfig(
      resolvedConfig({ canonicalOrigin: 'https://petitmaker.app/foo' }),
      'release',
    );
    expect(problems.length).toBeGreaterThan(0);
  });
});

describe('validateLegalConfig — contacts', () => {
  it('rejects an empty privacyContactEmail', () => {
    const problems = validateLegalConfig(resolvedConfig({ privacyContactEmail: '' }), 'release');
    expect(problems.length).toBeGreaterThan(0);
  });

  it('rejects an empty securityContactEmail', () => {
    const problems = validateLegalConfig(resolvedConfig({ securityContactEmail: '' }), 'release');
    expect(problems.length).toBeGreaterThan(0);
  });
});

describe('validateLegalConfig — draft policyVersions', () => {
  it('rejects a "-draft" suffixed privacy policy version', () => {
    const problems = validateLegalConfig(
      resolvedConfig({ policyVersions: { privacy: '1.0-draft', terms: '1.0' } }),
      'release',
    );
    expect(problems.length).toBeGreaterThan(0);
  });

  it('rejects a "-draft" suffixed terms policy version', () => {
    const problems = validateLegalConfig(
      resolvedConfig({ policyVersions: { privacy: '1.0', terms: '1.0-draft' } }),
      'release',
    );
    expect(problems.length).toBeGreaterThan(0);
  });
});

describe('validateLegalConfig — ICP/PSB pairing', () => {
  it('rejects icpNumber set without icpUrl', () => {
    const problems = validateLegalConfig(
      resolvedConfig({ icpNumber: '京ICP备2026xxxxxx号-1', icpUrl: null }),
      'release',
    );
    expect(problems.length).toBeGreaterThan(0);
  });

  it('rejects icpUrl set without icpNumber', () => {
    const problems = validateLegalConfig(
      resolvedConfig({ icpNumber: null, icpUrl: 'https://beian.miit.gov.cn/' }),
      'release',
    );
    expect(problems.length).toBeGreaterThan(0);
  });

  it('rejects psbNumber set without psbUrl', () => {
    const problems = validateLegalConfig(
      resolvedConfig({ psbNumber: '京公网安备 1101xxxxxxxxx号', psbUrl: null }),
      'release',
    );
    expect(problems.length).toBeGreaterThan(0);
  });

  it('rejects psbUrl set without psbNumber', () => {
    const problems = validateLegalConfig(
      resolvedConfig({ psbNumber: null, psbUrl: 'https://example.gov.cn/psb' }),
      'release',
    );
    expect(problems.length).toBeGreaterThan(0);
  });

  it('accepts a fully-paired ICP + PSB filing', () => {
    const problems = validateLegalConfig(
      resolvedConfig({
        icpNumber: '京ICP备2026xxxxxx号-1',
        icpUrl: 'https://beian.miit.gov.cn/',
        psbNumber: '京公网安备 1101xxxxxxxxx号',
        psbUrl: 'https://example.gov.cn/psb',
      }),
      'release',
    );
    expect(problems).toEqual([]);
  });

  it('null ICP + PSB pairs are valid in both modes', () => {
    const cfg = resolvedConfig({ icpNumber: null, icpUrl: null, psbNumber: null, psbUrl: null });
    expect(validateLegalConfig(cfg, 'release')).toEqual([]);
    expect(validateLegalConfig(cfg, 'dev')).toEqual([]);
  });
});

describe('validateLegalConfig — dev vs release', () => {
  it('dev mode returns the same problem list as release mode (callers decide fail vs warn)', () => {
    const broken = resolvedConfig({
      canonicalOrigin: '',
      privacyContactEmail: '',
    });
    expect(validateLegalConfig(broken, 'dev')).toEqual(validateLegalConfig(broken, 'release'));
  });
});

describe('validateLegalConfig — fully-resolved fixture', () => {
  it('passes with an empty problem list in release mode', () => {
    expect(validateLegalConfig(resolvedConfig(), 'release')).toEqual([]);
  });

  it('passes with an empty problem list in dev mode', () => {
    expect(validateLegalConfig(resolvedConfig(), 'dev')).toEqual([]);
  });
});

describe('validateLegalConfig — the real LEGAL instance', () => {
  it('is release-valid', () => {
    expect(validateLegalConfig(LEGAL, 'release')).toEqual([]);
  });
});
