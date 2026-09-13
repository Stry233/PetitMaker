import { LinkifyIt } from 'linkify-it';
import tlds from 'tlds';
import { normalizeText } from './policy';

const links = new LinkifyIt({ fuzzyLink: true, fuzzyIP: true, fuzzyEmail: false, urlAuth: true })
  .tlds(tlds).tlds(['test', 'example', 'invalid', 'local', 'localhost', 'onion'], true)
  .add('mailto:', null);

export function containsWebsite(text: string): boolean {
  const normalized = normalizeText(text).replace(/\p{Cf}/gu, '').replace(/[。｡]/g, '.');
  // A URL beside Chinese text still needs recognition even without a separating space.
  const separated = normalized.replace(/(?=(?:https?|ftp):\/\/|www\.)/giu, ' ');
  // Keep the original for international domains, then treat adjoining Unicode prose as boundaries.
  return links.test(separated) || links.test(separated.replace(/[^\x00-\x7f]/g, ' '));
}
