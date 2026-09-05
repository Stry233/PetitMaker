/**
 * answer-paper.test.tsx — the ANSWER FAMILY: a done job that issued no write, and the dance that
 * does not happen for one.
 *
 * THE BOUNDARY IS THE PROJECTION'S, NEVER THIS LAYER'S. `JobView.kind` says what a job turned out to
 * be ('build' the moment a write was ISSUED, whatever became of it; 'answer' when words were the
 * whole product; 'quiet' when there were not even words), and `JobView.celebrate` says whether a
 * write LANDED. Both are decided once in `project-view.ts:settle`, which is what lets the paper, the
 * dock face, the history line and the character all read one answer — so what this file holds is
 * that each surface READS it rather than re-deriving it from ops it can see.
 *
 * FOUR NEGATIVE FIXTURES CARRY THE CELEBRATE RULE, and they are the four ways a job can finish
 * without having built anything: an answer, a refusal, a silent giveup, and a job still waiting on
 * the user's reply. Asserted in BOTH hosts, because both fold the same projection and a rule
 * enforced in one of them is half a rule.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';

import { append } from '../../../agent/core/log';
import type { JobView, OpRow, PanelView } from '../../../agent/core/project-view';
import { useAgentSession } from '../../../agent/session/store';
import { I18nProvider } from '../../../i18n/context';
import { translations } from '../../../i18n/translations';
import type { Locale } from '../../../core/model/types';
import { useEditorStore } from '../../../state/store';
import { AnswerPaper, answerStamp, isAnswerJob } from '../../../ui/agent/AnswerPaper';
import { CharacterHost } from '../../../ui/agent/character/CharacterHost';
import { useCelebrateEdge } from '../../../ui/agent/character/use-celebrate-edge';
import { PanelShell } from '../../../ui/agent/PanelShell';
import { ACTIVE, PLATE_INK } from '../../../ui/design/tokens';
import { colors } from '../../../ui/design/styles';

const backing = new Map<string, string>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).localStorage = {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
};

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="always">
      <I18nProvider>{children}</I18nProvider>
    </MotionConfig>
  );
}

function renderWithI18n(node: React.ReactElement) {
  return render(node, { wrapper: Wrapper });
}

/** jsdom re-serializes every colour as `rgb(...)`, so a token compared as a hex never matches. */
function rgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

function makeView(over: Partial<PanelView> = {}): PanelView {
  return {
    phase: 'idle', jobs: [], queuedSteers: [],
    vitals: { cells: 0, objects: 0, reverts: 0, jobs: 0 },
    suggestion: null, lastEventAt: 0, ...over,
  };
}

function makeJob(over: Partial<JobView> = {}): JobView {
  return {
    orderSeq: 1, orderText: 'What is on my map right now?', orderAt: 0,
    asks: [], ops: [], steerNotes: [], checkpoints: [], stamps: [], celebrate: false, skills: [],
    ...over,
  };
}

function reads(n: number): OpRow[] {
  return Array.from({ length: n }, (_, i) => ({
    callId: `r${i}`, name: 'view_map', status: 'ok' as const, summary: 'Read the shore', isRead: true,
  }));
}

/* ── the four fixtures, as the projection would settle them ────────────────── */

/** A map question answered from reads alone. */
const ANSWER = makeJob({
  orderSeq: 4, kind: 'answer', outcome: 'done', ops: reads(3),
  summary: 'About 214 flat cells, in two shelves. Enough for a village of six houses and a lane.',
});

/** A refusal: the order asked for something off the map, and the model declined in one text turn. */
const REFUSED = makeJob({
  orderSeq: 5, kind: 'answer', outcome: 'done', ops: [],
  orderText: 'Write me an essay about the French Revolution',
  summary: 'I only work on this map: terrain, water, roads and the object catalog.',
});

/** A zero-write job that ended on a question, so the session is waiting on the user. */
const QUESTION = makeJob({
  orderSeq: 6, kind: 'answer', outcome: 'done', question: true, ops: reads(2),
  orderText: 'Build a fishing village somewhere sensible',
  summary: 'Both shores could take it. Which one should the village face?',
});

/** The silent giveup: no text and no ops at all. */
const SILENT = makeJob({
  orderSeq: 7, kind: 'quiet', outcome: 'done', ops: [], orderText: 'Make it nicer',
});

