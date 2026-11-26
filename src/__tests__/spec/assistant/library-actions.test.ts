// @vitest-environment jsdom
/** The commands over the blueprint library, the saved planets and import, run by id as any caller
 *  runs them: each does what its control does, and a refused argument changes nothing. */
import { beforeEach, describe, expect, vi } from 'vitest';
import { spec } from '../../_support/spec';
import { planetFixture } from '../../_support/planet';
import { MAP_LIST } from '../../../config/maps';
import { agentSessionPort } from '../../../agent/exec/session-port';
import { makeToolDeps } from '../../../agent/exec/tool-deps';
import { createExecutor } from '../../../agent/exec/executor';
import { describeToolArgs } from '../../../agent/panel';
import { ALL_COMMANDS, listCommands, runCommand } from '../../../editor/commands/run';
import { blueprintFolderName, blueprintFolders, shownBlueprints } from '../../../editor/editing/blueprint';
import { newMap } from '../../../editor/operations';
import { __resetArrivals, subscribeArrival, type Arrival } from '../../../editor/session/arrival';
import { editorPort } from '../../../editor/session/context';
import { listPlanets } from '../../../editor/session/planet-library';
import { translate } from '../../../i18n/context';
import { BLUEPRINT_NAME_MAX, MY_FOLDER, type BlueprintRecord } from '../../../io/blueprint';
import { PLANET_NAME_MAX } from '../../../io/save/planet-codec';
import { savePlanet } from '../../../io/storage/planet-library';
import { placeObjectCommand } from '../../../core/model/command-build';
import { getCatalogItem } from '../../../state/catalog';
import { useEditorStore } from '../../../state/store';
import { candidateObject } from '../../../tools/objects';
import { blueprintEditor } from '../blueprints/_blueprints';

const review = vi.hoisted(() => ({ refused: new Set<string>(), checked: [] as string[] }));
vi.mock('../../../pipelines/moderation/text/reviewer', async (original) => ({
  ...(await original<typeof import('../../../pipelines/moderation/text/reviewer')>()),
  reviewText: vi.fn(async (parts: readonly { text: string }[]) => {
    review.checked.push(...parts.map((p) => p.text));
    return { allowed: !parts.some((p) => review.refused.has(p.text)) };
  }),
}));

const download = vi.hoisted(() => ({ downloadJSON: vi.fn() }));
vi.mock('../../../io/export/download', async (original) => ({
  ...(await original<typeof import('../../../io/export/download')>()),
  downloadJSON: download.downloadJSON,
}));

const { lib, toasts } = blueprintEditor();
const s = () => useEditorStore.getState();

const BODY = { w: 3, h: 2, cells: Array(6).fill(null), objects: [] } as unknown as BlueprintRecord['body'];
const record = (id: string, name: string, folder: string | null, savedAt: number): BlueprintRecord => ({
  id, name, folder, author: null, origin: null, savedAt, appVersion: '0', body: BODY, thumbs: { flat: '', lifted: '' },
});

const ran = async (id: string, args: Record<string, unknown> = {}): Promise<string> => {
  const outcome = await runCommand(id, args);
  if (!outcome.ok) throw new Error(`${id} was refused: ${outcome.reason}`);
  return outcome.result;
};
const refused = async (id: string, args: Record<string, unknown>): Promise<void> => {
  expect(await runCommand(id, args), `${id} ${JSON.stringify(args)}`).toMatchObject({ ok: false });
};

/** The library as stored: every record's name and folder by id, in its order, and the folders. */
const library = () => ({ records: lib().records().map((r) => [r.id, r.name, r.folder]), folders: [...lib().folders()] });
const order = () => lib().records().map((r) => r.id);
const folderOf = (id: string) => lib().records().find((r) => r.id === id)!.folder;
const pendingName = () => translate('blueprint.pending_delete_folder');

beforeEach(async () => {
  review.refused.clear();
  review.checked.length = 0;
  download.downloadJSON.mockReset();
  lib().holdFolder(MY_FOLDER);
  await lib().save(record('a', 'Harbour', 'Docks', 4));
  await lib().save(record('b', 'Garden corner', 'Gardens', 3));
  await lib().save(record('c', 'Market street', null, 2));
  await lib().save(record('d', 'Pier', 'Docks', 1));
});

