/**
 * fin-ticket.test.tsx — THE TERMINAL FAMILY: one grammar, five hierarchies.
 *
 * Each block below pins ONE hierarchy against what the artifact says leads it, and — just as
 * importantly — against what it must NOT carry: `done` has no ledger and no tape (the gauge is the
 * capped hierarchy's own), `done.capped` has no postcard and no counting stats, `aborted` has no
 * flip at all, the compact settle has no File it away, and the archive card has no flip, no counts
 * and no per-step rewind.
 *
 * THE TWO RULES THAT BIND EVERY ONE OF THEM are tested where they are made rather than per card:
 * a zero count renders no stat cell (a printed zero is a count of an absence), and nothing here
 * fabricates a step (`DI#26` — a job with no checkpoint has no story, so no flip is grown).
 *
 * The count-up is judged on the two frames that matter: the FIRST one, which must read `0` because
 * a figure that mounted at its total and then dropped to zero would read as the card correcting
 * itself, and the LAST one. Under reduced motion there is only one frame and it is the total.
 *
 * Reduced motion is driven by framer's own `<MotionConfig reducedMotion="always">` rather than by
 * the `<html data-reduced-motion>` attribute, matching `atoms.test.tsx`: the components read
 * `useReducedMotionConfig()`, so the provider is the whole input.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { I18nProvider } from '../../../i18n/context';
import { ArchiveCard, FlipTicket, StopCard } from '../../../ui/agent/FlipTicket';
import type { JobView, OpRow as OpRowData } from '../../../agent/core/project-view';

const backing = new Map<string, string>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).localStorage = {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
};

function Wrapper({ children }: { children: React.ReactNode }) {
  return <I18nProvider>{children}</I18nProvider>;
}

function renderWithI18n(node: React.ReactElement) {
  return render(node, { wrapper: Wrapper });
}

/** The same tree with framer told the reader wants no motion. */
function renderReduced(node: React.ReactElement) {
  return render(<MotionConfig reducedMotion="always">{node}</MotionConfig>, { wrapper: Wrapper });
}

beforeEach(() => {
  backing.clear();
});

let opSeq = 0;
function makeOp(over: Partial<OpRowData> = {}): OpRowData {
  opSeq += 1;
  return { callId: `op-${opSeq}`, name: 'place_object', status: 'ok', summary: '', isRead: false, ...over };
}

function makeJob(over: Partial<JobView> = {}): JobView {
  return {
    orderSeq: 1,
    orderText: 'Build a fishing village on the east shore',
    orderAt: 0,
    ops: [],
    steerNotes: [],
    checkpoints: [],
    stamps: [],
    outcome: 'done',
    celebrate: false,
    asks: [],
    skills: [],
    ...over,
  };
}

/** The artifact's own village job: a boardwalk, six houses and a pine grove, over four checkpoints. */
const VILLAGE = makeJob({
  // Each call carries the plan stage it ran under, as the fold stamps one.
  ops: [
    makeOp({ name: 'view_map', isRead: true, stageIndex: 0 }),
    makeOp({ name: 'build_road', detail: { cells: 118 }, stageIndex: 0 }),
    makeOp({ name: 'place_object', detail: { objects: 6 }, stageIndex: 1 }),
    makeOp({ name: 'plant_forest', detail: { objects: 24 }, stageIndex: 2 }),
  ],
  checkpoints: [
    { undoIndex: 0, label: 'job' },
    { undoIndex: 4, label: 'stage', stageIndex: 0 },
    { undoIndex: 11, label: 'stage', stageIndex: 1 },
  ],
  plan: {
    stages: [{ label: 'Lay the boardwalk' }, { label: 'Raise the houses' }, { label: 'Plant the pines' }],
    currentIndex: 2,
    doneCount: 2,
    revision: 1,
  },
  summary: 'A fishing village stands on the east shore. Boardwalk, six houses, a pine grove behind.',
});

/* ── hierarchy 1: done ────────────────────────────────────── */

