import { providerName } from '../../i18n/providers';
import { en } from '../../i18n/locales/en';
import { zh } from '../../i18n/locales/zh';
import { expect } from 'vitest';
import { docBody, type DocId } from '../../legal/registry';
import type { LegalConfig } from '../../legal/config';
import { PROVIDER_IDS } from '../../agent/providers/defaults';

/**
 * Generic translation-parity assertions for a bilingual legal doc, shared by
 * the privacy and terms parity tests:
 * the en and zh versions are authored EQUIVALENTS, so their material structure
 * and every factual anchor (h2 count, emails, dates, provider names) must
 * match. No English-only disclosure is allowed.
 */

/** Count of `##` (h2) headings — the material-section skeleton. */
export function h2Count(body: string): number {
  return (body.match(/^##\s+\S/gm) ?? []).length;
}

/** The distinct email addresses appearing in a body, sorted. */
export function emailsIn(body: string): string[] {
  return [...new Set(body.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi) ?? [])].sort();
}

/** The distinct ISO-ish dates (YYYY-MM-DD) appearing in a body, sorted. */
export function datesIn(body: string): string[] {
  return [...new Set(body.match(/\d{4}-\d{2}-\d{2}/g) ?? [])].sort();
}

/** Compare provider identities after resolving each document's language. */
export function providersIn(body: string, lang: 'en' | 'zh'): string[] {
  const strings = lang === 'zh' ? zh : en;
  return PROVIDER_IDS.filter(id => id !== 'custom' && body.includes(providerName(id, key => strings[key] ?? key))).sort();
}

/**
 * Assert en/zh material parity for a bilingual doc: equal h2 counts and the
 * same set of emails, dates, and provider brand names on both sides.
 */
export function assertDocParity(id: DocId, cfg: LegalConfig): void {
  const en = docBody(id, 'en', cfg);
  const zh = docBody(id, 'zh', cfg);

  expect(h2Count(zh), `${id}: h2 section count must match across languages`).toBe(h2Count(en));
  expect(emailsIn(zh), `${id}: same emails in both languages`).toEqual(emailsIn(en));
  expect(datesIn(zh), `${id}: same dates in both languages`).toEqual(datesIn(en));
  expect(providersIn(zh, 'zh'), `${id}: same provider names in both languages`).toEqual(providersIn(en, 'en'));
}
