// @vitest-environment jsdom
/** Saving from the screen: the frame step on the region bar, the save step's dock and the selection
 *  card's Save as blueprint. */
import { afterEach, expect, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import type { ReactNode } from 'react';
import { spec } from '../../_support/spec';
import { I18nProvider } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { regionOf, regionRequestOf } from '../../../state/editing/region';
import { watchRegionOverlay } from '../../../editor/editing/region-brush';
import { writePref } from '../../../platform/storage/prefs';
import { terrainCellsUnder } from '../../../core/grid/footprint';
import { isLandmarkItem } from '../../../core/model/landmarks';
import { objectRect } from '../../../state/object-geometry';
import { COMMAND_BY_ID, type CommandContext } from '../../../editor/commands/commands';
import { backOut, watchBackKey } from '../../../editor/back/back-out';
import {
  armBlueprint, beginBlueprintFrame, blueprintFolders, confirmBlueprintFrame, frameOfSelection, giveBlueprintExamples, leaveBlueprintFrame,
  leaveBlueprintSave, openBlueprintSave, placeArmedAt, regionFrame, saveBlueprint, saveFramedBlueprint, saveSelectionAsBlueprint, shownBlueprints,
  watchFramedThumbs, type FramedPictures,
} from '../../../editor/editing/blueprint';
import { installPictureRenderer, sampleNotes, type PictureCall } from '../../_support/picture-renderer';
import { shownMap } from '../../../state/map-stand-in';
import { getCell } from '../../../core/model/grid-model';
import { TerrainType, type GridState } from '../../../core/model/types';
import { cellsCaptureFrame, type MapFrame } from '../../../core/grid/map-chunks';
import type { Rect } from '../../../core/grid/rect';
import type { ScreenBox } from '../../../tools/pointer/runtime';
import { FrameStep } from '../../../ui/shell/bars/blueprint/FrameStep';
import { SaveDock } from '../../../ui/shell/bars/blueprint/SaveDock';
import { Shell } from '../../../ui/shell/Shell';
import { THUMB_ASPECT } from '../../../io/blueprint/facts';
import { SelectionCard } from '../../../ui/chrome/floating/SelectionCard';
import { InputModeProvider } from '../../../ui/design/input-mode';
import { blueprintEditor, open, roads, scene, type Scene } from './_blueprints';
import { captureBlueprint } from '../../../tools/blueprint';
import { setActiveView } from '../../../view/active-view';
import type { RegionGuides } from '../../../tools/pointer/runtime';
import { selectionTarget } from '../../../editor/editing/object-menu';
import { installSelectionViewSync } from '../../../view/shared/overlay/selection-view-sync';
import { PLACEMENT_GRID } from '../../../core/game/profile';
import type { PlanetSession } from '../../../state/slices/planet-session';
import { DEFAULT_REGION_REQUEST, type RegionRequest } from '../../../state/editing/vocabulary';

vi.mock('../../../pipelines/moderation/text/reviewer', async (original) => ({
  ...(await original<typeof import('../../../pipelines/moderation/text/reviewer')>()),
  reviewText: vi.fn(async () => ({ allowed: true })),
}));

const editor = blueprintEditor();
afterEach(cleanup);
afterEach(() => setActiveView(null));

const wrap = (node: ReactNode) => render(<MotionConfig reducedMotion="always"><I18nProvider>{node}</I18nProvider></MotionConfig>);
const store = () => useEditorStore.getState();
/** The frame the save step stands on, or null while none stands. */
const savingFrame = () => { const step = store().blueprintStep; return step.at === 'save' ? step.frame : null; };
const done = () => screen.getByRole('button', { name: 'Done' });
const limit = () => screen.queryByRole('status')?.textContent ?? '';
const key = (id: string) => COMMAND_BY_ID.get(id)!.run({ toggleMenu: () => {} } as unknown as CommandContext);

spec('BLUE-04', 'a frame holding more than 32 cells, as a selection\'s may, or a landmark is refused with the reason', () => {
  const guides: (RegionGuides | undefined)[] = [];
  const overlay = { showBuildableRegion: (_: unknown, g?: RegionGuides) => { guides.push(g); }, clearBuildableRegion: () => {} };
  setActiveView({ overlay, camera: {} } as never);
  const guide = () => { const e = guides.at(-1)?.edges; return e && { w: e.right - e.left, h: e.bottom - e.top }; };
  const sc = scene();
  open(sc.w);
  const stopOverlay = watchRegionOverlay();
  useEditorStore.setState({ locale: 'en' });
  const generateScope = [{ x: 1, y: 1 }];
  store().setRegion(generateScope, 'generator');
  act(() => { beginBlueprintFrame(); });
  expect(store()).toMatchObject({ selectingRegion: true, regionSelectionOwner: 'blueprint' });
  expect(regionOf(store(), 'blueprint')).toEqual([]);
  expect(regionRequestOf(store()).tools).toEqual(['rect']);
  wrap(<FrameStep />);
  expect(done().getAttribute('aria-disabled')).toBe('true');

  // The guides count the cells the frame captures, the unit of the limit.
  act(() => { store().setRegion(terrainCellsUnder({ ...sc.frame, w: 32 }), 'blueprint'); });
  expect(guide()).toEqual({ w: 32, h: sc.frame.h });
  expect(limit()).toBe('');
  expect(done().getAttribute('aria-disabled')).not.toBe('true');
  act(() => { store().setRegion(terrainCellsUnder({ ...sc.frame, w: 33 }), 'blueprint'); });
  expect(guide()).toEqual({ w: 33, h: sc.frame.h });
  expect(limit()).toMatch(/32/);
  expect(done().getAttribute('aria-disabled')).toBe('true');

  const landmark = [...sc.w.state.objects.values()].find((o) => isLandmarkItem(o.catalogId))!;
  const r = objectRect(landmark);
  act(() => { store().setRegion(terrainCellsUnder({ x: r.x - 2, y: r.y - 2, w: 4, h: 4 }), 'blueprint'); });
  expect(limit()).toMatch(/fixed building/i);
  expect(done().getAttribute('aria-disabled')).toBe('true');

  act(() => { store().setRegion(terrainCellsUnder(sc.frame), 'blueprint'); });
  expect(regionFrame(regionOf(store(), 'blueprint'))).toEqual(sc.frame);
  expect(limit()).toBe('');
  act(() => { fireEvent.click(done()); });
  // Done opens the save step's dock on the frame, no window, and gives the region back as it was.
  expect(savingFrame()).toEqual(sc.frame);
  expect('blueprintSave' in store().modals).toBe(false);
  cleanup();
  wrap(<SaveDock />);
  expect(screen.getByRole('region', { name: 'Save blueprint' })).toBeTruthy();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(store().selectingRegion).toBe(false);
  expect(regionOf(store(), 'generator')).toEqual(generateScope);
  stopOverlay();
  setActiveView(null);
});

spec('BLUE-04', 'the frame step\'s rectangle stops growing at 32 by 32 cells, where Generate\'s goes on', () => {
  const sc = scene();
  open(sc.w);
  act(() => { beginBlueprintFrame(); });
  const { width, height } = sc.w.state.template;
  const from = { x: Math.round(width / 2) - 20, y: Math.round(height / 2) - 20 };
  /** The frame a rectangle dragged 45 cells each way draws under `request`. */
  const dragged = (request: RegionRequest) => {
    sc.w.sandbox.selectRegion({ tool: 'rect', request, show: () => {} });
    sc.w.sandbox.pointerDown(from);
    sc.w.sandbox.pointerMove({ x: from.x + 45, y: from.y + 45 });
    sc.w.sandbox.pointerUp();
    const frame = regionFrame(sc.w.sandbox.region);
    sc.w.sandbox.endRegionSelection();
    return frame && { w: frame.w, h: frame.h };
  };
  expect(dragged(regionRequestOf(store()))).toEqual({ w: 32, h: 32 });
  expect(dragged(DEFAULT_REGION_REQUEST)!.w).toBeGreaterThan(32);
});

spec('BLUE-04', 'Escape or Cancel leaves the frame step for the strip', () => {
  const sc = scene();
  open(sc.w);
  useEditorStore.setState({ locale: 'en' });
  act(() => { beginBlueprintFrame(sc.frame); });
  expect(regionFrame(regionOf(store(), 'blueprint'))).toEqual(sc.frame);
  act(() => { expect(backOut()).toBe(true); });
  expect(store()).toMatchObject({ selectingRegion: false, editMode: { mode: 'blueprint' } });
  expect(regionOf(store(), 'blueprint')).toEqual([]);
  expect(regionRequestOf(store()).tools).not.toEqual(['rect']);

  act(() => { beginBlueprintFrame(sc.frame); });
  wrap(<FrameStep />);
  act(() => { fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); });
  expect(store().selectingRegion).toBe(false);
  expect(regionOf(store(), 'blueprint')).toEqual([]);
  expect(savingFrame()).toBeNull();
});

