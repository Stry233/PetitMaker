// @vitest-environment jsdom
/** The examples a new library starts with: given once on the first load, their folder's and their
 *  names following the interface language until the player gives them their own, ordinary blueprints
 *  otherwise, given again after a full reset, and never held for the text review; how they lay on the
 *  ground: `examples.slow.test.ts`. */
import { beforeEach, expect, vi } from 'vitest';
import { spec } from '../../_support/spec';
import { createBlueprintLibrary, memoryBlueprintBackend, type BlueprintBackend, type BlueprintLibrary } from '../../../io/storage/blueprint-library';
import {
  __setBlueprintLibrary, addBlueprintFolder, armBlueprint, blueprintFolderName, blueprintFolders, deleteBlueprintFolder, deleteBlueprints, exportBlueprints,
  importBlueprintFile, moveBlueprints, placeArmedAt, renameBlueprint, renameBlueprintFolder, selectedGroupName, shownBlueprints,
} from '../../../editor/editing/blueprint';
import { giveBlueprintExamples } from '../../../editor/editing/blueprint/examples';
import { reviewBlueprintText } from '../../../editor/review/background';
import { admitBlueprintRecord, EXAMPLES_FOLDER, decodeBlueprints } from '../../../io/blueprint';
import { EXAMPLE_BLUEPRINTS_FILE } from '../../../config/blueprints';
import { wipeLocalData } from '../../../io/storage/local-reset';
import { autosave } from '../../../editor/session/autosave';
import { loadLocale } from '../../../i18n/translations';
import { useEditorStore } from '../../../state/store';
import { setToastPresenter } from '../../../platform/channels/toast-bus';
import { resetStore, setStoreState } from '../../_support/store';
import { world } from '../_world';
import { open } from './_blueprints';

const mem = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  get length() { return mem.size; },
});
vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} });

const reviewed = vi.hoisted(() => ({ texts: [] as string[] }));
vi.mock('../../../pipelines/moderation/text/reviewer', async (original) => ({
  ...(await original<typeof import('../../../pipelines/moderation/text/reviewer')>()),
  reviewText: vi.fn(async (parts: readonly { text: string }[]) => { reviewed.texts.push(...parts.map((p) => p.text)); return { allowed: true }; }),
}));

const download = vi.hoisted(() => ({ downloadJSON: vi.fn() }));
vi.mock('../../../io/export/download', async (original) => ({
  ...(await original<typeof import('../../../io/export/download')>()),
  downloadJSON: download.downloadJSON,
}));

const EN_NAMES = ['Tree Bed', 'Garden Steps', 'Flower Garden', 'Pond with Bridge', 'Hilltop Cottage', 'Orchard',
  'Waterfall Garden', 'Stream Crossing', 'Terraced Hill', 'Village Square', 'Desert Oasis', 'Sports Field'];
const ZH_NAMES = ['树池花坛', '花坛台阶', '花园', '小桥池塘', '山坡小屋', '果园', '瀑布庭院', '溪流渡口', '梯田花坡', '小镇广场', '沙漠绿洲', '运动场'];

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

/** Switches the interface language, its table loaded. */
async function speak(locale: 'en' | 'zh'): Promise<void> {
  await loadLocale(locale);
  setStoreState({ locale });
}

const shownNames = (): string[] => shownBlueprints().map((r) => r.name);
const folderNames = (): string[] => blueprintFolders().map(blueprintFolderName);

/** The file the last export downloaded. */
function exported(): { records: Record<string, unknown>[] } {
  const [json] = download.downloadJSON.mock.calls.at(-1) as [string, string];
  return JSON.parse(json) as { records: Record<string, unknown>[] };
}

/** A page load over `backend`, the browser's blueprint database: the library read afresh, then its
 *  examples given, as `editor/session/install.ts:prepareEditor` does. */
async function load(backend: BlueprintBackend): Promise<BlueprintLibrary> {
  const lib = createBlueprintLibrary(backend);
  restore?.();
  restore = __setBlueprintLibrary(lib);
  await lib.load();
  await giveBlueprintExamples(lib);
  return lib;
}
let restore: (() => void) | undefined;

beforeEach(() => {
  mem.clear();
  resetStore();
  reviewed.texts = [];
  download.downloadJSON.mockReset();
  setToastPresenter(() => {});
  return () => { restore?.(); restore = undefined; };
});

spec('BLUE-13', 'the first load gives an Examples folder of example blueprints by PetitMaker once, their names following the interface language', async () => {
  await speak('zh');
  const db = storedBackend();
  await load(db);
  expect(folderNames()).toEqual(['我的蓝图', '示例']);
  expect(shownNames()).toEqual(ZH_NAMES);
  expect(shownBlueprints().every((r) => r.folder === blueprintFolders()[1] && r.author === 'PetitMaker' && r.origin === null)).toBe(true);

  // A switch of language renames the folder and every example at once.
  await speak('en');
  expect(folderNames()).toEqual(['My Blueprints', 'Examples']);
  expect(shownNames()).toEqual(EN_NAMES);

  // A later load gives nothing more, and the names keep following the language.
  const again = await load(db);
  expect(again.records()).toHaveLength(EN_NAMES.length);
  expect(folderNames()).toEqual(['My Blueprints', 'Examples']);
  await speak('zh');
  expect(folderNames()).toEqual(['我的蓝图', '示例']);
  expect(shownNames()).toEqual(ZH_NAMES);
});

