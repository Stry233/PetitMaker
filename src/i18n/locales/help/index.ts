/*
 * The Help Center's string tables, assembled and registered as an i18n OVERLAY: this module is
 * imported only by the help chunk (and by tests), so the prose stays off the eager bundle and
 * arrives with the window that reads it. The parity, register and orphan checks for these tables
 * live in `__tests__/ui/help/catalog.test.ts`, since the main i18n suites bind only the merged
 * eager tables.
 */
import type { Locale } from '../../../core/model/types';
import { registerExtraStrings } from '../../context';
import { helpEn } from './en';
import { helpZh } from './zh';
import { helpJa } from './ja';
import { helpRu } from './ru';
import { helpTh } from './th';
import { helpId } from './id';
import { helpFr } from './fr';

export const HELP_TABLES: Record<Locale, Record<string, string>> = {
  en: helpEn, zh: helpZh, ja: helpJa, ru: helpRu, th: helpTh, id: helpId, fr: helpFr,
};

let registered = false;

/** Put the help strings where `translateFor` can see them. Called at the help chunk's module
 *  scope, so every surface in the chunk renders after the words have arrived. */
export function ensureHelpStrings(): void {
  if (registered) return;
  registered = true;
  registerExtraStrings(HELP_TABLES);
}
