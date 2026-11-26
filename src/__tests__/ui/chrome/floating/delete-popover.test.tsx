// @vitest-environment jsdom
/** The delete question stands by what it asks about, and follows it while it stands; a pan or a zoom
 *  closes it (`map-surfaces.test.ts`). */
import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import { render, screen, cleanup, act, waitFor } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { DeletePopover } from '../../../../ui/chrome/floating/DeletePopover';
import { useEditorStore } from '../../../../state/store';
import { __resetUiZoomAnim } from '../../../../ui/design/ui-zoom-anim';
import { I18nProvider } from '../../../../i18n/context';
import { EventBus } from '../../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../../rules';
import { __setCatalogItem } from '../../../../state/catalog';
import { CommandType, type PlacedObject } from '../../../../core/model/types';
import type { EditorEvents } from '../../../../state/editing/events';
import { makeState } from '../../../_support/map-state';
import { setActiveView } from '../../../../view/active-view';
import type { ActiveView } from '../../../../tools/pointer/runtime';
import { createExecutor } from '../../../../state/executor';
import { ItemCategory } from '../../../../config/catalog/categories';
import { headlessViewVerbs } from '../../../_support/tool-manager';
import { HEADLESS_OVERLAY } from '../../../../tools/pointer/runtime/host';
import { resetStore } from '../../../_support/store';

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
afterEach(() => {
  cleanup();
  setActiveView(null);
  resetStore();
});

__setCatalogItem({
  id: 'dp-hut', category: ItemCategory.Building, name: { en: 'dp-hut' },
  width: 1, height: 1, loadValue: 0, rotatable: true, placementMode: 'point', traits: [],
});

/** A linear view whose offset the test moves. */
function panningView(pan: { x: number; y: number }, scale = 20): ActiveView {
  return {
    projection: {
      cellToScreen: (x: number, y: number) => ({ x: x * scale + pan.x, y: y * scale + pan.y, scale }),
      screenToPoint: () => ({ x: 0, y: 0 }),
    },
    overlay: HEADLESS_OVERLAY,
    ...headlessViewVerbs(),
  } as unknown as ActiveView;
}

const question = () => screen.getByRole('dialog', { hidden: true });
const leftOf = (el: HTMLElement) => parseFloat(el.style.left);

describe('the delete question', () => {
  it('follows its object when the view re-anchors what it shows under a still camera', async () => {
    const gs = makeState(24, 24);
    const eventBus = new EventBus<EditorEvents>();
    const exec = createExecutor(gs, createDefaultRegistry(), eventBus);
    const object: PlacedObject = { id: 'hut', catalogId: 'dp-hut', position: { x: 10, y: 10 }, rotation: 0, elevation: 0 };
    expect(exec.execute({ type: CommandType.PlaceObject, object }).success).toBe(true);
    const pan = { x: 100, y: 100 };
    setActiveView(panningView(pan));
    useEditorStore.setState({ gridState: gs, commandExecutor: exec, eventBus, locale: 'en', tourRunning: false });
    render(<MotionConfig reducedMotion="always"><I18nProvider><DeletePopover /></I18nProvider></MotionConfig>);
    act(() => { useEditorStore.getState().setDeletePopover({ kind: 'object', id: 'hut' }); });
    await waitFor(() => expect(Number.isFinite(leftOf(question())) && leftOf(question()) > 0).toBe(true));
    const before = leftOf(question());

    // The 3D view re-anchors its chrome when the map's room changes under it, the object now drawn 200 px on.
    act(() => {
      pan.x += 200;
      eventBus.emit('viewport-changed', { zoom: 1, content: true });
    });
    await waitFor(() => expect(leftOf(question()) - before).toBeCloseTo(200, 0));
  });
});
