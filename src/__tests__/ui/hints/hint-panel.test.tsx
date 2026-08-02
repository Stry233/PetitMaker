import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import { setToastPresenter, type ToastType } from '../../../core/runtime/toast-bus';
import { I18nProvider } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { useKeybinds } from '../../../ui/keybindings/store';
import { ItemCategory, TerrainType, ToolType } from '../../../core/model/types';
import type { GridState, PlacedObject } from '../../../core/model/types';
import { registerCatalogItem } from '../../../state/catalog';
import { makeState, setTerrain } from '../../rules/_helpers';
import { setActiveView } from '../../../canvas/active-view';
import type { ActiveView } from '../../../canvas/view-projection';
import { CARD_CHROME, cardHeightTarget, HintPanel } from '../../../ui/hints/HintPanel';

registerCatalogItem({
  id: 'hint-hut', category: ItemCategory.Building, name: { en: 'hint-hut' },
  width: 1, height: 1, loadValue: 0, rotatable: true, placementMode: 'point', traits: [],
});

/** A map with a mountain cell at (1,1), an unlocked hut at (3,3) and the locked plaza at (5,5).
 *  Bare ground is everywhere else, so (9,9) is a selectable cell with nothing to remove. */
function seedMap(): GridState {
  const gs = makeState(16, 16);
  setTerrain(gs, 1, 1, TerrainType.Mountain, 1);
  const put = (o: PlacedObject) => gs.objects.set(o.id, o);
  put({ id: 'hut', catalogId: 'hint-hut', position: { x: 3, y: 3 }, rotation: 0, elevation: 0 });
  put({ id: 'plaza', catalogId: 'hint-hut', position: { x: 5, y: 5 }, rotation: 0, elevation: 0, locked: true });
  return gs;
}

const mount = () => render(<I18nProvider><HintPanel /></I18nProvider>);

/** A view whose camera orbits and dollies, which is what makes it the 3D one as far as the panel
 *  is concerned. Nothing else of the view contract is reached. */
const orbitView = {
  projection: {} as ActiveView['projection'],
  overlay: {} as ActiveView['overlay'],
  applyCameraTransform: () => {},
  camera: { pan: () => {}, zoomStep: () => {}, zoomBy: () => {}, orbit: () => {}, wheelZooms: true },
} as unknown as ActiveView;

