// @vitest-environment jsdom
/**
 * The rotate shortcut turning the placement ghost, through `editor/commands/commands.ts`'s
 * `rotateArmedOrSelected`, the dispatcher a key press reaches. `placement-rotation-resample` sets the
 * store field directly, so a dispatcher that swallowed the armed case would leave it green.
 *
 * Nothing selected turns the ghost; a standing selection takes the rotation (clicking an object
 * while an item is armed exists to turn it without disarming); a non-rotatable item is a silent
 * no-op that leaves no rotation behind. Ramps and bridges are non-rotatable: the trait snaps their
 * orientation from the cliff or gap.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useRef } from 'react';
import { usePointerInteraction } from '../../../view/interaction/use-pointer-interaction';
import { registerToolManager, setActiveView } from '../../../view/active-view';
import { __resetCursorController } from '../../../view/interaction/cursor-controller';
import type { ActiveView } from '../../../tools/pointer/runtime';
import { type GridState, type PlacedObject } from '../../../core/model/types';
import { ToolType } from '../../../state/editing/vocabulary';
import { bumpObjectsVersion } from '../../../core/model/grid-model';
import { useEditorStore } from '../../../state/store';
import { createDefaultRegistry } from '../../../rules/index';
import { ToolManager } from '../../../tools/pointer/runtime/tool-manager';
import { makeStubView } from '../../_support/tool-manager';
import { makeState } from '../../_support/map-state';
import { setStoreState, armedEditMode } from '../../_support/store';
import { COMMAND_BY_ID, type CommandContext } from '../../../editor/commands/commands';
import { createExecutor } from '../../../state/executor';
import { editorToolWiring } from '../../../editor/session/tool-wiring';

const ROTATABLE = 'building-stall';  // rotatable, flat, 1x1
const RAMP = 'ramp-teak-stair';      // rotatable: false — the trait owns its orientation

function makeView() {
  const overlay = {
    showGhost: vi.fn(), showGhostSpans: vi.fn(), clearGhost: vi.fn(),
    showSelection: vi.fn(), clearSelection: vi.fn(),
    showHover: vi.fn(), clearHover: vi.fn(), flashCommit: vi.fn(),
    showBuildableRegion: vi.fn(), clearBuildableRegion: vi.fn(),
    showBand: vi.fn(), clearBand: vi.fn(), showPlacementGhost: vi.fn(), showGroupPlacementGhost: vi.fn(),
  };
  const view = {
    projection: {
      screenToPoint: (sx: number, sy: number) => ({ x: sx / 10, y: sy / 10 }),
            cellToScreen: (x: number, y: number) => ({ x: x * 10, y: y * 10, scale: 1 }),
    },
    overlay, camera: { pan: vi.fn(), zoomStep: vi.fn(), zoomBy: vi.fn() },
    plopObject: vi.fn(),
  } as unknown as ActiveView;
  return { view, overlay };
}

function Host() {
  const ref = useRef<HTMLDivElement>(null);
  usePointerInteraction(ref);
  return <div ref={ref} data-testid="canvas" style={{ width: 400, height: 300 }} />;
}

function pointer(type: string, init: MouseEventInit): MouseEvent {
  return new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
}

/** What a key press runs: the registry's own body, not a store write. */
function pressRotate(): void {
  COMMAND_BY_ID.get('selection.rotate_cw')!.run({} as CommandContext);
}

let el: HTMLElement;
let gs: GridState;
let overlay: ReturnType<typeof makeView>['overlay'];

function arm(itemId: string, objects: PlacedObject[] = []): void {
  gs = makeState(20, 20);
  for (const o of objects) gs.objects.set(o.id, o);
  if (objects.length) bumpObjectsVersion(gs, { added: objects });
  const executor = createExecutor(gs, createDefaultRegistry(), useEditorStore.getState().eventBus);
  const tm = new ToolManager(makeStubView(), executor, gs, editorToolWiring());
  const made = makeView();
  overlay = made.overlay;
  setActiveView(made.view);
  registerToolManager(tm);
  tm.setActiveTool(ToolType.ObjectPlacer);
  setStoreState({
    gridState: gs, commandExecutor: executor, placementRotation: 0, selection: [], selectingRegion: false,
    contextMenu: null, ...armedEditMode({ tool: ToolType.ObjectPlacer, item: itemId }),
  });
  // One real pointer move, so the machine has a position to resample from.
  el.dispatchEvent(pointer('pointermove', { buttons: 0, clientX: 55, clientY: 55 }));
  overlay.showPlacementGhost.mockClear();
}

const lastGhostRotation = (): unknown => {
  const calls = overlay.showPlacementGhost.mock.calls;
  return calls[calls.length - 1]?.[0]?.rotation;
};

beforeEach(() => {
  __resetCursorController();
  const { getByTestId } = render(<Host />);
  el = getByTestId('canvas');
});

afterEach(() => {
  cleanup();
  setActiveView(null);
  registerToolManager(null);
  setStoreState({ placementRotation: 0, selection: [] });
  __resetCursorController();
});

describe('the rotate command with an item armed', () => {
  it('turns the ghost, with no pointer event behind the key', () => {
    arm(ROTATABLE);

    pressRotate();

    expect(useEditorStore.getState().placementRotation).toBe(90);
    expect(lastGhostRotation(), 'the ghost redrew at the new orientation').toBe(90);
  });

  it('turns it again, quarter by quarter, and wraps', () => {
    arm(ROTATABLE);

    for (const expected of [90, 180, 270, 0]) {
      pressRotate();
      expect(useEditorStore.getState().placementRotation).toBe(expected);
      expect(lastGhostRotation()).toBe(expected);
    }
  });

  it('leaves a non-rotatable item alone, storing no rotation for the next placement', () => {
    arm(RAMP);

    pressRotate();

    expect(useEditorStore.getState().placementRotation).toBe(0);
  });

  it('gives a standing selection the rotation instead of the ghost', () => {
    const tree: PlacedObject = { id: 't', catalogId: 'tree-apple', position: { x: 3, y: 3 }, rotation: 0, elevation: 0 };
    arm(ROTATABLE, [tree]);
    setStoreState({ selection: [{ kind: 'object', id: 't' }] });

    pressRotate();

    expect(useEditorStore.getState().placementRotation, 'the ghost keeps its orientation').toBe(0);
  });
});
