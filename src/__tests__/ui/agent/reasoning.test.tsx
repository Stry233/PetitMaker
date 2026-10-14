// @vitest-environment jsdom
/**
 * Presence always, transcript never by default: the counter on the dock's meta
 * line, the stall face that stops reassuring, and the bounded box one deliberate press away.
 *
 * The three faces under test are all about what the panel says while a model thinks, so every
 * assertion here is on text and on the seat it stands in. Rendered through `I18nProvider` with a
 * stubbed `localStorage` (the store's persistence writes to it) and under
 * `MotionConfig reducedMotion="always"` — the dock's card flip is what a face swap would otherwise
 * have to be awaited through, and the presence line is deliberately the one carrier that survives
 * reduced motion, so testing it there is testing it where it matters.
 */
import { ScrollIntent } from '../../../ui/agent/parts/scroll-intent';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { useEditorStore } from '../../../state/store';
import { translations } from '../../_support/locale-tables';
import { append, createLog } from '../../../agent/core/log';
import { deriveView } from '../../../agent/core/project-view';
import { REASONING_EXCERPT_CHARS } from '../../../agent/core/types';
import { deserializeLog, serializeLog } from '../../../agent/session/log-codec';
import { AnswerPaper } from '../../../ui/agent/record/AnswerPaper';
import { DeskHeader } from '../../../ui/agent/desk/DeskHeader';
import { JobTicket } from '../../../ui/agent/record/JobTicket';
import { FlipTicket } from '../../../ui/agent/record/FlipTicket';
import { PanelShell } from '../../../ui/agent/PanelShell';
import type {
  JobView, OpRow as OpRowData, PanelView, ThoughtTurn,
} from '../../../agent/core/project-view';
import { LOCALES } from '../../../core/model/locale';
import { makeView, panelProps, Wrapper } from '../../_support/agent-panel';

const backing = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
};

const renderWithI18n = (node: React.ReactElement) => render(node, { wrapper: Wrapper });

beforeEach(() => {
  backing.clear();
  useEditorStore.setState({ locale: 'en' });
});

const LONG_COT = 'The order asks for a fishing village somewhere sensible. First constraint: the'
  + ' plaza is locked, so nothing can anchor there.\n\nThe east shore has the flattest run of grass,'
  + ' about 14 by 6 cells clear.';

let opSeq = 0;
function makeOp(over: Partial<OpRowData> = {}): OpRowData {
  opSeq += 1;
  return { callId: `op-${opSeq}`, name: 'place_object', status: 'ok', summary: '', isRead: false, ...over };
}

function makeMark(over: Partial<ThoughtTurn> = {}): ThoughtTurn {
  return { seq: 1, ms: 102_000, chars: 1204, beforeIndex: 0, text: LONG_COT, ...over };
}

function makeJob(over: Partial<JobView> = {}): JobView {
  return {
    orderSeq: 1,
    orderText: 'Build a fishing village on the east shore',
    orderAt: 0,
    ops: [],
    asks: [],
    steerNotes: [],
    checkpoints: [],
    stamps: [],
    celebrate: false,
    skills: [],
    ...over,
  };
}

/** A thinking job as the panel sees it: ordered at `orderAt`, the log last stamped at `lastEventAt`. */
function thinking(over: { thought?: JobView['thought']; orderAt?: number; lastEventAt?: number } = {}): PanelView {
  const job = makeJob({ orderAt: over.orderAt ?? 0, ...(over.thought ? { thought: over.thought } : {}) });
  return makeView({
    phase: 'thinking',
    current: job,
    lastEventAt: over.lastEventAt ?? over.orderAt ?? 0,
  });
}

