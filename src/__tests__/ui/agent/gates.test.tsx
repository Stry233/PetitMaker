// @vitest-environment jsdom
/**
 * The gate family (the ask card, the plan gate, the question's quick row, the option pick) and one
 * banner for every trouble class. `BANNER_CLASSES` is read off `Banner.tsx`'s table, which is typed
 * over every class, so a forgotten one fails `tsc`. Copy assertions run over every locale.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { translations } from '../../_support/locale-tables';
import { GateBlock, VerdictChip, QuickRow, markFor } from '../../../ui/agent/record/GateBlock';
import { PlanGate } from '../../../ui/agent/record/PlanGate';
import { OptionPick, optionAskFrom, type OptionAsk } from '../../../ui/agent/record/OptionPick';
import { PanelShell } from '../../../ui/agent/PanelShell';
import { Banner, BANNER_CLASSES, type BannerActionId, type BannerClass } from '../../../ui/agent/desk/Banner';
import { useEditorStore } from '../../../state/store';
import { useAgentConnection } from '../../../agent/connection/store';
import { PROVIDER_IDS, type ProviderId } from '../../../agent/providers/defaults';
import { append, createLog } from '../../../agent/core/log';
import { deriveView } from '../../../agent/core/project-view';
import { submitComposer } from '../../../agent/session/composer-routing';
import type { AskRecord, JobView } from '../../../agent/core/project-view';
import type { Locale } from '../../../core/model/locale';
import { makeView, panelProps, renderWithI18n } from '../../_support/agent-panel';

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
  useAgentConnection.setState({
    provider: 'claude',
    model: Object.fromEntries(PROVIDER_IDS.map((id) => [id, ''])) as Record<ProviderId, string>,
    oversight: 'checkpoint', customBaseUrl: '', keyed: ['claude'], hydrated: true,
  });
});

function makeAsk(over: Partial<AskRecord> = {}): AskRecord {
  return { gateId: 'gate-1', scope: 'tool', summary: 'Pave a stone road from the plaza to the mill', ...over };
}

describe('the ask card stands on the plate under a retiring spine', () => {
  it('renders nothing when the ask is undefined (a settled job leaves no stale gate)', () => {
    const { container } = renderWithI18n(<GateBlock ask={undefined} onAnswer={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the summary sentence as-is, and the thumbnail slot only when one is given', () => {
    const { getByTestId, queryByTestId, unmount } = renderWithI18n(
      <GateBlock ask={makeAsk({ summary: 'Clear 6 objects at the crossing' })} onAnswer={() => {}} />,
    );
    expect(getByTestId('gate-summary').textContent).toBe('Clear 6 objects at the crossing');
    expect(queryByTestId('gate-thumb')).toBeNull();
    unmount();

    const withThumb = renderWithI18n(
      <GateBlock ask={makeAsk()} thumb={<svg data-testid="route-svg" />} onAnswer={() => {}} />,
    );
    expect(withThumb.getByTestId('gate-thumb').querySelector('[data-testid="route-svg"]')).not.toBeNull();
  });

  it('[ASST-17] calls onAnswer with allow and skip from the two controls, and offers neither once settled', () => {
    const seen: string[] = [];
    const { getByTestId, unmount } = renderWithI18n(
      <GateBlock ask={makeAsk()} onAnswer={(a) => seen.push(a)} />,
    );
    fireEvent.click(getByTestId('gate-approve'));
    fireEvent.click(getByTestId('gate-skip'));
    expect(seen).toEqual(['allow', 'skip']);
    unmount();

    const settled = renderWithI18n(<GateBlock ask={makeAsk({ verdict: 'declined' })} onAnswer={() => {}} />);
    expect(settled.queryByTestId('gate-approve')).toBeNull();
    expect(settled.queryByTestId('gate-skip')).toBeNull();
  });

  /** The loop that would receive the answer is not waiting, so a button would land nowhere. */
  it('shows no controls on an open ask that cannot be answered', () => {
    const { queryByTestId, getByTestId } = renderWithI18n(
      <GateBlock ask={makeAsk()} answerable={false} onAnswer={() => {}} />,
    );
    expect(getByTestId('gate-summary')).toBeDefined();
    expect(queryByTestId('gate-approve')).toBeNull();
    expect(queryByTestId('gate-quick-row')).toBeNull();
  });
});

