// @vitest-environment jsdom
/** The Blueprint bar's commands run by id as any caller runs them: arming a card, opening and
 *  confirming the frame step and saving its frame each do what their control does, and a refused
 *  argument or a step that does not stand changes nothing. */
import { beforeEach, expect, vi } from 'vitest';
import { spec } from '../../_support/spec';
import { runCommand } from '../../../editor/commands/run';
import { saveBlueprint, unfoldBlueprintLibrary } from '../../../editor/editing/blueprint';
import { terrainCellsUnder } from '../../../core/grid/footprint';
import { BLUEPRINT_NAME_MAX, type BlueprintRecord } from '../../../io/blueprint';
import { explorerUnfolded } from '../../../state/slices/blueprint';
import { useEditorStore } from '../../../state/store';
import { blueprintEditor, open, scene, type Scene } from './_blueprints';

const review = vi.hoisted(() => ({ refused: new Set<string>(), checked: [] as string[] }));
vi.mock('../../../pipelines/moderation/text/reviewer', async (original) => ({
  ...(await original<typeof import('../../../pipelines/moderation/text/reviewer')>()),
  reviewText: vi.fn(async (parts: readonly { text: string }[]) => {
    review.checked.push(...parts.map((p) => p.text));
    return { allowed: !parts.some((p) => review.refused.has(p.text)) };
  }),
}));

const editor = blueprintEditor();
const store = () => useEditorStore.getState();

const ran = async (id: string, args: Record<string, unknown> = {}): Promise<string> => {
  const outcome = await runCommand(id, args);
  if (!outcome.ok) throw new Error(`${id} was refused: ${outcome.reason}`);
  return outcome.result;
};
const refused = async (id: string, args: Record<string, unknown> = {}): Promise<void> => {
  expect(await runCommand(id, args), `${id} ${JSON.stringify(args)}`).toMatchObject({ ok: false });
};

async function saved(sc: Scene, name: string): Promise<BlueprintRecord> {
  const out = await saveBlueprint({ frame: sc.frame, name, author: null, folder: null });
  if (typeof out === 'string') throw new Error(`refused: ${out}`);
  return out;
}

/** The save step standing on the scene's frame, reached as the controls reach it. */
async function atSaveStep(sc: Scene): Promise<void> {
  await ran('blueprints.frame');
  store().setRegion(terrainCellsUnder(sc.frame), 'blueprint');
  await ran('blueprints.frame_done');
}

beforeEach(() => {
  review.refused.clear();
  review.checked.length = 0;
});

spec('BLUE-02', 'blueprints.arm arms a card as a press on it does, folds an open explorer as taking a card does, and disarms with no id', async () => {
  const sc = scene();
  open(sc.w);
  const terrace = await saved(sc, 'Terrace');
  await ran('blueprints.arm', { id: terrace.id });
  expect(store().blueprint.armed).toBe(terrace.id);
  await ran('blueprints.arm');
  expect(store().blueprint.armed).toBeNull();

  unfoldBlueprintLibrary(true);
  await ran('blueprints.arm', { id: terrace.id });
  expect(explorerUnfolded(store().blueprintStep)).toBe(false);
  expect(store().blueprint.armed).toBe(terrace.id);

  // An unknown blueprint, another mode and a frame being drawn arm nothing.
  await ran('blueprints.arm');
  await refused('blueprints.arm', { id: 'missing' });
  await refused('blueprints.arm', { id: 7 });
  store().setEditMode({ mode: 'object' });
  await refused('blueprints.arm', { id: terrace.id });
  store().setEditMode({ mode: 'blueprint' });
  await ran('blueprints.frame');
  await refused('blueprints.arm', { id: terrace.id });
  expect(store().blueprint.armed).toBeNull();
});