describe('the blueprint library by command', () => {
  spec('ASST-34', 'the listing names every folder and blueprint by id, name, folder and size, capped, and changes nothing', async () => {
    const before = library();
    const listed = JSON.parse(await ran('blueprints.list')) as { folders: { id: string; name: string; count: number }[]; blueprints: Record<string, unknown>[] };
    expect(listed.folders.map((f) => f.id).sort()).toEqual([...blueprintFolders()].sort());
    expect(listed.folders.find((f) => f.id === 'Docks')).toMatchObject({ name: 'Docks', count: 2 });
    expect(listed.folders.find((f) => f.id === MY_FOLDER)!.name).toBe(blueprintFolderName(MY_FOLDER));
    expect(listed.blueprints).toContainEqual({ id: 'a', name: 'Harbour', folder: 'Docks', size: '3x2' });
    expect(listed.blueprints).toHaveLength(4);
    const docks = JSON.parse(await ran('blueprints.list', { folder: 'Docks' })) as { blueprints: { id: string }[] };
    expect(docks.blueprints.map((r) => r.id).sort()).toEqual(['a', 'd']);
    for (let i = 0; i < 70; i++) await lib().save(record(`more-${i}`, `More ${i}`, null, 10 + i));
    const capped = JSON.parse(await ran('blueprints.list')) as { blueprints: unknown[]; omitted: number };
    expect(capped.blueprints.length + capped.omitted).toBe(74);
    expect(capped.omitted).toBeGreaterThan(0);
    await refused('blueprints.list', { folder: 'Nowhere' });
    expect(library().records.filter(([id]) => !String(id).startsWith('more-'))).toEqual(before.records);
  });

  spec('ASST-34', 'a blueprint is renamed as its name card renames it, and a blank, overlong, refused or unknown one changes nothing', async () => {
    await ran('blueprints.rename', { id: 'a', name: '  Old harbour ' });
    expect(shownBlueprints().find((r) => r.id === 'a')!.name).toBe('Old harbour');
    expect(review.checked).toContain('Old harbour');
    const before = library();
    review.refused.add('Refused name');
    await refused('blueprints.rename', { id: 'a', name: 'Refused name' });
    await refused('blueprints.rename', { id: 'a', name: '   ' });
    await refused('blueprints.rename', { id: 'a', name: 'x'.repeat(BLUEPRINT_NAME_MAX + 1) });
    await refused('blueprints.rename', { id: 'missing', name: 'Anything' });
    await refused('blueprints.rename', { id: 'a' });
    expect(library()).toEqual(before);
  });

  spec('ASST-34', 'blueprints move into a folder with the notice the move menu raises, or out of every folder, and an unknown blueprint or folder moves none', async () => {
    await ran('blueprints.move', { ids: 'a, c', folder: 'Gardens' });
    expect([folderOf('a'), folderOf('c')]).toEqual(['Gardens', 'Gardens']);
    expect(toasts()).toContain(translate('blueprint.moved', { n: 2, folder: 'Gardens' }));
    await ran('blueprints.move', { ids: 'd', folder: blueprintFolderName(MY_FOLDER) });
    expect(folderOf('d')).toBe(MY_FOLDER);
    await ran('blueprints.move', { ids: 'a' });
    expect(folderOf('a')).toBeNull();
    const before = library();
    await refused('blueprints.move', { ids: 'b', folder: 'Never made' });
    await refused('blueprints.move', { ids: 'b,missing', folder: 'Docks' });
    await refused('blueprints.move', { ids: ' , ', folder: 'Docks' });
    expect(library()).toEqual(before);
  });

  spec('ASST-34', 'blueprints to delete go into the pending deletion folder, made once and named in the interface language, and stay in the library', async () => {
    expect(blueprintFolders().map(blueprintFolderName)).not.toContain(pendingName());
    await refused('blueprints.set_aside', { ids: 'missing' });
    expect(blueprintFolders().map(blueprintFolderName)).not.toContain(pendingName());
    await ran('blueprints.set_aside', { ids: 'a,b' });
    await ran('blueprints.set_aside', { ids: 'c' });
    expect(blueprintFolders().filter((f) => blueprintFolderName(f) === pendingName())).toHaveLength(1);
    expect([folderOf('a'), folderOf('b'), folderOf('c')].map((f) => blueprintFolderName(f!))).toEqual([pendingName(), pendingName(), pendingName()]);
    expect(lib().records()).toHaveLength(4);
  });

  spec('ASST-34', 'blueprints are set down beside another in the library\'s order as a drop among the cards does, and a place that names none or one of them moves nothing', async () => {
    const before = order();
    const [first, , third, last] = before as [string, string, string, string];
    await ran('blueprints.reorder', { ids: last, before: first });
    expect(order()).toEqual([last, ...before.filter((id) => id !== last)]);
    await ran('blueprints.reorder', { ids: last, after: third });
    expect(order()).toEqual(before);
    await refused('blueprints.reorder', { ids: last });
    await refused('blueprints.reorder', { ids: last, before: first, after: third });
    await refused('blueprints.reorder', { ids: `${first},${last}`, before: first });
    await refused('blueprints.reorder', { ids: last, before: 'missing' });
    expect(order()).toEqual(before);
  });

  spec('ASST-34', 'blueprints or a folder are exported as their Export does, only once the notice the caller shows is accepted, and nothing without one', async () => {
    const noticed = (accepted: boolean) => ({ toggleMenu: () => {}, exportNotice: vi.fn(async () => accepted) });
    const names = (json: unknown) => (JSON.parse(json as string) as { records: { name: string }[] }).records.map((r) => r.name);
    const files = () => download.downloadJSON.mock.calls.map(([json]) => names(json));
    const accepting = noticed(true);
    expect(await runCommand('blueprints.export', { ids: 'd, a' }, accepting)).toMatchObject({ ok: true });
    expect(await runCommand('blueprints.export', { folder: 'Docks' }, accepting)).toMatchObject({ ok: true });
    expect(accepting.exportNotice).toHaveBeenCalledTimes(2);
    expect(files()).toEqual([['Harbour', 'Pier'], ['Harbour', 'Pier']]);
    download.downloadJSON.mockReset();
    // A notice the user turns down, and a caller with no notice to show, write nothing.
    const declining = noticed(false);
    expect(await runCommand('blueprints.export', { ids: 'a' }, declining)).toMatchObject({ ok: false });
    expect(declining.exportNotice).toHaveBeenCalledOnce();
    expect(await runCommand('blueprints.export', { ids: 'a' }, { toggleMenu: () => {} })).toMatchObject({ ok: false });
    await refused('blueprints.export', { ids: 'a' });
    // A bad argument asks no notice.
    for (const args of [{}, { ids: 'a', folder: 'Docks' }, { ids: 'missing' }, { ids: ' , ' }, { folder: 'Never made' }]) {
      expect(await runCommand('blueprints.export', args, accepting), JSON.stringify(args)).toMatchObject({ ok: false });
    }
    expect(accepting.exportNotice).toHaveBeenCalledTimes(2);
    expect(download.downloadJSON).not.toHaveBeenCalled();
  });

  spec('ASST-34', 'a folder is created and opened as New folder does, numbered where its name is shown, and a blank or refused name makes none', async () => {
    await ran('blueprints.folder_create', { name: 'Bridges' });
    expect(blueprintFolders()).toContain('Bridges');
    expect(s().blueprint.folder).toBe('Bridges');
    const numbered = await ran('blueprints.folder_create', { name: 'Bridges' });
    const made = blueprintFolders().filter((f) => f.startsWith('Bridges'));
    expect(made).toHaveLength(2);
    expect(numbered).toContain(made.find((f) => f !== 'Bridges')!);
    const before = library();
    review.refused.add('Refused folder');
    await refused('blueprints.folder_create', { name: 'Refused folder' });
    await refused('blueprints.folder_create', { name: ' ' });
    await refused('blueprints.folder_create', {});
    expect(library()).toEqual(before);
  });

  spec('ASST-34', 'a folder is renamed with its blueprints, and My Blueprints, a name in use, a refused name or an unknown folder renames none', async () => {
    await ran('blueprints.folder_rename', { folder: 'Docks', name: 'Harbours' });
    expect([folderOf('a'), folderOf('d')]).toEqual(['Harbours', 'Harbours']);
    expect(blueprintFolders()).not.toContain('Docks');
    const before = library();
    review.refused.add('Refused folder');
    await refused('blueprints.folder_rename', { folder: MY_FOLDER, name: 'Mine' });
    await refused('blueprints.folder_rename', { folder: 'Harbours', name: 'Gardens' });
    await refused('blueprints.folder_rename', { folder: 'Harbours', name: 'Refused folder' });
    await refused('blueprints.folder_rename', { folder: 'Docks', name: 'Anything' });
    expect(library()).toEqual(before);
  });
});

