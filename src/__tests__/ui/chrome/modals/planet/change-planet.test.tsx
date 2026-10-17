// @vitest-environment jsdom
/**
 * Change Planet: the list of built-in and saved planets, the chosen planet's preview with the tools
 * a saved planet offers, and the footer verb that names what the press does.
 *
 * Two things it must never get wrong. Export first stands exactly while there are unexported edits
 * and the press would discard them. And the verb: it reports the carry choice exactly as the visitor
 * left it, and acts once.
 */
import { afterPaint } from '../../../../../platform/async/after-paint';
import { MAX_IMPORT_BYTES } from '../../../../../io/save/limits';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, cleanup, fireEvent, within, waitFor } from '@testing-library/react';
import { ChangePlanetModal } from '../../../../../ui/chrome/modals/planet/ChangePlanetModal';
import { I18nProvider } from '../../../../../i18n/context';
import { useEditorStore } from '../../../../../state/store';
import { CommandExecutor } from '../../../../../core/commands/command-executor';
import { createDefaultRegistry } from '../../../../../rules';
import { createGrid } from '../../../../../core/model/grid-model';
import { MAP_TEMPLATES } from '../../../../../config/maps';
import { CommandType, TerrainType, type Corners, type GridState, type MapTemplate } from '../../../../../core/model/types';
import { listPlanets, savePlanet, type PlanetEntry } from '../../../../../io/storage/planet-library';
import { writePlanetFile } from '../../../../../io/save/planet-codec';
import { setToastPresenter } from '../../../../../platform/channels/toast-bus';
import { planetFixture, NO_PLAZA } from '../../../../_support/planet';
import { jsonFile } from '../../../../_support/json-file';
import { newMap, requestTransferPreview } from '../../../../../editor/operations';
import { transferPreviewOf } from '../../../../../tools/generation/run/planet-preview';
import { currentEditor, editorPort } from '../../../../../editor/session/context';
import { useTransition } from '../../../../../ui/design/motion/use-motion';
import { framerMotion } from '../../../../../ui/design/motion';
import { createExecutor } from '../../../../../state/executor';
import { installPictureRenderer } from '../../../../_support/picture-renderer';

// Names are checked by the export text review; these tests stub its verdict as approved.
vi.mock('../../../../../pipelines/moderation/text/reviewer', async (original) => ({
  ...await original<typeof import('../../../../../pipelines/moderation/text/reviewer')>(),
  reviewText: vi.fn(async () => ({ allowed: true })),
}));

// Passthroughs, watched: how often the carry step asks for the transfer, and which motion its steps take.
vi.mock('../../../../../editor/operations', async (original) => {
  const actual = await original<typeof import('../../../../../editor/operations')>();
  return { ...actual, requestTransferPreview: vi.fn(actual.requestTransferPreview) };
});
vi.mock('../../../../../ui/design/motion/use-motion', async (original) => {
  const actual = await original<typeof import('../../../../../ui/design/motion/use-motion')>();
  return { ...actual, useTransition: vi.fn(actual.useTransition) };
});

const HEXIA = MAP_TEMPLATES['hexia']!;
const TAFA = MAP_TEMPLATES['tafa']!;

/** The live editor, standing on a real planet: the window reads which one it is. */
function world(template: MapTemplate = HEXIA) {
  const state: GridState = { template, cells: createGrid(template), objects: new Map(), objectsVersion: 0, cellsVersion: 0, lockedLayers: new Set() };
  const executor = createExecutor(state, createDefaultRegistry());
  act(() => { useEditorStore.setState({ commandExecutor: executor, gridState: state, exportedAt: null, locale: 'en', tourRunning: false }); });
  return { state, executor };
}

const paint = (executor: CommandExecutor, x: number) => act(() => {
  executor.execute({
    type: CommandType.PaintTerrain, cells: [{ x, y: 60 }],
    terrainType: TerrainType.Mountain, elevation: 1,
  });
});

/** A ground-level edge cut: a `None` cell at elevation 0 carrying corners, which no layer tally sees. */
function cutGround(state: GridState, x: number, y: number) {
  const cell = state.cells[y]?.[x];
  if (cell) cell.terrain = { type: TerrainType.None, elevation: 0, corners: ['fan', 'square', 'square', 'square'] as Corners };
}