describe('done: the built thing leads', () => {
  it('leads with the postcard over the counting stats, names the order, and grows no ledger', () => {
    const { getByTestId, queryByTestId } = renderWithI18n(
      <FlipTicket job={VILLAGE} postcard={<span data-testid="shot" />} onFileAway={() => {}} />,
    );
    expect(getByTestId('flip-ticket').getAttribute('data-shape')).toBe('full');
    expect(getByTestId('ticket-stamp').textContent).toBe('Built');
    expect(getByTestId('ticket-postcard').querySelector('[data-testid="shot"]')).not.toBeNull();
    expect(getByTestId('ticket-order').textContent).toBe('Build a fishing village on the east shore');
    expect(getByTestId('ticket-stats')).toBeTruthy();
    expect(getByTestId('ticket-summary').textContent).toContain('A fishing village stands');
    // The ledger is the capped card's, and only the capped card's.
    expect(queryByTestId('ticket-ledger')).toBeNull();
    expect(queryByTestId('ticket-keep-going')).toBeNull();
  });

  /**
   * A TURN NEVER GROWS THE RECORD'S SCROLLBAR. A perspective projection magnifies the near half of
   * the rotating card past its own box, and a scroller counts a descendant's projected geometry as
   * scrollable overflow — but only DOWNWARD overflow is scrollable; above the scroll origin it is
   * unreachable and adds nothing. So the perspective origin sits on the card's BOTTOM edge: every
   * point of both faces projects away from that line, upward, and the geometry below it is bounded
   * by the box at every angle of the turn. jsdom does no layout, so what is pinned is the projection
   * origin itself; the number is verified live (panel-harness, `state=done`, `motion=1`): with the
   * centred origin the job zone's scrollHeight rose 390→424 through the turn and its clientWidth
   * dropped 358→347 (a scrollbar seizing its 11px mid-flip, both directions, peaking edge-on); with
   * the bottom origin both held flat through the whole turn.
   */
  it('projects the turn upward off the bottom edge, so a flip adds no scrollable overflow', () => {
    const { getByTestId } = renderWithI18n(<FlipTicket job={VILLAGE} onFileAway={() => {}} />);
    expect(getByTestId('flip-ticket').style.perspectiveOrigin).toBe('50% 100%');
  });

  /**
   * A TURN IS READ FROM THE TOP. The two faces share one box inside a zone that scrolls, so a front
   * face read at an offset of 293px turned into a back face opened at 293px: the story's heading
   * scrolled off above, and on a shorter back face the reader landed past its foot on empty plate.
   */
  it('brings the card\'s own head back under the eye when it turns', () => {
    const calls: unknown[] = [];
    // jsdom implements no scrolling at all; the call is the contract, and the shipped code guards on
    // the method existing for exactly that reason.
    Element.prototype.scrollIntoView = function scrollIntoView(this: HTMLElement, arg?: unknown) {
      calls.push({ target: this.getAttribute('data-testid'), arg });
    };
    try {
      const { getByTestId } = renderWithI18n(<FlipTicket job={VILLAGE} onFileAway={() => {}} />);
      fireEvent.click(getByTestId('flip-button'));
      expect(getByTestId('flip-ticket').getAttribute('data-face')).toBe('back');
      expect(calls).toEqual([{ target: 'flip-inner', arg: { block: 'start' } }]);
      fireEvent.click(getByTestId('flip-button-back'));
      expect(calls).toHaveLength(2);
    } finally {
      delete (Element.prototype as Partial<Element>).scrollIntoView;
    }
  });

  it('carries File it away and the read verb, and no primary of its own', () => {
    const filed: number[] = [];
    const { getByTestId, queryByTestId } = renderWithI18n(
      <FlipTicket job={VILLAGE} onFileAway={(seq) => filed.push(seq)} onKeepGoing={() => {}} />,
    );
    expect(getByTestId('flip-button')).toBeTruthy();
    // `onKeepGoing` is wired and STILL draws nothing: the primary belongs to the capped hierarchy.
    expect(queryByTestId('ticket-keep-going')).toBeNull();
    fireEvent.click(getByTestId('ticket-file-away'));
    expect(filed).toEqual([1]);
  });

  /** THE TAPE IS THE CAPPED HIERARCHY'S OWN. The artifact's done card puts the postcard straight
   *  under the order line and carries no gauge at all: a finished job earns no bar for finishing,
   *  whatever plan it ran. A capped one shows the stages it got through, which is the whole point of
   *  that card. */
  it('draws no tape on a finished job, and the plan\'s own fraction on a capped one', () => {
    const done = renderReduced(<FlipTicket job={VILLAGE} />);
    expect(done.queryByTestId('tape-bar')).toBeNull();
    done.unmount();

    const capped = renderReduced(<FlipTicket job={makeJob({ ...VILLAGE, outcome: 'capped' })} />);
    expect((capped.getByTestId('tape-bar').firstElementChild as HTMLElement).style.width)
      .toBe(`${(2 / 3) * 100}%`);
    capped.unmount();

    const planless = renderReduced(<FlipTicket job={makeJob({ ops: VILLAGE.ops })} />);
    expect(planless.queryByTestId('tape-bar')).toBeNull();
  });

  it('draws no postcard frame at all where the caller has no shot', () => {
    const { queryByTestId } = renderWithI18n(<FlipTicket job={VILLAGE} />);
    expect(queryByTestId('ticket-postcard')).toBeNull();
  });

  it('chips the score in the header seat, and leaves it out where there is none', () => {
    const scored = renderWithI18n(<FlipTicket job={VILLAGE} score={82} />);
    expect(scored.getByTestId('ticket-score').textContent).toBe('82');
    scored.unmount();
    expect(renderWithI18n(<FlipTicket job={VILLAGE} />).queryByTestId('ticket-score')).toBeNull();
  });
});

describe('the stat row', () => {
  it('names one cell per figure, labelled', () => {
    const { getAllByTestId } = renderReduced(<FlipTicket job={VILLAGE} />);
    const cells = getAllByTestId('ticket-stat');
    expect(cells.length).toBe(2);
    expect(cells.map((el) => el.querySelector('[data-testid="ticket-stat-n"]')!.textContent))
      .toEqual(['118', '30']);
    expect(cells.map((el) => el.querySelector('[data-testid="ticket-stat-label"]')!.textContent))
      .toEqual(['cells', 'objects']);
  });

  /** A ZERO IS SUPPRESSED. "0 objects" reports a kind of work this job never set out to do. */
  it('grows no cell for a figure that came back zero', () => {
    const roadOnly = makeJob({ ops: [makeOp({ name: 'build_road', detail: { cells: 36 } })] });
    const { getAllByTestId } = renderReduced(<FlipTicket job={roadOnly} />);
    const cells = getAllByTestId('ticket-stat');
    expect(cells.length).toBe(1);
    expect(cells[0]!.querySelector('[data-testid="ticket-stat-label"]')!.textContent).toBe('cells');
  });

  it('grows no row at all for a job that changed nothing', () => {
    const readOnly = makeJob({ ops: [makeOp({ name: 'view_map', isRead: true })] });
    const { queryByTestId } = renderReduced(<FlipTicket job={readOnly} />);
    expect(queryByTestId('ticket-stats')).toBeNull();
  });

  /** ZEROED IN THE SAME FRAME IT RENDERS, then counted up to what was built. */
  it('mounts at zero and counts up to the figure', async () => {
    const { getAllByTestId } = renderWithI18n(<FlipTicket job={VILLAGE} />);
    const figures = () => getAllByTestId('ticket-stat-n').map((el) => el.textContent);
    expect(figures()).toEqual(['0', '0']);
    await waitFor(() => { expect(figures()).toEqual(['118', '30']); }, { timeout: 4000 });
  });

  /** Under reduced motion the figure is simply what was built, in the first frame. */
  it('stands at the figure outright under reduced motion', () => {
    const { getAllByTestId } = renderReduced(<FlipTicket job={VILLAGE} />);
    expect(getAllByTestId('ticket-stat-n').map((el) => el.textContent)).toEqual(['118', '30']);
  });
});

/* ── hierarchy 2: done at the cap ─────────────────────────── */

