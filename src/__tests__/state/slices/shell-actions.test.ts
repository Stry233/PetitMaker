/** The shell slice's one-update actions: each replaces a sequence of setters a surface used to call. */
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '../../../state/store';
import { PREFS } from '../../../platform/storage/prefs';
import { resetStore, setStoreModal, setStoreState } from '../../_support/store';

const s = () => useEditorStore.getState();

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
  it('starts as seen and running', () => {
    s().startTour();
    expect(s().tourRunning).toBe(true);
    expect(localStorage.getItem(PREFS.tourSeen.key)).toBe('1');
  });

  it('a completed run opens the send-off; a skipped one does not', () => {
    setStoreState({ tourRunning: true });
    s().finishTour(false);
    expect(s().tourRunning).toBe(false);
    expect(s().modals.tourDone).toBe(false);
    expect(localStorage.getItem(PREFS.tourSeen.key)).toBe('1');
    setStoreState({ tourRunning: true });
    s().finishTour(true);
    expect(s().modals.tourDone).toBe(true);
  });

  it('a run gives back the view it started in, however it ends', () => {
    s().setViewMode('2d');
    s().startTour();
    s().enterTourStep({ view: '3d' });
    s().finishTour(false);
    expect(s().viewMode).toBe('2d');
    expect(s().tourView).toBeNull();
    s().startTour();
    s().enterTourStep({ view: '3d' });
    s().finishTour(true);
    expect(s().viewMode).toBe('2d');
  });

  it('a step applies its mode and view', () => {
    s().enterTourStep({ mode: 'water', view: '3d' });
    expect(s().editMode.mode).toBe('water');
    expect(s().viewMode).toBe('3d');
    s().enterTourStep({ mode: null });
    expect(s().editMode.mode).toBeNull();
    expect(s().viewMode).toBe('3d');
  });
});
