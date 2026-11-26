// Kept apart from locale-tables.ts, which the setup file loads: importing the translator there would
// load the store before a test file's module mocks apply.
import { translateFor } from '../../i18n/context';
import type { TextKey } from '../../i18n/keys';

/** Whether the translator fills `{name}` with no caller param: a template missing from every table
 *  reads as itself, so a token the translator resolves is the only one that changes it. */
export function translatorFills(name: string): boolean {
  const token = `{${name}}`;
  return translateFor('en', token as TextKey) !== token;
}
