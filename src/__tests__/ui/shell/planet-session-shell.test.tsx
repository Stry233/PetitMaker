// @vitest-environment jsdom
/**
 * The editor reduced to the planet session: three modes, the history and zoom controls, the ground
 * materials, the nameplate with Back and Done, the menu without its map rows, and the keys that
 * belong to drawing a planet.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { I18nProvider, translate } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { Shell } from '../../../ui/shell/Shell';
import { newMap } from '../../../editor/operations/map';
import { editorPort } from '../../../editor/session/context';
import { host } from '../../../editor/host/host';
import { useKeybinds } from '../../../state/keymap/store';
import { setToastPresenter } from '../../../platform/channels/toast-bus';
import { listPlanets, savePlanet } from '../../../io/storage/planet-library';
import { CommandType, TerrainType, type MacroCoord } from '../../../core/model/types';
import { CellZone } from '../../../core/game/zones';
import { finishPlanetSession } from '../../../editor/operations/planet-session';
import { placeSessionLandmark } from '../../_support/session-landmarks';
import { canStartPlanetEditing, startPlanetEditing, stopPlanetEditing } from '../../../editor/session/planet-editing';
import { sessionModes } from '../../../ui/shell/frame';
import { layerNumbersShown } from '../../../state/layer-utils';
import { DropImportOverlay } from '../../../ui/chrome/modals/import/DropImportOverlay';
import { ContextMenu } from '../../../ui/chrome/floating/ContextMenu';
import { DeletePopover } from '../../../ui/chrome/floating/DeletePopover';
import { planetFixture } from '../../_support/planet';
import { setStoreState } from '../../_support/store';
import { ANCHOR_LANDMARK } from '../../_support/anchor';
import type { TextKey } from '../../../i18n/keys';

// Names are checked by the export text review; these tests stub its verdict as approved.
vi.mock('../../../pipelines/moderation/text/reviewer', async (original) => ({
  ...await original<typeof import('../../../pipelines/moderation/text/reviewer')>(),
  reviewText: vi.fn(async () => ({ allowed: true })),
}));

// The real session finish, which one test makes report that nothing could be saved.
vi.mock('../../../editor/operations/planet-session', async (original) => {
  const actual = await original<typeof import('../../../editor/operations/planet-session')>();
  return { ...actual, finishPlanetSession: vi.fn(actual.finishPlanetSession) };
});

const store = () => useEditorStore.getState();
const t = (key: TextKey, params?: Record<string, string | number>) => translate(key, params);

function mount() {
  return render(
    <Shell onRestoreSession={() => {}}><div data-testid="map-views" /></Shell>,
    { wrapper: ({ children }) => <I18nProvider>{children}</I18nProvider> },
  );
}

function paintGround(cells: MacroCoord[]): void {
  const exec = store().commandExecutor!;
  const start = exec.beginStroke();
  exec.execute({ type: CommandType.PaintTerrain, cells, terrainType: TerrainType.Mountain, elevation: 0, ground: CellZone.Grass });
  start.commit();
}

function island(): MacroCoord[] {
  const cells: MacroCoord[] = [];
  for (let y = 100; y < 140; y++) for (let x = 100; x < 150; x++) cells.push({ x, y });
  return cells;
}

const press = (key: string, init: KeyboardEventInit = {}) => act(() => { fireEvent.keyDown(window, { key, ...init }); });
const button = (name: string) => screen.getByRole('button', { name });
const queryButton = (name: string) => screen.queryByRole('button', { name });

/** Opens a session. A mounted shell offers the first-launch tour, which would refuse the entry. */
function enter(entry: Parameters<typeof startPlanetEditing>[0] = null): void {
  act(() => { store().setTourRunning(false); startPlanetEditing(entry, false); });
}

beforeEach(() => {
  localStorage.clear();
  setStoreState({ locale: 'en' });
  newMap(editorPort, 'hexia');
  store().setAssistantOpen(false);
  store().setEditMode({ mode: null });
  store().setTourRunning(false);
  store().setContextMenu(null);
  // Leaving a session reopens Change Planet, which would stand over the next test's shell.
  store().setModal('newProject', false);
  useEditorStore.setState({ planetReturn: null });
});

afterEach(() => {
  act(() => { stopPlanetEditing(); });
  host.camera.takeQueued();
  useKeybinds.getState().resetAll();
  cleanup();
  vi.restoreAllMocks();
});

