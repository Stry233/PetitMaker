// @vitest-environment jsdom
/**
 * The planet session's nameplate: centred on the mode row's ink line, naming the planet in its save
 * panel, and unrolling one surface at a time from the plate.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { I18nProvider, translate } from '../../../../i18n/context';
import { useEditorStore } from '../../../../state/store';
import { newMap } from '../../../../editor/operations/map';
import { editorPort } from '../../../../editor/session/context';
import { host } from '../../../../editor/host/host';
import { listPlanets } from '../../../../io/storage/planet-library';
import { CommandType, TerrainType, type MacroCoord } from '../../../../core/model/types';
import { CellZone } from '../../../../core/game/zones';
import { Shell } from '../../../../ui/shell/Shell';
import { MODE_ROW_INK_CENTRE, MODE_ROW_TOP, TOP_RIGHT_H, TOP_RIGHT_TOP, blockCentre, cornerArt, planFrame, sessionModes, topRightHeight } from '../../../../ui/shell/frame';
import { FIT_FLOOR, fittedUiScale } from '../../../../ui/design/scale';
import { PLATE_MIN_WIDTH, plateDepth, plateMinDepth } from '../../../../ui/shell/controls/layer-plate';
import { MODE, MODE_PLATE_W, MODE_SCALE, ZOOM } from '../../../../ui/shell/units';
import { NAME_LEAST, PLATE_ROW, nameplateSpan, nameplateTop, toastBandShift, type NameplateSpan } from '../../../../ui/shell/planet/nameplate-layout';
import { TOAST_BAND_SHIFT_VAR, TOAST_BAND_TOP, bandTop } from '../../../../ui/chrome/floating/toast-band';
import { MenuSheet } from '../../../../ui/shell/controls/MenuSheet';
import { startPlanetEditing, stopPlanetEditing } from '../../../../editor/session/planet-editing';
import { setStoreState } from '../../../_support/store';
import type { PlanetSession } from '../../../../state/slices/planet-session';
import { anchoredOrigin } from '../../../../ui/primitives/AnchoredConfirm';
import type { TextKey } from '../../../../i18n/keys';

// Names are checked by the export text review; these tests stub its verdict as approved.
vi.mock('../../../../pipelines/moderation/text/reviewer', async (original) => ({
  ...await original<typeof import('../../../../pipelines/moderation/text/reviewer')>(),
  reviewText: vi.fn(async () => ({ allowed: true })),
}));

/** The fit floor a touch-primary device gets. */
const TOUCH_FLOOR = 0.5;
/** Where the plate's box ends, in chrome css px. */
const nameplateBottom = (frameZoom: number, chromeZoom: number) => nameplateTop(frameZoom, chromeZoom) + PLATE_ROW;
const store = () => useEditorStore.getState();
const t = (key: TextKey, params?: Record<string, string | number>) => translate(key, params);

function mount() {
  return render(
    <Shell onRestoreSession={() => {}}><div /></Shell>,
    { wrapper: ({ children }) => <I18nProvider>{children}</I18nProvider> },
  );
}

function enter(): void {
  act(() => { store().setTourRunning(false); startPlanetEditing(null, false); });
}

function paintGround(): void {
  const cells: MacroCoord[] = [];
  for (let y = 100; y < 120; y++) for (let x = 100; x < 120; x++) cells.push({ x, y });
  act(() => {
    const exec = store().commandExecutor!;
    const start = exec.beginStroke();
    exec.execute({ type: CommandType.PaintTerrain, cells, terrainType: TerrainType.Mountain, elevation: 0, ground: CellZone.Grass });
    start.commit();
  });
}

const plate = () => screen.getByTestId('planet-nameplate');
const plateButton = (name: string | RegExp) => within(plate()).getByRole('button', { name });

beforeEach(() => {
  localStorage.clear();
  setStoreState({ locale: 'en' });
  newMap(editorPort, 'hexia');
  store().setAssistantOpen(false);
  store().setTourRunning(false);
  store().setModal('newProject', false);
  useEditorStore.setState({ planetReturn: null });
});

