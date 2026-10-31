// @vitest-environment jsdom
/**
 * The bottom surfaces that are not a mode's panel, on an upright window: the welcome-back offer and
 * generation's scope screen stand on the dark surface the bar raises, and the arrival notice stands
 * under the top row at its content's width. jsdom has no layout, so every panel reports one height and positions are read from styles.
 */
import { afterEach, beforeEach, describe, expect, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { spec } from '../../_support/spec';
import { setStoreState } from '../../_support/store';
import { firstInland } from '../../_support/legal-maps';
import { I18nProvider, translate } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { serialize } from '../../../io/save/json-codec';
import { DEFAULT_MAP } from '../../../config/maps';
import { createGrid } from '../../../core/model/grid-model';
import { TerrainType, type GridState } from '../../../core/model/types';
import { CellZone } from '../../../core/game/zones';
import { InputModeProvider } from '../../../ui/design/input-mode';
import { DARK_PLATE } from '../../../ui/design/tokens';
import { Shell } from '../../../ui/shell/Shell';
import { ArrivalToast } from '../../../ui/chrome/floating/ArrivalToast';
import { UPRIGHT_EDGE_LEFT_VAR, UPRIGHT_EDGE_RIGHT_VAR } from '../../../ui/chrome/floating/toast-band';
import { MultiSelectBar } from '../../../ui/shell/bars/selection/MultiSelectBar';
import { TOUCH_TARGET } from '../../../ui/design/scale';
import type { InputMode } from '../../../platform/device/input-mode';
import { __resetArrivals, announceArrival } from '../../../ui/session/arrival-bus';
import { __resetRestoreOffer } from '../../../ui/session/restore-offer';
import { TOUR_OFFERED, TOUR_SEEN_KEY } from '../../_support/tour';
import { TOUCH_UI_ZOOM_DEFAULT, UI_ZOOM_DEFAULT } from '../../../platform/storage/prefs';
import { __resetUiZoomAnim } from '../../../ui/design/ui-zoom-anim';

vi.mock('../../../view/map2d/capture/thumbnail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../view/map2d/capture/thumbnail')>()),
  renderThumbnail: () => new Promise<null>(() => {}),
}));

const AUTOSAVE_STORAGE_KEY = 'petit-planet-autosave';

/** The height every panel standing on the bar reports, in frame px. */
const PANEL_H = 300;

/** A working map with content, so the browser holds a session worth offering back. */
function workingMap(): GridState {
  const cells = createGrid(DEFAULT_MAP);
  const { x, y } = firstInland(DEFAULT_MAP);
  cells[y]![x] = { zone: CellZone.Grass, terrain: { type: TerrainType.Mountain, elevation: 3 } };
  return { template: DEFAULT_MAP, cells, objects: new Map(), objectsVersion: 0, cellsVersion: 0, lockedLayers: new Set() };
}

function sizeWindow(w: number, h: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: h });
  window.dispatchEvent(new Event('resize'));
}

function painted(color: string): string {
  const probe = document.createElement('span');
  probe.style.background = color;
  return probe.style.background;
}

const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!;

beforeEach(() => {
  __resetArrivals();
  __resetRestoreOffer();
  localStorage.setItem(TOUR_SEEN_KEY, TOUR_OFFERED);
  setStoreState({ locale: 'en', assistantOpen: false, tourRunning: false });
  useEditorStore.getState().setEditMode({ mode: null });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) { return this.hasAttribute('data-bar-panel') ? PANEL_H : 0; },
  });
  sizeWindow(390, 844);
});
/** Settles the UI scale at `inputMode`'s default. */
function atDefaultScale(inputMode: InputMode): void {
  act(() => { useEditorStore.setState({ uiZoom: inputMode === 'touch' ? TOUCH_UI_ZOOM_DEFAULT : UI_ZOOM_DEFAULT }); __resetUiZoomAnim(); });
}

afterEach(() => {
  cleanup();
  localStorage.removeItem(AUTOSAVE_STORAGE_KEY);
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight);
  sizeWindow(1024, 768);
});

