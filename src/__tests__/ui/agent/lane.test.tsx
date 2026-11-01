// @vitest-environment jsdom
/**
 * The helper lane: what a `delegate_task` child is doing, shown inside the parent's ticket, and the
 * roll-up its row keeps once the child is gone. Lanes render from `LaneView` fixtures (live, the
 * shape comes off `store.childLive`), with the jsdom `localStorage` stub the store's persistence needs.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { I18nProvider } from '../../../i18n/context';
import { Lane, laneRollup, type LaneView } from '../../../ui/agent/record/Lane';
import { OpsList } from '../../../ui/agent/record/OpRow';
import { translateFor } from '../../../i18n/context';
import type { OpRow as OpRowData } from '../../../agent/core/project-view';
import type { TextKey } from '../../../i18n/keys';

/** One operation row as every list draws it: a single-row `OpsList`. */
function OpRow({ op, lane }: { op: OpRowData; lane?: LaneView }) {
  return <OpsList ops={[op]} {...(lane ? { lane } : {})} />;
}

const backing = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
};

function renderWithI18n(node: React.ReactElement) {
  return render(node, { wrapper: ({ children }) => <I18nProvider>{children}</I18nProvider> });
}

function makeLane(over: Partial<LaneView> = {}): LaneView {
  return { task: 'planting the grove', ops: 4, opName: 'plant_forest', ...over };
}

const t = (key: TextKey, params?: Record<string, string | number>) => translateFor('en', key, params);

describe('Lane: the head', () => {
  it('names the helper by its task, counts its steps and turns a spinner while it works', () => {
    const { getByTestId } = renderWithI18n(<Lane lane={makeLane()} />);
    expect(getByTestId('lane-name').textContent).toBe('Helper: planting the grove');
    expect(getByTestId('lane-count').textContent).toBe('4 steps');
    expect(getByTestId('lane-spin')).toBeTruthy();
  });

  /**
   * The child is reported before it runs, so a lane carries `ops: 0` through its whole first think.
   * Like every panel count, zero shows nothing; the seat stays, so nothing moves when the first step lands.
   */
  it('counts nothing while the helper has taken no step yet', () => {
    const { getByTestId } = renderWithI18n(<Lane lane={makeLane({ ops: 0 })} />);
    expect(getByTestId('lane-count').textContent).toBe('');
    expect(getByTestId('lane-spin'), 'the spinner is what says it is working').toBeTruthy();
  });

  it('says one step, not one steps, when the helper has taken exactly one', () => {
    const { getByTestId } = renderWithI18n(<Lane lane={makeLane({ ops: 1 })} />);
    expect(getByTestId('lane-count').textContent).toBe('1 step');
  });

  /** A helper inherits the painted region and every rule the parent obeys, and the shield says so
   *  where the delegation is. */
  it('wears the shield that says it works under the same restrictions', () => {
    const { getByTestId } = renderWithI18n(<Lane lane={makeLane()} />);
    const shield = getByTestId('lane-head').querySelector('[title]') as HTMLElement;
    expect(shield.getAttribute('title')).toBe('It works inside your region and under the same rules');
    expect(shield.querySelector('use')?.getAttribute('href')).toBe('#pw-shield');
  });

  it('stops turning once the helper has finished', () => {
    const { queryByTestId } = renderWithI18n(<Lane lane={makeLane({ done: true })} />);
    expect(queryByTestId('lane-spin')).toBeNull();
  });

  /** `task` holds complete, self-contained instructions, too long for a two-line clamped name, so a
   *  `label` wins outright. */
  it('names the helper by its label when the model gave one, over the whole task paragraph', () => {
    const lane = makeLane({
      label: 'north grove',
      task: 'Complete, self-contained instructions: plant an oak grove north of the lake at (10,10)-(40,40), rustic style, add a bench facing the water.',
    });
    const { getByTestId } = renderWithI18n(<Lane lane={lane} />);
    expect(getByTestId('lane-name').textContent).toBe('Helper: north grove');
  });

  /** Only the first line, so a multi-line task does not spill into the name. */
  it('falls back to the first line of the task when the model gave no label', () => {
    const lane = makeLane({ label: undefined, task: 'line one of the order\nline two, never shown here' });
    const { getByTestId } = renderWithI18n(<Lane lane={lane} />);
    expect(getByTestId('lane-name').textContent).toBe('Helper: line one of the order');
  });

  /** The same grammar the dock uses for the parent's wait: cause in the head, attempt as the count,
   *  clock as the mark. */
  it('says a retry in the head, counts the attempt and shows the clock', () => {
    const lane = makeLane({ retry: { attempt: 2, of: 5, seconds: 9 } });
    const { getByTestId } = renderWithI18n(<Lane lane={lane} />);
    expect(getByTestId('lane-name').textContent).toBe('Helper: provider busy, retrying in 9s');
    expect(getByTestId('lane-count').textContent).toBe('try 2 of 5');
    expect(getByTestId('lane-cause').querySelector('use')?.getAttribute('href')).toBe('#pw-retry-clock');
  });
});