spec('BLUE-04', 'blueprints.frame opens the frame step as New blueprint does, from the strip or the explorer it folds, and blueprints.frame_done confirms only a frame that can be saved', async () => {
  const sc = scene();
  open(sc.w);
  // Outside Blueprint mode, and with a bad argument, no step opens.
  store().setEditMode({ mode: 'object' });
  await refused('blueprints.frame');
  store().setEditMode({ mode: 'blueprint' });
  await refused('blueprints.frame', { from: 'window' });
  await refused('blueprints.frame_done');
  expect(store().blueprintStep.at).toBe('strip');

  await ran('blueprints.frame');
  expect(store().blueprintStep).toMatchObject({ at: 'frame', start: 'strip' });
  expect(store().regionSelectionOwner).toBe('blueprint');
  await refused('blueprints.frame');
  // Nothing drawn, and a frame holding nothing, are refused where the step's Done is not offered.
  await refused('blueprints.frame_done');
  store().setRegion(terrainCellsUnder({ x: sc.free.x + 12, y: sc.free.y, w: 2, h: 2 }), 'blueprint');
  await refused('blueprints.frame_done');
  expect(store().blueprintStep.at).toBe('frame');
  store().setRegion(terrainCellsUnder(sc.frame), 'blueprint');
  await ran('blueprints.frame_done');
  expect(store().blueprintStep).toMatchObject({ at: 'save', frame: sc.frame });

  // From the open explorer the step starts there, so Cancel returns to it.
  store().setEditMode({ mode: 'object' });
  store().setEditMode({ mode: 'blueprint' });
  unfoldBlueprintLibrary(true);
  await ran('blueprints.frame');
  expect(store().blueprintStep).toMatchObject({ at: 'frame', start: 'explorer' });
});

spec('BLUE-05', 'blueprints.save saves the step\'s frame as its Save does, under a numbered default with no name and anonymously with no author, and arms it', async () => {
  const sc = scene();
  open(sc.w);
  // No save step stands: nothing is saved.
  await refused('blueprints.save', { name: 'Terrace' });
  expect(editor.lib().records()).toHaveLength(0);

  await atSaveStep(sc);
  editor.lib().addFolder('Gardens');
  await ran('blueprints.save', { name: '  Terrace ', author: 'Mei', folder: 'Gardens' });
  expect(editor.lib().records()).toHaveLength(1);
  const [terrace] = editor.lib().records();
  expect(terrace).toMatchObject({ name: 'Terrace', author: 'Mei', folder: 'Gardens' });
  expect(review.checked).toEqual(expect.arrayContaining(['Terrace', 'Mei']));
  expect(store().blueprintStep.at).toBe('strip');
  expect(store().blueprint.armed).toBe(terrace!.id);

  store().setArmedBlueprint(null);
  await atSaveStep(sc);
  await ran('blueprints.save');
  const plain = editor.lib().records().find((r) => r.id !== terrace!.id)!;
  expect(plain).toMatchObject({ author: null, folder: null });
  expect(plain.name).not.toBe('');
});

spec('BLUE-05', 'blueprints.save refuses a refused, blank or overlong text and an unknown folder, and leaves the save step open with nothing saved', async () => {
  const sc = scene();
  open(sc.w);
  await atSaveStep(sc);
  review.refused.add('Refused name');
  review.refused.add('Refused author');
  await refused('blueprints.save', { name: 'Refused name' });
  await refused('blueprints.save', { name: 'Terrace', author: 'Refused author' });
  await refused('blueprints.save', { name: 'Terrace', author: '  ' });
  await refused('blueprints.save', { name: 'x'.repeat(BLUEPRINT_NAME_MAX + 1) });
  await refused('blueprints.save', { name: 'Terrace', author: 'x'.repeat(BLUEPRINT_NAME_MAX + 1) });
  await refused('blueprints.save', { name: 'Terrace', folder: 'Never made' });
  await refused('blueprints.save', { name: 7 });
  expect(editor.lib().records()).toHaveLength(0);
  expect(store().blueprintStep).toMatchObject({ at: 'save', pending: false });
});