describe('done.capped: the ledger leads and the decision owns the foot', () => {
  const capped = makeJob({
    outcome: 'capped',
    ops: VILLAGE.ops,
    checkpoints: VILLAGE.checkpoints,
    plan: { ...VILLAGE.plan!, doneCount: 2 },
    summary: 'The turn budget ran out during the last stage. The pines remain.',
  });

  it('stands the stage ledger on the FRONT, with the unreached stage open in revert ink', () => {
    const { getByTestId, getAllByTestId, queryByTestId } = renderReduced(
      <FlipTicket job={capped} onKeepGoing={() => {}} onFileAway={() => {}} />,
    );
    expect(getByTestId('flip-ticket').getAttribute('data-shape')).toBe('capped');
    expect(getByTestId('ticket-stamp').textContent).toBe('Stopped at the cap');
    const rows = getAllByTestId('ticket-ledger');
    expect(rows.map((el) => el.querySelector('[data-testid="ticket-ledger-name"]')!.textContent))
      .toEqual(['Lay the boardwalk', 'Raise the houses', 'Plant the pines']);
    // The two that finished carry a tick; the one the cap stopped stands open.
    expect(rows.slice(0, 2).every((el) => el.querySelector('[data-testid="ticket-ledger-tick"]') !== null)).toBe(true);
    const open = rows[2]!;
    expect(open.getAttribute('data-unreached')).toBe('true');
    expect(open.style.border).toContain('dashed');
    expect(open.querySelector('[data-testid="ticket-ledger-tick"]')).toBeNull();
    expect(open.querySelector('[data-testid="ticket-ledger-stat"]')!.textContent).toBe('not reached');
    // The revert amber, said once, at the rung it earns.
    const name = open.querySelector('[data-testid="ticket-ledger-name"]') as HTMLElement;
    expect(name.style.color).toBe('rgb(185, 127, 36)');
    // No hero, no counting: the news is the stage that did not happen.
    expect(queryByTestId('ticket-postcard')).toBeNull();
    expect(queryByTestId('ticket-stats')).toBeNull();
  });

  it('makes Keep going the ink primary beside File it away', () => {
    const kept: number[] = [];
    const filed: number[] = [];
    const { getByTestId } = renderReduced(
      <FlipTicket job={capped} onKeepGoing={() => kept.push(1)} onFileAway={(s) => filed.push(s)} />,
    );
    const primary = getByTestId('ticket-keep-going');
    expect(primary.textContent).toContain('Keep going');
    fireEvent.click(primary);
    expect(kept).toEqual([1]);
    fireEvent.click(getByTestId('ticket-file-away'));
    expect(filed).toEqual([1]);
  });

  /** The read verb yields the foot to the decision and rides the header seat instead. */
  it('puts the flip control in the header seat rather than the foot, and draws no score there', () => {
    const { getByTestId, queryByTestId } = renderReduced(
      <FlipTicket job={capped} score={71} onKeepGoing={() => {}} onFileAway={() => {}} />,
    );
    const flip = getByTestId('flip-button');
    expect(getByTestId('ticket-actions').contains(flip)).toBe(false);
    expect(queryByTestId('ticket-score')).toBeNull();
    fireEvent.click(flip);
    expect(getByTestId('flip-ticket').getAttribute('data-face')).toBe('back');
  });

  /**
   * A LEDGER ROW OWES A FIGURE. Which stages finished says nothing about what they DID, and the
   * job's own results carry it: the measure is the stage's OWN work — cells where it
   * painted, objects where it placed, reads where it only looked — never a count of calls, which
   * would be a figure about the assistant's method rather than about the map.
   */
  it('reports each finished stage\'s own measure beside its tick', () => {
    const { getAllByTestId } = renderReduced(
      <FlipTicket job={capped} onKeepGoing={() => {}} onFileAway={() => {}} />,
    );
    const stats = getAllByTestId('ticket-ledger')
      .map((el) => el.querySelector('[data-testid="ticket-ledger-stat"]')?.textContent ?? null);
    expect(stats).toEqual(['118 cells', '6 objects', 'not reached']);
  });

  /** A stage that only LOOKED still did something, and the dock's own words for it are reused rather
   *  than a second copy kept here. A stage with nothing to report gets no figure at all — an empty
   *  seat is a fact, "0 cells" is a claim about work nobody asked for. */
  it('falls back to the reads, and says nothing for a stage with nothing to report', () => {
    const job = makeJob({
      outcome: 'capped',
      ops: [
        makeOp({ name: 'view_map', isRead: true, stageIndex: 0 }),
        makeOp({ name: 'view_map', isRead: true, stageIndex: 0 }),
        makeOp({ name: 'update_plan', stageIndex: 1 }),
      ],
      checkpoints: VILLAGE.checkpoints,
      plan: { stages: [{ label: 'Read it' }, { label: 'Think' }, { label: 'Build' }], currentIndex: 2, doneCount: 2, revision: 1 },
    });
    const { getAllByTestId } = renderReduced(<FlipTicket job={job} />);
    const stats = getAllByTestId('ticket-ledger')
      .map((el) => el.querySelector('[data-testid="ticket-ledger-stat"]')?.textContent ?? null);
    expect(stats).toEqual(['2 reads', null, 'not reached']);
  });

  /**
   * A CAPPED RUN WITH NO PLAN HAS NO STAGE TO LEAD WITH, and the card said nothing about the work
   * instead: the live 40-turn run that hit the cap had placed 119 objects and painted a cell, and its
   * receipt carried the flag, the order and two verbs. The ledger is what displaces the counts on a
   * capped card, so where there is none the built thing is the hero, as it is on a done receipt.
   */
  it('leads a planless capped run with the built thing and its counts, since it has no ledger to lead with', () => {
    const planless = makeJob({ outcome: 'capped', ops: VILLAGE.ops, checkpoints: VILLAGE.checkpoints });
    const { getByTestId, queryByTestId } = renderReduced(
      <FlipTicket job={planless} postcard={<span data-testid="shot" />} onKeepGoing={() => {}} />,
    );
    expect(queryByTestId('ticket-ledger')).toBeNull();
    expect(getByTestId('ticket-postcard')).toBeTruthy();
    expect(getByTestId('ticket-stats').textContent).toContain('118');
    // Still the capped hierarchy in every other respect: the flag, and the decision at the foot.
    expect(getByTestId('flip-ticket').getAttribute('data-shape')).toBe('capped');
    expect(getByTestId('ticket-keep-going')).toBeTruthy();
  });
});

/* ── hierarchy 3: aborted ─────────────────────────────────── */

