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
    operatorName: { en: 'PetitMaker Team', zh: '谷地工坊团队' },
    privacyContactEmail: 'legal@petitmaker.app',
    securityContactEmail: 'security@petitmaker.app',
    qqFeedbackChannel: 'pd123456789',
    icpNumber: null,
    icpUrl: null,
    psbNumber: null,
    psbUrl: null,
    privacyHostNetwork: { en: 'the test host', zh: '测试主机' },
    privacyEdgeDelivery: { en: 'Delivered from the test edge.', zh: '由测试边缘节点分发。' },
    effectiveDates: { privacy: '2026-07-14', terms: '2026-07-14' },
    policyVersions: { privacy: '1.0', terms: '1.0' },
    team: [
      { name: 'Jane Doe', sort: 'janedoe', bilibili: '101' },
    ],
    acknowledgements: [{ name: 'Sam Roe', sort: 'samroe', bilibili: '202' }],
    repoUrl: 'https://github.com/example/petitmaker',
    sponsorship: { patreon: 'https://www.patreon.com/c/example', afdian: 'https://afdian.com/a/example' },
    ...overrides,
  };
}

describe('validateLegalConfig — canonicalOrigin', () => {
  it('release mode rejects an empty/placeholder origin', () => {
    const problems = validateLegalConfig(resolvedConfig({ canonicalOrigin: '' }));
    expect(problems.length).toBeGreaterThan(0);
  });

  it('release mode rejects a non-https origin', () => {
    const problems = validateLegalConfig(
      resolvedConfig({ canonicalOrigin: 'http://petitmaker.app' }));
    expect(problems.length).toBeGreaterThan(0);
  });

  it('release mode rejects an origin with a trailing slash', () => {
    const problems = validateLegalConfig(
      resolvedConfig({ canonicalOrigin: 'https://petitmaker.app/' }));
    expect(problems.length).toBeGreaterThan(0);
  });

  it('release mode rejects an origin with a path', () => {
    const problems = validateLegalConfig(
      resolvedConfig({ canonicalOrigin: 'https://petitmaker.app/foo' }));
    expect(problems.length).toBeGreaterThan(0);
  });
});

describe('validateLegalConfig — contacts', () => {
  it('rejects an empty privacyContactEmail', () => {
    const problems = validateLegalConfig(resolvedConfig({ privacyContactEmail: '' }));
    expect(problems.length).toBeGreaterThan(0);
  });

  it('rejects an empty securityContactEmail', () => {
    const problems = validateLegalConfig(resolvedConfig({ securityContactEmail: '' }));
    expect(problems.length).toBeGreaterThan(0);
  });
});

describe('validateLegalConfig — draft policyVersions', () => {
  it('rejects a "-draft" suffixed privacy policy version', () => {
    const problems = validateLegalConfig(
      resolvedConfig({ policyVersions: { privacy: '1.0-draft', terms: '1.0' } }));
    expect(problems.length).toBeGreaterThan(0);
  });

  it('rejects a "-draft" suffixed terms policy version', () => {
    const problems = validateLegalConfig(
      resolvedConfig({ policyVersions: { privacy: '1.0', terms: '1.0-draft' } }));
    expect(problems.length).toBeGreaterThan(0);
  });
});

describe('validateLegalConfig — ICP/PSB pairing', () => {
  it('rejects icpNumber set without icpUrl', () => {
    const problems = validateLegalConfig(
      resolvedConfig({ icpNumber: '京ICP备2026xxxxxx号-1', icpUrl: null }));
    expect(problems.length).toBeGreaterThan(0);
  });

  it('rejects icpUrl set without icpNumber', () => {
    const problems = validateLegalConfig(
      resolvedConfig({ icpNumber: null, icpUrl: 'https://beian.miit.gov.cn/' }));
    expect(problems.length).toBeGreaterThan(0);
  });

  it('rejects psbNumber set without psbUrl', () => {
    const problems = validateLegalConfig(
      resolvedConfig({ psbNumber: '京公网安备 1101xxxxxxxxx号', psbUrl: null }));
    expect(problems.length).toBeGreaterThan(0);
  });

  it('rejects psbUrl set without psbNumber', () => {
    const problems = validateLegalConfig(
      resolvedConfig({ psbNumber: null, psbUrl: 'https://example.gov.cn/psb' }));
    expect(problems.length).toBeGreaterThan(0);
  });

  it('accepts a fully-paired ICP + PSB filing', () => {
    const problems = validateLegalConfig(
      resolvedConfig({
        icpNumber: '京ICP备2026xxxxxx号-1',
        icpUrl: 'https://beian.miit.gov.cn/',
        psbNumber: '京公网安备 1101xxxxxxxxx号',
        psbUrl: 'https://example.gov.cn/psb',
      }));
    expect(problems).toEqual([]);
  });

  it('null ICP + PSB pairs are valid', () => {
    const cfg = resolvedConfig({ icpNumber: null, icpUrl: null, psbNumber: null, psbUrl: null });
    expect(validateLegalConfig(cfg)).toEqual([]);
  });
});

describe('validateLegalConfig — fully-resolved fixture', () => {
  it('passes with an empty problem list', () => {
    expect(validateLegalConfig(resolvedConfig())).toEqual([]);
  });
});

describe('validateLegalConfig — the real LEGAL instance', () => {
  it('is release-valid', () => {
    expect(validateLegalConfig(LEGAL)).toEqual([]);
  });
});
