// @vitest-environment jsdom
/**
 * The selection card holds still across repeated group rotations: the half-cell snap `rotationPivot`
 * applies flips direction with the box's aspect, so placing from the live bounds would make the card
 * creep. It still follows a group move and recomputes when the membership changes.
 */
import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { SelectionCard } from '../../../../ui/chrome/floating/SelectionCard';
import { useEditorStore } from '../../../../state/store';
import { __resetUiZoomAnim } from '../../../../ui/design/ui-zoom-anim';
import { I18nProvider } from '../../../../i18n/context';
import { EventBus } from '../../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../../rules';
import { __setCatalogItem } from '../../../../state/catalog';
import { CommandType } from '../../../../core/model/types';
import type { PlacedObject } from '../../../../core/model/types';
import type { EditorEvents } from '../../../../state/editing/events';
import { makeState } from '../../../_support/map-state';
import { setActiveView } from '../../../../view/active-view';
import type { ActiveView } from '../../../../tools/pointer/runtime';
import { moveGroup } from '../../../../tools/objects/group-actions';
import { createExecutor } from '../../../../state/executor';
import { ItemCategory } from '../../../../config/catalog/categories';
import { headlessViewVerbs } from '../../../_support/tool-manager';
import { HEADLESS_OVERLAY } from '../../../../tools/pointer/runtime/host';

// The reference window at 100%, where the chrome draws at 1, so the pixel arithmetic below is exact.
const WINDOW = { w: window.innerWidth, h: window.innerHeight };
beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
  useEditorStore.getState().setUiZoom(1);
  __resetUiZoomAnim();
});
afterAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: WINDOW.w });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: WINDOW.h });
});

__setCatalogItem({
  id: 'gra-hut', category: ItemCategory.Building, name: { en: 'gra-hut' },
  width: 1, height: 1, loadValue: 0, rotatable: true, placementMode: 'point', traits: [],
});

function Wrapper({ children }: { children: React.ReactNode }) {
  return <I18nProvider>{children}</I18nProvider>;
}

/** Linear ViewProjection double, matching the one `selection-card.test.tsx` uses. */
function makeView(dx: number, dy: number, scale = 10): ActiveView {
  return {
    projection: {
      cellToScreen: (x: number, y: number) => ({ x: x * scale + dx, y: y * scale + dy, scale }),
      screenToPoint: () => ({ x: 0, y: 0 }),
    },
    overlay: HEADLESS_OVERLAY,
    ...headlessViewVerbs(),
  } as unknown as ActiveView;
}

interface Spec { id: string; x: number; y: number }

/** Builds the executor on the store's own eventBus, as `state/store.ts` does, so `objects-changed`
 *  reaches the listener SelectionCard subscribes through. */
function renderWithGroup(specs: Spec[]) {
  const gs = makeState(24, 24);
  const eventBus = new EventBus<EditorEvents>();
  const exec = createExecutor(gs, createDefaultRegistry(), eventBus);
  for (const s of specs) {
    const object: PlacedObject = {
      id: s.id, catalogId: 'gra-hut', position: { x: s.x, y: s.y },
      rotation: 0, elevation: 0,
    };
    const res = exec.execute({ type: CommandType.PlaceObject, object });
    expect(res.success).toBe(true);
  }
  useEditorStore.setState({
    gridState: gs, commandExecutor: exec, eventBus,
    selection: specs.map((s) => ({ kind: 'object', id: s.id }) as const),
    locale: 'en',
  });
  return { gs, exec, eventBus, ...render(<SelectionCard />, { wrapper: Wrapper }) };
}

// A card for the previous membership may still be leaving; the newest one is the live card.
const box = () => screen.getAllByTestId('selection-card').slice(-1)[0]!;

afterEach(() => {
  cleanup();
  setActiveView(null);
  useEditorStore.setState({ gridState: null, commandExecutor: null, selection: [], viewMode: '2d' });
});

describe('the selection card across a group rotation burst', () => {
  it('does not move across four rotate-button clicks, even though the raw bounds centre alternates', () => {
    // A 2x1 box: `rotationPivot`'s half-cell nudge flips direction every turn (the "off the lattice"
    // case of group-rotate.test.ts).
    setActiveView(makeView(0, 0, 10));
    renderWithGroup([{ id: 'a', x: 4, y: 4 }, { id: 'b', x: 5, y: 4 }]);
    const before = { left: box().style.left, bottom: box().style.bottom };
    for (let i = 0; i < 4; i++) {
      fireEvent.click(screen.getByTestId('handle-rotate'));
      expect(box().style.left, `after rotation ${i + 1}`).toBe(before.left);
      expect(box().style.bottom, `after rotation ${i + 1}`).toBe(before.bottom);
    }
    // Four turns did happen and returned the members home.
    const gs = useEditorStore.getState().gridState!;
    expect(gs.objects.get('a')!.position).toEqual({ x: 4, y: 4 });
    expect(gs.objects.get('b')!.position).toEqual({ x: 5, y: 4 });
  });

  it('does not move across a burst of odd-extent rotations either (3 members in a row)', () => {
    setActiveView(makeView(0, 0, 10));
    renderWithGroup([{ id: 'a', x: 4, y: 4 }, { id: 'b', x: 5, y: 4 }, { id: 'c', x: 6, y: 4 }]);
    const before = { left: box().style.left, bottom: box().style.bottom };
    for (let i = 0; i < 3; i++) {
      fireEvent.click(screen.getByTestId('handle-rotate'));
      expect(box().style.left).toBe(before.left);
      expect(box().style.bottom).toBe(before.bottom);
    }
  });

  it('still follows a genuine group MOVE', () => {
    // Offset clear of jsdom's 1024x768 viewport edge so `placeSelectionCard`'s clamp never engages.
    setActiveView(makeView(300, 300, 10));
    const { gs, exec } = renderWithGroup([{ id: 'a', x: 4, y: 4 }, { id: 'b', x: 5, y: 4 }]);
    const before = { left: parseFloat(box().style.left), bottom: parseFloat(box().style.bottom) };
    let res!: ReturnType<typeof moveGroup>;
    act(() => { res = moveGroup(exec, gs, ['a', 'b'], { dx: 3, dy: 0 }); });
    expect(res.blockedBy).toBeNull();
    const after = { left: parseFloat(box().style.left), bottom: parseFloat(box().style.bottom) };
    expect(after.left - before.left).toBeCloseTo(30, 5);
    expect(after.bottom - before.bottom).toBeCloseTo(0, 5);
  });

  it('recomputes when the membership changes (a different group, not the one that rotated)', () => {
    setActiveView(makeView(0, 0, 10));
    const { gs, exec } = renderWithGroup([{ id: 'a', x: 4, y: 4 }, { id: 'b', x: 5, y: 4 }]);
    fireEvent.click(screen.getByTestId('handle-rotate'));
    const rotatedLeft = box().style.left;
    act(() => {
      const object: PlacedObject = {
        id: 'far', catalogId: 'gra-hut', position: { x: 18, y: 18 }, rotation: 0,
        elevation: 0,
      };
      exec.execute({ type: CommandType.PlaceObject, object });
      useEditorStore.setState({
        selection: [{ kind: 'object', id: 'a' }, { kind: 'object', id: 'far' }],
      });
    });
    expect(gs.objects.has('far')).toBe(true);
    expect(box().style.left).not.toBe(rotatedLeft);
  });
});
