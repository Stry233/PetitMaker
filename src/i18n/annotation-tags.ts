import { ANNOTATION_TAGS, type TagId } from '../core/model/annotations';
import type { Locale } from '../core/model/types';
import { translateFor } from './context';

/** The drawn label for a planning tag, in `locale`. */
export function tagLabel(tag: TagId, locale: Locale): string {
  const entry = ANNOTATION_TAGS.find((t) => t.id === tag);
  return entry ? translateFor(locale, entry.labelKey) : '';
}