spec('BLUE-05', 'Cancel or Escape on the save step goes back to the frame step on the same frame', () => {
  const sc = scene();
  open(sc.w);
  useEditorStore.setState({ locale: 'en' });
  act(() => { openBlueprintSave(sc.frame); });
  wrap(<SaveDock />);
  act(() => { fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); });
  expect(savingFrame()).toBeNull();
  expect(store()).toMatchObject({ selectingRegion: true, regionSelectionOwner: 'blueprint' });
  expect(regionFrame(regionOf(store(), 'blueprint'))).toEqual(sc.frame);
  act(() => { backOut(); });
  act(() => { openBlueprintSave(sc.frame); });
  act(() => { expect(backOut()).toBe(true); });
  expect(savingFrame()).toBeNull();
  expect(regionFrame(regionOf(store(), 'blueprint'))).toEqual(sc.frame);
  // Leaving Blueprint mode ends the step without a frame step.
  act(() => { backOut(); });
  act(() => { openBlueprintSave(sc.frame); });
  act(() => { store().setEditMode({ mode: 'object' }); });
  expect(savingFrame()).toBeNull();
});

spec('BLUE-04', 'the frame step\'s Cancel and the save step\'s are Escape, backing out of the newest state', () => {
  const sc = scene();
  open(sc.w);
  useEditorStore.setState({ locale: 'en' });
  const sel = roads(sc.w).map((o) => ({ kind: 'object', id: o.id }) as const);
  const left = () => {
    const st = store();
    return { at: st.blueprintStep.at, assistant: st.assistantOpen, painting: st.selectingRegion, owner: st.regionSelectionOwner,
      frame: regionFrame(regionOf(st, 'blueprint')), selection: st.selection, standIn: st.mapStandIn !== null };
  };
  const stop = watchBackKey();
  const ends: Record<string, unknown> = {};
  try {
    for (const step of ['frame', 'save', 'frame under the assistant'] as const) {
      for (const how of ['Cancel', 'Escape'] as const) {
        act(() => { store().setSelection([...sel]); beginBlueprintFrame(sc.frame); });
        if (step === 'save') act(() => { confirmBlueprintFrame(); });
        // A state entered after the step is what both back out of first.
        if (step === 'frame under the assistant') act(() => { store().setAssistantOpen(true); });
        const ui = wrap(step === 'save' ? <SaveDock /> : <FrameStep />);
        if (how === 'Cancel') act(() => { fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); });
        else act(() => { fireEvent.keyDown(document.body, { key: 'Escape' }); });
        ends[`${step} ${how}`] = left();
        ui.unmount();
        act(() => { for (let n = 0; n < 4 && backOut(); n++); });
      }
      expect(ends[`${step} Cancel`], step).toEqual(ends[`${step} Escape`]);
    }
    expect(ends['frame Escape']).toMatchObject({ at: 'strip', selection: sel });
    expect(ends['save Escape']).toMatchObject({ at: 'frame', frame: sc.frame });
    expect(ends['frame under the assistant Escape']).toMatchObject({ at: 'frame', assistant: false });
  } finally { stop(); }
});

