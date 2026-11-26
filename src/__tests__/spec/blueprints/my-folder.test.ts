// @vitest-environment jsdom
/** The player's own folder, My Blueprints: there from the first load, never renamed or deleted, named
 *  in the interface language, beside an Examples folder that is never deleted either; and the folders
 *  imported blueprints from someone's My Blueprints land in, named after their authors. */
import { beforeEach, expect, vi } from 'vitest';
import { spec } from '../../_support/spec';
import { createBlueprintLibrary, memoryBlueprintBackend, type BlueprintBackend, type BlueprintLibrary } from '../../../io/storage/blueprint-library';
import {
  __setBlueprintLibrary, addBlueprintFolder, blueprintFolderName, blueprintFolders, deleteBlueprintFolder, deleteBlueprints, exportBlueprints,
  giveBlueprintExamples, importBlueprintFile, moveBlueprints, renameBlueprintFolder, shownBlueprints,
} from '../../../editor/editing/blueprint';
import { reviewBlueprintText } from '../../../editor/review/edition-review';
import { __resetBackgroundReviews } from '../../../pipelines/moderation/text/background-review';
import { admitBlueprintRecord, encodeBlueprints, type BlueprintRecord } from '../../../io/blueprint';
import { LOCALES, type Locale } from '../../../core/model/locale';
import { useEditorStore } from '../../../state/store';
import { wipeLocalData } from '../../../io/storage/local-reset';
import { autosave } from '../../../editor/session/autosave';
import { loadLocale } from '../../../i18n/translations';
import { writePref } from '../../../platform/storage/prefs';
import { setToastPresenter } from '../../../platform/channels/toast-bus';
import { resetStore, setStoreState } from '../../_support/store';

const mem = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  get length() { return mem.size; },
});
vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} });

const review = vi.hoisted(() => ({ refused: new Set<string>() }));
vi.mock('../../../pipelines/moderation/text/reviewer', async (original) => ({
  ...(await original<typeof import('../../../pipelines/moderation/text/reviewer')>()),
  reviewText: vi.fn(async (parts: readonly { text: string }[]) => ({ allowed: !parts.some((p) => review.refused.has(p.text)) })),
}));

const download = vi.hoisted(() => ({ downloadJSON: vi.fn() }));
vi.mock('../../../io/export/download', async (original) => ({
  ...(await original<typeof import('../../../io/export/download')>()),
  downloadJSON: download.downloadJSON,
}));

/** The browser's blueprint database as the page reads it: every record written as JSON and admitted
 *  by the codec's record rules on read. */
function storedBackend(): BlueprintBackend {
  const held = new Map<string, string>();
  return {
    all: async () => [...held.values()].flatMap((json) => { const r = admitBlueprintRecord(JSON.parse(json)); return r ? [r] : []; }),
    put: async (r) => { held.set(r.id, JSON.stringify(r)); },
    remove: async (ids) => { for (const id of ids) held.delete(id); },
    clear: async () => { held.clear(); },
  };
}

let restore: (() => void) | undefined;

/** A page load over `backend`: the library read afresh, then given what a library starts with, as
 *  `editor/session/install.ts:prepareEditor` does. */
async function load(backend: BlueprintBackend): Promise<BlueprintLibrary> {
  const lib = createBlueprintLibrary(backend);
  restore?.();
  restore = __setBlueprintLibrary(lib);
  await lib.load();
  await giveBlueprintExamples(lib);
  return lib;
}

async function speak(locale: 'en' | 'zh'): Promise<void> {
  await loadLocale(locale);
  setStoreState({ locale });
}

/** The export notice, accepted. */
const ACCEPTED = { confirmNotice: async () => true };

const folderNames = (): string[] => blueprintFolders().map(blueprintFolderName);
const namesIn = (folder: string | null): string[] => shownBlueprints().filter((r) => r.folder === folder).map((r) => r.name);
const folderShowing = (name: string): string => {
  const found = blueprintFolders().find((f) => blueprintFolderName(f) === name);
  if (found === undefined) throw new Error(`no folder shows ${name}`);
  return found;
};

