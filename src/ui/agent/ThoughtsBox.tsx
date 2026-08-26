/*
 * ThoughtsBox.tsx — WHAT THE MODEL THOUGHT, behind one deliberate press and inside its own bounds
 * (normative prototype `.thoughtsBox`).
 *
 * PRESENCE ALWAYS, TRANSCRIPT NEVER BY DEFAULT. The panel states that thinking is happening, how
 * long it has gone on and how much of it there has been, on the dock's own meta line, and it says
 * that identically whether or not the provider lets us read a word. Where the text IS exposed it
 * lives here: collapsed by default, opened one press at a time, and never in the receipt or in the
 * history list's own rows. A chain of thought is working material rather than the product, so it
 * wears the muted rung and never the says line's — a model contradicts itself mid-thought by
 * design, and a retracted sentence quoted in the assistant's own voice is less honest than silence.
 *
 * THE BOUND IS THE WHOLE POINT, and it is measured rather than judged: a real 40 KB chain of thought
 * rendered unbounded in the ticket measured 28,223 px tall against a job zone of 502, burying the
 * order line, the tape, the op rows and the whole history under fifty-six screens of it. The
 * affordance was designed against a two-sentence sample that measured 113. So the box carries its
 * own scroller at roughly 40% of the job zone's height, and `overscroll-behavior: contain` keeps a
 * wheel that reaches the end of it from carrying on into the record underneath.
 *
 * IT MUST ALSO STAND OUTSIDE THE ZONE'S SCROLL-FOLLOW. The record follows its own foot while a job
 * appends, and a box opened mid-run would be yanked away from the reader every time the projection
 * moved — so whoever mounts one reports it (`JobTicket`'s `onThoughtsOpenChange`) and the follow
 * stands down for as long as it is open. That exemption is also what lets the box ANIMATE its own
 * opening (`panel.thoughts.open`): a growth at the foot of a followed scroller would drag the reader
 * along it.
 *
 * THE TEXT IS MARKDOWN, because a model writes markdown in a chain of thought whether or not anyone
 * asked — numbered steps, a table of candidates, a snippet of an id in backticks. Rendered flat, the
 * paragraph breaks collapse into a wall and the markers stand in the prose, so it goes through the
 * panel's own emitter over the house parser (`model-prose.tsx`, which carries the whole per-surface
 * decision). That is why there is no `white-space: pre-wrap` here: the breaks are BLOCKS now, not
 * newlines to preserve.
 */
import { Fragment, type CSSProperties } from 'react';
import { AnimatePresence, motion, useReducedMotionConfig } from 'framer-motion';
import { fmtClock } from './dock-face';
import { Icon } from './icons';
import { ModelProse } from './model-prose';
import { framerMotion } from './motion';
import { inkTint, metaInk } from './tokens';
import { colors, cursors, font } from '../design/styles';
import { roleFont } from '../design/text-weight';
import { useT } from '../../i18n/context';
import type { ThoughtTurn } from '../../agent/core/project-view';

/**
 * How tall the box may stand, in px.
 *
 * ROUGHLY 40% OF THE JOB ZONE at the frame's reference window, which is the artifact's own number
 * and the one the 28,223 px measurement was answered with. A flat px rather than a percentage
 * because the zone is a flex scroller with no resolved height of its own to take a percentage of;
 * in a room too small for it the zone simply scrolls, which is the same thing every other tall card
 * in the record does.
 */
export const THOUGHTS_MAX_HEIGHT = 200;

const BOX_STYLE: CSSProperties = {
  maxHeight: THOUGHTS_MAX_HEIGHT,
  overflowY: 'auto',
  overscrollBehavior: 'contain',
  background: inkTint.chip,
  borderRadius: 10,
  padding: '8px 10px',
  ...roleFont('note'),
  fontFamily: font.family,
  color: colors.brownText,
  lineHeight: 1.5,
  scrollbarWidth: 'thin',
};

/** The prose block's own rung inside the box: the box already sets the type and the ink, so what is
 *  left is the spacing between a chain of thought's paragraphs and lists. */
const PROSE_STYLE: CSSProperties = { gap: 6 };

const NOTE_STYLE: CSSProperties = {
  display: 'block',
  marginTop: 6,
  color: metaInk.fact,
  ...roleFont('small'),
  fontFamily: font.family,
};

/** What one turn thought, as far as the session still holds it. A reload keeps a readable head of
 *  it rather than the whole transcript (`persist.ts:digestReasoning`, `REASONING_EXCERPT_CHARS`),
 *  and `excerpt` is what tells the two apart: the box otherwise reads as if two sentences were the
 *  whole of a nine-thousand-character thought, which is a claim the text alone makes to a reader
 *  even though this component's own contract never made it. */
