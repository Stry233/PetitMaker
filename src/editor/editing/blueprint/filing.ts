/** The library's verbs: renaming, filing, arranging, deleting with an Undo, what a drop of carried
 *  cards does, the folders, and exporting blueprints as one file, each saying what the visitor needs
 *  to hear. */
import { listMove } from '../../../core/base/list-move';
import { builtInFolderId, builtInFolderOf, encodeBlueprints } from '../../../io/blueprint';
import type { BlueprintPlace } from '../../../io/storage/blueprint-library';
import { downloadJSON, exportFileName, safeName } from '../../../io/export/download';
import { translate } from '../../../i18n/context';
import { FOLDER_NAMES } from '../../../config/blueprints/names';
import { SUPPORTS_JSON_FILES } from '../../../platform/build/edition';
import { showToast } from '../../../platform/channels/toast-bus';
import { newestSaved } from '../../../state/blueprint-library-view';
import { stepDelete } from '../../../state/slices/blueprint';
import { useEditorStore } from '../../../state/store';
import { blueprintFolderVerbs } from './folders';
import { arrangeShown, editorBlueprintLibrary, written } from './library';
import { blueprintFolderName, shownBlueprints, shownFolderNames } from './names';

const store = () => useEditorStore.getState();

/** Renames blueprint `id`; a blank name changes nothing. */
export function renameBlueprint(id: string, name: string): Promise<boolean> {
  return written(editorBlueprintLibrary().rename(id, name));
}

/** Files the blueprints `ids` under `folder`, made when missing, or under none with null. */
export function moveBlueprints(ids: readonly string[], folder: string | null): Promise<boolean> {
  return written(editorBlueprintLibrary().move(ids, folder));
}

/** Files the blueprints `ids` under `folder`, as a card dropped on it or the selection menu's move
 *  does, and says which folder they went to; taken out of every folder with null, which names none. */
export async function fileBlueprints(ids: readonly string[], folder: string | null): Promise<boolean> {
  const moved = await moveBlueprints(ids, folder);
  if (moved && folder !== null) showToast(translate('blueprint.moved', { n: ids.length, folder: blueprintFolderName(folder) }), 'info');
  return moved;
}

/** Files the blueprints `ids` under the folder of blueprints set aside for deletion, named in the
 *  interface language and made when no folder shows that name, and says where they went; the player
 *  deletes that folder or takes them back out. The folder used, or null when nothing moved. */
export async function setAsideBlueprints(ids: readonly string[]): Promise<string | null> {
  const name = translate(FOLDER_NAMES.pendingDelete);
  const folder = editorBlueprintLibrary().folders().find((f) => blueprintFolderName(f) === name) ?? addBlueprintFolder(name);
  return folder && await fileBlueprints(ids, folder) ? folder : null;
}

/** Moves the blueprints `ids` to `at` in the library's one order, as a card dropped among the others
 *  does; `shownBlueprints` shows them moved at once, while the library writes it. */
export function arrangeBlueprints(ids: readonly string[], at: BlueprintPlace): Promise<boolean> {
  return arrangeShown(ids, at);
}

/** Removes the blueprints `ids` from the library, as a card dropped on the delete target does, and
 *  says what went with an Undo that stores them back as they were. */
export async function deleteBlueprints(ids: readonly string[]): Promise<boolean> {
  const lib = editorBlueprintLibrary();
  const gone = lib.records().filter((r) => ids.includes(r.id));
  if (gone.length === 0) return false;
  const shown = shownBlueprints().filter((r) => ids.includes(r.id));
  if (!(await written(lib.remove(ids)))) return false;
  const text = shown.length === 1 ? translate('blueprint.deleted_named', { name: shown[0]!.name }) : translate('blueprint.deleted', { n: gone.length });
  showToast(text, 'info', {
    label: translate('shortcut.undo'),
    run: () => { void written(Promise.all(gone.map((r) => lib.save(r))).then(() => {})); },
  });
  return true;
}

/** Where carried cards are let go: on a folder, on the delete target, among the cards a scroller shows
 *  (`ids` in the order shown, before the `at`th), or anywhere else. */
export type BlueprintDrop =
  | { readonly on: 'folder'; readonly folder: string }
  | { readonly on: 'bin' }
  | { readonly on: 'cards'; readonly ids: readonly string[]; readonly at: number }
  | { readonly on: 'elsewhere' };

/** The carry of a single card to the map (`carryBlueprint`): given up, or let go where it stands,
 *  which over the map places the card. */
interface MapCarryEnd { cancel(): void; release(): void }

/**
 * Lets go of the carried blueprints `ids` at `drop`: a folder files them there and the delete target
 * deletes them with an Undo; among cards where that moves them, they move to that place in the
 * library's one order, which `shownBlueprints` shows at once; anywhere else, or among cards they would
 * not move, `toMap` lets go where it stands. Every other drop gives up `toMap` first. The write of a
 * move among cards, null for any other drop.
 */