const BODY: BlueprintRecord['body'] = { w: 1, h: 1, cells: [null, null, null, null], objects: [] };
const blueprint = (id: string, name: string, folder: string | null, savedAt: number, author: string | null = 'Mei'): BlueprintRecord => ({
  id, name, folder, author, origin: null, savedAt, appVersion: 'x', body: BODY, thumbs: { flat: '', lifted: '' },
});

/** The file the last export downloaded. */
function exported(): { records: Record<string, unknown>[] } {
  const [json] = download.downloadJSON.mock.calls.at(-1) as [string, string];
  return JSON.parse(json) as { records: Record<string, unknown>[] };
}

beforeEach(() => {
  mem.clear();
  resetStore();
  __resetBackgroundReviews();
  review.refused.clear();
  download.downloadJSON.mockReset();
  setToastPresenter(() => {});
  return () => { restore?.(); restore = undefined; };
});

spec('BLUE-13', 'a new library holds an empty My Blueprints folder ahead of Examples, its name following the interface language', async () => {
  await speak('en');
  await load(storedBackend());
  expect(folderNames()).toEqual(['My Blueprints', 'Examples']);
  const [mine] = blueprintFolders();
  expect(namesIn(mine!)).toEqual([]);
  await speak('zh');
  expect(folderNames()).toEqual(['我的蓝图', '示例']);

});

spec('BLUE-11', 'a file of one blueprint names no folder, and one of several names each folder but My Blueprints', async () => {
  await speak('zh');
  await load(storedBackend());
  const [mine, examples] = blueprintFolders();
  const [garden, pond, cottage] = shownBlueprints();
  await moveBlueprints([garden!.id, pond!.id], mine!);
  const folders = (): unknown[] => exported().records.map((r) => r.folder ?? null);
  await exportBlueprints([cottage!.id], ACCEPTED);
  expect(folders()).toEqual([null]);
  await exportBlueprints({ folder: mine! }, ACCEPTED);
  expect(folders()).toEqual([null, null]);
  await exportBlueprints([garden!.id, cottage!.id], ACCEPTED);
  expect(folders()).toEqual([null, '示例']);
  await moveBlueprints([pond!.id], examples!);
  await exportBlueprints({ folder: mine! }, ACCEPTED);
  expect(folders()).toEqual([null]);
});

spec('BLUE-13', 'a library that already exists gains My Blueprints once, its blueprints staying where they are, and again after Settings, Local data', async () => {
  await speak('en');
  const db = storedBackend();
  writePref('blueprintExamplesGiven', true);
  writePref('blueprintFolders', ['Gardens']);
  await db.put(blueprint('t', 'Terrace', 'Gardens', 2));
  await db.put(blueprint('l', 'Lane', null, 1));
  await load(db);
  expect(folderNames()).toEqual(['My Blueprints', 'Gardens']);
  expect(shownBlueprints().map((r) => [r.name, r.folder])).toEqual([['Terrace', 'Gardens'], ['Lane', null]]);
  await load(db);
  expect(folderNames()).toEqual(['My Blueprints', 'Gardens']);

  await wipeLocalData(autosave);
  autosave.setSuspended(false);
  await load(memoryBlueprintBackend());
  expect(folderNames()).toEqual(['My Blueprints', 'Examples']);
  expect(namesIn(blueprintFolders()[0]!)).toEqual([]);
});

spec('BLUE-10', 'no verb renames or deletes My Blueprints or deletes Examples, whose examples still delete one by one', async () => {
  await speak('en');
  const db = storedBackend();
  await load(db);
  const [mine, examples] = blueprintFolders();
  const given = shownBlueprints().map((r) => r.name);
  const [first, second] = shownBlueprints();
  await moveBlueprints([first!.id], mine!);
  expect(await renameBlueprintFolder(mine!, 'Mine')).not.toBe('renamed');
  expect(await deleteBlueprintFolder(mine!)).toBe(false);
  expect(await deleteBlueprintFolder(examples!)).toBe(false);
  await load(db);
  expect(folderNames()).toEqual(['My Blueprints', 'Examples']);
  expect(shownBlueprints()).toHaveLength(given.length);

  // Examples keeps its rename, and stays undeletable under the name typed.
  expect(await renameBlueprintFolder(examples!, 'Starters')).toBe('renamed');
  expect(folderNames()).toEqual(['My Blueprints', 'Starters']);
  expect(await deleteBlueprintFolder(blueprintFolders()[1]!)).toBe(false);
  await deleteBlueprints([second!.id]);
  await load(db);
  expect(folderNames()).toEqual(['My Blueprints', 'Starters']);
  expect(namesIn(blueprintFolders()[1]!)).toEqual(given.slice(2));
});

