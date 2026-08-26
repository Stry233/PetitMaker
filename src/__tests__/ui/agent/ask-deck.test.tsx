/**
 * ask-deck.test.tsx — the answered asks standing as ONE DECK in the record.
 *
 * THE DECK IS A PRESENTATION OF EXISTING ENTRIES, so the seam under test is a pure grouping over
 * `AskRecord[]`: which asks deck, the minimum a pile needs, and the rule that a STANDING ask (open
 * or held) never stacks — it needs attention, and a card inside a pile is not asking for any. The
 * deck sits exactly where its cards sat: a run of consecutive answered asks folds in place, and a
 * standing ask between two runs keeps the runs apart, so the record's trail never reorders.
 *
 * The face is the pile's own card (the ask cards' chrome, spine retired) saying two facts: how many
 * answers it holds, and the NEWEST verdict — refined the way the cards themselves refine it, so a
 * tapped quick pill reads "answered: {word}" on the face exactly as it does on the card inside.
 *
 * Expanding is VIEW STATE: default collapsed, the cards fan into the list in place, a second press
 * restacks, and nothing about it is derivable from the log or survives a reload.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { I18nProvider } from '../../../i18n/context';
import { AskDeck, DECK_MIN, deckRuns, faceMark } from '../../../ui/agent/AskDeck';
import { GateBlock } from '../../../ui/agent/GateBlock';
import { PanelShell } from '../../../ui/agent/PanelShell';
import { LINE, PLATE } from '../../../ui/design/tokens';
import { useEditorStore } from '../../../state/store';
import { useAgentPanelSettings } from '../../../ui/agent/settings';
import { PROVIDER_IDS, type ProviderId } from '../../../agent/providers/defaults';
import type { AskRecord, JobView, PanelView } from '../../../agent/core/project-view';

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

beforeEach(() => {
  backing.clear();
  useEditorStore.setState({ locale: 'en' });
  useAgentPanelSettings.setState({
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

function makeView(over: Partial<PanelView> = {}): PanelView {
  return {
    phase: 'idle', jobs: [], queuedSteers: [],
    vitals: { cells: 0, objects: 0, reverts: 0, jobs: 0 },
    suggestion: null, lastEventAt: 0, ...over,
  };
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
    expect(DECK_MIN).toBe(3);
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

describe('faceMark: the newest verdict, refined the way the card refines it', () => {
  it('reads a plain verdict unchanged', () => {
    expect(faceMark(answered())?.mark).toBe('approved');
    expect(faceMark(answered({ verdict: 'declined' }))?.mark).toBe('declined');
  });

  it('reads a words answer matching a quick pill as a quick answer, with the word', () => {
    const mark = faceMark(ask({ verdict: 'words', words: 'Two lanes', quickAnswers: ['Two lanes', 'One lane'] }));
    expect(mark?.mark).toBe('quick');
    expect(mark?.word).toBe('Two lanes');
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

function deckOf(asks: AskRecord[]) {
  return (
    <AskDeck asks={asks}>
      {asks.map((a) => <GateBlock key={a.gateId} ask={a} onAnswer={() => {}} />)}
    </AskDeck>
  );
}

describe('the deck, collapsed and expanded', () => {
  it('boots collapsed: the face, the count, the newest verdict, the peeking edges, no cards', () => {
    const asks = [answered(), answered(), answered({ verdict: 'declined' })];
    const { getByTestId, getAllByTestId, queryByTestId } = renderWithI18n(deckOf(asks));
    expect(getByTestId('ask-deck').getAttribute('data-open')).toBe('false');
    expect(getByTestId('ask-deck-count').textContent).toBe('3 answered questions');
    // The NEWEST verdict, which is the last ask's.
    expect(getByTestId('gate-verdict').getAttribute('data-verdict')).toBe('declined');
    expect(getAllByTestId('ask-deck-edge').length).toBe(2);
    expect(queryByTestId('gate-block')).toBeNull();
  });

  it('wears the answered cards own chrome: the plate, and the retired spine', () => {
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
      <PanelShell view={view} connected now={0} {...VERBS} />,
    );
    expect(getByTestId('ask-deck-count').textContent).toBe('3 answered questions');
    // ONE full card stands: the standing ask, with its own controls.
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
      <PanelShell view={view} connected now={0} {...VERBS} />,
    );
    fireEvent.click(getByTestId('ask-deck-face'));
    expect(getAllByTestId('gate-block').length).toBe(4);
  });

  it('lists two answered asks plainly: a deck of two is not a pile', () => {
    const { view } = gatedView(2);
    const { getAllByTestId, queryByTestId } = renderWithI18n(
      <PanelShell view={view} connected now={0} {...VERBS} />,
    );
    expect(queryByTestId('ask-deck')).toBeNull();
    expect(getAllByTestId('gate-block').length).toBe(3);
  });
});
