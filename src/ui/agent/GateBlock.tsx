import { displayAgentText } from '../../agent/tool-labels';
/*
 * Shared card, verdict and quick-answer primitives for approval gates. An open gate uses an active
 * left spine; after settlement the card remains in the record with a neutral spine and verdict. Ask
 * summaries stay in the locale recorded at ask time. Map thumbnails are caller-supplied, and absent
 * slots render no placeholder. Quick answers come directly from the recorded ask.
 */
import type { CSSProperties, ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Pill } from './atoms';
import { Icon, type IconId } from './icons';
import { amplitude, framerMotion } from './motion';
import { edge } from './tokens';
import { ACTIVE, INK, INSET, LINE, PLATE, PLATE_INK } from '../design/tokens';
import { colors, cursors, font, UNAVAILABLE } from '../design/styles';
import { roleFont } from '../design/text-weight';
import { windowFooterPrimary } from '../design/window-skin';
import { translate, useT } from '../../i18n/context';
import type { AskRecord, GateVerdict } from '../../agent/core/project-view';

/** How far short of its own size a card starts, per its declaration. */
const GATE_GROWTH = amplitude('panel.gate.enter') ?? 0;
/** How far the verdict chip rises into place, in px, per its declaration. */
const VERDICT_RISE = amplitude('panel.gate.verdict') ?? 0;

/** Active-gate spine width in CSS pixels, shared with closing questions on answer papers. */
export const ASK_SPINE = 5;

/** The quick row's reserved height, in px. RESERVED whenever the row stands, answers or not: a row
 *  that appeared as the answers arrived would shove the card's own buttons down under the pointer
 *  already reaching for them (the interface's layout-is-stable rule). */
const QUICK_ROW_HEIGHT = 32;

/* ── the shared card shell ───────────────────────────────────────────────── */

/**
 * THE PLATE CARD WITH THE ASK SPINE, worn by every member of the family (tool gate, plan gate,
 * question, option pick), so the spine and its retirement are decided in one place.
 */
export function AskCard({
  settled = false,
  testId,
  children,
}: {
  settled?: boolean;
  testId: string;
  children: ReactNode;
}) {
  return (
    <motion.div
      // The card GROWS into place rather than travelling (`panel.gate.enter`): the record has
      // stopped, and a card that leapt in would read as a notification passing through.
      initial={{ opacity: 0, scale: 1 - GATE_GROWTH }}
      animate={{ opacity: 1, scale: 1 }}
      transition={framerMotion('panel.gate.enter')}
      data-testid={testId}
      data-settled={settled ? 'true' : 'false'}
      style={{
        background: PLATE,
        border: edge,
        borderLeft: `${ASK_SPINE}px solid ${settled ? LINE : ACTIVE}`,
        borderRadius: 12,
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        flex: '0 0 auto',
        boxShadow: 'none',
      }}
    >
      {children}
    </motion.div>
  );
}

/* ── the verdict chip ────────────────────────────────────────────────────── */

/** Every verdict the family can wear, including the two the card refines a `words` answer into. */
export type VerdictMark = GateVerdict | 'quick' | 'picked' | 'none-held' | 'none-words';

interface VerdictSpec { icon: IconId; key: string; bad?: true }

/** The chip's glyph and sentence per verdict. `Record`, so a verdict the union grows fails `tsc`
 *  here rather than rendering a blank chip. */
const VERDICT_SPEC: Record<VerdictMark, VerdictSpec> = {
  approved: { icon: 'pw-check', key: 'agent3.gate_verdict_approved' },
  'approved-always': { icon: 'pw-check', key: 'agent3.gate_verdict_always' },
  declined: { icon: 'pw-cross', key: 'agent3.gate_verdict_declined', bad: true },
  words: { icon: 'pw-note', key: 'agent3.gate_verdict_words' },
  quick: { icon: 'pw-check', key: 'agent3.gate_verdict_quick' },
  picked: { icon: 'pw-check', key: 'agent3.gate_verdict_picked' },
  unanswered: { icon: 'pw-stop', key: 'agent3.gate_verdict_unanswered' },
  'none-held': { icon: 'pw-stop', key: 'agent3.gate_verdict_none_held' },
  'none-words': { icon: 'pw-note', key: 'agent3.gate_verdict_none_words' },
};

/**
 * The settled answer, standing on the card's own baseline.
 *
 * INSET FILL WITH PLATE INK, which is an accessibility ruling rather than a taste: the muted brown
 * on the inset measures 4.57:1 and the plate ink 7.20:1, and a chip is the one line on a settled
 * card the reader has to be able to take at a glance.
 */