/** A job that actually built something, for the positive side of every rule here. */
const BUILT = makeJob({
  orderSeq: 8, kind: 'build', outcome: 'done', celebrate: true,
  orderText: 'Build a fishing village on the east shore',
  ops: [{ callId: 'w1', name: 'build_road', status: 'ok', summary: 'Laid the boardwalk', isRead: false, detail: { cells: 86 } }],
  summary: 'A fishing village stands on the east shore.',
  checkpoints: [{ undoIndex: 0, label: 'job' }],
});

const VERBS = { onSend: () => {}, onStop: () => {}, onPause: () => {}, onGateAnswer: () => {} };

beforeEach(() => {
  backing.clear();
  useEditorStore.setState({ locale: 'en' });
  useAgentSession.getState().clearSession();
});

afterEach(cleanup);

/* ── which jobs the paper is for ───────────────────────────────────────────── */

describe('the answer boundary is the projection\'s kind, not a count of ops', () => {
  it('claims the answer and the quiet giveup, and leaves the build to the receipt', () => {
    expect(isAnswerJob(ANSWER)).toBe(true);
    expect(isAnswerJob(REFUSED)).toBe(true);
    expect(isAnswerJob(QUESTION)).toBe(true);
    expect(isAnswerJob(SILENT)).toBe(true);
    expect(isAnswerJob(BUILT)).toBe(false);
  });

  /** A job whose writes were all REFUSED still reads as a build: the projection sets `kind` on the
   *  write being ISSUED, and a construction that failed still owes the user its receipt. */
  it('leaves a build whose every write was reverted to the receipt', () => {
    const reverted = makeJob({
      kind: 'build', outcome: 'done',
      ops: [{ callId: 'w1', name: 'build_road', status: 'revert', summary: 'Put back', isRead: false }],
    });
    expect(isAnswerJob(reverted)).toBe(false);
  });

  it('stamps the paper by what the job WAS', () => {
    expect(answerStamp(ANSWER)).toBe('answered');
    expect(answerStamp(REFUSED)).toBe('answered');
    expect(answerStamp(QUESTION)).toBe('asking');
    expect(answerStamp(SILENT)).toBe('ended');
  });
});

/* ── the paper itself ──────────────────────────────────────────────────────── */

