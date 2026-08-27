/**
 * history.test.tsx — THE PAST-JOBS STRIP: its grouping, its rows, and the two things a row may and
 * may not offer.
 *
 * The terminal family's own cards are pinned in `fin-ticket.test.tsx`; this file holds the LIST —
 * the day headers the artifact's own builder produces, the rows' glyph/name/stat, the reveal that
 * may not move the row, and the ROLLBACK GUARD: a record built on a map that is not open reads but
 * cannot be rolled back, and the panel stands the notice over the list.
 *
 * The strip reads `useT()`, so every render goes through `I18nProvider` with a stubbed
 * `localStorage` (the same wrapper `job-ticket.test.tsx` uses, for the same reason: the store's
 * persistence writes on mount and jsdom ships no storage).
 *
 * DAY GROUPING IS TESTED AGAINST A FIXED CLOCK. `now` is an input to the strip precisely so a test
 * (and the fidelity rig) gets the same picture every run: a suite that read the wall clock would
 * pass all day and fail at midnight.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { I18nProvider } from '../../../i18n/context';
import { translations } from '../../../i18n/translations';
import { dayOf, HistoryStrip } from '../../../ui/agent/HistoryStrip';
import { PanelShell } from '../../../ui/agent/PanelShell';
import type { JobView, OpRow as OpRowData, PanelView } from '../../../agent/core/project-view';

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

beforeEach(() => {
  backing.clear();
});

let opSeq = 0;
function makeOp(over: Partial<OpRowData> = {}): OpRowData {
  opSeq += 1;
  return { callId: `op-${opSeq}`, name: 'place_object', status: 'ok', summary: '', isRead: false, ...over };
}

/** A fixed afternoon, so "today" and "yesterday" are the same two days on every run. */
const NOW = new Date(2026, 7, 22, 15, 0, 0).getTime();
const HOUR = 3_600_000;
const DAY = 86_400_000;

function makeJob(over: Partial<JobView> = {}): JobView {
  return {
    orderSeq: 1,
    orderText: 'Harbor town on the east bay',
    orderAt: NOW,
    ops: [],
    steerNotes: [],
    // A settled BUILD banks a watermark before its first write; a row with none has nothing to roll
    // back to and offers no take-back, so the default here is the shape the rows are about.
    checkpoints: [{ undoIndex: 0, label: 'job' }],
    stamps: [],
    outcome: 'done',
    celebrate: false,
    asks: [],
    skills: [],
    ...over,
  };
}

describe('HistoryStrip: the collapsed row', () => {
  it('renders nothing at all when no job has settled yet', () => {
    const { queryByTestId } = renderWithI18n(<HistoryStrip jobs={[]} />);
    expect(queryByTestId('history-strip')).toBeNull();
  });

  it('shows the settled-job count and lists nothing until it is opened', () => {
    const jobs = [makeJob({ orderSeq: 1 }), makeJob({ orderSeq: 2 }), makeJob({ orderSeq: 3 })];
    const { getByTestId, queryAllByTestId } = renderWithI18n(<HistoryStrip jobs={jobs} now={NOW} />);
    expect(getByTestId('history-count').textContent).toBe('3');
    expect(getByTestId('history-toggle').getAttribute('aria-expanded')).toBe('false');
    expect(queryAllByTestId('history-item').length).toBe(0);
  });
});

