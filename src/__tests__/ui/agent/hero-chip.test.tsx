// @vitest-environment jsdom
/**
 * With the panel folded, a chip at the character's shoulder carries the dock's word and clock while a
 * job runs. jsdom lays nothing out, so this covers when the chip shows, what it says, and that the
 * layer around it stays pointer-deaf.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { Profiler } from 'react';

import { append } from '../../../agent/core/log';
import { panelView, useAgentSession } from '../../../agent/session/store';
import { I18nProvider } from '../../../i18n/context';
import { translations } from '../../../i18n/translations';
import { useEditorStore } from '../../../state/store';
import { CharacterHost } from '../../../ui/agent/character/CharacterHost';
import { useCharacterChannel, type CharacterChannel } from '../../../ui/agent/character/intent';
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

/** A job under way, an order and a tool-call turn, which reads as `thinking` without a live stream.
 *  Appended through the log's own clock, set `agoMs` back, so the elapsed reading is real. */
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

    // Open, the dock says it in full.
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

  /** Open and shut, one job is described one way. */
  it('reads its word out of the one phase table', () => {
    const face = heroChipFace(panelView(useAgentSession.getState()), Date.now());
    expect(face).toBeNull();

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

/**
 * Some poses portray the setup screen, which lives in the panel's lazy chunk while the character
 * stands in this eager layer, so the screen publishes the pose (`character/intent.ts`).
 */
describe('a pose published by the surface', () => {
  let live: CharacterChannel;
  beforeAll(() => { live = renderHook(useCharacterChannel).result.current; });
  afterEach(() => live.setPose(null));

  it('outranks the phase, and hands her back when the surface goes', () => {
    const view = mount(true);
    expect(view.getByTestId('pw-character').getAttribute('data-pose')).toBe('idle');

    act(() => live.setPose('trouble'));
    expect(view.getByTestId('pw-character').getAttribute('data-pose')).toBe('trouble');

    act(() => live.setPose(null));
    expect(view.getByTestId('pw-character').getAttribute('data-pose')).toBe('idle');
  });
});

describe('her place while no chip stands at her shoulder', () => {
  it('follows a moving seat with no render of her layer, and the chip arrives where she stands', () => {
    const entrance = document.createElement('div');
    let left = 100;
    Object.defineProperty(entrance, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left, top: 40, width: 60, height: 60, right: left + 60, bottom: 100, x: left, y: 40, toJSON: () => ({}) }),
    });
    let commits = 0;
    const view = render(
      <Profiler id="host" onRender={() => { commits++; }}>
        <MotionConfig reducedMotion="always">
          <I18nProvider>
            <CharacterHost entranceRef={{ current: entrance }} open={false} connected size={60} />
          </I18nProvider>
        </MotionConfig>
      </Profiler>,
    );
    const before = commits;
    for (const at of [120, 140, 160]) {
      left = at;
      act(() => { window.dispatchEvent(new Event('resize')); });
    }
    expect(commits - before, 'a seat that moves re-places her past React').toBe(0);
    expect(view.queryByTestId('hero-chip')).toBeNull();

    act(() => { runningJob(10_000); });
    const chip = view.getByTestId('hero-chip');
    // Her seat's left plus its pad, plus her width, less the chip's inset: the chip stands at her current place.
    expect(parseFloat(chip.style.left)).toBeGreaterThan(160);
  });
});
