// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import { setActiveView } from '../../../../../view/active-view';

import { useKeybinds } from '../../../../../state/keymap/store';
import { setRegionBrushHandler } from '../../../../../view/interaction/pointer/region-channel';
import { I18nProvider } from '../../../../../i18n/context';
import { translations } from '../../../../../i18n/translations';
import { createDefaultRegistry } from '../../../../../rules';
import { useEditorStore } from '../../../../../state/store';
import { regionOf } from '../../../../../state/editing/region';
import { watchRegionOverlay } from '../../../../../editor/editing/region-brush';
import { ScaleProvider } from '../../../../../ui/design/scale';
import { ScopeScreen } from '../../../../../ui/shell/bars/generate/ScopeScreen';
import { SCOPE_TOOLS_FOR } from '../../../../../tools/generation/facts';
import { DEFAULT_REGION_REQUEST } from '../../../../../state/editing/vocabulary';
import { makeState } from '../../../../_support/map-state';
import { createExecutor } from '../../../../../state/executor';

const en = (key: string): string => translations.en[key]!;

function mount(onDone = () => {}) {
  return render(
    <I18nProvider>
      <ScaleProvider value={0.5}>
        <ScopeScreen onDone={onDone} />
      </ScaleProvider>
    </I18nProvider>,
  );
}

/** A live map in the store, which is what Select all counts its cells off. */
function installMap(size = 12) {
  const state = makeState(size, size);
  const exec = createExecutor(state, createDefaultRegistry());
  useEditorStore.setState({ gridState: state, commandExecutor: exec });
  return state;
}

beforeEach(() => {
  useEditorStore.setState({ locale: 'en', regions: {}, regionTool: 'free', regionBrushShape: 'free', regionBrushSize: 3, regionDimensions: true, selectingRegion: true, regionSelectionOwner: 'generator', regionRequest: DEFAULT_REGION_REQUEST });
  useKeybinds.getState().resetAll();
});

afterEach(() => {
  cleanup();
  useEditorStore.setState({ gridState: null, commandExecutor: null, regions: {}, selectingRegion: false });
});

describe('region brush controls', () => {
  it('keeps drawing shapes inside Brush and restores the shape after erasing', () => {
    mount();
    fireEvent.click(screen.getByLabelText(en('eraser.circle')));
    expect(useEditorStore.getState().regionTool).toBe('circle');
    expect(screen.getByLabelText(en('terrain.brush')).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByLabelText(en('design.eraser')));
    expect(useEditorStore.getState().regionTool).toBe('erase');
    fireEvent.click(screen.getByLabelText(en('terrain.brush')));
    expect(useEditorStore.getState().regionTool).toBe('circle');
  });

  it('shares the Brush binding and numbers the region options', () => {
    mount();
    const brush = screen.getByLabelText(en('terrain.brush'));
    expect(within(brush.parentElement!).getByText('1')).toBeTruthy();
    expect(screen.getByRole('group', { name: en('terrain.shapes') })).toBeTruthy();
    act(() => { useKeybinds.getState().rebind('tool.brush', 'k', 'region'); });
    expect(within(brush.parentElement!).getByText('K')).toBeTruthy();
  });

  it('hides brush width for filled shapes', async () => {
    mount();
    expect(screen.getByRole('slider')).toBeTruthy();
    fireEvent.click(screen.getByLabelText(en('eraser.rect')));
    await vi.waitFor(() => expect(screen.queryByRole('slider')).toBeNull());
    fireEvent.click(screen.getByLabelText(en('eraser.line')));
    expect(await screen.findByRole('slider')).toBeTruthy();
  });

  it('switches dimension visibility without changing selected cells', () => {
    const cells = [{ x: 1, y: 1 }, { x: 2, y: 1 }];
    useEditorStore.setState((st) => ({ regions: { ...st.regions, generator: { cells: cells, map: st.gridState } } }));
    mount();
    fireEvent.click(screen.getByLabelText(en('region.dimensions_hide')));
    expect(useEditorStore.getState().regionDimensions).toBe(false);
    expect(regionOf(useEditorStore.getState(), 'generator')).toBe(cells);
    fireEvent.click(screen.getByLabelText(en('region.dimensions_show')));
    expect(useEditorStore.getState().regionDimensions).toBe(true);
  });
});

