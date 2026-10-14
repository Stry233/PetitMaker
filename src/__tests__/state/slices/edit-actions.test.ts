/** The edit slice's policies that ride inside one update: the session's modes, a floor press leaving
 *  annotate, and a region request moving the tool it does not offer. */
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '../../../state/store';
import { modeOpenIn, modesInSession } from '../../../state/editing/edit-mode';
import { SESSION_BUILD_MODES, type PlanetSession } from '../../../state/slices/planet-session';
import type { MapAnnotation } from '../../../core/model/annotations';
import { resetStore, setStoreState } from '../../_support/store';

const s = () => useEditorStore.getState();
const session = { entryId: null, name: '', nameReviewed: true } as unknown as PlanetSession;

beforeEach(resetStore);

describe('a planet session offers its own modes', () => {
  it('lists them only inside a session', () => {
    expect(modesInSession(null)).toBeNull();
    expect(modesInSession(session)).toEqual(SESSION_BUILD_MODES);
  });

  it('keeps rest and the notes layer open in a session', () => {
    expect(modeOpenIn(session, null)).toBe(true);
    expect(modeOpenIn(session, 'annotate')).toBe(true);
    expect(modeOpenIn(session, 'road')).toBe(false);
    expect(modeOpenIn(null, 'road')).toBe(true);
  });

  it('setEditMode ignores a mode the session does not offer and keeps rest open', () => {
    setStoreState({ planetSession: session });
    s().setEditMode({ mode: 'water' });
    for (const mode of ['road', 'generate'] as const) {
      s().setEditMode({ mode });
      expect(s().editMode.mode).toBe('water');
    }
    s().setEditMode({ mode: null });
    expect(s().editMode.mode).toBeNull();
  });

  it('outside a session every mode arms', () => {
    s().setEditMode({ mode: 'road' });
    expect(s().editMode.mode).toBe('road');
  });
});

describe('selectLayer', () => {
  it('stands annotate down in the same update', () => {
    s().setEditMode({ mode: 'annotate' });
    let updates = 0;
    const off = useEditorStore.subscribe(() => { updates++; });
    s().selectLayer(2);
    off();
    expect(updates).toBe(1);
    expect(s().editMode.mode).toBeNull();
    expect(s().activeLayer).toBe(2);
    expect(s().layerPinned).toBe(true);
  });

  it('with a draft open asks before leaving annotate, and chooses the floor either way', () => {
    s().setEditMode({ mode: 'annotate' });
    setStoreState({ annotationDraft: { id: 'draft' } as MapAnnotation });
    s().selectLayer(1);
    expect(s().editMode.mode).toBe('annotate');
    expect(s().annotationDiscardAction).not.toBeNull();
    expect(s().activeLayer).toBe(1);
  });

  it('leaves other modes alone', () => {
    s().setEditMode({ mode: 'water' });
    s().selectLayer(1);
    expect(s().editMode.mode).toBe('water');
  });
});

describe('claimRegionRequest', () => {
  it('moves the region tool to the first one the request offers', () => {
    s().setRegionTool('curve');
    const release = s().claimRegionRequest({ tools: ['rect', 'erase'], single: true, minSide: 4 });
    expect(s().regionTool).toBe('rect');
    expect(s().regionBrushShape).toBe('rect');
    release();
  });

  it('keeps a tool the request offers', () => {
    s().setRegionTool('erase');
    s().claimRegionRequest({ tools: ['rect', 'erase'], single: true, minSide: null });
    expect(s().regionTool).toBe('erase');
  });
});
