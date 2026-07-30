import type { LegalConfig } from './config';

/**
 * Pure, side-effect-free validation of a `LegalConfig`. Returns a list of
 * human-readable problems; an empty list means the config is launch-ready.
 *
 * `mode` does not change the CHECKS performed — release and dev builds must
 * agree on what is wrong — it only documents intent for the caller: a
 * release build fails on a non-empty list (prebuild assertion), a dev/test
 * build merely warns.
 */
export function validateLegalConfig(cfg: LegalConfig, mode: 'release' | 'dev'): string[] {
  void mode;

  const problems: string[] = [];

  validateOrigin(cfg.canonicalOrigin, problems);
  validateRequired('privacyContactEmail', cfg.privacyContactEmail, problems);
  validateRequired('securityContactEmail', cfg.securityContactEmail, problems);
  validateRequired('effectiveDates.privacy', cfg.effectiveDates.privacy, problems);
  validateRequired('effectiveDates.terms', cfg.effectiveDates.terms, problems);
  validatePolicyVersion('privacy', cfg.policyVersions.privacy, problems);
  validatePolicyVersion('terms', cfg.policyVersions.terms, problems);
  validateFilingPair('icp', cfg.icpNumber, cfg.icpUrl, problems);
  validateFilingPair('psb', cfg.psbNumber, cfg.psbUrl, problems);

  return problems;
}

function isBlank(value: string): boolean {
  return value.trim().length === 0;
}

function validateRequired(field: string, value: string, problems: string[]): void {
  if (isBlank(value)) {
    problems.push(`${field} is empty`);
  }
}

function validatePolicyVersion(field: 'privacy' | 'terms', value: string, problems: string[]): void {
  validateRequired(`policyVersions.${field}`, value, problems);
  if (value.endsWith('-draft')) {
    problems.push(`policyVersions.${field} is still a draft version ("${value}")`);
  }
}

function validateOrigin(origin: string, problems: string[]): void {
  if (isBlank(origin)) {
    problems.push('canonicalOrigin is empty');
    return;
  }

  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    problems.push(`canonicalOrigin is not a valid URL: "${origin}"`);
    return;
  }

  if (url.protocol !== 'https:') {
    problems.push(`canonicalOrigin must use https: "${origin}"`);
  }
  if (origin.endsWith('/')) {
    problems.push(`canonicalOrigin must not have a trailing slash: "${origin}"`);
  }
  if (url.pathname !== '/') {
    problems.push(`canonicalOrigin must not include a path: "${origin}"`);
  }
}

// A filing pair (ICP/PSB) may be entirely null — the row simply doesn't
// render — but a PARTIAL pair (number without URL or vice versa) would
// render a broken row, so it's always a build error.
function validateFilingPair(
  label: 'icp' | 'psb',
  number: string | null,
  url: string | null,
  problems: string[],
): void {
  const hasNumber = number !== null && !isBlank(number);
  const hasUrl = url !== null && !isBlank(url);
  if (hasNumber !== hasUrl) {
    problems.push(`${label}Number/${label}Url must both be set or both be null (partial filing pair)`);
  }
}
