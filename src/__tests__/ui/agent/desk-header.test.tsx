// @vitest-environment jsdom
/**
 * The desk: character slot and the one dock card, in every face it wears.
 *
 * Rendered under `MotionConfig reducedMotion="always"`, so `Character`'s WAAPI calls never fire
 * (jsdom has none) and the card flip is cut, which lets a face swap be asserted in the render that
 * caused it. Colour assertions push both sides through the same DOM round-trip (`asBackground`),
 * since jsdom's cssstyle can normalize equal colours differently.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { I18nProvider } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { translations } from '../../_support/locale-tables';
import { DeskHeader } from '../../../ui/agent/desk/DeskHeader';
import { STATUS_CARD_HEIGHT } from '../../../ui/agent/desk/StatusCard';
import { buildFace, deskPose, deskSeat, deskFaceKey, type DeskContext } from '../../../ui/agent/derive/desk-face';
import { translatorFor } from '../../../i18n/context';
import type { SetupFace } from '../../../ui/agent/connection/setup-parts';
import { metaInk, statePaper } from '../../../ui/agent/panel-skin';
import { ACTIVE, INK, MUTED } from '../../../ui/design/tokens';
import { cursors } from '../../../ui/design/styles';
import { MAX_TURN_ATTEMPTS } from '../../../agent/core/retry';
import type { JobView, PanelView, SessionPhase } from '../../../agent/core/project-view';
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

function asBackground(value: string): string {
  const probe = document.createElement('span');
  probe.style.background = value;
  return probe.style.background;
}

function asColor(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

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

/** Every face the dock wears, as the view that produces it. One table, read by the geometry group
 *  and by the glyph group, so a face added to the dock cannot be added to only one of them. */
