/** The shell slice's one-update actions: each replaces a sequence of setters. */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useEditorStore } from '../../../state/store';
import { PREFS } from '../../../platform/storage/prefs';
import { resetStore, setStoreModal, setStoreState } from '../../_support/store';
import type { MapAnnotation } from '../../../core/model/annotations';
import { getMapTemplate } from '../../../config/maps';
import { createDefaultRegistry } from '../../../rules';

const s = () => useEditorStore.getState();
/** A run standing in the second card's Show me, as its button opens it. */
const inShowMe = () => { s().startTour(2); s().setTourPhase({ kind: 'show', card: 1, step: 0 }); };

beforeEach(() => {
  resetStore();
  localStorage.removeItem(PREFS.tourSeen.key);
});

describe('About', () => {
  it('opens at a document, and the target is taken once', () => {
    s().openAbout('changelog');
    expect(s().modals.about).toBe(true);
    expect(s().takeAboutTarget()).toBe('changelog');
    expect(s().aboutTarget).toBeNull();
    expect(s().takeAboutTarget()).toBeNull();
  });
});

describe('Help', () => {
  it('opens at a target and ends the pick', () => {
    setStoreState({ whatsThis: true });
    s().openHelpAt({ page: 'notes', anchor: 'tags' });
    expect(s().helpTarget).toEqual({ page: 'notes', anchor: 'tags' });
    expect(s().whatsThis).toBe(false);
    expect(s().modals.help).toBe(true);
  });

  it("turning what's-this on closes Help; turning it off leaves Help alone", () => {
    setStoreModal('help');
    s().toggleWhatsThis();
    expect(s().whatsThis).toBe(true);
    expect(s().modals.help).toBe(false);
    setStoreModal('help');
    s().toggleWhatsThis();
    expect(s().whatsThis).toBe(false);
    expect(s().modals.help).toBe(true);
  });
});

describe('the tour', () => {
  it('[UI-50] records the version it runs as offered the moment it starts', () => {
    s().startTour(7);
    expect(s().tourRunning).toBe(true);
    expect(localStorage.getItem(PREFS.tourSeen.key)).toBe('7');
    s().finishTour();
    expect(s().tourRunning).toBe(false);
  });

  it('[UI-47] a Show me gives back the mode, view, window and the assistant the visitor opened, however the run ends', () => {
    s().setViewMode('2d');
    s().setEditMode({ mode: null });
    inShowMe();
    s().poseTour({ mode: 'mountain' });
    s().setTourPhase({ kind: 'show', card: 1, step: 1 });
    s().poseTour({ view: '3d', share: 'keep' });
    s().setAssistantOpen(true);
    expect(s().editMode.mode).toBe('mountain');
    expect(s().viewMode).toBe('3d');
    expect(s().modals.share).toBe(true);
    s().leaveShowMe();
    expect([s().editMode.mode, s().viewMode, s().assistantOpen, s().modals.share]).toEqual([null, '2d', false, false]);
    expect(s().tourPhase).toEqual({ kind: 'deck', card: 1 });
    s().setTourPhase({ kind: 'show', card: 1, step: 0 });
    s().poseTour({ mode: 'object', view: '3d' });
    s().finishTour();
    expect([s().editMode.mode, s().viewMode, s().tourBorrow]).toEqual([null, '2d', null]);
  });
});

describe('what a Show me borrows', () => {
  const editing = () => {
    const st = s();
    return {
      editMode: st.editMode, selection: st.selection, region: st.region, regionUndoLane: st.regionUndoLane, placementRotation: st.placementRotation,
      activeLayer: st.activeLayer, layerPinned: st.layerPinned,
    };
  };

  it('[UI-47] gives back the armed tool, the painted region with its undo lane, the turn and the layer exactly', () => {
    s().setEditMode({ mode: 'mountain', arm: { kind: 'shape', shape: 'rect' } });
    s().commitRegion([{ x: 1, y: 1 }]);
    s().setPlacementRotation(90);
    const before = editing();
    inShowMe();
    s().poseTour({ mode: 'object' });
    s().poseTour({ mode: null, view: '3d' });
    s().setActiveLayer(3);
    s().leaveShowMe();
    expect(editing()).toEqual(before);
  });

  it('[UI-47] gives back a selection a pose put away', () => {
    s().setEditMode({ mode: null });
    s().setSelection([{ kind: 'terrain', x: 2, y: 3 }]);
    const before = s().selection;
    inShowMe();
    s().poseTour({ mode: 'mountain' });
    expect(s().selection).toEqual([]);
    s().leaveShowMe();
    expect(s().selection).toEqual(before);
  });

  it('[UI-47] never asks to discard a note being written: no Show me starts over it', () => {
    s().setEditMode({ mode: null });
    setStoreState({ annotationDraft: { id: 'draft' } as MapAnnotation });
    inShowMe();
    s().poseTour({ mode: 'mountain', view: '3d' });
    expect(s().tourPhase).toEqual({ kind: 'deck', card: 0 });
    expect(s().editMode.mode).toBeNull();
    expect(s().annotationDiscardAction).toBeNull();
    setStoreState({ annotationDraft: null });
  });

  it('[UI-47] gives back whether the notes layer was shown and locked', () => {
    s().initMap(getMapTemplate('hexia'), createDefaultRegistry());
    s().setAnnotationsLocked(true);
    inShowMe();
    s().poseTour({ mode: 'mountain' });
    s().setAnnotationsVisible(false);
    s().setAnnotationsLocked(false);
    s().leaveShowMe();
    expect([s().gridState!.annotations!.visible, s().gridState!.annotations!.locked]).toEqual([true, true]);
  });

  it('[UI-47] gives back once, a listener hearing the give-back finding no Show me left to give back', () => {
    s().initMap(getMapTemplate('hexia'), createDefaultRegistry());
    s().setViewMode('2d');
    inShowMe();
    s().poseTour({ mode: 'mountain', view: '3d' });
    const executor = s().commandExecutor!;
    const returns = vi.spyOn(executor, 'returnTo');
    // Whatever listens to the map hears the give-back's return and reacts at once, as a Show me's
    // own watch does; so does anything subscribed to the store.
    const seen: string[] = [];
    const onCells = (): void => { seen.push(s().tourPhase.kind); s().leaveShowMe(); };
    s().eventBus.on('cells-changed', onCells);
    s().eventBus.on('history-changed', onCells);
    const off = useEditorStore.subscribe((next) => { if (next.tourBorrow) seen.push('borrow standing'); });
    s().leaveShowMe();
    s().eventBus.off('cells-changed', onCells);
    s().eventBus.off('history-changed', onCells);
    off();
    expect(returns).toHaveBeenCalledTimes(1);
    expect(seen.every((kind) => kind === 'deck')).toBe(true);
    expect([s().viewMode, s().tourBorrow, s().tourPhase]).toEqual(['2d', null, { kind: 'deck', card: 1 }]);
  });

  it('[UI-47] every way a run ends gives the borrow back once, and a new run never reuses a stale one', () => {
    s().setViewMode('2d');
    inShowMe();
    s().poseTour({ mode: 'mountain', view: '3d', share: 'keep' });
    s().setTourRunning(false);
    expect([s().editMode.mode, s().viewMode, s().modals.share, s().tourBorrow]).toEqual([null, '2d', false, null]);
    s().poseTour({ mode: 'water' });
    expect(s().editMode.mode).toBeNull();
    inShowMe();
    s().poseTour({ mode: 'water' });
    s().startTour(2);
    expect([s().editMode.mode, s().tourBorrow, s().tourPhase]).toEqual([null, null, { kind: 'deck', card: 0 }]);
  });
});

