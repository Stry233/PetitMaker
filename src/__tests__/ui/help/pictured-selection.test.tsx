// @vitest-environment jsdom
/** A Help figure's selection surfaces are the live ones standing on the figure's own world. */
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '../../../i18n/context';
import { InputModeProvider } from '../../../ui/design/input-mode';
import { SandboxWorld } from '../../../editor/sandbox/demo-world';
import { createSignal } from '../../../core/base/signal';
import { mapPoint } from '../../../core/grid/grids';
import { useEditorStore } from '../../../state/store';
import { HEADLESS_OVERLAY } from '../../../tools/pointer/runtime/host';
import { PicturedSelection } from '../../../ui/help/figures/PicturedSelection';
import type { DemoMap } from '../../../ui/help/figures/demo-player';

const CABIN = 'building-forest-cabin';
const TREE = 'tree-apple';
const BOX = { W: 600, H: 400 };

/** The figure's map as `standUpDemo` hands it over, its projection a plain scale about the cabin. */
function demoMap(world: SandboxWorld): DemoMap {
  const moved = createSignal();
  const projection = {
    cellToScreen: (x: number, y: number) => ({ x: (x - 60) * 20, y: (y - 90) * 20, scale: 20 }),
    screenToPoint: (sx: number, sy: number) => mapPoint({ x: sx / 20 + 60, y: sy / 20 + 90 }),
  };
  return {
    state: world.state, curves: world.curve, view: () => ({ overlay: HEADLESS_OVERLAY, projection }),
    watch: (tell) => moved.subscribe(tell),
    selection: () => ({ selection: world.selection, gridState: world.state, latched: world.multiSelectLatched }),
    onSelection: (tell) => world.watchSelection(tell),
  };
}

function figure(world: SandboxWorld) {
  return render(
    <InputModeProvider inputMode="touch">
      <I18nProvider>
        <div style={{ position: 'relative', width: BOX.W, height: BOX.H }}>
          <PicturedSelection map={demoMap(world)} W={BOX.W} H={BOX.H} barH={0} zoom={1} />
        </div>
      </I18nProvider>
    </InputModeProvider>,
  );
}

afterEach(() => { cleanup(); });

describe('[UI-64] the selection card and touch multi-select stand on a Help figure\'s world', () => {
  it('a tap selecting the cabin stands the live card in the figure\'s box, inert, and its Rotate changes nothing', () => {
    const world = new SandboxWorld();
    world.place(CABIN, 68, 98);
    const before = useEditorStore.getState().selection;
    figure(world);
    expect(screen.queryByTestId('selection-card')).toBeNull();
    act(() => { world.pressMap({ x: 70, y: 99.5 }, true); world.releaseMap({ x: 70, y: 99.5 }); });
    const card = screen.getByTestId('selection-card');
    expect(card.style.position).toBe('absolute');
    expect(card.hasAttribute('inert')).toBe(true);
    expect(card.style.visibility).toBe('visible');
    const left = parseFloat(card.style.left);
    expect(left).toBeGreaterThanOrEqual(0);
    expect(left).toBeLessThan(BOX.W);
    const cabin = world.objectAt(CABIN, 68, 98)!;
    fireEvent.click(screen.getByTestId('handle-rotate'));
    expect(world.objectAt(CABIN, 68, 98)?.rotation).toBe(cabin.rotation);
    // The reader's own editor is not the figure's.
    expect(useEditorStore.getState().selection).toBe(before);
  });

  it('[EDIT-43] Multi-select from the long-press menu puts the card away for the plate and row, which Done takes down', () => {
    const world = new SandboxWorld();
    world.place(TREE, 66, 99);
    world.place(TREE, 68, 99);
    figure(world);
    act(() => {
      world.pressMap({ x: 66.5, y: 99.5 }, true);
      world.holdMap();
      world.releaseMap({ x: 66.5, y: 99.5 });
      world.menuMultiSelect();
      world.pressMap({ x: 68.5, y: 99.5 }, true);
      world.releaseMap({ x: 68.5, y: 99.5 });
    });
    expect(world.selectedIds()).toHaveLength(2);
    expect(screen.queryByTestId('selection-card')).toBeNull();
    expect(screen.getByTestId('pictured-multi-select').hasAttribute('inert')).toBe(true);
    expect((screen.getByTestId('multi-select-copy') as HTMLButtonElement).disabled).toBe(false);
    act(() => { world.clearSelection(); });
    expect(screen.queryByTestId('pictured-multi-select')).toBeNull();
  });
});
