/**
 * The group control row's anchor must hold STILL across repeated rotations: a quarter turn returns
 * every member to the same footprint bounds, but the half-cell lattice snap `rotationPivot` applies
 * flips direction with the box's aspect (see group-rotate.test.ts's "off the lattice" case), so
 * recomputing the anchor from the live bounds on every `objects-changed` made the row creep. It must
 * still follow a genuine group MOVE, and still recompute when the membership itself changes.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { SelectionHandles } from '../../ui/chrome/SelectionHandles';
import { useEditorStore } from '../../state/store';
import { I18nProvider } from '../../i18n/context';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules/index';
import { registerCatalogItem } from '../../state/catalog';
import { CommandType, ItemCategory } from '../../core/model/types';
import type { EditorEvents, PlacedObject } from '../../core/model/types';
import { makeState } from '../rules/_helpers';
import { setActiveView } from '../../canvas/active-view';
import type { ActiveView } from '../../canvas/view-projection';
import { moveGroup } from '../../ui/chrome/group-actions';

// A fixed chrome scale (like `selection-handles.test.tsx`) so the pixel arithmetic below is exact
// instead of whatever `useMenuScale` derives from jsdom's default viewport.
vi.mock('../../ui/menu/scale', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../ui/menu/scale')>();
  return { ...actual, useChromeScale: () => 1 };
});

registerCatalogItem({
  id: 'gra-hut', category: ItemCategory.Building, name: { en: 'gra-hut' },
  width: 1, height: 1, loadValue: 0, rotatable: true, placementMode: 'point', traits: [],
});

function Wrapper({ children }: { children: React.ReactNode }) {
  return <I18nProvider>{children}</I18nProvider>;
}

/** Linear ViewProjection double, matching the one `selection-handles.test.tsx` uses. */
function makeView(dx: number, dy: number, scale = 10): ActiveView {
  return {
    projection: {
      cellToScreen: (x: number, y: number) => ({ x: x * scale + dx, y: y * scale + dy, scale }),
      screenToMacro: () => ({ x: 0, y: 0 }),
      screenToMicro: () => ({ x: 0, y: 0 }),
      pan: () => {},
    },
  } as unknown as ActiveView;
}

interface Spec { id: string; x: number; y: number }

/** Builds the executor with the STORE's own eventBus (as `state/store.ts` really does whenever it
 *  creates a CommandExecutor) so a command's `objects-changed` reaches the same listener
 *  SelectionHandles subscribes through — a second, disconnected bus would make every op invisible
 *  to the tracker, which is not how the app wires it. */
function renderWithGroup(specs: Spec[]) {
  const gs = makeState(24, 24);
  const eventBus = new EventBus<EditorEvents>();
  const exec = new CommandExecutor(gs, eventBus, createDefaultRegistry());
  for (const s of specs) {
    const object: PlacedObject = {
      id: s.id, catalogId: 'gra-hut', position: { x: s.x, y: s.y },
      rotation: 0, elevation: 0,
    };
    const res = exec.execute({ type: CommandType.PlaceObject, timestamp: 0, object, loadValue: 0 });
    expect(res.success).toBe(true);
  }
  useEditorStore.setState({
    gridState: gs, commandExecutor: exec, eventBus,
    selection: specs.map((s) => ({ kind: 'object', id: s.id }) as const),
    locale: 'en',
  });
  return { gs, exec, eventBus, ...render(<SelectionHandles />, { wrapper: Wrapper }) };
}

const box = () => screen.getByTestId('handle-delete').parentElement as HTMLElement;

afterEach(() => {
  cleanup();
  setActiveView(null);
  useEditorStore.setState({ gridState: null, commandExecutor: null, selection: [], viewMode: '2d' });
});