describe('HintPanel', () => {
  // In act, because clearing the view is a state change in any panel still mounted.
  afterEach(() => { act(() => { setActiveView(null); }); });

  beforeEach(() => {
    localStorage.clear();
    useKeybinds.getState().resetAll();
    useEditorStore.setState({
      hintLevel: 'full', viewMode: '2d', activeTool: ToolType.Hand, designMode: 'hand',
      selection: [], selectedItemId: null, selectingRegion: false,
      tourRunning: false, portraitBlocked: false, gridState: seedMap(),
    });
  });

  it('shows the 2d map rows by default', () => {
    mount();
    expect(screen.getByText('Move the map')).toBeTruthy();
    expect(screen.getByText('Select several objects')).toBeTruthy();
  });

  // The rows swap through AnimatePresence mode="wait", so the outgoing block is still mounted for
  // its exit: the assertions wait for the swap rather than for the next paint.
  it('switches rows when the scenario changes', async () => {
    mount();
    act(() => useEditorStore.setState({ activeTool: ToolType.Eraser, designMode: 'eraser' }));
    await waitFor(() => expect(screen.getByText('Lower terrain, layer by layer')).toBeTruthy());
    expect(screen.queryByText('Select several objects')).toBeNull();
  });

  // The card leaves through an exit animation, so every "it is gone" below is awaited.
  it('concise keeps three rows, off renders nothing', async () => {
    mount();
    act(() => useEditorStore.setState({ hintLevel: 'concise' }));
    await waitFor(() => expect(screen.queryByText('Select several objects')).toBeNull());
    expect(screen.getByText('Move the map')).toBeTruthy();
    act(() => useEditorStore.setState({ hintLevel: 'off' }));
    await waitFor(() => expect(screen.queryByText('Move the map')).toBeNull());
  });

  it('a rebind re-renders the caps', () => {
    mount();
    act(() => { useKeybinds.getState().rebind('camera.pan_up', 'i'); });
    expect(screen.getAllByText('IASD').length).toBeGreaterThan(0);
  });

  it('hides under the tour and the portrait block', async () => {
    mount();
    act(() => useEditorStore.setState({ tourRunning: true }));
    await waitFor(() => expect(screen.queryByText('Move the map')).toBeNull());
    act(() => useEditorStore.setState({ tourRunning: false, portraitBlocked: true }));
    await waitFor(() => expect(screen.queryByText('Move the map')).toBeNull());
  });

  // The 3D scene builds lazily, so `viewMode` flips well before the view that can orbit exists.
  // The hints follow the VIEW, so they keep describing what a drag does right now.
  it('waits for the 3D view itself, not the store flip', async () => {
    useEditorStore.setState({ viewMode: '3d' });
    mount();
    expect(screen.getByText('Move the map')).toBeTruthy();
    expect(screen.queryByText('Spin around the map')).toBeNull();

    act(() => { setActiveView(orbitView); });
    await waitFor(() => expect(screen.getByText('Spin around the map')).toBeTruthy());
    expect(screen.getByText('Move closer or farther')).toBeTruthy();
    expect(screen.getByText('Turn left and right')).toBeTruthy();
  });

  // The selection rows must describe the thing that is selected, not the last one that was.
  it('a selected object offers the object rows', async () => {
    mount();
    act(() => useEditorStore.setState({ selection: [{ kind: 'object', id: 'hut' }] }));
    await waitFor(() => expect(screen.getByText('Move it')).toBeTruthy());
  });

  it('a selected terrain cell offers to remove the terrain, not to rotate it', async () => {
    mount();
    act(() => useEditorStore.setState({ selection: [{ kind: 'terrain', x: 1, y: 1 }] }));
    await waitFor(() => expect(screen.getByText('Remove this terrain')).toBeTruthy());
    expect(screen.getByText('Deselect')).toBeTruthy();
    expect(screen.queryByText('Rotate')).toBeNull();
    expect(screen.queryByText('Move it')).toBeNull();
    // The terrain context menu holds Delete alone, which the first row already names.
    expect(screen.queryByText('More options')).toBeNull();
  });

  // A locked object refuses every edit the selection rows name, and bare ground has nothing to
  // remove: both leave the panel to the tool the user is holding.
  // Each leg starts from the object rows, so the assertion is a real swap away from them rather
  // than a state the panel was already in.
  it('a locked object and bare ground show the map rows instead', async () => {
    mount();
    for (const inert of [{ kind: 'object', id: 'plaza' }, { kind: 'terrain', x: 9, y: 9 }] as const) {
      act(() => useEditorStore.setState({ selection: [{ kind: 'object', id: 'hut' }] }));
      await waitFor(() => expect(screen.getByText('Move it')).toBeTruthy());

      act(() => useEditorStore.setState({ selection: [inert] }));
      await waitFor(() => expect(screen.queryByText('Move it')).toBeNull());
      expect(screen.getByText('Move the map')).toBeTruthy();
      expect(screen.queryByText('Remove this terrain')).toBeNull();
    }
  });

  it('hides while a modal is open', async () => {
    mount();
    act(() => useEditorStore.getState().setModal('settings', true));
    await waitFor(() => expect(screen.queryByText('Move the map')).toBeNull());
    act(() => useEditorStore.getState().setModal('settings', false));
    expect(screen.getByText('Move the map')).toBeTruthy();
  });
});