spec('BLUE-13', 'no other folder takes the name My Blueprints shows', async () => {
  await speak('en');
  await load(storedBackend());
  expect(addBlueprintFolder('My Blueprints')).toBe('My Blueprints 2');
  expect(await renameBlueprintFolder('My Blueprints 2', 'My Blueprints')).toBe('taken');
  await speak('zh');
  expect(addBlueprintFolder('我的蓝图')).toBe('我的蓝图 2');
  expect(folderShowing('我的蓝图')).toBe(blueprintFolders()[0]);
});

/** A fresh browser whose player last saved as Mei, in `locale`. */
async function playerBrowser(locale: 'en' | 'zh' = 'en'): Promise<BlueprintLibrary> {
  mem.clear();
  resetStore();
  __resetBackgroundReviews();
  await speak(locale);
  writePref('blueprintAuthor', 'Mei');
  return load(storedBackend());
}

/** Bob's browser, in `locale`, holding in his My Blueprints a blueprint of his, an anonymous one and
 *  one by Mei; the name his My Blueprints shows. */
async function bobsBrowser(locale: Locale): Promise<string> {
  mem.clear();
  resetStore();
  setStoreState({ locale });
  const bob = await load(storedBackend());
  const [bobs] = blueprintFolders();
  await bob.save(blueprint('b1', 'Terrace', bobs!, 3, 'Bob'));
  await bob.save(blueprint('b2', 'Pond', bobs!, 2, null));
  await bob.save(blueprint('b3', 'Lane', bobs!, 1, 'Mei'));
  return blueprintFolderName(bobs!);
}

spec('BLUE-11', 'a blueprint a file names no folder for lands in its author\'s folder: the player\'s own in My Blueprints, an anonymous one in Anonymous Blueprints', async () => {
  await bobsBrowser('en');
  const unfiled = (ids: string[]): string => encodeBlueprints(shownBlueprints().filter((r) => ids.includes(r.id)).map((r) => ({ ...r, folder: null })));
  const whole = unfiled(['b1', 'b2', 'b3']);
  const single = unfiled(['b1']);

  for (const file of [whole, single]) {
    await playerBrowser();
    useEditorStore.getState().setBlueprintUi({ folder: blueprintFolders()[1]! });
    await importBlueprintFile(file);
    await reviewBlueprintText();
    expect(namesIn(folderShowing("Bob's Blueprints"))).toEqual(['Terrace']);
    if (file === single) continue;
    expect(namesIn(folderShowing('Anonymous Blueprints'))).toEqual(['Pond']);
    expect(namesIn(blueprintFolders()[0]!)).toEqual(['Lane']);
  }
});