describe('Lane: the line', () => {
  it('draws the tool in flight with its own glyph and phrase', () => {
    const { getByTestId } = renderWithI18n(<Lane lane={makeLane()} />);
    const line = getByTestId('lane-line');
    expect(line.querySelector('use')?.getAttribute('href')).toBe('#pw-forest');
    expect(line.textContent).toContain('Planting a forest');
  });

  it('falls back to the task before the helper has run anything', () => {
    const { getByTestId } = renderWithI18n(<Lane lane={makeLane({ ops: 0, opName: undefined })} />);
    expect(getByTestId('lane-line').textContent).toContain('planting the grove');
  });

  it('reads the whole line in the danger ink when the helper is in trouble, and chips the cause', () => {
    const { getByTestId } = renderWithI18n(<Lane lane={makeLane({ error: 'ground not flat' })} />);
    expect(getByTestId('lane').getAttribute('data-erring')).toBe('true');
    expect(getByTestId('op-chip').textContent).toBe('This step could not be completed.');
  });
});

describe('the delegate row and its lane', () => {
  function delegateOp(over: Partial<OpRowData> = {}): OpRowData {
    return { callId: 'c1', name: 'delegate_task', status: 'run', summary: '', isRead: false, ...over };
  }

  it('stands the live lane under the delegate row, and nowhere else', () => {
    const withLane = renderWithI18n(<OpRow op={delegateOp()} lane={makeLane()} />);
    expect(withLane.getByTestId('lane')).toBeTruthy();
    withLane.unmount();

    // The same lane handed to an ordinary row is not that row's business.
    const other = renderWithI18n(<OpRow op={delegateOp({ name: 'place_object' })} lane={makeLane()} />);
    expect(other.queryByTestId('lane')).toBeNull();
  });

  /** The cause shows twice, since a folded op list can hide the lane. */
  it('mirrors the helper\'s trouble onto the delegate row\'s own chip', () => {
    const { getAllByTestId } = renderWithI18n(
      <OpRow op={delegateOp()} lane={makeLane({ error: 'ground not flat' })} />,
    );
    const chips = getAllByTestId('op-chip');
    // One on the row, one on the lane's line, both naming the same cause.
    expect(chips.map((c) => c.textContent)).toEqual(['This step could not be completed.', 'This step could not be completed.']);
    expect(chips[0]!.getAttribute('data-tone')).toBe('bad');
  });

  /** A settled call's child log is gone; the lane rolls up onto the row it belonged to. */
  it('draws no lane for a settled call, and rolls its record onto the row', () => {
    const op = delegateOp({
      status: 'ok',
      detail: { childOps: [{ name: 'plant_forest', status: 'ok' }, { name: 'place_object', status: 'ok' }] },
    });
    const { queryByTestId, getByTestId } = renderWithI18n(<OpRow op={op} />);
    expect(queryByTestId('lane')).toBeNull();
    expect(getByTestId('op-chip').textContent).toBe('2 steps');
  });

  /** `OpsList` hands the one live lane to every row; a job that delegated twice has a settled delegate
   *  row beside the running one, which keeps its own rollup instead. */
  it('draws the live lane on the row that is still running, and rolls up the settled one beside it', () => {
    const ops: OpRowData[] = [
      delegateOp({
        callId: 'c1', status: 'ok',
        detail: { childOps: [{ name: 'plant_forest', status: 'ok' }] },
      }),
      delegateOp({ callId: 'c2', status: 'run' }),
    ];
    const { getAllByTestId, queryAllByTestId } = renderWithI18n(
      <OpsList ops={ops} lane={makeLane()} />,
    );
    // One lane only, and it stands under the running row (c2), not the settled one (c1).
    expect(queryAllByTestId('lane')).toHaveLength(1);
    const rows = getAllByTestId('op-row');
    expect(rows[0]!.getAttribute('data-status')).toBe('ok');
    expect(rows[0]!.nextElementSibling?.getAttribute('data-testid')).not.toBe('lane');
    expect(rows[1]!.getAttribute('data-status')).toBe('run');
    expect(rows[1]!.nextElementSibling?.getAttribute('data-testid')).toBe('lane');
    // The settled row keeps its own rollup chip rather than going quiet under someone else's lane.
    expect(getAllByTestId('op-chip').map((c) => c.textContent)).toContain('1 step');
  });
});

describe('laneRollup: what a finished helper leaves on the row', () => {
  it('names an incident over anything else it did', () => {
    expect(laneRollup({ childError: 'network', childOps: [{ name: 'plant_forest', status: 'ok' }] }, t))
      .toEqual({ text: 'the helper stopped', tone: 'bad' });
  });

  it('names a refusal over a revert, and a revert over a plain count', () => {
    expect(laneRollup({ childOps: [{ name: 'a', status: 'ok' }, { name: 'b', status: 'error' }] }, t))
      .toEqual({ text: 'a step was refused', tone: 'bad' });
    expect(laneRollup({ childOps: [{ name: 'a', status: 'ok' }, { name: 'b', status: 'revert' }] }, t))
      .toEqual({ text: 'put back', tone: 'warn' });
    expect(laneRollup({ childOps: [{ name: 'a', status: 'ok' }] }, t)).toEqual({ text: '1 step' });
  });

  /** A call that never reached a child (a malformed task, an abort before the first step). */
  it('says nothing for a result carrying no child record', () => {
    expect(laneRollup(undefined, t)).toBeUndefined();
    expect(laneRollup({}, t)).toBeUndefined();
    expect(laneRollup({ childOps: [] }, t)).toBeUndefined();
  });
});