describe('HistoryStrip: the expanded list', () => {
  const jobs = [
    makeJob({ orderSeq: 1, orderText: 'Harbor town on the east bay', ops: [makeOp({ detail: { objects: 6 } })] }),
    makeJob({ orderSeq: 2, orderText: 'Roads between the houses', ops: [makeOp({ name: 'build_road', detail: { cells: 36 } })] }),
    makeJob({ orderSeq: 3, orderText: 'Forest around the lake', ops: [makeOp({ name: 'plant_forest', detail: { objects: 24 } })] }),
  ];

  it('lists one line per settled job, newest first', () => {
    const { getByTestId, getAllByTestId } = renderWithI18n(<HistoryStrip jobs={jobs} now={NOW} />);
    fireEvent.click(getByTestId('history-toggle'));
    expect(getByTestId('history-toggle').getAttribute('aria-expanded')).toBe('true');
    const items = getAllByTestId('history-item');
    expect(items.length).toBe(3);
    expect(items.map((el) => el.getAttribute('data-order-seq'))).toEqual(['3', '2', '1']);
    expect(items[0]!.querySelector('[data-testid="history-item-name"]')!.textContent)
      .toBe('Forest around the lake');
  });

  it('reads each job\'s own edit count off its ops', () => {
    const { getByTestId, getAllByTestId } = renderWithI18n(<HistoryStrip jobs={jobs} now={NOW} />);
    fireEvent.click(getByTestId('history-toggle'));
    const stats = getAllByTestId('history-item-stat').map((el) => el.textContent);
    expect(stats).toEqual(['24 edits', '36 edits', '6 edits']);
  });

  /** The reachable n=1 case: a job that touched exactly one cell names it as one edit. */
  it('names a single-cell job as one edit, not the plural', () => {
    const single = [makeJob({ orderSeq: 4, ops: [makeOp({ detail: { objects: 1 } })] })];
    const { getByTestId, getAllByTestId } = renderWithI18n(<HistoryStrip jobs={single} now={NOW} />);
    fireEvent.click(getByTestId('history-toggle'));
    expect(getAllByTestId('history-item-stat')[0]!.textContent).toBe('1 edit');
  });

  /**
   * `kind` IS A DONE-JOB READING (`project-view.ts:settle` sets it only for `outcome: 'done'`), so
   * an aborted, capped or errored run had none and fell straight through to the count — every one of
   * those rows read "0 edits" for a run that was cut off before it could make any. A row with
   * nothing to count says so; a row with edits keeps the count, which is the fact a rollback acts on.
   */
  describe('a row with nothing to count does not count zero', () => {
    it.each(['aborted', 'capped', 'incident'] as const)('says so for a %s run that wrote nothing', (outcome) => {
      const rows = [makeJob({ orderSeq: 5, outcome, ops: [makeOp({ detail: {} })] })];
      const { getByTestId, getAllByTestId } = renderWithI18n(<HistoryStrip jobs={rows} now={NOW} />);
      fireEvent.click(getByTestId('history-toggle'));
      expect(getAllByTestId('history-item-stat')[0]!.textContent)
        .toBe(translations.en['agent3.dock_no_edits']);
    });

    /** A stop that DID leave work on the map still names it: that count is what the take-back pops. */
    it('keeps the count where an aborted run left edits standing', () => {
      const rows = [makeJob({ orderSeq: 6, outcome: 'aborted', ops: [makeOp({ detail: { cells: 9 } })] })];
      const { getByTestId, getAllByTestId } = renderWithI18n(<HistoryStrip jobs={rows} now={NOW} />);
      fireEvent.click(getByTestId('history-toggle'));
      expect(getAllByTestId('history-item-stat')[0]!.textContent).toBe('9 edits');
    });

    /** And the same rule reaches the done build whose only write the user declined (the dock's own
     *  "All done. / 0 edits" defect, in the row it becomes). */
    it('says so for a finished build the user declined every write of', () => {
      const rows = [makeJob({ orderSeq: 7, kind: 'build', ops: [makeOp({ status: 'skipped', detail: {} })] })];
      const { getByTestId, getAllByTestId } = renderWithI18n(<HistoryStrip jobs={rows} now={NOW} />);
      fireEvent.click(getByTestId('history-toggle'));
      expect(getAllByTestId('history-item-stat')[0]!.textContent)
        .toBe(translations.en['agent3.dock_no_edits']);
    });
  });

  it('hands the picked job back to the caller for both actions', () => {
    const onOpen = vi.fn();
    const onRollBack = vi.fn();
    const { getByTestId, getAllByTestId } = renderWithI18n(
      <HistoryStrip jobs={jobs} now={NOW} onOpen={onOpen} onRollBack={onRollBack} />,
    );
    fireEvent.click(getByTestId('history-toggle'));
    fireEvent.click(getAllByTestId('history-open')[0]!);
    // Roll back is the one destructive press on a row, so it asks before it fires.
    fireEvent.click(getAllByTestId('history-roll-back')[0]!);
    fireEvent.click(getAllByTestId('history-roll-back')[0]!);
    expect(onOpen).toHaveBeenCalledWith(jobs[2]);
    expect(onRollBack).toHaveBeenCalledWith(jobs[2]);
  });

  it('opens the ticket from the row body, through a button stretched over the whole row', () => {
    const onOpen = vi.fn();
    const { getByTestId, getAllByTestId } = renderWithI18n(
      <HistoryStrip jobs={jobs} now={NOW} onOpen={onOpen} onRollBack={() => {}} />,
    );
    fireEvent.click(getByTestId('history-toggle'));
    const row = getAllByTestId('history-item')[0]!;
    const open = row.querySelector('[data-testid="history-open"]') as HTMLElement;
    // The row body IS the button: it covers the row, so a press anywhere but the roll-back square
    // lands on it. Its parent is the row itself, which must carry no transform of its own.
    expect(open.tagName).toBe('BUTTON');
    expect(open.parentElement).toBe(row);
    expect(open.style.position).toBe('absolute');
    expect(open.style.inset).toBe('0');
    expect(row.style.position).toBe('relative');
    expect(row.style.transform).toBe('');
    // The row's own content cannot take the press away from it.
    const name = row.querySelector('[data-testid="history-item-name"]') as HTMLElement;
    expect(name.style.pointerEvents).toBe('none');

    fireEvent.click(open);
    expect(onOpen).toHaveBeenCalledWith(jobs[2]);
  });

  it('swaps the count for the roll-back square on hover, and keeps both in the row either way', () => {
    const { getByTestId, getAllByTestId } = renderWithI18n(
      <HistoryStrip jobs={jobs} now={NOW} onOpen={() => {}} onRollBack={() => {}} />,
    );
    fireEvent.click(getByTestId('history-toggle'));
    const row = getAllByTestId('history-item')[0]!;
    const stat = row.querySelector('[data-testid="history-item-stat"]') as HTMLElement;
    const acts = row.querySelector('[data-testid="history-item-acts"]') as HTMLElement;
    // At rest the count reads and the actions are there but unreachable by pointer, so the row
    // cannot change width when they arrive.
    expect(Number(stat.style.opacity || '1')).toBe(1);
    expect(acts.style.pointerEvents).toBe('none');

    fireEvent.pointerEnter(row);
    expect(Number(stat.style.opacity)).toBe(0);
    expect(acts.style.pointerEvents).toBe('auto');

    fireEvent.pointerLeave(row);
    expect(Number(stat.style.opacity || '1')).toBe(1);
  });

  it('reveals the roll-back square for a keyboard tab into it, with no pointer involved', () => {
    const { getByTestId, getAllByTestId } = renderWithI18n(
      <HistoryStrip jobs={jobs} now={NOW} onOpen={() => {}} onRollBack={() => {}} />,
    );
    fireEvent.click(getByTestId('history-toggle'));
    const row = getAllByTestId('history-item')[0]!;
    const rollBack = row.querySelector('[data-testid="history-roll-back"]') as HTMLElement;
    fireEvent.focus(rollBack);
    // The button now stands inside its own confirm seat, so the reveal is read off the acts cell.
    expect((row.querySelector('[data-testid="history-item-acts"]') as HTMLElement).style.pointerEvents)
      .toBe('auto');
  });

  /**
   * A QUESTION OPENS WITHOUT MOVING THE ROW. The pair is wider than the square it replaces, so the
   * only thing that may change is the seat's own contents: every other landmark in the row is the
   * same node, under the same parent, at the same index. jsdom lays nothing out, so that structural
   * reading is what stands in for the rects.
   */
  it('holds every landmark in the row still when the roll-back asks', () => {
    const { getByTestId, getAllByTestId } = renderWithI18n(
      <HistoryStrip jobs={jobs} now={NOW} onOpen={() => {}} onRollBack={() => {}} />,
    );
    fireEvent.click(getByTestId('history-toggle'));
    const row = getAllByTestId('history-item')[0]!;
    const landmarks = () => [...row.querySelectorAll<HTMLElement>('[data-testid]')]
      .filter((el) => el.closest('[data-testid="inline-confirm-seat"]') === null)
      .map((el) => ({
        id: el.dataset.testid ?? '',
        parent: el.parentElement,
        index: [...(el.parentElement?.children ?? [])].indexOf(el),
      }));

    const before = landmarks();
    fireEvent.click(row.querySelector('[data-testid="history-roll-back"]')!);

    expect(landmarks()).toEqual(before);
    // The open-the-ticket square is drawing, so it is hushed where it stands rather than dropped.
    const mark = row.querySelector('[data-testid="history-open-mark"]') as HTMLElement;
    expect(mark.style.pointerEvents).toBe('none');
  });

  it('dims a rolled-back job, stamps it as such and offers it no roll-back', () => {
    const { getByTestId, getAllByTestId, queryAllByTestId } = renderWithI18n(
      <HistoryStrip jobs={jobs} now={NOW} rolledBack={new Set([3])} onRollBack={() => {}} onOpen={() => {}} />,
    );
    fireEvent.click(getByTestId('history-toggle'));
    const items = getAllByTestId('history-item');
    expect(items[0]!.getAttribute('data-rolled-back')).toBe('true');
    expect(Number(items[0]!.style.opacity)).toBeLessThan(1);
    expect(items[0]!.querySelector('[data-testid="history-item-stat"]')!.textContent).toBe('rolled back');
    expect(items[1]!.getAttribute('data-rolled-back')).toBe('false');
    expect(Number(items[1]!.style.opacity || '1')).toBe(1);
    // The roll-back affordance is gone for that one row, and stands on the other two.
    expect(queryAllByTestId('history-roll-back').length).toBe(2);
    expect(items[0]!.querySelector('[data-testid="history-roll-back"]')).toBeNull();
    expect(items[0]!.querySelector('[data-testid="history-open"]')).not.toBeNull();
  });
});

