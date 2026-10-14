// @vitest-environment jsdom
/** Pins grouping, ordering, verdict summary, and transient expansion for settled approval decks. */
import { useState } from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { cleanup, fireEvent, within } from '@testing-library/react';
import { AskDeck, deckRuns } from '../../../ui/agent/record/AskDeck';
import { GateBlock } from '../../../ui/agent/record/GateBlock';
import { PanelShell } from '../../../ui/agent/PanelShell';
import { LINE, PLATE } from '../../../ui/design/tokens';
import { useEditorStore } from '../../../state/store';
import { useAgentConnection } from '../../../agent/connection/store';
import { PROVIDER_IDS, type ProviderId } from '../../../agent/providers/defaults';
import type { AskRecord, JobView } from '../../../agent/core/project-view';
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

/** jsdom re-serializes every colour as `rgb(...)`, so a token compared as a hex never matches. */
function rgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

let seq = 0;
function ask(over: Partial<AskRecord> = {}): AskRecord {
  seq += 1;
  return { gateId: `g${seq}`, scope: 'tool', summary: `Ask number ${seq}`, ...over };
}

function answered(over: Partial<AskRecord> = {}): AskRecord {
  return ask({ verdict: 'approved', ...over });
}

function makeJob(over: Partial<JobView> = {}): JobView {
  return {
    orderSeq: 1, orderText: 'Connect the plaza to the old mill', orderAt: 0,
    asks: [], ops: [], steerNotes: [], checkpoints: [], stamps: [], celebrate: false, skills: [],
    ...over,
  };
}

const VERBS = { onSend: () => {}, onStop: () => {}, onPause: () => {}, onGateAnswer: () => {} };

/* ── the grouping seam ─────────────────────────────────────────────────────── */

describe('deckRuns: which entries deck', () => {
  it('stacks a run of consecutive answered asks at the minimum, and not below it', () => {
    const two = deckRuns([answered(), answered()]);
    expect(two.map((r) => r.deck)).toEqual([false, false]);

    const three = deckRuns([answered(), answered(), answered()]);
    expect(three.length).toBe(1);
    expect(three[0]!.deck).toBe(true);
    expect(three[0]!.deck && three[0]!.asks.length).toBe(3);
  });

  it('never stacks the standing ask: it stays alone and full-size after the deck', () => {
    const open = ask();
    const runs = deckRuns([answered(), answered(), answered(), open]);
    expect(runs.length).toBe(2);
    expect(runs[0]!.deck).toBe(true);
    expect(runs[1]!.deck).toBe(false);
    expect(!runs[1]!.deck && runs[1]!.ask.gateId).toBe(open.gateId);
  });

  it('keeps a standing ask between two runs where it stood, so the trail never reorders', () => {
    const held = ask();
    const tail = [answered(), answered(), answered()];
    const runs = deckRuns([answered(), held, ...tail]);
    expect(runs.map((r) => (r.deck ? r.asks.length : r.ask.gateId)))
      .toEqual([expect.any(String), held.gateId, 3]);
    expect(runs[0]!.deck).toBe(false);
  });

  it('counts every settled verdict as answered, an unanswered-at-stop one included', () => {
    const runs = deckRuns([answered(), answered({ verdict: 'declined' }), answered({ verdict: 'unanswered' })]);
    expect(runs.length).toBe(1);
    expect(runs[0]!.deck).toBe(true);
  });

  it('keeps the asks in record order inside the deck', () => {
    const a = [answered(), answered({ verdict: 'words', words: 'no bridges' }), answered()];
    const runs = deckRuns(a);
    expect(runs[0]!.deck && runs[0]!.asks.map((x) => x.gateId)).toEqual(a.map((x) => x.gateId));
  });
});

/* ── the face's two facts ──────────────────────────────────────────────────── */

/** What a deck whose newest ask is `newest` shows on its face: the verdict chip's mark and words. */
function faceMark(newest: AskRecord): { mark: string; text: string } | undefined {
  const view = renderWithI18n(<AskDeck asks={[newest]} open={false} onOpenChange={() => {}}>{null}</AskDeck>);
  const chip = within(view.getByTestId('ask-deck-face')).queryByTestId('gate-verdict');
  const face = chip ? { mark: chip.dataset.verdict!, text: chip.textContent! } : undefined;
  cleanup();
  return face;
}

describe('the deck face: the newest verdict, refined the way the card refines it', () => {
  it('reads a plain verdict unchanged', () => {
    expect(faceMark(answered())?.mark).toBe('approved');
    expect(faceMark(answered({ verdict: 'declined' }))?.mark).toBe('declined');
  });

  it('reads a words answer matching a quick pill as a quick answer, with the word', () => {
    const mark = faceMark(ask({ verdict: 'words', words: 'Two lanes', quickAnswers: ['Two lanes', 'One lane'] }));
    expect(mark?.mark).toBe('quick');
    expect(mark?.text).toContain('Two lanes');
  });

  it('reads a words answer matching an option caption as picked', () => {
    const mark = faceMark(ask({
      verdict: 'words', words: 'The cove',
      options: [{ cap: 'The cove', rect: { x1: 0, y1: 0, x2: 1, y2: 1 } }],
    }));
    expect(mark?.mark).toBe('picked');
  });

  it('answers nothing for an open ask', () => {
    expect(faceMark(ask())).toBeUndefined();
  });
});

