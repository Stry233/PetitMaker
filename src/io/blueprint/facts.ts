// The blueprint files' light constants, for the strip and its windows, which must not pull the
// thumbnail renderers or the codec into the eager bundle.
export { BLUEPRINT_NAME_MAX, EXAMPLES_FOLDER } from './format';

/** The thumbnails' width over height: the picture slot of a Generate card (`ui/shell/bars/generate/generate-shelf.ts:CARD.pic`). */
export const THUMB_ASPECT = 568 / 333;