spec('BLUE-05', 'Escape typed in the name or the author field goes back to the frame step on the same frame', () => {
  const sc = scene();
  open(sc.w);
  useEditorStore.setState({ locale: 'en' });
  const stop = watchBackKey();
  try {
    for (const field of ['Name', 'Author']) {
      act(() => { openBlueprintSave(sc.frame); });
      const ui = wrap(<SaveDock />);
      const box = within(screen.getByRole('region', { name: 'Save blueprint' })).getByRole('textbox', { name: field });
      fireEvent.change(box, { target: { value: 'Terrace' } });
      act(() => { fireEvent.keyDown(box, { key: 'Escape' }); });
      expect(savingFrame(), field).toBeNull();
      expect(regionFrame(regionOf(store(), 'blueprint')), field).toEqual(sc.frame);
      ui.unmount();
      act(() => { backOut(); });
    }
  } finally { stop(); }
});

spec('BLUE-04', 'New blueprint clears the selection, so the keys no longer act on what was selected', () => {
  const sc = scene();
  open(sc.w);
  const before = sc.w.fingerprint();
  store().setSelection(roads(sc.w).map((o) => ({ kind: 'object', id: o.id }) as const));
  act(() => { beginBlueprintFrame(); });
  expect(store()).toMatchObject({ selectingRegion: true, regionSelectionOwner: 'blueprint', selection: [] });
  key('selection.rotate_cw');
  key('selection.delete');
  expect(store().deletePopover).toBeNull();
  expect(sc.w.fingerprint()).toBe(before);
});

spec('BLUE-04', 'Cancel or Escape gives back the selection the frame step put down, after the save step too, and saving or leaving the mode does not', async () => {
  const sc = scene();
  open(sc.w);
  const sel = roads(sc.w).map((o) => ({ kind: 'object', id: o.id }) as const);
  store().setSelection([...sel]);
  act(() => { beginBlueprintFrame(); });
  act(() => { expect(backOut()).toBe(true); });
  expect(store().selection, 'Escape').toEqual(sel);

  act(() => { beginBlueprintFrame(sc.frame); });
  act(() => { confirmBlueprintFrame(); });
  act(() => { leaveBlueprintSave(); });
  expect(store().selection, 'back on the frame step').toEqual([]);
  act(() => { leaveBlueprintFrame(); });
  expect(store().selection, 'Cancel after the save step').toEqual(sel);

  act(() => { saveSelectionAsBlueprint(); });
  expect(store().selection).toEqual([]);
  act(() => { leaveBlueprintFrame(); });
  expect(store().selection, 'Save as blueprint, then Cancel').toEqual(sel);

  act(() => { beginBlueprintFrame(); });
  act(() => { store().setEditMode({ mode: 'object' }); });
  expect(store().selection, 'leaving the mode').toEqual([]);

  store().setEditMode({ mode: 'blueprint' });
  store().setSelection([...sel]);
  act(() => { beginBlueprintFrame(sc.frame); });
  act(() => { confirmBlueprintFrame(); });
  expect(await saveFramedBlueprint({ frame: sc.frame, name: 'Terrace', author: 'Mei', folder: null })).toBe(true);
  expect(store().selection, 'saving').toEqual([]);
});

spec('BLUE-04', 'the selection card offers Save as blueprint and frames the selection', () => {
  const sc = scene();
  open(sc.w);
  useEditorStore.setState({ locale: 'en' });
  store().setEditMode({ mode: null });
  store().setSelection(roads(sc.w).map((o) => ({ kind: 'object', id: o.id }) as const));
  const frame = frameOfSelection();
  expect(frame).not.toBeNull();
  wrap(<SelectionCard />);
  // The card stands hidden until a view places it, so it is reached by its name rather than its role.
  act(() => { fireEvent.click(screen.getByLabelText('Save as blueprint')); });
  expect(store()).toMatchObject({ editMode: { mode: 'blueprint' }, selectingRegion: true, regionSelectionOwner: 'blueprint', selection: [] });
  expect(regionFrame(regionOf(store(), 'blueprint'))).toEqual(frame);
});