describe('the answer paper: the words are the product', () => {
  it('carries the order at the subject rung and the model\'s own text at the body rung', () => {
    const { getByTestId } = renderWithI18n(<AnswerPaper job={ANSWER} />);
    expect(getByTestId('answer-order').textContent).toBe(ANSWER.orderText);
    const text = getByTestId('answer-text');
    expect(text.textContent).toBe(ANSWER.summary);
    // The BODY rung, never the muted one: the closing words are what the job produced.
    expect(text.style.color).toBe(rgb(PLATE_INK));
  });

  /**
   * A MODEL WRITES MARKDOWN WHETHER OR NOT IT IS ASKED TO, and the card that draws its answer has to
   * read as the answer it wrote. Printed flat, the live `deepseek-r1:32b` reply below lost every
   * paragraph break to a space and stood its `**` and its backticks in the prose: a five-step answer
   * as one wall of ink with the machinery showing.
   */
  it('renders the model\'s markdown: its own paragraphs, its lists, its emphasis, and no markers left standing', () => {
    const lake = [
      'Here is how I would build it.',
      '',
      '1. **Create a Lake**: clear the low ground with `paint_terrain`, then fill it.',
      '2. **Ring it with pines**: a loose band, thinner on the south shore.',
      '',
      'Shall I start with the water?',
    ].join('\n');
    const { getByTestId } = renderWithI18n(
      <AnswerPaper job={makeJob({ kind: 'answer', outcome: 'done', summary: lake })} />,
    );
    const text = getByTestId('answer-text');

    expect(text.querySelectorAll('p')).toHaveLength(2);
    expect(text.querySelectorAll('ol > li')).toHaveLength(2);
    expect(text.querySelectorAll('strong')).toHaveLength(2);
    expect(text.querySelector('code')?.textContent).toBe('paint_terrain');
    // The WORDS are untouched: rendering the markers is not the same act as deleting them.
    expect(text.textContent).toContain('Create a Lake');
    expect(text.textContent).toContain('paint_terrain');
    expect(text.textContent).not.toContain('**');
    expect(text.textContent).not.toContain('`');
    expect(text.style.color).toBe(rgb(PLATE_INK));
  });

  /** A model's own heading is a LEAD LINE: the card already owns the hierarchy around this text. */
  it('draws a heading the model wrote as a lead line rather than a rung of its own', () => {
    const { getByTestId } = renderWithI18n(
      <AnswerPaper job={makeJob({ kind: 'answer', outcome: 'done', summary: '## The shoreline\n\nIt is clear.' })} />,
    );
    const text = getByTestId('answer-text');
    expect(text.querySelectorAll('h1, h2, h3, h4')).toHaveLength(0);
    expect(text.textContent).toContain('The shoreline');
    expect(text.textContent).not.toContain('##');
  });

  /** The model's links are the MODEL'S. Its words stand; a press that navigates wherever it chose
   *  does not, on a surface that reads as the app talking. */
  it('keeps a link\'s words and gives it nothing to press', () => {
    const { getByTestId } = renderWithI18n(
      <AnswerPaper job={makeJob({ kind: 'answer', outcome: 'done', summary: 'See [the wiki](https://example.com/x).' })} />,
    );
    const text = getByTestId('answer-text');
    expect(text.querySelectorAll('a')).toHaveLength(0);
    expect(text.textContent).toBe('See the wiki.');
  });

  it('collapses read-only ops into one quiet line and draws no op rows', () => {
    const { getByTestId, queryByTestId, queryAllByTestId } = renderWithI18n(<AnswerPaper job={ANSWER} />);
    expect(getByTestId('answer-reads').textContent)
      .toBe(translations.en['agent3.answer_reads']!.replace('{n}', '3'));
    expect(queryAllByTestId('op-row').length).toBe(0);
    expect(queryByTestId('tape-bar')).toBeNull();
  });

  it('says one read in the singular, and says nothing at all when there were none', () => {
    const one = renderWithI18n(<AnswerPaper job={makeJob({ kind: 'answer', outcome: 'done', ops: reads(1), summary: 'Yes.' })} />);
    expect(one.getByTestId('answer-reads').textContent)
      .toBe(translations.en['agent3.answer_reads_one']!.replace('{n}', '1'));
    one.unmount();

    const none = renderWithI18n(<AnswerPaper job={REFUSED} />);
    expect(none.queryByTestId('answer-reads')).toBeNull();
  });

  /** A REFUSAL IS AN ANSWER. Not a failure and not a success: no danger paper, no danger ink, no
   *  Built stamp, and (below) no dance. */
  it('gives a refusal no danger token and no Built stamp', () => {
    const { getByTestId, queryByTestId } = renderWithI18n(<AnswerPaper job={REFUSED} />);
    const paper = getByTestId('answer-paper');
    expect(paper.getAttribute('data-stamp')).toBe('answered');
    expect(queryByTestId('ticket-stamp')).toBeNull();
    for (const el of [paper, ...paper.querySelectorAll('*')] as HTMLElement[]) {
      expect(el.style.background).not.toBe(rgb(colors.dangerBg));
      expect(el.style.backgroundColor).not.toBe(rgb(colors.dangerBg));
      expect(el.style.color).not.toBe(rgb(colors.dangerText));
    }
    expect(paper.textContent).not.toContain(translations.en['agent3.ticket_stamp_done']);
  });

  /** The panel's OWN voice, at the muted rung: fabricating first-person words the model never said
   *  would be worse than none. */
  it('speaks for itself when the job said nothing, and never in the model\'s person', () => {
    const { getByTestId, queryByTestId } = renderWithI18n(<AnswerPaper job={SILENT} />);
    expect(getByTestId('answer-paper').getAttribute('data-stamp')).toBe('ended');
    const voice = getByTestId('answer-uivoice');
    expect(voice.textContent).toBe(translations.en['agent3.answer_silent']);
    expect(voice.style.color).toBe(rgb(colors.brownText));
    expect(queryByTestId('answer-text')).toBeNull();
  });

  /** ONE GRAMMAR FOR "A QUESTION IS STANDING": the gate family's yellow spine and its quick row,
   *  whether the job built or only read. */
  it('wears the ask grammar while its closing question stands', () => {
    const { getByTestId } = renderWithI18n(<AnswerPaper job={QUESTION} />);
    const paper = getByTestId('answer-paper');
    expect(paper.getAttribute('data-stamp')).toBe('asking');
    expect(paper.style.borderLeft).toContain(rgb(ACTIVE));
    expect(getByTestId('gate-quick-row')).toBeTruthy();
  });

  it('retires the spine on a paper with no question standing', () => {
    const { getByTestId } = renderWithI18n(<AnswerPaper job={ANSWER} />);
    expect(getByTestId('answer-paper').style.borderLeft).not.toContain(rgb(ACTIVE));
  });
});

