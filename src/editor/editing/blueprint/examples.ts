/*
 * What a library is given: My Blueprints whenever it lacks it, which nothing removes, so a library gets
 * it once and again after a full local reset; and the first time this browser's library loads, the
 * app's own folder (`EXAMPLES_FOLDER`) of the app's example blueprints, each keeping the app's name, so
 * the folder and the examples show in the interface language until the player renames them; from then
 * on the examples are ordinary blueprints. A full local reset forgets that they were given, so the next
 * load gives them again. They are the app's own content, so none of their texts waits for the
 * background review, and their pictures are drawn as an imported blueprint's are
 * (`pictures.ts:watchBlankThumbs`).
 */
import { decodeBlueprints, EXAMPLES_FOLDER, MY_FOLDER } from '../../../io/blueprint';
import type { BlueprintLibrary } from '../../../io/storage/blueprint-library';
import { prefStorageAvailable, readPref, writePref } from '../../../platform/storage/prefs';

/** Gives the loaded `library` My Blueprints, and the examples unless this browser's library already
 *  had them; resolves once they are stored, and rejects, to try again on the next load, when a write fails. */
export async function giveBlueprintExamples(library: BlueprintLibrary): Promise<void> {
  library.holdFolder(MY_FOLDER);
  // Where the mark cannot be kept, examples given on every load would bring deleted ones back.
  if (readPref('blueprintExamplesGiven') || !prefStorageAvailable()) return;
  const { EXAMPLE_BLUEPRINTS_FILE } = await import('../../../config/blueprints');
  const read = decodeBlueprints(EXAMPLE_BLUEPRINTS_FILE);
  if ('error' in read) throw new Error(`the example blueprints do not read: ${read.error}`);
  for (const r of read.records) await library.save({ ...r, folder: EXAMPLES_FOLDER, appName: true });
  writePref('blueprintExamplesGiven', true);
}