describe('the verdict chip', () => {

  it('says each verdict in its own words', () => {
    const said: Record<string, string> = {};
    for (const verdict of ['approved', 'approved-always', 'declined', 'words', 'unanswered'] as const) {
      const { getByTestId, unmount } = renderWithI18n(<VerdictChip verdict={verdict} />);
      said[verdict] = getByTestId('gate-verdict').textContent ?? '';
      unmount();
    }
    expect(said.approved).toBe('approved');
    expect(said['approved-always']).toBe('approved, always');
    expect(said.declined).toBe('you said no');
    expect(said.words).toBe('answered in words');
    expect(said.unanswered).toBe('unanswered when stopped');
  });

  it('names the quick answer it was given', () => {
    const { getByTestId } = renderWithI18n(<VerdictChip verdict="quick" word="Yes" />);
    expect(getByTestId('gate-verdict').textContent).toBe('answered: Yes');
  });

  /** A tapped pill and a typed sentence both reach the loop as `words`; only the card can tell them
   *  apart, by matching what it offered. */
  it('reads a words answer that is one of its own quick pills as a quick answer', () => {
    expect(markFor(makeAsk({ verdict: 'words', words: 'Yes' }), ['Yes', 'No'])).toBe('quick');
    expect(markFor(makeAsk({ verdict: 'words', words: 'stop at the meadow' }), ['Yes', 'No'])).toBe('words');
    expect(markFor(makeAsk())).toBeUndefined();
  });
});

describe('the quick row keeps its box', () => {

  it('sends the pill the user pressed as the answer', () => {
    let said: string | undefined;
    const { getAllByTestId } = renderWithI18n(
      <QuickRow answers={['Yes', 'No', 'You decide']} onAnswer={(a) => { said = a; }} />,
    );
    const pills = getAllByTestId('gate-quick');
    expect(pills.map((p) => p.textContent)).toEqual(['Yes', 'No', 'You decide']);
    fireEvent.click(pills[2]!);
    expect(said).toBe('You decide');
  });

  it('renders the question form with the quick row and no Approve pair', () => {
    const { queryByTestId, getByTestId } = renderWithI18n(
      <GateBlock
        ask={makeAsk({ summary: 'Should the stream reach the south beach?' })}
        actions={false}
        quick={['Yes', 'No', 'You decide']}
        onAnswer={() => {}}
        onQuick={() => {}}
      />,
    );
    expect(queryByTestId('gate-actions')).toBeNull();
    expect(getByTestId('gate-quick-row')).toBeDefined();
  });
});

const HILL_STAGES = [
  { label: 'Shape the ridge' },
  { label: 'Carve the stream', checkpoint: true },
  { label: 'Plant the grove' },
  { label: 'Lay the lanes', checkpoint: true },
];

describe('the plan gate lists what it is asking about', () => {
  it('lists every stage with its bead, and flags the checkpoints', () => {
    const { getAllByTestId, getByTestId } = renderWithI18n(
      <PlanGate ask={makeAsk({ scope: 'plan', stages: HILL_STAGES })} onAnswer={() => {}} />,
    );
    const rows = getAllByTestId('plan-stage');
    expect(rows.map((r) => r.textContent)).toEqual([
      '1Shape the ridge', '2Carve the stream', '3Plant the grove', '4Lay the lanes',
    ]);
    expect(rows.filter((r) => r.getAttribute('data-checkpoint') === 'true')).toHaveLength(2);
    expect(getAllByTestId('plan-flag')).toHaveLength(2);
    expect(getByTestId('plan-stat').textContent).toBe('4 stages, 2 checkpoints');
  });

  it('drops the checkpoint half of the stat, and the flag note, when there are none', () => {
    const { getByTestId, queryAllByTestId, getAllByTestId } = renderWithI18n(
      <PlanGate ask={makeAsk({ scope: 'plan', stages: [{ label: 'Shape the ridge' }] })} onAnswer={() => {}} />,
    );
    expect(getByTestId('plan-stat').textContent).toBe('1 stage');
    expect(queryAllByTestId('plan-flag')).toHaveLength(0);
    expect(getAllByTestId('plan-note')).toHaveLength(1);
  });

  it('files on Approve, holds on Not this plan, and wears its verdict once answered', () => {
    const seen: string[] = [];
    const { getByTestId, unmount } = renderWithI18n(
      <PlanGate ask={makeAsk({ scope: 'plan', stages: HILL_STAGES })} onAnswer={(a) => seen.push(a)} />,
    );
    expect(getByTestId('gate-skip').textContent).toBe('Not this plan');
    fireEvent.click(getByTestId('gate-approve'));
    fireEvent.click(getByTestId('gate-skip'));
    expect(seen).toEqual(['allow', 'skip']);
    unmount();

    const settled = renderWithI18n(
      <PlanGate ask={makeAsk({ scope: 'plan', stages: HILL_STAGES, verdict: 'declined' })} onAnswer={() => {}} />,
    );
    expect(settled.getByTestId('plan-gate').getAttribute('data-settled')).toBe('true');
    expect(settled.getByTestId('gate-verdict').textContent).toBe('you said no');
    expect(settled.queryByTestId('gate-approve')).toBeNull();
    // A declined plan keeps its list as the one record of what was turned down; the notes go.
    expect(settled.getAllByTestId('plan-stage')).toHaveLength(4);
    expect(settled.queryAllByTestId('plan-note')).toHaveLength(0);
  });

  it('an approved plan collapses to its receipt: the stat and the verdict, no second stage list', () => {
    const { getByTestId, queryAllByTestId } = renderWithI18n(
      <PlanGate ask={makeAsk({ scope: 'plan', stages: HILL_STAGES, verdict: 'approved' })} onAnswer={() => {}} />,
    );
    expect(getByTestId('plan-gate').getAttribute('data-settled')).toBe('true');
    expect(getByTestId('plan-stat').textContent).toBe('4 stages, 2 checkpoints');
    expect(getByTestId('gate-verdict').getAttribute('data-verdict')).toBe('approved');
    expect(queryAllByTestId('plan-stage')).toHaveLength(0);
    expect(queryAllByTestId('plan-note')).toHaveLength(0);
  });
});

