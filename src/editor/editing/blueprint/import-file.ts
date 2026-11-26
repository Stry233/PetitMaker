/** A blueprint file brought in: each record joins the library in the folder the file names for it, a
 *  blueprint the file files under no folder or someone's My Blueprints in its author's (an older file's
 *  in the folder open), with pictures drawn afresh, and the folder they landed in opens once the page
 *  shows it. */
import { blueprintThumbs, builtInFolderId, decodeBlueprints, MY_FOLDER, type BlueprintRecord } from '../../../io/blueprint';
import { LOCALES } from '../../../core/model/locale';
import { translate } from '../../../i18n/context';
import { loadLocale } from '../../../i18n/translations';
import { showToast } from '../../../platform/channels/toast-bus';
import { useEditorStore } from '../../../state/store';
import { lastBlueprintAuthor } from './authorship';
import { editorBlueprintLibrary, sayWriteFailed, shownOpenFolder } from './library';
import { blueprintFolderName, builtInFolderCalled } from './names';
import type { BlueprintThumbs } from './pictures';

const store = () => useEditorStore.getState();

/** The folder of `author`'s blueprints in this library: My Blueprints for the author the player saves
 *  as, the anonymous folder for none. */
function authorFolder(author: string | null): string {
  return author !== null && author === lastBlueprintAuthor() ? MY_FOLDER : builtInFolderId({ role: 'author', author });
}

/** The folder a record whose file names folder `text` lands in: the author's own for My Blueprints, the
 *  author folder an author folder's name reads as, else the folder holding that name, else the one
 *  showing it, else a new one of that name. */
function folderCalled(text: string, author: string | null): string {
  const builtIn = builtInFolderCalled(text);
  if (builtIn?.role === 'mine') return authorFolder(author);
  if (builtIn?.role === 'author') return authorFolder(builtIn.author);
  const folders = editorBlueprintLibrary().folders();
  return folders.includes(text) ? text : (folders.find((f) => blueprintFolderName(f) === text) ?? text);
}

/** No pictures: what a record holds where none could be drawn, which a card shows as a blank face. */
const NO_THUMBS: BlueprintThumbs = { flat: '', lifted: '' };

/** Opens `folder`, which an import made, once its review approves it, unless another folder is chosen
 *  first or the review refuses it. */
function openOnceShown(folder: string): void {
  store().awaitBlueprintFolder(folder);
  const stops: (() => void)[] = [];
  const stop = (): void => { for (const s of stops.splice(0)) s(); };
  const check = (): void => {
    if (store().blueprint.awaitedFolder !== folder) { stop(); return; }
    // A refused folder leaves its records before it leaves the folder list.
    if (!editorBlueprintLibrary().records().some((r) => r.folder === folder)) { stop(); store().awaitBlueprintFolder(null); return; }
    if (editorBlueprintLibrary().folders().includes(folder)) { stop(); store().setBlueprintUi({ folder, selected: [] }); }
  };
  stops.push(editorBlueprintLibrary().subscribe(check), useEditorStore.subscribe((s) => { if (s.blueprint.awaitedFolder !== folder) stop(); }));
}

/** Adds a blueprint file's records to the library, each into the folder the file names for it, else its
 *  author's, or an older file's into the folder open as it was dropped while the library still holds it, says how many it added and how many
 *  it already held, and opens the folder they all landed in once the page shows it, or once its review
 *  approves it, unless another folder was chosen since the drop. Their pictures are drawn afresh on the
 *  open map's template, never taken from the file, and their texts wait for the background review.
 *  Whether the file was a blueprint file at all. */
export async function importBlueprintFile(text: string): Promise<boolean> {
  const read = decodeBlueprints(text);
  if ('error' in read) {
    showToast(translate(read.error === 'too-new' ? 'blueprint.import_future' : 'blueprint.import_failed'), 'error');
    return false;
  }
  const opened = store().blueprint.folder;
  const into = shownOpenFolder(opened);
  const template = store().gridState?.template;
  try {
    // A folder's name reads as the app's own in any language, so every table is read.
    if (read.records.some((r) => r.folder !== null)) await Promise.allSettled(LOCALES.map(loadLocale));
    const records: BlueprintRecord[] = [];
    for (const r of read.records) {
      const folder = r.folder !== null ? folderCalled(r.folder, r.author) : read.unfiled === 'author-folder' ? authorFolder(r.author) : null;
      records.push({ ...r, folder, thumbs: template ? await blueprintThumbs(r.body, template) : NO_THUMBS });
    }
    const { added, skipped, folder } = await editorBlueprintLibrary().importRecords(records, into);
    if (added > 0) showToast(translate('blueprint.imported', { n: added }), 'info');
    if (skipped > 0) showToast(translate('blueprint.import_skipped', { n: skipped }), 'info');
    if (store().blueprint.folder !== opened) return true;
    store().setBlueprintUi({ folder: shownOpenFolder(folder) });
    if (added > 0 && folder !== null && shownOpenFolder(folder) === null) openOnceShown(folder);
    return true;
  } catch (err) {
    sayWriteFailed(err, 'blueprint.import_storage_failed');
    return false;
  }
}