export function dropBlueprints(ids: readonly string[], drop: BlueprintDrop, toMap: MapCarryEnd | null): { written: Promise<boolean> } | null {
  if (drop.on === 'folder') { toMap?.cancel(); void fileBlueprints(ids, drop.folder); return null; }
  if (drop.on === 'bin') { toMap?.cancel(); void deleteBlueprints(ids); return null; }
  const move = drop.on === 'cards' ? listMove(drop.ids, ids, drop.at) : null;
  if (!move) { toMap?.release(); return null; }
  toMap?.cancel();
  return { written: arrangeBlueprints(ids, move.place) };
}

/** Deletes the blueprints selected in the unfolded library, as a drop on the delete target does, and
 *  leaves nothing selected; whether any were. */
export function deleteSelectedBlueprints(): boolean {
  const meaning = stepDelete(store().blueprintStep);
  if (meaning.means !== 'blueprints') return false;
  const shown = new Set(shownBlueprints().map((r) => r.id));
  const ids = meaning.ids.filter((id) => shown.has(id));
  if (ids.length === 0) return false;
  store().setBlueprintUi({ selected: [] });
  void deleteBlueprints(ids);
  return true;
}

/** Adds a folder named `name`, numbered when a folder shows that name; the name used, or '' for a blank name. */
export function addBlueprintFolder(name: string): string {
  return editorBlueprintLibrary().addFolder(name, shownFolderNames());
}

/** Renames folder `from` to `to` with its blueprints, keeping it open when it was, the Examples folder
 *  keeping its role under the new name; 'fixed' for a folder whose name cannot change, 'taken' when `to`
 *  is blank or a name a folder shows, 'failed' when the browser refused the write. */
export async function renameBlueprintFolder(from: string, to: string): Promise<'renamed' | 'fixed' | 'taken' | 'failed'> {
  if (!blueprintFolderVerbs(from).includes('rename')) return 'fixed';
  const name = to.trim();
  if (!name || shownFolderNames().includes(name)) return 'taken';
  const target = builtInFolderOf(from)?.role === 'examples' ? builtInFolderId({ role: 'examples', name }) : name;
  let renamed = false;
  if (!(await written(editorBlueprintLibrary().renameFolder(from, target).then((done) => { renamed = done; })))) return 'failed';
  if (!renamed) return 'taken';
  if (store().blueprint.folder === from) store().setBlueprintUi({ folder: target });
  return 'renamed';
}

/** Removes folder `name` and every blueprint in it, opening All when it was open; nothing for a
 *  folder that cannot be deleted. */
export async function deleteBlueprintFolder(name: string): Promise<boolean> {
  if (!blueprintFolderVerbs(name).includes('delete')) return false;
  const removed = await written(editorBlueprintLibrary().removeFolder(name));
  if (removed && store().blueprint.folder === name) store().setBlueprintUi({ folder: null, selected: [] });
  return removed;
}

/** What an export of blueprints takes from whoever asks for it. */
interface BlueprintExportHooks {
  /** The responsibility notice every export opens; resolves whether it was accepted. */
  confirmNotice: () => Promise<boolean>;
}

/** How an export of blueprints ended: the file written with that many blueprints, an edition that
 *  writes no files, nothing to export, or a notice that was not accepted. */
type BlueprintExportOutcome = { exported: number } | 'no-files' | 'none' | 'declined';

/** Downloads the blueprints `ids` names, or a whole folder, as one file once `hooks.confirmNotice`
 *  was accepted, with shown texts only, newest saved first, so a file never carries the library's own
 *  order; nothing where the edition writes no files, and nothing to export asks no notice. The file
 *  holds what the library showed as the notice was asked. A file of several names each one's folder as
 *  shown but My Blueprints, and a file of one names none, so the importer files them under their authors. */
export async function exportBlueprints(which: readonly string[] | { folder: string }, hooks: BlueprintExportHooks): Promise<BlueprintExportOutcome> {
  if (!SUPPORTS_JSON_FILES) return 'no-files';
  const chosen = [...shownBlueprints()].sort(newestSaved)
    .filter((r) => ('folder' in which ? r.folder === which.folder : which.includes(r.id)));
  if (chosen.length === 0) return 'none';
  const named = (folder: string | null): string | null =>
    (chosen.length === 1 || folder === null || builtInFolderOf(folder)?.role === 'mine' ? null : blueprintFolderName(folder));
  const records = chosen.map((r) => ({ ...r, folder: named(r.folder) }));
  const folder = 'folder' in which ? blueprintFolderName(which.folder) : undefined;
  const name = folder ?? (records.length === 1 ? records[0]!.name : null);
  const parts = name !== null ? [safeName(name, 'blueprint')] : ['blueprints', records.length];
  if (!(await hooks.confirmNotice())) return 'declined';
  downloadJSON(encodeBlueprints(records), exportFileName(parts, 'blueprint.json'));
  return { exported: records.length };
}