describe('HistoryStrip: the day headers', () => {
  /** `dayOf` is the whole grouping rule, and it is pure, so it is pinned before the render is. */
  it('reads a record\'s day off its own stamp, against local midnight', () => {
    expect(dayOf(NOW, NOW)).toBe('today');
    expect(dayOf(NOW - HOUR, NOW)).toBe('today');
    // 03:00 this morning is still today, however many hours ago it was.
    expect(dayOf(new Date(2026, 7, 22, 3, 0, 0).getTime(), NOW)).toBe('today');
    // 23:50 last night is yesterday, ten minutes over the boundary.
    expect(dayOf(new Date(2026, 7, 21, 23, 50, 0).getTime(), NOW)).toBe('yesterday');
    expect(dayOf(NOW - 2 * DAY, NOW)).toBe('earlier');
  });

  const spread = [
    makeJob({ orderSeq: 1, orderText: 'Long ago', orderAt: NOW - 5 * DAY }),
    makeJob({ orderSeq: 2, orderText: 'Last night', orderAt: new Date(2026, 7, 21, 20, 0, 0).getTime() }),
    makeJob({ orderSeq: 3, orderText: 'This morning', orderAt: new Date(2026, 7, 22, 9, 0, 0).getTime() }),
  ];

  it('groups the rows under Today, Yesterday and Earlier, in that order', () => {
    const { getByTestId, getAllByTestId } = renderWithI18n(<HistoryStrip jobs={spread} now={NOW} />);
    fireEvent.click(getByTestId('history-toggle'));
    expect(getAllByTestId('history-day-head').map((el) => el.textContent))
      .toEqual(['Today', 'Yesterday', 'Earlier']);
    expect(getAllByTestId('history-group').map((el) => el.getAttribute('data-group')))
      .toEqual(['today', 'yesterday', 'earlier']);
    expect(getAllByTestId('history-item').map((el) => el.getAttribute('data-order-seq')))
      .toEqual(['3', '2', '1']);
  });

  /** A header over no rows says a day has jobs in it that the list is not showing. */
  it('grows no header for a day with nothing in it', () => {
    const todayOnly = [makeJob({ orderSeq: 1, orderAt: NOW })];
    const { getByTestId, getAllByTestId } = renderWithI18n(<HistoryStrip jobs={todayOnly} now={NOW} />);
    fireEvent.click(getByTestId('history-toggle'));
    expect(getAllByTestId('history-day-head').map((el) => el.textContent)).toEqual(['Today']);
  });
});