describe('aborted: one face, the fact at the headline rung, two answers', () => {
  const stopped = makeJob({
    outcome: 'aborted',
    orderText: 'Connect the plaza to the old mill',
    ops: [makeOp({ name: 'build_road', detail: { cells: 9 } })],
    checkpoints: [{ undoIndex: 3, label: 'job' }],
  });

  it('has no flip at all, and states the kept edits at the headline rung', () => {
    const { getByTestId, queryByTestId } = renderReduced(
      <StopCard job={stopped} clock="1:12" onRewindAll={() => {}} onFileAway={() => {}} />,
    );
    expect(getByTestId('stop-card')).toBeTruthy();
    expect(queryByTestId('flip-ticket')).toBeNull();
    expect(queryByTestId('flip-button')).toBeNull();
    expect(getByTestId('ticket-stamp').textContent).toBe('Stopped by you');
    expect(getByTestId('stop-clock').textContent).toBe('1:12');
    expect(getByTestId('ticket-order').textContent).toBe('Connect the plaza to the old mill');
    expect(getByTestId('stop-fact').textContent).toBe('9 edits are on your map.');
    expect(getByTestId('stop-note').textContent).toContain('Ctrl+Z');
  });

  /** A stop that landed before anything was written has no kept-edits fact to state. */
  it('says nothing about edits where there were none', () => {
    const early = makeJob({ outcome: 'aborted', ops: [], checkpoints: [{ undoIndex: 0, label: 'job' }] });
    const { queryByTestId } = renderReduced(<StopCard job={early} onRewindAll={() => {}} />);
    expect(queryByTestId('stop-fact')).toBeNull();
  });

  /** ONE EDIT READS AS ONE, not as "1 edits": the fact wears the same singular/plural agreement the
   *  dock's own stage count already carries (`dock_stage_left_one`/`dock_stages_left`). */
  it('says "1 edit", not "1 edits", where the job kept exactly one', () => {
    const one = makeJob({
      outcome: 'aborted',
      ops: [makeOp({ name: 'place_object', detail: { objects: 1 } })],
      checkpoints: [{ undoIndex: 1, label: 'job' }],
    });
    const { getByTestId } = renderReduced(<StopCard job={one} onRewindAll={() => {}} />);
    expect(getByTestId('stop-fact').textContent).toBe('1 edit is on your map.');
  });

  /**
   * THE VERB BECOMES THE QUESTION while File it away dims where it stands: the row never reflows
   * around it, so the hand travelling toward an answer keeps its target — the same control it was
   * already on.
   */
  it('asks in the verb\'s own words before rewinding, and hushes the leave verb', () => {
    const rewound: number[] = [];
    const { getByTestId } = renderReduced(
      <StopCard job={stopped} onRewindAll={() => rewound.push(1)} onFileAway={() => {}} />,
    );
    const leave = getByTestId('ticket-file-away');
    const before = leave.parentElement!;
    fireEvent.click(getByTestId('stop-rewind'));

    expect(getByTestId('stop-rewind').textContent).toBe('Rewind it all?');
    // The leave verb is still exactly where it was, dimmed and deaf.
    expect(getByTestId('ticket-file-away').parentElement).toBe(before);
    expect(before.style.pointerEvents).toBe('none');
    expect(Number(before.style.opacity)).toBeLessThan(1);

    fireEvent.click(getByTestId('stop-rewind'));
    expect(rewound).toEqual([1]);
    expect(getByTestId('stop-rewind').textContent).toBe('Rewind to start');
  });

  it('offers no rewind once the job is already off the map', () => {
    const { queryByTestId } = renderReduced(
      <StopCard job={stopped} rolledBack onRewindAll={() => {}} onFileAway={() => {}} />,
    );
    expect(queryByTestId('stop-rewind')).toBeNull();
    expect(queryByTestId('stop-note')).toBeNull();
    expect(queryByTestId('ticket-file-away')).toBeTruthy();
  });

  it('offers no rewind for a job that took no checkpoint, since there is no watermark to aim at', () => {
    const noMark = makeJob({ outcome: 'aborted', ops: [makeOp({ detail: { cells: 4 } })], checkpoints: [] });
    const { queryByTestId } = renderReduced(<StopCard job={noMark} onRewindAll={() => {}} />);
    expect(queryByTestId('stop-rewind')).toBeNull();
  });
});

/* ── hierarchy 4: the compact settle ──────────────────────── */

describe('done.question: the receipt compresses to a two-line settle', () => {
  const asked = makeJob({ ...VILLAGE, question: true, orderText: 'Carve the stream to the south end' });

  it('keeps its flip and drops the hero, the stats and File it away', () => {
    const { getByTestId, queryByTestId } = renderReduced(
      <FlipTicket
        job={asked}
        compact
        archiveStamp="Today"
        postcard={<span data-testid="shot" />}
        onFileAway={() => {}}
      />,
    );
    expect(getByTestId('flip-ticket').getAttribute('data-shape')).toBe('compact');
    expect(queryByTestId('ticket-postcard')).toBeNull();
    expect(queryByTestId('ticket-stats')).toBeNull();
    expect(queryByTestId('ticket-file-away')).toBeNull();
    // The flip is intact: the story is still one press away.
    fireEvent.click(getByTestId('flip-button'));
    expect(getByTestId('flip-ticket').getAttribute('data-face')).toBe('back');
  });

  it('stands at the compact floor rather than the card floor', () => {
    const compact = renderReduced(<FlipTicket job={asked} compact />);
    expect(compact.getByTestId('flip-inner').style.minHeight).toBe('118px');
    compact.unmount();
    const full = renderReduced(<FlipTicket job={VILLAGE} />);
    expect(full.getByTestId('flip-inner').style.minHeight).toBe('290px');
  });

  it('wears its provenance in the seat where a done receipt wears its score', () => {
    const { getByTestId } = renderReduced(<FlipTicket job={asked} compact archiveStamp="Today" />);
    expect(getByTestId('ticket-head-stamp').textContent).toBe('Today');
  });
});

/* ── hierarchy 5: the opened past record ──────────────────── */

