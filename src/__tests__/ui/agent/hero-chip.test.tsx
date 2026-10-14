// @vitest-environment jsdom
/**
 * The closed panel. With it folded the character is all that is left of the assistant: a faint
 * plate behind her so she reads as a control, and while a job runs a chip at her shoulder with the
 * dock's own word and clock. The chip arrives and leaves rather than switching on with the fold's
 * timer. jsdom lays nothing out, so this tests when the two show, what the chip says, and that the
 * layer around it stays pointer-deaf.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';

import { append } from '../../../agent/core/log';
import { panelView, useAgentSession } from '../../../agent/session/store';
import { I18nProvider } from '../../../i18n/context';
import { translations } from '../../../i18n/translations';
import { useEditorStore } from '../../../state/store';
import { CharacterHost } from '../../../ui/agent/character/CharacterHost';
import { setIntentPose } from '../../../ui/agent/character/intent';
import { heroChipFace } from '../../../ui/agent/derive/clock';
import { PHASE } from '../../../ui/agent/derive/phase';

const backing = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
};

function mount(open: boolean, onOpen?: () => void) {
  const entranceRef = { current: document.createElement('div') };
  return render(
    <MotionConfig reducedMotion="always">
      <I18nProvider>
        <CharacterHost
          entranceRef={entranceRef}
          open={open}
          connected
          size={60}
          {...(onOpen ? { onOpen } : {})}
        />
      </I18nProvider>
    </MotionConfig>,
  );
}

/** A job under way: an order and a turn that asked for a tool. The fold reads a running job off the
 *  Log as `thinking` (only a live stream promotes it to streaming/executing, which is a coalesced
 *  frame this test does not need), and the chip's business is the running family as a whole.
 *  Appended through the log's own clock so the elapsed reading is real — the seam `states.ts` uses. */
function runningJob(agoMs: number): void {
  const log = useAgentSession.getState().log as { now: () => number };
  const real = log.now;
  log.now = () => Date.now() - agoMs;
  try {
    append(useAgentSession.getState().log, { kind: 'order', text: 'build a village', mapContext: '' });
    append(useAgentSession.getState().log, {
      kind: 'assistant',
      stop: 'tool-calls',
      parts: [{ kind: 'tool', callId: 'c1', name: 'place_object', input: {}, argsDone: true }],
    });
  } finally {
    log.now = real;
  }
}

beforeEach(() => {
  backing.clear();
  useEditorStore.setState({ locale: 'en' });
  useAgentSession.getState().clearSession();
});

afterEach(cleanup);

describe('the chip at the parked character\'s shoulder', () => {
  it('stands only while the panel is shut AND a job is running', () => {
    const idle = mount(false);
    expect(idle.queryByTestId('hero-chip')).toBeNull();
    idle.unmount();

    act(() => { runningJob(134_000); });

    const shut = mount(false);
    expect(shut.getByTestId('hero-chip')).toBeTruthy();
    shut.unmount();

    // Open, the dock says all of this in full, and a chip beside it would be the same fact twice.
    const openPanel = mount(true);
    expect(openPanel.queryByTestId('hero-chip')).toBeNull();
    openPanel.unmount();
  });

  it('carries the status card\'s own word and the job\'s clock', () => {
    act(() => { runningJob(134_000); });
    const view = mount(false);
    const text = view.getByTestId('hero-chip').textContent ?? '';
    expect(text).toContain(translations.en['agent.dock_thinking']);
    expect(text).toMatch(/\d+:\d\d/);
  });

  /** The word is the dock's table, not a second wording: the panel open and the panel shut must not
   *  describe one job two ways. */
  it('reads its word out of the one phase table', () => {
    const face = heroChipFace(panelView(useAgentSession.getState()), Date.now());
    expect(face).toBeNull(); // nothing running yet

    act(() => { runningJob(1_000); });
    const live = panelView(useAgentSession.getState());
    expect(live.phase).toBe('thinking');
    expect(heroChipFace(live, Date.now())?.wordKey).toBe(PHASE[live.phase].word);
  });

  it('moves its clock on its own, with nothing else re-rendering', () => {
    vi.useFakeTimers();
    try {
      act(() => { runningJob(0); });
      const view = mount(false);
      const read = () => view.getByTestId('hero-chip').textContent ?? '';
      expect(read()).toContain('0:00');

      act(() => { vi.advanceTimersByTime(3_000); });
      expect(read()).toContain('0:03');
    } finally {
      vi.useRealTimers();
    }
  });

  /** It is a control: the one thing in a pointer-deaf layer that takes a press, and what it does is
   *  put the panel back up. */
  it('opens the panel on a press, in a layer that takes no press of its own', () => {
    act(() => { runningJob(1_000); });
    const opened: number[] = [];
    const view = mount(false, () => opened.push(1));

    expect(view.getByTestId('character-layer').style.pointerEvents).toBe('none');
    const chip = view.getByTestId('hero-chip');
    expect(chip.style.pointerEvents).toBe('auto');

    fireEvent.click(chip);
    expect(opened).toEqual([1]);
  });
});

/** She stands free, in both states. A plate behind her while the panel was shut read as a second
 *  card standing beside the one she opens, and the panel now unfolds from her own corner: what says
 *  she is a control is her hover and her press. */
describe('no card is drawn around her', () => {
  it('draws no plate, panel open or shut', () => {
    const shut = mount(false);
    expect(shut.queryByTestId('character-rest-plate')).toBeNull();
    shut.unmount();

    const openPanel = mount(true);
    expect(openPanel.queryByTestId('character-rest-plate')).toBeNull();
  });
});

/**
 * The pose a surface owns. Three of the character's poses portray the setup screen rather than the
 * session, and the screen is inside the panel's lazy chunk while she stands in this eager layer, so
 * the fact is published rather than passed (`character/intent.ts`). Without this the dock said
 * "Reading the key" over a character fast asleep.
 */
describe('a pose published by the surface', () => {
  afterEach(() => setIntentPose(null));

  it('outranks the phase, and hands her back when the surface goes', () => {
    const view = mount(true);
    expect(view.getByTestId('pw-character').getAttribute('data-pose')).toBe('idle');

    act(() => setIntentPose('trouble'));
    expect(view.getByTestId('pw-character').getAttribute('data-pose')).toBe('trouble');

    act(() => setIntentPose(null));
    expect(view.getByTestId('pw-character').getAttribute('data-pose')).toBe('idle');
  });
});