/* ── filing it away ────────────────────────────────────────────────────────── */

describe('File it away', () => {
  it('files the record by its own order seq', () => {
    const filed: number[] = [];
    const { getByTestId } = renderWithI18n(
      <AnswerPaper job={ANSWER} onFileAway={(seq) => filed.push(seq)} />,
    );
    fireEvent.click(getByTestId('answer-file-away'));
    expect(filed).toEqual([ANSWER.orderSeq]);
  });

  /** Answering is what files an ask, or the next order is: a File-it-away beside a standing question
   *  would offer to put away a job that is still waiting on the user. */
  it('offers none while the ask stands', () => {
    const { queryByTestId } = renderWithI18n(<AnswerPaper job={QUESTION} onFileAway={() => {}} />);
    expect(queryByTestId('answer-file-away')).toBeNull();
  });

  it('grows no control where the caller has no verb for it', () => {
    const { queryByTestId } = renderWithI18n(<AnswerPaper job={ANSWER} />);
    expect(queryByTestId('answer-file-away')).toBeNull();
  });
});

/* ── the shell's terminal render ───────────────────────────────────────────── */

describe('the panel picks the receipt or the paper by what the job was', () => {
  it('stands the paper for a zero-write job and the receipt for a built one', () => {
    const answered = renderWithI18n(
      <PanelShell view={makeView({ jobs: [ANSWER] })} connected now={0} {...VERBS} />,
    );
    expect(answered.getByTestId('answer-paper')).toBeTruthy();
    expect(answered.queryByTestId('flip-ticket')).toBeNull();
    answered.unmount();

    const built = renderWithI18n(
      <PanelShell view={makeView({ jobs: [BUILT] })} connected now={0} {...VERBS} />,
    );
    expect(built.getByTestId('flip-ticket')).toBeTruthy();
    expect(built.queryByTestId('answer-paper')).toBeNull();
  });

  /** The card takes the TICKET's place, so it stands only while nothing is in flight: an order given
   *  over a standing answer starts the next job, and the record above it is the history strip's. */
  it('drops the terminal card the moment a new job is in flight', () => {
    const { queryByTestId } = renderWithI18n(
      <PanelShell
        view={makeView({ phase: 'executing', jobs: [ANSWER], current: makeJob({ orderSeq: 9 }) })}
        connected
        now={0}
        {...VERBS}
      />,
    );
    expect(queryByTestId('answer-paper')).toBeNull();
    expect(queryByTestId('job-ticket')).toBeTruthy();
  });

  /** Filing replaces the terminal card with its past-jobs row. */
  it('takes the card off the zone once the record is filed, and keeps the history row', () => {
    const view = makeView({ jobs: [ANSWER] });
    const { getByTestId, queryByTestId, rerender } = renderWithI18n(
      <PanelShell view={view} connected now={0} filed={new Set()} {...VERBS} />,
    );
    expect(getByTestId('answer-paper')).toBeTruthy();

    rerender(<PanelShell view={view} connected now={0} filed={new Set([ANSWER.orderSeq])} {...VERBS} />);
    expect(queryByTestId('answer-paper')).toBeNull();
    expect(getByTestId('history-strip')).toBeTruthy();
  });

  it('hands the file-away press up with the record it is about', () => {
    const filed: number[] = [];
    const { getByTestId } = renderWithI18n(
      <PanelShell
        view={makeView({ jobs: [ANSWER] })}
        connected
        now={0}
        onFileAway={(seq) => filed.push(seq)}
        {...VERBS}
      />,
    );
    fireEvent.click(getByTestId('answer-file-away'));
    expect(filed).toEqual([ANSWER.orderSeq]);
  });
});

/* ── the dock's two faces ──────────────────────────────────────────────────── */

