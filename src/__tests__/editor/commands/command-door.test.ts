/** The command door over the live store: a command run by id changes what it names and reads it back. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ALL_COMMANDS, listCommands, mountShellCommands, runCommand } from '../../../editor/commands/run';
import { takePreparedFileChoices } from '../../../editor/export/prepared';
import { openingExportOptions } from '../../../io/export/options-store';
import { GRID_MODES } from '../../../platform/storage/prefs';
import { createDefaultRegistry } from '../../../rules';
import { MODAL_IDS, interfaceHidden } from '../../../state/slices/shell';
import { useEditorStore } from '../../../state/store';
import { makeTemplate } from '../../_support/map-state';

let webgl2 = true;
vi.mock('../../../platform/device/device-quality', async (original) => ({
  ...await original<typeof import('../../../platform/device/device-quality')>(),
  hasWebGL2: () => webgl2,
}));

const s = () => useEditorStore.getState();
const current = (id: string) => listCommands().find((action) => action.id === id)?.current;
const run = async (id: string, args: Record<string, unknown> = {}) => {
  const outcome = await runCommand(id, args);
  expect(outcome, `${id} ${JSON.stringify(args)}`).toMatchObject({ ok: true });
  return outcome;
};

beforeEach(() => {
  webgl2 = true;
  s().initMap(makeTemplate(30, 30), createDefaultRegistry());
});

afterEach(() => {
  for (const id of MODAL_IDS) s().setModal(id, false);
  s().setInterfaceHidden(false);
  s().setExport3dShots([]);
  takePreparedFileChoices();
});

describe('commands run by id', () => {
  it('switch the map options on and off and read them back', async () => {
    const switches: [string, () => boolean][] = [
      ['overlay.chunks', () => s().showChunkBounds],
      ['overlay.numbers', () => s().showLayerNumbers],
      ['view.interface_hidden', () => interfaceHidden(s())],
    ];
    for (const [id, read] of switches) {
      for (const on of [true, false, true]) {
        await run(id, { on });
        expect(read(), id).toBe(on);
        expect(current(id), id).toBe(on);
      }
    }
  });

  it('set the grid, the view, motion and the interface size and read them back', async () => {
    for (const mode of GRID_MODES) {
      await run('overlay.grid', { value: mode });
      expect(s().gridMode).toBe(mode);
      expect(current('overlay.grid')).toBe(mode);
    }
    await run('view.toggle', { value: '3d' });
    expect(s().viewMode).toBe('3d');
    await run('view.toggle', { value: '2d' });
    expect(current('view.toggle')).toBe('2d');
    await run('settings.motion', { value: 'reduced' });
    expect(s().motionPref).toBe('reduced');
    expect(current('settings.motion')).toBe('reduced');
    await run('settings.motion', { value: 'system' });
    await run('settings.interface_zoom', { value: 1.2 });
    expect(s().uiZoom).toBe(1.2);
    expect(current('settings.interface_zoom')).toBe(1.2);
    await run('settings.interface_zoom', { value: 1 });
  });

  it('switch the interface language once its strings have loaded', async () => {
    const before = s().locale;
    const next = before === 'fr' ? 'ja' : 'fr';
    await run('settings.language', { value: next });
    await vi.waitFor(() => expect(s().locale).toBe(next));
    expect(current('settings.language')).toBe(next);
    await run('settings.language', { value: before });
    await vi.waitFor(() => expect(s().locale).toBe(before));
  });

  it('hide and lock a layer by the number the layer panel shows', async () => {
    await run('view.layer_visible', { layer: 3, visible: false });
    expect(s().layerVisibility[2]).toBe(false);
    expect(String(current('view.layer_visible'))).toContain('3');
    await run('view.layer_visible', { layer: 3, visible: true });
    expect(s().layerVisibility[2]).toBe(true);

    await run('view.layer_locked', { layer: 2, locked: true });
    expect(s().gridState!.lockedLayers.has(1)).toBe(true);
    expect(String(current('view.layer_locked'))).toContain('2');
    await run('view.layer_locked', { layer: 2, locked: false });
    expect(s().gridState!.lockedLayers.has(1)).toBe(false);
  });

  it('hide and show the annotations of a map that has them', async () => {
    s().addAnnotation({ kind: 'chip', x: 4, y: 4, tag: 'homes' } as Parameters<ReturnType<typeof s>['addAnnotation']>[0]);
    await run('view.annotations', { on: false });
    expect(s().gridState!.annotations?.visible).toBe(false);
    expect(current('view.annotations')).toBe(false);
    await run('view.annotations', { on: true });
    expect(current('view.annotations')).toBe(true);
  });

  it('lock and unlock the annotations layer, as the notes row\'s lock does', async () => {
    s().addAnnotation({ kind: 'chip', x: 4, y: 4, tag: 'homes' } as Parameters<ReturnType<typeof s>['addAnnotation']>[0]);
    expect(current('view.annotations_locked')).toBe(false);
    await run('view.annotations_locked', { on: true });
    expect(s().gridState!.annotations?.locked).toBe(true);
    expect(current('view.annotations_locked')).toBe(true);
    await run('view.annotations_locked', { on: false });
    expect(s().gridState!.annotations?.locked).toBe(false);
    expect(await runCommand('view.annotations_locked')).toMatchObject({ ok: false });
  });

  it('open a window, the save-and-share window at a section and Help at a page', async () => {
    await run('window.open', { window: 'settings' });
    expect(s().modals.settings).toBe(true);
    await run('window.open', { window: 'share', section: 'stats' });
    expect(s().modals.share).toBe(true);
    expect(s().shareTarget).toBe('stats');
    await run('window.open', { window: 'help', page: 'share' });
    expect(s().modals.help).toBe(true);
    expect(s().helpTarget).toEqual({ page: 'share' });
    await run('window.open', { window: 'help', page: 'notes', anchor: 'notes-tags' });
    expect(s().helpTarget).toEqual({ page: 'notes', anchor: 'notes-tags' });
    const status = await run('window.status');
    for (const id of ['settings', 'share', 'help']) expect(status).toMatchObject({ result: expect.stringContaining(id) });
  });

  it('offer no window that stands only inside a repair or a planet import', async () => {
    for (const id of ['landmarkRepair', 'planetImport']) {
      expect(await runCommand('window.open', { window: id })).toMatchObject({ ok: false });
      expect(s().modals[id as 'landmarkRepair']).toBe(false);
    }
  });

  it('prepare a share picture: the choices are remembered and the window opens on the picture', async () => {
    const before = openingExportOptions();
    await run('app.export_image', { preset: 'plain', grid: !before.grid, resolution: 'high', card_3d: true, shots: 2 });
    expect(openingExportOptions()).toMatchObject({ ...before, preset: 'plain', grid: !before.grid, resolution: 'high', card3d: true });
    expect(s().export3dShots).toHaveLength(2);
    expect(s().modals.share).toBe(true);
    expect(s().shareTarget).toBe('friend');
    expect(String(current('app.export_image'))).toContain('plain');

    // A window already open opens again on the new choice.
    await run('app.export_image', { preset: 'share' });
    expect(openingExportOptions().preset).toBe('share');
    expect(openingExportOptions().resolution).toBe('high');
    expect(s().modals.share).toBe(true);
  });

  it('prepare a save file: the section choices wait for the window, which opens on the file', async () => {
    await run('app.export_json', { history: false, pretty: true, history_depth: 'recent' });
    expect(s().modals.share).toBe(true);
    expect(s().shareTarget).toBe('keep');
    expect(takePreparedFileChoices()).toEqual({ history: false, pretty: true, historyDepth: 'recent' });
    expect(takePreparedFileChoices()).toBeNull();
  });

  it('refuse an unknown id and a bad argument with a reason, changing nothing', async () => {
    const before = s().showChunkBounds;
    const refused = [
      await runCommand('settings.erase_everything', {}),
      await runCommand('view.interface_hidden', {}),
      await runCommand('overlay.chunks', { on: 'yes' }),
      await runCommand('overlay.chunks', { on: !before, extra: 1 }),
      await runCommand('overlay.grid', { value: 'hexagons' }),
      await runCommand('settings.interface_zoom', { value: 40 }),
      await runCommand('view.layer_visible', { layer: 2.5, visible: false }),
    ];
    for (const outcome of refused) {
      expect(outcome.ok).toBe(false);
      expect(outcome.ok === false && outcome.reason.length).toBeGreaterThan(0);
    }
    expect(s().showChunkBounds).toBe(before);
  });

  it('destroy stored work only by the keymap reset and the local data reset, and reach outward only by the blueprint export, behind its notice, and by switching planets', () => {
    const app = ALL_COMMANDS.filter((command) => command.target === 'app');
    expect(app.filter((command) => command.effect === 'destroy').map((command) => command.id)).toEqual(['keymap.reset', 'app.reset_local_data']);
    expect(app.filter((command) => command.effect === 'outward').map((command) => command.id)).toEqual(['blueprints.export', 'planets.switch']);
    expect(new Set(ALL_COMMANDS.map((command) => command.id)).size).toBe(ALL_COMMANDS.length);
  });

  it('run a key\'s command as its key does when given no argument', async () => {
    await run('overlay.grid', { value: 'terrain' });
    await run('overlay.grid');
    expect(s().gridMode).toBe('off');
    await run('overlay.grid');
    expect(s().gridMode).toBe('terrain');
    const chunks = s().showChunkBounds;
    await run('overlay.chunks');
    expect(s().showChunkBounds).toBe(!chunks);
    await run('overlay.chunks');

    const toggleMenu = vi.fn();
    expect(await runCommand('app.menu', {}, { toggleMenu })).toMatchObject({ ok: true });
    expect(toggleMenu).toHaveBeenCalledTimes(1);
  });

  /** A pictured frame (a Help figure) mounts a context of its own over the live frame's. */
  it('runs on the frame mounted last, and on the one before it once that one is gone', async () => {
    const live = { toggleMenu: vi.fn() };
    const pictured = { toggleMenu: vi.fn() };
    const unmountLive = mountShellCommands(live);
    const unmountPictured = mountShellCommands(pictured);
    await runCommand('app.menu');
    expect(pictured.toggleMenu).toHaveBeenCalledTimes(1);
    unmountPictured();
    await runCommand('app.menu');
    expect(live.toggleMenu).toHaveBeenCalledTimes(1);
    unmountLive();
    expect(await runCommand('app.menu')).toMatchObject({ ok: true });
    expect(live.toggleMenu).toHaveBeenCalledTimes(1);
  });

  it('step a cycle back as Shift with its key does', async () => {
    s().setEditMode({ mode: 'mountain', arm: { kind: 'brush' } });
    const before = s().terrainThickness;
    await run('tool.thickness_cycle');
    const stepped = s().terrainThickness;
    expect(stepped).not.toBe(before);
    await run('tool.thickness_cycle', { step: 'previous' });
    expect(s().terrainThickness).toBe(before);
  });

  it('refuse 3D where the device cannot draw it', async () => {
    webgl2 = false;
    expect(await runCommand('view.toggle', { value: '3d' })).toMatchObject({ ok: false });
    expect(s().viewMode).toBe('2d');
  });
});