afterEach(() => {
  act(() => { stopPlanetEditing(); });
  host.camera.takeQueued();
  cleanup();
  vi.restoreAllMocks();
});

describe('placement', () => {
  it('centres the plate on the line the mode row and the corner share, at any pair of zooms', () => {
    expect(TOP_RIGHT_TOP + TOP_RIGHT_H / 2).toBeCloseTo(MODE_ROW_INK_CENTRE, 6);
    for (const [frameZoom, zoom] of [[1.25, 1], [0.625, 1], [0.75, 0.6], [1.5, 1.2]] as const) {
      expect((nameplateTop(frameZoom, zoom) + PLATE_ROW / 2) * zoom).toBeCloseTo(MODE_ROW_INK_CENTRE * frameZoom, 6);
    }
  });

  it('stands at that line in the shell, drawn at the chrome scale', () => {
    mount();
    enter();
    const zoom = Number(plate().style.zoom);
    expect(parseFloat(plate().style.top)).toBeCloseTo(nameplateTop(ZOOM * zoom, zoom), 6);
  });
});

interface Box { left: number; right: number; top: number; bottom: number }
const meets = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** The plate as its row lays it out: on the window's centre while that fits the span, slid along
 *  the span otherwise, and no wider than the span, in screen px. */
function placed(span: NameplateSpan, width: number): { left: number; right: number } {
  const w = Math.min(width, span.right - span.left);
  const left = Math.max(span.left, Math.min(span.centre - w / 2, span.right - w));
  return { left, right: left + w };
}

describe('across the window', () => {
  // Any session draws with the same modes.
  const sessionCount = sessionModes({} as PlanetSession).length;
  const layoutOptions = { open: false, plateDepth: plateDepth('pill'), plateMinDepth: plateMinDepth('pill'), plateMinWidth: PLATE_MIN_WIDTH,
    modes: sessionCount, corner: cornerArt(true) };

  it('never meets the mode row or the corner at any window and UI scale', () => {
    const windows = [[1440, 900], [1280, 800], [1024, 768], [390, 844], [844, 390], [780, 360], [2560, 1440]] as const;
    for (const [vw, vh] of windows) for (const floor of [FIT_FLOOR, TOUCH_FLOOR]) {
      for (let ui = 0.6; ui <= 1.8001; ui += 0.1) {
        const chrome = fittedUiScale(vw, vh, ui, 0, floor);
        const frameZoom = chrome * ZOOM;
        const layout = planFrame(vw / frameZoom, vh / frameZoom, layoutOptions);
        const span = nameplateSpan(vw, frameZoom, chrome, layout, sessionCount);
        const band = { top: nameplateTop(frameZoom, chrome) * chrome, bottom: nameplateBottom(frameZoom, chrome) * chrome };
        // Every session block with the splat a selected block stands on, drawn in the frame's zoom.
        const blocks: Box[] = Array.from({ length: sessionCount }, (_, i) => ({
          left: (blockCentre(i) - (MODE_PLATE_W * MODE_SCALE) / 2) * frameZoom,
          right: (blockCentre(i) + (MODE_PLATE_W * MODE_SCALE) / 2) * frameZoom,
          top: MODE_ROW_TOP * frameZoom, bottom: (MODE_ROW_TOP + MODE.height) * frameZoom,
        }));
        const menu = cornerArt(true)[0]!;
        const menuW = topRightHeight(menu) * menu.w / menu.h;
        const corner: Box = {
          left: (layout.width - layout.edgeRight - menuW) * frameZoom, right: (layout.width - layout.edgeRight) * frameZoom,
          top: layout.cornerTop * frameZoom, bottom: (layout.cornerTop + topRightHeight(menu)) * frameZoom,
        };
        for (let width = 160; width <= 560; width += 20) {
          const plate = { ...placed(span, width * chrome), ...band };
          const where = `${vw}x${vh} ui ${ui.toFixed(1)} floor ${floor} plate ${width}`;
          for (const block of blocks) expect(meets(plate, block), where).toBe(false);
          expect(meets(plate, corner), where).toBe(false);
          expect(plate.left, where).toBeGreaterThanOrEqual(0);
          expect(plate.right, where).toBeLessThanOrEqual(vw);
        }
      }
    }
  });

  it('keeps the window centre while the plate fits beside the mode row and the corner', () => {
    const chrome = fittedUiScale(1440, 900, 1);
    const layout = planFrame(1440 / (chrome * ZOOM), 900 / (chrome * ZOOM), layoutOptions);
    const span = nameplateSpan(1440, chrome * ZOOM, chrome, layout, sessionCount);
    const plate = placed(span, 360 * chrome);
    expect((plate.left + plate.right) / 2).toBeCloseTo(720, 6);
  });

  it('stands its row on that span in the shell and gives only the name room to shrink', () => {
    mount();
    enter();
    const row = plate();
    const chrome = Number(row.style.zoom);
    const frameZoom = chrome * ZOOM;
    const layout = planFrame(innerWidth / frameZoom, innerHeight / frameZoom, layoutOptions);
    const span = nameplateSpan(innerWidth, frameZoom, chrome, layout, sessionModes(store().planetSession).length);
    expect(parseFloat(row.style.left) * chrome).toBeCloseTo(span.left, 4);
    expect(parseFloat(row.style.width) * chrome).toBeCloseTo(span.right - span.left, 4);
    const body = screen.getByTestId('planet-nameplate-plate');
    expect(body.style.maxWidth).toBe('100%');
    expect(body.style.flex).toMatch(/^(none|0 0 auto)$/);
    const name = screen.getByTestId('planet-name');
    expect(parseFloat(name.style.minWidth)).toBe(NAME_LEAST);
    expect(name.getAttribute('title')).toBe(t('planet.default_name', { n: 1 }));
    for (const id of ['planet-back', 'planet-done']) expect(screen.getByTestId(id).style.flex).toMatch(/^(none|0 0 auto)$/);
  });
});