function saved(name = 'Bay', template = planetFixture()): PlanetEntry {
  const r = savePlanet(name, template);
  if (!r.ok) throw new Error('save failed');
  return r.entry;
}

const show = (props: Partial<React.ComponentProps<typeof ChangePlanetModal>> = {}) => render(
  <I18nProvider>
    <ChangePlanetModal open onSwitch={() => {}} onClose={() => {}} {...props} />
  </I18nProvider>,
);

// By testid, not by name: while the transfer runs the button's label is the busy dots.
const verb = () => screen.getByTestId('planet-switch') as HTMLButtonElement;
// A preview crossfading out stays in the document until its fade ends.
const previewName = () => screen.getAllByTestId('planet-preview-name').find((el) => !el.closest('[data-leaving]'))?.textContent;
const flush = () => act(async () => { await afterPaint(); });
const press = async () => { await act(async () => { fireEvent.click(verb()); await afterPaint(); }); };

const toasts: [string, string][] = [];
let unpresent: () => void = () => {};
let pictures: ReturnType<typeof installPictureRenderer>;

beforeEach(() => {
  // The pictures come from the map's renderer, which jsdom stands in for.
  pictures = installPictureRenderer();
  localStorage.clear();
  toasts.length = 0;
  unpresent = setToastPresenter((text, type) => { toasts.push([text, type]); });
  useEditorStore.setState({ exportedAt: null, locale: 'en' });
});
afterEach(() => { cleanup(); unpresent(); pictures.uninstall(); useEditorStore.setState({ exportedAt: null, tourRunning: false }); });

/** Row test ids under the Current planet and My planets headings of the list. */
function listGroups() {
  const rows = screen.getAllByRole('button').filter((b) => b.dataset.testid?.startsWith('planet-') && b.hasAttribute('aria-pressed'));
  const heading = (text: string) => screen.queryByText(text, { selector: 'div' });
  const after = (h: HTMLElement | null, r: HTMLElement) => !!h && !!(h.compareDocumentPosition(r) & Node.DOCUMENT_POSITION_FOLLOWING);
  const current = heading('Current planet'), builtin = heading('Built-in planets'), mine = heading('My planets');
  return {
    current: rows.filter((r) => after(current, r) && !after(builtin, r)).map((r) => r.dataset.testid),
    mine: rows.filter((r) => after(mine, r) && r.dataset.testid !== 'planet-new' && r.dataset.testid !== 'planet-import').map((r) => r.dataset.testid),
  };
}

