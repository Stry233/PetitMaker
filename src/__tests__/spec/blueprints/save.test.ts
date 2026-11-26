// @vitest-environment jsdom
/** Saving a framed region as a blueprint: what the record keeps, the author offered next time, and
 *  the 改编自 a frame holding another author's placement names. */
import { expect } from 'vitest';
import { spec } from '../../_support/spec';
import { armBlueprint, importBlueprintFile, lastBlueprintAuthor, originFor, placeArmedAt, saveBlueprint } from '../../../editor/editing/blueprint';
import { useEditorStore } from '../../../state/store';
import { createGridState } from '../../../core/model/template';
import { getMapTemplate } from '../../../config/maps';
import { createDefaultRegistry } from '../../../rules';
import { writePref } from '../../../platform/storage/prefs';
import { APP_VERSION } from '../../../platform/build/build-info';
import { open, scene, blueprintEditor } from './_blueprints';
import { encodeBlueprints, type BlueprintRecord } from '../../../io/blueprint';

const editor = blueprintEditor();

async function save(draft: Parameters<typeof saveBlueprint>[0]): Promise<BlueprintRecord> {
  const out = await saveBlueprint(draft);
  if (typeof out === 'string') throw new Error(`refused: ${out}`);
  return out;
}

spec('BLUE-05', 'saves a frame with its name, author and folder', async () => {
  const sc = scene();
  open(sc.w);
  const before = Date.now();
  const record = await save({ frame: sc.frame, name: 'Terrace', author: 'Mei', folder: 'Gardens' });
  expect(record).toMatchObject({ name: 'Terrace', author: 'Mei', folder: 'Gardens', origin: null, appVersion: APP_VERSION });
  expect(record.savedAt).toBeGreaterThanOrEqual(before);
  expect(record.body).toMatchObject({ w: 4, h: 5 });
  expect(record.body.objects).toHaveLength(2);
  expect(editor.lib().records().map((r) => r.id)).toEqual([record.id]);
  expect(editor.lib().folders()).toContain('Gardens');

  const again = await save({ frame: sc.frame, name: 'Terrace', author: 'Mei', folder: null });
  expect(again.id).not.toBe(record.id);

  expect(await saveBlueprint({ frame: { ...sc.frame, w: 40 }, name: 'Wide', author: 'Mei', folder: null })).toBe('too-big');
  expect(editor.lib().records()).toHaveLength(2);
});

spec('BLUE-05', 'the last author used is offered next time', async () => {
  const sc = scene();
  open(sc.w);
  expect(lastBlueprintAuthor()).toBeNull();
  await save({ frame: sc.frame, name: 'Terrace', author: 'Mei', folder: null });
  expect(lastBlueprintAuthor()).toBe('Mei');
  await save({ frame: sc.frame, name: 'Terrace', author: null, folder: null });
  expect(lastBlueprintAuthor()).toBeNull();
});

spec('BLUE-12', 'a frame holding another author\'s placement names them as 改编自, and an adaptation keeps the first original', async () => {
  const sc = scene();
  open(sc.w);
  const anns = await save({ frame: sc.frame, name: 'Terrace', author: 'Ann', folder: null });

  // Mei places Ann's blueprint and saves a frame around it.
  writePref('blueprintAuthor', 'Mei');
  armBlueprint(anns.id);
  placeArmedAt(sc.free);
  const around = { x: sc.free.x - 1, y: sc.free.y, w: 6, h: 6 };
  expect(originFor(around)).toBe('Ann');
  expect(originFor({ x: sc.free.x + 10, y: sc.free.y, w: 4, h: 4 })).toBeNull();
  const meis = await save({ frame: around, name: 'Terrace and path', author: 'Mei', folder: null });
  expect(meis).toMatchObject({ author: 'Mei', origin: 'Ann' });

  // Kai places Mei's adaptation: the original stays Ann.
  writePref('blueprintAuthor', 'Kai');
  armBlueprint(meis.id);
  const kaiAt = { x: sc.free.x + 7, y: sc.free.y };
  placeArmedAt(kaiAt);
  expect(originFor({ ...kaiAt, w: 6, h: 6 })).toBe('Ann');
});

spec('BLUE-12', 'an undone placement names no one, and redoing it names its original author again', async () => {
  const sc = scene();
  open(sc.w);
  const anns = await save({ frame: sc.frame, name: 'Terrace', author: 'Ann', folder: null });
  writePref('blueprintAuthor', 'Mei');
  armBlueprint(anns.id);
  placeArmedAt(sc.free);
  const spot = { x: sc.free.x, y: sc.free.y, w: 4, h: 5 };
  expect(originFor(spot)).toBe('Ann');
  sc.w.undo();
  expect(originFor(spot)).toBeNull();
  sc.w.redo();
  expect(originFor(spot)).toBe('Ann');
});

spec('BLUE-12', 'one\'s own and anonymous placements, and placements on another map, name no one', async () => {
  const sc = scene();
  open(sc.w);
  const own = await save({ frame: sc.frame, name: 'Terrace', author: 'Mei', folder: null });
  const anonymous = await save({ frame: sc.frame, name: 'Terrace', author: null, folder: null });
  writePref('blueprintAuthor', 'Mei');
  armBlueprint(own.id);
  placeArmedAt(sc.free);
  armBlueprint(anonymous.id);
  placeArmedAt({ x: sc.free.x + 6, y: sc.free.y });
  expect(originFor({ x: sc.free.x, y: sc.free.y, w: 12, h: 6 })).toBeNull();

  writePref('blueprintAuthor', 'Kai');
  armBlueprint(own.id);
  placeArmedAt({ x: sc.free.x + 12, y: sc.free.y });
  expect(originFor({ x: sc.free.x + 12, y: sc.free.y, w: 4, h: 5 })).toBe('Mei');
  useEditorStore.getState().loadMap(createGridState(getMapTemplate(undefined)), createDefaultRegistry());
  expect(originFor({ x: sc.free.x + 12, y: sc.free.y, w: 4, h: 5 })).toBeNull();
});

spec('BLUE-11', 'an exported file imports into its folder, and a blueprint already held is skipped with a toast', async () => {
  const sc = scene();
  open(sc.w);
  const record = await save({ frame: sc.frame, name: 'Terrace', author: 'Mei', folder: null });
  const text = encodeBlueprints([{ ...record, folder: 'Shared' }]);
  await importBlueprintFile(text);
  expect(editor.lib().records()).toHaveLength(1);
  expect(editor.toasts()).toEqual(['1 blueprint is already in the library and was skipped']);

  await editor.lib().remove([record.id]);
  await importBlueprintFile(text);
  expect(editor.lib().records().map((r) => [r.id, r.folder])).toEqual([[record.id, 'Shared']]);
  expect(editor.toasts().at(-1)).toBe('1 blueprint imported');

  await importBlueprintFile('{"format":"something-else"}');
  expect(editor.toasts().at(-1)).toMatch(/not a .* blueprint file/);
});