spec('BLUE-04', 'Save as blueprint is offered only where it can frame an object', () => {
  const sc = scene();
  open(sc.w);
  const gs = sc.w.state;
  const landmark = [...gs.objects.values()].find((o) => isLandmarkItem(o.catalogId))!;
  const road = roads(sc.w)[0]!;
  const objects = (...ids: string[]) => ids.map((id) => ({ kind: 'object', id }) as const);
  expect(selectionTarget(objects(road.id), gs, false)?.blueprintable).toBe(true);
  // A landmark alone, or with only bare terrain beside it, gives a frame nothing to keep.
  expect(selectionTarget(objects(landmark.id), gs, false)?.blueprintable ?? false).toBe(false);
  const cell = sc.frame;
  const terrain = [{ kind: 'terrain', x: cell.x + 1, y: cell.y + 1 }, { kind: 'terrain', x: cell.x + 2, y: cell.y + 1 }] as const;
  expect(selectionTarget([...terrain], gs, false)?.blueprintable ?? false).toBe(false);
  expect(selectionTarget([...objects(landmark.id), ...terrain], gs, false)?.blueprintable ?? false).toBe(false);
  // Inside a planet session Blueprint mode does not open.
  expect(selectionTarget(objects(road.id), gs, true, { planet: {} as PlanetSession, repairing: false })?.blueprintable ?? false).toBe(false);
});

/** Stands the save step's viewfinder at `box` on the screen, which jsdom cannot lay out. */
function standViewfinder(box: ScreenBox): void {
  const original = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.dataset.testid !== 'blueprint-viewfinder') return original.call(this);
    const { left, top, width, height } = box;
    return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}) } as DOMRect;
  });
}

const expectBox = (got: MapFrame, want: MapFrame) => { for (const k of ['x', 'y', 'width', 'height'] as const) expect(got[k]).toBeCloseTo(want[k]); };

const saveButton = (dock: HTMLElement) => within(dock).getByRole('button', { name: 'Save blueprint' });
const saveReady = (button: HTMLElement) => !button.hasAttribute('disabled') && button.getAttribute('aria-disabled') !== 'true';

spec('BLUE-05', 'the dock shows name and author in one field style and the folder in the dropdown beside the 2D and 3D pictures', async () => {
  const sc = scene();
  open(sc.w);
  useEditorStore.setState({ locale: 'en', viewMode: '2d' });
  writePref('blueprintAuthor', 'Mei');
  act(() => { openBlueprintSave(sc.frame); });
  wrap(<SaveDock />);
  const dock = screen.getByRole('region', { name: 'Save blueprint' });
  const fields = [
    within(dock).getByRole('textbox', { name: 'Name' }),
    within(dock).getByRole('textbox', { name: 'Author' }),
  ];
  // A field's box is the control, or the box it stands in where a control shares the field.
  const boxOf = (el: HTMLElement) => (el.style.border ? el : el.parentElement!);
  const look = (el: HTMLElement) => { const b = boxOf(el).style; return [b.height, b.borderRadius, b.border, b.fontSize, b.background]; };
  expect(look(fields[0]!)[0]).not.toBe('');
  expect(look(fields[1]!)).toEqual(look(fields[0]!));
  expect(within(dock).getByRole('button', { name: 'Folder' }).getAttribute('aria-haspopup')).toBe('menu');
  const author = fields[1] as HTMLInputElement;
  expect(author.value).toBe('Mei');
  // The anonymous switch stands inside the author field: on, it is checked and the field greys the
  // author typed, which it keeps, and takes no typing; the word Anonymous is the switch's alone.
  const anonymous = within(boxOf(author)).getByRole('switch', { name: 'Anonymous' });
  expect(anonymous.getAttribute('aria-checked')).toBe('false');
  fireEvent.click(anonymous);
  expect(anonymous.getAttribute('aria-checked')).toBe('true');
  expect(author.value).toBe('Mei');
  expect(author.disabled).toBe(true);
  expect(within(dock).queryByDisplayValue('Anonymous')).toBeNull();
  expect(within(dock).getAllByText('Anonymous')).toHaveLength(1);
  fireEvent.click(anonymous);
  expect(author.value).toBe('Mei');
  expect(author.disabled).toBe(false);
  // The two pictures, the shown view's chosen.
  expect(within(dock).getByRole('button', { name: '2D' }).getAttribute('aria-pressed')).toBe('true');
  expect(within(dock).getByRole('button', { name: '3D' }).getAttribute('aria-pressed')).toBe('false');
});

spec('BLUE-05', 'pressing the other picture switches the map\'s view', () => {
  const sc = scene();
  open(sc.w);
  useEditorStore.setState({ locale: 'en', viewMode: '3d' });
  act(() => { openBlueprintSave(sc.frame); });
  wrap(<SaveDock />);
  const dock = screen.getByRole('region', { name: 'Save blueprint' });
  act(() => { fireEvent.click(within(dock).getByRole('button', { name: '3D' })); });
  expect(store().viewMode).toBe('3d');
  act(() => { fireEvent.click(within(dock).getByRole('button', { name: '2D' })); });
  expect(store().viewMode).toBe('2d');
  expect(within(dock).getByRole('button', { name: '2D' }).getAttribute('aria-pressed')).toBe('true');
  expect(savingFrame()).toEqual(sc.frame);
});