spec('BLUE-11', 'a file from another release naming someone\'s My Blueprints in any language files each blueprint under its author, anonymous ones together and the player\'s own in My Blueprints', async () => {
  for (const source of LOCALES) {
    // A file written as an earlier release of this one wrote it, naming My Blueprints as Bob's language shows it.
    const bobsName = await bobsBrowser(source);
    const whole = encodeBlueprints(shownBlueprints().filter((r) => r.id.startsWith('b')).map((r) => ({ ...r, folder: bobsName })));
    const single = encodeBlueprints(shownBlueprints().filter((r) => r.id === 'b1').map((r) => ({ ...r, folder: bobsName })));

    await playerBrowser();
    const [mine] = blueprintFolders();
    await importBlueprintFile(whole);
    // Bob's name has not passed the review yet, so no folder shows it.
    expect(folderNames()).toEqual(['My Blueprints', 'Examples', 'Anonymous Blueprints']);
    expect(shownBlueprints().find((r) => r.id === 'b1')).toMatchObject({ folder: null, author: null });
    await reviewBlueprintText();
    expect({ source, folders: [...folderNames()].sort() }).toEqual({ source, folders: ['Anonymous Blueprints', "Bob's Blueprints", 'Examples', 'My Blueprints'] });
    expect(namesIn(folderShowing("Bob's Blueprints"))).toEqual(['Terrace']);
    expect(namesIn(folderShowing('Anonymous Blueprints'))).toEqual(['Pond']);
    expect(namesIn(mine!)).toEqual(['Lane']);
    await speak('zh');
    expect(namesIn(folderShowing('Bob的蓝图'))).toEqual(['Terrace']);
    expect(namesIn(folderShowing('匿名作者的蓝图'))).toEqual(['Pond']);
    expect(namesIn(folderShowing('我的蓝图'))).toEqual(['Lane']);

    await playerBrowser();
    await importBlueprintFile(single);
    await reviewBlueprintText();
    expect(namesIn(folderShowing("Bob's Blueprints"))).toEqual(['Terrace']);
  }
});

spec('BLUE-11', 'a file from an author\'s folder, as any language shows it, lands in that author\'s one folder, the player\'s own name in My Blueprints', async () => {
  await playerBrowser();
  const [mine] = blueprintFolders();
  const fileIn = (folder: string, id: string): string => encodeBlueprints([blueprint(id, `Plot ${id}`, folder, 1, 'Ann')]);
  await importBlueprintFile(fileIn('Selka的蓝图', 'a'));
  await importBlueprintFile(fileIn("Selka's Blueprints", 'b'));
  await importBlueprintFile(fileIn('Modèles de Selka', 'c'));
  await importBlueprintFile(fileIn('Анонимные чертежи', 'd'));
  await importBlueprintFile(fileIn('Meiのブループリント', 'e'));
  await reviewBlueprintText();
  expect(folderNames().filter((n) => n.includes('Selka'))).toEqual(["Selka's Blueprints"]);
  expect(namesIn(folderShowing("Selka's Blueprints")).sort()).toEqual(['Plot a', 'Plot b', 'Plot c']);
  expect(namesIn(folderShowing('Anonymous Blueprints'))).toEqual(['Plot d']);
  expect(namesIn(mine!)).toEqual(['Plot e']);
  await speak('zh');
  expect(namesIn(folderShowing('Selka的蓝图')).sort()).toEqual(['Plot a', 'Plot b', 'Plot c']);
});

spec('BLUE-11', 'an author\'s folder never shows an author name the review has not approved', async () => {
  await playerBrowser();
  review.refused.add('Rude');
  await importBlueprintFile(encodeBlueprints([
    blueprint('r', 'Terrace', 'My Blueprints', 2, 'Rude'), blueprint('k', 'Pond', 'My Blueprints', 1, 'Kai'),
  ]));
  expect(folderNames()).toEqual(['My Blueprints', 'Examples']);
  await reviewBlueprintText();
  expect(folderNames()).toEqual(['My Blueprints', 'Examples', "Kai's Blueprints"]);
  // A refused author is anonymous for good, and its blueprint in no folder.
  expect(shownBlueprints().find((r) => r.id === 'r')).toMatchObject({ author: null, folder: null });
  expect(folderNames().some((n) => n.includes('Rude'))).toBe(false);
});

spec('BLUE-13', 'no other folder takes the name an author\'s folder shows', async () => {
  await playerBrowser();
  await importBlueprintFile(encodeBlueprints([blueprint('k', 'Pond', 'My Blueprints', 1, 'Kai')]));
  await reviewBlueprintText();
  expect(addBlueprintFolder("Kai's Blueprints")).toBe("Kai's Blueprints 2");
  expect(await renameBlueprintFolder("Kai's Blueprints 2", "Kai's Blueprints")).toBe('taken');
  // An author's folder is otherwise ordinary: renamed, it keeps the name typed.
  expect(await renameBlueprintFolder(folderShowing("Kai's Blueprints"), 'Friends')).toBe('renamed');
  expect(await deleteBlueprintFolder('Friends')).toBe(true);
});