describe('HistoryStrip: the rollback guard', () => {
  const jobs = [
    makeJob({ orderSeq: 1, orderText: 'Orchard on the slope', ops: [makeOp({ detail: { objects: 42 } })] }),
    makeJob({ orderSeq: 2, orderText: 'Quay by the bay', ops: [makeOp({ detail: { cells: 86 } })] }),
  ];

  it('stands the other map\'s records in their own group, last', () => {
    const { getByTestId, getAllByTestId } = renderWithI18n(
      <HistoryStrip jobs={jobs} now={NOW} otherMap={new Set([1])} onOpen={() => {}} onRollBack={() => {}} />,
    );
    fireEvent.click(getByTestId('history-toggle'));
    expect(getAllByTestId('history-day-head').map((el) => el.textContent))
      .toEqual(['Today', 'Built on another map']);
    const groups = getAllByTestId('history-group').map((el) => el.getAttribute('data-group'));
    expect(groups).toEqual(['today', 'other-map']);
  });

  /**
   * A ROLLBACK MAY NOT AIM AT A MAP THAT IS NOT STANDING. The refusal is the absent control (a
   * control that refuses must not answer the pointer), and the row still opens: reading a record
   * built elsewhere costs the open map nothing.
   */
  it('offers that record no roll-back at all, and still opens it', () => {
    const onOpen = vi.fn();
    const { getByTestId, getAllByTestId } = renderWithI18n(
      <HistoryStrip jobs={jobs} now={NOW} otherMap={new Set([1])} onOpen={onOpen} onRollBack={() => {}} />,
    );
    fireEvent.click(getByTestId('history-toggle'));
    const other = getAllByTestId('history-item').find((el) => el.getAttribute('data-order-seq') === '1')!;
    expect(other.getAttribute('data-other-map')).toBe('true');
    expect(Number(other.style.opacity)).toBeLessThan(1);
    expect(other.querySelector('[data-testid="history-roll-back"]')).toBeNull();

    fireEvent.click(other.querySelector('[data-testid="history-open"]') as HTMLElement);
    expect(onOpen).toHaveBeenCalledWith(jobs[0]);

    // The record on the open map keeps its own take-back.
    const here = getAllByTestId('history-item').find((el) => el.getAttribute('data-order-seq') === '2')!;
    expect(here.querySelector('[data-testid="history-roll-back"]')).not.toBeNull();
  });
});