describe('the dock says what the desk was left with', () => {
  function dock(job: JobView) {
    return renderWithI18n(<PanelShell view={makeView({ jobs: [job] })} connected now={0} {...VERBS} />);
  }

  it('reads Answered with the reads count', () => {
    const { getByTestId } = dock(ANSWER);
    expect(getByTestId('dock-sentence').textContent).toBe(translations.en['agent3.dock_answered']);
    expect(getByTestId('dock-meta').textContent).toBe(translations.en['agent3.dock_reads']!.replace('{n}', '3'));
    expect(getByTestId('dock-glyph').getAttribute('data-icon')).toBe('pw-reply-bubble');
  });

  /** A refusal read the map not at all, and "0 reads" is a count of nothing. What the user wants to
   *  know is that the map is untouched. */
  it('says no edits were made where an answer read nothing', () => {
    const { getByTestId } = dock(REFUSED);
    expect(getByTestId('dock-sentence').textContent).toBe(translations.en['agent3.dock_answered']);
    expect(getByTestId('dock-meta').textContent).toBe(translations.en['agent3.dock_no_edits']);
  });

  it('reads Ended, nothing was said, for the silent giveup', () => {
    const { getByTestId } = dock(SILENT);
    expect(getByTestId('dock-sentence').textContent).toBe(translations.en['agent3.dock_ended']);
    expect(getByTestId('dock-meta').textContent).toBe(translations.en['agent3.dock_nothing_said']);
    expect(getByTestId('dock-glyph').getAttribute('data-icon')).toBe('pw-history');
  });

  it('keeps the waiting face while the closing question stands', () => {
    const { getByTestId } = dock(QUESTION);
    expect(getByTestId('dock-sentence').textContent).toBe(translations.en['agent3.dock_gated']);
    expect(getByTestId('dock').getAttribute('data-paper')).toBe('ask');
  });
});

/* ── the history line ──────────────────────────────────────────────────────── */

describe('an answered job\'s history line says what it WAS, never "0 edits"', () => {
  function rows(job: JobView) {
    const view = renderWithI18n(
      <PanelShell view={makeView({ jobs: [job, makeJob({ orderSeq: 99, outcome: 'done', kind: 'build' })] })} connected now={0} {...VERBS} />,
    );
    fireEvent.click(view.getByTestId('history-toggle'));
    const item = [...document.body.querySelectorAll('[data-testid="history-item"]')]
      .find((el) => el.getAttribute('data-order-seq') === String(job.orderSeq)) as HTMLElement;
    return { view, item };
  }

  it('reads "answered" under the reply-bubble glyph', () => {
    const { view, item } = rows(ANSWER);
    expect(item.querySelector('[data-testid="history-item-stat"]')!.textContent)
      .toBe(translations.en['agent3.history_answered']);
    expect(item.querySelector('svg use')!.getAttribute('href')).toBe('#pw-reply-bubble');
    view.unmount();
  });

  it('reads "ended" under the record glyph for the silent giveup', () => {
    const { view, item } = rows(SILENT);
    expect(item.querySelector('[data-testid="history-item-stat"]')!.textContent)
      .toBe(translations.en['agent3.history_ended']);
    expect(item.querySelector('svg use')!.getAttribute('href')).toBe('#pw-history');
    view.unmount();
  });

  it('leaves a built job reading its edit count', () => {
    const { view, item } = rows(BUILT);
    expect(item.querySelector('[data-testid="history-item-stat"]')!.textContent)
      .toBe(translations.en['agent3.history_edits']!.replace('{n}', '86'));
    view.unmount();
  });
});

/* ── the celebrate rule ────────────────────────────────────────────────────── */

/** The hook under a probe, so the rule can be driven with projections rather than with a session. */
function CelebrateProbe({ view }: { view: PanelView }) {
  const pose = useCelebrateEdge(view);
  return <span data-testid="probe">{pose ?? 'none'}</span>;
}