spec('BLUE-05', 'the dock saves into the chosen folder through the live framing and arms the new blueprint', async () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AAAA');
  const picture = installPictureRenderer();
  // A flat 2D view: ten screen px to a cell.
  setActiveView({ projection: {
    screenToPoint: (x: number, y: number) => ({ x: x / 10, y: y / 10 }),
    cellToScreen: (x: number, y: number) => ({ x: x * 10, y: y * 10, scale: 10 }),
  }, camera: {} } as never);
  const finder = { left: 100, top: 50, width: 20 * THUMB_ASPECT * 10, height: 200 };
  standViewfinder(finder);
  try {
    const sc = scene();
    open(sc.w);
    useEditorStore.setState({ locale: 'en', viewMode: '2d' });
    writePref('blueprintAuthor', 'Mei');
    editor.lib().addFolder('Gardens');
    act(() => { openBlueprintSave(sc.frame); });
    wrap(<SaveDock />);
    const dock = screen.getByRole('region', { name: 'Save blueprint' });
    // The live picture lands on its card.
    const pictured = (card: HTMLElement) => [...card.querySelectorAll('img')].some((img) => img.getAttribute('src')?.startsWith('data:'));
    await waitFor(() => expect(pictured(within(dock).getByRole('button', { name: '2D' }))).toBe(true));
    fireEvent.change(within(dock).getByRole('textbox', { name: 'Name' }), { target: { value: 'Terrace' } });
    fireEvent.click(within(dock).getByRole('button', { name: 'Folder' }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Gardens' }));
    await waitFor(() => expect(saveReady(saveButton(dock))).toBe(true));
    picture.calls.length = 0;
    fireEvent.click(saveButton(dock));
    await waitFor(() => expect(editor.lib().records()).toHaveLength(1));
    expect(editor.lib().records()[0]).toMatchObject({ name: 'Terrace', author: 'Mei', folder: 'Gardens', origin: null });
    // The stored flat picture shows what the viewfinder showed.
    const crop = cellsCaptureFrame(picture.calls[0]!.options.frame!);
    expect(crop.x).toBeCloseTo(finder.left / 10);
    expect(crop.y).toBeCloseTo(finder.top / 10);
    expect(crop.width).toBeCloseTo(finder.width / 10);
    expect(crop.height).toBeCloseTo(finder.height / 10);
    // The step ends and the new card stands armed in its folder's tab.
    await waitFor(() => expect(savingFrame()).toBeNull());
    expect(store().blueprint).toMatchObject({ armed: editor.lib().records()[0]!.id, folder: 'Gardens' });
  } finally { picture.uninstall(); setActiveView(null); vi.restoreAllMocks(); }
});

spec('BLUE-05', 'the dock files under My Blueprints unless one of the player\'s own folders is open', async () => {
  writePref('blueprintExamplesGiven', false);
  await giveBlueprintExamples(editor.lib());
  editor.lib().addFolder('Gardens');
  const sc = scene();
  open(sc.w);
  useEditorStore.setState({ locale: 'en' });
  const [mine, examples] = blueprintFolders();
  const offered: string[] = [];
  for (const folder of [null, examples!, mine!, 'Gardens']) {
    act(() => { store().setBlueprintUi({ folder }); });
    act(() => { openBlueprintSave(sc.frame); });
    wrap(<SaveDock />);
    const dock = screen.getByRole('region', { name: 'Save blueprint' });
    offered.push(within(dock).getByRole('button', { name: 'Folder' }).textContent ?? '');
    act(() => { leaveBlueprintSave(); });
    cleanup();
  }
  expect(offered).toEqual(['My Blueprints', 'My Blueprints', 'My Blueprints', 'Gardens']);
});

spec('BLUE-05', 'a save the browser refuses says so and keeps the dock open', async () => {
  const sc = scene();
  open(sc.w);
  useEditorStore.setState({ locale: 'en' });
  vi.spyOn(editor.lib(), 'save').mockRejectedValue(new Error('quota'));
  try {
    act(() => { openBlueprintSave(sc.frame); });
    wrap(<SaveDock />);
    const dock = screen.getByRole('region', { name: 'Save blueprint' });
    // No author used before: the save is anonymous.
    expect(within(dock).getByRole('switch', { name: 'Anonymous' }).getAttribute('aria-checked')).toBe('true');
    await waitFor(() => expect(saveReady(saveButton(dock))).toBe(true));
    fireEvent.click(saveButton(dock));
    await waitFor(() => expect(editor.toasts()).toContain('Blueprints: this browser could not save the change'));
    expect(savingFrame()).toEqual(sc.frame);
    expect(screen.getByRole('region', { name: 'Save blueprint' })).toBeTruthy();
    await waitFor(() => expect(saveReady(saveButton(dock))).toBe(true));
  } finally { vi.restoreAllMocks(); }
});

spec('BLUE-05', 'a blueprint saved with no name takes a numbered default no other blueprint shows', async () => {
  const sc = scene();
  open(sc.w);
  useEditorStore.setState({ locale: 'en' });
  const out = captureBlueprint(sc.w.state, sc.frame);
  if ('refusal' in out) throw new Error(out.refusal);
  // A file from a device whose clock ran ahead: its name waits for review under a numbered default.
  await editor.lib().importRecords([{
    id: 'ahead', name: 'Terrace', folder: null, author: null, origin: null, savedAt: Date.now() + 1e9, appVersion: 'x', body: out.body, thumbs: { flat: '', lifted: '' },
  }], null);
  act(() => { openBlueprintSave(sc.frame); });
  wrap(<SaveDock />);
  const dock = screen.getByRole('region', { name: 'Save blueprint' });
  await waitFor(() => expect(saveReady(saveButton(dock))).toBe(true));
  fireEvent.click(saveButton(dock));
  await waitFor(() => expect(editor.lib().records()).toHaveLength(2));
  const names = shownBlueprints().map((r) => r.name);
  expect(new Set(names).size, names.join(', ')).toBe(2);
});

spec('BLUE-12', '改编自 shows read-only when the frame holds another author\'s placement', async () => {
  const sc = scene();
  open(sc.w);
  useEditorStore.setState({ locale: 'en' });
  const anns = await saveBlueprint({ frame: sc.frame, name: 'Terrace', author: 'Ann', folder: null });
  if (typeof anns === 'string') throw new Error(anns);
  writePref('blueprintAuthor', 'Mei');
  armBlueprint(anns.id);
  placeArmedAt(sc.free);
  act(() => { openBlueprintSave({ x: sc.free.x - 1, y: sc.free.y, w: 6, h: 6 }); });
  wrap(<SaveDock />);
  const dialog = screen.getByRole('region', { name: 'Save blueprint' });
  const row = within(dialog).getByText('Adapted from').parentElement!;
  expect(row.textContent).toContain('Ann');
  expect(within(row).queryByRole('textbox')).toBeNull();
});

spec('BLUE-12', '改编自 leaves the save step while the author typed is the original author', async () => {
  const sc = scene();
  open(sc.w);
  useEditorStore.setState({ locale: 'en' });
  const anns = await saveBlueprint({ frame: sc.frame, name: 'Terrace', author: 'Ann', folder: null });
  if (typeof anns === 'string') throw new Error(anns);
  writePref('blueprintAuthor', 'Mei');
  armBlueprint(anns.id);
  placeArmedAt(sc.free);
  act(() => { openBlueprintSave({ x: sc.free.x - 1, y: sc.free.y, w: 6, h: 6 }); });
  wrap(<SaveDock />);
  const dialog = screen.getByRole('region', { name: 'Save blueprint' });
  expect(within(dialog).queryByText('Adapted from')).not.toBeNull();
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Author' }), { target: { value: ' Ann ' } });
  expect(within(dialog).queryByText('Adapted from')).toBeNull();
  fireEvent.click(within(dialog).getByRole('switch', { name: 'Anonymous' }));
  expect(within(dialog).queryByText('Adapted from')).not.toBeNull();
});

spec('BLUE-06', 'a placement just laid is selected under its blueprint\'s name, outlined as one footprint', async () => {
  const shown: { rect: unknown; grid: unknown }[] = [];
  const overlay = {
    showSelection: (rect: unknown, grid: unknown) => { shown.push({ rect, grid }); },
    clearSelection: () => { shown.length = 0; },
    showObjectSelection: () => { shown.push({ rect: 'object', grid: null }); },
  };
  setActiveView({ overlay } as never);
  const stop = installSelectionViewSync();
  try {
    const sc = scene();
    open(sc.w);
    useEditorStore.setState({ locale: 'en' });
    const record = await saveBlueprint({ frame: sc.frame, name: 'Terrace', author: 'Mei', folder: null });
    if (typeof record === 'string') throw new Error(record);
    armBlueprint(record.id);
    placeArmedAt(sc.free);
    expect(shown).toEqual([{ rect: { x: sc.free.x, y: sc.free.y, w: 4, h: 5 }, grid: PLACEMENT_GRID }]);
    wrap(<SelectionCard />);
    expect(screen.getByText('Terrace')).toBeTruthy();
    expect(screen.queryByText(/^\d+ objects$/)).toBeNull();
  } finally { stop(); }
});

spec('BLUE-05', 'the save step\'s live pictures follow the view through the crop, and the save takes the crop last shown', async () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AAAA');
  const picture = installPictureRenderer();
  // A flat 2D view: ten screen px to a cell, panned by `pan` cells.
  let pan = 0;
  setActiveView({ projection: { screenToPoint: (x: number, y: number) => ({ x: x / 10 + pan, y: y / 10 }) } } as never);
  try {
    const sc = scene();
    open(sc.w);
    useEditorStore.setState({ viewMode: '2d' });
    const heard: FramedPictures[] = [];
    const crop = { left: 100, top: 100, width: 341, height: 200 };
    const stop = watchFramedThumbs(sc.frame, () => crop, (p) => { heard.push(p); }, 0);
    try {
      await waitFor(() => expect(heard.at(-1)?.flat).toBeTruthy());
      expect(heard.at(-1)!.view).toBe('2d');
      expect(heard.at(-1)!.framing.flat!.x).toBeCloseTo(10);
      // A pan of the map draws the flat picture again through the box.
      pan = 5;
      act(() => { store().eventBus.emit('viewport-changed', {} as never); });
      await waitFor(() => expect(heard.at(-1)!.framing.flat!.x).toBeCloseTo(15));
      const shows = (call: PictureCall) => cellsCaptureFrame(call.options.frame!);
      expectBox(shows(picture.calls.at(-1)!), heard.at(-1)!.framing.flat!);
      // The save draws its pictures through the crop last shown.
      picture.calls.length = 0;
      const saved = await saveBlueprint({ frame: sc.frame, name: 'Terrace', author: null, folder: null, framing: heard.at(-1)!.framing });
      expect(typeof saved).not.toBe('string');
      expectBox(shows(picture.calls[0]!), heard.at(-1)!.framing.flat!);
    } finally { stop(); }
  } finally { picture.uninstall(); setActiveView(null); vi.restoreAllMocks(); }
});