describe('HistoryStrip: a record that names no map at all', () => {
  const jobs = [
    makeJob({ orderSeq: 1, orderText: 'Orchard on the slope', ops: [makeOp({ detail: { objects: 42 } })] }),
    makeJob({ orderSeq: 2, orderText: 'Quay by the bay', ops: [makeOp({ detail: { cells: 86 } })] }),
  ];

  /**
   * UNVERIFIABLE IS NOT ELSEWHERE. A log written before an order carried a map id says nothing about
   * which map its edits are on, so the take-back is refused for the same reason and said in its own
   * words: a record that may well be this map's must not be told it is another's.
   */
  it('stands it in its own group under its own header, refusing the roll back and still opening', () => {
    const onOpen = vi.fn();
    const { getByTestId, getAllByTestId } = renderWithI18n(
      <HistoryStrip jobs={jobs} now={NOW} unknownMap={new Set([1])} onOpen={onOpen} onRollBack={() => {}} />,
    );
    fireEvent.click(getByTestId('history-toggle'));
    expect(getAllByTestId('history-day-head').map((el) => el.textContent))
      .toEqual(['Today', 'Map not recorded']);
    expect(getAllByTestId('history-group').map((el) => el.getAttribute('data-group')))
      .toEqual(['today', 'unknown-map']);

    const row = getAllByTestId('history-item').find((el) => el.getAttribute('data-order-seq') === '1')!;
    expect(row.getAttribute('data-unknown-map')).toBe('true');
    expect(row.getAttribute('data-other-map')).toBe('false');
    expect(Number(row.style.opacity)).toBeLessThan(1);
    expect(row.querySelector('[data-testid="history-roll-back"]')).toBeNull();

    fireEvent.click(row.querySelector('[data-testid="history-open"]') as HTMLElement);
    expect(onOpen).toHaveBeenCalledWith(jobs[0]);
  });

  /** A record in both sets names a map, and what it names is the sharper fact. */
  it('reports a record that is in both sets as the other map\'s', () => {
    const { getByTestId, getAllByTestId } = renderWithI18n(
      <HistoryStrip
        jobs={jobs}
        now={NOW}
        otherMap={new Set([1])}
        unknownMap={new Set([1])}
        onOpen={() => {}}
        onRollBack={() => {}}
      />,
    );
    fireEvent.click(getByTestId('history-toggle'));
    expect(getAllByTestId('history-group').map((el) => el.getAttribute('data-group')))
      .toEqual(['today', 'other-map']);
  });
});

/* ── the notice the panel stands over the list ────────────── */

function baseView(over: Partial<PanelView> = {}): PanelView {
  return {
    phase: 'idle',
    jobs: [],
    queuedSteers: [],
    vitals: { cells: 0, objects: 0, reverts: 0, jobs: 0 },
    suggestion: null,
    lastEventAt: NOW,
    ...over,
  };
}

const VERBS = { onSend: () => {}, onStop: () => {}, onPause: () => {}, onGateAnswer: () => {} };

function renderShell(props: Record<string, unknown>) {
  return render(
    <MotionConfig reducedMotion="always">
      <I18nProvider>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <PanelShell connected now={NOW} {...VERBS} {...(props as any)} />
      </I18nProvider>
    </MotionConfig>,
  );
}

