import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import { setActiveView } from '../../../canvas/active-view';

import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import type { EditorEvents } from '../../../core/model/types';
import { useKeybinds } from '../../../core/runtime/keybindings';
import { setRegionBrushHandler } from '../../../core/runtime/region-brush';
import { I18nProvider } from '../../../i18n/context';
import { translations } from '../../../i18n/translations';
import { createDefaultRegistry } from '../../../rules';
import { roadLookup } from '../../../state/object-index';
import { useEditorStore } from '../../../state/store';
import { ScaleProvider } from '../../../ui/design/scale';
import { ScopeScreen } from '../../../ui/shell/bars/ScopeScreen';
import { SCOPE_TOOLS_FOR } from '../../../ui/shell/bars/scope-cells';
import { makeState } from '../../rules/_helpers';

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
  const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
  useEditorStore.setState({ gridState: state, commandExecutor: exec });
  return state;
}

beforeEach(() => {
  useEditorStore.setState({ locale: 'en', region: [], regionTool: 'brush', regionBrushShape: 'brush', regionBrushSize: 3, regionDimensions: true, selectingRegion: true });
  useKeybinds.getState().resetAll();
});

afterEach(() => {
  cleanup();
  useEditorStore.setState({ gridState: null, commandExecutor: null, region: [], selectingRegion: false });
});

describe('region brush controls', () => {
  it('keeps drawing shapes inside Brush and restores the shape after erasing', () => {
    mount();
    fireEvent.click(screen.getByLabelText(en('eraser.circle')));
    expect(useEditorStore.getState().regionTool).toBe('circle');
    expect(screen.getByLabelText(en('terrain.brush')).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByLabelText(en('design.eraser')));
    expect(useEditorStore.getState().regionTool).toBe('eraser');
    fireEvent.click(screen.getByLabelText(en('terrain.brush')));
    expect(useEditorStore.getState().regionTool).toBe('circle');
  });

  it('shares the Brush binding and numbers the region options', () => {
    mount();
    const brush = screen.getByLabelText(en('terrain.brush'));
    expect(within(brush.parentElement!).getByText('1')).toBeTruthy();
    expect(screen.getByRole('group', { name: en('terrain.shapes') })).toBeTruthy();
    act(() => useKeybinds.getState().rebind('tool.brush', 'k', 'region'));
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
    useEditorStore.setState({ region: cells });
    mount();
    fireEvent.click(screen.getByLabelText(en('region.dimensions_hide')));
    expect(useEditorStore.getState().regionDimensions).toBe(false);
    expect(useEditorStore.getState().region).toBe(cells);
    fireEvent.click(screen.getByLabelText(en('region.dimensions_show')));
    expect(useEditorStore.getState().regionDimensions).toBe(true);
  });
});

describe('the painted highlight', () => {
  it('survives Done, and goes only when the region itself does', () => {
    const shown: number[] = [];
    let cleared = 0;
    setActiveView({
      overlay: {
        showBuildableRegion: (cells: unknown[]) => { shown.push(cells.length); },
        clearBuildableRegion: () => { cleared += 1; },
      },
    } as never);
    installMap();
    useEditorStore.setState({ region: [{ x: 1, y: 1 }, { x: 2, y: 1 }] });
    const view = mount();
    expect(shown).toContain(2);

    // DONE IS NOT THE END OF THE REGION. It is the scope the next run acts on, and seeing it on the
    // map is how a person knows where a generation will land; closing this screen is only the end
    // of editing it. What the drape cannot survive is a RUN, which moves the ground under it, and
    // the shelf re-shows the same cells once its run has landed.
    const onDone = cleared;
    view.unmount();
    expect(cleared).toBe(onDone);

    // Painted away to nothing IS a clear, not a call to skip, or the last region stays on the map.
    const before = cleared;
    mount();
    act(() => { useEditorStore.setState({ region: [] }); });
    expect(cleared).toBeGreaterThan(before);
    setActiveView(null);
  });
});

describe('what the screen offers', () => {
  /**
   * DONE SAYS DONE. A button says what pressing it does, and the count already has a permanent home:
   * the scope chip in the strip keeps saying it once the cards are back, which is what makes it a
   * chip rather than a tab. Carried here as well it would be said twice, once on a control that
   * disappears.
   */
  it('offers a Done that says only what pressing it does', () => {
    useEditorStore.setState({ region: [{ x: 1, y: 1 }, { x: 2, y: 1 }] });
    const done = vi.fn();
    mount(done);
    fireEvent.click(screen.getByText(en('gen.scope_done')));
    expect(done).toHaveBeenCalled();
    expect(screen.queryByText(/2 cells/)).toBeNull();
    expect(screen.queryByText(new RegExp(en('gen.scope_all')))).toBeNull();
  });

  /**
   * A PICTURE MAY BE CIRCLED. Both picture kinds are fitted to the region's bounding box, and the
   * two figures a drag produces whole — the rectangle and the circle inscribed in its own box — are
   * both usable: a circled picture keeps its middle and gives up its corners, which is a vignette
   * rather than damage. What neither can use is a figure with no interior (a brushed blob, a line, a
   * curve), where the box is mostly empty and the picture comes out full of holes.
   */
  it('offers the picture kinds a rectangle and a circle, and nothing that leaves holes', () => {
    expect(SCOPE_TOOLS_FOR.image).toEqual(['rect', 'circle']);
    expect(SCOPE_TOOLS_FOR.text).toEqual(['rect', 'circle']);
    render(
      <I18nProvider>
        <ScaleProvider value={0.5}>
          <ScopeScreen onDone={() => {}} tools={SCOPE_TOOLS_FOR.image} minSide={20} />
        </ScaleProvider>
      </I18nProvider>,
    );
    expect(screen.getByLabelText(en('eraser.circle'))).toBeTruthy();
    expect(screen.getByLabelText(en('eraser.rect'))).toBeTruthy();
    expect(screen.queryByLabelText(en('eraser.line'))).toBeNull();
  });

  /** The refusal has WORDS. A `gen.scope_min` called from here and defined in no locale would have
   *  the button read as its own key until a region was big enough to make it go away. */
  it('says the minimum in words while the region is too short', () => {
    useEditorStore.setState({ region: [{ x: 1, y: 1 }, { x: 2, y: 1 }] });
    render(
      <I18nProvider>
        <ScaleProvider value={0.5}>
          <ScopeScreen onDone={() => {}} tools={SCOPE_TOOLS_FOR.image} minSide={20} />
        </ScaleProvider>
      </I18nProvider>,
    );
    const said = en('gen.scope_min').replace('{n}', '20');
    expect(said).not.toContain('gen.');
    expect(screen.getByText(said)).toBeTruthy();
  });

  /** It goes through the region channel rather than the store, because the collector owns the
   *  buffer AND its own undo stack. */
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
