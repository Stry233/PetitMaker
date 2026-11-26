// @vitest-environment jsdom
/** A file of several blueprints carries each one's folder, so importing it recreates those folders; a
 *  file of one, or a blueprint in no folder, carries none and lands in its author's folder; an older
 *  file with one folder for the whole file still lands as it did. */
import { beforeEach, expect, vi } from 'vitest';
import { spec } from '../../_support/spec';
import { blueprintFolderName, exportBlueprints, importBlueprintFile, shownBlueprints } from '../../../editor/editing/blueprint';
import { reviewBlueprintText } from '../../../editor/review/edition-review';
import { __resetBackgroundReviews } from '../../../pipelines/moderation/text/background-review';
import type { BlueprintRecord } from '../../../io/blueprint';
import { useEditorStore } from '../../../state/store';
import { blueprintEditor } from './_blueprints';

vi.mock('../../../pipelines/moderation/text/reviewer', async (original) => ({
  ...(await original<typeof import('../../../pipelines/moderation/text/reviewer')>()),
  reviewText: vi.fn(async () => ({ allowed: true })),
}));

const download = vi.hoisted(() => ({ downloadJSON: vi.fn() }));
vi.mock('../../../io/export/download', async (original) => ({
  ...(await original<typeof import('../../../io/export/download')>()),
  downloadJSON: download.downloadJSON,
}));

const editor = blueprintEditor();

/** The export notice, accepted. */
const ACCEPTED = { confirmNotice: async () => true };

const BODY: BlueprintRecord['body'] = { w: 1, h: 1, cells: [null, null, null, null], objects: [] };
const record = (id: string, name: string, folder: string | null, savedAt: number): BlueprintRecord => ({
  id, name, folder, author: 'Ann', origin: null, savedAt, appVersion: 'x', body: BODY, thumbs: { flat: '', lifted: '' },
});

beforeEach(async () => {
  __resetBackgroundReviews();
  download.downloadJSON.mockReset();
  useEditorStore.setState({ locale: 'en' });
  await editor.lib().save(record('a', 'Harbour', 'Docks', 4));
  await editor.lib().save(record('b', 'Garden corner', 'Gardens', 3));
  await editor.lib().save(record('c', 'Market street', null, 2));
  await editor.lib().save(record('d', 'Pier', 'Docks', 1));
});

/** The last file exported: each record's name and folder. */
function exported(): { text: string; records: [string, unknown][] } {
  const text = download.downloadJSON.mock.calls.at(-1)![0] as string;
  const file = JSON.parse(text) as { records: { name: string; folder?: unknown }[] };
  return { text, records: file.records.map((r) => [r.name, r.folder ?? null]) };
}

/** Empties the library, as another browser's would be, with `open` the folder open in it. */
async function anotherBrowser(open: string | null = null): Promise<void> {
  await editor.lib().remove(editor.lib().records().map((r) => r.id));
  for (const f of editor.lib().folders()) await editor.lib().removeFolder(f);
  if (open !== null) editor.lib().addFolder(open);
  useEditorStore.getState().setBlueprintUi({ folder: open, selected: [] });
}

const filed = (): [string, string | null][] => shownBlueprints().map((r) => [r.name, r.folder === null ? null : blueprintFolderName(r.folder)]);

spec('BLUE-11', 'a file of one blueprint carries no folder, and one of several, a selection, a folder or the whole library, each blueprint\'s', async () => {
  await exportBlueprints(['a'], ACCEPTED);
  expect(exported().records).toEqual([['Harbour', null]]);
  await exportBlueprints(['a', 'b', 'c'], ACCEPTED);
  expect(exported().records).toEqual([['Harbour', 'Docks'], ['Garden corner', 'Gardens'], ['Market street', null]]);
  await exportBlueprints({ folder: 'Docks' }, ACCEPTED);
  expect(exported().records).toEqual([['Harbour', 'Docks'], ['Pier', 'Docks']]);
  await exportBlueprints(['a', 'b', 'c', 'd'], ACCEPTED);
  expect(exported().records).toEqual([['Harbour', 'Docks'], ['Garden corner', 'Gardens'], ['Market street', null], ['Pier', 'Docks']]);
});

spec('BLUE-11', 'an export writes no file unless its notice was accepted, whoever asks for it', async () => {
  const asked = vi.fn(async () => false);
  expect(await exportBlueprints(['a'], { confirmNotice: asked })).toBe('declined');
  expect(await exportBlueprints({ folder: 'Docks' }, { confirmNotice: asked })).toBe('declined');
  expect(asked).toHaveBeenCalledTimes(2);
  expect(download.downloadJSON).not.toHaveBeenCalled();
  // Nothing to export asks nothing.
  expect(await exportBlueprints(['missing'], { confirmNotice: asked })).toBe('none');
  expect(asked).toHaveBeenCalledTimes(2);
  expect(await exportBlueprints(['a'], ACCEPTED)).toEqual({ exported: 1 });
  expect(download.downloadJSON).toHaveBeenCalledOnce();
});

spec('BLUE-11', 'importing a file recreates its blueprints\' folders, and one in none lands in its author\'s folder, not the folder open', async () => {
  await exportBlueprints(['a', 'b', 'c', 'd'], ACCEPTED);
  const { text } = exported();
  await anotherBrowser('Paths');
  expect(await importBlueprintFile(text)).toBe(true);
  await reviewBlueprintText();
  expect([...editor.lib().folders().map(blueprintFolderName)].sort()).toEqual(["Ann's Blueprints", 'Docks', 'Gardens', 'Paths']);
  expect(filed()).toEqual([['Harbour', 'Docks'], ['Garden corner', 'Gardens'], ['Market street', "Ann's Blueprints"], ['Pier', 'Docks']]);
  // Landing in several folders, it opens on All.
  expect(useEditorStore.getState().blueprint.folder).toBeNull();
});

spec('BLUE-11', 'an older file with one folder for the whole file still lands there, and one without in the folder open', async () => {
  await anotherBrowser('Paths');
  const older = (folder: string | undefined, records: BlueprintRecord[]): string => JSON.stringify({
    format: 'petitmaker.blueprint', version: 1, ...(folder !== undefined ? { folder } : {}), records,
  });
  await importBlueprintFile(older(undefined, [record('z', 'Well', 'Old', 3)]));
  await importBlueprintFile(older('Farm', [record('x', 'Barn', 'Old', 2), record('y', 'Silo', null, 1)]));
  await reviewBlueprintText();
  expect([...editor.lib().folders()].sort()).toEqual(['Farm', 'Paths']);
  expect(filed()).toEqual([['Barn', 'Farm'], ['Silo', 'Farm'], ['Well', 'Paths']]);
});
