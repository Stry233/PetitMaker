import type { ReactNode } from 'react';
import type { AskRecord, GateOption, PanelView } from '../../../agent/panel';
import { AskDeck, deckRuns } from './AskDeck';
import { GateBlock } from './GateBlock';
import { OptionPick, optionAskFrom } from './OptionPick';
import { PlanGate } from './PlanGate';

export type GateAnswer = (gateId: string, answer: 'allow' | 'skip' | 'words', words?: string) => void;

/** Whether the current job's asks draw any card at all. */
export function asksStand(view: PanelView): boolean {
  return (view.current?.asks ?? []).some((ask) => !ask.options || optionAskFrom(ask) !== null);
}

/**
 * The current job's asks, each as its plan, option, quick-answer or tool card; only the open gate
 * answers. Three or more consecutive answered asks fold into a deck, whose open state the caller holds.
 */
export function AskStack({ view, drafting, openDecks, onDeckChange, gateThumb, optionThumb, onGateAnswer }: {
  view: PanelView;
  /** The composer holds words, so the cards' primaries step down. */
  drafting: boolean;
  openDecks: ReadonlySet<string>;
  onDeckChange(deckId: string, open: boolean): void;
  gateThumb?(ask: AskRecord): ReactNode;
  optionThumb?(option: GateOption): ReactNode;
  onGateAnswer: GateAnswer;
}) {
  const cardFor = (ask: AskRecord): ReactNode => {
    const answerable = view.gate?.gateId === ask.gateId;
    const answer = (a: 'allow' | 'skip') => onGateAnswer(ask.gateId, a);
    const inWords = (words: string) => onGateAnswer(ask.gateId, 'words', words);
    if (ask.options) {
      const pick = optionAskFrom(ask, optionThumb ? (option) => optionThumb(option) : undefined);
      return pick ? (
        <OptionPick
          key={ask.gateId}
          ask={pick}
          answerable={answerable}
          onPick={(index) => { inWords(pick.cards[index]?.cap ?? ''); }}
          onDecline={() => answer('skip')}
        />
      ) : null;
    }
    if (ask.scope === 'plan') {
      return <PlanGate key={ask.gateId} ask={ask} demoted={drafting} answerable={answerable} onAnswer={answer} />;
    }
    const thumb = gateThumb?.(ask);
    return (
      <GateBlock
        key={ask.gateId}
        ask={ask}
        {...(thumb !== undefined && thumb !== null ? { thumb } : {})}
        {...(ask.quickAnswers ? { quick: ask.quickAnswers, actions: false, onQuick: inWords } : {})}
        demoted={drafting}
        answerable={answerable}
        onAnswer={answer}
      />
    );
  };
  return (
    <>
      {deckRuns(view.current?.asks ?? []).map((run) => {
        if (!run.deck) return cardFor(run.ask);
        const deckId = run.asks[0]!.gateId;
        return (
          <AskDeck key={`deck-${deckId}`} asks={run.asks} open={openDecks.has(deckId)} onOpenChange={(next) => onDeckChange(deckId, next)}>
            {run.asks.map(cardFor)}
          </AskDeck>
        );
      })}
    </>
  );
}
