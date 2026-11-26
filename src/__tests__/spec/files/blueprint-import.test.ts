// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const review = vi.hoisted(() => ({ reviewText: vi.fn() }));
vi.mock('../../../pipelines/moderation/text/reviewer', async (load) => ({
  ...await load<typeof import('../../../pipelines/moderation/text/reviewer')>(),
  reviewText: review.reviewText,
}));

const download = vi.hoisted(() => ({ downloadJSON: vi.fn() }));
vi.mock('../../../io/export/download', async (load) => ({
  ...await load<typeof import('../../../io/export/download')>(),
  downloadJSON: download.downloadJSON,
}));

import { spec } from '../../_support/spec';
import { translateFor } from '../../../i18n/context';
import { classifyImportFile } from '../../../io/import/kind';
import { BLUEPRINT_FILE_FORMAT, encodeBlueprints, type BlueprintRecord } from '../../../io/blueprint';
import { routeImport } from '../../../editor/session/import-flow';
import {
  __setBlueprintLibrary, blueprintFolderName, deleteBlueprintFolder, deleteBlueprints, exportBlueprints, importBlueprintFile, redrawBlankThumbs,
  saveBlueprintTo, shownBlueprint, shownBlueprints, watchUnreviewedBlueprints,
} from '../../../editor/editing/blueprint';
import { installPictureRenderer } from '../../_support/picture-renderer';
import { reviewBlueprintText } from '../../../editor/review/edition-review';
import { __resetBackgroundReviews } from '../../../pipelines/moderation/text/background-review';
import { useEditorStore } from '../../../state/store';
import { blueprintEditor, open, scene } from '../blueprints/_blueprints';
import { world } from '../_world';
import { readImportText } from '../../../io/import/read-blob';
import { MAX_IMPORT_BYTES } from '../../../io/save/limits';
import { captureBlueprint } from '../../../tools/blueprint';

const editor = blueprintEditor();
const ROUTING = { map: 'read', planet: 'card', video: 'card', unknown: 'read' } as const;
const en = (key: Parameters<typeof translateFor>[1], params?: Record<string, string | number>): string => translateFor('en', key, params);

function fileOf(name: string, author: string | null, folder?: string, extra: Partial<BlueprintRecord> = {}): File {
  const sc = scene();
  const out = captureBlueprint(sc.w.state, sc.frame);
  if ('refusal' in out) throw new Error(out.refusal);
  const record: BlueprintRecord = {
    id: 'imp1', name, folder: folder ?? null, author, origin: null, savedAt: 1, appVersion: 'x', body: out.body, thumbs: { flat: '', lifted: '' }, ...extra,
  };
  return new File([encodeBlueprints([record])], 'plots.json', { type: 'application/json' });
}

/** A file of one blueprint as version 1 wrote it with no folder, which lands in the folder open. */
async function olderFileOf(name: string, author: string | null, extra: Partial<BlueprintRecord> = {}): Promise<File> {
  const file = JSON.parse(await readImportText(fileOf(name, author, undefined, extra)) ?? '') as { version: number };
  return new File([JSON.stringify({ ...file, version: 1 })], 'plots.json', { type: 'application/json' });
}

beforeEach(() => {
  __resetBackgroundReviews();
  review.reviewText.mockReset();
  download.downloadJSON.mockReset();
  review.reviewText.mockResolvedValue({ allowed: true });
  useEditorStore.getState().setBlueprintUi({ folder: null });
});