describe('the toast band', () => {
  it('moves below the plate by the gap the plate keeps', () => {
    for (const [frameZoom, zoom] of [[1.25, 1], [0.625, 0.5], [1.5, 1.2]] as const) {
      const shift = toastBandShift(frameZoom, zoom);
      expect(shift).toBeGreaterThan(0);
      expect(TOAST_BAND_TOP + shift).toBeGreaterThan(nameplateBottom(frameZoom, zoom));
    }
    expect(bandTop(TOAST_BAND_TOP)).toBe(`calc(${TOAST_BAND_TOP}px + var(${TOAST_BAND_SHIFT_VAR}, 0px))`);
  });

  it('is shifted while the plate stands and back in place once the session ends', async () => {
    const root = document.documentElement.style;
    mount();
    expect(root.getPropertyValue(TOAST_BAND_SHIFT_VAR)).toBe('');
    enter();
    const zoom = Number(plate().style.zoom);
    expect(parseFloat(root.getPropertyValue(TOAST_BAND_SHIFT_VAR))).toBeCloseTo(toastBandShift(ZOOM * zoom, zoom), 6);
    act(() => { stopPlanetEditing(); });
    await waitFor(() => expect(root.getPropertyValue(TOAST_BAND_SHIFT_VAR)).toBe(''));
  });
});