describe('the planets and import by command', () => {
  const here = MAP_LIST[0]!;
  const other = MAP_LIST[1]!;
  let saved: string;

  beforeEach(() => {
    localStorage.clear();
    newMap(editorPort, here.id);
    const made = savePlanet('Harbour', planetFixture(), { nameReviewed: true });
    if (!made.ok) throw new Error('fixture save failed');
    saved = made.entry.entryId;
  });

  spec('ASST-34', 'the listing names the built-in and the saved planets and which the map stands on', async () => {
    const listed = JSON.parse(await ran('planets.list')) as { current: string; builtin: { id: string }[]; saved: { id: string; name: string }[] };
    expect(listed.current).toBe(here.id);
    expect(listed.builtin.map((p) => p.id)).toEqual(MAP_LIST.map((t) => t.id));
    expect(listed.saved).toEqual([{ id: saved, name: 'Harbour' }]);
  });

  spec('ASST-34', 'a saved planet is renamed as its rename card renames it, and a built-in, a blank, an overlong or a refused name renames none', async () => {
    await ran('planets.rename', { planet: saved, name: 'Quay' });
    expect(listPlanets().map((e) => e.name)).toEqual(['Quay']);
    expect(review.checked).toContain('Quay');
    review.refused.add('Refused planet');
    await refused('planets.rename', { planet: saved, name: 'Refused planet' });
    await refused('planets.rename', { planet: saved, name: '' });
    await refused('planets.rename', { planet: saved, name: 'x'.repeat(PLANET_NAME_MAX + 1) });
    await refused('planets.rename', { planet: here.id, name: 'Mine now' });
    expect(listPlanets().map((e) => e.name)).toEqual(['Quay']);
  });

  spec('ASST-34', 'the map moves to another planet with its build, its undo history discarded, and an unknown planet or the one it stands on switches nothing', async () => {
    const tree = candidateObject(getCatalogItem('tree-apple')!, { x: 38, y: 26 }, 0, s().gridState!, { id: 'tree' });
    expect(s().commandExecutor!.execute(placeObjectCommand(tree)).success).toBe(true);
    const open = s().gridState;
    await refused('planets.switch', { planet: 'no-such-planet' });
    await refused('planets.switch', { planet: here.id });
    expect(s().gridState).toBe(open);
    expect(s().commandExecutor!.historyDepth()).toBe(1);

    await ran('planets.switch', { planet: other.id });
    expect(s().gridState!.template.id).toBe(other.id);
    expect([...s().gridState!.objects.values()].some((o) => o.catalogId === 'tree-apple')).toBe(true);
    expect(s().commandExecutor!.canUndo()).toBe(false);

    const again = await ran('planets.switch', { planet: saved });
    expect(again).toContain('Harbour');
    expect(s().gridState!.template.id).toBe(listPlanets()[0]!.template.id);
    // The command has no way to open a planet empty: it takes the planet and nothing else.
    expect(ALL_COMMANDS.find((command) => command.id === 'planets.switch')!.args.map((arg) => arg.name)).toEqual(['planet']);
  });

  spec('PLAN-25', 'a switch run by command closes Change planet and reports what the carry left behind, as the window\'s button does', async () => {
    const heard: Arrival[] = [];
    __resetArrivals();
    const off = subscribeArrival((arrival) => { heard.push(arrival); });
    const tree = candidateObject(getCatalogItem('tree-apple')!, { x: 38, y: 26 }, 0, s().gridState!, { id: 'tree' });
    expect(s().commandExecutor!.execute(placeObjectCommand(tree)).success).toBe(true);
    s().setModal('newProject', true);
    await refused('planets.switch', { planet: here.id });
    expect(heard, 'a refused switch announces nothing').toEqual([]);
    expect(s().modals.newProject).toBe(true);

    await ran('planets.switch', { planet: other.id });
    off();
    expect(s().modals.newProject).toBe(false);
    expect(heard).toEqual([{ kind: 'transferred', detail: [{ key: 'arrival.transferred' }] }]);
  });

  spec('ASST-34', 'the Import window opens for the user and reads nothing, and stands down while a planet is edited', async () => {
    const open = s().gridState;
    await ran('window.open', { window: 'import' });
    expect(s().modals.import).toBe(true);
    expect(s().gridState).toBe(open);
    s().setModal('import', false);
    useEditorStore.setState({ planetSession: {} as NonNullable<ReturnType<typeof s>['planetSession']> });
    await refused('window.open', { window: 'import' });
    await refused('planets.switch', { planet: other.id });
    expect(s().modals.import).toBe(false);
    useEditorStore.setState({ planetSession: null });
  });
});