describe('the painted highlight', () => {
  /** The map shows the region of the surface in front (`watchRegionOverlay`): Generate's scope while
   *  Generate mode is open, past its screen's Done. */
  it("[GEN-05] survives Done in Generate mode, and goes when the region or Generate mode does", () => {
    const shown: number[] = [];
    let cleared = 0;
    setActiveView({
      overlay: {
        showBuildableRegion: (set: { cells: unknown[] }) => { shown.push(set.cells.length); },
        clearBuildableRegion: () => { cleared += 1; },
      },
    } as never);
    installMap();
    const stop = watchRegionOverlay();
    try {
      act(() => { useEditorStore.getState().setEditMode({ mode: 'generate' }); });
      useEditorStore.setState((st) => ({ regions: { ...st.regions, generator: { cells: [{ x: 1, y: 1 }, { x: 2, y: 1 }], map: st.gridState } } }));
      expect(shown).toContain(2);

      // Done keeps the region drawn: it shows where the next run will land.
      const onDone = cleared;
      act(() => { useEditorStore.getState().setSelectingRegion(false); });
      expect(cleared).toBe(onDone);

      // Another mode puts Generate's scope out of sight, and Generate mode brings it back.
      act(() => { useEditorStore.getState().setEditMode({ mode: 'mountain' }); });
      expect(cleared).toBe(onDone + 1);
      shown.length = 0;
      act(() => { useEditorStore.getState().setEditMode({ mode: 'generate' }); });
      expect(shown).toContain(2);

      // A region painted away to nothing clears the drape.
      const before = cleared;
      act(() => { useEditorStore.setState((st) => ({ regions: { ...st.regions, generator: { cells: [], map: st.gridState } } })); });
      expect(cleared).toBeGreaterThan(before);
    } finally {
      stop();
      setActiveView(null);
    }
  });
});

describe('what the screen offers', () => {
  /** The cell count already stays on the strip's scope chip. */
  it('offers a Done that says only what pressing it does', () => {
    useEditorStore.setState((st) => ({ regions: { ...st.regions, generator: { cells: [{ x: 1, y: 1 }, { x: 2, y: 1 }], map: st.gridState } } }));
    const done = vi.fn();
    mount(done);
    fireEvent.click(screen.getByText(en('generate.scope_done')));
    expect(done).toHaveBeenCalled();
    expect(screen.queryByText(/2 cells/)).toBeNull();
    expect(screen.queryByText(new RegExp(en('generate.scope_all')))).toBeNull();
  });

  /**
   * Pictures fit the region's bounding box: a circle vignettes the corners, while a brushed blob or
   * a line leaves the box mostly empty and the picture full of holes.
   */
  it('offers the picture kinds a rectangle and a circle, and nothing that leaves holes', () => {
    expect(SCOPE_TOOLS_FOR.image).toEqual(['rect', 'circle']);
    expect(SCOPE_TOOLS_FOR.text).toEqual(['rect', 'circle']);
    useEditorStore.getState().setSelectingRegion(true, 'generator', { tools: SCOPE_TOOLS_FOR.image!, single: true, minSide: 20 });
    render(
      <I18nProvider>
        <ScaleProvider value={0.5}>
          <ScopeScreen onDone={() => {}} />
        </ScaleProvider>
      </I18nProvider>,
    );
    expect(screen.getByLabelText(en('eraser.circle'))).toBeTruthy();
    expect(screen.getByLabelText(en('eraser.rect'))).toBeTruthy();
    expect(screen.queryByLabelText(en('eraser.line'))).toBeNull();
  });

  it('says the minimum in words while the region is too short', () => {
    useEditorStore.setState((st) => ({ regions: { ...st.regions, generator: { cells: [{ x: 1, y: 1 }, { x: 2, y: 1 }], map: st.gridState } } }));
    useEditorStore.getState().setSelectingRegion(true, 'generator', { tools: SCOPE_TOOLS_FOR.image!, single: true, minSide: 20 });
    render(
      <I18nProvider>
        <ScaleProvider value={0.5}>
          <ScopeScreen onDone={() => {}} />
        </ScaleProvider>
      </I18nProvider>,
    );
    const said = en('generate.scope_min').replace('{n}', '20');
    expect(said).not.toContain('generate.');
    expect(screen.getByText(said)).toBeTruthy();
  });

  /** Through the region channel, since the collector owns the buffer and its undo stack. */
  it('asks the region brush for clear', () => {
    const clear = vi.fn();
    const off = setRegionBrushHandler({ paint: vi.fn(), done: vi.fn(), clear });
    installMap();
    mount();

    fireEvent.click(screen.getByText(en('generate.clear')));
    expect(clear).toHaveBeenCalled();
    off();
  });
});