describe('PanelShell: the other-map notice', () => {
  const filedJobs = [
    makeJob({ orderSeq: 1, orderText: 'Orchard on the slope' }),
    makeJob({ orderSeq: 2, orderText: 'Quay by the bay' }),
  ];

  it('stands the notice over the list while the record holds a job from another map', () => {
    const view = baseView({ jobs: filedJobs });
    const { getByTestId } = renderShell({ view, filed: new Set([1, 2]), otherMap: new Set([1]) });
    const banner = getByTestId('banner');
    expect(banner.getAttribute('data-cls')).toBe('other-map');
    expect(banner.textContent).toContain('Rolling one back needs that map open.');
    expect(getByTestId('history-strip')).toBeTruthy();
  });

  /** The SHARPER fact where both are present: a record proven to be another map's is a stronger
   *  thing to report than one that merely says nothing. */
  it('stands the unverifiable notice in its own words, and yields to the other-map one', () => {
    const view = baseView({ jobs: filedJobs });
    const alone = renderShell({ view, filed: new Set([1, 2]), unknownMap: new Set([1]) });
    const banner = alone.getByTestId('banner');
    expect(banner.getAttribute('data-cls')).toBe('unknown-map');
    expect(banner.textContent).toContain('do not record which map they were built on');
    alone.unmount();

    const both = renderShell({
      view, filed: new Set([1, 2]), otherMap: new Set([1]), unknownMap: new Set([2]),
    });
    expect(both.getByTestId('banner').getAttribute('data-cls')).toBe('other-map');
  });

  it('says nothing where every record belongs to the open map', () => {
    const view = baseView({ jobs: filedJobs });
    const { queryByTestId } = renderShell({ view, filed: new Set([1, 2]) });
    expect(queryByTestId('banner')).toBeNull();
  });
});

describe('PanelShell: a cleared record leaves the list', () => {
  /** Clearing FILES the record too, so it already has no card; this is what makes the removal a
   *  removal rather than a card quietly becoming a row. */
  it('drops it from the strip and from the count', () => {
    const jobs = [makeJob({ orderSeq: 1 }), makeJob({ orderSeq: 2 }), makeJob({ orderSeq: 3 })];
    const view = baseView({ jobs });
    const { getByTestId, getAllByTestId } = renderShell({
      view, filed: new Set([1, 2, 3]), cleared: new Set([2]),
    });
    expect(getByTestId('history-count').textContent).toBe('2');
    fireEvent.click(getByTestId('history-toggle'));
    expect(getAllByTestId('history-item').map((el) => el.getAttribute('data-order-seq')))
      .toEqual(['3', '1']);
  });
});

/**
 * THE ROW'S ROLL BACK IS DESTRUCTIVE, so it asks first and NAMES THE SIZE (artifact: "destructive:
 * first press asks, naming the size; the row it would kill dims"). Fired on the first click it
 * would be the one destructive press in the whole panel that does.
 */
