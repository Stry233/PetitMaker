/* Note tag labels: preset tags from the locale tables, custom tags only once their text is approved. */
import { customTagOf, isCustomTagId, type CustomTag, type NoteTag } from '../../core/model/annotations';
import { ANNOTATION_TAGS } from '../../config/annotation-tags';
import type { Locale } from '../../core/model/locale';
import { textApproved } from '../../state/text-verdicts';
import { translateFor } from '../context';

/** The drawn label for a note's tag, in `locale`. A custom tag reads its own text from `custom`,
 *  the map's tags, once the text check has approved it, and draws nothing before that. */
export function tagLabel(tag: NoteTag, locale: Locale, custom?: readonly CustomTag[]): string {
  if (isCustomTagId(tag)) {
    const text = customTagOf(custom, tag)?.text;
    return text !== undefined && textApproved(text) ? text : '';
  }
  const entry = ANNOTATION_TAGS.find((t) => t.id === tag);
  return entry ? translateFor(locale, entry.labelKey) : '';
}
