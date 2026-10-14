// @vitest-environment jsdom
/**
 * The notes queued for the next step, all of them: three stand at a time and the rest read as a
 * count that expands. The chips scroll in their own strip and the "+N more" line stands below it in
 * flow, so a squeezed stack shrinks the strip and the count never leaves the screen. jsdom lays
 * nothing out, so this asserts which box scrolls and which may not shrink.
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/react';
import { SteerQueue } from '../../../ui/agent/composer/SteerQueue';
import { translateFor } from '../../../i18n/context';
import { renderWithI18n } from '../../_support/agent-panel';
import type { TextKey } from '../../../i18n/keys';

const backing = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
};

const t = (key: TextKey, params?: Record<string, string | number>) => translateFor('en', key, params);

const NOTES = [
  'Keep the shore clear of houses',
  'Slate roofs, not thatch',
  'A lantern at every corner',
  'No fences by the water',
  'Leave room for a market',
];

function steers(n: number) {
  return NOTES.slice(0, n).map((text, i) => ({ seq: 10 + i, text }));
}

describe('SteerQueue: every note stands', () => {
  it('draws one chip per note up to the cap, each with its text, its mark and its cross', () => {
    const { getAllByTestId } = renderWithI18n(<SteerQueue steers={steers(2)} onRecall={() => {}} />);
    const chips = getAllByTestId('panel-steer-chip');
    expect(chips.length).toBe(2);
    expect(chips[0]!.textContent).toContain(NOTES[0]);
    expect(chips[1]!.textContent).toContain(NOTES[1]);
    for (const chip of chips) {
      expect(chip.textContent).toContain(t('agent.steer_at_next_step'));
      expect(chip.querySelector('[data-testid="panel-steer-recall"]')).toBeTruthy();
    }
  });

  /** Five queued notes are three chips and a count, never one chip. */
  it('renders three of five and says the rest as a count', () => {
    const { getAllByTestId, getByTestId } = renderWithI18n(
      <SteerQueue steers={steers(5)} onRecall={() => {}} />,
    );
    expect(getAllByTestId('panel-steer-chip').length).toBe(3);
    expect(getByTestId('steer-more').textContent).toBe(t('agent.steer_more', { n: 2 }));
  });

  it('draws no count line while every note is standing', () => {
    const { queryByTestId } = renderWithI18n(<SteerQueue steers={steers(3)} onRecall={() => {}} />);
    expect(queryByTestId('steer-more')).toBeNull();
  });

  /** The count line expands: pressing it stands the rest up, and the line becomes the way back. */
  it('expands to the whole queue and offers the way back', async () => {
    const { getAllByTestId, getByTestId } = renderWithI18n(
      <SteerQueue steers={steers(5)} onRecall={() => {}} />,
    );
    fireEvent.click(getByTestId('steer-more'));
    expect(getAllByTestId('panel-steer-chip').length).toBe(5);
    expect(getByTestId('steer-more').textContent).toBe(t('agent.steer_fewer'));
    fireEvent.click(getByTestId('steer-more'));
    expect(getByTestId('steer-more').textContent).toBe(t('agent.steer_more', { n: 2 }));
    // The two that collapse leave rather than vanishing (`AnimatePresence`), so the count settles a
    // beat after the press.
    await waitFor(() => expect(getAllByTestId('panel-steer-chip').length).toBe(3));
  });

  it('takes back ONE note, by its own seq', () => {
    const onRecall = vi.fn();
    const { getAllByTestId } = renderWithI18n(<SteerQueue steers={steers(3)} onRecall={onRecall} />);
    fireEvent.click(getAllByTestId('panel-steer-recall')[1]!);
    expect(onRecall.mock.calls).toEqual([[11]]);
  });

  /**
   * The zone stands empty rather than appearing. A row that arrived here would shorten the record
   * under the pointer that is reading it, which is the house's layout-stability rule.
   */
  it('stands its zone with nothing queued, and draws no chips in it', () => {
    const { getByTestId, queryAllByTestId } = renderWithI18n(
      <SteerQueue steers={[]} onRecall={() => {}} />,
    );
    expect(getByTestId('panel-steer-zone')).toBeTruthy();
    expect(queryAllByTestId('panel-steer-chip').length).toBe(0);
  });
});

describe('SteerQueue: the squeeze', () => {
  /**
   * Which box gives way. The chips box is the one that scrolls and the one that may shrink
   * (`flex: 0 1 auto` + `overflow-y: auto`); the count line may not (`flex: 0 0 auto`), so a stack
   * squeezed to less than the queue's own height loses chip rows and keeps the affordance.
   */
  it('scrolls the chips and pins the count line', () => {
    const { getByTestId } = renderWithI18n(<SteerQueue steers={steers(5)} onRecall={() => {}} />);
    const chips = getByTestId('steer-chips');
    expect(chips.style.overflowY).toBe('auto');
    expect(chips.parentElement!.style.flex).toBe('0 1 auto');
    expect(chips.style.minHeight).toBe('0');
    expect(getByTestId('steer-more').style.flex).toBe('0 0 auto');
  });

  /** And the stack itself yields before the record does: it is the shrinkable one of the two. */
  it('yields as a whole, capped at the three-chip height', () => {
    const { getByTestId } = renderWithI18n(<SteerQueue steers={steers(5)} onRecall={() => {}} />);
    const zone = getByTestId('panel-steer-zone');
    expect(zone.style.flex).toBe('0 1 auto');
    expect(zone.style.maxHeight).toBe('153px');
  });
});