describe('history.open: the archive dress', () => {
  it('stands the steps INLINE, with no flip, no counts and no postcard', () => {
    const { getByTestId, getAllByTestId, queryByTestId } = renderReduced(
      <ArchiveCard job={VILLAGE} stamp="Earlier" onBack={() => {}} onClear={() => {}} />,
    );
    expect(getByTestId('archive-card')).toBeTruthy();
    expect(queryByTestId('flip-ticket')).toBeNull();
    expect(queryByTestId('flip-button')).toBeNull();
    expect(queryByTestId('ticket-stats')).toBeNull();
    expect(queryByTestId('ticket-postcard')).toBeNull();
    expect(queryByTestId('ticket-score')).toBeNull();
    expect(getByTestId('archive-stamp').textContent).toBe('Earlier');
    expect(getAllByTestId('archive-step').length).toBe(3);
    expect(getAllByTestId('archive-step-name').map((el) => el.textContent))
      .toEqual(['Before the job', 'Lay the boardwalk', 'Raise the houses']);
  });

  /** Later jobs sit on top of a mid-job state, so a rewind INTO one would take their work with it. */
  it('offers no per-step rewind', () => {
    const { queryAllByTestId } = renderReduced(<ArchiveCard job={VILLAGE} onBack={() => {}} />);
    expect(queryAllByTestId('ticket-step-rewind').length).toBe(0);
  });

  it('makes Back the one lit act, first, and stands Clear behind its confirm, last', () => {
    const backs: number[] = [];
    const cleared: number[] = [];
    const { getByTestId } = renderReduced(
      <ArchiveCard job={VILLAGE} onBack={() => backs.push(1)} onClear={(s) => cleared.push(s)} />,
    );
    const foot = getByTestId('archive-foot');
    const back = getByTestId('archive-back');
    const clear = getByTestId('archive-clear');
    // Back reads first in the foot's DOM order, which is its tab order too.
    const order = [...foot.querySelectorAll('button')].map((el) => el.getAttribute('data-testid'));
    expect(order.indexOf('archive-back')).toBeLessThan(order.indexOf('archive-clear'));

    fireEvent.click(back);
    expect(backs).toEqual([1]);

    fireEvent.click(clear);
    expect(getByTestId('archive-clear').textContent).toBe('Clear it?');
    // Back keeps its rect and stops answering while the question stands.
    expect(getByTestId('archive-back').parentElement!.style.pointerEvents).toBe('none');
    fireEvent.click(getByTestId('archive-clear'));
    expect(cleared).toEqual([1]);
  });
});

/* ── what binds all five ──────────────────────────────────── */

/**
 * EVERY CONFIRM ON THESE CARDS OPENS WITHOUT MOVING ANYTHING, and it is one assertion per site rather
 * than a rule stated once: a confirm rearranges its surroundings by what the SURFACE puts around it —
 * a note that appears under the row, a sibling withdrawn to make room — so the primitive being
 * correct proves nothing about the card it is standing in.
 *
 * jsdom lays nothing out, so what is compared is the thing that MAKES the geometry stable: every
 * landmark is the same node, under the same parent, at the same index among that parent's children.
 * The seat's own contents are the ONE thing allowed to change, which is why they are excluded.
 */
describe('a question opens without moving the card', () => {
  /** Every landmark outside the seats, as node + parent + index. */
  function landmarks(root: HTMLElement): { id: string; parent: Element | null; index: number }[] {
    return [...root.querySelectorAll<HTMLElement>('[data-testid]')]
      .filter((el) => el.closest('[data-testid="inline-confirm-seat"]') === null)
      .map((el) => ({
        id: el.dataset.testid ?? '',
        parent: el.parentElement,
        index: [...(el.parentElement?.children ?? [])].indexOf(el),
      }));
  }

  const stopped = makeJob({
    outcome: 'aborted', ops: [makeOp({ detail: { cells: 12 } })],
    checkpoints: [{ undoIndex: 1, label: 'job' }],
  });

  it('holds every landmark still when the stop card asks', () => {
    const { getByTestId } = renderReduced(
      <StopCard job={stopped} onRewindAll={() => {}} onFileAway={() => {}} />,
    );
    const card = getByTestId('stop-card');
    const before = landmarks(card);
    fireEvent.click(getByTestId('stop-rewind'));
    expect(landmarks(card)).toEqual(before);
  });

  it('holds every landmark still when the archive foot asks', () => {
    const { getByTestId } = renderReduced(
      <ArchiveCard job={VILLAGE} onBack={() => {}} onClear={() => {}} />,
    );
    const foot = getByTestId('archive-foot');
    const before = landmarks(foot);
    fireEvent.click(getByTestId('archive-clear'));
    expect(landmarks(foot)).toEqual(before);
  });

  it('holds every landmark still when a step and the whole job ask, on the story face', () => {
    const { getByTestId, getAllByTestId } = renderReduced(
      <FlipTicket job={VILLAGE} onRewind={() => {}} onRewindAll={() => {}} />,
    );
    fireEvent.click(getByTestId('flip-button'));
    const back = getByTestId('flip-face-back');

    const beforeStep = landmarks(back);
    fireEvent.click(getAllByTestId('ticket-step-rewind')[2]!);
    expect(landmarks(back), 'a step asking').toEqual(beforeStep);
    fireEvent.pointerDown(document.body);

    const beforeAll = landmarks(back);
    fireEvent.click(getByTestId('ticket-rewind-all'));
    expect(landmarks(back), 'the whole job asking').toEqual(beforeAll);
  });
});