describe('the session modes', () => {
  it('are mountain, water and object in the session and all five otherwise', () => {
    expect(sessionModes(null)).toEqual(['object', 'road', 'mountain', 'water', 'generate']);
    enter();
    expect(sessionModes(store().planetSession)).toEqual(['mountain', 'water', 'object']);
  });
});

describe('the reduced shell', () => {
  it('shows only the terrain, water and object modes, naming the mountain mode Terrain', async () => {
    mount();
    enter();
    await waitFor(() => expect(queryButton('Roads')).toBeNull());
    const row = button('Terrain').parentElement!;
    expect(within(row).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Terrain', 'Water', 'Objects']);
    expect(queryButton('Mountains')).toBeNull();
    expect(queryButton('Generate')).toBeNull();
    expect(queryButton('Assistant')).toBeNull();
  });

  it('takes away the layer control, the view switch, hiding the interface and share', async () => {
    mount();
    enter();
    await waitFor(() => expect(queryButton('Switch view')).toBeNull());
    expect(queryButton('Hide interface')).toBeNull();
    expect(screen.queryByRole('button', { name: /Layers/ })).toBeNull();
    await waitFor(() => expect(queryButton('Save and share')).toBeNull());
    for (const name of ['Undo', 'Redo', 'Zoom in', 'Zoom out', 'Fit to view']) expect(button(name)).toBeTruthy();
  });

  it('puts Back, the name and Done on the nameplate', () => {
    mount();
    enter();
    const plate = screen.getByTestId('planet-nameplate');
    expect(within(plate).getByRole('button', { name: t('planet.back') })).toBeTruthy();
    expect(within(plate).getByText(t('planet.default_name', { n: 1 }))).toBeTruthy();
    expect(within(plate).getByRole('button', { name: t('planet.done') })).toBeTruthy();
  });

  it('keeps the menu, without Change planet and Import', async () => {
    mount();
    enter();
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Open menu' })).toHaveLength(1));
    fireEvent.click(button('Open menu'));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((row) => row.textContent))
      .toEqual([t('modal.settings_title'), t('modal.help_title'), t('modal.about_title')]);
  });

  it('gives the mountain bar the two ground materials, grass named Ground while the ground stays flat, and no smart build or trim', async () => {
    mount();
    enter();
    await waitFor(() => expect(button(t('layer.ground'))).toBeTruthy());
    expect(queryButton(t('planet.material_mountain'))).toBeNull();
    expect(button(t('layer.ground')).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(button(t('planet.material_sand')));
    expect(store().planetMaterial).toBe('sand');
    expect(button(t('planet.material_sand')).getAttribute('aria-pressed')).toBe('true');
    expect(button('Brush')).toBeTruthy();
    expect(button('Eraser')).toBeTruthy();
    expect(queryButton('Smart build')).toBeNull();
    expect(queryButton('Edge Cut')).toBeNull();
    expect(queryButton('Auto Trim')).toBeNull();
  });

  it('shows no layer numbers while the ground stays flat, and the toggle again once the session ends', () => {
    act(() => { store().setShowLayerNumbers(true); });
    expect(layerNumbersShown(store())).toBe(true);
    enter();
    expect(layerNumbersShown(store())).toBe(false);
    act(() => { stopPlanetEditing(); });
    expect(layerNumbersShown(store())).toBe(true);
    act(() => { store().setShowLayerNumbers(false); });
  });

  it('keeps the full shell outside the session', () => {
    mount();
    expect(button('Roads')).toBeTruthy();
    expect(button('Switch view')).toBeTruthy();
    expect(queryButton(t('planet.back'))).toBeNull();
    expect(queryButton(t('planet.material_sand'))).toBeNull();
  });
});

describe('keys in the session', () => {
  it('leave the road mode and the 3D view alone', () => {
    useKeybinds.getState().rebind('surface.road', 'r');
    mount();
    enter();
    press('r');
    expect(store().editMode.mode).toBe('mountain');
    press('`');
    expect(store().viewMode).toBe('2d');
  });

  it('still undo and switch between the session modes', () => {
    useKeybinds.getState().rebind('surface.river', 'r');
    mount();
    enter();
    paintGround(island());
    press('r');
    expect(store().editMode.mode).toBe('water');
    const undo = store().commandExecutor!.historyDepth();
    press('z', { ctrlKey: true });
    expect(store().commandExecutor!.historyDepth()).toBe(undo - 1);
  });

  it('turn the selected session plaza', () => {
    mount();
    enter();
    paintGround(island());
    expect(placeSessionLandmark({ x: 110, y: 105 }, 0).success).toBe(true);
    act(() => { store().setSelection([{ kind: 'object', id: ANCHOR_LANDMARK.id }]); });
    press('e');
    expect(store().gridState!.objects.get(ANCHOR_LANDMARK.id)!.rotation).toBe(90);
  });

  it('delete the selected session plaza through the delete card', () => {
    render(<I18nProvider><DeletePopover /></I18nProvider>);
    mount();
    enter();
    paintGround(island());
    expect(placeSessionLandmark({ x: 110, y: 105 }, 0).success).toBe(true);
    act(() => { store().setSelection([{ kind: 'object', id: ANCHOR_LANDMARK.id }]); });
    press('Delete');
    expect(store().deletePopover).toEqual({ kind: 'object', id: ANCHOR_LANDMARK.id });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: t('delete.confirm_btn') }));
    expect(store().gridState!.objects.get(ANCHOR_LANDMARK.id)).toBeUndefined();
    store().commandExecutor!.undo();
    expect(store().gridState!.objects.get(ANCHOR_LANDMARK.id)).toBeTruthy();
  });

  it('let the context menu turn the session plaza to a facing', () => {
    render(<I18nProvider><ContextMenu /></I18nProvider>);
    enter();
    paintGround(island());
    expect(placeSessionLandmark({ x: 110, y: 105 }, 0).success).toBe(true);
    act(() => { store().setContextMenu({ x: 10, y: 10, target: { kind: 'object', id: ANCHOR_LANDMARK.id } }); });
    fireEvent.click(screen.getByRole('menuitem', { name: t('context.rotate_270') }));
    expect(store().gridState!.objects.get(ANCHOR_LANDMARK.id)!.rotation).toBe(270);
    expect(store().commandExecutor!.canUndo()).toBe(true);
  });
});