describe('the group row anchor across a rotation burst', () => {
  it('does not move across four rotate-button clicks, even though the raw bounds centre alternates', () => {
    // A 2x1 bounding box (two 1x1 members side by side): its true centre sits on a cell-edge
    // midpoint, so `rotationPivot`'s half-cell nudge direction flips every turn (the exact case
    // group-rotate.test.ts's "off the lattice" identity test exercises) — this is what used to creep.
    setActiveView(makeView(0, 0, 10));
    renderWithGroup([{ id: 'a', x: 4, y: 4 }, { id: 'b', x: 5, y: 4 }]);
    const before = { left: box().style.left, top: box().style.top };
    for (let i = 0; i < 4; i++) {
      fireEvent.click(screen.getByTestId('handle-rotate'));
      expect(box().style.left, `after rotation ${i + 1}`).toBe(before.left);
      expect(box().style.top, `after rotation ${i + 1}`).toBe(before.top);
    }
    // The rigid-body identity: four turns really did happen and returned the members home.
    const gs = useEditorStore.getState().gridState!;
    expect(gs.objects.get('a')!.position).toEqual({ x: 4, y: 4 });
    expect(gs.objects.get('b')!.position).toEqual({ x: 5, y: 4 });
  });

  it('does not move across a burst of odd-extent rotations either (3 members in a row)', () => {
    setActiveView(makeView(0, 0, 10));
    renderWithGroup([{ id: 'a', x: 4, y: 4 }, { id: 'b', x: 5, y: 4 }, { id: 'c', x: 6, y: 4 }]);
    const before = { left: box().style.left, top: box().style.top };
    for (let i = 0; i < 3; i++) {
      fireEvent.click(screen.getByTestId('handle-rotate'));
      expect(box().style.left).toBe(before.left);
      expect(box().style.top).toBe(before.top);
    }
  });

  it('still follows a genuine group MOVE', () => {
    // Offset well clear of the viewport edge (jsdom's default is 1024x768) so `placeControlRow`'s
    // clamp never engages — this test is about the anchor tracking the move, not the clamp.
    setActiveView(makeView(300, 300, 10));
    const { gs, exec } = renderWithGroup([{ id: 'a', x: 4, y: 4 }, { id: 'b', x: 5, y: 4 }]);
    const before = { left: parseFloat(box().style.left), top: parseFloat(box().style.top) };
    let res!: ReturnType<typeof moveGroup>;
    act(() => { res = moveGroup(exec, gs, ['a', 'b'], 3, 0); });
    expect(res.blockedBy).toBeNull();
    const after = { left: parseFloat(box().style.left), top: parseFloat(box().style.top) };
    // A pure x-shift of 3 cells at scale 10 moves the anchor by exactly 30 css px; y is untouched.
    expect(after.left - before.left).toBeCloseTo(30, 5);
    expect(after.top - before.top).toBeCloseTo(0, 5);
  });

  it('recomputes when the membership changes (a different group, not the one that rotated)', () => {
    setActiveView(makeView(0, 0, 10));
    const { gs, exec } = renderWithGroup([{ id: 'a', x: 4, y: 4 }, { id: 'b', x: 5, y: 4 }]);
    fireEvent.click(screen.getByTestId('handle-rotate'));
    const rotatedLeft = box().style.left;
    // Swap in a far-away third member and select [a, far] instead of [a, b]: membership changed, so
    // the anchor must jump to the new centre rather than stay pinned to the old frozen point.
    act(() => {
      const object: PlacedObject = {
        id: 'far', catalogId: 'gra-hut', position: { x: 18, y: 18 }, rotation: 0,
        elevation: 0,
      };
      exec.execute({ type: CommandType.PlaceObject, timestamp: 0, object, loadValue: 0 });
      useEditorStore.setState({
        selection: [{ kind: 'object', id: 'a' }, { kind: 'object', id: 'far' }],
      });
    });
    expect(gs.objects.has('far')).toBe(true);
    expect(box().style.left).not.toBe(rotatedLeft);
  });
});
