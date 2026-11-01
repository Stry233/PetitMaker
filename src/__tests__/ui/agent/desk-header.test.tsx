// @vitest-environment jsdom
/**
 * The desk: character slot and the one dock card, in every face it wears.
 *
 * Rendered under `MotionConfig reducedMotion="always"`, so `Character`'s WAAPI calls never fire
 * (jsdom has none) and a face swap shows in the render that caused it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { I18nProvider } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { translations } from '../../_support/locale-tables';
import { DeskHeader } from '../../../ui/agent/desk/DeskHeader';
import { buildFace, deskPose, deskSeat, deskFaceKey, type DeskContext } from '../../../ui/agent/derive/desk-face';
import { translatorFor } from '../../../i18n/context';
import type { SetupFace } from '../../../ui/agent/connection/setup-parts';
import { MAX_TURN_ATTEMPTS } from '../../../agent/core/retry';
import type { JobView, PanelView } from '../../../agent/core/project-view';
import type { ErrorClass, PlanStage } from '../../../agent/core/types';
import type { Locale } from '../../../core/model/locale';
import { makeView, renderWithI18n } from '../../_support/agent-panel';

/** The paper and the glyph the desk card's face wears, read off the face it builds. */
const faceOf = (view: PanelView, ctx: DeskContext = {}) => buildFace(view, ctx, 0, 0, translatorFor('en'));
const deskPaper = (view: PanelView, ctx: DeskContext = {}) => faceOf(view, ctx).paper;
const deskGlyph = (view: PanelView, ctx: DeskContext = {}) => faceOf(view, ctx).glyph;

const backing = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
};

beforeEach(() => {
  backing.clear();
  useEditorStore.setState({ locale: 'en' });
});

function makeJob(over: Partial<JobView> = {}): JobView {
  return {
    orderSeq: 1, orderText: 'Build a fishing village', orderAt: 0,
    asks: [], ops: [], steerNotes: [], checkpoints: [], stamps: [], celebrate: false, skills: [],
    ...over,
  };
}

const PLAN: PlanStage[] = [{ label: 'a' }, { label: 'b' }, { label: 'c' }, { label: 'd' }];

const RETRY: NonNullable<PanelView['retry']> = { attempt: 2, cls: 'rate-limit', delayMs: 10_000, since: 1_000 };

/** The retry face's own clock: `since` + `delayMs` lands at 11_000. */
const RETRY_MID = 6_000;

/** Every face the dock wears, as the view that produces it; the geometry and glyph groups both read it. */
const FACES: Record<string, { view: PanelView; connected?: boolean; setup?: SetupFace }> = {
  disconnected: { view: makeView(), connected: false },
  // Two of the setup screen's steps stand for that family here.
  'setup.shaped': { view: makeView(), connected: false, setup: { step: 'shaped', name: 'Anthropic' } },
  'setup.refused': { view: makeView(), connected: false, setup: { step: 'refused', name: 'Anthropic' } },
  idle: { view: makeView() },
  'idle.done': {
    view: makeView({ jobs: [makeJob({ outcome: 'done', kind: 'build', celebrate: true })] }),
  },
  'idle.answered': { view: makeView({ jobs: [makeJob({ outcome: 'done', kind: 'answer' })] }) },
  'idle.silent': { view: makeView({ jobs: [makeJob({ outcome: 'done', kind: 'quiet' })] }) },
  'idle.capped': { view: makeView({ jobs: [makeJob({ outcome: 'capped' })] }) },
  'idle.question': {
    view: makeView({ jobs: [makeJob({ outcome: 'done', kind: 'answer', question: true })] }),
  },
  thinking: { view: makeView({ phase: 'thinking', current: makeJob() }) },
  streaming: { view: makeView({ phase: 'streaming', current: makeJob() }) },
  executing: { view: makeView({ phase: 'executing', current: makeJob() }) },
  gated: {
    view: makeView({
      phase: 'gated', current: makeJob(),
      gate: { gateId: 'g1', scope: 'tool', summary: '86 cells' },
    }),
  },
  retrying: { view: makeView({ phase: 'retrying', current: makeJob(), retry: RETRY }) },
  pausing: { view: makeView({ phase: 'pausing', current: makeJob() }) },
  paused: { view: makeView({ phase: 'paused', current: makeJob() }) },
  aborted: { view: makeView({ phase: 'aborted', jobs: [makeJob({ outcome: 'aborted' })] }) },
  'error.auth': {
    view: makeView({ phase: 'incident', jobs: [makeJob({ outcome: 'incident', errorCls: 'auth' })] }),
  },
  'error.exhausted': {
    view: makeView({ phase: 'incident', jobs: [makeJob({ outcome: 'incident', errorCls: 'network' })] }),
  },
};

function renderFace(name: keyof typeof FACES) {
  const face = FACES[name]!;
  return renderWithI18n(
    <DeskHeader
      view={face.view}
      connected={face.connected ?? true}
      now={RETRY_MID}
      mapName="Hexia"
      {...(face.setup ? { setupFace: face.setup } : {})}
    />,
  );
}

describe('the status card is ONE card in every state', () => {

  it('leads with exactly one state glyph, in the one slot', () => {
    for (const name of Object.keys(FACES)) {
      const { getByTestId, getAllByTestId, unmount } = renderFace(name);
      expect(getAllByTestId('dock-glyph'), name).toHaveLength(1);
      expect(getByTestId('dock-glyph').querySelectorAll('svg'), name).toHaveLength(1);
      unmount();
    }
  });
});