describe('the presence counter: the status card says how much has been thought, and never routes it through the says line', () => {
  /** The count is turns, not characters: `chars` grows mid-stream and is not a count of anything
   *  discrete, so a job on its third thinking turn reads "3 thoughts" whatever its character total. */
  it('carries the turn count on the meta line beside the running clock, not the character total', () => {
    const view = thinking({ thought: { chars: 1204, turns: 3, marks: [], ms: 0, live: LONG_COT } });
    const { getByTestId } = renderWithI18n(<DeskHeader view={view} now={42_000} />);

    expect(getByTestId('dock-sentence').textContent).toBe(translations.en['agent.dock_thinking']);
    expect(getByTestId('dock-meta').textContent).toBe('3 thoughts');
    expect(getByTestId('dock-elapsed').textContent).toBe('0:42');
  });

  /** The reachable n=1 case: a job on its first thinking turn says one thought, not the plural. */
  it('says one thought, not one thoughts, on the first turn', () => {
    const view = thinking({ thought: { chars: 1204, turns: 1, marks: [], ms: 0, live: LONG_COT } });
    const { getByTestId } = renderWithI18n(<DeskHeader view={view} now={42_000} />);
    expect(getByTestId('dock-meta').textContent).toBe('1 thought');
  });

  /** Reasoning stays behind its control without a placeholder answer or extra loading indicator. */
  it('leaves the says line unwritten while only reasoning has arrived', () => {
    const job = makeJob({ thought: { chars: 1204, turns: 1, marks: [], ms: 0, live: LONG_COT } });
    const { getByTestId, queryByTestId } = renderWithI18n(<JobTicket job={job} live />);

    expect(queryByTestId('says-dots')).toBeNull();
    expect(getByTestId('thoughts-toggle')).toBeTruthy();
    expect(queryByTestId('says-line')).toBeNull();
    expect(getByTestId('job-ticket').textContent).not.toContain('the plaza is locked');
  });

  /** A HIDDEN-CoT model gets the same face minus the count, and no affordance that would open on
   *  nothing: the elapsed clock is the whole liveness carrier there. Inside the stall threshold,
   *  because past it there is no hidden face that is not also a silence — which is the point. */
  it('says the clock and no count at all where no reasoning was exposed', () => {
    const view = thinking({ orderAt: 0, lastEventAt: 0 });
    const dock = renderWithI18n(<DeskHeader view={view} now={58_000} />);
    expect(dock.getByTestId('dock-elapsed').textContent).toBe('0:58');
    expect(dock.queryByTestId('dock-meta')).toBeNull();
    dock.unmount();

    const ticket = renderWithI18n(<JobTicket job={makeJob()} live />);
    expect(ticket.queryByTestId('says-dots')).toBeNull();
    expect(ticket.queryByTestId('says')).toBeNull();
    expect(ticket.queryByTestId('thoughts-toggle')).toBeNull();
    expect(ticket.queryByTestId('thoughts-box')).toBeNull();
  });
});