/** The stacking rung an element stands at: its own z-index or its nearest positioned ancestor's. */
const rungOf = (el: Element | null): number => {
  for (let at = el as HTMLElement | null; at; at = at.parentElement) if (at.style?.zIndex) return Number(at.style.zIndex);
  return 0;
};

spec('BLUE-05', 'the map around the viewfinder dims under the interface, which stays undimmed', () => {
  const sc = scene();
  open(sc.w);
  useEditorStore.setState({ locale: 'en', viewMode: '2d' });
  act(() => { openBlueprintSave(sc.frame); });
  wrap(<Shell><div data-testid="map-views" /></Shell>);
  const finder = screen.getByTestId('blueprint-viewfinder');
  // Everything around the viewfinder is shaded, the viewfinder itself clear.
  expect(finder.style.boxShadow).toMatch(/0 0 0 \d{4,}px/);
  expect(finder.style.background).toBe('');
  // The shade stands on the map, under the dock, the mode row and the rail, none of which it holds.
  const dock = screen.getByRole('region', { name: 'Save blueprint' });
  const chrome = [dock, screen.getByRole('group', { name: 'Modes' }), screen.getByRole('button', { name: /^Undo/ })];
  for (const part of chrome) {
    expect(part.contains(finder) || finder.contains(part)).toBe(false);
    expect(rungOf(part)).toBeGreaterThan(rungOf(finder));
  }
});