function makeOptions(over: Partial<OptionAsk> = {}): OptionAsk {
  return {
    gateId: 'gate-opt',
    question: 'Three shapes would fit here. Which one should I build?',
    cards: [{ cap: 'Cove, two bridges' }, { cap: 'Highland lake' }, { cap: 'Split river delta' }],
    ...over,
  };
}

describe('the option pick', () => {
  it('offers every card live and picks by index', () => {
    let picked: number | undefined;
    const { getAllByTestId } = renderWithI18n(
      <OptionPick ask={makeOptions()} onPick={(i) => { picked = i; }} onDecline={() => {}} />,
    );
    const cards = getAllByTestId('option-card') as HTMLButtonElement[];
    expect(cards).toHaveLength(3);
    expect(cards.every((c) => !c.disabled)).toBe(true);
    fireEvent.click(cards[1]!);
    expect(picked).toBe(1);
  });

  it('disables every card for real once one is picked, and marks the pick with the ink ring', () => {
    const { getAllByTestId, getByTestId } = renderWithI18n(
      <OptionPick ask={makeOptions({ picked: 1 })} onPick={() => {}} onDecline={() => {}} />,
    );
    const cards = getAllByTestId('option-card') as HTMLButtonElement[];
    expect(cards.every((c) => c.disabled)).toBe(true);
    const pick = cards[1]!;
    expect(pick.getAttribute('data-picked')).toBe('true');
    expect(getByTestId('option-mark').textContent).toBe('picked');
  });

  it('declines with None of these, and says so on the settled card', () => {
    let declined = false;
    const { getByTestId, unmount } = renderWithI18n(
      <OptionPick ask={makeOptions()} onPick={() => {}} onDecline={() => { declined = true; }} />,
    );
    fireEvent.click(getByTestId('option-none'));
    expect(declined).toBe(true);
    unmount();

    const held = renderWithI18n(
      <OptionPick ask={makeOptions({ verdict: 'none-held' })} onPick={() => {}} onDecline={() => {}} />,
    );
    expect(held.getByTestId('gate-verdict').textContent).toBe('none taken, holding');
    expect(held.queryByTestId('option-none')).toBeNull();
    expect(held.getByTestId('option-pick').getAttribute('data-settled')).toBe('true');
  });
});

function makeJob(over: Partial<JobView> = {}): JobView {
  return {
    orderSeq: 1, orderText: 'Connect the plaza to the old mill', orderAt: 0,
    asks: [], ops: [], steerNotes: [], checkpoints: [], stamps: [], celebrate: false, skills: [],
    ...over,
  };
}

const VERBS = { onSend: () => {}, onStop: () => {}, onPause: () => {}, onGateAnswer: () => {} };