export function VerdictChip({ verdict, word }: { verdict: VerdictMark; word?: string }) {
  const t = useT();
  const spec = VERDICT_SPEC[verdict];
  return (
    <motion.span
      data-testid="gate-verdict"
      data-verdict={verdict}
      initial={{ opacity: 0, y: VERDICT_RISE }}
      animate={{ opacity: 1, y: 0 }}
      transition={framerMotion('panel.gate.verdict')}
      style={{
        alignSelf: 'flex-end',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        background: spec.bad ? colors.dangerBg : INSET,
        color: spec.bad ? colors.dangerText : PLATE_INK,
        borderRadius: 999,
        padding: '3px 10px',
        ...roleFont('small'),
        fontFamily: font.family,
        maxWidth: '100%',
        minWidth: 0,
        overflow: 'hidden',
      }}
    >
      <span style={{ flex: '0 0 auto', display: 'inline-flex' }}><Icon id={spec.icon} size={11} /></span>
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {t(spec.key, word !== undefined ? { word } : undefined)}
      </span>
    </motion.span>
  );
}

/**
 * A QUESTION THAT IS STANDING BUT CANNOT BE ANSWERED YET, said in the panel's own voice.
 *
 * RENDERING NOTHING FOR A HELD ASK loses a reload mid-approval: it comes back to a paused job with
 * no trace that a question was waiting, what it asked, or that Resume is what brings it back. The
 * question is not lost (`loop.ts:existingGateId` re-enters the same gate), so the card stands with
 * its summary and this line where its buttons go, which is both facts at once: something is being
 * asked, and it is not askable of you this second.
 */
export function HeldNote() {
  const t = useT();
  return (
    <p
      data-testid="gate-held"
      style={{
        ...roleFont('note'),
        fontFamily: font.family,
        color: colors.brownText,
        lineHeight: 1.4,
        padding: '0 2px',
      }}
    >
      {t('agent3.gate_held')}
    </p>
  );
}

/* ── the quick-answer row ────────────────────────────────────────────────── */

/**
 * The quick answers under an ask, and the BOX THEY STAND IN whether or not there are any.
 *
 * A pill here is the user's own sentence sent for them: it takes the gate's words route exactly as
 * typing it would, which is why the caller reports one answer verb for both.
 */
export function QuickRow({
  answers,
  demoted = false,
  onAnswer,
  children,
}: {
  answers?: readonly string[];
  /** The composer's field holds words, so these pills step down (see `AskPrimary`). A pill and the
   *  typed sentence are two controls claiming one press, and the typed one wins: tapping a pill
   *  answers the gate and leaves the standing words behind as a STEER, which is a different act from
   *  the one they were typed for. The words are never destroyed for it. */
  demoted?: boolean;
  onAnswer?(answer: string): void;
  /** A pill of the caller's own in the same reserved box (the option pick's decline). */
  children?: ReactNode;
}) {
  return (
    <div
      data-testid="gate-quick-row"
      style={{ display: 'flex', gap: 8, minHeight: QUICK_ROW_HEIGHT, alignItems: 'center', flexWrap: 'wrap' }}
    >
      {(answers ?? []).map((answer) => (
        <AskPill key={answer} testId="gate-quick" demoted={demoted} onClick={() => onAnswer?.(answer)}>{displayAgentText(answer, translate)}</AskPill>
      ))}
      {children}
    </div>
  );
}

/* ── the card's own pill and primary ─────────────────────────────────────── */

/**
 * A quiet pill on the gate card's plate. It stands in the neutral inset fill and answers a hover
 * with the `ACTIVE` one — the one place the ask colour appears inside a card, and only under a
 * pointer that is about to press.
 */
export function AskPill({
  testId,
  demoted = false,
  onClick,
  children,
}: {
  testId: string;
  /** The pill stands down: it keeps its seat and its press, and drops the ask colour that says it
   *  is the answer being reached for. */
  demoted?: boolean;
  onClick(): void;
  children: ReactNode;
}) {
  return (
    <Pill
      data-testid={testId}
      data-demoted={demoted ? 'true' : 'false'}
      onClick={onClick}
      {...(demoted ? {} : { hoverFill: ACTIVE })}
    >
      {children}
    </Pill>
  );
}

/**
 * The card's confirming action, and its DEMOTION.
 *
 * Once the composer's field holds words, the typed sentence is what the press will be: it cancels
 * the call and becomes guidance. So Approve steps down to the neutral inset fill, because two ink
 * primaries (the send circle and this) claiming the same press is the interface asking the user to
 * guess.
 */