/* ── the deck component ────────────────────────────────────────────────────── */

/** The deck with its open flag held the way `PanelShell` holds it. */
function HeldDeck({ asks }: { asks: AskRecord[] }) {
  const [open, setOpen] = useState(false);
  return (
    <AskDeck asks={asks} open={open} onOpenChange={setOpen}>
      {asks.map((a) => <GateBlock key={a.gateId} ask={a} onAnswer={() => {}} />)}
    </AskDeck>
  );
}

function deckOf(asks: AskRecord[]) {
  return <HeldDeck asks={asks} />;
}

describe('the deck, collapsed and expanded', () => {
  it('boots collapsed: the face, the count, the newest verdict, the peeking edges, no cards', () => {
    const asks = [answered(), answered(), answered({ verdict: 'declined' })];
    const { getByTestId, getAllByTestId, queryByTestId } = renderWithI18n(deckOf(asks));
    expect(getByTestId('ask-deck').getAttribute('data-open')).toBe('false');
    expect(getByTestId('ask-deck-count').textContent).toBe('3 answered questions');
    // The newest verdict, which is the last ask's.
    expect(getByTestId('gate-verdict').getAttribute('data-verdict')).toBe('declined');
    expect(getAllByTestId('ask-deck-edge').length).toBe(2);
    expect(queryByTestId('gate-block')).toBeNull();
  });

  it('wears the settled-card plate and spine', () => {
    const { getByTestId } = renderWithI18n(deckOf([answered(), answered(), answered()]));
    const face = getByTestId('ask-deck-face');
    expect(face.style.background).toBe(rgb(PLATE));
    expect(face.style.borderLeft).toContain('5px');
    expect(face.style.borderLeft).toContain(rgb(LINE));
  });

  it('fans the cards into the list in place on a press, and restacks on a second', () => {
    const asks = [answered(), answered(), answered()];
    const { getByTestId, getAllByTestId, queryByTestId } = renderWithI18n(deckOf(asks));
    const face = getByTestId('ask-deck-face');
    expect(face.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(face);
    expect(face.getAttribute('aria-expanded')).toBe('true');
    expect(getByTestId('ask-deck').getAttribute('data-open')).toBe('true');
    const cards = getAllByTestId('gate-block');
    expect(cards.length).toBe(3);
    // Record order: the summaries read oldest to newest, exactly as the list would.
    const summaries = getAllByTestId('gate-summary').map((el) => el.textContent);
    expect(summaries).toEqual(asks.map((a) => a.summary));

    fireEvent.click(face);
    expect(face.getAttribute('aria-expanded')).toBe('false');
    // Reduced motion (the wrapper's MotionConfig) is an instant swap: no exit lingers.
    expect(queryByTestId('gate-block')).toBeNull();
    expect(getAllByTestId('ask-deck-edge').length).toBe(2);
  });
});

/* ── the record wearing it ─────────────────────────────────────────────────── */

describe('the record decks its answered asks and never the standing one', () => {
  function gatedView(answeredCount: number) {
    const asks = Array.from({ length: answeredCount }, () => answered());
    const open = ask({ summary: 'May I pave the north lane?' });
    const view = makeView({
      phase: 'gated',
      current: makeJob({ asks: [...asks, open] }),
      gate: { gateId: open.gateId, scope: 'tool', summary: open.summary },
    });
    return { view, open };
  }

  it('stacks three answered asks behind the standing question, which keeps its buttons', () => {
    const { view } = gatedView(3);
    const { getByTestId, getAllByTestId } = renderWithI18n(
      <PanelShell {...panelProps({ view, connected: true, now: 0, ...VERBS })} />,
    );
    expect(getByTestId('ask-deck-count').textContent).toBe('3 answered questions');
    // One full card stands: the standing ask, with its own controls.
    expect(getAllByTestId('gate-block').length).toBe(1);
    expect(getByTestId('gate-approve')).toBeTruthy();
    // The deck sits where the answered cards sat: before the standing ask in the record's order.
    const deck = getByTestId('ask-deck');
    const standing = getByTestId('gate-block');
    expect(deck.compareDocumentPosition(standing) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('expands into the full card list in place', () => {
    const { view } = gatedView(3);
    const { getByTestId, getAllByTestId } = renderWithI18n(
      <PanelShell {...panelProps({ view, connected: true, now: 0, ...VERBS })} />,
    );
    fireEvent.click(getByTestId('ask-deck-face'));
    expect(getAllByTestId('gate-block').length).toBe(4);
  });

  it('lists two answered asks plainly: a deck of two is not a pile', () => {
    const { view } = gatedView(2);
    const { getAllByTestId, queryByTestId } = renderWithI18n(
      <PanelShell {...panelProps({ view, connected: true, now: 0, ...VERBS })} />,
    );
    expect(queryByTestId('ask-deck')).toBeNull();
    expect(getAllByTestId('gate-block').length).toBe(3);
  });
});