spec('BLUE-05', 'while the save step stands the interface cannot be hidden, its button shown unavailable until the step ends', () => {
  const sc = scene();
  open(sc.w);
  useEditorStore.setState({ locale: 'en', viewMode: '2d' });
  act(() => { openBlueprintSave(sc.frame); });
  wrap(<Shell><div data-testid="map-views" /></Shell>);
  const hide = () => screen.getByRole('button', { name: 'Hide interface' });
  const veiled = () => screen.getByTestId('shell-frame-veil').style.visibility === 'hidden';
  expect(hide().getAttribute('aria-disabled')).toBe('true');
  act(() => { fireEvent.click(hide()); });
  expect(veiled()).toBe(false);
  expect(screen.getByRole('region', { name: 'Save blueprint' })).toBeTruthy();
  // Back on the frame step the button hides the interface again.
  act(() => { leaveBlueprintSave(); });
  expect(hide().getAttribute('aria-disabled')).toBeNull();
  act(() => { fireEvent.click(hide()); });
  expect(veiled()).toBe(true);
});

spec('BLUE-05', 'entering the save step brings the frame into the viewfinder above the dock, in each view once', () => {
  const sc = scene();
  open(sc.w);
  useEditorStore.setState({ locale: 'en', viewMode: '2d' });
  const fits: { view: string; box: Rect; into: ScreenBox }[] = [];
  const viewNamed = (name: string) => ({
    projection: { screenToPoint: () => ({ x: 0, y: 0 }) },
    camera: { fitBox: (box: Rect, into: ScreenBox) => { fits.push({ view: name, box, into }); } },
  });
  const flat = viewNamed('2d'), lifted = viewNamed('3d');
  setActiveView(flat as never);
  const finder = { left: 120, top: 80, width: 341, height: 200 };
  standViewfinder(finder);
  try {
    act(() => { openBlueprintSave(sc.frame); });
    wrap(<SaveDock />);
    expect(fits).toEqual([{ view: '2d', box: sc.frame, into: finder }]);
    // The other view is brought there the first time it is shown, and neither again after.
    act(() => { store().setViewMode('3d'); setActiveView(lifted as never); });
    act(() => { store().setViewMode('2d'); setActiveView(flat as never); });
    act(() => { store().setViewMode('3d'); setActiveView(lifted as never); });
    expect(fits.map((f) => f.view)).toEqual(['2d', '3d']);
  } finally { vi.restoreAllMocks(); }
});

spec('BLUE-05', 'turning the screen during the save step brings the frame into the new viewfinder again', () => {
  const sc = scene();
  open(sc.w);
  useEditorStore.setState({ locale: 'en', viewMode: '2d' });
  const fits: Rect[] = [];
  setActiveView({ projection: { screenToPoint: () => ({ x: 0, y: 0 }) }, camera: { fitBox: (box: Rect) => { fits.push(box); } } } as never);
  standViewfinder({ left: 120, top: 80, width: 341, height: 200 });
  try {
    act(() => { openBlueprintSave(sc.frame); });
    const dock = (shape: 'landscape' | 'portrait') => (
      <MotionConfig reducedMotion="always"><I18nProvider><InputModeProvider inputMode="touch" shape={shape}><SaveDock /></InputModeProvider></I18nProvider></MotionConfig>
    );
    const { rerender } = render(dock('landscape'));
    expect(fits).toHaveLength(1);
    rerender(dock('portrait'));
    expect(fits).toEqual([sc.frame, sc.frame]);
  } finally { vi.restoreAllMocks(); }
});

spec('BLUE-05', 'the viewfinder stays put as the map moves under it, so a pan in 2D changes the 2D picture', async () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AAAA');
  const picture = installPictureRenderer();
  // A flat 2D view: ten screen px to a cell, panned by `pan` cells.
  let pan = 0;
  setActiveView({ projection: {
    screenToPoint: (x: number, y: number) => ({ x: x / 10 + pan, y: y / 10 }),
  }, camera: {} } as never);
  const finder = { left: 100, top: 50, width: 20 * THUMB_ASPECT * 10, height: 200 };
  standViewfinder(finder);
  try {
    const sc = scene();
    open(sc.w);
    useEditorStore.setState({ locale: 'en', viewMode: '2d' });
    act(() => { openBlueprintSave(sc.frame); });
    wrap(<SaveDock />);
    const shown = () => cellsCaptureFrame(picture.calls.at(-1)!.options.frame!);
    await waitFor(() => expect(picture.calls.length).toBeGreaterThan(0));
    expectBox(shown(), { x: 10, y: 5, width: finder.width / 10, height: 20 });
    pan = 5;
    act(() => { store().eventBus.emit('viewport-changed', {} as never); });
    await waitFor(() => expect(shown().x).toBeCloseTo(15));
  } finally { picture.uninstall(); setActiveView(null); vi.restoreAllMocks(); }
});

/** Each object of `state` as its kind and where it stands. */
const standing = (state: GridState): string[] =>
  [...state.objects.values()].map((o) => `${o.catalogId}@${o.position.x},${o.position.y}:${o.elevation ?? 0}`).sort();