describe('the whole family', () => {
  /** DI#26: nothing here invents a step count. A job with no checkpoint has no story to turn to. */
  it('grows no flip and no back face for a job that recorded no checkpoint', () => {
    const readOnly = makeJob({ ops: [makeOp({ name: 'view_map', isRead: true })], checkpoints: [] });
    const { queryByTestId, getByTestId } = renderReduced(<FlipTicket job={readOnly} onRewind={() => {}} />);
    expect(queryByTestId('flip-button')).toBeNull();
    expect(queryByTestId('flip-face-back')).toBeNull();
    expect(getByTestId('flip-ticket').getAttribute('data-face')).toBe('front');
  });

  /** EVERY TAKE-BACK ON A LIVE RECEIPT LIVES ON THE FLIP'S BACK FACE. */
  it('keeps both rewinds off the front and puts them beside the story they undo', () => {
    const rewound: number[] = [];
    const all: number[] = [];
    const { getByTestId, getAllByTestId, queryAllByTestId } = renderReduced(
      <FlipTicket job={VILLAGE} onRewind={(c) => rewound.push(c.undoIndex)} onRewindAll={() => all.push(1)} />,
    );
    expect(queryAllByTestId('ticket-step-rewind').length).toBe(3);
    // They are all inside the back face, never the front.
    const front = getByTestId('flip-face-front');
    expect(getAllByTestId('ticket-step-rewind').some((el) => front.contains(el))).toBe(false);
    expect(front.querySelector('[data-testid="ticket-rewind-all"]')).toBeNull();

    // Both take-backs stand behind a confirm: the per-step one discards every later step too.
    fireEvent.click(getByTestId('flip-button'));
    fireEvent.click(getAllByTestId('ticket-step-rewind')[2]!);
    fireEvent.click(getAllByTestId('ticket-step-rewind')[2]!);
    expect(rewound).toEqual([11]);

    fireEvent.click(getByTestId('ticket-rewind-all'));
    expect(getByTestId('ticket-rewind-all').textContent).toContain('Rewind it all?');
    fireEvent.click(getByTestId('ticket-rewind-all'));
    expect(all).toEqual([1]);
  });

  it('reads every step as rewound, and offers no rewind, once the whole job is rolled back', () => {
    const { getByTestId, getAllByTestId, queryAllByTestId } = renderReduced(
      <FlipTicket job={VILLAGE} rolledBack onRewind={() => {}} onRewindAll={() => {}} />,
    );
    fireEvent.click(getByTestId('flip-button'));
    for (const step of getAllByTestId('ticket-step')) {
      expect(step.getAttribute('data-rewound')).toBe('true');
      expect(step.querySelector('[data-testid="ticket-step-stat"]')!.textContent).toBe('rewound');
    }
    expect(queryAllByTestId('ticket-step-rewind').length).toBe(0);
    expect(queryAllByTestId('ticket-rewind-all').length).toBe(0);
  });

  it('names each step from the plan where the plan named it, and by its kind otherwise', () => {
    const { getByTestId, getAllByTestId } = renderReduced(<FlipTicket job={VILLAGE} />);
    fireEvent.click(getByTestId('flip-button'));
    expect(getAllByTestId('ticket-step-name').map((el) => el.textContent))
      .toEqual(['Before the job', 'Lay the boardwalk', 'Raise the houses']);
    expect(getByTestId('ticket-back-stamp').textContent).toBe('4 steps');
  });

  /**
   * BOTH FACES STAND IN ONE BOX and the back one paints LAST, so `backface-visibility` is what keeps
   * the turned-away face off the front. Without it the whole receipt reads MIRRORED (which is what
   * the fidelity rig photographed once). It only works inside a 3D rendering context, so the dim a
   * rolled-back record wears may not sit on the `perspective` box above the faces.
   */
  it('hides each face\'s own back, and dims the faces rather than the card', () => {
    const plain = renderReduced(<FlipTicket job={VILLAGE} />);
    const card = plain.getByTestId('flip-ticket');
    expect(card.style.perspective).toBe('1100px');
    expect(plain.getByTestId('flip-inner').style.transformStyle).toBe('preserve-3d');
    for (const id of ['flip-face-front', 'flip-face-back']) {
      expect(plain.getByTestId(id).style.backfaceVisibility, id).toBe('hidden');
    }
    expect(plain.getByTestId('flip-face-back').style.transform).toBe('rotateY(180deg)');
    // Nothing between the perspective box and the faces groups them out of the 3D context.
    expect(card.style.opacity).toBe('');
    expect(plain.getByTestId('flip-inner').style.opacity).toBe('');
    plain.unmount();

    const rolled = renderReduced(<FlipTicket job={VILLAGE} rolledBack />);
    expect(rolled.getByTestId('flip-ticket').style.opacity).toBe('');
    expect(Number(rolled.getByTestId('flip-face-front').style.opacity)).toBeLessThan(1);
    expect(Number(rolled.getByTestId('flip-face-back').style.opacity)).toBeLessThan(1);
  });

  it('turns over a real rotation, and swaps the faces outright under reduced motion', () => {
    const full = renderWithI18n(<FlipTicket job={VILLAGE} />);
    expect(full.getByTestId('flip-inner').style.transition).toContain('transform');
    full.unmount();

    const reduced = renderReduced(<FlipTicket job={VILLAGE} />);
    const inner = reduced.getByTestId('flip-inner');
    expect(inner.getAttribute('data-reduced')).toBe('true');
    expect(inner.style.transition).toBe('none');
    fireEvent.click(reduced.getByTestId('flip-button'));
    expect(reduced.getByTestId('flip-ticket').getAttribute('data-face')).toBe('back');
  });

  it('stamps each outcome with its own words and glyph', () => {
    const cases: [JobView['outcome'], string, string][] = [
      ['done', 'Built', '#pw-check'],
      ['capped', 'Stopped at the cap', '#pw-flag'],
    ];
    for (const [outcome, words, glyph] of cases) {
      const view = renderReduced(<FlipTicket job={makeJob({ outcome })} />);
      const stamp = view.getByTestId('ticket-stamp');
      expect(stamp.textContent).toBe(words);
      expect(stamp.querySelector('use')?.getAttribute('href')).toBe(glyph);
      view.unmount();
    }
    const stop = renderReduced(<StopCard job={makeJob({ outcome: 'aborted' })} />);
    expect(stop.getByTestId('ticket-stamp').querySelector('use')?.getAttribute('href')).toBe('#pw-stop');
  });

  /** The flip is a real button, so Enter and Space work with no key handler of our own. */
  it('presses with the keyboard', () => {
    const { getByTestId } = renderReduced(<FlipTicket job={VILLAGE} />);
    const button = getByTestId('flip-button');
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('type')).toBe('button');
  });
});

/* ── the caller's own wiring ──────────────────────────────── */

describe('a card offers only what its caller can answer', () => {
  it('grows no File it away, no Keep going and no rewind where the verb is unwired', () => {
    const { queryByTestId, queryAllByTestId } = renderReduced(
      <FlipTicket job={makeJob({ outcome: 'capped', checkpoints: VILLAGE.checkpoints, plan: VILLAGE.plan! })} />,
    );
    expect(queryByTestId('ticket-file-away')).toBeNull();
    expect(queryByTestId('ticket-keep-going')).toBeNull();
    expect(queryAllByTestId('ticket-step-rewind').length).toBe(0);
  });

  it('draws no archive foot where neither Back nor Clear is wired', () => {
    const { queryByTestId } = renderReduced(<ArchiveCard job={VILLAGE} />);
    expect(queryByTestId('archive-foot')).toBeNull();
  });
});

/* ── the caller that never fabricates ─────────────────────── */

