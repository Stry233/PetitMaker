/**
 * Collapses consecutive settled approval cards into an in-place deck without reordering the log.
 * Open or held questions remain standalone. Expansion is transient view state, and reduced motion
 * swaps the deck and cards without transitions.
 */
import type { CSSProperties, ReactNode } from 'react';
import { AnimatePresence } from 'framer-motion';
import { ASK_SPINE, markFor, VerdictChip, type VerdictMark } from './GateBlock';
import { Icon } from '../parts/sprite';
import { Disclosure } from '../../primitives/Disclosure';
import { ActionButton } from '../../primitives/ActionButton';
import { useReadingIntent } from '../parts/scroll-intent';
import { edge } from '../panel-skin';
import { INK, LINE, MUTED, PLATE } from '../../design/tokens';
import { font, radii } from '../../design/styles';
import { roleFont } from '../../design/text-weight';
import { useT } from '../../../i18n/context';
import type { AskRecord } from '../../../agent/panel';

/** The smallest pile. Two cards read at a glance and a face over them saves no height worth a
 *  press; three is where the stack starts paying for itself. */
const DECK_MIN = 3;

/** One stretch of the ask list as the record draws it: a pile, or a card standing alone. */
type AskRun =
  | { deck: true; asks: AskRecord[] }
  | { deck: false; ask: AskRecord };

/** Whether an ask is a settled line of the record. Any verdict settles a card — the same test the
 *  card itself makes — while an ask with none is standing (answerable, or held for a resume) and is
 *  never a deck's. */
function isSettled(ask: AskRecord): boolean {
  return ask.verdict !== undefined;
}

/**
 * The ask list grouped into what the record draws, in place: each run of `DECK_MIN`-or-more
 * consecutive settled asks becomes one deck standing where the run stood, and everything else keeps
 * its own card. A standing ask between two runs keeps them apart, so no card ever crosses another
 * entry of the trail.
 */
export function deckRuns(asks: readonly AskRecord[]): AskRun[] {
  const runs: AskRun[] = [];
  let pile: AskRecord[] = [];
  const flush = () => {
    if (pile.length >= DECK_MIN) runs.push({ deck: true, asks: pile });
    else for (const ask of pile) runs.push({ deck: false, ask });
    pile = [];
  };
  for (const ask of asks) {
    if (isSettled(ask)) { pile.push(ask); continue; }
    flush();
    runs.push({ deck: false, ask });
  }
  flush();
  return runs;
}

/**
 * The verdict the face shows for one settled ask, refined exactly as the cards refine their own: a
 * `words` answer that was a tapped quick pill reads "answered: {word}", one that took an option
 * card reads "picked", and an option ask's decline reads the pick family's held refusal — so the
 * face and the card inside the pile never say two different things about one answer.
 */
function faceMark(ask: AskRecord): { mark: VerdictMark; word?: string } | undefined {
  if (ask.verdict === undefined) return undefined;
  const word = ask.words !== undefined ? { word: ask.words } : {};
  if (ask.options) {
    if (ask.verdict === 'words') {
      return ask.options.some((option) => option.cap === ask.words)
        ? { mark: 'picked' }
        : { mark: 'none-words', ...word };
    }
    if (ask.verdict === 'declined') return { mark: 'none-held' };
    return { mark: ask.verdict, ...word };
  }
  return { mark: markFor(ask, ask.quickAnswers)!, ...word };
}

/** Deck face using the settled approval-card treatment. */
const FACE_STYLE: CSSProperties = {
  background: PLATE,
  border: edge,
  borderLeft: `${ASK_SPINE}px solid ${LINE}`,
  borderRadius: radii.md,
  padding: 12,
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  width: '100%',
  textAlign: 'left',
  boxShadow: 'none',
};

/** The two card edges peeking under the face, each a step further in: the same plate and hairline
 *  the cards wear, cut to the strip a card shows from under another. */
const PEEK_STEP = 5;
const PEEK_HEIGHTS = [5, 4] as const;

/** The list's own rhythm between fanned cards, matching the job zone's gap so an open deck reads as
 *  the plain card list it fans into. */
const FAN_GAP = 10;

export function AskDeck({
  asks,
  open,
  onOpenChange,
  children,
}: {
  /** The settled asks this deck holds, in record order (oldest first, the newest nearest whatever
   *  stands after the pile). */
  asks: readonly AskRecord[];
  /** Held by the caller, which keys its height tween on it. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** One card per ask, in the same order: the deck presents them and builds none of them. */
  children: ReactNode;
}) {
  const t = useT();
  const preserveReading = useReadingIntent();
  const setOpen = (next: boolean) => {
    preserveReading();
    onOpenChange(next);
  };
  const newest = asks[asks.length - 1];
  if (asks.length === 0 || newest === undefined) return null;
  const face = faceMark(newest);
  const cards = Array.isArray(children) ? children : [children];

  return (
    <div
      data-testid="ask-deck"
      data-open={open ? 'true' : 'false'}
      style={{ display: 'flex', flexDirection: 'column', flex: '0 0 auto' }}
    >
      <ActionButton
        data-testid="ask-deck-face"
        interaction="row"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        style={FACE_STYLE}
      >
        {/* The count is the face's primary fact and never truncates; the chip is the one that gives
            (it carries its own ellipsis), since its full sentence stands on the card inside. */}
        <span
          data-testid="ask-deck-count"
          style={{
            ...roleFont('label'),
            fontFamily: font.family,
            color: INK,
            flex: '0 0 auto',
            whiteSpace: 'nowrap',
          }}
        >
          {t('agent.gate_deck_count', { n: asks.length })}
        </span>
        {face && (
          <span style={{ display: 'inline-flex', justifyContent: 'flex-end', flex: '1 1 auto', minWidth: 0 }}>
            <VerdictChip verdict={face.mark} {...(face.word !== undefined ? { word: face.word } : {})} />
          </span>
        )}
        <span
          style={{
            flex: '0 0 auto',
            color: MUTED,
            display: 'inline-flex',
            transform: open ? 'rotate(180deg)' : undefined,
          }}
        >
          <Icon id="pw-chevron" size={13} />
        </span>
      </ActionButton>

      <AnimatePresence initial={false}>
        {!open && (
          <Disclosure key="edges" testId="ask-deck-edges" motionId="panel.gate.deck">
            {PEEK_HEIGHTS.map((height, i) => (
              <div
                key={height}
                data-testid="ask-deck-edge"
                style={{
                  height,
                  margin: `0 ${PEEK_STEP * (i + 1)}px`,
                  background: PLATE,
                  border: edge,
                  borderTop: 'none',
                  borderRadius: `0 0 ${12 - 2 * (i + 1)}px ${12 - 2 * (i + 1)}px`,
                }}
              />
            ))}
          </Disclosure>
        )}
        {open && asks.map((ask, i) => (
          <Disclosure key={ask.gateId} testId="ask-deck-card" motionId="panel.gate.deck" spaceBefore={FAN_GAP}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>{cards[i]}</div>
          </Disclosure>
        ))}
      </AnimatePresence>
    </div>
  );
}