describe('the stall face: past the threshold the status card states the fact', () => {
  /** The silence, in ms, the status card waits out before it says so. */
  const STALL_MS = 90_000;

  it('keeps the thinking face while the silence is inside the threshold', () => {
    const view = thinking({ orderAt: 0, lastEventAt: 60_000 });
    const { getByTestId, queryByTestId } = renderWithI18n(
      <DeskHeader view={view} now={60_000 + STALL_MS - 1_000} />,
    );
    expect(getByTestId('dock-sentence').textContent).toBe(translations.en['agent.dock_thinking']);
    expect(queryByTestId('dock-stall-clock')).toBeNull();
  });

  it('says what is true past it, with the job clock still running beside the silence', () => {
    const view = thinking({ orderAt: 0, lastEventAt: 145_000 });
    const { getByTestId } = renderWithI18n(<DeskHeader view={view} now={275_000} />);

    expect(getByTestId('dock-sentence').textContent).toBe(translations.en['agent.dock_still_thinking']);
    expect(getByTestId('dock-meta').textContent).toBe('nothing received, 2:10');
    expect(getByTestId('dock-stall-clock').textContent).toBe('2:10');
    // The job's own clock is not the silence: the run is four and a half minutes old.
    expect(getByTestId('dock-elapsed').textContent).toBe('4:35');
  });

  /** The digit-only-ticks rule, which is why the silence reading is a leaf of its own: a second
   *  passing must touch that one text node and leave every sibling's DOM identity alone. */
  it('moves the silence reading alone as the clock ticks', () => {
    const view = thinking({ orderAt: 0, lastEventAt: 145_000 });
    const { getByTestId, rerender } = renderWithI18n(<DeskHeader view={view} now={275_000} />);
    const sentence = getByTestId('dock-sentence');
    const meta = getByTestId('dock-meta');
    const clock = getByTestId('dock-stall-clock');

    rerender(<DeskHeader view={view} now={276_000} />);
    expect(getByTestId('dock-stall-clock').textContent).toBe('2:11');
    expect(getByTestId('dock-stall-clock')).toBe(clock);
    expect(getByTestId('dock-sentence')).toBe(sentence);
    expect(getByTestId('dock-meta')).toBe(meta);
  });

  /** Any event returns the thinking face: the silence is measured from what was last observed, so a
   *  delta landing is the end of the stall whatever the face was saying a moment ago. */
  it('returns to the thinking face the moment something arrives', () => {
    const stalled = thinking({ orderAt: 0, lastEventAt: 145_000 });
    const { getByTestId, rerender } = renderWithI18n(<DeskHeader view={stalled} now={275_000} />);
    expect(getByTestId('dock-sentence').textContent).toBe(translations.en['agent.dock_still_thinking']);

    const arrived = thinking({ orderAt: 0, lastEventAt: 274_000 });
    rerender(<DeskHeader view={arrived} now={275_000} />);
    expect(getByTestId('dock-sentence').textContent).toBe(translations.en['agent.dock_thinking']);
  });

  /** The live half alone: `lastEventAt` never moves in this test, so only the reasoning stream's own
   *  progress (never logged, `useLastActivity`'s live-signature half) is what can end the stall —
   *  the log-driven test above cannot exercise this branch, since there the log stamp is what moves. */
  it('returns to the thinking face on a live dribble alone, with the log stamp frozen', () => {
    const at = (chars: number) => thinking({
      orderAt: 0, lastEventAt: 0, thought: { chars, turns: 1, marks: [], ms: 0, live: 'r'.repeat(chars) },
    });
    const { getByTestId, rerender } = renderWithI18n(<DeskHeader view={at(500)} now={0} />);
    rerender(<DeskHeader view={at(500)} now={STALL_MS} />);
    expect(getByTestId('dock-sentence').textContent).toBe(translations.en['agent.dock_still_thinking']);

    rerender(<DeskHeader view={at(756)} now={STALL_MS} />);
    expect(getByTestId('dock-sentence').textContent).toBe(translations.en['agent.dock_thinking']);
  });

  /** A seat is not lost to a stall. Pause and stop stay exactly where the running face keeps them:
   *  the stall is a sentence, not a state of its own. */
  it('keeps the running seat', () => {
    const view = thinking({ orderAt: 0, lastEventAt: 145_000 });
    const { getByTestId } = renderWithI18n(<DeskHeader view={view} now={275_000} onPause={() => {}} />);
    expect(getByTestId('dock-seat').getAttribute('data-act')).toBe('pause');
  });
});