describe('a dance only for built things', () => {
  afterEach(() => { vi.useRealTimers(); });

  /** The hook is THIN by rule: it fires on the projection's own `celebrate` and derives nothing. A
   *  job carrying the flag dances whatever its ops look like from here. */
  it('fires on the projection\'s own celebrate flag, at the edge of a new settlement', () => {
    const { getByTestId, rerender } = renderWithI18n(<CelebrateProbe view={makeView()} />);
    expect(getByTestId('probe').textContent).toBe('none');
    rerender(<CelebrateProbe view={makeView({ jobs: [BUILT] })} />);
    expect(getByTestId('probe').textContent).toBe('celebrating');
  });

  it('stays silent for every job that built nothing', () => {
    for (const job of [ANSWER, REFUSED, QUESTION, SILENT]) {
      const { getByTestId, rerender, unmount } = renderWithI18n(<CelebrateProbe view={makeView()} />);
      rerender(<CelebrateProbe view={makeView({ jobs: [job] })} />);
      expect(getByTestId('probe').textContent, `orderSeq ${job.orderSeq}`).toBe('none');
      unmount();
    }
  });

  /** A `done` job whose writes never landed carries `celebrate: false` from the projection, and the
   *  hook must not second-guess it off the outcome. */
  it('does not dance for a done job whose every write was put back', () => {
    const reverted = makeJob({ orderSeq: 12, kind: 'build', outcome: 'done', celebrate: false });
    const { getByTestId, rerender } = renderWithI18n(<CelebrateProbe view={makeView()} />);
    rerender(<CelebrateProbe view={makeView({ jobs: [reverted] })} />);
    expect(getByTestId('probe').textContent).toBe('none');
  });

  it('is silent on the first read, so a restored session never dances on arrival', () => {
    const { getByTestId } = renderWithI18n(<CelebrateProbe view={makeView({ jobs: [BUILT] })} />);
    expect(getByTestId('probe').textContent).toBe('none');
  });

  /* ── both hosts ── */

  it('reaches the desk character in the panel, and only for the built job', () => {
    const shell = (view: PanelView) => <PanelShell view={view} connected now={0} {...VERBS} />;
    const { getByTestId, rerender } = renderWithI18n(shell(makeView()));
    rerender(shell(makeView({ jobs: [ANSWER] })));
    expect(getByTestId('pw-character').getAttribute('data-pose')).not.toBe('celebrating');
    rerender(shell(makeView({ jobs: [ANSWER, BUILT] })));
    expect(getByTestId('pw-character').getAttribute('data-pose')).toBe('celebrating');
  });

  it('reaches the parked character on the same rule', () => {
    const entranceRef = { current: document.createElement('div') };
    const host = (
      <CharacterHost entranceRef={entranceRef} open={false} connected size={60} />
    );
    const { getByTestId } = renderWithI18n(host);

    // A zero-write job settles: nothing to celebrate.
    act(() => {
      const log = useAgentSession.getState().log;
      append(log, { kind: 'order', text: 'What is on my map?', mapContext: '' });
      append(log, { kind: 'jobEnd', outcome: 'done', summary: 'A plaza and twelve houses.' });
    });
    expect(getByTestId('pw-character').getAttribute('data-pose')).not.toBe('celebrating');

    // A job that laid something down: the one settlement that dances.
    act(() => {
      const log = useAgentSession.getState().log;
      append(log, { kind: 'order', text: 'Lay a road to the mill', mapContext: '' });
      append(log, {
        kind: 'assistant', stop: 'tool-calls',
        parts: [{ kind: 'tool', callId: 'w9', name: 'build_road', input: {}, argsDone: true }],
      });
      append(log, {
        kind: 'toolResult', callId: 'w9', name: 'build_road', content: 'Laid the road',
        isError: false, write: true, detail: { cells: 40 },
      });
      append(log, { kind: 'jobEnd', outcome: 'done', summary: 'The road runs to the mill.' });
    });
    expect(getByTestId('pw-character').getAttribute('data-pose')).toBe('celebrating');
  });
});

/* ── the words, in every locale ────────────────────────────────────────────── */

describe('the answer family speaks every locale', () => {
  const KEYS = [
    'agent3.answer_stamp_answered', 'agent3.answer_stamp_asking', 'agent3.answer_stamp_ended',
    'agent3.answer_reads', 'agent3.answer_reads_one', 'agent3.answer_silent',
    'agent3.action_file_away', 'agent3.dock_no_edits', 'agent3.dock_reads_one',
    'agent3.history_answered', 'agent3.history_ended',
  ];

  it('defines every one of them, in all seven, with the count token intact', () => {
    for (const loc of Object.keys(translations) as Locale[]) {
      for (const key of KEYS) {
        const value = translations[loc][key];
        expect(value, `${loc}/${key}`).toBeTruthy();
      }
      for (const key of ['agent3.answer_reads', 'agent3.answer_reads_one', 'agent3.dock_reads_one']) {
        expect(translations[loc][key], `${loc}/${key}`).toContain('{n}');
      }
    }
  });

  /** The paper's own text is the MODEL's, never re-run through the dictionary: a summary logged in
   *  one language must not be half-translated by a later locale switch. */
  it('renders the model\'s words verbatim under a different locale', () => {
    useEditorStore.setState({ locale: 'ru' });
    const { getByTestId } = renderWithI18n(<AnswerPaper job={ANSWER} />);
    expect(getByTestId('answer-text').textContent).toBe(ANSWER.summary);
    expect(getByTestId('answer-stamp').textContent).toBe(translations.ru['agent3.answer_stamp_answered']);
  });
});