describe('blueprint import', () => {
  it('[BLUE-11] the import entry recognises a blueprint file', async () => {
    const text = JSON.stringify({ format: BLUEPRINT_FILE_FORMAT, version: 1, records: [] });
    expect(await classifyImportFile(new File([text], 'plots.json', { type: 'application/json' }))).toBe('blueprint');
  });

  spec('BLUE-11', 'dropping a blueprint file adds it to the library and opens Blueprint', async () => {
    const file = fileOf('Terrace', 'Mei', 'Gardens');
    expect(await routeImport(file, 'plots.json', ROUTING)).toEqual({ to: 'done' });
    expect(editor.lib().records().map((r) => r.name)).toEqual(['Terrace']);
    expect(editor.lib().records()[0]!.folder).toBe('Gardens');
    expect(useEditorStore.getState().editMode.mode).toBe('blueprint');
    // A folder the file made waits for review, so the library opens on All.
    expect(useEditorStore.getState().blueprint.folder).toBeNull();
    expect(editor.toasts()).toEqual([en('blueprint.imported', { n: 1 })]);
  });

  spec('BLUE-11', 'a damaged or too new blueprint file says so in the import voice', async () => {
    const stale = JSON.stringify({ format: BLUEPRINT_FILE_FORMAT, version: 99, records: [] });
    await routeImport(new File([stale], 'old.json', { type: 'application/json' }), 'old.json', ROUTING);
    const damaged = JSON.stringify({ format: BLUEPRINT_FILE_FORMAT, version: 1, records: [{}] });
    await routeImport(new File([damaged], 'bad.json', { type: 'application/json' }), 'bad.json', ROUTING);
    expect(editor.toasts()).toEqual([en('blueprint.import_future'), en('blueprint.import_failed')]);
    expect(editor.toasts().every((t) => t.startsWith('Import: '))).toBe(true);
    expect(editor.lib().records()).toHaveLength(0);
  });

  spec('BLUE-11', 'a library write failure while importing says the browser storage is short', async () => {
    const lib = editor.lib();
    const failing = { ...lib, importRecords: () => Promise.reject(new Error('quota')) };
    const restore = __setBlueprintLibrary(failing);
    try {
      await routeImport(fileOf('Terrace', 'Mei'), 'plots.json', ROUTING);
    } finally { restore(); }
    expect(editor.toasts()).toEqual([en('blueprint.import_storage_failed')]);
    expect(editor.toasts()[0]).toMatch(/^Import: /);
  });

  spec('BLUE-11', 'imported names wait for review before they show', async () => {
    let verdict: (v: { allowed: boolean }) => void = () => {};
    review.reviewText.mockImplementation(() => new Promise((resolve) => { verdict = resolve; }));
    await routeImport(fileOf('Terrace', 'Mei', 'Gardens'), 'plots.json', ROUTING);
    const lib = editor.lib();
    const held = (): BlueprintRecord => lib.records()[0]!;

    const waiting = reviewBlueprintText();
    expect(shownBlueprint(held())).toEqual({ name: en('blueprint.default_name', { n: 1 }), author: null, folder: null });
    expect(lib.folders()).not.toContain('Gardens');

    // Each held part is asked in turn: name, then author, then folder.
    for (let i = 0; i < 3; i++) { await vi.waitFor(() => expect(review.reviewText.mock.calls.length).toBe(i + 1)); verdict({ allowed: true }); }
    await waiting;
    expect(shownBlueprint(held())).toEqual({ name: 'Terrace', author: 'Mei', folder: 'Gardens' });
    expect(lib.folders()).toContain('Gardens');
    expect(held().unreviewed).toBeUndefined();
  });

  spec('BLUE-11', 'a refused name, author or folder is replaced for good', async () => {
    review.reviewText.mockImplementation(async (parts: { field: string }[]) => ({ allowed: parts[0]!.field === 'blueprint-name' }));
    await routeImport(fileOf('Terrace', 'Mei', 'Gardens'), 'plots.json', ROUTING);
    await reviewBlueprintText();
    const lib = editor.lib();
    expect(shownBlueprint(lib.records()[0]!)).toEqual({ name: 'Terrace', author: null, folder: null });
    expect(lib.records()[0]).toMatchObject({ author: null, folder: null });
    expect(lib.folders()).not.toContain('Gardens');
    expect(useEditorStore.getState().blueprint.folder).toBeNull();
  });

  spec('BLUE-11', 'a blueprint deleted while its name is checked and brought back with Undo still has its texts checked', async () => {
    const stop = watchUnreviewedBlueprints(() => { void reviewBlueprintText(); });
    try {
      let verdict: (v: { allowed: boolean }) => void = () => {};
      review.reviewText.mockImplementation(() => new Promise((resolve) => { verdict = resolve; }));
      await routeImport(fileOf('Terrace', 'Mei'), 'plots.json', ROUTING);
      const lib = editor.lib();
      await vi.waitFor(() => expect(review.reviewText).toHaveBeenCalledOnce());
      expect(await deleteBlueprints([lib.records()[0]!.id])).toBe(true);
      const undo = editor.action();
      // The name's verdict lands while the blueprint is gone; the run then ends with nothing left to check.
      verdict({ allowed: true });
      await reviewBlueprintText();
      review.reviewText.mockResolvedValue({ allowed: true });
      undo!.run();
      await vi.waitFor(() => expect(lib.records()).toHaveLength(1));
      await vi.waitFor(() => expect(shownBlueprint(lib.records()[0]!)).toMatchObject({ name: 'Terrace', author: 'Mei' }));
      await vi.waitFor(() => expect(blueprintFolderName(shownBlueprint(lib.records()[0]!).folder ?? '')).toBe("Mei's Blueprints"));
    } finally { stop(); }
  });

  spec('BLUE-11', 'the list the page reads and an export carry no unreviewed text', async () => {
    const release: ((v: { allowed: boolean }) => void)[] = [];
    review.reviewText.mockImplementation(() => new Promise((resolve) => { release.push(resolve); }));
    await routeImport(fileOf('Secret name', 'Secret author', 'Secret folder'), 'plots.json', ROUTING);
    const [shown] = shownBlueprints();
    expect(shown).toMatchObject({ name: en('blueprint.default_name', { n: 1 }), author: null, origin: null, folder: null });
    expect(shown!.unreviewed).toBeUndefined();

    await exportBlueprints([shown!.id], { confirmNotice: async () => true });
    expect(download.downloadJSON).toHaveBeenCalledOnce();
    const [json, fileName] = download.downloadJSON.mock.calls[0] as [string, string];
    expect(json + fileName).not.toMatch(/Secret/);
    expect(JSON.parse(json).records[0]).toMatchObject({ name: shown!.name, author: null, origin: null, folder: null });
    review.reviewText.mockResolvedValue({ allowed: true });
    release.forEach((r) => r({ allowed: true }));
    await reviewBlueprintText();
  });

  spec('BLUE-11', 'a blueprint file past the import limit is refused, not read', async () => {
    const huge = new File([encodeBlueprints([]) + ' '.repeat(MAX_IMPORT_BYTES + 1)], 'huge.json', { type: 'application/json' });
    await routeImport(huge, 'huge.json', ROUTING);
    expect(editor.lib().records()).toHaveLength(0);
    expect(editor.toasts()).toHaveLength(1);
    expect(editor.toasts()[0]).toMatch(/32 MB/);
  });

  spec('BLUE-11', 'an imported blueprint shows the pictures the app draws of it, never the file\'s', async () => {
    const sc = scene();
    open(sc.w);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,DRAWN');
    const picture = installPictureRenderer();
    try {
      const foreign = 'data:image/png;base64,FOREIGN';
      await routeImport(fileOf('Terrace', 'Mei', undefined, { thumbs: { flat: foreign, lifted: foreign } }), 'plots.json', ROUTING);
      const [stored] = editor.lib().records();
      expect(stored!.thumbs.flat).toBe('data:image/png;base64,DRAWN');
      expect(stored!.thumbs.lifted).not.toBe(foreign);
      expect(picture.calls.length).toBeGreaterThan(0);
    } finally {
      picture.uninstall();
      vi.restoreAllMocks();
    }
  });

  spec('BLUE-11', 'a blueprint imported with no map open gets its pictures once a map is open, drawn once', async () => {
    await routeImport(fileOf('Terrace', 'Mei'), 'plots.json', ROUTING);
    expect(editor.lib().records()[0]!.thumbs).toEqual({ flat: '', lifted: '' });

    const sc = scene();
    open(sc.w);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,DRAWN');
    const picture = installPictureRenderer();
    try {
      await Promise.all([redrawBlankThumbs(), redrawBlankThumbs()]);
      expect(editor.lib().records()[0]!.thumbs.flat).toBe('data:image/png;base64,DRAWN');
      expect(picture.calls).toHaveLength(1);
    } finally {
      picture.uninstall();
      vi.restoreAllMocks();
    }
  });

  spec('BLUE-11', 'pictures still owed when another planet opens are drawn on that planet', async () => {
    await routeImport(fileOf('Terrace', 'Mei'), 'plots.json', ROUTING);
    await routeImport(fileOf('Steps', 'Mei', undefined, { id: 'imp2', savedAt: 2 }), 'steps.json', ROUTING);
    open(scene().w);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,DRAWN');
    const picture = installPictureRenderer();
    try {
      const owed = redrawBlankThumbs();
      // Another planet opens before the redraws asked for the first one run; its own watch asks again.
      const other = world('tafa');
      open(other);
      await Promise.all([owed, redrawBlankThumbs()]);
      expect(picture.calls.length).toBeGreaterThan(0);
      expect(picture.calls.every((c) => c.state.template === other.state.template)).toBe(true);
      expect(editor.lib().records().map((r) => r.thumbs.flat)).toEqual(['data:image/png;base64,DRAWN', 'data:image/png;base64,DRAWN']);
    } finally {
      picture.uninstall();
      vi.restoreAllMocks();
    }
  });

  spec('BLUE-11', 'a folder an import made opens once its review approves it, unless another folder was chosen since', async () => {
    let verdict: (v: { allowed: boolean }) => void = () => {};
    review.reviewText.mockImplementation(() => new Promise((resolve) => { verdict = resolve; }));
    await routeImport(fileOf('Terrace', 'Mei', 'Gardens'), 'plots.json', ROUTING);
    expect(useEditorStore.getState().blueprint.folder).toBeNull();
    const waiting = reviewBlueprintText();
    for (let i = 0; i < 3; i++) { await vi.waitFor(() => expect(review.reviewText.mock.calls.length).toBe(i + 1)); verdict({ allowed: true }); }
    await waiting;
    await vi.waitFor(() => expect(useEditorStore.getState().blueprint.folder).toBe('Gardens'));

    // A second import whose folder the person leaves for another before review approves it.
    review.reviewText.mockReset();
    review.reviewText.mockImplementation(() => new Promise((resolve) => { verdict = resolve; }));
    editor.lib().addFolder('Paths');
    await routeImport(fileOf('Steps', 'Mei', 'Ponds', { id: 'imp2', savedAt: 2 }), 'steps.json', ROUTING);
    useEditorStore.getState().setBlueprintUi({ folder: 'Paths' });
    const again = reviewBlueprintText();
    for (let i = 0; i < 3; i++) { await vi.waitFor(() => expect(review.reviewText.mock.calls.length).toBe(i + 1)); verdict({ allowed: true }); }
    await again;
    await vi.waitFor(() => expect(editor.lib().folders()).toContain('Ponds'));
    expect(useEditorStore.getState().blueprint.folder).toBe('Paths');
  });

  spec('BLUE-11', 'a folder waiting for review never opens, and a later file is not filed into it', async () => {
    review.reviewText.mockImplementation(() => new Promise(() => {}));
    await routeImport(fileOf('Terrace', 'Mei', 'Secret folder'), 'plots.json', ROUTING);
    expect(editor.lib().folders()).not.toContain('Secret folder');
    expect(useEditorStore.getState().blueprint.folder).toBeNull();

    // Even with the hidden folder left open, an older file without a folder lands under none.
    useEditorStore.getState().setBlueprintUi({ folder: 'Secret folder' });
    await routeImport(await olderFileOf('Steps', null, { id: 'imp2', savedAt: 2 }), 'steps.json', ROUTING);
    const steps = editor.lib().records().find((r) => r.id === 'imp2')!;
    expect(steps.folder).toBeNull();
    expect(shownBlueprints().every((r) => r.folder === null)).toBe(true);
    expect(useEditorStore.getState().blueprint.folder).toBeNull();
  });

  spec('BLUE-11', 'an older file without a folder lands in the shown folder open', async () => {
    editor.lib().addFolder('Gardens');
    useEditorStore.getState().setBlueprintUi({ folder: 'Gardens' });
    await routeImport(await olderFileOf('Terrace', 'Mei'), 'plots.json', ROUTING);
    expect(editor.lib().records()[0]!.folder).toBe('Gardens');
    expect(useEditorStore.getState().blueprint.folder).toBe('Gardens');
  });

  /** Opens a map whose pictures land only on the returned release, with `folder` open over the folders `held`. */
  async function slowPicturesIn(folder: string, held: string[]): Promise<{ release: () => void; done: () => void }> {
    for (const f of held) editor.lib().addFolder(f);
    useEditorStore.getState().setBlueprintUi({ folder });
    open(scene().w);
    useEditorStore.getState().setBlueprintUi({ folder });
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,DRAWN');
    let release!: () => void;
    const picture = installPictureRenderer(new Promise<void>((r) => { release = r; }));
    return { release, done: () => { picture.uninstall(); vi.restoreAllMocks(); } };
  }

  spec('BLUE-11', 'a folder opened while an older file without one is imported stays open, the file landing where it was dropped', async () => {
    const older = await olderFileOf('Terrace', 'Mei');
    const pictures = await slowPicturesIn('Gardens', ['Gardens', 'Paths']);
    try {
      const importing = importBlueprintFile(await readImportText(older) ?? '');
      useEditorStore.getState().setBlueprintUi({ folder: 'Paths' });
      pictures.release();
      expect(await importing).toBe(true);
      expect(editor.lib().records()[0]!.folder).toBe('Gardens');
      expect(useEditorStore.getState().blueprint.folder).toBe('Paths');
    } finally { pictures.done(); }
  });

  spec('BLUE-11', 'an older file without a folder whose folder is deleted while it is imported lands under none', async () => {
    const older = await olderFileOf('Terrace', 'Mei');
    const pictures = await slowPicturesIn('Gardens', ['Gardens']);
    try {
      const importing = importBlueprintFile(await readImportText(older) ?? '');
      expect(await deleteBlueprintFolder('Gardens')).toBe(true);
      pictures.release();
      expect(await importing).toBe(true);
      expect(editor.lib().folders()).toEqual([]);
      expect(editor.lib().records()[0]!.folder).toBeNull();
      expect(useEditorStore.getState().blueprint.folder).toBeNull();
    } finally { pictures.done(); }
  });

  spec('BLUE-11', 'a numbered default name stays put when another blueprint is saved', async () => {
    review.reviewText.mockImplementation(() => new Promise(() => {}));
    await routeImport(fileOf('Terrace', 'Mei'), 'plots.json', ROUTING);
    const id = editor.lib().records()[0]!.id;
    const shownName = (): string => shownBlueprints().find((r) => r.id === id)!.name;
    expect(shownName()).toBe(en('blueprint.default_name', { n: 1 }));
    const sc = scene();
    await saveBlueprintTo(editor.lib(), sc.w.state, { frame: sc.frame, name: 'Newer', author: null, folder: null }, null);
    expect(editor.lib().records()[0]!.name).toBe('Newer');
    expect(shownName()).toBe(en('blueprint.default_name', { n: 1 }));
    expect(shownBlueprint(editor.lib().records().find((r) => r.id === id)!).name).toBe(en('blueprint.default_name', { n: 1 }));
  });


  spec('BLUE-11', 'a refused name takes the numbered default its card showed', async () => {
    const sc = scene();
    await saveBlueprintTo(editor.lib(), sc.w.state, { frame: sc.frame, name: 'Newer', author: null, folder: null }, null);
    review.reviewText.mockImplementation(async (parts: { field: string }[]) => ({ allowed: parts[0]!.field !== 'blueprint-name' }));
    await routeImport(fileOf('Terrace', 'Mei'), 'plots.json', ROUTING);
    const id = editor.lib().records().find((r) => r.name === 'Terrace')!.id;
    const shown = shownBlueprints().find((r) => r.id === id)!.name;
    expect(shown).toBe(en('blueprint.default_name', { n: 1 }));
    await reviewBlueprintText();
    expect(editor.lib().records().find((r) => r.id === id)!.name).toBe(shown);
  });
});
