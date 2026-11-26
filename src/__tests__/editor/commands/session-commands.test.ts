// @vitest-environment jsdom
/**
 * What a planet being edited and a hand repair offer, at the command door: a command the session
 * does not offer is refused there by id and by key, changing nothing, and runs again once it ends.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMapTemplate } from '../../../config/maps';
import { templateAnchor } from '../../../core/model/landmarks';
import { createGridState } from '../../../core/model/template';
import { keyBindings } from '../../../editor/commands/commands';
import { runCommand } from '../../../editor/commands/run';
import { newMap } from '../../../editor/operations';
import { editorPort } from '../../../editor/session/context';
import { commitImport } from '../../../editor/session/import-flow';
import { cancelRepair, repairByHand } from '../../../editor/session/landmark-repair';
import { startPlanetEditing, stopPlanetEditing } from '../../../editor/session/planet-editing';
import { inspectImportFile } from '../../../io/import/file';
import { serialize } from '../../../io/save/json-codec';
import { TOOLBAR_CONTEXTS } from '../../../state/keymap/toolbar';
import { MODAL_IDS } from '../../../state/slices/shell';
import { useEditorStore } from '../../../state/store';

vi.mock('../../../platform/device/device-quality', async (original) => ({
  ...await original<typeof import('../../../platform/device/device-quality')>(),
  hasWebGL2: () => true,
}));

const s = () => useEditorStore.getState();
const ran = async (id: string, args: Record<string, unknown> = {}) => (await runCommand(id, args)).ok;

/** What no session offers: Save and share and the exports, Change planet and Import, the planets and
 *  the blueprint library, the assistant, the welcome tips and the planet editor's opening. */
const NEVER_IN_SESSION: readonly [string, Record<string, unknown>][] = [
  ['window.open', { window: 'share' }],
  ['window.open', { window: 'newProject' }],
  ['window.open', { window: 'regionLoad' }],
  ['app.export_json', {}],
  ['app.export_image', { preset: 'plain' }],
  ['app.new', {}],
  ['app.generate', {}],
  ['planets.list', {}],
  ['blueprints.list', {}],
  ['app.assistant', { on: true }],
  ['tour.start', {}],
  ['planet.edit', {}],
];

/** Opens a save with a tree under the plaza and takes its repair by hand. */
async function repairByHandNow(): Promise<void> {
  const state = createGridState(getMapTemplate('hexia'));
  const plaza = templateAnchor(state.template)!;
  state.objects.set('tree', { id: 'tree', catalogId: 'tree-apple', position: { x: Math.floor(plaza.x) + 3, y: Math.floor(plaza.y) + 3 }, rotation: 0, elevation: 0 });
  const blob = new Blob([serialize(state)], { type: 'application/json' });
  const inspection = await inspectImportFile(blob, 'save.json');
  if (inspection.status !== 'ready') throw new Error(`inspection ${inspection.status}`);
  commitImport({ inspection, name: 'save.json', file: blob });
  repairByHand();
  expect(s().repairSession?.phase).toBe('hand');
}

/** Presses the key bound to `combo`, as the shortcut engine would. */
function pressKey(combo: string): void {
  const binding = keyBindings({}, TOOLBAR_CONTEXTS[0], { toggleMenu: () => {} }).find((b) => b.combo === combo);
  if (!binding) throw new Error(`no key on ${combo}`);
  binding.run();
}

function closeWindows(): void {
  for (const id of MODAL_IDS) s().setModal(id, false);
}

beforeEach(() => {
  newMap(editorPort, 'hexia');
  s().setViewMode('2d');
});
afterEach(() => {
  if (s().repairSession) cancelRepair();
  if (s().planetSession) stopPlanetEditing({ discard: true });
  closeWindows();
  s().setViewMode('2d');
  s().setAssistantOpen(false);
});