describe('HistoryStrip: the roll back asks before it fires', () => {
  function jobAt(over: Partial<JobView> = {}): JobView {
    return makeJob({
      orderSeq: 7,
      checkpoints: [{ undoIndex: 3, label: 'job' }],
      endUndoIndex: 7,
      ops: [makeOp({ detail: { cells: 24 } })],
      ...over,
    });
  }

  it('fires nothing on the first press, and names both numbers', () => {
    const onRollBack = vi.fn();
    const { getByTestId, getAllByTestId } = renderWithI18n(
      <HistoryStrip jobs={[jobAt()]} now={NOW} undoDepth={19} onRollBack={onRollBack} />,
    );
    fireEvent.click(getByTestId('history-toggle'));
    fireEvent.click(getAllByTestId('history-roll-back')[0]!);
    expect(onRollBack).not.toHaveBeenCalled();
    // The SQUARE is the question now, and its words are the cost.
    const square = getAllByTestId('history-roll-back')[0]!;
    expect(square.textContent).toBe('Rewind 16 steps, 12 yours?');
    expect(square.getAttribute('aria-label')).toBe('Rewind 16 steps, 12 yours?');
    fireEvent.click(square);
    expect(onRollBack).toHaveBeenCalledTimes(1);
  });

  it('marks the row it would take, and drops the count while the question stands', () => {
    const { getByTestId, getAllByTestId } = renderWithI18n(
      <HistoryStrip jobs={[jobAt()]} now={NOW} undoDepth={19} onRollBack={() => {}} />,
    );
    fireEvent.click(getByTestId('history-toggle'));
    fireEvent.click(getAllByTestId('history-roll-back')[0]!);
    expect(getAllByTestId('history-item')[0]!.getAttribute('data-preview')).toBe('true');
    expect(getAllByTestId('history-item-stat')[0]!.style.opacity).toBe('0');
  });

  it('cancels without firing, and puts the row back', () => {
    const onRollBack = vi.fn();
    const { getByTestId, getAllByTestId } = renderWithI18n(
      <HistoryStrip jobs={[jobAt()]} now={NOW} undoDepth={19} onRollBack={onRollBack} />,
    );
    fireEvent.click(getByTestId('history-toggle'));
    fireEvent.click(getAllByTestId('history-roll-back')[0]!);
    fireEvent.pointerDown(document.body);
    expect(onRollBack).not.toHaveBeenCalled();
    expect(getAllByTestId('history-item')[0]!.getAttribute('data-preview')).toBe('false');
    expect(getAllByTestId('history-roll-back')[0]!.textContent).toBe('');
  });

  /** A standing question is a destructive press still aimed. It may not survive the row leaving. */
  it('drops a standing question when the record it aims at leaves the list', () => {
    const { getByTestId, getAllByTestId, queryByTestId, rerender } = renderWithI18n(
      <HistoryStrip jobs={[jobAt()]} now={NOW} undoDepth={19} open onRollBack={() => {}} />,
    );
    fireEvent.click(getAllByTestId('history-roll-back')[0]!);
    expect(queryByTestId('inline-confirm-seat')!.getAttribute('data-confirm-armed')).toBe('true');
    rerender(
      <I18nProvider>
        <HistoryStrip jobs={[jobAt({ orderSeq: 9 })]} now={NOW} undoDepth={19} open onRollBack={() => {}} />
      </I18nProvider>,
    );
    expect(queryByTestId('inline-confirm-seat')!.getAttribute('data-confirm-armed')).toBeNull();
    expect(getByTestId('history-strip')).toBeTruthy();
  });

  /** A press that would pop nothing is not a take-back. */
  it('offers no roll back once the stack already stands at the job\'s watermark', () => {
    const { getByTestId, queryAllByTestId } = renderWithI18n(
      <HistoryStrip jobs={[jobAt()]} now={NOW} undoDepth={3} onRollBack={() => {}} />,
    );
    fireEvent.click(getByTestId('history-toggle'));
    expect(queryAllByTestId('history-roll-back').length).toBe(0);
  });
});

/**
 * THE STANDING RECEIPT READS THE SAME GUARD THE ROWS DO.
 *
 * The session is not cleared by a map change, so a job run on map A leaves its receipt standing over
 * map B with a live take-back aimed at B's undo stack. Were the guard read one surface down only,
 * the rows would refuse it while the card the user is actually looking at offered it with no mark,
 * no dim and no notice.
 */
describe('PanelShell: the settled card and the rollback guard', () => {
  const built = makeJob({
    orderSeq: 4,
    orderText: 'Terrace the north slope',
    outcome: 'done',
    kind: 'build',
    ops: [makeOp({ detail: { cells: 118 } })],
    checkpoints: [{ undoIndex: 0, label: 'job' }, { undoIndex: 5, label: 'write' }],
    endUndoIndex: 9,
  });

  it('withholds both take-backs on a receipt proven to be another map\'s', () => {
    const view = baseView({ jobs: [built] });
    const { getByTestId, queryAllByTestId } = renderShell({
      view, undoDepth: 9, otherMap: new Set([4]), onRewind: () => {}, onRewindAll: () => {},
    });
    fireEvent.click(getByTestId('flip-button'));
    expect(queryAllByTestId('ticket-rewind-all').length).toBe(0);
    expect(queryAllByTestId('ticket-step-rewind').length).toBe(0);
  });

  it('stands the notice for that card even when it is the session\'s ONLY record', () => {
    const view = baseView({ jobs: [built] });
    const { getByTestId, queryByTestId } = renderShell({
      view, undoDepth: 9, otherMap: new Set([4]), onRewindAll: () => {},
    });
    expect(getByTestId('banner').getAttribute('data-cls')).toBe('other-map');
    // The card is the whole record here, so there is no list for the notice to stand over.
    expect(queryByTestId('history-strip')).toBeNull();
  });

  it('says the unverifiable refusal in its own words, and withholds the same controls', () => {
    const view = baseView({ jobs: [built] });
    const { getByTestId, queryAllByTestId } = renderShell({
      view, undoDepth: 9, unknownMap: new Set([4]), onRewindAll: () => {},
    });
    expect(getByTestId('banner').getAttribute('data-cls')).toBe('unknown-map');
    expect(queryAllByTestId('ticket-rewind-all').length).toBe(0);
  });

  it('leaves the take-back standing for a record on the open map', () => {
    const view = baseView({ jobs: [built] });
    const { getByTestId } = renderShell({
      view, undoDepth: 9, onRewind: () => {}, onRewindAll: () => {},
    });
    fireEvent.click(getByTestId('flip-button'));
    expect(getByTestId('ticket-rewind-all')).toBeTruthy();
  });

  it('withholds the stop card\'s rewind on another map\'s record', () => {
    const stopped = makeJob({ ...built, outcome: 'aborted', orderSeq: 5 });
    const view = baseView({ phase: 'aborted', jobs: [stopped] });
    const { queryByTestId, getByTestId } = renderShell({
      view, undoDepth: 9, otherMap: new Set([5]), onRewindAll: () => {},
    });
    expect(getByTestId('stop-card')).toBeTruthy();
    expect(queryByTestId('stop-rewind')).toBeNull();
  });
});