describe('the welcome-back offer on an upright window', () => {
  spec('UI-28', 'welcome back in portrait shows the preview, title and both buttons above the bar', () => {
    localStorage.setItem(AUTOSAVE_STORAGE_KEY, serialize(workingMap()));
    render(
      <InputModeProvider inputMode="touch" shape="portrait">
        <I18nProvider><Shell onRestoreSession={() => {}}><div /></Shell></I18nProvider>
      </InputModeProvider>,
    );
    const panel = screen.getByTestId('restore-card').closest<HTMLElement>('[data-bar-panel="dark"]')!;
    expect(panel).toBeTruthy();
    const inside = within(panel);
    expect(inside.getByTestId('restore-card')).toBeTruthy();
    expect(inside.getByText(translate('restore.title'))).toBeTruthy();
    expect(inside.getByText(translate('restore.body'))).toBeTruthy();
    const resume = inside.getByTestId('restore-resume');
    const fresh = inside.getByTestId('restore-fresh');
    // Both answers share one row, and the resume answer, not the picture, carries the countdown.
    expect(resume.parentElement).toBe(fresh.parentElement);
    expect(resume.getAttribute('aria-describedby')).toBeTruthy();
    expect(inside.getByTestId('restore-card').getAttribute('aria-describedby')).toBeNull();
    expect(resume.parentElement!.style.flexDirection || 'row').toBe('row');
    // The offer stands on the bar, and the bar's dark band reaches up behind it as one surface.
    const band = screen.getByTestId('shell-mode-band');
    const rest = parseFloat(panel.style.bottom);
    expect(parseFloat(band.style.height)).toBe(rest + PANEL_H);
    expect(band.style.background).toBe(painted(DARK_PLATE));
    expect(screen.queryByTestId('bar-plate')).toBeNull();
  });
});

describe('the welcome-back offer\'s height on an upright phone', () => {
  /** The offer's parts besides its picture as a phone lays them out, in frame px: title and two lines
   *  of words, the answers' row, the rule, and the panel's own gaps and padding. */
  const WORDS_H = 110;
  const ANSWERS_H = 38;
  const GAPS = 3 * 16;
  const PADDING = 16 + 4;

  /** Lays the offer out as a browser would: the picture as tall as it is drawn, the column as tall as
   *  its parts, the panel as tall as its column up to its cap. */
  function layOut(): void {
    const pictureOf = (el: HTMLElement) => Array.from(el.children).find((c): c is HTMLElement => c instanceof HTMLElement && c.dataset.testid === 'restore-card');
    const columnOf = (el: HTMLElement) => Array.from(el.children).some((c) => c instanceof HTMLElement && pictureOf(c));
    const columnH = (el: HTMLElement) => {
      const picture = Array.from(el.children).map((c) => pictureOf(c as HTMLElement)).find(Boolean)!;
      return parseFloat(picture.style.height) + WORDS_H + ANSWERS_H + 1 + GAPS;
    };
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get(this: HTMLElement) {
        const picture = pictureOf(this);
        if (picture) return parseFloat(picture.style.height);
        if (columnOf(this)) return columnH(this);
        if (this.hasAttribute('data-bar-panel')) {
          const column = Array.from(this.querySelectorAll<HTMLElement>('div')).find(columnOf)!;
          return Math.min(columnH(column) + PADDING, parseFloat(this.style.maxHeight) || Infinity);
        }
        return 0;
      },
    });
  }

  for (const [w, h] of [[384, 740], [360, 560]] as const) {
    spec('UI-42', `at ${w}x${h} in touch mode the offer claims all it holds and does not scroll`, () => {
      sizeWindow(w, h);
      layOut();
      localStorage.setItem(AUTOSAVE_STORAGE_KEY, serialize(workingMap()));
      render(
        <InputModeProvider inputMode="touch" shape="portrait">
          <I18nProvider><Shell onRestoreSession={() => {}}><div /></Shell></I18nProvider>
        </InputModeProvider>,
      );
      const panel = screen.getByTestId('restore-card').closest<HTMLElement>('[data-bar-panel="dark"]')!;
      const picture = parseFloat(screen.getByTestId('restore-card').style.height);
      const content = picture + WORDS_H + ANSWERS_H + 1 + GAPS + PADDING;
      expect(['auto', 'scroll']).not.toContain(panel.style.overflowY);
      expect(parseFloat(panel.style.maxHeight)).toBeGreaterThanOrEqual(content);
      expect(screen.getByTestId('restore-resume')).toBeTruthy();
    });
  }
});

