/**
 * The rotate shortcut turning the placement GHOST, driven through the command registry rather than
 * a store write.
 *
 * `placement-rotation-resample.test.tsx` pins the half of this that lives in the pointer machine:
 * a `placementRotation` change under a stationary cursor redraws the ghost. It sets the store
 * field directly, so it says nothing about the DISPATCHER above it — `kit/commands.ts`'s
 * `rotateArmedOrSelected`, which chooses between the selection and the armed item's ghost and is
 * the only thing a key press actually reaches. A dispatcher that swallowed the armed case would
 * leave that test green and the ghost frozen.
 *
 * So this runs the command itself, and pins the choice it makes: nothing selected turns the ghost,
 * a standing selection takes the rotation instead (deliberate — clicking an object while an item
 * is armed exists so it can be turned without losing the arming), and a non-rotatable item is a
 * silent no-op that must not leave a rotation behind for the next placement to pick up. Every ramp
 * and bridge in the catalog is non-rotatable: their orientation is the trait's, snapped from the
 * cliff or gap they detect, so there is nothing for the key to do there.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useRef } from 'react';
import { usePointerInteraction } from '../../canvas/interaction/usePointerInteraction';
import { registerToolManager, setActiveView } from '../../canvas/active-view';
import { __resetCursorController } from '../../canvas/interaction/cursor-controller';
import type { ActiveView } from '../../canvas/view-projection';
import { ToolType, type GridState, type PlacedObject } from '../../core/model/types';
import { bumpObjectsVersion } from '../../core/model/grid-model';
import { useEditorStore } from '../../state/store';
import { CommandExecutor } from '../../core/commands/command-executor';
import { createDefaultRegistry } from '../../rules/index';
import { ToolManager } from '../../tools/tool-manager';
import { makeStubRenderer } from '../tools/_tool-manager';
import { makeState } from '../rules/_helpers';
import { setStoreState } from '../_store';
import { roadLookup } from '../../state/object-index';
import { COMMAND_BY_ID, type CommandContext } from '../../kit/commands';

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
      screenToMacro: (sx: number, sy: number) => ({ x: Math.floor(sx / 10), y: Math.floor(sy / 10) }),
      screenToMicro: (sx: number, sy: number) => ({ x: sx / 10, y: sy / 10 }),
      cellToScreen: (x: number, y: number) => ({ x: x * 10, y: y * 10, scale: 1 }),
      pan: vi.fn(),
    },
    overlay, camera: { pan: vi.fn(), zoomStep: vi.fn(), zoomBy: vi.fn() },
    applyCameraTransform: vi.fn(), plopObject: vi.fn(), leftDragPans: true,
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
  const executor = new CommandExecutor(gs, useEditorStore.getState().eventBus, createDefaultRegistry(), roadLookup(gs));
  const tm = new ToolManager(makeStubRenderer(), executor, gs);
  const made = makeView();
  overlay = made.overlay;
  setActiveView(made.view);
  registerToolManager(tm);
  tm.setActiveTool(ToolType.ObjectPlacer);
  setStoreState({
    gridState: gs, commandExecutor: executor, activeTool: ToolType.ObjectPlacer,
    selectedItemId: itemId, placementRotation: 0, selection: [], selectingRegion: false, contextMenu: null,
  });
  // One real pointer move, so the machine has a position to resample from.
  el.dispatchEvent(pointer('pointermove', { buttons: 0, clientX: 55, clientY: 55 }));
  overlay.showPlacementGhost.mockClear();
}

const lastGhostRotation = (): unknown => {
  const calls = overlay.showPlacementGhost.mock.calls;
  return calls[calls.length - 1]?.[3];
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