describe('the seat table: what stands above the gear', () => {
  const seatOf = (name: keyof typeof FACES) => {
    const { getByTestId, queryByTestId, unmount } = renderFace(name);
    const seat = queryByTestId('dock-seat');
    const answer = seat === null
      ? null
      : { act: seat.getAttribute('data-act'), icon: seat.getAttribute('data-icon'), off: (seat as HTMLButtonElement).disabled };
    const gear = getByTestId('dock-col').querySelector('[data-act="manage"]') !== null;
    unmount();
    return { answer, gear };
  };

  it('gives a pauseable running ticket the pause button', () => {
    expect(seatOf('executing').answer).toEqual({ act: 'pause', icon: 'pw-pause', off: false });
    expect(seatOf('thinking').answer).toEqual({ act: 'pause', icon: 'pw-pause', off: false });
  });

  it('gives a running phase with no ticket nothing to press', () => {
    const { queryByTestId } = renderWithI18n(
      <DeskHeader view={makeView({ phase: 'executing' })} now={0} />,
    );
    expect(queryByTestId('dock-seat')).toBeNull();
  });

  it('gives an ask and a retry the stop', () => {
    expect(seatOf('gated').answer).toEqual({ act: 'stop', icon: 'pw-stop', off: false });
    expect(seatOf('retrying').answer).toEqual({ act: 'stop', icon: 'pw-stop', off: false });
  });

  it('gives a hold the resume', () => {
    expect(seatOf('paused').answer).toEqual({ act: 'resume', icon: 'pw-resume', off: false });
  });

  /** The loop pauses only at a step boundary, so a pause inside a long call stands as long as the call. */
  it('gives a pause that has not landed the stop, and says on the meta line what it is waiting for', () => {
    expect(seatOf('pausing').answer).toEqual({ act: 'stop', icon: 'pw-stop', off: false });
    const { getByTestId } = renderFace('pausing');
    expect(getByTestId('dock-meta').textContent).toBe(translations.en['agent.dock_resume_pending']);
  });

  it('leaves the standing faces with an empty seat', () => {
    for (const name of ['idle', 'idle.done', 'aborted', 'error.auth', 'disconnected'] as const) {
      expect(seatOf(name).answer, name).toBeNull();
    }
  });

  it('keeps the gear on every connected face, the retry included, and nowhere else', () => {
    // The keyless sleep and every setup step report no connection; the job zone already shows setup.
    for (const [name, face] of Object.entries(FACES)) {
      expect(seatOf(name).gear, name).toBe(face.connected !== false);
    }
  });

  it('wires the seats to their verbs', () => {
    const onPause = vi.fn();
    const onResume = vi.fn();
    const run = renderWithI18n(
      <DeskHeader view={FACES.executing!.view} now={0} onPause={onPause} onResume={onResume} />,
    );
    fireEvent.click(run.getByTestId('dock-seat'));
    expect(onPause).toHaveBeenCalledTimes(1);
    run.unmount();

    const held = renderWithI18n(
      <DeskHeader view={FACES.paused!.view} now={0} onPause={onPause} onResume={onResume} />,
    );
    fireEvent.click(held.getByTestId('dock-seat'));
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('opens the manage face from the gear', () => {
    const onManage = vi.fn();
    const { getByTestId } = renderWithI18n(<DeskHeader view={FACES.idle!.view} now={0} onManage={onManage} />);
    fireEvent.click(getByTestId('dock-col').querySelector('[data-act="manage"]')!);
    expect(onManage).toHaveBeenCalledTimes(1);
  });

  it('disables the gear when no manage handler is wired, and enables it once one is', () => {
    const idle = renderWithI18n(<DeskHeader view={FACES.idle!.view} now={0} />);
    const bareGear = idle.getByTestId('dock-gear') as HTMLButtonElement;
    expect(bareGear.disabled).toBe(true);
    idle.unmount();

    const onManage = vi.fn();
    const wired = renderWithI18n(<DeskHeader view={FACES.idle!.view} now={0} onManage={onManage} />);
    const wiredGear = wired.getByTestId('dock-gear') as HTMLButtonElement;
    expect(wiredGear.disabled).toBe(false);
    fireEvent.click(wiredGear);
    expect(onManage).toHaveBeenCalledTimes(1);
  });
});

describe('a pressed stop asks the caller, from the seat, and leaves the card as it was', () => {
  it('hands the seat itself to the caller and keeps the face, the seat and the gear', () => {
    const onAskStop = vi.fn();
    const { getByTestId } = renderWithI18n(
      <DeskHeader view={FACES.gated!.view} now={0} onAskStop={onAskStop} />,
    );
    const paperBefore = getByTestId('dock').dataset.paper;
    fireEvent.click(getByTestId('dock-seat'));
    expect(onAskStop).toHaveBeenCalledTimes(1);
    expect(onAskStop.mock.calls[0]![0].current).toBe(getByTestId('dock-seat'));
    expect(getByTestId('dock-sentence').textContent).toBe(translations.en['agent.dock_gated']);
    expect(getByTestId('dock').dataset.paper).toBe(paperBefore);
    expect(getByTestId('dock-seat').getAttribute('data-act')).toBe('stop');
    expect(getByTestId('dock-col').querySelector('[data-act="manage"]')).not.toBeNull();
  });
});

describe('a job in flight outranks a key that has gone', () => {
  const running = makeView({ phase: 'executing', current: makeJob() });

  it('keeps a stop on the card rather than a face that says the session is asleep', () => {
    expect(deskSeat(running, { connected: false })?.act).toBe('stop');
    expect(deskFaceKey(running, { connected: false })).not.toBe('disconnected');
    expect(deskGlyph(running, { connected: false })).not.toBe('pw-disconnected');
    expect(deskPaper(running, { connected: false })).toBe(deskPaper(running));

    const { getByTestId } = renderWithI18n(<DeskHeader view={running} connected={false} now={0} />);
    expect(getByTestId('dock-sentence').textContent).toBe(translations.en['agent.dock_executing']);
    expect(getByTestId('dock-seat').getAttribute('data-act')).toBe('stop');
  });

  it('asks the caller to confirm the stop', () => {
    const onAskStop = vi.fn();
    const { getByTestId } = renderWithI18n(
      <DeskHeader view={running} connected={false} now={0} onAskStop={onAskStop} />,
    );
    fireEvent.click(getByTestId('dock-seat'));
    expect(onAskStop).toHaveBeenCalledTimes(1);
  });

  it('still sleeps where nothing is in flight', () => {
    for (const view of [makeView(), makeView({ phase: 'paused', current: makeJob() })]) {
      expect(deskFaceKey(view, { connected: false })).toBe('disconnected');
      expect(deskSeat(view, { connected: false })).toBeNull();
    }
  });
});

/**
 * The setup screen's step, reported from the job zone because the phase cannot express it. The two
 * dead ends of a failed check wear a trouble face rather than the idle paper.
 */
describe('the setup family, as status-card faces', () => {
  const dock = (setup: SetupFace, over: Partial<PanelView> = {}) => ({
    view: makeView(over), ctx: { connected: false, setup },
  });

  it('paints each step its own paper and always the key glyph', () => {
    const table: [SetupFace['step'], string][] = [
      ['typing', 'idle'], ['shaped', 'work'], ['ambiguous', 'work'], ['unknown', 'ask'],
      ['refused', 'danger'], ['no-answer', 'danger'], ['endpoint', 'idle'],
    ];
    for (const [step, paper] of table) {
      const { view, ctx } = dock({ step });
      expect(deskPaper(view, ctx), step).toBe(paper);
      expect(deskGlyph(view, ctx), step).toBe('pw-key');
      expect(deskSeat(view, ctx), step).toBeNull();
      expect(deskFaceKey(view, ctx), step).toBe(`setup:${step}`);
    }
  });

  it('gives the three key-entry poses the producer they were declared for', () => {
    const poses: [SetupFace['step'], string][] = [
      ['typing', 'keylean'], ['shaped', 'keylean'], ['ambiguous', 'keylean'],
      ['refused', 'trouble'],
      ['unknown', 'asking'], ['no-answer', 'trouble'],
    ];
    for (const [step, pose] of poses) {
      const { view, ctx } = dock({ step });
      expect(deskPose(view, ctx), step).toBe(pose);
    }
    // With no step reported, the phase decides.
    expect(deskPose(makeView(), { connected: false })).toBeNull();
  });

  it('names the provider in the sentences that ask for one', () => {
    const shaped = renderWithI18n(
      <DeskHeader view={makeView()} connected={false} now={0} setupFace={{ step: 'shaped', name: 'Anthropic' }} />,
    );
    expect(shaped.getByTestId('dock-sentence').textContent)
      .toBe(translations.en['agent.dock_setup_reading']);
    expect(shaped.getByTestId('dock-meta').textContent)
      .toBe(translations.en['agent.dock_setup_shaped']!.replace('{name}', 'Anthropic'));
    shaped.unmount();

    const endpoint = renderWithI18n(
      <DeskHeader view={makeView()} connected={false} now={0} setupFace={{ step: 'endpoint', name: 'localhost:11434' }} />,
    );
    expect(endpoint.getByTestId('dock-meta').textContent).toBe('localhost:11434');
  });

  it('says the refusal on the danger paper rather than on a calm card', () => {
    const { getByTestId } = renderWithI18n(
      <DeskHeader view={makeView()} connected={false} now={0} setupFace={{ step: 'refused', name: 'Anthropic' }} />,
    );
    expect(getByTestId('dock').getAttribute('data-paper')).toBe('danger');
    expect(getByTestId('dock-sentence').textContent).toBe(translations.en['agent.dock_setup_refused']);
    expect(getByTestId('dock-meta').textContent).toBe(translations.en['agent.dock_setup_paste_again']);
  });

  /** A job in flight or an incident outranks a setup step, as it outranks the keyless sleep. */
  it('never speaks over a job in flight or an incident', () => {
    const setup: SetupFace = { step: 'typing' };
    const running = makeView({ phase: 'executing', current: makeJob() });
    expect(deskFaceKey(running, { connected: false, setup })).toBe('executing');
    expect(deskSeat(running, { connected: false, setup })?.act).toBe('stop');

    const incident = makeView({ phase: 'incident', jobs: [makeJob({ outcome: 'incident', errorCls: 'auth' })] });
    expect(deskFaceKey(incident, { connected: false, setup })).toContain('incident');
  });
});

describe('the retry family, as a status-card face', () => {
  it('says the cause as the word and the attempt as the datum', () => {
    const { getByTestId } = renderFace('retrying');
    expect(getByTestId('dock-sentence').textContent).toBe(translations.en['agent.dock_retry_busy']);
    expect(getByTestId('dock-datum').textContent)
      .toBe(`${RETRY.attempt} of ${MAX_TURN_ATTEMPTS}`);
  });

  it('hands the countdown to the TimedButton as the LOOP\'s clock, empty meaning fired', () => {
    const counting = renderWithI18n(
      <DeskHeader view={FACES.retrying!.view} now={RETRY_MID} />,
    );
    const pill = counting.getByTestId('dock-retry-pill');
    expect(pill.textContent).toContain('5');
    counting.unmount();

    const spent = renderWithI18n(<DeskHeader view={FACES.retrying!.view} now={99_999} />);
    expect(spent.getByTestId('dock-retry-pill').textContent).not.toContain('5');
  });

  it('presses retry-now through the caller\'s verb', () => {
    const onRetryNow = vi.fn();
    const { getByTestId } = renderWithI18n(
      <DeskHeader view={FACES.retrying!.view} now={RETRY_MID} onRetryNow={onRetryNow} />,
    );
    fireEvent.click(getByTestId('dock-retry-pill'));
    expect(onRetryNow).toHaveBeenCalledTimes(1);
  });

  it('stops taking a press once the backoff has fired', () => {
    const onRetryNow = vi.fn();
    const { getByTestId } = renderWithI18n(
      <DeskHeader view={FACES.retrying!.view} now={99_999} onRetryNow={onRetryNow} />,
    );
    const pill = getByTestId('dock-retry-pill');
    fireEvent.click(pill);
    expect(onRetryNow).not.toHaveBeenCalled();
  });

  it('carries a plain Retry now where there is nothing to count down', () => {
    const view = makeView({
      phase: 'retrying', current: makeJob(),
      retry: { attempt: 2, cls: 'network', delayMs: 0, since: 1_000 },
    });
    const { getByTestId } = renderWithI18n(<DeskHeader view={view} now={RETRY_MID} />);
    expect(getByTestId('dock-sentence').textContent).toBe(translations.en['agent.dock_retry_offline']);
    expect(getByTestId('dock-retry-pill').textContent).toBe(translations.en['agent.action_retry_now']);
  });

  it('DIGIT-ONLY-TICKS: a rerender with a different `now` only ever touches the seconds node', () => {
    const view = FACES.retrying!.view;
    const { getByTestId, rerender } = renderWithI18n(<DeskHeader view={view} now={RETRY_MID} />);

    const secondsEl = getByTestId('retry-seconds');
    // secondsEl -> the roll's clipping wrapper -> <b> -> the label span carrying prefix / <b> /
    // suffix.
    const rollEl = secondsEl.parentElement as HTMLElement;
    const labelEl = rollEl.parentElement!.parentElement as HTMLElement;
    const beforeChildNodes = Array.from(labelEl.childNodes);
    const glyph = getByTestId('dock-glyph').querySelector('svg')!;
    const datum = getByTestId('dock-datum');
    const pill = getByTestId('dock-retry-pill');
    const seat = getByTestId('dock-seat');

    expect(secondsEl.textContent).toBe('5');

    // `rerender` re-applies the wrapper; wrapping again would remount everything below.
    rerender(<DeskHeader view={view} now={RETRY_MID + 1_000} />);

    expect(getByTestId('retry-seconds').textContent).toBe('4');
    // The digit node is replaced because `panel.retry.digit` rolls the new number up under the old;
    // everything around it stays.
    expect(getByTestId('retry-seconds')).not.toBe(secondsEl);
    expect(getByTestId('retry-seconds').parentElement).toBe(rollEl);
    const afterChildNodes = Array.from(labelEl.childNodes);
    expect(afterChildNodes).toHaveLength(beforeChildNodes.length);
    afterChildNodes.forEach((n, i) => expect(n).toBe(beforeChildNodes[i]));
    expect(getByTestId('dock-glyph').querySelector('svg')).toBe(glyph);
    expect(getByTestId('dock-datum')).toBe(datum);
    expect(getByTestId('dock-retry-pill')).toBe(pill);
    expect(getByTestId('dock-seat')).toBe(seat);
  });
});

describe('the two decks, and the clock that steps up beside the word', () => {

  it('tells writing from thinking in the word, on the one paper the two share', () => {
    const thinking = renderWithI18n(<DeskHeader view={FACES.thinking!.view} now={0} />);
    expect(thinking.getByTestId('dock-sentence').textContent).toBe(translations.en['agent.dock_thinking']);
    thinking.unmount();

    const streaming = renderWithI18n(<DeskHeader view={FACES.streaming!.view} now={0} />);
    expect(streaming.getByTestId('dock-sentence').textContent).toBe(translations.en['agent.dock_writing']);
    expect(deskPaper(FACES.streaming!.view)).toBe(deskPaper(FACES.thinking!.view));
  });

  /** Facts a step count cannot say. Storage full is a standing condition, so it ranks under the four
   *  about the work. */
  describe('the running sub-line', () => {
    const running = (over: Partial<PanelView>, helper = false) => renderWithI18n(
      <DeskHeader
        view={makeView({
          phase: 'executing',
          current: makeJob({ plan: { stages: PLAN, currentIndex: 2, doneCount: 2, revision: 1 } }),
          ...over,
        })}
        now={0}
        helper={helper}
      />,
    );
    const op = (status: 'ok' | 'blocked') => ({
      callId: 'c1', name: 'place_object', status, summary: '', isRead: false,
    });

    it('says the region held where the newest settled op was refused for leaving it', () => {
      const { getByTestId } = running({
        current: makeJob({
          plan: { stages: PLAN, currentIndex: 2, doneCount: 2, revision: 1 },
          ops: [op('ok'), op('blocked')],
        }),
      });
      expect(getByTestId('dock-meta').textContent).toBe(translations.en['agent.dock_region_held']);
    });

    /** A call is almost always in flight on this face, so the reading is the newest settled op. */
    it('reads past the call in flight, and drops the notice once another op has landed', () => {
      const stillHeld = running({
        current: makeJob({
          plan: { stages: PLAN, currentIndex: 2, doneCount: 2, revision: 1 },
          ops: [op('blocked'), { ...op('ok'), status: 'run' as const }],
        }),
      });
      expect(stillHeld.getByTestId('dock-meta').textContent).toBe(translations.en['agent.dock_region_held']);
      stillHeld.unmount();

      const moved = running({
        current: makeJob({
          plan: { stages: PLAN, currentIndex: 2, doneCount: 2, revision: 1 },
          ops: [op('blocked'), op('ok')],
        }),
      });
      expect(moved.getByTestId('dock-meta').textContent).toBe('step 3 of 4');
    });

    it('says a queued note goes next, and counts them once there is more than one', () => {
      const one = running({ queuedSteers: [{ seq: 1, text: 'keep the shore clear' }] });
      expect(one.getByTestId('dock-meta').textContent).toBe(translations.en['agent.dock_steer_next']);
      one.unmount();

      const several = running({
        queuedSteers: [1, 2, 3].map((seq) => ({ seq, text: 'note' })),
      });
      expect(several.getByTestId('dock-meta').textContent).toBe('3 notes queued');
    });

    it('names a helper at work, which is a live fact the projection does not carry', () => {
      const { getByTestId } = running({}, true);
      expect(getByTestId('dock-meta').textContent).toBe(translations.en['agent.dock_helper']);
    });

    it('names one playbook, the newest style ahead of any method', () => {
      const skills: JobView['skills'] = [
        { name: 'terracing', kind: 'method', title: 'Terracing' },
        { name: 'cozy-village', kind: 'style', title: 'Cozy Village' },
        { name: 'roads', kind: 'method', title: 'Road Grammar' },
      ];
      const withStyle = renderWithI18n(
        <DeskHeader view={makeView({ phase: 'executing', current: makeJob({ skills }) })} now={0} />,
      );
      expect(withStyle.getByTestId('dock-meta').textContent).toBe('Cozy Village playbook');
      withStyle.unmount();

      const methodsOnly = renderWithI18n(
        <DeskHeader
          view={makeView({
            phase: 'executing',
            current: makeJob({ skills: [skills[0]!, skills[2]!] }),
          })}
          now={0}
        />,
      );
      expect(methodsOnly.getByTestId('dock-meta').textContent).toBe('Road Grammar playbook');
    });

    it('says the session is no longer being saved, under the four that are about the work', () => {
      const unsaved = renderWithI18n(
        <DeskHeader
          view={makeView({
            phase: 'executing',
            current: makeJob({ plan: { stages: PLAN, currentIndex: 2, doneCount: 2, revision: 1 } }),
          })}
          now={0}
          unsaved
        />,
      );
      expect(unsaved.getByTestId('dock-meta').textContent).toBe(translations.en['agent.dock_unsaved']);
      unsaved.unmount();

      // A queued note is about the work in front of the user, so it goes first.
      const both = renderWithI18n(
        <DeskHeader
          view={makeView({
            phase: 'executing', current: makeJob(),
            queuedSteers: [{ seq: 1, text: 'keep the shore clear' }],
          })}
          now={0}
          unsaved
        />,
      );
      expect(both.getByTestId('dock-meta').textContent).toBe(translations.en['agent.dock_steer_next']);
    });

    it('falls back to the step count when none of the five is true', () => {
      const { getByTestId } = running({});
      expect(getByTestId('dock-meta').textContent).toBe('step 3 of 4');
    });

    /** A gate's line carries the size of the ask instead (below). */
    it('says none of them on a gate face', () => {
      const { queryByTestId } = renderWithI18n(
        <DeskHeader
          view={makeView({
            phase: 'gated',
            current: makeJob(),
            gate: { gateId: 'g1', scope: 'tool', summary: 'Pave the mill road' },
            queuedSteers: [{ seq: 1, text: 'note' }],
          })}
          now={0}
          helper
        />,
      );
      expect(queryByTestId('dock-meta')).toBeNull();
    });
  });

  /** The ask card's summary describes the call, not its extent, so the gate line gives the size. */
  describe('the gate sub-line says the size', () => {
    const gated = (
      gate: NonNullable<PanelView['gate']>, over: Partial<JobView> = {}, cells?: number,
    ) => renderWithI18n(
      <DeskHeader
        view={makeView({ phase: 'gated', current: makeJob(over), gate })}
        now={0}
        {...(cells !== undefined ? { gateCells: cells } : {})}
      />,
    );

    it('counts the cells a tool call would touch, as the caller measured them', () => {
      const { getByTestId } = gated({ gateId: 'g1', scope: 'tool', summary: 'road', callId: 'c1' }, {}, 86);
      expect(getByTestId('dock-meta').textContent).toBe('86 cells');
    });

    it("counts a plan ask's steps, off the stages the ask itself is holding", () => {
      const { getByTestId } = gated(
        { gateId: 'g2', scope: 'plan', summary: 'plan' },
        { asks: [{ gateId: 'g2', scope: 'plan', summary: 'plan', stages: PLAN }] },
      );
      expect(getByTestId('dock-meta').textContent).toBe('4 steps');
    });

    it('names a pick as one, and counts the cards on offer', () => {
      const { getByTestId } = gated(
        { gateId: 'g4', scope: 'tool', summary: 'which one?', callId: 'c4' },
        {
          asks: [{
            gateId: 'g4', scope: 'tool', summary: 'which one?',
            options: [
              { cap: 'the cove' }, { cap: 'the open shore' }, { cap: 'the dirt bank' },
            ],
          }],
        },
        86,
      );
      // The pick's count outranks the call's footprint.
      expect(getByTestId('dock-sentence').textContent).toBe(translations.en['agent.dock_pick']);
      expect(getByTestId('dock-meta').textContent).toBe('3 options');
    });

    it('says nothing where the plan ask carries no stages, rather than a count of zero', () => {
      const { queryByTestId } = gated(
        { gateId: 'g3', scope: 'plan', summary: 'plan' },
        { asks: [{ gateId: 'g3', scope: 'plan', summary: 'plan' }] },
      );
      expect(queryByTestId('dock-meta')).toBeNull();
    });

    it('names one stage as one step, and one card as one option, not the plural', () => {
      const onePlan = gated(
        { gateId: 'g5', scope: 'plan', summary: 'plan' },
        { asks: [{ gateId: 'g5', scope: 'plan', summary: 'plan', stages: [{ label: 'a' }] }] },
      );
      expect(onePlan.getByTestId('dock-meta').textContent).toBe('1 step');
      onePlan.unmount();

      const onePick = gated(
        { gateId: 'g6', scope: 'tool', summary: 'which one?', callId: 'c6' },
        { asks: [{ gateId: 'g6', scope: 'tool', summary: 'which one?', options: [{ cap: 'the cove' }] }] },
      );
      expect(onePick.getByTestId('dock-meta').textContent).toBe('1 option');
    });
  });

  /** A filed record takes the dock's reading of it along; the desk rests on its map. */
  it('rests once the settled record has been put away', () => {
    const view = makeView({ jobs: [makeJob({ outcome: 'done', kind: 'build' })] });
    const standing = renderWithI18n(<DeskHeader view={view} now={0} mapName="Hexia" />);
    expect(standing.getByTestId('dock-sentence').textContent).toBe(translations.en['agent.dock_done']);
    standing.unmount();

    const filed = renderWithI18n(<DeskHeader view={view} now={0} mapName="Hexia" recordFiled />);
    expect(filed.getByTestId('dock-sentence').textContent).toBe(translations.en['agent.dock_idle']);
    expect(filed.getByTestId('dock-meta').textContent).toBe('on Hexia');
  });

  /** The ask paper is kept for a question with nothing built behind it. */
  it('reads done with a question meta when the question close landed edits', () => {
    const view = makeView({
      jobs: [makeJob({ outcome: 'done', kind: 'build', question: true, ops: [{
        callId: 'c1', name: 'place_object', status: 'ok', summary: 'placed a bench', isRead: false,
        detail: { objects: 1 },
      }] })],
    });
    const { getByTestId } = renderWithI18n(<DeskHeader view={view} now={0} />);
    expect(getByTestId('dock-sentence').textContent).toBe(translations.en['agent.dock_done']);
    expect(getByTestId('dock-meta').textContent).toBe(translations.en['agent.dock_one_question']);
    expect(getByTestId('dock').getAttribute('data-paper')).not.toBe('ask');
  });

  it('names a single-cell build as one edit, not the plural', () => {
    const view = makeView({
      jobs: [makeJob({ outcome: 'done', kind: 'build', ops: [{
        callId: 'c1', name: 'place_object', status: 'ok', summary: 'placed a bench', isRead: false,
        detail: { objects: 1 },
      }] })],
    });
    const { getByTestId } = renderWithI18n(<DeskHeader view={view} now={0} />);
    expect(getByTestId('dock-meta').textContent).toBe('1 edit');
  });

  /**
   * `writeIssued` is set when a write is asked for, so a skipped gate or a reverted write still makes
   * the job a build; the line then says the map is unchanged rather than counting zero.
   */
  describe('a build with nothing on the map does not count zero', () => {
    const declined = (over: Partial<JobView> = {}) => makeView({
      jobs: [makeJob({
        outcome: 'done', kind: 'build', celebrate: false,
        ops: [{
          callId: 'c1', name: 'paint_terrain', status: 'skipped', summary: 'terrace the ridge',
          isRead: false,
        }],
        ...over,
      })],
    });

    it('says the map is unchanged where the only write was declined', () => {
      const { getByTestId } = renderWithI18n(<DeskHeader view={declined()} now={0} />);
      expect(getByTestId('dock-meta').textContent).toBe(translations.en['agent.dock_no_edits']);
    });

    /** The `REVERTED:` path: the call ran and the rules put it back. */
    it('says the same where the write was reverted', () => {
      const view = declined({
        ops: [{
          callId: 'c1', name: 'paint_terrain', status: 'revert', summary: 'terrace the ridge',
          isRead: false, detail: { reverted: true },
        }],
      });
      const { getByTestId } = renderWithI18n(<DeskHeader view={view} now={0} />);
      expect(getByTestId('dock-meta').textContent).toBe(translations.en['agent.dock_no_edits']);
    });

    it('still counts a build that landed', () => {
      const view = declined({
        ops: [{
          callId: 'c1', name: 'paint_terrain', status: 'ok', summary: 'terraced the ridge',
          isRead: false, detail: { cells: 12 },
        }],
      });
      const { getByTestId } = renderWithI18n(<DeskHeader view={view} now={0} />);
      expect(getByTestId('dock-meta').textContent).toBe('12 edits');
    });
  });

  /**
   * `dock_try_of` carries an attempt counter word in zh and ja, which over a hold would read as a
   * retry ladder, so the paused line has its own stage string.
   */
  describe('the paused step count is a step count in every locale', () => {
    const paused = makeView({
      phase: 'paused',
      current: makeJob({ plan: { stages: PLAN, currentIndex: 3, doneCount: 3, revision: 1 } }),
    });

    it('reads the banked stages, not the try counter', () => {
      const { getByTestId } = renderWithI18n(<DeskHeader view={paused} now={0} />);
      expect(getByTestId('dock-meta').textContent)
        .toBe(translations.en['agent.dock_stage_of']!.replace('{n}', '3').replace('{m}', '4'));
    });

    it('carries the stage unit where the language counts with one, and never the attempt unit', () => {
      for (const locale of Object.keys(translations) as Locale[]) {
        const value = translations[locale]['agent.dock_stage_of']!;
        expect(value, locale).toContain('{n}');
        expect(value, locale).toContain('{m}');
        // Terse, like the retry datum in the same seat.
        expect(value.replace(/\{[nm]\}/g, '').trim().length, locale).toBeLessThan(9);
      }
      for (const locale of ['zh', 'ja'] as const) {
        expect(translations[locale]['agent.dock_stage_of'], locale)
          .not.toBe(translations[locale]['agent.dock_try_of']);
        expect(translations[locale]['agent.dock_stage_of'], locale).not.toMatch(/[次回]/);
      }
    });
  });

  /** Filing dismisses a closing question while capped work still reports its remaining stages. */
  it('keeps capped work visible but retires a dismissed closing question', () => {
    const plan = { stages: PLAN, currentIndex: 3, doneCount: 3, revision: 1 };
    const capped = renderWithI18n(
      <DeskHeader
        view={makeView({ jobs: [makeJob({ outcome: 'capped', plan })] })}
        now={0}
        mapName="Hexia"
        recordFiled
      />,
    );
    expect(capped.getByTestId('dock-sentence').textContent).toBe(translations.en['agent.dock_capped']);
    expect(capped.getByTestId('dock-meta').textContent).toBe('1 stage left');
    capped.unmount();

    const asking = renderWithI18n(
      <DeskHeader
        view={makeView({ jobs: [makeJob({ outcome: 'done', kind: 'answer', question: true })] })}
        now={0}
        recordFiled
      />,
    );
    expect(asking.getByTestId('dock-sentence').textContent).toBe(translations.en['agent.dock_idle']);
    expect(asking.getByTestId('dock').getAttribute('data-paper')).toBe('idle');
    expect(asking.getByTestId('dock-glyph').getAttribute('data-icon')).not.toBe('pw-question');
  });

  /** A restored hold has no clock: every span a rehydrated log offers crosses a reload. */
  it('says a restored hold stopped partway, and shows it no clock', () => {
    const view = makeView({
      phase: 'paused', current: makeJob({ orderAt: 1_000 }), lastEventAt: 200_000,
    });
    const live = renderWithI18n(<DeskHeader view={view} now={0} />);
    expect(live.getByTestId('dock-sentence').textContent).toBe(translations.en['agent.dock_paused']);
    expect(live.getByTestId('dock-elapsed').textContent).toBe('3:19');
    live.unmount();

    const offer = renderWithI18n(<DeskHeader view={view} now={0} heldOffer />);
    expect(offer.getByTestId('dock-sentence').textContent)
      .toBe(translations.en['agent.dock_stopped_partway']);
    expect(offer.queryByTestId('dock-elapsed')).toBeNull();
  });

  /** Read off the newest op, so a decline followed by landed work is an ordinary pause. */
  describe('the hold that began at a decline', () => {
    const op = (status: 'ok' | 'skipped') => ({
      callId: `c-${status}`, name: 'build_road', status, summary: '', isRead: false,
    });
    const held = (ops: ReturnType<typeof op>[]) => renderWithI18n(
      <DeskHeader view={makeView({ phase: 'paused', current: makeJob({ ops }) })} now={0} />,
    );

    it('names the hold and says what it is standing at', () => {
      const { getByTestId } = held([op('ok'), op('skipped')]);
      expect(getByTestId('dock-sentence').textContent).toBe(translations.en['agent.dock_holding']);
      expect(getByTestId('dock-meta').textContent).toBe(translations.en['agent.dock_skipped']);
    });

    it('reads as an ordinary pause once something has landed after the decline', () => {
      const { getByTestId, queryByTestId } = held([op('skipped'), op('ok')]);
      expect(getByTestId('dock-sentence').textContent).toBe(translations.en['agent.dock_paused']);
      expect(queryByTestId('dock-meta')).toBeNull();
    });
  });

  /**
   * A hold has no step in progress, so it reads the banked count; the full sentence belongs to the
   * ticket's pausemark (`pausedWhere`).
   */
  it('says the banked count tersely, leaving the long sentence to the ticket\'s own pausemark', () => {
    const banked = renderWithI18n(
      <DeskHeader
        view={makeView({
          phase: 'paused',
          current: makeJob({ plan: { stages: PLAN, currentIndex: 2, doneCount: 2, revision: 1 } }),
        })}
        now={0}
      />,
    );
    expect(banked.getByTestId('dock-meta').textContent).toBe('2 of 4');
    banked.unmount();

    // Nothing banked yet.
    const boundary = renderWithI18n(
      <DeskHeader
        view={makeView({
          phase: 'paused',
          current: makeJob({ plan: { stages: PLAN, currentIndex: 0, doneCount: 0, revision: 1 } }),
        })}
        now={0}
      />,
    );
    expect(boundary.getByTestId('dock-meta').textContent).toBe('0 of 4');
  });

  /** The question card below holds the summary in full. */
  it('leaves a gate face to the question card, and folds to one line with the clock', () => {
    const { getByTestId, queryByTestId } = renderFace('gated');
    expect(queryByTestId('dock-meta')).toBeNull();
    expect(getByTestId('dock-deck-word').querySelector('[data-testid="dock-elapsed"]')).not.toBeNull();
  });

  it('counts a running job from its order, and freezes a hold at the last thing logged', () => {
    const running = renderWithI18n(
      <DeskHeader view={makeView({ phase: 'executing', current: makeJob({ orderAt: 1_000 }) })} now={135_000} />,
    );
    expect(running.getByTestId('dock-elapsed').textContent).toBe('2:14');
    running.unmount();

    const held = renderWithI18n(
      <DeskHeader
        view={makeView({ phase: 'paused', current: makeJob({ orderAt: 1_000 }), lastEventAt: 162_000 })}
        now={999_000}
      />,
    );
    expect(held.getByTestId('dock-elapsed').textContent).toBe('2:41');
  });

  it('falls back to the map name only where the map IS the context', () => {
    const rest = renderFace('idle');
    expect(rest.getByTestId('dock-meta').textContent).toBe('on Hexia');
    rest.unmount();
    // A refused key is not a fact about the map.
    const refused = renderFace('error.auth');
    expect(refused.queryByTestId('dock-meta')).toBeNull();
  });

  /** The banner under this card already names the map, so the dock says the session was set aside. */
  it('names the set-aside session rather than the map it is standing on', () => {
    const { getByTestId } = renderWithI18n(
      <DeskHeader view={makeView({ phase: 'idle' })} now={0} mapName="Hexia" storageSetAside />,
    );
    expect(getByTestId('dock-meta').textContent).toBe(translations.en['agent.dock_set_aside']);
  });

  it('says an allow-always on the meta line, beside the state\'s own fact', () => {
    const view = makeView({ phase: 'executing', current: makeJob(), allowAll: true });
    const { getByTestId } = renderWithI18n(<DeskHeader view={view} now={0} mapName="Hexia" />);
    expect(getByTestId('dock-allow-mark').textContent).toBe(translations.en['agent.dock_asks_off']);
  });
});

describe('the terminal act faces', () => {
  /** The desk card offers the same repair the class's banner lights, worded for the card. */
  const CASES: [ErrorClass, string, string][] = [
    ['auth', 'agent.dock_err_auth', 'agent.dock_act_fix_key'],
    ['quota', 'agent.dock_err_quota', 'agent.banner_action_change_provider'],
    ['cors', 'agent.dock_err_cors', 'agent.banner_action_edit_endpoint'],
    ['overflow', 'agent.dock_err_overflow', 'agent.dock_act_new_order'],
    ['network', 'agent.dock_err_no_answer', 'agent.dock_act_try_again'],
    ['config', 'agent.dock_err_config', 'agent.banner_action_edit_endpoint'],
    ['model', 'agent.dock_err_model', 'agent.banner_action_edit_model'],
    ['unknown', 'agent.dock_incident', 'agent.dock_act_try_again'],
  ];

  it('names the trouble and the one act that would answer it', () => {
    for (const [cls, wordKey, actKey] of CASES) {
      const view = makeView({
        phase: 'incident', jobs: [makeJob({ outcome: 'incident', errorCls: cls })],
      });
      const { getByTestId, unmount } = renderWithI18n(<DeskHeader view={view} now={0} />);
      expect(getByTestId('dock-sentence').textContent, cls).toBe(translations.en[wordKey]);
      expect(getByTestId('dock-act').textContent, cls).toBe(translations.en[actKey]);
      unmount();
    }
  });

  /** A model id fits beside the word, so the face names the model its act asks to change. */
  it('says which model on the unserved-model face, and nothing where the caller names none', () => {
    const view = makeView({ phase: 'incident', jobs: [makeJob({ outcome: 'incident', errorCls: 'model' })] });
    const named = renderWithI18n(<DeskHeader view={view} now={0} modelName="Claude Sonnet 4.5" />);
    expect(named.getByTestId('dock-datum').textContent).toBe('Claude Sonnet 4.5');
    named.unmount();

    const bare = renderWithI18n(<DeskHeader view={view} now={0} />);
    expect(bare.queryByTestId('dock-datum')).toBeNull();
  });

  it('reports the press with the act\'s own id', () => {
    const onCardAct = vi.fn();
    const view = makeView({
      phase: 'incident', jobs: [makeJob({ outcome: 'incident', errorCls: 'auth' })],
    });
    const { getByTestId } = renderWithI18n(<DeskHeader view={view} now={0} onCardAct={onCardAct} />);
    fireEvent.click(getByTestId('dock-act'));
    expect(onCardAct).toHaveBeenCalledWith('fix-key');
  });

  it('carries the exhausted ladder\'s own count as the datum', () => {
    const view = makeView({
      phase: 'incident', jobs: [makeJob({ outcome: 'incident', errorCls: 'network' })],
    });
    const { getByTestId } = renderWithI18n(<DeskHeader view={view} now={0} />);
    expect(getByTestId('dock-datum').textContent).toBe(`after ${MAX_TURN_ATTEMPTS} tries`);
  });
});

describe('the paper each face paints', () => {
  it('stands an exhausted ladder on the waiting paper, not the danger one', () => {
    const view = makeView({
      phase: 'incident', jobs: [makeJob({ outcome: 'incident', errorCls: 'network' })],
    });
    expect(deskPaper(view)).toBe('wait');
  });
});

describe('deskGlyph and deskFaceKey, as tables', () => {
  it('derives the glyph per state family', () => {
    const table: [keyof typeof FACES, string][] = [
      ['disconnected', 'pw-disconnected'],
      ['idle', 'pw-flag'],
      ['idle.done', 'pw-check'],
      // A cap is not a completion, so it wears no check.
      ['idle.capped', 'pw-flag'],
      ['idle.answered', 'pw-reply-bubble'],
      ['idle.silent', 'pw-history'],
      ['idle.question', 'pw-question'],
      ['thinking', 'pw-resume'],
      ['streaming', 'pw-resume'],
      ['executing', 'pw-resume'],
      ['gated', 'pw-question'],
      ['pausing', 'pw-pause'],
      ['paused', 'pw-pause'],
      ['aborted', 'pw-stop'],
      ['error.auth', 'pw-warning'],
    ];
    for (const [name, glyph] of table) {
      const face = FACES[name]!;
      expect(deskGlyph(face.view, { connected: face.connected ?? true }), name).toBe(glyph);
    }
  });

  it('gives a retry face its cause\'s own icon', () => {
    const icons: [ErrorClass, string][] = [
      ['rate-limit', 'pw-retry-clock'],
      ['network', 'pw-cloud-off'],
      ['overloaded', 'pw-warning'],
    ];
    for (const [cls, icon] of icons) {
      const view = makeView({ phase: 'retrying', current: makeJob(), retry: { ...RETRY, cls } });
      expect(deskGlyph(view), cls).toBe(icon);
    }
  });

  /** A clock tick, a countdown digit or a mid-state word repaints; only a state change turns the card. */
  it('keys the flip on the state, not on the repaint', () => {
    const running = makeView({ phase: 'executing', current: makeJob() });
    const later = makeView({ phase: 'executing', current: makeJob({ ops: [] }), lastEventAt: 9_000 });
    expect(deskFaceKey(later)).toBe(deskFaceKey(running));
    expect(deskFaceKey(FACES.gated!.view)).not.toBe(deskFaceKey(running));
    expect(deskFaceKey(FACES.paused!.view)).not.toBe(deskFaceKey(FACES.pausing!.view));
    expect(deskFaceKey(FACES.idle!.view)).not.toBe(deskFaceKey(FACES['idle.done']!.view));
  });
});

describe('the status card\'s words', () => {
  it('says the state in the active locale', () => {
    useEditorStore.setState({ locale: 'zh' });
    const { getByTestId } = renderWithI18n(<DeskHeader view={FACES.thinking!.view} now={0} />);
    expect(getByTestId('dock-sentence').textContent).toBe(translations.zh['agent.dock_thinking']);
  });
});

describe('the right column: ink for a seat control, muted for the gear alone', () => {

  /** The manage card's own Done is its way out. */
  it('draws no gear once the manage face it opens is standing', () => {
    const managing = renderWithI18n(<DeskHeader view={FACES.idle!.view} now={0} managing onManage={() => {}} />);
    expect(managing.queryByTestId('dock-gear')).toBeNull();
    managing.unmount();

    const resting = renderWithI18n(<DeskHeader view={FACES.idle!.view} now={0} onManage={() => {}} />);
    expect(resting.getByTestId('dock-gear')).toBeTruthy();
  });
});

describe('the flip keys on state identity alone, never on the repaint', () => {
  function NeverWrapper({ children }: { children: React.ReactNode }) {
    return (
      <MotionConfig reducedMotion="never">
        <I18nProvider>{children}</I18nProvider>
      </MotionConfig>
    );
  }

  it('keeps work controls mounted and responsive across rapid working phases', () => {
    const pause = vi.fn();
    const { getByTestId, rerender } = render(
      <DeskHeader view={FACES.thinking!.view} now={0} onPause={pause} />,
      { wrapper: NeverWrapper },
    );
    const card = getByTestId('dock');
    for (const phase of ['streaming', 'executing', 'thinking', 'executing']) {
      rerender(<DeskHeader view={FACES[phase]!.view} now={0} onPause={pause} />);
      expect(getByTestId('dock')).toBe(card);
    }
    fireEvent.click(card.querySelector('[data-act="pause"]')!);
    expect(pause).toHaveBeenCalledOnce();
  });

  it('holds the status card\'s own DOM node across a clock-only rerender, and swaps it on a real state change', async () => {
    const { getByTestId, rerender } = render(
      <DeskHeader view={FACES.executing!.view} now={0} />,
      { wrapper: NeverWrapper },
    );
    const before = getByTestId('dock');

    // Only the clock moved. `mode="wait"` keeps an exiting node mounted until its leave ends, so the
    // check waits a full flip before reading the node.
    rerender(<DeskHeader view={FACES.executing!.view} now={5_000} />);
    await new Promise((resolve) => { setTimeout(resolve, 700); });
    expect(getByTestId('dock')).toBe(before);

    // `mode="wait"` mounts the arriving face only after the leave.
    rerender(<DeskHeader view={FACES.paused!.view} now={5_000} />);
    await waitFor(() => expect(getByTestId('dock')).not.toBe(before));
  });
});

/** Network loss offers an immediate retry without a countdown. Provider throttling shows the
 * computed delay, so the retry face branches on cause rather than `delayMs`. */
describe('the retry face branches on the CAUSE, not on whether a delay was computed', () => {
  const offline = (delayMs: number) => makeView({
    phase: 'retrying', current: makeJob(),
    retry: { attempt: 2, cls: 'network', delayMs, since: 1_000 },
  });

  it('gives a network wait the plain press even though the ladder computed a backoff', () => {
    const { getByTestId, queryByTestId } = renderWithI18n(
      <DeskHeader view={offline(9_000)} now={RETRY_MID} />,
    );
    expect(getByTestId('dock-sentence').textContent).toBe(translations.en['agent.dock_retry_offline']);
    expect(getByTestId('dock-retry-pill').textContent).toBe(translations.en['agent.action_retry_now']);
    expect(queryByTestId('retry-seconds')).toBeNull();
  });

  it('still presses retry-now from the offline face', () => {
    const onRetryNow = vi.fn();
    const { getByTestId } = renderWithI18n(
      <DeskHeader view={offline(9_000)} now={RETRY_MID} onRetryNow={onRetryNow} />,
    );
    fireEvent.click(getByTestId('dock-retry-pill'));
    expect(onRetryNow).toHaveBeenCalledTimes(1);
  });

  it('keeps the countdown face for every other retryable cause', () => {
    for (const cls of ['rate-limit', 'overloaded', 'unknown'] as ErrorClass[]) {
      const view = makeView({
        phase: 'retrying', current: makeJob(),
        retry: { attempt: 2, cls, delayMs: 10_000, since: 1_000 },
      });
      const { getByTestId, unmount } = renderWithI18n(<DeskHeader view={view} now={RETRY_MID} />);
      expect(getByTestId('retry-seconds').textContent, cls).toBe('5');
      unmount();
    }
  });
});

/** Authentication failures and missing credentials are distinct faces that name their provider. */
describe('the key faces name their provider, and a key that is GONE is not one that was refused', () => {
  const refused = makeView({
    phase: 'incident', jobs: [makeJob({ outcome: 'incident', errorCls: 'auth' })],
  });

  it('says who refused, on the face whose act is go and fix that', () => {
    const { getByTestId } = renderWithI18n(
      <DeskHeader view={refused} now={0} providerName="Anthropic" />,
    );
    expect(getByTestId('dock-sentence').textContent).toBe(translations.en['agent.dock_err_auth']);
    expect(getByTestId('dock-datum').textContent).toBe('Anthropic');
  });

  it('says nothing rather than a placeholder where no provider is known', () => {
    const { queryByTestId } = renderWithI18n(<DeskHeader view={refused} now={0} />);
    expect(queryByTestId('dock-datum')).toBeNull();
  });

  /** Pressing "Enter a key" drops the refused key, and the card must not fall to the sleeping face. */
  it('lands the fix-key act on its own sentence rather than on the sleeping face', () => {
    const { getByTestId } = renderWithI18n(
      <DeskHeader view={refused} connected={false} now={0} providerName="Anthropic" />,
    );
    expect(getByTestId('dock-sentence').textContent)
      .toBe(translations.en['agent.dock_err_key_missing']);
    expect(getByTestId('dock-act').textContent).toBe(translations.en['agent.dock_act_fix_key']);
    expect(getByTestId('dock-datum').textContent).toBe('Anthropic');
    // The same trouble family, and no seat: the job has settled.
    expect(getByTestId('dock').dataset.paper).toBe('danger');
    expect(deskSeat(refused, { connected: false })).toBeNull();
  });

  it('turns the card between the two, since they are two states and not one repaint', () => {
    expect(deskFaceKey(refused, { connected: true }))
      .not.toBe(deskFaceKey(refused, { connected: false }));
  });

  /** With no key, `try-again` could only fail on auth again, so every keyless incident offers the key. */
  it('offers the key rather than another attempt on every keyless incident', () => {
    for (const cls of ['network', 'overloaded', 'unknown'] as const) {
      const view = makeView({
        phase: 'incident',
        jobs: [makeJob({ outcome: 'incident', errorCls: cls })],
      });
      const keyed = renderWithI18n(<DeskHeader view={view} now={0} providerName="Anthropic" />);
      expect(keyed.getByTestId('dock-act').textContent, `${cls}, keyed`)
        .toBe(translations.en['agent.dock_act_try_again']);
      keyed.unmount();

      const keyless = renderWithI18n(
        <DeskHeader view={view} connected={false} now={0} providerName="Anthropic" />,
      );
      expect(keyless.getByTestId('dock-act').textContent, `${cls}, keyless`)
        .toBe(translations.en['agent.dock_act_fix_key']);
      keyless.unmount();
    }
  });

  it('still sleeps where the session is at rest with no key', () => {
    expect(deskPaper(makeView(), { connected: false })).toBe('idle');
    expect(deskGlyph(makeView(), { connected: false })).toBe('pw-disconnected');
  });
});

describe('the marks and spacing on an action face', () => {
  /** The disconnected setup surface has no session and therefore no session-level allow mark. */
  it('keeps the allow-always mark off the keyless sleep', () => {
    const asleep = makeView({ allowAll: true });
    const { queryByTestId } = renderWithI18n(
      <DeskHeader view={asleep} connected={false} now={0} />,
    );
    expect(queryByTestId('dock-allow-mark')).toBeNull();
  });

  /** The adjacent sentence supplies the noun, so the datum contains only the attempt figure. */
  it('says the attempt as a bare figure, in every locale', () => {
    for (const locale of Object.keys(translations) as Locale[]) {
      const value = translations[locale]['agent.dock_try_of']!;
      expect(value, locale).toContain('{n}');
      expect(value, locale).toContain('{m}');
      // Nothing but the two numbers, their connective and at most one counter word.
      expect(value.replace(/\{[nm]\}/g, '').trim().length, locale).toBeLessThan(8);
    }
  });
});
