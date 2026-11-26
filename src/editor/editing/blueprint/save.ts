/** Saving a framed region of a map as a blueprint record, from the open map's save step or into any
 *  library the sandbox world keeps. */
import type { Rect } from '../../../core/grid/rect';
import type { GridState } from '../../../core/model/types';
import { blueprintThumbs, MY_FOLDER, type BlueprintRecord, type ThumbView } from '../../../io/blueprint';
import { newBlueprintId, type BlueprintLibrary } from '../../../io/storage/blueprint-library';
import { APP_VERSION } from '../../../platform/build/build-info';
import { writePref } from '../../../platform/storage/prefs';
import { blueprintSavable } from '../../../state/slices/shell';
import { useEditorStore } from '../../../state/store';
import { captureBlueprint, type CaptureRefusal } from '../../../tools/blueprint';
import { adaptedFrom, authorAllowed, lastBlueprintAuthor, originFor, seedOf } from './authorship';
import { holdsOwnBlueprints } from './folders';
import { blueprintFolders, editorBlueprintLibrary, openBlueprintFolder, sayWriteFailed } from './library';
import { newBlueprintPlaceholderName, shownBlueprints } from './names';
import { framedView } from './pictures';

const store = () => useEditorStore.getState();

/** What a save step hands over: the frame in object-grid cells, and the name, author and folder typed. */
interface BlueprintDraft {
  readonly frame: Rect;
  readonly name: string;
  /** Null saves anonymously. */
  readonly author: string | null;
  readonly folder: string | null;
  /** How the save step's live pictures framed the two views (`watchFramedThumbs`); each picture
   *  frames the body by itself without it. */
  readonly framing?: ThumbView;
}

/** The save step's fields as typed. */
export interface SaveFields {
  readonly name: string;
  readonly author: string;
  readonly anonymous: boolean;
  readonly folder: string | null;
}

/** The folder the save step offers first: the one open in the strip or the explorer when it holds the
 *  player's own blueprints, else My Blueprints. */
export function defaultSaveFolder(): string | null {
  const open = openBlueprintFolder();
  if (open !== null && holdsOwnBlueprints(open)) return open;
  return blueprintFolders().includes(MY_FOLDER) ? MY_FOLDER : null;
}

/** The author a save of `fields` names: none when anonymous, else the author typed, trimmed. */
export const fieldsAuthor = (fields: Pick<SaveFields, 'author' | 'anonymous'>): string | null => (fields.anonymous ? null : fields.author.trim());

/** The draft the save step's `fields` make of `frame`, its pictures framed as `framing`: a blank name
 *  saves under `placeholder`. */
export function draftOf(frame: Rect, fields: SaveFields, placeholder: string, framing?: ThumbView): BlueprintDraft {
  return { frame, name: fields.name.trim() || placeholder, author: fieldsAuthor(fields), folder: fields.folder, framing };
}

/** Whether the save step may save `fields`: a name typed has passed the text check, as has the author
 *  unless the save is anonymous, and no save is landing. A blank name takes the placeholder, so it
 *  waits on no check. */
export function saveAllowed(fields: SaveFields, approved: { readonly name: boolean; readonly author: boolean }, saving: boolean): boolean {
  return (fields.name.trim() === '' || approved.name) && (fields.anonymous || approved.author) && !saving;
}

/** Captures `draft.frame` of `state`, draws its thumbnails and saves it into `library` naming
 *  `origin` as adapted from unless the saver is that author; the record as stored, or why the frame was refused. */
export async function saveBlueprintTo(
  library: BlueprintLibrary, state: GridState, draft: BlueprintDraft, origin: string | null,
): Promise<BlueprintRecord | CaptureRefusal> {
  const out = captureBlueprint(state, draft.frame);
  if ('refusal' in out) return out.refusal;
  const record: BlueprintRecord = {
    id: newBlueprintId(), name: draft.name, folder: draft.folder, author: draft.author,
    origin: adaptedFrom(origin, draft.author),
    savedAt: Date.now(), appVersion: APP_VERSION, body: out.body,
    thumbs: await blueprintThumbs(out.body, state.template, draft.framing),
  };
  await library.save(record);
  return library.records().find((r) => r.id === record.id) ?? record;
}

/** Why a save stored nothing: the capture's refusal of its frame, or an author this edition does not
 *  let a save name (`authorAllowed`). */
type SaveRefusal = CaptureRefusal | 'author';

/** Saves `draft` from the open map into the library and keeps its author as the one offered next;
 *  the record, or why nothing was saved. */
export async function saveBlueprint(draft: BlueprintDraft): Promise<BlueprintRecord | SaveRefusal> {
  const state = store().gridState;
  if (!state) return 'empty';
  if (!authorAllowed(draft.author)) return 'author';
  const out = await saveBlueprintTo(editorBlueprintLibrary(), state, draft, originFor(draft.frame));
  if (typeof out !== 'string') writePref('blueprintAuthor', draft.author);
  return out;
}

/**
 * The save step's Save: saves `draft`, ends the step and arms the new blueprint on its folder's tab;
 * a write the browser refused says so and leaves the step open. While the save lands nothing backs
 * out of the step or saves again. The record is kept however the step was left meanwhile, since the
 * save was confirmed, but arming, the folder and the step's end land only on the step it was pressed
 * in. Nothing is saved while a Show me stands (`blueprintSavable`). Whether it saved.
 */
export async function saveFramedBlueprint(draft: BlueprintDraft): Promise<boolean> {
  const step = store().blueprintStep;
  if (step.at !== 'save' || !blueprintSavable(store()) || !store().beginBlueprintSave(step.id)) return false;
  let out: BlueprintRecord | SaveRefusal;
  try {
    out = await saveBlueprint(draft);
  } catch (err) {
    sayWriteFailed(err, 'blueprint.write_failed');
    store().failBlueprintSave(step.id);
    return false;
  }
  if (typeof out === 'string') { store().failBlueprintSave(step.id); return false; }
  const record = shownBlueprints().find((r) => r.id === out.id);
  const armed = record ? { id: record.id, body: record.body, seed: seedOf(record, lastBlueprintAuthor()) } : null;
  store().finishBlueprintSave(step.id, { folder: out.folder }, armed);
  return true;
}

/** The save step's Save with `fields`: saves the frame the step stands on (`saveFramedBlueprint`), a
 *  blank name under the numbered default, its pictures framed as the step's live pictures last showed
 *  them; false where no save step stands. */
export function saveFramedFields(fields: SaveFields): Promise<boolean> {
  const step = store().blueprintStep;
  if (step.at !== 'save') return Promise.resolve(false);
  return saveFramedBlueprint(draftOf(step.frame, fields, newBlueprintPlaceholderName(), framedView(step.frame)));
}