const FACES: Record<string, { view: PanelView; connected?: boolean; setup?: SetupFace }> = {
  disconnected: { view: makeView(), connected: false },
  // The setup screen's own steps, reported up from the job zone: two of the ten, so the geometry and
  // glyph sweeps above cover the family without restating its table.
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
  it('stands at the constant height, whatever face it wears', () => {
    expect(STATUS_CARD_HEIGHT).toBe(74);
    for (const name of Object.keys(FACES)) {
      const { getByTestId, unmount } = renderFace(name);
      expect(getByTestId('dock').style.height, name).toBe(`${STATUS_CARD_HEIGHT}px`);
      unmount();
    }
  });

  /** The tag marks the whole feature, so it stands on every face — and out of flow, in the card's
   *  top padding band, so no face's own lines move for it. */
  it('wears the beta tag on every face, out of flow', () => {
    for (const name of Object.keys(FACES)) {
      const { getByTestId, unmount } = renderFace(name);
      const tag = getByTestId('dock-beta');
      expect(tag.textContent, name).toBe('Beta');
      expect(tag.style.position, name).toBe('absolute');
      expect(tag.getAttribute('aria-hidden'), name).toBe('true');
      unmount();
    }
  });

  it('leads with exactly one state glyph, in the one slot', () => {
    for (const name of Object.keys(FACES)) {
      const { getByTestId, getAllByTestId, unmount } = renderFace(name);
      expect(getAllByTestId('dock-glyph'), name).toHaveLength(1);
      expect(getByTestId('dock-glyph').querySelectorAll('svg'), name).toHaveLength(1);
      unmount();
    }
  });

  /** The flip turns the card, and a turn needs a perspective on the card's own parent: a wrapper
   *  between flattens 3D and the turn renders as a vertical squash. */
  it('keeps the flip\'s perspective on the desk itself', () => {
    const { getByTestId } = renderFace('idle');
    expect(getByTestId('desk-header').style.perspective).toBe('520px');
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

  /** The loop honours a pause only at a step boundary, so a pause asked for inside one long call
   *  stands for as long as that call takes. A dimmed resume there left both dock controls
   *  unpressable in the one state a user most wants out of. */
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
    // The gearless faces are the ones whose caller reports no connection: the keyless sleep and
    // every setup step (the gear's own surface is already what the job zone is showing).
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

  /** A gear with no handler behind it stands disabled like every unavailable control. */
  it('disables the gear when no manage handler is wired, and enables it once one is', () => {
    const idle = renderWithI18n(<DeskHeader view={FACES.idle!.view} now={0} />);
    const bareGear = idle.getByTestId('dock-gear') as HTMLButtonElement;
    expect(bareGear.disabled).toBe(true);
    expect(bareGear.style.cursor).toBe(cursors.blocked);
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
 * The setup screen's own step, said on the card above it. Without this channel the dock said "Not
 * connected / add a key to start" over a confirmed provider and a chosen model, and the two dead ends a
 * failed check lands on stood on the calm idle paper with no trouble face at all.
 *
 * The step arrives as a fact from the job zone (the phase cannot express it), and this file owns
 * what it looks like: the paper, the key glyph, the words and the pose.
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
    // A desk with no step reported is the phase's own business again.
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

  /** A step is what a desk with nothing louder says. A job the loop still has, and an incident with
   *  its own repair, both outrank it — the same precedence the keyless sleep already has. */
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
    // The pill lights only when the lent clock is spent (TimedButton's own `fired` reading).
    expect(asBackground(pill.style.backgroundColor)).not.toBe(asBackground(ACTIVE));
    counting.unmount();

    const spent = renderWithI18n(<DeskHeader view={FACES.retrying!.view} now={99_999} />);
    expect(asBackground(spent.getByTestId('dock-retry-pill').style.backgroundColor)).toBe(asBackground(ACTIVE));
  });

  it('presses retry-now through the caller\'s verb', () => {
    const onRetryNow = vi.fn();
    const { getByTestId } = renderWithI18n(
      <DeskHeader view={FACES.retrying!.view} now={RETRY_MID} onRetryNow={onRetryNow} />,
    );
    fireEvent.click(getByTestId('dock-retry-pill'));
    expect(onRetryNow).toHaveBeenCalledTimes(1);
  });

  /** Empty means fired, which also means there is nothing left to hurry: a pill that still looked
   *  live at that moment was neither doing something nor visibly refusing. */
  it('stops taking a press once the backoff has fired', () => {
    const onRetryNow = vi.fn();
    const { getByTestId } = renderWithI18n(
      <DeskHeader view={FACES.retrying!.view} now={99_999} onRetryNow={onRetryNow} />,
    );
    const pill = getByTestId('dock-retry-pill');
    expect(pill.style.pointerEvents).toBe('none');
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

    // `render(ui, { wrapper })`'s own `rerender` already re-applies the wrapper: wrapping again
    // here would double-nest it, changing the tree shape at this position and forcing React to
    // remount everything below.
    rerender(<DeskHeader view={view} now={RETRY_MID + 1_000} />);

    expect(getByTestId('retry-seconds').textContent).toBe('4');
    // The digit itself is replaced, and that is the motion rather than a fault: `panel.retry.digit`
    // rolls a new number up from under the old one, which needs two nodes. What must not move is
    // everything around it.
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
  it('folds to one centered line where the state has no meta of its own', () => {
    // A gate never repeats the question (the card below holds it in full) and this one's size is
    // unknown to the caller, so it is the face with a clock and no meta at all.
    const { getByTestId } = renderFace('gated');
    const dock = getByTestId('dock');
    expect(dock.dataset.solo).toBe('true');
    // A solo face keeps its clock on the word line because it has no metadata row.
    expect(getByTestId('dock-deck-word').querySelector('[data-testid="dock-elapsed"]')).not.toBeNull();
  });

  it('keeps the clock at the meta\'s end where there is a meta', () => {
    const view = makeView({
      phase: 'executing',
      current: makeJob({ plan: { stages: PLAN, currentIndex: 2, doneCount: 2, revision: 1 } }),
    });
    const { getByTestId } = renderWithI18n(<DeskHeader view={view} now={0} mapName="Hexia" />);
    expect(getByTestId('dock').dataset.solo).toBe('false');
    expect(getByTestId('dock-meta').textContent).toBe('step 3 of 4');
    expect(getByTestId('dock-deck-meta').querySelector('[data-testid="dock-elapsed"]')).not.toBeNull();
    expect(getByTestId('dock-deck-word').querySelector('[data-testid="dock-elapsed"]')).toBeNull();
  });

  /** Thinking and writing are two things to be waiting on. They share the reasoning paper (a model
   *  streaming text is still working out what to say), and the ticket's caret was the only place the
   *  panel said which of them was happening — the dock said "Thinking" through both. */
  it('tells writing from thinking in the word, on the one paper the two share', () => {
    const thinking = renderWithI18n(<DeskHeader view={FACES.thinking!.view} now={0} />);
    expect(thinking.getByTestId('dock-sentence').textContent).toBe(translations.en['agent.dock_thinking']);
    thinking.unmount();

    const streaming = renderWithI18n(<DeskHeader view={FACES.streaming!.view} now={0} />);
    expect(streaming.getByTestId('dock-sentence').textContent).toBe(translations.en['agent.dock_writing']);
    expect(deskPaper(FACES.streaming!.view)).toBe(deskPaper(FACES.thinking!.view));
  });

  /** What else is true of a running job, which a bare step count cannot say: a refused edit, a note
   *  waiting, a helper at work, the playbook. Each clears itself; storage full is a standing condition,
   *  so it reads under the four about the work. */
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

    /** A call in flight says nothing about what the last one did, and one is almost always in flight
     *  while this face is up — so the reading is the newest settled op. */
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

    /** The rule is the projection's: the newest style, else the newest method. A job that loaded
     *  three techniques is one sub-line, and it is the one shaping what the user is watching. */
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

    /** A gate says none of these. The three above are facts about a job proceeding; a gate is the job
     *  stopped, and what its own line is for is the size of what is being asked (below). */
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

  /**
   * What a gate's own line is for: how big the thing being asked about is, which is the one fact the
   * ask card below does not carry (the loop's summary is `describeCall`'s, so it names the call's
   * coordinates rather than its extent).
   */
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
      // The pick's own count outranks the call's footprint: what is being asked for is a choice.
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

    /** The reachable n=1 cases: a plan ask of one stage, and a pick offering one card. */
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

  /**
   * A filed record is not news. The receipt and the dock are one piece of news, so a record put away
   * takes the dock's reading of it with it: the desk reads its own rest, and the map it stands on.
   */
  it('rests once the settled record has been put away', () => {
    const view = makeView({ jobs: [makeJob({ outcome: 'done', kind: 'build' })] });
    const standing = renderWithI18n(<DeskHeader view={view} now={0} mapName="Hexia" />);
    expect(standing.getByTestId('dock-sentence').textContent).toBe(translations.en['agent.dock_done']);
    standing.unmount();

    const filed = renderWithI18n(<DeskHeader view={view} now={0} mapName="Hexia" recordFiled />);
    expect(filed.getByTestId('dock-sentence').textContent).toBe(translations.en['agent.dock_idle']);
    expect(filed.getByTestId('dock-meta').textContent).toBe('on Hexia');
  });

  /** A trailing question over a landed build is a finished job with one question in the record:
   *  the word says done, the meta carries the ask, and the paper is the resting one — the ask dress
   *  stays reserved for a question with nothing built behind it. */
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

  /** The reachable n=1 case: a build that changed exactly one cell or object names it as one edit. */
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
   * "ALL DONE. / 0 EDITS" is a report of a build that never happened, and the commonest way to reach
   * it is the user's own refusal: `writeIssued` is set by the ask, so a gate the user skipped (or a
   * write the rules reverted) still classifies the job a build and the meta line counted nothing.
   * The map is untouched, and that is the fact the line owes them. `celebrate` already reads
   * `writeApplied`, so the character was right while the dock was not.
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

    /** The same face through the routine `REVERTED:` path: the call ran, the rules put it back. */
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
   * The paused sub-line counts stages, not attempts. It borrowed `dock_try_of`, which is authored
   * for "attempt n of MAX_TURN_ATTEMPTS" and carries the counter word inside the string in zh and ja
   * (a count of times) — so the card read as a retry ladder over a hold, while the pausemark chip two rows
   * below said stages. One fact in two units, one of them wrong.
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
        // Terse, like the retry datum it sits in the same seat as.
        expect(value.replace(/\{[nm]\}/g, '').trim().length, locale).toBeLessThan(9);
      }
      // The two CJK locales are the ones whose form must not be the attempt counter's.
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

  /**
   * A hold the page did not make is an offer: the word says where the work stopped, and there is no
   * clock, since every span a rehydrated log can offer is measured across a reload.
   */
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

  /**
   * A hold standing at a decline is not the hold the user asked for, and "Paused" says nothing about
   * why the job stopped where it did. Read off the newest op, so a decline with work after it is
   * over: the job went on, and it is holding for some other reason.
   */
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
   * A plain hold reads the banked count, not the running "step N+1 of M" reading: a hold has no
   * step in progress. But it reads the bare figure, not the ticket's own long sentence
   * (`pausedWhere`): the ticket's pausemark chip already says "paused after step 2 of 4" in full,
   * and a dock repeating it verbatim would state one fact twice in one card. Reading the running
   * count here instead makes the two disagree outright: "step 3 of 4" above an offer note saying
   * two of four.
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

    // Nothing banked yet: the bare figure still reads honestly as zero, of the plan's own total.
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

  /** The question card under the dock holds the same summary in full, so the card never repeats it:
   *  with no size to report either, the face is the state and the clock. */
  it('leaves a gate face to the question card, and folds to one line with the clock', () => {
    const { getByTestId, queryByTestId } = renderFace('gated');
    expect(queryByTestId('dock-meta')).toBeNull();
    expect(getByTestId('dock').dataset.solo).toBe('true');
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

  /**
   * A session set aside on load outranks the map. The banner standing under this exact card already
   * names the map (it is what the notice is about); a dock reading "on Hexia" over it repeats a true
   * fact and drops the one the user needs, which is that a saved session could not be read.
   */
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
    // And it can give way. Held at its natural width beside a state that also has a fact to report,
    // it overran the deck and was drawn over the clock; both halves must be able to lose characters.
    const mark = getByTestId('dock-allow-mark');
    expect(mark.style.minWidth).toBe('0');
    expect(mark.style.textOverflow).toBe('ellipsis');
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

  /** The datum is which model, on the face whose act is "go and change it": the endpoint's own name
   *  does not fit beside the word and a model id does, so this face carries the fact its act needs
   *  rather than sending the reader to the banner for it. */
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
  const PAPER: Record<SessionPhase, keyof typeof statePaper> = {
    idle: 'idle',
    // A text part streaming is still the model working out what to say: think, not work.
    thinking: 'think',
    streaming: 'think',
    executing: 'work',
    gated: 'ask',
    retrying: 'wait',
    pausing: 'work',
    paused: 'wait',
    // An abort is not a wait: it wears its own darker stop tone.
    aborted: 'stop',
    incident: 'danger',
  };

  for (const phase of Object.keys(PAPER) as SessionPhase[]) {
    it(`${phase} paints statePaper.${PAPER[phase]}`, () => {
      const view = makeView({
        phase,
        current: phase === 'idle' || phase === 'aborted' ? undefined : makeJob(),
        ...(phase === 'retrying' ? { retry: RETRY } : {}),
        ...(phase === 'incident' ? { jobs: [makeJob({ outcome: 'incident', errorCls: 'auth' })] } : {}),
      });
      const { getByTestId } = renderWithI18n(<DeskHeader view={view} now={RETRY_MID} />);
      expect(asBackground(getByTestId('dock').style.background)).toBe(asBackground(statePaper[PAPER[phase]]));
    });
  }

  it('stands an exhausted ladder on the waiting paper, not the danger one', () => {
    const view = makeView({
      phase: 'incident', jobs: [makeJob({ outcome: 'incident', errorCls: 'network' })],
    });
    expect(deskPaper(view)).toBe('wait');
  });
});

describe('deskGlyph and deskSeat, as tables', () => {
  it('derives the glyph per state family', () => {
    const table: [keyof typeof FACES, string][] = [
      ['disconnected', 'pw-disconnected'],
      ['idle', 'pw-flag'],
      ['idle.done', 'pw-check'],
      // A cap is not a completion: the flag the running face wears for it stays on the receipt, and
      // the check would say the job finished.
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

  it('derives the seat per family', () => {
    expect(deskSeat(FACES.executing!.view)?.id).toBe('pause');
    expect(deskSeat(makeView({ phase: 'executing' }))).toBeNull();
    expect(deskSeat(FACES.gated!.view)?.id).toBe('stop');
    expect(deskSeat(FACES.retrying!.view)?.id).toBe('stop');
    expect(deskSeat(FACES.paused!.view)?.id).toBe('resume');
    expect(deskSeat(FACES.pausing!.view)?.id).toBe('stop');
    expect(deskSeat(FACES.idle!.view)).toBeNull();
    expect(deskSeat(FACES.aborted!.view)).toBeNull();
    expect(deskSeat(makeView(), { connected: false })).toBeNull();
  });

  /** The flip keys on the state's identity: a clock tick, a countdown digit or a word said
   *  mid-state repaints the standing face, and only a state change turns the card. */
  it('keys the flip on the state, not on the repaint', () => {
    const running = makeView({ phase: 'executing', current: makeJob() });
    const later = makeView({ phase: 'executing', current: makeJob({ ops: [] }), lastEventAt: 9_000 });
    expect(deskFaceKey(later)).toBe(deskFaceKey(running));
    expect(deskFaceKey(FACES.gated!.view)).not.toBe(deskFaceKey(running));
    expect(deskFaceKey(FACES.paused!.view)).not.toBe(deskFaceKey(FACES.pausing!.view));
    expect(deskFaceKey(FACES.idle!.view)).not.toBe(deskFaceKey(FACES['idle.done']!.view));
  });
});

describe('the status card\'s words, in every locale', () => {
  const KEYS = [
    'agent.dock_idle', 'agent.dock_thinking', 'agent.dock_writing', 'agent.dock_executing', 'agent.dock_gated',
    'agent.dock_retrying', 'agent.dock_pausing', 'agent.dock_paused', 'agent.dock_aborted',
    'agent.dock_incident', 'agent.dock_disconnected', 'agent.dock_no_key',
    'agent.dock_done', 'agent.dock_answered', 'agent.dock_ended', 'agent.dock_nothing_said',
    'agent.dock_capped', 'agent.dock_err_auth', 'agent.dock_err_key_missing',
    'agent.dock_err_quota', 'agent.dock_err_cors',
    'agent.dock_err_overflow', 'agent.dock_err_no_answer', 'agent.dock_after_tries',
    'agent.dock_err_config', 'agent.dock_err_model',
    'agent.dock_act_try_again', 'agent.dock_act_new_order', 'agent.dock_act_fix_key',
    'agent.dock_retry_busy', 'agent.dock_retry_offline', 'agent.dock_retry_again',
    'agent.dock_try_of', 'agent.dock_step_of', 'agent.dock_thoughts', 'agent.dock_reads',
    'agent.dock_edits_kept', 'agent.dock_on_map', 'agent.dock_asks_off',
    'agent.dock_stop_question', 'agent.dock_manage', 'agent.dock_pause_at_step',
    'agent.dock_resume_pending',
    'agent.dock_setup_reading', 'agent.dock_setup_watching', 'agent.dock_setup_shaped',
    'agent.dock_setup_asking_both', 'agent.dock_setup_new', 'agent.dock_setup_refused',
    'agent.dock_setup_paste_again', 'agent.dock_setup_no_provider', 'agent.dock_setup_point_me',
    'agent.action_stop',
    'agent.action_resume', 'agent.action_cancel', 'agent.action_retry_now',
  ] as const;
  const LOCALES = Object.keys(translations) as Locale[];

  it('every locale declares every key', () => {
    for (const locale of LOCALES) {
      for (const key of KEYS) {
        expect(translations[locale][key], `${locale}.${key}`).toBeTypeOf('string');
        expect(translations[locale][key]!.length, `${locale}.${key}`).toBeGreaterThan(0);
      }
    }
  });

  it('keeps every placeholder the status card interpolates', () => {
    for (const locale of LOCALES) {
      expect(translations[locale]['agent.dock_retrying'], locale).toContain('{s}');
      expect(translations[locale]['agent.dock_on_map'], locale).toContain('{name}');
      for (const key of ['agent.dock_try_of', 'agent.dock_step_of'] as const) {
        expect(translations[locale][key], `${locale}.${key}`).toContain('{n}');
        expect(translations[locale][key], `${locale}.${key}`).toContain('{m}');
      }
      for (const key of ['agent.dock_thoughts', 'agent.dock_reads', 'agent.dock_after_tries'] as const) {
        expect(translations[locale][key], `${locale}.${key}`).toContain('{n}');
      }
      for (const key of ['agent.dock_setup_shaped'] as const) {
        expect(translations[locale][key], `${locale}.${key}`).toContain('{name}');
      }
    }
  });

  it('no value uses an em dash or a dot separator', () => {
    for (const locale of LOCALES) {
      for (const key of KEYS) {
        expect(translations[locale][key], `${locale}.${key}`).not.toMatch(/[—·•]/);
      }
    }
  });

  it('says the state in the active locale', () => {
    useEditorStore.setState({ locale: 'zh' });
    const { getByTestId } = renderWithI18n(<DeskHeader view={FACES.thinking!.view} now={0} />);
    expect(getByTestId('dock-sentence').textContent).toBe(translations.zh['agent.dock_thinking']);
  });
});

describe('the right column: ink for a seat control, muted for the gear alone', () => {
  it('paints the seat house ink and the resting gear the muted door tone', () => {
    const { getByTestId } = renderFace('executing');
    expect(asColor(getByTestId('dock-seat').style.color)).toBe(asColor(INK));
    expect(asColor(getByTestId('dock-gear').style.color)).toBe(asColor(MUTED));
  });

  /** The manage face carries no gear at all. A door drawn on the room it opens into is a second exit
   *  for one act, and that card's own Done is the way out; every other connected face keeps it. */
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
      expect(card.parentElement!.style.pointerEvents).not.toBe('none');
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

    // Same state, only the clock moved: `deskFaceKey` answers the same string, so the card must
    // stand as the one node rather than turning. `mode="wait"` keeps a genuinely exiting node
    // mounted until its leave finishes, which would mask a spurious key change checked right away
    // (the stale node would still read back as `before`) — so the check waits out a full flip's own
    // leave-then-enter length first, long enough for an unwanted turn to have already replaced it.
    rerender(<DeskHeader view={FACES.executing!.view} now={5_000} />);
    await new Promise((resolve) => { setTimeout(resolve, 700); });
    expect(getByTestId('dock')).toBe(before);

    // A genuine state change answers a different key. `mode="wait"` holds the arriving face off the
    // DOM until the leave finishes, hence the wait rather than a synchronous assertion.
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
    // No fuse and no digit: there is no clock on this face to draw.
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

  /** Pressing "Enter a key" drops the refused key, which is the whole point of the press, so the
   *  card must not land on the sleeping face — neither of the trouble family's two sentences. */
  it('lands the fix-key act on its own sentence rather than on the sleeping face', () => {
    const { getByTestId } = renderWithI18n(
      <DeskHeader view={refused} connected={false} now={0} providerName="Anthropic" />,
    );
    expect(getByTestId('dock-sentence').textContent)
      .toBe(translations.en['agent.dock_err_key_missing']);
    expect(getByTestId('dock-act').textContent).toBe(translations.en['agent.dock_act_fix_key']);
    expect(getByTestId('dock-datum').textContent).toBe('Anthropic');
    // It is the same trouble family: the danger paper, the warning glyph, and no seat to press —
    // the job has settled, so there is nothing left to stop, key or no key.
    expect(getByTestId('dock').dataset.paper).toBe('danger');
    expect(deskSeat(refused, { connected: false })).toBeNull();
  });

  it('turns the card between the two, since they are two states and not one repaint', () => {
    expect(deskFaceKey(refused, { connected: true }))
      .not.toBe(deskFaceKey(refused, { connected: false }));
  });

  /**
   * A keyless incident never offers a doomed retry, whatever its class.
   *
   * `try-again` files the same order again, and with nothing in the vault the one thing a second
   * attempt can produce is a fresh auth failure — so a quota or network incident that arrived with no
   * key put up a press that could only make things worse. Every keyless incident's act is the key.
   */
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

  /** The retry ring hangs outside its pill and the card clips, so the action line keeps its clearance. */
  it('stands an act face\'s words at the ring\'s clearance', () => {
    const act = renderFace('error.auth');
    expect(act.getByTestId('dock-deck-word').parentElement!.style.paddingTop).toBe('10px');
  });

  /** `border-box` keeps the padded, full-height action column inside the 74px card. */
  it('keeps the action face\'s own column inside the card', () => {
    const act = renderFace('error.auth');
    const column = act.getByTestId('dock-col-words');
    expect(column.style.boxSizing).toBe('border-box');
    expect(column.style.height).toBe('100%');
  });

  /** The compact datum keeps its width; ellipsis is the final fallback for a clipped card. */
  it('keeps the datum at its own width', () => {
    const { getByTestId } = renderWithI18n(<DeskHeader view={FACES.retrying!.view} now={RETRY_MID} />);
    const datum = getByTestId('dock-datum');
    expect(datum.style.flexShrink).toBe('0');
    expect(datum.style.textOverflow).toBe('ellipsis');
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

/** A new face turns the card. */
describe('the card turns between faces', () => {
  function NeverWrapper({ children }: { children: React.ReactNode }) {
    return (
      <MotionConfig reducedMotion="never">
        <I18nProvider>{children}</I18nProvider>
      </MotionConfig>
    );
  }

  /** A flipped-in control must not land under a stationary cursor: the turn puts a different verb in
   *  the same box, so the card takes no pointer events for the length of it. */
  it('takes no pointer events while it is turning, and takes them again after', async () => {
    const { getByTestId, rerender } = render(<DeskHeader view={FACES.executing!.view} now={0} />, {
      wrapper: NeverWrapper,
    });
    const turning = () => getByTestId('dock').parentElement!.style.pointerEvents;
    // The first face was not turned to: nothing landed under anything.
    expect(turning()).toBe('');

    const standing = getByTestId('dock');
    rerender(<DeskHeader view={FACES.paused!.view} now={0} />);
    // `mode="wait"` holds the arriving face off the DOM until the leave finishes, and the arriving
    // face is the one the guard is for — the departing one is the face the hand already pressed.
    await waitFor(() => expect(getByTestId('dock')).not.toBe(standing));
    expect(turning()).toBe('none');
    await waitFor(() => expect(turning()).toBe(''), { timeout: 2_000 });
  });
});

/**
 * The meta deck is two tones, and which one a word wears says what kind of thing it is: the state's
 * own fact darker, the figures beside it receding. One tone over both flattened the distinction and
 * left the fact reading lighter than the numbers it explains.
 */
describe('the meta deck s two tones', () => {
  it('paints the fact darker than the figures beside it', () => {
    const stepping = makeView({
      phase: 'executing',
      current: makeJob({ plan: { stages: PLAN, currentIndex: 1, doneCount: 1, revision: 1 } }),
    });
    const { getByTestId } = renderWithI18n(<DeskHeader view={stepping} now={5_000} />);
    const deck = getByTestId('dock-deck-meta');
    expect(asColor(deck.style.color)).toBe(asColor(metaInk.fact));
    expect(asColor(getByTestId('dock-elapsed').style.color)).toBe(asColor(metaInk.figure));
    expect(asColor(metaInk.fact)).not.toBe(asColor(metaInk.figure));
  });

  it('softens the fact on the danger paper, where the word must lead', () => {
    const { getByTestId } = renderWithI18n(
      <DeskHeader view={FACES['error.auth']!.view} now={0} />,
    );
    expect(asColor(getByTestId('dock-deck-meta').style.color)).toBe(asColor(metaInk.danger));
    expect(asColor(getByTestId('dock-sentence').style.color ?? ''))
      .not.toBe(asColor(metaInk.danger));
  });
});
