import { describe, expect, it } from 'vitest';
import { LatestRequest } from '../../../../tools/pointer/macros/latest-request';

function harness() {
  const started: number[] = [];
  const answers: Array<() => void> = [];
  const shown: number[] = [];
  const latest = new LatestRequest<number>((n, fresh) => {
    started.push(n);
    return new Promise<void>((resolve) => { answers.push(() => { if (fresh()) shown.push(n); resolve(); }); });
  });
  const answer = async () => { answers.shift()!(); await new Promise((r) => setTimeout(r, 0)); };
  return { latest, started, shown, answer };
}

describe('LatestRequest', () => {
  it('runs one request at a time and then only the latest of those asked meanwhile', async () => {
    const h = harness();
    h.latest.ask(1); h.latest.ask(2); h.latest.ask(3);
    expect(h.started).toEqual([1]);
    expect(h.latest.hasWaiting()).toBe(true);
    await h.answer();
    expect(h.started).toEqual([1, 3]);
    await h.answer();
    expect(h.shown).toEqual([1, 3]);
    expect(h.latest.hasWaiting()).toBe(false);
  });

  it('drops the waiting request without staling the one in flight', async () => {
    const h = harness();
    h.latest.ask(1); h.latest.ask(2); h.latest.drop();
    await h.answer();
    expect(h.started).toEqual([1]);
    expect(h.shown).toEqual([1]);
  });

  it('makes the answer in flight stale on reset', async () => {
    const h = harness();
    h.latest.ask(1); h.latest.ask(2); h.latest.reset();
    await h.answer();
    expect(h.shown).toEqual([]);
    expect(h.started).toEqual([1]);
    h.latest.ask(4);
    await h.answer();
    expect(h.shown).toEqual([4]);
  });
});