describe('the numbers are the job\'s own', () => {
  it('sums the figures across every op that reported one', () => {
    const many = makeJob({
      ops: [
        makeOp({ detail: { cells: 10 } }),
        makeOp({ detail: { cells: 5, objects: 2 } }),
        makeOp({ name: 'view_map', isRead: true }),
      ],
    });
    const { getAllByTestId } = renderReduced(<FlipTicket job={many} />);
    expect(getAllByTestId('ticket-stat-n').map((el) => el.textContent)).toEqual(['15', '2']);
  });

  it('never prints a step the job did not record', () => {
    const one = makeJob({ checkpoints: [{ undoIndex: 0, label: 'job' }], ops: [makeOp()] });
    const { getByTestId, getAllByTestId } = renderReduced(<FlipTicket job={one} />);
    fireEvent.click(getByTestId('flip-button'));
    expect(getAllByTestId('ticket-step').length).toBe(1);
    // The back stamp counts the job's OPS, which is a different fact from its checkpoints and is
    // read straight off the projection: one op, one step, nothing rounded up.
    expect(getByTestId('ticket-back-stamp').textContent).toBe('1 step');
  });

  /** AND IT COUNTS NOTHING WHERE THERE IS NOTHING TO COUNT. A banked checkpoint with no op behind it
   *  is the one shape that reaches the back face at zero, and "0 steps" there is a count of an
   *  absence — the same rule the ticket's own kept-edits fact already follows. */
  it('prints no step stamp at all for a back face with no ops', () => {
    const none = makeJob({ checkpoints: [{ undoIndex: 0, label: 'job' }], ops: [] });
    const { getByTestId, queryByTestId } = renderReduced(<FlipTicket job={none} />);
    fireEvent.click(getByTestId('flip-button'));
    expect(queryByTestId('ticket-back-stamp')).toBeNull();
  });
});

/**
 * THE TAKE-BACK SAYS WHAT IT COSTS.
 *
 * A rewind pops the map's undo stack down to a DEPTH, so it takes everything standing above that
 * depth — the user's own later edits included. These pin that the confirm NAMES that number, and
 * names the user's share of it separately wherever the record can prove there is one (the job banks
 * its settle depth on `jobEnd`, so anything above it was laid down afterwards).
 */
describe('the receipt: a rewind names what it would pop', () => {
  /** The job wrote 4 (depth 0 -> 15), and 12 hand edits stand on top. */
  const SETTLED = makeJob({ ...VILLAGE, endUndoIndex: 15 });

  it('names BOTH numbers on the whole-job confirm', () => {
    const { getByTestId } = renderReduced(
      <FlipTicket job={SETTLED} undoDepth={27} onRewind={() => {}} onRewindAll={() => {}} />,
    );
    fireEvent.click(getByTestId('flip-button'));
    fireEvent.click(getByTestId('ticket-rewind-all'));
    expect(getByTestId('ticket-rewind-all').textContent).toContain('Rewind 27 steps, 12 yours?');
  });

  it('names the total alone where nothing of the user\'s stands on top', () => {
    const { getByTestId } = renderReduced(
      <FlipTicket job={SETTLED} undoDepth={15} onRewind={() => {}} onRewindAll={() => {}} />,
    );
    fireEvent.click(getByTestId('flip-button'));
    fireEvent.click(getByTestId('ticket-rewind-all'));
    expect(getByTestId('ticket-rewind-all').textContent).toContain('Rewind 15 steps?');
  });

  it('names the total honestly where the record banked no settle depth', () => {
    const { getByTestId } = renderReduced(
      <FlipTicket job={VILLAGE} undoDepth={27} onRewind={() => {}} onRewindAll={() => {}} />,
    );
    fireEvent.click(getByTestId('flip-button'));
    fireEvent.click(getByTestId('ticket-rewind-all'));
    expect(getByTestId('ticket-rewind-all').textContent).toContain('Rewind 27 steps?');
  });

  it('keeps the unnumbered question where no depth was handed in at all', () => {
    const { getByTestId } = renderReduced(
      <FlipTicket job={SETTLED} onRewind={() => {}} onRewindAll={() => {}} />,
    );
    fireEvent.click(getByTestId('flip-button'));
    fireEvent.click(getByTestId('ticket-rewind-all'));
    expect(getByTestId('ticket-rewind-all').textContent).toContain('Rewind it all?');
  });
});

describe('the receipt: the per-step rewind asks, and shows what it would discard', () => {
  const SETTLED = makeJob({ ...VILLAGE, endUndoIndex: 15 });

  it('does not fire on the first press', () => {
    const rewound: number[] = [];
    const { getByTestId, getAllByTestId } = renderReduced(
      <FlipTicket job={SETTLED} undoDepth={15} onRewind={(c) => rewound.push(c.undoIndex)} />,
    );
    fireEvent.click(getByTestId('flip-button'));
    fireEvent.click(getAllByTestId('ticket-step-rewind')[1]!);
    expect(rewound).toEqual([]);
    // The GLYPH gains the cost in words, since a glyph alone cannot name what a take-back takes.
    expect(getAllByTestId('ticket-step-rewind')[1]!.textContent).toBe('Rewind 11 steps?');
    expect(getAllByTestId('ticket-step-rewind')[1]!.getAttribute('aria-label')).toBe('Rewind 11 steps?');
    fireEvent.click(getAllByTestId('ticket-step-rewind')[1]!);
    expect(rewound).toEqual([4]);
  });

  it('ghosts the rows the press would discard, and no earlier one', () => {
    const { getByTestId, getAllByTestId } = renderReduced(
      <FlipTicket job={SETTLED} undoDepth={15} onRewind={() => {}} />,
    );
    fireEvent.click(getByTestId('flip-button'));
    fireEvent.click(getAllByTestId('ticket-step-rewind')[1]!);
    expect(getAllByTestId('ticket-step').map((el) => el.getAttribute('data-preview')))
      .toEqual(['false', 'true', 'true']);
  });

  it('drops the ghost and fires nothing on Cancel', () => {
    const rewound: number[] = [];
    const { getByTestId, getAllByTestId } = renderReduced(
      <FlipTicket job={SETTLED} undoDepth={15} onRewind={(c) => rewound.push(c.undoIndex)} />,
    );
    fireEvent.click(getByTestId('flip-button'));
    fireEvent.click(getAllByTestId('ticket-step-rewind')[2]!);
    fireEvent.pointerDown(document.body);
    expect(rewound).toEqual([]);
    expect(getAllByTestId('ticket-step').every((el) => el.getAttribute('data-preview') === 'false')).toBe(true);
  });

  it('offers no rewind on a step the stack already stands at or below', () => {
    const { getByTestId, queryAllByTestId } = renderReduced(
      <FlipTicket job={SETTLED} undoDepth={4} onRewind={() => {}} />,
    );
    fireEvent.click(getByTestId('flip-button'));
    // Depth 4 is exactly the second checkpoint's watermark: only the job's own first one can pop.
    expect(queryAllByTestId('ticket-step-rewind').length).toBe(1);
  });
});

