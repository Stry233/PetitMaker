/** The blueprint file's wire contract: one JSON shape for a library record and an exported file. */
import { clampText } from '../../core/base/text';
import type { BlueprintBody } from '../../tools/blueprint';

export const BLUEPRINT_FILE_FORMAT = 'petitmaker.blueprint';
/** Append-only: a breaking change adds a reader for the older version and raises this. Version 1
 *  files each name one folder for every record they hold, or none; from version 2 each record's own
 *  `folder` names where it lands, and one naming none lands in its author's folder. */
export const BLUEPRINT_FILE_VERSION = 2;

/** The longest blueprint, folder or author name a record keeps, in UTF-16 units. */
export const BLUEPRINT_NAME_MAX = 40;
/** Records one file may hold. */
export const BLUEPRINT_FILE_MAX_RECORDS = 500;
/** Longest thumbnail data URL kept, in characters. */
export const BLUEPRINT_THUMB_MAX_CHARS = 200_000;

/** The app's own folders, each with a role: the examples, under the name the player gave it once
 *  renamed; the player's own; and the folder of an author's imported blueprints, an anonymous
 *  author's for null. */
export type BuiltInFolder =
  | { readonly role: 'examples'; readonly name: string | null }
  | { readonly role: 'mine' }
  | { readonly role: 'author'; readonly author: string | null };

// Every stored id of a built-in folder starts with a space, and every typed or file-borne name is
// trimmed, so no name can equal one and no file can carry one.
export const EXAMPLES_FOLDER = ' examples';
export const MY_FOLDER = ' mine';
const ANONYMOUS_FOLDER = ' anonymous';
const RENAMED_EXAMPLES = ' examples:';
const AUTHOR_FOLDER = ' author:';

/** A name as a record keeps it: trimmed and at most `BLUEPRINT_NAME_MAX` long, or null when nothing is left. */
const keptName = (name: string): string | null => clampText(name, BLUEPRINT_NAME_MAX);

/** The stored id of `folder`. */
export function builtInFolderId(folder: BuiltInFolder): string {
  if (folder.role === 'mine') return MY_FOLDER;
  if (folder.role === 'examples') {
    const name = folder.name === null ? null : keptName(folder.name);
    return name === null ? EXAMPLES_FOLDER : RENAMED_EXAMPLES + name;
  }
  const author = folder.author === null ? null : keptName(folder.author);
  return author === null ? ANONYMOUS_FOLDER : AUTHOR_FOLDER + author;
}

/** The built-in folder stored as `id`, or null for a folder named as typed. */
export function builtInFolderOf(id: string): BuiltInFolder | null {
  if (id === EXAMPLES_FOLDER) return { role: 'examples', name: null };
  if (id === MY_FOLDER) return { role: 'mine' };
  if (id === ANONYMOUS_FOLDER) return { role: 'author', author: null };
  const named = (prefix: string): string | null => {
    if (!id.startsWith(prefix)) return null;
    const name = id.slice(prefix.length);
    return keptName(name) === name ? name : null;
  };
  const examples = named(RENAMED_EXAMPLES);
  if (examples !== null) return { role: 'examples', name: examples };
  const author = named(AUTHOR_FOLDER);
  return author !== null ? { role: 'author', author } : null;
}

/** The text of folder `folder` that came from outside and the review reads: an author folder's
 *  author, a typed folder's name, nothing for the app's own names. */
export function folderReviewText(folder: string | null): string {
  if (folder === null) return '';
  const builtIn = builtInFolderOf(folder);
  if (builtIn === null) return folder;
  return builtIn.role === 'author' ? builtIn.author ?? '' : '';
}

/** The texts of a record that arrive from outside: its name, its author with the original author it
 *  adapts, and its folder. */
export type BlueprintTextPart = 'name' | 'author' | 'folder';

export interface BlueprintRecord {
  readonly id: string;
  readonly name: string;
  readonly folder: string | null;
  /** The saver's name; null reads as anonymous. */
  readonly author: string | null;
  /** The original author when this blueprint adapts someone else's, else null; never a chain. */
  readonly origin: string | null;
  readonly savedAt: number;
  readonly appVersion: string;
  readonly body: BlueprintBody;
  /** Data URLs of the flat (2D) and lifted (3D) views; empty strings until rendered. */
  readonly thumbs: { readonly flat: string; readonly lifted: string };
  /** The texts still waiting for the background text review; absent once none is. Kept in the
   *  library only: a file neither carries nor can claim it. */
  readonly unreviewed?: readonly BlueprintTextPart[];
  /** Set while the name is the app's own, which shows in the interface language; a rename drops it.
   *  Kept in the library only: a file neither carries nor can claim it. */
  readonly appName?: true;
}

/** The text the review reads for `part` of `r`: an author's text includes the original author. */
export function blueprintPartText(r: Pick<BlueprintRecord, 'name' | 'author' | 'origin' | 'folder'>, part: BlueprintTextPart): string {
  if (part === 'name') return r.name;
  if (part === 'folder') return folderReviewText(r.folder);
  return [r.author, r.origin].filter((t): t is string => t !== null).join('\n');
}

export type BlueprintFileError = 'not-blueprint' | 'too-new' | 'malformed';
