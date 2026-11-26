/**
 * The share picture's words: its title and description are the map's own, and an image import's
 * protected originals stand over any other (`state/notes-attribution.ts:attributedNotes`). A caller
 * hands a picture its choices only; the export and the preview join the words here.
 */
import type { GridState, MapNotes } from '../../core/model/types';
import { DEFAULT_FOOTER } from '../../io/export/footer-template';
import type { ExportOptions, PictureChoices } from '../../io/export/types';
import { attributedNotes } from '../../state/notes-attribution';

/** `choices` with the words `notes` holds; with null, without the map's own words, as "export
 *  without text" writes them: no title, no description and the stock footer. Joins and decides
 *  nothing: a picture of a map takes its words through `pictureOptions`. */
export function withWords(choices: PictureChoices, notes: MapNotes | null): ExportOptions {
  return notes
    ? { ...choices, title: notes.title ?? '', description: notes.description ?? '' }
    : { ...choices, title: '', description: '', footerTemplate: DEFAULT_FOOTER };
}

/** The options a picture of `state` is composed with: `choices` and `words` with an image import's
 *  protected originals standing over them, so no caller's words displace an attribution; null
 *  composes it without text. Left out, the words are the map's own notes. */
export function pictureOptions(state: GridState, choices: PictureChoices, words: MapNotes | null = state.notes ?? {}): ExportOptions {
  return withWords(choices, words && (attributedNotes(state, words) ?? {}));
}