describe('what the assistant is offered of them', () => {
  const EFFECTS = {
    'blueprints.list': 'answer', 'blueprints.rename': 'change', 'blueprints.move': 'change', 'blueprints.set_aside': 'change',
    'blueprints.reorder': 'change', 'blueprints.folder_create': 'change', 'blueprints.folder_rename': 'change',
    'blueprints.export': 'outward', 'blueprints.save': 'change',
    'planets.list': 'answer', 'planets.rename': 'change', 'planets.switch': 'outward',
  } as const;

  spec('ASST-34', 'the assistant is offered each with its effect, runs one through its own tool, and is offered nothing that deletes', async () => {
    newMap(editorPort, MAP_LIST[0]!.id);
    const executor = createExecutor(makeToolDeps({ vision: false, session: agentSessionPort }));
    const listed = await executor.execute({ callId: 'l', name: 'list_app_actions', args: {} });
    const rows = JSON.parse(listed.content) as { id: string; effect: string }[];
    const library = rows.filter((row) => /^(blueprints|planets)\./.test(row.id));
    expect(Object.fromEntries(library.map((row) => [row.id, row.effect]))).toEqual(EFFECTS);
    expect(ALL_COMMANDS.filter((command) => /^(blueprints|planets)\./.test(command.id) && command.effect === 'destroy')).toEqual([]);
    const result = await executor.execute({ callId: 'r', name: 'run_app_action', args: { id: 'blueprints.set_aside', args: { ids: 'a' } } });
    expect(result.isError).toBe(false);
    expect(blueprintFolderName(folderOf('a')!)).toBe(pendingName());
    expect(lib().records()).toHaveLength(4);
  });

  spec('ASST-17', 'a question about blueprints, a folder or a planet names them as the library shows them, never by id', () => {
    newMap(editorPort, MAP_LIST[0]!.id);
    const names = { catalog: () => undefined, object: () => undefined, action: (id: string) => listCommands().find((command) => command.id === id) };
    const asked = (id: string, args: Record<string, unknown>) => describeToolArgs({ name: 'run_app_action', input: { id, args } }, translate, names);

    expect(asked('blueprints.move', { ids: 'a, d', folder: MY_FOLDER })).toBe(`${translate('blueprint.move')}: Harbour, Pier, ${blueprintFolderName(MY_FOLDER)}`);
    expect(asked('blueprints.rename', { id: 'c', name: 'High street' })).toBe(`${translate('blueprint.rename_title')}: Market street, High street`);
    const other = MAP_LIST[1]!;
    const shown = asked('planets.switch', { planet: other.id })!;
    expect(shown).not.toContain(other.id);
    expect(shown.startsWith(`${translate('modal.new_title')}: `)).toBe(true);
  });
});