describe('an answered gate goes on standing in the record', () => {
  /** `PanelView.gate` is the question that can still be answered; the ask record outlives it. */
  it('folds each ask with the verdict its answer implies, and marks an unanswered one at settle', () => {
    const log = createLog();
    append(log, { kind: 'order', text: 'Connect the plaza to the old mill', mapContext: '' });
    append(log, { kind: 'assistant', stop: 'tool-calls', parts: [{ kind: 'tool', callId: 'c1', name: 'build_road', input: {}, argsDone: true }] });
    append(log, { kind: 'gateAsked', gateId: 'g1', scope: 'tool', callId: 'c1', summary: 'Pave the mill road' });
    append(log, { kind: 'gateAnswered', gateId: 'g1', answer: 'skip' });
    append(log, { kind: 'assistant', stop: 'tool-calls', parts: [{ kind: 'tool', callId: 'c2', name: 'place_object', input: {}, argsDone: true }] });
    append(log, { kind: 'gateAsked', gateId: 'g2', scope: 'tool', callId: 'c2', summary: 'Place the mill house' });

    const open = deriveView(log);
    expect(open.current!.asks.map((a) => [a.gateId, a.verdict])).toEqual([['g1', 'declined'], ['g2', undefined]]);
    expect(open.gate?.gateId).toBe('g2');

    append(log, { kind: 'jobEnd', outcome: 'aborted' });
    const done = deriveView(log);
    expect(done.jobs[0]!.asks.map((a) => a.verdict)).toEqual(['declined', 'unanswered']);
    expect(done.gate).toBeUndefined();
  });

  it('reads a plan ask stages off the update_plan call it is holding, before any plan is filed', () => {
    const log = createLog();
    append(log, { kind: 'order', text: 'Build a hillside village', mapContext: '' });
    append(log, {
      kind: 'assistant', stop: 'tool-calls',
      parts: [{
        kind: 'tool', callId: 'p1', name: 'update_plan', argsDone: true,
        input: { stages: [{ label: 'Shape the ridge' }, { label: 'Carve the stream', checkpoint: true }] },
      }],
    });
    append(log, { kind: 'gateAsked', gateId: 'g1', scope: 'plan', callId: 'p1', summary: '2 stages: Shape the ridge, Carve the stream' });

    const view = deriveView(log);
    const ask = view.current!.asks[0]!;
    expect(ask.scope).toBe('plan');
    expect(ask.stages).toEqual([{ label: 'Shape the ridge' }, { label: 'Carve the stream', checkpoint: true }]);
    expect(view.current!.plan).toBeUndefined();
  });

  it('keeps the answered card mounted, after the ticket, while the job goes on', () => {
    const view = makeView({
      phase: 'executing',
      current: makeJob({
        asks: [makeAsk({ gateId: 'g1', verdict: 'approved', summary: 'Pave the mill road' })],
        ops: [
          { callId: 'c1', name: 'build_road', status: 'ok', summary: 'Laid the mill road', isRead: false },
          { callId: 'c2', name: 'place_object', status: 'run', summary: '', isRead: false },
        ],
      }),
    });
    const { getByTestId } = renderWithI18n(
      <PanelShell {...panelProps({ view, connected: true, now: 0, ...VERBS })} />,
    );
    const card = getByTestId('gate-block');
    const ticket = getByTestId('job-ticket');
    expect(getByTestId('gate-verdict').textContent).toBe('approved');
    expect(ticket.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  /**
   * The gate is suppressed while paused, but the card stands, so a reload mid-approval still shows
   * what was asked and that Resume brings it back (`job-reads.ts:existingGateId` re-enters the same
   * ask rather than asking twice).
   */
  it('holds an unanswered ask visibly, with no controls, when the projection publishes no gate', () => {
    const view = makeView({
      phase: 'paused',
      current: makeJob({ asks: [makeAsk({ gateId: 'g1', summary: 'May I pave the north lane?' })] }),
    });
    const { getByTestId, queryByTestId } = renderWithI18n(
      <PanelShell {...panelProps({ view, connected: true, now: 0, ...VERBS })} />,
    );
    expect(getByTestId('gate-block')).toBeTruthy();
    expect(getByTestId('gate-summary').textContent).toBe('May I pave the north lane?');
    expect(getByTestId('gate-held').textContent).toBe('Resume the job to answer this.');
    expect(queryByTestId('gate-approve')).toBeNull();
    expect(queryByTestId('gate-skip')).toBeNull();
    expect(queryByTestId('gate-verdict')).toBeNull();
  });

  it('says on the status card that a question is waiting, over a paused job holding one', () => {
    const view = makeView({
      phase: 'paused',
      current: makeJob({
        asks: [makeAsk({ gateId: 'g1' })],
        plan: { stages: [{ label: 'a' }, { label: 'b' }], currentIndex: 1, doneCount: 1, revision: 1 },
      }),
    });
    const { getByTestId } = renderWithI18n(<PanelShell {...panelProps({ view, connected: true, now: 0, ...VERBS })} />);
    expect(getByTestId('dock-meta').textContent).toBe(translations.en['agent.dock_question_held']);
  });

  /**
   * A hold has no step in progress, so the dock reads the banked count, and only the bare figure: the
   * pausemark chip below already says "paused after step 1 of 2" in full.
   */
  it('says the step count again once the held ask has been answered, tersely', () => {
    const view = makeView({
      phase: 'paused',
      current: makeJob({
        asks: [makeAsk({ gateId: 'g1', verdict: 'approved' })],
        plan: { stages: [{ label: 'a' }, { label: 'b' }], currentIndex: 1, doneCount: 1, revision: 1 },
      }),
    });
    const { getByTestId } = renderWithI18n(<PanelShell {...panelProps({ view, connected: true, now: 0, ...VERBS })} />);
    expect(getByTestId('dock-meta').textContent).toBe('1 of 2');
  });
});

describe('an ask carrying quick answers is a question, not an approval', () => {
  /** Only the offer distinguishes "Two lanes or one?" from "may I pave this road?" on the log. */
  function questionLog() {
    const log = createLog();
    append(log, { kind: 'order', text: 'Lay a road to the mill', mapContext: '' });
    append(log, {
      kind: 'gateAsked', gateId: 'g1', scope: 'tool', summary: 'Two lanes or one?',
      quickAnswers: ['Two lanes', 'One lane', 'You decide'],
    });
    return log;
  }

  it('drops the approve pair for the quick row, live from the fold', () => {
    const view = deriveView(questionLog());
    const { getByTestId, queryByTestId, getAllByTestId } = renderWithI18n(
      <PanelShell {...panelProps({ view, connected: true, now: 0, ...VERBS })} />,
    );
    expect(getByTestId('gate-summary').textContent).toBe('Two lanes or one?');
    expect(queryByTestId('gate-approve')).toBeNull();
    expect(getAllByTestId('gate-quick').map((el) => el.textContent))
      .toEqual(['Two lanes', 'One lane', 'You decide']);
  });

  it('answers in words with the pill\'s own text', () => {
    const view = deriveView(questionLog());
    const calls: [string, string, string | undefined][] = [];
    const { getAllByTestId } = renderWithI18n(
      <PanelShell {...panelProps({
        view,
        connected: true,
        now: 0,
        ...VERBS,
        onGateAnswer: (gateId, answer, words) => calls.push([gateId, answer, words]),
      })}
      />,
    );
    fireEvent.click(getAllByTestId('gate-quick')[1]!);
    expect(calls).toEqual([['g1', 'words', 'One lane']]);
  });

  it('reads a matching answer back as the quick answer it was', () => {
    const log = questionLog();
    append(log, { kind: 'gateAnswered', gateId: 'g1', answer: 'words', words: 'One lane' });
    const ask = deriveView(log).current!.asks[0]!;
    expect(markFor(ask, ask.quickAnswers)).toBe('quick');

    const other = questionLog();
    append(other, { kind: 'gateAnswered', gateId: 'g1', answer: 'words', words: 'go round the hill' });
    const typed = deriveView(other).current!.asks[0]!;
    expect(markFor(typed, typed.quickAnswers)).toBe('words');
  });
});

describe('an ask carrying options is a pick', () => {
  function pickLog() {
    const log = createLog();
    append(log, { kind: 'order', text: 'Put the village somewhere good', mapContext: '' });
    append(log, {
      kind: 'gateAsked', gateId: 'g1', scope: 'tool', summary: 'Which shore?',
      options: [
        { cap: 'The north shore', rect: { x1: 70, y1: 50, x2: 90, y2: 70 } },
        { cap: 'The bay' },
      ],
    });
    return log;
  }

  it('stands the pick card in place of the gate block, live from the fold', () => {
    const view = deriveView(pickLog());
    const { getByTestId, queryByTestId, getAllByTestId } = renderWithI18n(
      <PanelShell {...panelProps({ view, connected: true, now: 0, ...VERBS })} />,
    );
    expect(queryByTestId('gate-block')).toBeNull();
    expect(getByTestId('option-question').textContent).toBe('Which shore?');
    expect((getAllByTestId('option-card') as HTMLButtonElement[]).map((c) => c.textContent))
      .toEqual(['The north shore', 'The bay']);
  });

  it('sends the chosen caption as the gate words, and declines with skip', () => {
    const view = deriveView(pickLog());
    const calls: [string, string, string | undefined][] = [];
    const { getAllByTestId, getByTestId } = renderWithI18n(
      <PanelShell {...panelProps({
        view,
        connected: true,
        now: 0,
        ...VERBS,
        onGateAnswer: (gateId, answer, words) => calls.push([gateId, answer, words]),
      })}
      />,
    );
    fireEvent.click(getAllByTestId('option-card')[0]!);
    fireEvent.click(getByTestId('option-none'));
    expect(calls).toEqual([['g1', 'words', 'The north shore'], ['g1', 'skip', undefined]]);
  });

  /** The log holds only the sentence, so the index is recovered from it. */
  it('reads the settled card back as the pick it was, and a typed answer as none of these', () => {
    const picked = pickLog();
    append(picked, { kind: 'gateAnswered', gateId: 'g1', answer: 'words', words: 'The bay' });
    expect(optionAskFrom(deriveView(picked).current!.asks[0]!)?.picked).toBe(1);

    const typed = pickLog();
    append(typed, { kind: 'gateAnswered', gateId: 'g1', answer: 'words', words: 'further up the river' });
    const off = optionAskFrom(deriveView(typed).current!.asks[0]!);
    expect(off?.picked).toBeUndefined();
    expect(off?.verdict).toBe('none-words');

    const declined = pickLog();
    append(declined, { kind: 'gateAnswered', gateId: 'g1', answer: 'skip' });
    expect(optionAskFrom(deriveView(declined).current!.asks[0]!)?.verdict).toBe('none-held');

    const cut = pickLog();
    append(cut, { kind: 'jobEnd', outcome: 'aborted' });
    expect(optionAskFrom(deriveView(cut).jobs[0]!.asks[0]!)?.verdict).toBe('unanswered');
  });

  it('answers an ask that offered none with no pick card at all', () => {
    expect(optionAskFrom(makeAsk())).toBeUndefined();
  });

});

describe('typed words at a gate', () => {
  it('demotes the ask card primary once the field holds words, and restores it when it empties', () => {
    const view = makeView({
      phase: 'gated',
      current: makeJob({ asks: [makeAsk({ gateId: 'g1' })] }),
      gate: { gateId: 'g1', scope: 'tool', summary: 'Pave a stone road from the plaza to the mill' },
    });
    const { getByTestId } = renderWithI18n(<PanelShell {...panelProps({ view, connected: true, now: 0, ...VERBS })} />);
    const approve = getByTestId('gate-approve');
    expect(approve.getAttribute('data-demoted')).toBe('false');

    fireEvent.change(getByTestId('composer-input'), { target: { value: 'stop at the meadow instead' } });
    expect(approve.getAttribute('data-demoted')).toBe('true');

    fireEvent.change(getByTestId('composer-input'), { target: { value: '   ' } });
    expect(approve.getAttribute('data-demoted')).toBe('false');
  });

  /** A tapped pill would leave `gated` and re-aim the typed sentence from an answer into a steer. */
  it('demotes the quick pills once the field holds words, and keeps the typed sentence', () => {
    const view = makeView({
      phase: 'gated',
      current: makeJob({ asks: [makeAsk({ gateId: 'g1', quickAnswers: ['north', 'south'] })] }),
      gate: { gateId: 'g1', scope: 'tool', summary: 'Which shore?' },
    });
    const { getAllByTestId, getByTestId } = renderWithI18n(
      <PanelShell {...panelProps({ view, connected: true, now: 0, ...VERBS })} />,
    );
    const pills = getAllByTestId('gate-quick');
    expect(pills.map((el) => el.getAttribute('data-demoted'))).toEqual(['false', 'false']);

    const field = getByTestId('composer-input') as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: 'the eastern one actually' } });
    expect(getAllByTestId('gate-quick').map((el) => el.getAttribute('data-demoted')))
      .toEqual(['true', 'true']);

    fireEvent.change(field, { target: { value: '  ' } });
    expect(getAllByTestId('gate-quick').map((el) => el.getAttribute('data-demoted')))
      .toEqual(['false', 'false']);
  });

  /** A sentence typed at a gate cancels the call and becomes one `gateAnswered` with the words on it. */
  it('routes the submission as the gate words answer', () => {
    const log = createLog();
    append(log, { kind: 'order', text: 'Connect the plaza to the old mill', mapContext: '' });
    append(log, { kind: 'assistant', stop: 'tool-calls', parts: [{ kind: 'tool', callId: 'c1', name: 'build_road', input: {}, argsDone: true }] });
    append(log, { kind: 'gateAsked', gateId: 'g1', scope: 'tool', callId: 'c1', summary: 'Pave the mill road' });

    const before = deriveView(log);
    expect(before.phase).toBe('gated');
    const out = submitComposer(log, before.phase, 'take the north lane instead');
    expect(out.route).toBe('gate-words');

    const after = deriveView(log);
    const ask = after.current!.asks[0]!;
    expect(ask.verdict).toBe('words');
    expect(ask.words).toBe('take the north lane instead');
    expect(after.gate).toBeUndefined();
    expect(markFor(ask)).toBe('words');
  });
});