/** Each raised or flooded terrain cell of `state` with its height, those `keep` passes only. */
const raised = (state: GridState, keep: (x: number, y: number) => boolean = () => true): string[] => {
  const out: string[] = [];
  for (let y = 0; y < state.template.height; y++) for (let x = 0; x < state.template.width; x++) {
    const t = getCell(state.cells, x, y)?.terrain;
    if (t && t.type !== TerrainType.None && keep(x, y)) out.push(`${x},${y}:${t.type}:${t.elevation}`);
  }
  return out;
};

/** The scene with neighbours around its frame: a tree beside it, a house across its right edge and
 *  notes on the map, and a hill outside it. */
function crowded(): Scene {
  const sc = scene();
  const { x, y, w } = sc.frame;
  for (const [item, at] of [['tree-apple', { x: x + w + 6, y: y + 1 }], ['building-bamboo-cabin', { x: x + w - 1, y: y - 1 }]] as const) {
    const out = sc.w.place(item, at.x, at.y);
    if (!out.ok) throw new Error(`${item} refused: ${out.refusedBy.join(', ')}`);
  }
  sc.w.stroke([{ x: x + w + 6, y: y + 6 }], TerrainType.Mountain, 1);
  sc.w.state.annotations = sampleNotes();
  return sc;
}

spec('BLUE-05', 'while the save step stands the map shows only what the frame holds, on the empty map, and the open map stays as it was', async () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AAAA');
  const picture = installPictureRenderer();
  setActiveView({
    projection: { screenToPoint: (x: number, y: number) => ({ x: x / 10, y: y / 10 }) },
    overlay: { showBuildableRegion: () => {}, clearBuildableRegion: () => {} }, camera: {},
  } as never);
  try {
    const sc = crowded();
    open(sc.w);
    useEditorStore.setState({ locale: 'en', viewMode: '2d' });
    const live = sc.w.state;
    const f = sc.frame;
    const whole = (o: { x: number; y: number; w: number; h: number }) => o.x >= f.x && o.y >= f.y && o.x + o.w <= f.x + f.w && o.y + o.h <= f.y + f.h;
    const held = [...live.objects.values()].filter((o) => whole(objectRect(o)));
    const meets = (r: { x: number; y: number; w: number; h: number }) => r.x < f.x + f.w && r.x + r.w > f.x && r.y < f.y + f.h && r.y + r.h > f.y;
    const across = [...live.objects.values()].filter((o) => !whole(objectRect(o)) && meets(objectRect(o)));
    expect(across.map((o) => o.catalogId)).toEqual(['building-bamboo-cabin']);
    const under = new Set(terrainCellsUnder(f).map((c) => `${c.x},${c.y}`));
    const before = { map: sc.w.fingerprint(), depth: store().commandExecutor!.historyDepth(), selection: store().selection };

    act(() => { openBlueprintSave(f); });
    const shown = shownMap(store())!;
    expect(shown).not.toBe(live);
    // Its whole objects where they stand, no neighbour, nothing across the edge, no landmark and no notes.
    expect(standing(shown)).toEqual(standing({ ...live, objects: new Map(held.map((o) => [o.id, o])) }));
    expect(shown.annotations).toBeUndefined();
    // Its terrain where it stands and none outside it.
    expect(raised(shown)).toEqual(raised(live, (x, y) => under.has(`${x},${y}`)));
    expect(raised(live).length).toBeGreaterThan(raised(shown).length);
    // The pictures draw that same map.
    const stop = watchFramedThumbs(f, () => ({ left: 100, top: 100, width: 341, height: 200 }), () => {}, 0);
    try {
      await waitFor(() => expect(picture.calls.length).toBeGreaterThan(0));
      expect(picture.calls.every((c) => c.state === shown)).toBe(true);
    } finally { stop(); }
    // The open map, its history and the selection are as they were.
    expect(store().gridState).toBe(live);
    expect({ map: sc.w.fingerprint(), depth: store().commandExecutor!.historyDepth(), selection: store().selection }).toEqual(before);

    // Escape goes back to the frame step on the open map; saving and another mode show it too.
    act(() => { expect(backOut()).toBe(true); });
    expect(shownMap(store())).toBe(live);
    act(() => { backOut(); openBlueprintSave(f); });
    expect(shownMap(store())).not.toBe(live);
    act(() => { store().setEditMode({ mode: 'object' }); });
    expect(shownMap(store())).toBe(live);
    expect(sc.w.fingerprint()).toBe(before.map);
  } finally { picture.uninstall(); setActiveView(null); vi.restoreAllMocks(); }
});

spec('BLUE-05', 'an edit during the save step that changes what the frame holds changes the map shown with it', () => {
  const sc = crowded();
  open(sc.w);
  useEditorStore.setState({ eventBus: sc.w.sandbox.bus });
  const f = sc.frame;
  act(() => { openBlueprintSave(f); });
  const first = shownMap(store())!;
  // An edit outside the frame leaves the map shown as it is; one inside lays it again.
  act(() => { expect(sc.w.place('tree-apple', f.x + f.w + 6, f.y + 3).ok).toBe(true); });
  expect(shownMap(store())).toBe(first);
  act(() => { sc.w.remove(roads(sc.w)[0]!.id); });
  const next = shownMap(store())!;
  expect(next).not.toBe(first);
  expect(standing(next).filter((o) => o.startsWith('path-'))).toHaveLength(1);
  act(() => { sc.w.undo(); });
  expect(standing(shownMap(store())!).filter((o) => o.startsWith('path-'))).toHaveLength(2);
});