describe('the planet list', () => {
  it('groups the built-in planets and My planets, with the new and import rows ahead of saved ones', () => {
    world();
    const bay = saved();
    show();
    expect(screen.getByText('Built-in planets')).toBeTruthy();
    expect(screen.getByText('My planets')).toBeTruthy();
    const order = ['planet-hexia', 'planet-tafa', 'planet-new', 'planet-import', `planet-${bay.entryId}`]
      .map((id) => screen.getByTestId(id));
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(screen.getByTestId('planet-new').textContent).toBe('New planet');
    expect(screen.getByTestId('planet-import').textContent).toBe('Import planet');
    expect(screen.getByTestId(`planet-${bay.entryId}`).textContent).toContain('Bay');
  });

  it('marks the planet the map stands on, and opens with it chosen', () => {
    world();
    show();
    const here = screen.getByTestId('planet-hexia');
    expect(here.getAttribute('aria-current')).toBe('true');
    expect(within(here).getByRole('img', { name: 'Current planet' })).toBeTruthy();
    expect(here.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('planet-tafa').getAttribute('aria-current')).toBeNull();
    expect(previewName()).toBe(HEXIA.name.en);
  });

  it('shows the chosen planet in the preview, with its chunk count', () => {
    world();
    show();
    fireEvent.click(screen.getByTestId('planet-tafa'));
    expect(previewName()).toBe(TAFA.name.en);
    expect(screen.getByTestId('planet-tafa').getAttribute('aria-pressed')).toBe('true');
    // A planet saved while the window is open joins the list.
    let bay!: PlanetEntry;
    act(() => { bay = saved(); });
    fireEvent.click(screen.getByTestId(`planet-${bay.entryId}`));
    expect(previewName()).toBe('Bay');
    expect(screen.getAllByText('3 × 2 chunks').length).toBeGreaterThan(0);
  });

  it('keeps a row for the current planet once its saved entry is deleted', async () => {
    const bay = saved();
    world(bay.template);
    show();
    fireEvent.click(within(screen.getByTestId('planet-tools')).getByRole('button', { name: 'Delete' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Delete “Bay”?' })).getByRole('button', { name: 'Delete' }));
    const here = screen.getByTestId(`planet-${bay.template.id}`);
    expect(here.getAttribute('aria-current')).toBe('true');
    expect(here.getAttribute('aria-pressed')).toBe('true');
    expect(within(here).getByRole('img', { name: 'Current planet' })).toBeTruthy();
    // The row has no saved entry behind it, so there is nothing for the tools to act on.
    await waitFor(() => expect(screen.queryByTestId('planet-tools')).toBeNull());
    // The name no entry carries is shown once the check approves it.
    await waitFor(() => expect(verb().textContent).toBe('Start over on Bay'));
    // It leaves My planets and stands in the Current planet group, above the built-ins.
    expect(listGroups().mine).not.toContain(`planet-${bay.template.id}`);
    expect(listGroups().current).toEqual([`planet-${bay.template.id}`]);
  });

  it('starts over on the current planet a saved entry no longer holds, on that same planet', async () => {
    const older = planetFixture({ plaza: NO_PLAZA });
    const w = world(older);
    const view = show({ onSwitch: (target) => { newMap(editorPort, target); } });
    // Nothing built: nothing to start over.
    await waitFor(() => expect(verb().textContent).toBe('Start over on Bay'));
    expect(verb().disabled).toBe(true);
    view.unmount();
    act(() => {
      w.executor.execute({ type: CommandType.PaintTerrain, cells: [{ x: 20, y: 15 }], terrainType: TerrainType.Mountain, elevation: 1 });
    });
    show({ onSwitch: (target) => { newMap(editorPort, target); } });
    expect(verb().disabled).toBe(false);
    await press();
    expect(useEditorStore.getState().gridState!.template.id).toBe(older.id);
    expect(useEditorStore.getState().gridState).not.toBe(w.state);
  });

  it('lists the current planet beside the saved planet it was edited from', () => {
    const bay = saved('Bay', planetFixture());
    const older = planetFixture({ plaza: NO_PLAZA });
    world(older);
    show();
    const here = screen.getByTestId(`planet-${older.id}`);
    const entry = screen.getByTestId(`planet-${bay.entryId}`);
    expect(here.getAttribute('aria-current')).toBe('true');
    expect(entry.getAttribute('aria-current')).toBeNull();
    expect(here.compareDocumentPosition(entry) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(listGroups().current).toEqual([`planet-${older.id}`]);
    expect(listGroups().mine).toEqual([`planet-${bay.entryId}`]);
    expect(within(here).getByRole('img', { name: 'Current planet' })).toBeTruthy();
  });

  it('has no Current planet group while the map stands on a listed planet', () => {
    world();
    show();
    expect(screen.queryByText('Current planet', { selector: 'div' })).toBeNull();
  });

  it('marks a saved planet as current when the map stands on it', () => {
    const bay = saved();
    world(bay.template);
    show();
    expect(screen.getByTestId(`planet-${bay.entryId}`).getAttribute('aria-current')).toBe('true');
    expect(previewName()).toBe('Bay');
  });
});

describe('the preview tools', () => {
  it('stand over a saved planet and not over a built-in one', () => {
    world();
    const bay = saved();
    show();
    expect(screen.queryByTestId('planet-tools')).toBeNull();
    fireEvent.click(screen.getByTestId(`planet-${bay.entryId}`));
    const tools = within(screen.getByTestId('planet-tools'));
    for (const name of ['Edit shape', 'Rename', 'Duplicate', 'Export', 'Delete']) expect(tools.getByRole('button', { name })).toBeTruthy();
  });

  it('rename asks for the name and renames through the library', async () => {
    world();
    const bay = saved();
    show({ initialChosen: bay.entryId });
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const card = within(screen.getByRole('dialog', { name: 'Rename' }));
    const field = card.getByRole('textbox', { name: 'Planet name' }) as HTMLInputElement;
    expect(field.value).toBe('Bay');
    fireEvent.change(field, { target: { value: '  Reef  ' } });
    const ok = card.getByRole('button', { name: 'OK' }) as HTMLButtonElement;
    await waitFor(() => expect(ok.disabled).toBe(false));
    fireEvent.click(ok);
    expect(listPlanets().map((e) => e.name)).toEqual(['Reef']);
    expect(previewName()).toBe('Reef');
  });

  it('delete asks by name, removes the planet and falls back to the current planet', async () => {
    world();
    const bay = saved();
    show({ initialChosen: bay.entryId });
    fireEvent.click(within(screen.getByTestId('planet-tools')).getByRole('button', { name: 'Delete' }));
    const card = within(screen.getByRole('dialog', { name: 'Delete “Bay”?' }));
    fireEvent.click(card.getByRole('button', { name: 'Delete' }));
    expect(listPlanets()).toEqual([]);
    expect(screen.queryByTestId(`planet-${bay.entryId}`)).toBeNull();
    expect(previewName()).toBe(HEXIA.name.en);
  });

  it('duplicate adds a copy and chooses it', () => {
    world();
    const bay = saved();
    show({ initialChosen: bay.entryId });
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    expect(listPlanets().map((e) => e.name)).toEqual(['Bay', 'Bay copy']);
    expect(previewName()).toBe('Bay copy');
  });

  it('edit opens the planet editor on the chosen planet, and New planet on a new one', () => {
    world();
    const bay = saved();
    const onEditPlanet = vi.fn();
    show({ onEditPlanet, canEditPlanet: true, initialChosen: bay.entryId });
    fireEvent.click(screen.getByRole('button', { name: 'Edit shape' }));
    expect(onEditPlanet).toHaveBeenLastCalledWith(expect.objectContaining({ entryId: bay.entryId }));
    fireEvent.click(screen.getByTestId('planet-new'));
    expect(onEditPlanet).toHaveBeenLastCalledWith(null);
  });

  it('keeps the editor entries unavailable while its owner says a planet session cannot start', () => {
    world();
    const bay = saved();
    const onEditPlanet = vi.fn();
    show({ onEditPlanet, canEditPlanet: false, initialChosen: bay.entryId });
    expect((screen.getByTestId('planet-new') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Edit shape' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('planet-new'));
    expect(onEditPlanet).not.toHaveBeenCalled();
  });
});

describe('the list follows each library write in the same render', () => {
  const rowNames = () => screen.getAllByRole('button').filter((b) => b.dataset.testid?.startsWith('planet-') && b.hasAttribute('aria-pressed')).map((b) => b.textContent);

  it('drops a deleted row at once and falls back to the current planet, opened on that row from a session', () => {
    world();
    const bay = saved('Bay');
    const cove = saved('Cove', planetFixture({ plaza: NO_PLAZA }));
    show({ initialChosen: bay.entryId });
    fireEvent.click(within(screen.getByTestId('planet-tools')).getByRole('button', { name: 'Delete' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Delete “Bay”?' })).getByRole('button', { name: 'Delete' }));
    expect(screen.queryByTestId(`planet-${bay.entryId}`)).toBeNull();
    expect(screen.getByTestId(`planet-${cove.entryId}`).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByTestId('planet-hexia').getAttribute('aria-pressed')).toBe('true');
    expect(rowNames()).toEqual([HEXIA.name.en, TAFA.name.en, 'Cove']);
    expect(previewName()).toBe(HEXIA.name.en);
  });

  it('renames, duplicates and imports into the list at once', async () => {
    world();
    const bay = saved('Bay');
    show({ initialChosen: bay.entryId });
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const card = within(screen.getByRole('dialog', { name: 'Rename' }));
    fireEvent.change(card.getByRole('textbox', { name: 'Planet name' }), { target: { value: 'Reef' } });
    const ok = card.getByRole('button', { name: 'OK' }) as HTMLButtonElement;
    await waitFor(() => expect(ok.disabled).toBe(false));
    fireEvent.click(ok);
    expect(rowNames()).toEqual([HEXIA.name.en, TAFA.name.en, 'Reef']);

    fireEvent.click(within(screen.getByTestId('planet-tools')).getByRole('button', { name: 'Duplicate' }));
    expect(rowNames()).toEqual([HEXIA.name.en, TAFA.name.en, 'Reef', 'Reef copy']);

    await act(async () => {
      fireEvent.change(screen.getByTestId('planet-file'), { target: { files: [jsonFile(writePlanetFile('Lagoon', planetFixture({ plaza: NO_PLAZA })), 'application/json')] } });
    });
    await flush();
    expect(rowNames()).toEqual([HEXIA.name.en, TAFA.name.en, 'Reef', 'Reef copy', 'Lagoon']);
  });
});

describe('importing a planet file', () => {
  const choose = async (text: string) => {
    await act(async () => { fireEvent.change(screen.getByTestId('planet-file'), { target: { files: [jsonFile(text, 'application/json')] } }); });
    await flush();
  };

  it('adds a valid planet and chooses it', async () => {
    world();
    show();
    await choose(writePlanetFile('Reef', planetFixture()));
    await waitFor(() => expect(listPlanets().map((e) => e.name)).toEqual(['Reef']));
    expect(previewName()).toBe('Reef');
  });

  it('chooses the saved planet a file already holds, without adding it twice', async () => {
    world();
    const bay = saved('Bay', planetFixture());
    saved('Lagoon', planetFixture({ plaza: NO_PLAZA }));
    show();
    await choose(writePlanetFile('Other name', planetFixture()));
    await waitFor(() => expect(screen.getByTestId(`planet-${bay.entryId}`).getAttribute('aria-pressed')).toBe('true'));
    expect(listPlanets()).toHaveLength(2);
  });

  it('says so when the file is not a planet', async () => {
    world();
    show();
    await choose('{"format":"something else"}');
    await waitFor(() => expect(toasts).toEqual([['Import: this planet file cannot be read', 'error']]));
    expect(listPlanets()).toEqual([]);
  });

  it('refuses a file past the import limit without reading it', async () => {
    world();
    show();
    const file = new File(['{}'], 'huge.planet.json', { type: 'application/json' });
    Object.defineProperty(file, 'size', { value: MAX_IMPORT_BYTES + 1 });
    const read = vi.fn(async () => '{}');
    Object.defineProperty(file, 'text', { value: read });
    await act(async () => { fireEvent.change(screen.getByTestId('planet-file'), { target: { files: [file] } }); });
    await waitFor(() => expect(toasts).toEqual([['Import: this planet file cannot be read', 'error']]));
    expect(read).not.toHaveBeenCalled();
    expect(listPlanets()).toEqual([]);
  });
});

describe('the verb', () => {
  it('asks for the next step when the map has a build and another planet is chosen', () => {
    const w = world();
    paint(w.executor, 40);
    show();
    fireEvent.click(screen.getByTestId('planet-tafa'));
    expect(verb().textContent).toBe('Next');
  });

  it('switches outright when the map has nothing to carry', async () => {
    world();
    const onSwitch = vi.fn();
    show({ onSwitch });
    fireEvent.click(screen.getByTestId('planet-tafa'));
    expect(verb().textContent).toBe(`Switch to ${TAFA.name.en}`);
    await press();
    expect(onSwitch).toHaveBeenCalledWith(TAFA.id, false);
  });

  it('passes a saved planet as its template', async () => {
    world();
    const bay = saved();
    const onSwitch = vi.fn();
    show({ onSwitch, initialChosen: bay.entryId });
    await press();
    expect(onSwitch).toHaveBeenCalledWith(bay.template, false);
  });

  it('on the current planet means starting over there, and needs a build to start over', async () => {
    const w = world();
    const onSwitch = vi.fn();
    const view = show({ onSwitch });
    expect(verb().textContent).toBe(`Start over on ${HEXIA.name.en}`);
    expect(verb().disabled).toBe(true);
    view.unmount();
    paint(w.executor, 40);
    show({ onSwitch });
    expect(verb().disabled).toBe(false);
    await press();
    expect(onSwitch).toHaveBeenCalledWith(HEXIA.id, false);
  });

  it('takes the build along by default from the next step', async () => {
    const w = world();
    paint(w.executor, 40);
    const onSwitch = vi.fn();
    show({ onSwitch });
    fireEvent.click(screen.getByTestId('planet-tafa'));
    fireEvent.click(verb());
    expect(onSwitch).not.toHaveBeenCalled();
    expect(verb().textContent).toBe(`Switch to ${TAFA.name.en}`);
    await press();
    expect(onSwitch).toHaveBeenCalledWith(TAFA.id, true);
  });

  it('counts a map whose only work is ground-level cuts as a build', async () => {
    const w = world();
    cutGround(w.state, 40, 60);
    const onSwitch = vi.fn();
    show({ onSwitch });
    fireEvent.click(screen.getByTestId('planet-tafa'));
    expect(verb().textContent).toBe('Next');
  });

  it('leaves the build behind when the visitor says so', async () => {
    const w = world();
    paint(w.executor, 40);
    const onSwitch = vi.fn();
    show({ onSwitch });
    fireEvent.click(screen.getByTestId('planet-tafa'));
    fireEvent.click(verb());
    fireEvent.click(screen.getByRole('radio', { name: 'Start fresh' }));
    await press();
    expect(onSwitch).toHaveBeenCalledWith(TAFA.id, false);
  });

  it('goes back to the list from the next step', () => {
    const w = world();
    paint(w.executor, 40);
    show();
    fireEvent.click(screen.getByTestId('planet-tafa'));
    fireEvent.click(verb());
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByTestId('planet-tafa').getAttribute('aria-pressed')).toBe('true');
  });

  it('acts once however many times it is pressed', async () => {
    world();
    const onSwitch = vi.fn();
    show({ onSwitch });
    fireEvent.click(screen.getByTestId('planet-tafa'));
    await act(async () => {
      fireEvent.click(verb());
      fireEvent.click(verb());
      fireEvent.click(verb());
      await afterPaint();
    });
    expect(onSwitch).toHaveBeenCalledTimes(1);
  });

  it('cannot be dismissed while the transfer is running', async () => {
    world();
    const onClose = vi.fn();
    const onSwitch = vi.fn();
    show({ onClose, onSwitch });
    fireEvent.click(screen.getByTestId('planet-tafa'));
    fireEvent.click(verb());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    await flush();
    expect(onSwitch).toHaveBeenCalledTimes(1);
  });

  it('and a transfer that throws says so and leaves the window usable', () => {
    vi.useFakeTimers();
    try {
      world();
      const onClose = vi.fn();
      show({ onClose, onSwitch: () => { throw new Error('replay failed'); } });
      fireEvent.click(screen.getByTestId('planet-tafa'));
      fireEvent.click(verb());
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
      act(() => { vi.runAllTimers(); });
      expect(logged).toHaveBeenCalledWith('[planet] switch failed', expect.objectContaining({ message: 'replay failed' }));
      expect(toasts).toContainEqual(['Change a planet: this planet could not be opened', 'error']);
      act(() => {});
      expect(verb().disabled).toBe(false);
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(onClose).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('and Cancel just closes', () => {
    world();
    const onClose = vi.fn();
    const onSwitch = vi.fn();
    show({ onClose, onSwitch });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(onSwitch).not.toHaveBeenCalled();
  });
});

describe('the carry step', () => {
  /** The carry step for `pick`, reached from a map with a build. */
  const toCarry = (pick = 'planet-tafa') => {
    fireEvent.click(screen.getByTestId(pick));
    fireEvent.click(verb());
  };
  const option = (name: string) => screen.getByRole('radio', { name });
  const carryOption = () => option('Bring your build along');
  const freshOption = () => option('Start fresh');
  const preview = (el: HTMLElement) => within(el).getByTestId('planet-preview');
  const ready = () => waitFor(() => expect(preview(carryOption()).getAttribute('aria-busy')).toBeNull());
  const drag = (stage: HTMLElement, dx: number, dy: number) => {
    fireEvent.pointerDown(stage, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(stage, { clientX: 10 + dx, clientY: 10 + dy, pointerId: 1 });
    fireEvent.pointerUp(stage, { clientX: 10 + dx, clientY: 10 + dy, pointerId: 1 });
    fireEvent.click(stage);
  };
  // jsdom has no PointerEvent, and a plain Event carries no coordinates.
  beforeEach(() => { vi.stubGlobal('PointerEvent', class extends MouseEvent { pointerId = 1; }); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('is titled by the destination and holds the two ways to arrive, the build first', async () => {
    const w = world();
    paint(w.executor, 40);
    show();
    toCarry();
    const group = screen.getByRole('radiogroup', { name: `Switch to ${TAFA.name.en}` });
    expect(within(group).getAllByRole('radio').map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false']);
    expect(carryOption().tabIndex).toBe(0);
    expect(freshOption().tabIndex).toBe(-1);
    await ready();
  });

  it('shows the loader on both pictures until the transfer is worked out, and asks once per destination', async () => {
    const w = world();
    paint(w.executor, 40);
    show();
    vi.mocked(requestTransferPreview).mockClear();
    toCarry();
    // The step paints first; the transfer is worked out after it.
    expect(preview(carryOption()).getAttribute('aria-busy')).toBe('true');
    // The shared fit needs the dropped cells, so the fresh picture waits too rather than rescale.
    expect(preview(freshOption()).getAttribute('aria-busy')).toBe('true');
    await ready();
    expect(preview(freshOption()).getAttribute('aria-busy')).toBeNull();
    expect(requestTransferPreview).toHaveBeenCalledTimes(1);
    // Panning, going back and coming again reuse it.
    drag(preview(carryOption()), 50, 30);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(verb());
    expect(preview(carryOption()).getAttribute('aria-busy')).toBeNull();
    await flush();
    expect(requestTransferPreview).toHaveBeenCalledTimes(1);
    // A changed map is a different question.
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    paint(w.executor, 42);
    fireEvent.click(verb());
    await ready();
    expect(requestTransferPreview).toHaveBeenCalledTimes(2);
  });

  it('chooses an option on a tap of its picture, and not on a drag', async () => {
    const w = world();
    paint(w.executor, 40);
    show();
    toCarry();
    drag(preview(freshOption()), 60, 20);
    expect(freshOption().getAttribute('aria-checked')).toBe('false');
    drag(preview(freshOption()), 2, 1);
    expect(freshOption().getAttribute('aria-checked')).toBe('true');
    expect(carryOption().getAttribute('aria-checked')).toBe('false');
    await ready();
  });

  it('moves the choice with the arrow keys and takes Space and Enter', async () => {
    const w = world();
    paint(w.executor, 40);
    show();
    toCarry();
    fireEvent.keyDown(carryOption(), { key: 'ArrowRight' });
    expect(freshOption().getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(freshOption());
    fireEvent.keyDown(freshOption(), { key: 'ArrowLeft' });
    expect(carryOption().getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(freshOption(), { key: ' ' });
    expect(freshOption().getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(carryOption(), { key: 'Enter' });
    expect(carryOption().getAttribute('aria-checked')).toBe('true');
    await ready();
  });

  it('switches with the build or without it as chosen', async () => {
    const w = world();
    paint(w.executor, 40);
    const onSwitch = vi.fn();
    show({ onSwitch });
    toCarry();
    await ready();
    await press();
    expect(onSwitch).toHaveBeenLastCalledWith(TAFA.id, true);
    fireEvent.click(freshOption());
    await press();
    expect(onSwitch).toHaveBeenLastCalledWith(TAFA.id, false);
  });

  it('keeps the keyboard in the window across the steps', async () => {
    const w = world();
    paint(w.executor, 40);
    show();
    fireEvent.click(screen.getByTestId('planet-tafa'));
    verb().focus();
    fireEvent.click(verb());
    expect(document.activeElement).toBe(carryOption());
    fireEvent.keyDown(carryOption(), { key: 'ArrowRight' });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(document.activeElement).toBe(screen.getByTestId('planet-tafa'));
    fireEvent.click(verb());
    // Coming again, the choice starts over on the build.
    expect(document.activeElement).toBe(carryOption());
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    await ready();
  });

  it('comes back to the list with the same planet chosen', async () => {
    const w = world();
    paint(w.executor, 40);
    const bay = saved();
    show();
    toCarry(`planet-${bay.entryId}`);
    expect(screen.getByRole('radiogroup', { name: 'Switch to Bay' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByTestId(`planet-${bay.entryId}`).getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => expect(previewName()).toBe('Bay'));
  });

  it('counts every cell marked as not fitting on the kept build', async () => {
    const w = world();
    for (let x = 20; x <= 110; x += 6) paint(w.executor, x);
    const bay = saved();
    show();
    toCarry(`planet-${bay.entryId}`);
    await ready();
    const lost = transferPreviewOf(currentEditor()!.state, bay.template).dropped.length;
    expect(lost).toBeGreaterThan(1);
    const badge = within(carryOption()).getByTestId('planet-dropped');
    expect(badge.textContent).toBe(`${lost} cells left behind`);
    expect(carryOption().getAttribute('aria-describedby')).toBe(badge.id);
    expect(within(freshOption()).queryByTestId('planet-dropped')).toBeNull();
  });

  it('shows no count when the whole build fits', async () => {
    const w = world();
    paint(w.executor, 40);
    show();
    toCarry();
    await ready();
    expect(transferPreviewOf(currentEditor()!.state, TAFA).dropped.length).toBe(0);
    expect(screen.queryByTestId('planet-dropped')).toBeNull();
  });

  it('crossfades its steps through the registry motion', async () => {
    const w = world();
    paint(w.executor, 40);
    show();
    vi.mocked(useTransition).mockClear();
    toCarry();
    const { calls, results } = vi.mocked(useTransition).mock;
    const at = calls.findIndex(([id]) => id === 'section.opacity');
    expect(at).toBeGreaterThanOrEqual(0);
    expect(results[at]!.value).toEqual(framerMotion('section.opacity'));
    expect(screen.getAllByTestId('planet-step').length).toBeGreaterThan(0);
    await ready();
  });
});

describe('Export first', () => {
  const offered = () => !!screen.queryByTestId('planet-export-first');

  it('stands while unexported edits would be discarded by starting over', () => {
    const w = world();
    paint(w.executor, 40);
    show();
    expect(offered()).toBe(true);
    fireEvent.click(screen.getByTestId('planet-tafa'));
    // Next discards nothing yet: the question comes with the next step.
    expect(offered()).toBe(false);
    fireEvent.click(verb());
    expect(offered()).toBe(true);
  });

  it('stays away once the edits are exported, and returns when the map moves on', () => {
    const w = world();
    paint(w.executor, 40);
    act(() => { useEditorStore.getState().markExported(); });
    const view = show();
    expect(offered()).toBe(false);
    view.unmount();
    paint(w.executor, 42);
    show();
    expect(offered()).toBe(true);
  });

  it('stays away on a map nobody has touched', () => {
    world();
    show();
    expect(offered()).toBe(false);
  });

  it('closes this window and opens the export', () => {
    const w = world();
    paint(w.executor, 40);
    const onClose = vi.fn();
    show({ onClose });
    fireEvent.click(screen.getByText('Export first'));
    expect(onClose).toHaveBeenCalled();
    expect(useEditorStore.getState().modals.share).toBe(true);
    expect(useEditorStore.getState().shareTarget).toBe('keep');
    act(() => { useEditorStore.getState().setModal('share', false); });
  });
});

describe('the card height cap', () => {
  it('bounds the card and scrolls its own content rather than clipping it', () => {
    world();
    show();
    const dialog = screen.getByRole('dialog');
    const cap = parseFloat(dialog.style.maxHeight);
    expect(dialog.style.maxHeight).toMatch(/px$/);
    expect(cap).toBeGreaterThan(0);
    expect(dialog.style.overflowY).toBe('auto');
  });
});