describe('Back', () => {
  it('leaves at once when nothing was drawn', () => {
    mount();
    enter();
    fireEvent.click(button(t('planet.back')));
    expect(store().planetSession).toBeNull();
  });

  it('asks before discarding a drawn planet', async () => {
    mount();
    enter();
    act(() => paintGround(island()));
    fireEvent.click(button(t('planet.back')));
    const dialog = await screen.findByRole('dialog', { name: t('planet.discard_title') });
    expect(store().planetSession).not.toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: t('planet.discard') }));
    expect(store().planetSession).toBeNull();
  });

  it('keeps editing when the question is cancelled', async () => {
    mount();
    enter();
    act(() => paintGround(island()));
    fireEvent.click(button(t('planet.back')));
    const dialog = await screen.findByRole('dialog', { name: t('planet.discard_title') });
    fireEvent.click(within(dialog).getByRole('button', { name: t('planet.keep_editing') }));
    expect(store().planetSession).not.toBeNull();
  });
});

describe('Done', () => {
  it('is unavailable while the planet has no ground', async () => {
    mount();
    enter();
    expect((button(t('planet.done')) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button(t('planet.done')));
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => paintGround(island()));
    await waitFor(() => expect((button(t('planet.done')) as HTMLButtonElement).disabled).toBe(false));
  });

  it('saves a new planet under the name given', async () => {
    mount();
    enter();
    act(() => paintGround(island()));
    await waitFor(() => expect((button(t('planet.done')) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button(t('planet.done')));
    const dialog = await screen.findByRole('dialog', { name: t('planet.save_title_new') });
    const field = within(dialog).getByRole('textbox', { name: t('planet.name_field') }) as HTMLInputElement;
    expect(field.value).toBe(t('planet.default_name', { n: 1 }));
    expect(within(dialog).getByText(t('planet.chunks', { w: 4, h: 3 }))).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: t('planet.save_copy') })).toBeNull();
    fireEvent.change(field, { target: { value: 'Bay' } });
    const save = within(dialog).getByRole('button', { name: t('planet.save_title_new') }) as HTMLButtonElement;
    await waitFor(() => expect(save.disabled).toBe(false));
    fireEvent.click(save);
    expect(store().planetSession).toBeNull();
    expect(listPlanets().map((e) => e.name)).toEqual(['Bay']);
    // The shell comes back to Change Planet with the saved planet chosen.
    expect(store().planetReturn).toEqual({ chosen: listPlanets()[0]!.entryId });
    expect(store().modals.newProject).toBe(true);
    expect(screen.getByTestId(`planet-${listPlanets()[0]!.entryId}`).getAttribute('aria-pressed')).toBe('true');
  });

  it('replaces the planet being edited or saves a copy of it', async () => {
    const saved = savePlanet('Cove', planetFixture());
    if (!saved.ok) throw new Error('fixture save failed');
    mount();
    enter(saved.entry);
    fireEvent.click(button(t('planet.done')));
    let dialog = await screen.findByRole('dialog', { name: t('planet.save_title_edit') });
    expect((within(dialog).getByRole('textbox') as HTMLInputElement).value).toBe('Cove');
    fireEvent.click(within(dialog).getByRole('button', { name: t('planet.save_copy') }));
    expect(listPlanets().map((e) => e.name)).toEqual(['Cove', 'Cove']);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: t('planet.save_title_edit') })).toBeNull());

    enter(listPlanets()[0]!);
    fireEvent.click(button(t('planet.done')));
    dialog = await screen.findByRole('dialog', { name: t('planet.save_title_edit') });
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Lagoon' } });
    const save = within(dialog).getByRole('button', { name: t('planet.save_title_new') }) as HTMLButtonElement;
    await waitFor(() => expect(save.disabled).toBe(false));
    fireEvent.click(save);
    expect(listPlanets().map((e) => e.name)).toEqual(['Lagoon', 'Cove']);
  });

  it('reports a save the browser cannot hold and stays in the session', async () => {
    const toasts: string[] = [];
    const stop = setToastPresenter((text) => toasts.push(text));
    try {
      mount();
      enter();
      act(() => paintGround(island()));
      await waitFor(() => expect((button(t('planet.done')) as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(button(t('planet.done')));
      const dialog = await screen.findByRole('dialog', { name: t('planet.save_title_new') });
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
      fireEvent.click(within(dialog).getByRole('button', { name: t('planet.save_title_new') }));
      expect(toasts).toContain(t('planet.save_failed'));
      expect(store().planetSession).not.toBeNull();
      expect(screen.getByRole('dialog', { name: t('planet.save_title_new') })).toBeTruthy();
    } finally {
      stop();
    }
  });

  it('reports a save that cannot finish and keeps the save panel and the session', async () => {
    const toasts: string[] = [];
    const stop = setToastPresenter((text) => toasts.push(text));
    try {
      mount();
      enter();
      act(() => paintGround(island()));
      await waitFor(() => expect((button(t('planet.done')) as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(button(t('planet.done')));
      const dialog = await screen.findByRole('dialog', { name: t('planet.save_title_new') });
      vi.mocked(finishPlanetSession).mockReturnValueOnce({ ok: false, reason: 'empty' });
      fireEvent.click(within(dialog).getByRole('button', { name: t('planet.save_title_new') }));
      expect(toasts).toEqual([t('planet.finish_failed')]);
      expect(store().planetSession).not.toBeNull();
      expect(listPlanets()).toEqual([]);
      expect(screen.getByRole('dialog', { name: t('planet.save_title_new') })).toBeTruthy();
    } finally {
      stop();
    }
  });
});

describe('guards', () => {
  it('refuse entering while an annotation draft is open', () => {
    act(() => { store().setAnnotationDraft({ kind: 'zone', id: 'draft', cells: [{ x: 1, y: 1 }], color: 0, tag: null } as never); });
    expect(canStartPlanetEditing(store(), false)).toBe(false);
    enter();
    expect(store().planetSession).toBeNull();
  });

  it('refuse entering while the tour is running', () => {
    act(() => { store().setTourRunning(true); });
    expect(canStartPlanetEditing(store(), false)).toBe(false);
    act(() => { startPlanetEditing(null, false); });
    expect(store().planetSession).toBeNull();
  });

  it('refuse entering while an assistant job is running', () => {
    expect(canStartPlanetEditing(store(), true)).toBe(false);
    expect(canStartPlanetEditing(store(), false)).toBe(true);
  });

  it('allow entering on an ordinary map and refuse a second entry', () => {
    expect(canStartPlanetEditing(store(), false)).toBe(true);
    enter();
    expect(canStartPlanetEditing(store(), false)).toBe(false);
  });

  it('ignore a file dropped in the session', () => {
    render(<I18nProvider><DropImportOverlay /></I18nProvider>);
    enter();
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.assign(drop, { dataTransfer: { types: ['Files'], files: [new File(['{}'], 'map.json')] } });
    act(() => { window.dispatchEvent(new Event('dragenter')); window.dispatchEvent(drop); });
    expect(drop.defaultPrevented).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(store().planetSession).not.toBeNull();
  });
});