describe('Banner: one banner for every trouble class', () => {
  it('BANNER_CLASSES is non-empty and every listed class renders an icon, a paper and at most 2 actions', () => {
    expect(BANNER_CLASSES.length).toBeGreaterThan(0);
    for (const cls of BANNER_CLASSES) {
      const { getByTestId, queryAllByTestId, unmount } = renderWithI18n(<Banner cls={cls} onAction={() => {}} />);
      const root = getByTestId('banner');
      expect(root.getAttribute('data-paper')).toMatch(/^(danger|wait)$/);
      expect(getByTestId('banner-icon')).toBeDefined();
      // A notice offers no answer: the rollback notices are standing facts, and the key-gone ones
      // leave their answers to the held job's card right under them.
      const notice = cls === 'other-map' || cls === 'unknown-map'
        || cls === 'key-cleared' || cls === 'key-clearing';
      const actions = queryAllByTestId('banner-action');
      expect(actions.length, cls).toBeGreaterThanOrEqual(notice ? 0 : 1);
      expect(actions.length, cls).toBeLessThanOrEqual(2);
      unmount();
    }
  });

  it('gives each rollback notice no action row, on the wait paper, under the frame glyph', () => {
    for (const cls of ['other-map', 'unknown-map'] as const) {
      const { getByTestId, queryAllByTestId, unmount } = renderWithI18n(<Banner cls={cls} onAction={() => {}} />);
      expect(getByTestId('banner').getAttribute('data-paper'), cls).toBe('wait');
      expect(getByTestId('banner-icon').querySelector('use')?.getAttribute('href'), cls).toBe('#pw-region-frame');
      expect(queryAllByTestId('banner-action').length, cls).toBe(0);
      unmount();
    }
  });

  it('terminal classes (auth, quota, cors, incident) paint the danger paper; recoverable ones (network, storage) paint wait', () => {
    const terminal: BannerClass[] = ['auth', 'quota', 'cors', 'overflow', 'abort', 'unknown'];
    const recoverable: BannerClass[] = [
      'network', 'rate-limit', 'overloaded', 'storage-pruned', 'storage-full', 'storage-corrupt',
    ];
    for (const cls of terminal) {
      const { getByTestId, unmount } = renderWithI18n(<Banner cls={cls} onAction={() => {}} />);
      expect(getByTestId('banner').getAttribute('data-paper')).toBe('danger');
      unmount();
    }
    for (const cls of recoverable) {
      const { getByTestId, unmount } = renderWithI18n(<Banner cls={cls} onAction={() => {}} />);
      expect(getByTestId('banner').getAttribute('data-paper')).toBe('wait');
      unmount();
    }
  });

  it('auth wears the key icon and offers a fix-key action', () => {
    const { getByTestId, getAllByTestId } = renderWithI18n(<Banner cls="auth" onAction={() => {}} />);
    expect(getByTestId('banner-icon').querySelector('use')?.getAttribute('href')).toBe('#pw-key');
    const ids = getAllByTestId('banner-action').map((el) => el.getAttribute('data-action'));
    expect(ids).toContain('fix-key');
  });

  it('quota wears the wallet icon', () => {
    const { getByTestId } = renderWithI18n(<Banner cls="quota" onAction={() => {}} />);
    expect(getByTestId('banner-icon').querySelector('use')?.getAttribute('href')).toBe('#pw-wallet');
  });

  it('cors wears the link-out icon', () => {
    const { getByTestId } = renderWithI18n(<Banner cls="cors" onAction={() => {}} />);
    expect(getByTestId('banner-icon').querySelector('use')?.getAttribute('href')).toBe('#pw-link-out');
  });

  it('network wears the cloud-off icon', () => {
    const { getByTestId } = renderWithI18n(<Banner cls="network" onAction={() => {}} />);
    expect(getByTestId('banner-icon').querySelector('use')?.getAttribute('href')).toBe('#pw-cloud-off');
  });

  it('gives each storage reading the warning icon and a sentence of its own', () => {
    const said = new Set<string>();
    for (const cls of ['storage-pruned', 'storage-full', 'storage-corrupt'] as const) {
      const { getByTestId, unmount } = renderWithI18n(<Banner cls={cls} onAction={() => {}} />);
      expect(getByTestId('banner-icon').querySelector('use')?.getAttribute('href'), cls).toBe('#pw-warning');
      said.add(getByTestId('banner').textContent ?? '');
      unmount();
    }
    expect(said.size).toBe(3);
  });

  it('a generic incident (unknown) wears the warning icon', () => {
    const { getByTestId } = renderWithI18n(<Banner cls="unknown" onAction={() => {}} />);
    expect(getByTestId('banner-icon').querySelector('use')?.getAttribute('href')).toBe('#pw-warning');
  });

  it('clicking an action pill calls onAction with that action id', () => {
    let acted: BannerActionId | undefined;
    const { getAllByTestId } = renderWithI18n(<Banner cls="auth" onAction={(a) => (acted = a)} />);
    const fix = getAllByTestId('banner-action').find((el) => el.getAttribute('data-action') === 'fix-key')!;
    fireEvent.click(fix);
    expect(acted).toBe('fix-key');
  });
});

