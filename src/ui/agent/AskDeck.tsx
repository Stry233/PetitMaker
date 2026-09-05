/**
 * Collapses consecutive settled approval cards into an in-place deck without reordering the log.
 * Open or held questions remain standalone. Expansion is transient view state, and reduced motion
 * swaps the deck and cards without transitions.
 */
import { useState, type CSSProperties, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotionConfig } from 'framer-motion';
import { ASK_SPINE, markFor, VerdictChip, type VerdictMark } from './GateBlock';
import { Icon } from './icons';
import { framerMotion, NO_MOTION } from './motion';
import { edge } from './tokens';
import { INK, LINE, PLATE } from '../design/tokens';
import { colors, cursors, font } from '../design/styles';
import { roleFont } from '../design/text-weight';
import { useT } from '../../i18n/context';
import type { AskRecord } from '../../agent/core/project-view';

/** The smallest pile. Two cards read at a glance and a face over them saves no height worth a
 *  press; three is where the stack starts paying for itself. */
export const DECK_MIN = 3;

/** One stretch of the ask list as the record draws it: a pile, or a card standing alone. */
export type AskRun =
  | { deck: true; asks: AskRecord[] }
  | { deck: false; ask: AskRecord };

/** Whether an ask is a settled line of the record. Any verdict settles a card — the same test the
 *  card itself makes — while an ask with none is STANDING (answerable, or held for a resume) and is
 *  never a deck's. */
function isSettled(ask: AskRecord): boolean {
  return ask.verdict !== undefined;
}

/**
 * The ask list grouped into what the record draws, IN PLACE: each run of `DECK_MIN`-or-more
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
 * The verdict the FACE shows for one settled ask, refined exactly as the cards refine their own: a
 * `words` answer that was a tapped quick pill reads "answered: {word}", one that took an option
 * card reads "picked", and an option ask's decline reads the pick family's held refusal — so the
 * face and the card inside the pile never say two different things about one answer.
 */
export function faceMark(ask: AskRecord): { mark: VerdictMark; word?: string } | undefined {
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
  borderRadius: 12,
  padding: 12,
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  width: '100%',
  textAlign: 'left',
  cursor: cursors.clickable,
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
  open: openProp,
  onOpenChange,
  children,
}: {
  /** The settled asks this deck holds, in record order (oldest first, the newest nearest whatever
   *  stands after the pile). */
  asks: readonly AskRecord[];
  /** Controlled open flag, for a caller that needs the fact (the shell keys its height tween on
   *  it). Uncontrolled where the deck may keep it itself. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** One card per ask, in the same order: the deck presents them and builds none of them. */
  children: ReactNode;
}) {
  const t = useT();
  const reduced = useReducedMotionConfig() === true;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = (next: boolean) => {
    onOpenChange?.(next);
    if (openProp === undefined) setInternalOpen(next);
  };
  const newest = asks[asks.length - 1];
  if (asks.length === 0 || newest === undefined) return null;
  const face = faceMark(newest);
  const cards = Array.isArray(children) ? children : [children];

  /** A fanned card arrives on its own height so the record below it moves down, and carries NO exit
   *  under reduced motion, which is what makes the restack an instant swap rather than a fade. */
  const fold = reduced
    ? { initial: false as const, transition: NO_MOTION }
    : {
      initial: { opacity: 0, height: 0 },
      exit: { opacity: 0, height: 0 },
      transition: framerMotion('panel.gate.deck'),
    };

  return (
    <div
      data-testid="ask-deck"
      data-open={open ? 'true' : 'false'}
      style={{ display: 'flex', flexDirection: 'column', flex: '0 0 auto' }}
    >
      <button
        type="button"
        data-testid="ask-deck-face"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        style={FACE_STYLE}
      >
        {/* The COUNT is the face's primary fact and never truncates; the chip is the one that gives
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
          {t('agent3.gate_deck_count', { n: asks.length })}
        </span>
        {face && (
          <span style={{ display: 'inline-flex', justifyContent: 'flex-end', flex: '1 1 auto', minWidth: 0 }}>
            <VerdictChip verdict={face.mark} {...(face.word !== undefined ? { word: face.word } : {})} />
          </span>
        )}
        <span
          style={{
            flex: '0 0 auto',
            color: colors.brownText,
            display: 'inline-flex',
            transform: open ? 'rotate(180deg)' : undefined,
          }}
        >
          <Icon id="pw-chevron" size={13} />
        </span>
      </button>

      <AnimatePresence initial={false}>
        {!open && (
          <motion.div key="edges" data-testid="ask-deck-edges" {...fold} animate={{ opacity: 1, height: 'auto' }} style={{ overflow: 'hidden' }}>
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
          </motion.div>
        )}
        {open && asks.map((ask, i) => (
          <motion.div
            key={ask.gateId}
            data-testid="ask-deck-card"
            {...fold}
            animate={{ opacity: 1, height: 'auto' }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ paddingTop: FAN_GAP, display: 'flex', flexDirection: 'column' }}>{cards[i]}</div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