describe('a session that holds the map, at the command door', () => {
  it('[UI-74] a planet being edited refuses what it does not offer and runs it again once it ends', async () => {
    expect(startPlanetEditing(null, false)).toBe(true);
    const shown = { ...s().layerVisibility };
    for (const [id, args] of NEVER_IN_SESSION) expect(await ran(id, args), id).toBe(false);
    // The planet editor has no view switch, no hide toggle and no layer panel.
    expect(await ran('view.toggle', { value: '3d' })).toBe(false);
    expect(await ran('view.layer_visible', { layer: 2, visible: false })).toBe(false);
    expect(await ran('view.interface_hidden', { on: true })).toBe(false);
    expect(s().viewMode).toBe('2d');
    expect(s().layerVisibility).toEqual(shown);
    expect(MODAL_IDS.filter((id) => s().modals[id])).toEqual([]);

    // Its own controls: a ground mode, the menu's windows, the settings and undo.
    expect(await ran('mode.set', { mode: 'mountain' })).toBe(true);
    expect(s().editMode.mode).toBe('mountain');
    expect(await ran('window.open', { window: 'settings' })).toBe(true);
    expect(await ran('settings.motion', { value: 'system' })).toBe(true);
    expect(await ran('history.undo')).toBe(true);
    expect(await ran('selection.all')).toBe(true);

    stopPlanetEditing({ discard: true });
    closeWindows();
    expect(await ran('window.open', { window: 'share' })).toBe(true);
    expect(s().modals.share).toBe(true);
    expect(await ran('view.layer_visible', { layer: 2, visible: false })).toBe(true);
    expect(s().layerVisibility[1]).toBe(false);
    expect(await ran('view.layer_visible', { layer: 2, visible: true })).toBe(true);
    expect(await ran('view.toggle', { value: '3d' })).toBe(true);
    expect(s().viewMode).toBe('3d');
    expect(await ran('planets.list')).toBe(true);
  });

  it('[UI-74] a hand repair keeps the view switch and the layers, and refuses the modes, the exports and the map windows', async () => {
    await repairByHandNow();
    for (const [id, args] of NEVER_IN_SESSION) expect(await ran(id, args), id).toBe(false);
    expect(await ran('mode.set', { mode: 'mountain' })).toBe(false);
    expect(s().editMode.mode).toBeNull();
    expect(MODAL_IDS.filter((id) => s().modals[id])).toEqual([]);

    expect(await ran('view.layer_visible', { layer: 2, visible: false })).toBe(true);
    expect(s().layerVisibility[1]).toBe(false);
    expect(await ran('view.layer_visible', { layer: 2, visible: true })).toBe(true);
    expect(await ran('window.open', { window: 'help' })).toBe(true);
    expect(await ran('view.toggle', { value: '3d' })).toBe(true);
    expect(s().viewMode).toBe('3d');
  });

  it('[UI-74] an assistant panel left open as a hand repair began closes there and does not open again', async () => {
    s().setAssistantOpen(true);
    await repairByHandNow();
    expect(s().assistantOpen).toBe(true);
    expect(await ran('app.assistant', { on: false })).toBe(true);
    expect(s().assistantOpen).toBe(false);
    expect(await ran('app.assistant', { on: true })).toBe(false);
    expect(s().assistantOpen).toBe(false);
  });

  it('[UI-74] a key the session does not answer rests, where its control\'s command still runs', async () => {
    await repairByHandNow();
    pressKey('`');
    expect(s().viewMode, 'the view switch is the rail button\'s in a hand repair').toBe('2d');
    expect(await ran('view.toggle')).toBe(true);
    expect(s().viewMode).toBe('3d');
    pressKey('ctrl+p');
    expect(s().modals.share).toBe(false);

    cancelRepair();
    expect(s().viewMode, 'the map that was open comes back in its own view').toBe('2d');
    pressKey('`');
    expect(s().viewMode).toBe('3d');
    pressKey('ctrl+p');
    expect(s().modals.share).toBe(true);
  });
});
