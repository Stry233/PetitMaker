/** When an export window's Export is unavailable: the one rule the share picture's and the save
 *  file's windows read. */
import type { ReviewIssue } from '../review/text-review';

/** Where the words an export carries stand with the text check: approved (or none to check), refused
 *  for what they say, or not yet approved (still checking, or the check could not run). */
export type ExportWords = 'approved' | 'refused' | 'unsettled';

/** What an export window's Export waits on. */
export interface ExportStanding {
  exporting: boolean;
  /** Words still being composed through an input method. */
  composing: boolean;
  /** The map check: still running, or a confirmed finding. */
  map: { pending: boolean; blocked: boolean };
  words: ExportWords;
}

/** Whether Export is unavailable: while an export runs, words are being composed, the map check runs
 *  or found something, or the text check refused the words; and, for an export that does not check
 *  its words as it runs (`checksWords` false), until they are approved. */
export function exportUnavailable(s: ExportStanding, checksWords: boolean): boolean {
  return s.exporting || s.composing || s.map.pending || s.map.blocked || s.words === 'refused' || (!checksWords && s.words === 'unsettled');
}

/** The words' standing from a text check's issue and approval, as the window's check reports them. */
export function exportWords(issue: ReviewIssue | null, approved: boolean): ExportWords {
  if (issue !== null && typeof issue === 'object') return 'refused';
  return approved ? 'approved' : 'unsettled';
}