// The two corner buttons are the panel's own writers of `hintLevel`, the same field the Settings
// row writes. Each test drives the real store and reads it back, so a second piece of state
// standing in for the level would fail here rather than drift quietly.
describe('HintPanel corner buttons', () => {
  afterEach(() => { act(() => { setActiveView(null); }); });

  beforeEach(() => {
    localStorage.clear();
    useKeybinds.getState().resetAll();
    useEditorStore.setState({
      hintLevel: 'full', viewMode: '2d', activeTool: ToolType.Hand, designMode: 'hand',
      selection: [], selectedItemId: null, selectingRegion: false,
      tourRunning: false, portraitBlocked: false, gridState: seedMap(),
    });
  });

  it('collapses to the top three rows and expands back, swapping its own label', async () => {
    mount();
    expect(screen.getByText('Select several objects')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Show fewer hints' }));
    expect(useEditorStore.getState().hintLevel).toBe('concise');
    await waitFor(() => expect(screen.queryByText('Select several objects')).toBeNull());
    expect(screen.queryByText('Zoom smoothly')).toBeNull();
    expect(screen.getByText('Move the map')).toBeTruthy();
    expect(screen.getByText('Move slowly')).toBeTruthy();
    expect(screen.getByText('Double-tap to move fast')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Show all hints' }));
    expect(useEditorStore.getState().hintLevel).toBe('full');
    await waitFor(() => expect(screen.getByText('Select several objects')).toBeTruthy());
  });

  // 'off' takes the panel off screen, so the toast is the only thing left to say where the hints
  // went. The card leaves through its own exit, so the DOM check is awaited, not immediate.
  it('closing turns hints off, takes the panel away and says where they went', async () => {
    const seen: Array<[string, ToastType]> = [];
    const release = setToastPresenter((text, type) => { seen.push([text, type]); });
    try {
      mount();
      fireEvent.click(screen.getByRole('button', { name: 'Turn off quick hints' }));
      expect(useEditorStore.getState().hintLevel).toBe('off');
      expect(seen).toEqual([['Quick hints are off. Settings brings them back.', 'info']]);
      await waitFor(() => expect(screen.queryByRole('note')).toBeNull());
      expect(screen.queryByText('Move the map')).toBeNull();
    } finally {
      release();
    }
  });

  // The card animates away rather than blinking out, so it is still on screen for the frame after
  // the click. That is the tell that the presence wrapper is doing its job.
  it('the card is still there for its exit, then gone', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Turn off quick hints' }));
    expect(screen.getByRole('note')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('note')).toBeNull());
  });

  // Suppression rides the same exit, which is why the modal check below is awaited too.
  it('a modal takes the panel away through the same exit', async () => {
    mount();
    act(() => useEditorStore.getState().setModal('settings', true));
    await waitFor(() => expect(screen.queryByRole('note')).toBeNull());
    act(() => useEditorStore.getState().setModal('settings', false));
    expect(screen.getByText('Move the map')).toBeTruthy();
  });

  // A quiet glyph still needs a target a fingertip can land on. The visible mark stays 14px; the
  // box around it is what the user actually clicks, and it is held to the 24px floor here.
  it('each button carries a comfortable hit target, clear of the card edge', () => {
    mount();
    for (const name of ['Show fewer hints', 'Turn off quick hints']) {
      const btn = screen.getByRole('button', { name });
      expect(parseFloat(btn.style.width)).toBeGreaterThanOrEqual(24);
      expect(parseFloat(btn.style.height)).toBeGreaterThanOrEqual(24);
      expect(parseFloat(btn.style.top)).toBeGreaterThanOrEqual(8);
      const side = btn.style.left || btn.style.right;
      expect(parseFloat(side)).toBeGreaterThanOrEqual(8);
    }
  });

  // The buttons are the only thing on the card a pointer may reach: a brush drag that starts over
  // the card has to land on the map underneath it.
  it('the card stays pointer-transparent and only the buttons take a pointer', () => {
    mount();
    const card = screen.getByRole('note');
    expect(card.parentElement?.style.pointerEvents).toBe('none');
    for (const name of ['Show fewer hints', 'Turn off quick hints']) {
      expect(screen.getByRole('button', { name }).style.pointerEvents).toBe('auto');
    }
  });

  // A level change is the SAME list with its tail hidden, so nothing may remount: the card resizes
  // and the tail fades under it. Node identity is the assertion, since a remount is exactly what
  // would run the scenario slide over a change that is not a scenario change.
  it('a level change resizes in place, remounting neither the card nor the kept rows', async () => {
    mount();
    const card = screen.getByRole('note');
    const firstRow = screen.getByText('Move the map');

    fireEvent.click(screen.getByRole('button', { name: 'Show fewer hints' }));
    await waitFor(() => expect(screen.queryByText('Select several objects')).toBeNull());
    expect(screen.getByRole('note')).toBe(card);
    expect(screen.getByText('Move the map')).toBe(firstRow);

    fireEvent.click(screen.getByRole('button', { name: 'Show all hints' }));
    await waitFor(() => expect(screen.getByText('Select several objects')).toBeTruthy());
    expect(screen.getByText('Move the map')).toBe(firstRow);
  });

  // The other half of the same contract: a SCENARIO change does replace the rows, and only them.
  it('a scenario change still replaces the rows, on the same card', async () => {
    mount();
    const card = screen.getByRole('note');
    const firstRow = screen.getByText('Move the map');

    act(() => useEditorStore.setState({ activeTool: ToolType.Eraser, designMode: 'eraser' }));
    await waitFor(() => expect(screen.getByText('Lower terrain, layer by layer')).toBeTruthy());
    // The eraser list names the same outcome in a row of its own, so this is a different node
    // carrying the same words, which is precisely what a wholesale replacement looks like.
    expect(screen.getByText('Move the map')).not.toBe(firstRow);
    expect(screen.getByRole('note')).toBe(card);
  });

  // The buttons sit in a deepened top padding band, so the card is taller than its rows. The band
  // has to be a term of the HEIGHT TARGET as well as of the CSS padding, or the spring lands the
  // card on a height with no room for the thing the band exists for. These two pin the halves: the
  // arithmetic counts the chrome, and the rendered padding is exactly that same chrome.
  it('the height target counts the button band, not the rows alone', () => {
    expect(cardHeightTarget(100, 0)).toBe(CARD_CHROME + 100);
    // The gap between the two blocks belongs to the tail, and only when there is one.
    expect(cardHeightTarget(100, 60)).toBe(cardHeightTarget(100, 0) + 60 + 8);
  });

  it('the card renders exactly the padding the target counts', () => {
    mount();
    const pad = screen.getByRole('note').style.padding.split(' ').map(parseFloat);
    expect(pad[0]! + pad[2]!).toBe(CARD_CHROME);
  });
});
