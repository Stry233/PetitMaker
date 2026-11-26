/**
 * When a visit's greetings may speak, and which: the gate What's new, the arrival notice and the
 * menu's bubbles share, every deferral it knows pinned here rather than discovered by mounting the
 * app in seven states, and the bubbles' ladder.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  brushHintOwed, bubblesReleased, greetingGate, markBrushHintSeen, menuBubble, restoreOfferShown, shellEngagedIn, subscribeBrushHint, whatsNewStep,
  type BubbleOwed, type GreetingOutside,
} from '../../state/greetings';
import { useEditorStore } from '../../state/store';
import { resetStore, setStoreModal, setStoreState } from '../_support/store';

const s = () => useEditorStore.getState();
/** Nothing outside the store in the way. */
const clear: GreetingOutside = { splashActive: false, tourSettled: true };

beforeEach(() => {
  resetStore();
  localStorage.clear();
  setStoreState({ tourRunning: false, repairSession: null, assistantOpen: false });
});

describe('the greeting gate', () => {
  it('opens when nothing else owns the screen', () => {
    expect(greetingGate(s(), clear)).toBe(true);
  });

  it('waits behind the boot splash', () => {
    expect(greetingGate(s(), { ...clear, splashActive: true })).toBe(false);
  });

  it('waits for the tour and its offer', () => {
    setStoreState({ tourRunning: true });
    expect(greetingGate(s(), clear)).toBe(false);
    setStoreState({ tourRunning: false });
    // The first-launch offer has not been answered yet: the tour may still be a frame away.
    expect(greetingGate(s(), { ...clear, tourSettled: false })).toBe(false);
  });

  it("waits for the What's new window, which speaks first", () => {
    setStoreModal('whatsNew', true);
    expect(greetingGate(s(), clear)).toBe(false);
  });

  it('waits while a landmark repair is asked or under way, whose window or plate stands where it would', () => {
    setStoreState({ repairSession: {} as never });
    expect(greetingGate(s(), clear)).toBe(false);
  });
});

describe("What's new at a visit's start", () => {
  it('records the version on a first visit, whatever stands', () => {
    setStoreState({ tourRunning: true });
    expect(whatsNewStep('never', s(), clear)).toBe('record');
  });

  it('says nothing and records nothing on a visit offering a newer tour', () => {
    expect(whatsNewStep('older', s(), clear)).toBe('skip');
  });

  it('greets a returning visit once the gate opens and no window stands', () => {
    expect(whatsNewStep('offered', s(), clear)).toBe('greet');
    setStoreModal('settings', true);
    expect(whatsNewStep('offered', s(), clear)).toBe('wait');
    setStoreModal('settings', false);
    expect(whatsNewStep('offered', s(), { ...clear, splashActive: true })).toBe('wait');
  });
});

describe('the visitor setting to work', () => {
  it('counts a mode or the menu, the assistant and any window but What\'s new', () => {
    expect(shellEngagedIn(s(), false)).toBe(false);
    expect(shellEngagedIn(s(), true)).toBe(true);
    setStoreModal('whatsNew', true);
    expect(shellEngagedIn(s(), false)).toBe(false);
    setStoreModal('settings', true);
    expect(shellEngagedIn(s(), false)).toBe(true);
    setStoreModal('settings', false);
    setStoreState({ assistantOpen: true });
    expect(shellEngagedIn(s(), false)).toBe(true);
  });

  it('counts nothing the tour opens', () => {
    setStoreState({ tourRunning: true, assistantOpen: true });
    expect(shellEngagedIn(s(), true)).toBe(false);
  });
});

describe('the saved-session offer', () => {
  const outside = { inSession: false };

  it('shows over the plain map, a mode or a window being no reason to hide it', () => {
    expect(restoreOfferShown(s(), outside)).toBe(true);
    setStoreModal('settings', true);
    expect(restoreOfferShown(s(), outside)).toBe(true);
  });

  it("gives way to the tour, the assistant's panel, What's new, a planet session and a landmark repair", () => {
    setStoreState({ tourRunning: true });
    expect(restoreOfferShown(s(), outside)).toBe(false);
    setStoreState({ tourRunning: false, assistantOpen: true });
    expect(restoreOfferShown(s(), outside)).toBe(false);
    setStoreState({ assistantOpen: false });
    setStoreModal('whatsNew', true);
    expect(restoreOfferShown(s(), outside)).toBe(false);
    setStoreModal('whatsNew', false);
    expect(restoreOfferShown(s(), { inSession: true })).toBe(false);
    setStoreState({ repairSession: { phase: 'choice' } as never });
    expect(restoreOfferShown(s(), outside)).toBe(false);
  });
});

describe("the menu's bubbles", () => {
  const none: BubbleOwed = { load: false, help: false, immersive: false, brush: false };

  it('speak one at a time: the load notice, Help, immersive, then the brush pointer', () => {
    expect(menuBubble(none)).toBeNull();
    expect(menuBubble({ load: true, help: true, immersive: true, brush: true })).toBe('load');
    expect(menuBubble({ ...none, help: true, immersive: true, brush: true })).toBe('help');
    expect(menuBubble({ ...none, immersive: true, brush: true })).toBe('immersive');
    expect(menuBubble({ ...none, brush: true })).toBe('brush');
  });

  it('wait behind any window, a scanned planet\'s review and an arrival notice covering their band', () => {
    expect(bubblesReleased(s(), clear, false)).toBe(true);
    expect(bubblesReleased(s(), clear, true)).toBe(false);
    setStoreModal('settings', true);
    expect(bubblesReleased(s(), clear, false)).toBe(false);
    setStoreModal('settings', false);
    setStoreState({ planetSession: { review: {} } as never });
    expect(bubblesReleased(s(), clear, false)).toBe(false);
  });
});

describe('the brush pointer', () => {
  it('is owed until seen, and opening the brush bar marks it seen for good', () => {
    const heard: number[] = [];
    const off = subscribeBrushHint(() => heard.push(1));
    expect(brushHintOwed()).toBe(true);
    s().setEditMode({ mode: 'object', arm: { kind: 'none' } });
    s().setObjectBrushBar(true);
    expect(s().objectBrushBar).toBe(true);
    expect(brushHintOwed()).toBe(false);
    expect(heard).toHaveLength(1);
    markBrushHintSeen();
    expect(heard, 'a second mark says nothing new').toHaveLength(1);
    off();
  });

  it('stays owed when the bar refuses to open', () => {
    s().setEditMode({ mode: null });
    s().setObjectBrushBar(true);
    expect(s().objectBrushBar).toBe(false);
    expect(brushHintOwed()).toBe(true);
  });
});