describe('Gate + banner copy: forbidden characters, in every locale', () => {
  /** Every key the gate family renders. */
  const NEW_KEYS = [
    'agent.gate_approve',
    'agent.gate_skip',
    'agent.gate_verdict_approved',
    'agent.gate_verdict_always',
    'agent.gate_verdict_declined',
    'agent.gate_verdict_words',
    'agent.gate_verdict_quick',
    'agent.gate_verdict_picked',
    'agent.gate_verdict_unanswered',
    'agent.gate_verdict_none_held',
    'agent.gate_verdict_none_words',
    'agent.plan_gate_title',
    'agent.plan_gate_stages',
    'agent.plan_gate_flags',
    'agent.plan_gate_note',
    'agent.plan_gate_flagnote',
    'agent.plan_gate_skip',
    'agent.option_none',
    'agent.banner_auth',
    'agent.banner_quota',
    'agent.banner_cors',
    'agent.banner_network',
    'agent.banner_storage_pruned',
    'agent.banner_storage_full',
    'agent.banner_storage_corrupt',
    'agent.banner_incident',
    'agent.banner_action_fix_key',
    'agent.banner_action_change_provider',
    'agent.banner_action_edit_endpoint',
    'agent.banner_action_dismiss',
  ];
  /** The keys that legitimately carry an interpolation slot. */
  const WITH_PARAMS = new Set([
    'agent.gate_verdict_quick',
    'agent.plan_gate_stages',
    'agent.plan_gate_flags',
  ]);
  const locales = Object.keys(translations) as Locale[];

  it('no new key contains an unexpected brace, an em dash, a dot separator, or an uppercase run', () => {
    for (const loc of locales) {
      for (const key of NEW_KEYS) {
        const value = translations[loc][key]!;
        if (!WITH_PARAMS.has(key)) expect(value, `${loc}:${key} has a brace`).not.toMatch(/\{/);
        expect(value, `${loc}:${key} has an em dash`).not.toMatch(/—/);
        expect(value, `${loc}:${key} has a dot separator`).not.toMatch(/[·•]/);
        expect(value, `${loc}:${key} has an uppercase run`).not.toMatch(/[A-Z]{2,}/);
      }
    }
  });
});

describe('Gate + banner: no forbidden characters in rendered output (English)', () => {
  it('every gate-family card renders no brace, em dash or uppercase run', () => {
    const cards = [
      <GateBlock key="a" ask={makeAsk()} onAnswer={() => {}} />,
      <GateBlock key="b" ask={makeAsk({ verdict: 'declined' })} onAnswer={() => {}} />,
      <GateBlock key="c" ask={makeAsk()} actions={false} quick={['Yes', 'No', 'You decide']} onAnswer={() => {}} />,
      <PlanGate key="d" ask={makeAsk({ scope: 'plan', stages: HILL_STAGES })} onAnswer={() => {}} />,
      <OptionPick key="e" ask={makeOptions()} onPick={() => {}} onDecline={() => {}} />,
      <OptionPick key="f" ask={makeOptions({ picked: 0 })} onPick={() => {}} onDecline={() => {}} />,
    ];
    for (const card of cards) {
      const { container, unmount } = renderWithI18n(card);
      const text = container.textContent ?? '';
      expect(text).not.toMatch(/\{/);
      expect(text).not.toMatch(/—/);
      expect(text).not.toMatch(/[A-Z]{2,}/);
      unmount();
    }
  });

  it('Banner renders no brace, em dash or uppercase run, for every class', () => {
    for (const cls of BANNER_CLASSES) {
      const { container, unmount } = renderWithI18n(<Banner cls={cls} onAction={() => {}} />);
      const text = container.textContent ?? '';
      expect(text, cls).not.toMatch(/\{/);
      expect(text, cls).not.toMatch(/—/);
      expect(text, cls).not.toMatch(/[A-Z]{2,}/);
      unmount();
    }
  });
});