describe('the stop card: its rewind names the same cost', () => {
  it('names both numbers', () => {
    const job = makeJob({
      outcome: 'aborted',
      checkpoints: [{ undoIndex: 2, label: 'job' }],
      endUndoIndex: 6,
      ops: [makeOp({ detail: { objects: 9 } })],
    });
    const { getByTestId } = renderReduced(
      <StopCard job={job} undoDepth={11} onRewindAll={() => {}} />,
    );
    fireEvent.click(getByTestId('stop-rewind'));
    expect(getByTestId('stop-rewind').textContent).toContain('Rewind 9 steps, 5 yours?');
  });
});

/**
 * THE SIXTH DRESS. A record whose edits are off the map is not a `done` card at 55% opacity: every
 * claim on its front is now false, and dimming a false sentence does not make it true. The artifact
 * gives `rewound` its own stamp, its own foot verb and its own sentence, and suppresses the claims.
 */
describe('the rewound dress', () => {
  it('stops reading Built, and wears the take-back\'s own stamp', () => {
    const { getByTestId } = renderReduced(<FlipTicket job={VILLAGE} rolledBack />);
    const stamp = getByTestId('ticket-stamp');
    expect(stamp.textContent).toBe('Rewound');
    expect(stamp.getAttribute('data-rewound')).toBe('true');
  });

  it('drops the counts and the photograph it can no longer show', () => {
    const { queryByTestId } = renderReduced(
      <FlipTicket job={VILLAGE} rolledBack postcard={<span data-testid="shot" />} />,
    );
    expect(queryByTestId('ticket-stats')).toBeNull();
    expect(queryByTestId('ticket-postcard')).toBeNull();
  });

  it('replaces the model\'s closing words with what is true of the map now', () => {
    const { getByTestId } = renderReduced(<FlipTicket job={VILLAGE} rolledBack />);
    expect(getByTestId('ticket-summary').textContent)
      .toBe('The map is back where this job started. Nothing of it remains.');
  });

  it('offers to show what was TAKEN BACK rather than how it was built', () => {
    const { getByTestId } = renderReduced(<FlipTicket job={VILLAGE} rolledBack />);
    expect(getByTestId('flip-button').textContent).toBe('What was taken back');
    fireEvent.click(getByTestId('flip-button'));
    expect(getByTestId('ticket-back-head').textContent).toContain('What was taken back');
  });

  it('keeps the built dress on a record that is still on the map', () => {
    const { getByTestId } = renderReduced(
      <FlipTicket job={VILLAGE} postcard={<span data-testid="shot" />} />,
    );
    expect(getByTestId('ticket-stamp').textContent).toBe('Built');
    expect(getByTestId('ticket-stamp').getAttribute('data-rewound')).toBe('false');
    expect(getByTestId('ticket-postcard')).toBeTruthy();
    expect(getByTestId('ticket-summary').textContent).toContain('A fishing village stands');
  });

  /** The stop card's kept-edits fact is the whole reason that card exists. */
  it('takes the stop card\'s kept-edits fact away once the edits are off the map', () => {
    const stopped = makeJob({
      outcome: 'aborted',
      ops: [makeOp({ detail: { objects: 9 } })],
      checkpoints: [{ undoIndex: 0, label: 'job' }],
    });
    const kept = renderReduced(<StopCard job={stopped} onRewindAll={() => {}} />);
    expect(kept.getByTestId('stop-fact').textContent).toBe('9 edits are on your map.');
    kept.unmount();

    const gone = renderReduced(<StopCard job={stopped} rolledBack onRewindAll={() => {}} />);
    expect(gone.getByTestId('ticket-stamp').textContent).toBe('Rewound');
    expect(gone.getByTestId('stop-fact').textContent)
      .toBe('The map is back where this job started. Nothing of it remains.');
  });

  it('wears the same stamp on an opened past record', () => {
    const { getByTestId } = renderReduced(<ArchiveCard job={VILLAGE} rolledBack stamp="Today" />);
    expect(getByTestId('ticket-stamp').textContent).toBe('Rewound');
  });
});

/**
 * A HELD QUESTION SURVIVES THE JOB THAT WAS ASKING IT.
 *
 * The ask card belongs to the RUNNING job, so it goes when the job settles. A key revoked mid-ask
 * takes the loop down as an ordinary stop (which is correct), so without a record of its own a user
 * who re-keys comes back to a desk with no trace that anything was asked. The stop card holds it.
 */
describe('the stop card: a question that lapsed', () => {
  const stopped = makeJob({
    outcome: 'aborted',
    ops: [makeOp({ detail: { objects: 3 } })],
    checkpoints: [{ undoIndex: 0, label: 'job' }],
  });

  it('says the question was left unanswered', () => {
    const { getByTestId } = renderReduced(<StopCard job={stopped} unanswered onRewindAll={() => {}} />);
    expect(getByTestId('stop-lapsed').textContent)
      .toBe('A question was left unanswered when this stopped.');
  });

  it('says nothing of the sort where the job was asking nothing', () => {
    const { queryByTestId } = renderReduced(<StopCard job={stopped} onRewindAll={() => {}} />);
    expect(queryByTestId('stop-lapsed')).toBeNull();
  });
});

/** KEEP GOING FILES THE SAME ORDER AGAIN, and there is only one of it to file. */
describe('the capped receipt: Keep going is pressed once', () => {
  const capped = makeJob({ ...VILLAGE, outcome: 'capped' });

  it('stands down after the first press rather than filing a second order', () => {
    const sent: number[] = [];
    const { getByTestId } = renderReduced(
      <FlipTicket job={capped} onKeepGoing={() => sent.push(1)} onFileAway={() => {}} />,
    );
    const button = getByTestId('ticket-keep-going') as HTMLButtonElement;
    fireEvent.click(button);
    expect(sent).toEqual([1]);
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(sent).toEqual([1]);
  });
});
