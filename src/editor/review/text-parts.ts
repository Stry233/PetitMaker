// What a single named field sends to the text check, kept apart from the check itself so an edition
// without the check's worker can still name its fields.
import { needsTextReview, type TextField, type TextPart } from '../../pipelines/moderation/facts';

/** The parts a single named field sends to the check: none for the text the thing already carries,
 *  or for text the check never needs to see. */
export function reviewedTextParts(text: string, known: string, field: TextField): TextPart[] {
  const trimmed = text.trim();
  return trimmed !== known.trim() && needsTextReview(trimmed) ? [{ field, text: trimmed }] : [];
}