export function ThoughtsBox({ text, excerpt }: { text: string; excerpt?: boolean }) {
  const t = useT();
  const reduced = useReducedMotionConfig() === true;
  return (
    <motion.div
      data-testid="thoughts-box-frame"
      // THE HEIGHT IS WHAT OPENS, and it opens from nothing rather than from a guessed number: the
      // box's own content decides how tall it lands, which for a two-sentence thought is 40px and
      // for a bounded transcript is the scroller's cap. `overflow: hidden` is what makes the growth
      // a reveal instead of a squeeze on the text inside it.
      initial={reduced ? false : { height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={framerMotion('panel.thoughts.open')}
      style={{ overflow: 'hidden', flex: '0 0 auto' }}
    >
      <div data-testid="thoughts-box" style={BOX_STYLE}>
        <ModelProse text={text} style={PROSE_STYLE} />
        {excerpt === true && <span data-testid="thoughts-excerpt-note" style={NOTE_STYLE}>{t('agent3.thoughts_excerpt')}</span>}
      </div>
    </motion.div>
  );
}

/** The mark's own quiet row in the op list (prototype `.thoughtrow` / `.tmark`). */
const ROW_STYLE: CSSProperties = { display: 'flex', alignItems: 'center', minHeight: 22 };

const MARK_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '3px 8px',
  marginLeft: -2,
  borderRadius: 8,
  border: 'none',
  background: 'none',
  ...roleFont('small'),
  fontFamily: font.family,
  color: colors.brownText,
};

/**
 * ONE TURN'S THINKING, filed in the op list's own idiom: "thought for 1:42", and a press into the
 * box where the provider gave us the words.
 *
 * THE TURN IS THE UNIT AND NOTHING FINER IS AVAILABLE — the assembler merges a turn's reasoning
 * stretches into one part, so where inside the turn a thought fell against the calls it made is not
 * recoverable. A mark therefore stands ABOVE the rows its turn opened and claims nothing else.
 *
 * A TURN WITH NO TEXT STILL MARKS ITS EFFORT and offers NO PRESS: a hidden-CoT model spent the time
 * and the record should say so, but a control that opened onto nothing would promise a transcript
 * the provider never sent.
 *
 * `mark.text.length < mark.chars` IS THE ONE TEST FOR AN EXCERPT, and the projection is what makes it
 * one: `text` is sliced to `REASONING_EXCERPT_CHARS` at the storage boundary
 * (`persist.ts:digestReasoning`), and `chars` is measured against the string this box DISPLAYS plus
 * whatever storage cut away (`project-view.ts:markChars`). Measured any other way the two numbers
 * describe two different strings — the trim and the join alone diverged them — and every thought
 * whose stream opened or closed on a newline claimed a reload that never happened.
 */
export function ThoughtRow(
  { mark, open, onToggle }: { mark: ThoughtTurn; open: boolean; onToggle: () => void },
) {
  const t = useT();
  const label = t('agent3.thought_mark', { t: fmtClock(mark.ms / 1000) ?? '0:00' });
  if (mark.text === undefined) {
    return (
      <div data-testid="thought-row" style={ROW_STYLE}>
        <span style={{ ...MARK_STYLE, cursor: 'inherit' }}>{label}</span>
      </div>
    );
  }
  return (
    <Fragment>
      <div data-testid="thought-row" style={ROW_STYLE}>
        <button
          type="button"
          data-testid="thought-mark"
          aria-expanded={open}
          aria-label={t(open ? 'agent3.thoughts_hide' : 'agent3.thoughts_read')}
          title={t(open ? 'agent3.thoughts_hide' : 'agent3.thoughts_read')}
          onClick={onToggle}
          style={{ ...MARK_STYLE, cursor: cursors.clickable }}
        >
          <span>{label}</span>
          <span style={{ display: 'inline-flex', transform: open ? 'rotate(180deg)' : undefined }}>
            <Icon id="pw-chevron" size={12} />
          </span>
        </button>
      </div>
      {/* The FOLD needs the box to survive its own exit, which is what the presence wrapper is for:
          a box unmounted on the press has no height left to animate away from. */}
      <AnimatePresence initial={false}>
        {open && <ThoughtsBox text={mark.text} excerpt={mark.text.length < mark.chars} />}
      </AnimatePresence>
    </Fragment>
  );
}