describe('the screens standing in the bar on an upright window', () => {
  spec('UI-28', 'generation\'s scope screen in portrait stands on the dark surface the bar raises', async () => {
    render(
      <InputModeProvider inputMode="touch" shape="portrait">
        <I18nProvider><Shell onRestoreSession={() => {}}><div /></Shell></I18nProvider>
      </InputModeProvider>,
    );
    act(() => { useEditorStore.getState().setEditMode({ mode: 'generate' }); });
    act(() => { useEditorStore.getState().setSelectingRegion(true); });
    const scope = await screen.findByTestId('shell-scope-screen');
    expect(scope.closest('[data-bar-panel="dark"]')).toBeTruthy();
    expect(screen.getByTestId('shell-mode-band').style.background).toBe(painted(DARK_PLATE));
    act(() => { useEditorStore.getState().setSelectingRegion(false); });
  });
});

describe('the arrival notice', () => {
  function mountArrival(inputMode: InputMode = 'touch') {
    act(() => { useEditorStore.setState({ gridState: workingMap() }); });
    vi.useFakeTimers();
    render(
      <InputModeProvider inputMode={inputMode} shape="portrait">
        <I18nProvider><ArrivalToast splashActive={false} /></I18nProvider>
      </InputModeProvider>,
    );
    act(() => announceArrival({ kind: 'boot' }));
    act(() => { vi.advanceTimersByTime(1); });
    vi.useRealTimers();
    return screen.getByTestId('arrival-toast').closest<HTMLElement>('[role="status"]')!;
  }

  spec('UI-28', 'the arrival notice stands at its content\'s width in one row under the top row in portrait, a long name truncating', () => {
    const band = mountArrival();
    const card = within(band).getByTestId('arrival-toast');
    const style = getComputedStyle(card);
    // jsdom has no layout: the geometry at phone width is checked in the browser captures. Here the
    // band is centred on the card rather than pinned at both sides, the card does not grow to the
    // band, and its words and answers never wrap onto a second line.
    expect(band.style.right).toBe('');
    expect(style.flexGrow === '' || style.flexGrow === '0').toBe(true);
    expect(style.flexWrap).toBe('nowrap');
    // Capped to the room between the frame's left and right margins, and centred in it.
    for (const side of [UPRIGHT_EDGE_LEFT_VAR, UPRIGHT_EDGE_RIGHT_VAR]) {
      expect(band.style.maxWidth).toContain(side);
      expect(band.style.left).toContain(side);
    }
    // The name keeps its full text where an ellipsis cuts it.
    const name = card.querySelector<HTMLElement>('[title]');
    expect(name?.title).toBeTruthy();
    expect(name?.title).toBe(name?.textContent);
  });

  spec('UI-27', 'on a phone the arrival answers and the multi-select plate draw a fingertip tall at touch mode\'s default scale and at the chrome zoom in PC mode', () => {
    const drawn = (inputMode: InputMode) => {
      atDefaultScale(inputMode);
      const band = mountArrival(inputMode);
      const zoom = Number(band.style.zoom);
      const answers = [screen.getByTestId('arrival-ok'), screen.getByTestId('arrival-switch')].map((b) => (parseFloat(b.style.minHeight) || 0) * zoom);
      cleanup();
      act(() => { useEditorStore.setState({ multiSelectLatched: true }); });
      render(<InputModeProvider inputMode={inputMode} shape="portrait"><I18nProvider><MultiSelectBar /></I18nProvider></InputModeProvider>);
      const plate = Number(screen.getByTestId('multi-select-plate').style.zoom);
      const done = parseFloat(screen.getByTestId('multi-select-done').style.height) * plate;
      cleanup();
      act(() => { useEditorStore.setState({ multiSelectLatched: false }); });
      return { zoom, answers, plate, done };
    };
    const touch = drawn('touch');
    for (const answer of touch.answers) expect(answer).toBeGreaterThanOrEqual(TOUCH_TARGET);
    expect(touch.done).toBeGreaterThanOrEqual(TOUCH_TARGET);
    const pc = drawn('pc');
    expect(pc.zoom).toBeLessThan(1);
    expect(pc.plate).toBeCloseTo(pc.zoom);
    expect(pc.answers).toEqual([0, 0]);
  });

});