describe('the name', () => {
  it('opens the save panel at its field, and the plate shows the name as it is typed', async () => {
    mount();
    enter();
    paintGround();
    fireEvent.click(plateButton(/Rename/));
    const panel = await screen.findByRole('dialog', { name: t('planet.save_title_new') });
    const field = within(panel).getByRole('textbox', { name: t('planet.name_field') }) as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(field));
    fireEvent.change(field, { target: { value: 'Reef' } });
    expect(within(plate()).getByText('Reef')).toBeTruthy();
    fireEvent.click(within(panel).getByRole('button', { name: t('planet.keep_editing') }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(within(plate()).getByText('Reef')).toBeTruthy();
    fireEvent.click(plateButton(t('planet.done')));
    const reopened = await screen.findByRole('dialog', { name: t('planet.save_title_new') });
    expect((within(reopened).getByRole('textbox') as HTMLInputElement).value).toBe('Reef');
    const save = within(reopened).getByRole('button', { name: t('planet.save_title_new') }) as HTMLButtonElement;
    await waitFor(() => expect(save.disabled).toBe(false));
    fireEvent.click(save);
    expect(listPlanets().map((e) => e.name)).toEqual(['Reef']);
  });

  it('offers no save for a blank name and keeps the default on the plate', async () => {
    mount();
    enter();
    paintGround();
    fireEvent.click(plateButton(/Rename/));
    const panel = await screen.findByRole('dialog');
    fireEvent.change(within(panel).getByRole('textbox'), { target: { value: '   ' } });
    expect((within(panel).getByRole('button', { name: t('planet.save_title_new') }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(plate()).getByText(t('planet.default_name', { n: 1 }))).toBeTruthy();
  });
});

describe('without ground', () => {
  it('lets the name be edited but offers no save', async () => {
    mount();
    enter();
    fireEvent.click(plateButton(/Rename/));
    const panel = await screen.findByRole('dialog', { name: t('planet.save_title_new') });
    const field = within(panel).getByRole('textbox') as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'Atoll' } });
    expect(field.value).toBe('Atoll');
    expect((within(panel).getByRole('button', { name: t('planet.save_title_new') }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(store().planetSession).not.toBeNull();
    paintGround();
    await waitFor(() => expect((within(panel).getByRole('button', { name: t('planet.save_title_new') }) as HTMLButtonElement).disabled).toBe(false));
  });
});

describe('one surface at a time', () => {
  it('closes the save panel on a second press of Done and on Escape', async () => {
    mount();
    enter();
    paintGround();
    await waitFor(() => expect((plateButton(t('planet.done')) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(plateButton(t('planet.done')));
    await screen.findByRole('dialog');
    expect(plateButton(t('planet.done')).getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(plateButton(t('planet.done')));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(plateButton(t('planet.done')));
    const panel = await screen.findByRole('dialog');
    fireEvent.keyDown(within(panel).getByRole('textbox'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(store().planetSession).not.toBeNull();
  });

  it('grows the save panel and the discard question from the plate as one anchored card', async () => {
    mount();
    enter();
    paintGround();
    fireEvent.click(plateButton(/Rename/));
    const panel = await screen.findByRole('dialog', { name: t('planet.save_title_new') });
    expect(panel.style.transformOrigin).toMatch(/^[\d.]+px top$/);
    expect(panel.style.height).toBe('');
    fireEvent.click(plateButton(t('planet.back')));
    const discard = await screen.findByRole('dialog', { name: t('planet.discard_title') });
    expect(discard.style.transformOrigin).toBe(anchoredOrigin(false, 'start'));
  });

  it('trades the save panel for the discard question when Back is pressed with edits', async () => {
    mount();
    enter();
    paintGround();
    fireEvent.click(plateButton(/Rename/));
    await screen.findByRole('dialog', { name: t('planet.save_title_new') });
    fireEvent.click(plateButton(t('planet.back')));
    await screen.findByRole('dialog', { name: t('planet.discard_title') });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: t('planet.save_title_new') })).toBeNull());
  });
});

describe('the menu rows', () => {
  it('leaves out Change planet and Import in a session', () => {
    const rowsShown = (): string[] => {
      const trigger = { current: document.body };
      const view = render(<I18nProvider><MenuSheet open onDismiss={() => {}} trigger={trigger} /></I18nProvider>);
      const names = screen.getAllByRole('menuitem').map((item) => item.textContent ?? '');
      view.unmount();
      return names;
    };
    const titles = (keys: TextKey[]) => keys.map((key) => t(key));
    setStoreState({ planetSession: null });
    expect(rowsShown()).toEqual(titles(['modal.new_title', 'import.title', 'modal.settings_title', 'modal.help_title', 'modal.about_title']));
    setStoreState({ planetSession: {} as PlanetSession });
    expect(rowsShown()).toEqual(titles(['modal.settings_title', 'modal.help_title', 'modal.about_title']));
    setStoreState({ planetSession: null });
  });
});