export function AskPrimary({
  testId,
  demoted = false,
  disabled = false,
  title,
  onClick,
  children,
}: {
  testId: string;
  demoted?: boolean;
  /** The act has already been taken and cannot be taken twice. Stands where it was, per the
   *  layout-stability rule, so a second press visibly refuses rather than doing something else. */
  disabled?: boolean;
  title?: string;
  onClick(): void;
  children: ReactNode;
}) {
  const style: CSSProperties = {
    // The STRETCHED house primary, which is the shape this is: see `atoms.tsx:RESUME_PRIMARY` for
    // why the centred one's radius is not the panel's.
    ...windowFooterPrimary,
    flex: '1 1 auto',
    padding: '10px 0',
    ...(demoted ? { background: INSET, color: PLATE_INK } : {}),
    ...(disabled ? { opacity: UNAVAILABLE, cursor: cursors.blocked } : {}),
  };
  return (
    <button
      type="button"
      data-testid={testId}
      data-demoted={demoted ? 'true' : 'false'}
      disabled={disabled}
      {...(title !== undefined ? { title } : {})}
      {...(disabled ? { 'aria-disabled': true } : {})}
      onClick={onClick}
      style={style}
    >
      {children}
    </button>
  );
}

/** The Approve/Don't pair, at one height. */
export function AskActions({
  demoted,
  approveKey,
  skipKey,
  onApprove,
  onSkip,
}: {
  demoted?: boolean;
  approveKey: string;
  skipKey: string;
  onApprove(): void;
  onSkip(): void;
}) {
  const t = useT();
  return (
    <div data-testid="gate-actions" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <AskPrimary testId="gate-approve" demoted={demoted ?? false} onClick={onApprove}>
        {t(approveKey)}
      </AskPrimary>
      <AskPill testId="gate-skip" onClick={onSkip}>{t(skipKey)}</AskPill>
    </div>
  );
}

/* ── the tool gate ───────────────────────────────────────────────────────── */

/** Which verdict a card SHOWS, given what it offered: a `words` answer whose sentence is one of the
 *  quick pills was a quick answer, and saying "answered in words" about a tapped pill under-reports
 *  what the user actually did. Everything else is the projection's own verdict unchanged. */
export function markFor(ask: AskRecord, quick?: readonly string[]): VerdictMark | undefined {
  if (ask.verdict === undefined) return undefined;
  if (ask.verdict === 'words' && ask.words !== undefined && (quick ?? []).includes(ask.words)) return 'quick';
  return ask.verdict;
}

export function GateBlock({
  ask,
  thumb,
  quick,
  actions = true,
  demoted = false,
  answerable = true,
  onAnswer,
  onQuick,
}: {
  ask: AskRecord | undefined;
  thumb?: ReactNode;
  /** The quick answers this ask offered (`AskRecord.quickAnswers`, off the `gateAsked` event). */
  quick?: readonly string[];
  /** False renders a question with no Approve/Don't pair; quick answers and the composer answer it. */
  actions?: boolean;
  /** The composer's field holds words, so the primary steps down. */
  demoted?: boolean;
  /** Whether this ask can still BE answered. False leaves the card standing with no controls: a
   *  paused session holds its question rather than losing it, and a button that reached no waiting
   *  loop would be a promise the panel cannot keep. The card SAYS so (`HeldNote`) rather than
   *  standing mute. */
  answerable?: boolean;
  onAnswer(answer: 'allow' | 'skip'): void;
  onQuick?(answer: string): void;
}) {
  if (!ask) return null;
  const mark = markFor(ask, quick);
  const settled = mark !== undefined;

  return (
    <AskCard settled={settled} testId="gate-block">
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <div
          data-testid="gate-summary"
          style={{
            ...roleFont('label'),
            fontFamily: font.family,
            color: INK,
            flex: '1 1 auto',
            minWidth: 0,
            lineHeight: 1.45,
            // The sentence interpolates model fragments (a label, an id) that can be one unbroken
            // token wider than the card.
            overflowWrap: 'anywhere',
          }}
        >
          {displayAgentText(ask.summary, translate)}
        </div>
        {thumb && (
          <div
            data-testid="gate-thumb"
            style={{
              flex: '0 0 auto',
              width: 104,
              height: 74,
              border: edge,
              borderRadius: 8,
              overflow: 'hidden',
              background: INSET,
            }}
          >
            {thumb}
          </div>
        )}
      </div>
      {/* An answered card drops the row whole: a reserved band over a hole is not stability, it is
          an empty promise of controls that are gone for good. */}
      {!settled && answerable && !actions && (
        <QuickRow answers={quick} demoted={demoted} {...(onQuick ? { onAnswer: onQuick } : {})} />
      )}
      {!settled && !answerable && <HeldNote />}
      {!settled && answerable && actions && (
        <AskActions
          demoted={demoted}
          approveKey="agent3.gate_approve"
          skipKey="agent3.gate_skip"
          onApprove={() => onAnswer('allow')}
          onSkip={() => onAnswer('skip')}
        />
      )}
      {mark && <VerdictChip verdict={mark} {...(ask.words !== undefined ? { word: ask.words } : {})} />}
    </AskCard>
  );
}
