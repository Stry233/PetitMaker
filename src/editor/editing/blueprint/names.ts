/** What the page shows of the library's texts: the app's own names in the interface language, and a
 *  numbered placeholder, anonymous or no folder while a text waits for the background review. */
import { builtInFolderOf, type BlueprintRecord, type BlueprintTextPart, type BuiltInFolder } from '../../../io/blueprint';
import { EXAMPLE_BLUEPRINT_NAMES, FOLDER_NAMES } from '../../../config/blueprints/names';
import { LOCALES, type Locale } from '../../../core/model/locale';
import { translate, translateFor } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { newestSaved } from '../../../state/blueprint-library-view';
import { editorBlueprintLibrary, inShownOrder } from './library';

/** The app's own name of `r` in the interface language, its stored name where the app has none for it. */
export function appNameOf(r: BlueprintRecord): string {
  const key = EXAMPLE_BLUEPRINT_NAMES[r.id];
  return key ? translate(key) : r.name;
}

/** The name built-in folder `folder` shows in `locale`: the app's own name, an author's kept as written,
 *  or the name the player gave the examples. */
function builtInFolderName(folder: BuiltInFolder, locale: Locale): string {
  if (folder.role === 'examples') return folder.name ?? translateFor(locale, FOLDER_NAMES.examples);
  if (folder.role === 'mine') return translateFor(locale, FOLDER_NAMES.mine);
  return folder.author === null ? translateFor(locale, FOLDER_NAMES.anonymous) : translateFor(locale, FOLDER_NAMES.author, { author: folder.author });
}

/** Stands for the author in an author folder's name while it is read back out of a name. */
const AUTHOR_MARK = '\u0000';

/** The built-in folder a file's folder name `text` reads as in any interface language: My Blueprints,
 *  the anonymous author's folder or an author's, null for any other name, the examples' too, whose
 *  name a file never takes. */
export function builtInFolderCalled(text: string): BuiltInFolder | null {
  const shows = (folder: BuiltInFolder): boolean => LOCALES.some((l) => builtInFolderName(folder, l) === text);
  if (shows({ role: 'mine' })) return { role: 'mine' };
  if (shows({ role: 'author', author: null })) return { role: 'author', author: null };
  for (const locale of LOCALES) {
    const [before = '', after = ''] = translateFor(locale, FOLDER_NAMES.author, { author: AUTHOR_MARK }).split(AUTHOR_MARK);
    if (text.length <= before.length + after.length || !text.startsWith(before) || !text.endsWith(after)) continue;
    const author = text.slice(before.length, text.length - after.length).trim();
    if (author) return { role: 'author', author };
  }
  return null;
}

/** The name folder `folder` shows: a built-in folder's in the interface language, any other as typed. */
export function blueprintFolderName(folder: string): string {
  const builtIn = builtInFolderOf(folder);
  return builtIn ? builtInFolderName(builtIn, useEditorStore.getState().locale) : folder;
}

/** The numbered default name of the record `n`th counted from the oldest saved, which it shows while
 *  its own waits for review and takes for good when the review refuses that. */
const placeholderName = (n: number): string => translate('blueprint.default_name', { n });

/** `r` as the page may show or write it out: a text still waiting for review reads as its placeholder
 *  (name), anonymous (author and the original author) or none (folder), and the app's own name reads
 *  in the interface language. `n` is the record's place counted from the oldest, so a placeholder
 *  keeps its number as newer blueprints are saved. The folder stays the library's, which
 *  `blueprintFolderName` shows. */
function shownRecord(r: BlueprintRecord, n: number): BlueprintRecord {
  const waiting = (part: BlueprintTextPart): boolean => r.unreviewed?.includes(part) === true;
  const { unreviewed: _held, ...rest } = r;
  return {
    ...rest,
    name: waiting('name') ? placeholderName(n) : r.appName ? appNameOf(r) : r.name,
    author: waiting('author') ? null : r.author,
    origin: waiting('author') ? null : r.origin,
    folder: waiting('folder') ? null : r.folder,
  };
}

/** What a record of the library shows: its name, author and folder once reviewed, and the
 *  placeholder, anonymous or none while they wait. */
export function shownBlueprint(r: BlueprintRecord): { name: string; author: string | null; folder: string | null } {
  const { name, author, folder } = shownRecord(r, savedPlaces(editorBlueprintLibrary().records()).get(r.id) ?? 0);
  return { name, author, folder };
}

/** Each record's place counted from the oldest saved, by id. */
function savedPlaces(all: readonly BlueprintRecord[]): Map<string, number> {
  const newest = [...all].sort(newestSaved);
  return new Map(newest.map((r, i) => [r.id, newest.length - i]));
}

/** The placeholder name record `id` shows while its name waits for review, the one a refused name gives way to. */
export function blueprintPlaceholderName(id: string): string {
  return placeholderName(savedPlaces(editorBlueprintLibrary().records()).get(id) ?? 0);
}

/** The numbered default a blueprint saved now with no name of its own takes: the place it takes
 *  counted from the oldest saved, one past every record saved by now. */
export function newBlueprintPlaceholderName(): string {
  const now = Date.now();
  return placeholderName(editorBlueprintLibrary().records().filter((r) => r.savedAt <= now).length + 1);
}

/** The library's records in its own order, a move among them it has yet to write made already
 *  (`library.ts:inShownOrder`), with every text as the page may show it. Everything that draws or
 *  exports blueprints reads this list; the library's own `records()` is raw, for code that writes
 *  records back. */
export function shownBlueprints(): readonly BlueprintRecord[] {
  const all = editorBlueprintLibrary().records();
  const places = savedPlaces(all);
  return inShownOrder(all).map((r) => shownRecord(r, places.get(r.id) ?? 0));
}

/** Why `name`, trimmed, cannot name folder `folder` among `folders` (null for a new folder): it is
 *  blank, or another folder shows it; null when it can. */
export function folderNameProblem(name: string, folder: string | null, folders: readonly string[]): 'blank' | 'taken' | null {
  if (!name) return 'blank';
  return folders.some((f) => f !== folder && blueprintFolderName(f) === name) ? 'taken' : null;
}

/** The names the library's folders show. */
export const shownFolderNames = (): string[] => editorBlueprintLibrary().folders().map(blueprintFolderName);