spec('BLUE-13', 'a renamed example or Examples folder keeps the name as typed in every language, and moves keep the names following it', async () => {
  await speak('en');
  const db = storedBackend();
  await load(db);
  const [first, , , fourth] = shownBlueprints();
  await renameBlueprint(first!.id, 'My garden');
  await moveBlueprints([fourth!.id], null);
  expect(await renameBlueprintFolder(blueprintFolders()[1]!, 'Starters')).toBe('renamed');

  await speak('zh');
  await load(db);
  expect(folderNames()).toEqual(['我的蓝图', 'Starters']);
  expect(shownNames()).toEqual(['My garden', ...ZH_NAMES.slice(1)]);
  expect(shownBlueprints().find((r) => r.id === fourth!.id)?.folder).toBeNull();
});

spec('BLUE-13', 'a folder of the name the Examples folder shows is taken, so no two folders read alike', async () => {
  await speak('en');
  await load(storedBackend());
  expect(addBlueprintFolder('Examples')).toBe('Examples 2');
  expect(await renameBlueprintFolder('Examples 2', 'Examples')).toBe('taken');
});

spec('BLUE-11', 'an export of the examples writes their names and folder as the interface language shows them', async () => {
  await speak('zh');
  await load(storedBackend());
  await exportBlueprints({ folder: blueprintFolders()[1]! }, { confirmNotice: async () => true });
  const file = exported();
  expect(file.records.map((r) => r.name).sort()).toEqual([...ZH_NAMES].sort());
  expect(file.records.every((r) => r.folder === '示例' && !('appName' in r))).toBe(true);
  expect(String(download.downloadJSON.mock.calls.at(-1)![1])).toContain('示例');

  // Brought back in the same language it lands in the Examples folder, which holds them already.
  await importBlueprintFile(download.downloadJSON.mock.calls.at(-1)![0] as string);
  expect(folderNames()).toEqual(['我的蓝图', '示例']);
  expect(shownBlueprints()).toHaveLength(EN_NAMES.length);
});

spec('BLUE-13', 'an imported file can never make its names or folder the app\'s own', async () => {
  await speak('en');
  const db = storedBackend();
  await load(db);
  await deleteBlueprints(shownBlueprints().map((r) => r.id));
  const read = decodeBlueprints(EXAMPLE_BLUEPRINTS_FILE);
  if ('error' in read) throw new Error(read.error);
  // A file copying what the library stores for its own: the folder's stored name and the mark.
  const forged = {
    format: 'petitmaker.blueprint', version: 1, folder: EXAMPLES_FOLDER,
    records: [{ ...read.records[0], name: 'Not yours', folder: EXAMPLES_FOLDER, appName: true }],
  };
  expect(await importBlueprintFile(JSON.stringify(forged))).toBe(true);
  await reviewBlueprintText();
  await load(db);
  await speak('zh');
  expect(shownNames()).toEqual(['Not yours']);
  expect(folderNames()).toEqual(['我的蓝图', '示例', EXAMPLES_FOLDER.trim()]);
  expect(shownBlueprints()[0]!.folder).toBe(EXAMPLES_FOLDER.trim());
});

spec('BLUE-13', 'a placed example\'s selection card names it in the interface language', async () => {
  await speak('en');
  await load(storedBackend());
  const w = world();
  open(w);
  const example = shownBlueprints()[0]!;
  armBlueprint(example.id);
  placeArmedAt(w.openGround(example.body.w, example.body.h));
  expect(selectedGroupName(useEditorStore.getState())).toBe(EN_NAMES[0]);
  await speak('zh');
  expect(selectedGroupName(useEditorStore.getState())).toBe(ZH_NAMES[0]);
});

spec('BLUE-13', 'examples are ordinary blueprints: a deleted example never comes back, and the Examples folder stays', async () => {
  const db = memoryBlueprintBackend();
  let lib = await load(db);
  const pond = shownBlueprints().find((r) => r.name === 'Pond with Bridge');
  await deleteBlueprints([pond!.id]);

  lib = await load(db);
  expect(shownNames()).toEqual(EN_NAMES.filter((n) => n !== 'Pond with Bridge'));

  expect(await deleteBlueprintFolder(blueprintFolders()[1]!)).toBe(false);
  await deleteBlueprints(shownBlueprints().map((r) => r.id));
  lib = await load(db);
  expect(lib.records()).toEqual([]);
  expect(folderNames()).toEqual(['My Blueprints', 'Examples']);
});

spec('BLUE-13', 'after Settings, Local data the next load gives the examples again', async () => {
  const lib = await load(memoryBlueprintBackend());
  await deleteBlueprints(shownBlueprints().map((r) => r.id));
  expect(lib.records()).toEqual([]);

  await wipeLocalData(autosave);
  autosave.setSuspended(false);
  // The wipe deleted the browser's blueprint database, so the reload reads an empty one.
  const reloaded = await load(memoryBlueprintBackend());
  expect(reloaded.folders()).toHaveLength(2);
  expect(folderNames()).toEqual(['My Blueprints', 'Examples']);
  expect(shownNames()).toEqual(EN_NAMES);
});

spec('BLUE-13', 'the examples never wait for the background text review', async () => {
  await load(memoryBlueprintBackend());
  await reviewBlueprintText();
  expect(reviewed.texts).toEqual([]);
  expect(shownBlueprints().map((r) => [r.name, r.author, blueprintFolderName(r.folder!)])).toEqual(EN_NAMES.map((n) => [n, 'PetitMaker', 'Examples']));
});