/**
 * A ROLLBACK VERB IS DISABLED WHILE A JOB RUNS, and says so. A past job's watermark is BELOW the
 * running job's writes, so the pop takes the live job's edits too and the loop keeps writing onto a
 * stack whose depths no longer mean what its checkpoints say. Disabled rather than absent: the
 * refusal lifts the moment the job does, and a control that vanishes moves the row.
 */
describe('PanelShell: the take-backs while a job is in flight', () => {
  const past = makeJob({ orderSeq: 1, orderText: 'Orchard on the slope' });
  const live = makeJob({ orderSeq: 2, orderText: 'Quay by the bay', outcome: undefined });

  function running(props: Record<string, unknown> = {}) {
    const view = baseView({ phase: 'executing', jobs: [past], current: live });
    return renderShell({ view, onOpenTicket: () => {}, onRollBack: () => {}, ...props });
  }

  it('stands the row\'s roll back disabled, with the reason readable', () => {
    const { getByTestId, getAllByTestId } = running();
    fireEvent.click(getByTestId('history-toggle'));
    const button = getAllByTestId('history-roll-back')[0] as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toBe('Not while a job is running.');
    expect(button.getAttribute('aria-label')).toContain('Not while a job is running.');
  });

  it('refuses the row\'s own press rather than deferring it', () => {
    const onOpenTicket = vi.fn();
    const { getByTestId, getAllByTestId } = running({ onOpenTicket });
    fireEvent.click(getByTestId('history-toggle'));
    const open = getAllByTestId('history-open')[0] as HTMLButtonElement;
    expect(open.disabled).toBe(true);
    expect(open.title).toBe('Not while a job is running.');
    fireEvent.click(open);
    expect(onOpenTicket).not.toHaveBeenCalled();
  });

  it('fires no roll back from a press on the disabled square', () => {
    const onRollBack = vi.fn();
    const { getByTestId, getAllByTestId, queryByTestId } = running({ onRollBack });
    fireEvent.click(getByTestId('history-toggle'));
    fireEvent.click(getAllByTestId('history-roll-back')[0]!);
    expect(queryByTestId('inline-confirm-yes')).toBeNull();
    expect(onRollBack).not.toHaveBeenCalled();
  });

  it('stands the live rail\'s per-stage rewind disabled while the job writes, and lit once it holds', () => {
    const planned = makeJob({
      orderSeq: 2,
      orderText: 'Quay by the bay',
      outcome: undefined,
      plan: { stages: [{ label: 'Dig the basin' }, { label: 'Lay the quay' }], currentIndex: 1, doneCount: 1, revision: 1 },
      checkpoints: [{ undoIndex: 2, label: 'stage', stageIndex: 0 }],
    });
    const busy = renderShell({
      view: baseView({ phase: 'executing', jobs: [], current: planned }), onRewind: () => {},
    });
    const held = busy.getByTestId('plan-rewind') as HTMLButtonElement;
    expect(held.disabled).toBe(true);
    expect(held.title).toBe('Not while a job is running.');
    busy.unmount();

    const paused = renderShell({
      view: baseView({ phase: 'paused', jobs: [], current: planned }), onRewind: () => {},
    });
    expect((paused.getByTestId('plan-rewind') as HTMLButtonElement).disabled).toBe(false);
  });
});