describe('the thoughts affordance: one deliberate press into a bounded box', () => {
  it('offers the current turn behind a control, collapsed', () => {
    const job = makeJob({ thought: { chars: 1204, turns: 1, marks: [], ms: 0, live: LONG_COT } });
    const { getByTestId, queryByTestId } = renderWithI18n(<JobTicket job={job} live />);

    expect(queryByTestId('thoughts-box')).toBeNull();
    const toggle = getByTestId('thoughts-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);

    const box = getByTestId('thoughts-box');
    expect(box.textContent).toContain('the plaza is locked');
    expect(getByTestId('thoughts-toggle').getAttribute('aria-expanded')).toBe('true');
  });

  it('stands the box in its own bounded scroller', () => {
    const job = makeJob({ thought: { chars: 1204, turns: 1, marks: [], ms: 0, live: LONG_COT } });
    const { getByTestId } = renderWithI18n(<JobTicket job={job} live />);
    fireEvent.click(getByTestId('thoughts-toggle'));

    const box = getByTestId('thoughts-box');
    expect(box.parentElement!.style.maxHeight).toBe('200px');
    expect(box.style.overflowY).toBe('auto');
    expect(box.style.overscrollBehavior).toBe('contain');
  });

  /**
   * A chain of thought is markdown, because a model writes it that way whether or not it was asked:
   * numbered steps, a candidate table, an id in backticks. Drawn flat, every blank line collapsed
   * into one wall of text and the markers stood in the prose — so the box renders it through the
   * panel's own emitter over the house parser.
   */
  it('renders the thought as the markdown it is written in', () => {
    const written = 'First, the shore:\n\n1. clear the bank\n2. lay the walk\n\nThe **plaza** is `locked`.';
    const job = makeJob({ thought: { chars: written.length, turns: 1, marks: [], ms: 0, live: written } });
    const { getByTestId } = renderWithI18n(<JobTicket job={job} live />);
    fireEvent.click(getByTestId('thoughts-toggle'));

    const box = getByTestId('thoughts-box');
    expect(box.querySelectorAll('ol li')).toHaveLength(2);
    expect(box.querySelector('strong')?.textContent).toBe('plaza');
    expect(box.querySelector('code')?.textContent).toBe('locked');
    // The markers themselves are gone from the text, which is the whole difference from a flat draw.
    expect(box.textContent).not.toContain('**');
    expect(box.textContent).not.toContain('`');
  });

  it('closes again on a second press', async () => {
    const job = makeJob({ thought: { chars: 1204, turns: 1, marks: [], ms: 0, live: LONG_COT } });
    const { getByTestId, queryByTestId } = renderWithI18n(<JobTicket job={job} live />);
    fireEvent.click(getByTestId('thoughts-toggle'));
    expect(queryByTestId('thoughts-box')).not.toBeNull();
    fireEvent.click(getByTestId('thoughts-toggle'));
    // The press reads as closed at once, and the box then folds away on its own declared length —
    // it is held in the tree for exactly that long, which is what a fold is.
    expect(getByTestId('thoughts-toggle').getAttribute('aria-expanded')).toBe('false');
    await waitFor(() => { expect(queryByTestId('thoughts-box')).toBeNull(); });
  });

  it('pauses following before changing the reasoning disclosure', () => {
    const seen: string[] = [];
    const job = makeJob({ thought: { chars: 1204, turns: 1, marks: [], ms: 0, live: LONG_COT } });
    const { getByTestId } = renderWithI18n(
      <ScrollIntent.Provider value={() => seen.push(getByTestId('thoughts-toggle').getAttribute('aria-expanded')!)}>
        <JobTicket job={job} live />
      </ScrollIntent.Provider>,
    );
    fireEvent.click(getByTestId('thoughts-toggle'));
    fireEvent.click(getByTestId('thoughts-toggle'));
    expect(seen).toEqual(['false', 'true']);
  });

});

describe('the excerpt note: a reopened session says when the box holds less than it thought', () => {
  /** The real storage round trip (`serializeLog`/`deserializeLog`/`deriveView`), not a hand-built
   *  fixture: `persist.ts:digestReasoning` is what actually diverges `mark.text` from `mark.chars`,
   *  and this is the one path that exercises it end to end into the rendered box. */
  function buildSettledLog() {
    const log = createLog(() => 1);
    append(log, { kind: 'order', text: 'build a village', mapContext: 'ctx' });
    append(log, {
      kind: 'assistant', stop: 'tool-calls',
      parts: [{ kind: 'reasoning', text: 'r'.repeat(9264), done: true }],
    });
    append(log, { kind: 'jobEnd', outcome: 'done', summary: 'built it' });
    return log;
  }

  it('carries no note on a live, undigested thought', () => {
    const job = deriveView(buildSettledLog()).jobs[0]!;
    expect(job.thought?.marks[0]?.text).toHaveLength(9264);

    const { getByTestId, queryByTestId } = renderWithI18n(<JobTicket job={job} />);
    fireEvent.click(getByTestId('thought-mark'));
    expect(queryByTestId('thoughts-excerpt-note')).toBeNull();
  });

  it('carries the excerpt note once a reload has truncated the stored text', () => {
    const log = buildSettledLog();
    const revived = deserializeLog(serializeLog(log))!;
    const job = deriveView(revived).jobs[0]!;
    expect(job.thought?.marks[0]?.text).toHaveLength(REASONING_EXCERPT_CHARS);
    expect(job.thought?.marks[0]?.chars).toBe(9264);

    const { getByTestId } = renderWithI18n(<JobTicket job={job} />);
    fireEvent.click(getByTestId('thought-mark'));
    expect(getByTestId('thoughts-excerpt-note').textContent).toBe(translations.en['agent.thoughts_excerpt']);
  });

  /**
   * Edge whitespace is the common shape, and the `'r'.repeat` fixture above is blind to it: a
   * `reasoning_content` stream that opens or closes on a newline is what most providers send. The
   * projection trims the text it hands the box, so measuring `chars` off the untrimmed part gives
   * two numbers describing two different strings and the box tells the user a thought was cut short
   * by a reload in a session that has never been reloaded.
   */
  function thoughtLog(...texts: string[]) {
    const log = createLog(() => 1);
    append(log, { kind: 'order', text: 'terrace the ridge', mapContext: 'ctx' });
    append(log, {
      kind: 'assistant', stop: 'tool-calls',
      parts: texts.map((text) => ({ kind: 'reasoning' as const, text, done: true })),
    });
    append(log, { kind: 'jobEnd', outcome: 'done', summary: 'terraced it' });
    return log;
  }

  it.each([
    ['a trailing newline', 'I will terrace the north ridge first.\n'],
    ['leading blank lines', '\n\nWeighing the ridge.'],
    ['whitespace at both edges', ' \n Weighing it up, slowly. \n '],
  ])('carries no note on a live thought with %s', (_shape, text) => {
    const job = deriveView(thoughtLog(text)).jobs[0]!;
    const { getByTestId, queryByTestId } = renderWithI18n(<JobTicket job={job} />);
    fireEvent.click(getByTestId('thought-mark'));
    expect(queryByTestId('thoughts-excerpt-note')).toBeNull();
  });

  /** A multi-part turn joins its parts with a blank line, so the displayed text ran past `chars` by
   *  two per gap — the safe direction, and still two measurements of two different strings. */
  it('measures a multi-part turn as the box displays it', () => {
    const mark = deriveView(thoughtLog('First, the ridge.\n', 'Then the shore.')).jobs[0]!.thought!.marks[0]!;
    expect(mark.chars).toBe(mark.text!.length);
  });

  /** And from the other side: a reloaded thought shorter than the excerpt bound was never
   *  truncated, so nothing may claim it was. The stored head is the whole of it. */
  it('carries no note on a reloaded thought that was never truncated', () => {
    const log = thoughtLog('A short thought, ending on a newline.\n');
    const job = deriveView(deserializeLog(serializeLog(log))!).jobs[0]!;
    expect(job.thought!.marks[0]!.text!.length).toBeLessThan(REASONING_EXCERPT_CHARS);

    const { getByTestId, queryByTestId } = renderWithI18n(<JobTicket job={job} />);
    fireEvent.click(getByTestId('thought-mark'));
    expect(queryByTestId('thoughts-excerpt-note')).toBeNull();
  });
});

describe('interleaved turns: one quiet mark per turn, in the op list', () => {
  const job = () => makeJob({
    ops: [
      makeOp({ callId: 'road', name: 'build_road', summary: 'Laid the boardwalk road' }),
      makeOp({ callId: 'hut', name: 'place_object', status: 'run' }),
    ],
    thought: {
      chars: 2300,
      turns: 2,
      ms: 130_000,
      marks: [
        makeMark({ seq: 1, ms: 102_000, chars: 1204, beforeIndex: 0, text: LONG_COT }),
        makeMark({ seq: 2, ms: 28_000, chars: 160, beforeIndex: 1, text: 'The huts want one cell of setback.' }),
      ],
    },
  });

  it('files one mark per turn, each above the row that turn opened', () => {
    const { getByTestId, getAllByTestId } = renderWithI18n(<JobTicket job={job()} live />);
    const marks = getAllByTestId('thought-mark');
    expect(marks).toHaveLength(2);
    expect(marks[0]?.textContent).toContain('thought for 1:42');
    expect(marks[1]?.textContent).toContain('thought for 0:28');

    const rows = [...getByTestId('ops-list').querySelectorAll('[data-testid="thought-row"], [data-testid="op-row"]')]
      .map((el) => el.getAttribute('data-testid'));
    expect(rows).toEqual(['thought-row', 'op-row', 'thought-row', 'op-row']);
  });

  it('opens each mark into its own box', () => {
    const { getAllByTestId, queryAllByTestId } = renderWithI18n(<JobTicket job={job()} live />);
    fireEvent.click(getAllByTestId('thought-mark')[1]!);
    const boxes = queryAllByTestId('thoughts-box');
    expect(boxes).toHaveLength(1);
    expect(boxes[0]?.textContent).toContain('one cell of setback');
  });

  /** A turn whose reasoning was never exposed still marks its own effort — and offers no press,
   *  because there is nothing behind it. */
  it('marks a turn with no text and offers no way in', () => {
    const quiet = makeJob({
      ops: [makeOp({ callId: 'road' })],
      thought: {
        chars: 900, turns: 1, ms: 61_000,
        marks: [{ seq: 1, ms: 61_000, chars: 900, beforeIndex: 0 }],
      },
    });
    const { getByTestId, queryByTestId } = renderWithI18n(<JobTicket job={quiet} live />);
    expect(getByTestId('thought-row').textContent).toContain('thought for 1:01');
    expect(queryByTestId('thought-mark')).toBeNull();
  });
});

/**
 * The transcript outlives the turn that wrote it.
 *
 * The live face's thoughts pill is the current turn's and retires with it, and an answered job's card
 * is the paper rather than the ticket — so a settled answer left the session holding 1,887 characters
 * of that turn's reasoning with nothing on screen able to reach them. The paper carries the same
 * per-turn marks the op list does, under the answer, since the answer is the product.
 */
describe('the answer paper: the thinking behind the words stays reachable', () => {
  const answered = makeJob({
    outcome: 'done',
    kind: 'answer',
    summary: 'The east shore is the flattest ground you have.',
    thought: {
      chars: 1204, turns: 1, ms: 102_000,
      marks: [makeMark({ seq: 1, ms: 102_000, chars: 1204, beforeIndex: 0, text: LONG_COT })],
    },
  });

  it('files the turn\'s mark under the answer and opens it in place', async () => {
    const { getByTestId, queryByTestId } = renderWithI18n(<AnswerPaper job={answered} />);
    const mark = getByTestId('thought-mark');
    expect(mark.textContent).toContain('thought for 1:42');
    expect(queryByTestId('thoughts-box')).toBeNull();
    fireEvent.click(mark);
    expect(getByTestId('thoughts-box').textContent).toContain('the plaza is locked');
    fireEvent.click(mark);
    expect(mark.getAttribute('aria-expanded')).toBe('false');
    await waitFor(() => { expect(queryByTestId('thoughts-box')).toBeNull(); });
  });

  it('carries no rows for a job that did no thinking', () => {
    const { queryByTestId } = renderWithI18n(
      <AnswerPaper job={makeJob({ outcome: 'done', kind: 'answer', summary: 'Nothing there.' })} />,
    );
    expect(queryByTestId('answer-thoughts')).toBeNull();
  });
});

describe('the receipt: one honest total and nothing else about the thinking', () => {
  const settled = (thought: JobView['thought']) => makeJob({
    outcome: 'done',
    kind: 'build',
    summary: 'Six huts stand along the boardwalk.',
    ops: [makeOp({ detail: { objects: 6 } })],
    ...(thought ? { thought } : {}),
  });

  it('says the total across the turns it took, and shows no transcript', () => {
    const job = settled({
      chars: 12_000,
      turns: 12,
      ms: 260_000,
      marks: [makeMark({ text: LONG_COT })],
    });
    const { getByTestId } = renderWithI18n(<FlipTicket job={job} />);
    expect(getByTestId('ticket-thoughts').textContent).toBe('thought for 4:20 across 12 turns');
    expect(getByTestId('flip-ticket').textContent).not.toContain('the plaza is locked');
  });

  it('says it plainly where one turn did all of it', () => {
    const job = settled({ chars: 1204, turns: 1, ms: 102_000, marks: [makeMark()] });
    const { getByTestId } = renderWithI18n(<FlipTicket job={job} />);
    expect(getByTestId('ticket-thoughts').textContent).toBe('thought for 1:42');
  });

  it('says nothing at all about a job that did no thinking', () => {
    const { queryByTestId } = renderWithI18n(<FlipTicket job={settled(undefined)} />);
    expect(queryByTestId('ticket-thoughts')).toBeNull();
  });
});

/**
 * The whole chain, once: the projection's live reasoning reaches the ticket the panel mounts, the
 * affordance is there, and the box it opens is the panel's own. Without this the three components
 * above can each be right while nothing wires them.
 */
describe('the panel stands the affordance over a live job', () => {
  const verbs = {
    onSend: () => {}, onStop: () => {}, onPause: () => {}, onGateAnswer: () => {},
  };

  it('offers the current turn on the live ticket, and opens it in place', () => {
    const view = thinking({ thought: { chars: 1204, turns: 1, marks: [], ms: 0, live: LONG_COT } });
    const { getByTestId, queryByTestId } = renderWithI18n(
      <PanelShell {...panelProps({ view, connected: true, now: 42_000, ...verbs })} />,
    );
    expect(queryByTestId('thoughts-box')).toBeNull();
    fireEvent.click(getByTestId('thoughts-toggle'));
    expect(getByTestId('panel-job-zone').contains(getByTestId('thoughts-box'))).toBe(true);
  });
});

describe('every locale carries the reasoning family', () => {
  const KEYS = [
    'agent.dock_still_thinking', 'agent.dock_stall', 'agent.thoughts_so_far',
    'agent.thought_mark', 'agent.thoughts_total', 'agent.thoughts_total_single',
    'agent.thoughts_read', 'agent.thoughts_hide', 'agent.thoughts_excerpt',
  ] as const;

  it('has every key in all seven, with the placeholders en declares', () => {
    for (const locale of LOCALES) {
      for (const key of KEYS) {
        const line = translations[locale][key];
        expect(line, `${locale}:${key}`).toBeTruthy();
        for (const token of translations.en[key]!.match(/\{[a-z]+\}/g) ?? []) {
          expect(line, `${locale}:${key}:${token}`).toContain(token);
        }
      }
    }
  });
});
