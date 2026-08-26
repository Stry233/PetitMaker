/*
 * FlipTicket.tsx — THE TERMINAL FAMILY: one grammar, five hierarchies (normative prototype
 * `.fticket`/`.finner`/`.face` for the flip family, `.aticket` for the two one-face cards).
 *
 * ONE GRAMMAR — the same paper, the same stamp seat, the same pill vocabulary, at most one primary,
 * and File it away as the one settle verb wherever a record settles. ONLY THE HIERARCHY CHANGES:
 *
 *   done          the built thing leads. A full-width POSTCARD over a stat row whose figures count
 *                 up once on arrival, the order named, the closing words under it. No primary on the
 *                 card, because the composer's next order is the screen's primary.
 *   done.capped   the stage LEDGER stands on the FRONT — ticks on what finished, the unreached stage
 *                 open in revert ink behind a dashed border — and the decision owns the foot: Keep
 *                 going as the ink primary beside File it away. The read verb yields the foot and
 *                 rides the header seat.
 *   aborted       `StopCard`, one face and no flip: the stopped order, the kept-edits FACT at the
 *                 headline rung, and exactly two answers (Rewind behind its confirm, File it away).
 *   done.question `compact`: the receipt compresses to a two-line settle with its flip intact, and
 *                 the question moves into the ask card's own grammar below it. No File it away while
 *                 the ask stands — answering is what files the record.
 *   history.open  `ArchiveCard`: the provenance stamp in the header seat where done wears its score,
 *                 steps INLINE, no flip, no counts, no postcard, no per-step rewind. Back is the one
 *                 lit act and Clear stands last behind its confirm.
 *
 * EVERY TAKE-BACK ON A LIVE RECEIPT LIVES ON THE FLIP'S BACK FACE, beside the story it undoes: the
 * celebration face does not offer to un-build what it is showing. The archive card offers none at
 * all — later jobs sit on top of a mid-job state, so the whole-job roll back keeps its seat on the
 * history row.
 *
 * BOTH FACES STAY MOUNTED, which is what a rotation needs: the card turns on `rotateY` and each
 * face hides its own back (`backface-visibility`), so there is no moment where the arriving face has
 * to be built. Under reduced motion the transition is dropped outright rather than shortened — a
 * half-turned card is exactly the state the preference exists to refuse — and the hidden face is
 * marked `aria-hidden` either way, so a screen reader is never read both sides at once.
 *
 * THE FIGURES AND THE STEP LIST ARE READ OFF THE JOB, not passed in: the figures are the cells and
 * objects the job's tool results reported (a count that came back ZERO IS LEFT OUT — no stat cell at
 * all, never a printed zero), and the steps are `job.checkpoints`, which is the only list where each
 * entry carries an undo watermark a rewind can actually use. A step is NAMED by the plan stage it
 * belongs to where `stageIndex` resolves to one, and by its own kind otherwise. NOTHING HERE INVENTS
 * A STEP COUNT: a job with no checkpoints has no story, and the card grows no flip rather than
 * reporting a step it cannot name.
 *
 * A FIGURE PER STAGE, AND DELIBERATELY NONE PER STEP. The front's capped LEDGER carries one
 * (`stageFigure`), because `OpRow.stageIndex` partitions the ops by stage and the measure is a real
 * sum. The back's STEP list carries none, for two reasons: a checkpoint publishes
 * `{undoIndex, label, stageIndex?}` and no
 * op watermark, so there is no range of ops to sum between two of them and any figure would be
 * apportioned by guess; and the trailing seat a figure would take is already spent, on the per-step
 * rewind and the inline confirm that replaces it while the question stands. A take-back the reader
 * can act on is worth more in that seat than a number, and both would not fit the row.
 *
 * `score`, `thumb` and `postcard` are SLOTS: a map score and a rendered capture are the shell's to
 * compute (`canvas/thumbnail.ts` and the evaluator), and neither belongs in a presentational card.
 * No slot, no chip and no frame — an empty bordered rectangle is worse than nothing.
 *
 * `rolledBack` is presentational, as it is in `HistoryStrip`: the shell owns the
 * undo watermark. A rolled-back record dims, reads every step as rewound and offers no rewind, since
 * a checkpoint inside a job whose edits are already off the map is not a place to go back to.
 *
 * THE TAPE BAND IS THE PLAN'S OWN READING, and only a job that HAD a plan draws one. It is the
 * settled twin of the live ticket's progress bar, so it states the same fraction that bar last
 * stood at: a capped run shows the stages it got through, which is the whole point of the card. A
 * FULL band on a capped receipt would say the plan finished, and a band on a planless job would be
 * a gauge measuring nothing.
 */
import {
  useEffect, useLayoutEffect, useRef, useState,
  type CSSProperties, type ReactNode, type RefObject,
} from 'react';
import { animate, useReducedMotionConfig } from 'framer-motion';
import { CountPill, Pill, Stamp as StampLine, TapeBar } from './atoms';
import { AskPrimary } from './GateBlock';
import { Icon, type IconId } from './icons';
import { ModelProse } from './model-prose';
import { CARD_PAD, edge, POSTCARD, statePaper, withAlpha } from './tokens';
import { CONFIRM_ARM, cssMotion, framerMotion } from './motion';
import { rewindConfirmCopy, rollbackCost, rollbackReaches } from './rollback';
import { fmtClock } from './dock-face';
import { InlineConfirm, HUSHED } from '../primitives/InlineConfirm';
import { INK, INSET, PLATE, PLATE_INK } from '../design/tokens';
import { colors, cursors, font } from '../design/styles';
import { roleFont } from '../design/text-weight';
import { windowPill } from '../design/window-skin';
import { useT } from '../../i18n/context';
import type { T } from './setup-parts';
import type { JobOutcome } from '../../agent/core/types';
import type { JobView } from '../../agent/core/project-view';

/**
 * One recorded checkpoint, and THE ONE NAME FOR IT in this panel: a rewind hands the whole entry
 * back rather than an index into a list, so a caller needs no copy of the array to know where it is
 * being sent (`undoIndex` IS the watermark). `PlanRail` offers the same affordance from inside a
 * live ticket and imports this same type, so the two rewinds cannot drift into two shapes.
 */
export type Checkpoint = JobView['checkpoints'][number];

interface StampSpec { paper: string; icon: IconId; key: string }

/** The stamp each outcome wears: its paper, its glyph and the words it states. `Record`, not a
 *  chain of ternaries, so an outcome the union grows fails `tsc` here rather than rendering blank. */
const OUTCOME_STAMP: Record<JobOutcome, StampSpec> = {
  done: { paper: statePaper.work, icon: 'pw-check', key: 'agent3.ticket_stamp_done' },
  capped: { paper: statePaper.ask, icon: 'pw-flag', key: 'agent3.ticket_stamp_capped' },
  aborted: { paper: statePaper.stop, icon: 'pw-stop', key: 'agent3.ticket_stamp_aborted' },
  incident: { paper: statePaper.danger, icon: 'pw-warning', key: 'agent3.ticket_stamp_incident' },
};

/**
 * THE SIXTH DRESS, and it OUTRANKS THE OUTCOME rather than sitting beside it.
 *
 * A record whose edits have been taken back off the map is not a `done` card at 55% opacity: every
 * claim on its front — Built, the counts, the photograph, "9 edits are on your map" — is now false,
 * and dimming a false sentence does not make it true. So the stamp becomes its own (the artifact's
 * `.bstamp.rewound` on the wait paper, under the take-back's own arrow) and the card drops what it
 * can no longer assert. `rolledBack` is still the shell's reading, not the log's: the outcome is
 * what the job DID, and this is what has since become of it.
 */
const REWOUND_STAMP: StampSpec = {
  paper: statePaper.wait, icon: 'pw-undo-arrow', key: 'agent3.ticket_stamp_rewound',
};

/** The words a checkpoint goes by when no plan stage claims it. The log writes exactly these three
 *  labels, but `JobView` widens the field to `string`, so an unknown one reads as the plain edit it
 *  must at least have been rather than leaking an internal token into the interface. */
const STEP_KEY: Record<string, string> = {
  job: 'agent3.ticket_step_job',
  stage: 'agent3.ticket_step_stage',
  write: 'agent3.ticket_step_write',
};
const STEP_KEY_FALLBACK = 'agent3.ticket_step_write';

function stepKey(label: string): string {
  return STEP_KEY[label] ?? STEP_KEY_FALLBACK;
}

/** Cells painted and objects placed, as the job's own tool results reported them. A figure that came
 *  back zero is DROPPED: "0 objects" is a count of an absence, and the card has nothing to say about
 *  a kind of work this job never did. */
function statsOf(job: JobView): { key: string; n: number }[] {
  let cells = 0;
  let objects = 0;
  for (const op of job.ops) {
    cells += op.detail?.cells ?? 0;
    objects += op.detail?.objects ?? 0;
  }
  return [
    { key: 'agent3.ticket_stat_cells', n: cells },
    { key: 'agent3.ticket_stat_objects', n: objects },
  ].filter((c) => c.n > 0);
}

/**
 * ONE STAGE'S OWN FIGURE, or none: what the work filed under it came to.
 *
 * THE MEASURE IS WHAT THE STAGE DID, NOT HOW MANY CALLS IT TOOK. A stage that painted reports its
 * cells, one that placed reports its objects, one that only LOOKED reports its reads — three
 * different things and the card says whichever the stage was: a call count would be a figure about
 * the assistant's method rather than about the map. Where a stage both painted and placed the larger
 * measure leads, since the other is on the receipt's own stat row in full.
 *
 * A stage with nothing to report gets no figure, exactly as a zero drops out of the stat row: an
 * empty cell is a fact, "0 cells" is a claim about work nobody asked for.
 */
function stageFigure(job: JobView, index: number, t: T): string | undefined {
  let cells = 0;
  let objects = 0;
  let reads = 0;
  for (const op of job.ops) {
    if (op.stageIndex !== index) continue;
    cells += op.detail?.cells ?? 0;
    objects += op.detail?.objects ?? 0;
    if (op.isRead) reads += 1;
  }
  if (cells > 0 && cells >= objects) return t(cells === 1 ? 'agent3.ticket_stage_cells_one' : 'agent3.ticket_stage_cells', { n: cells });
  if (objects > 0) return t(objects === 1 ? 'agent3.ticket_stage_objects_one' : 'agent3.ticket_stage_objects', { n: objects });
  // The dock's own words for a read count rather than a second copy of them.
  if (reads > 0) return t(reads === 1 ? 'agent3.dock_reads_one' : 'agent3.dock_reads', { n: reads });
  return undefined;
}

/** Everything a job changed on the map, which is the stop card's own headline fact. */
export function editCount(job: JobView): number {
  return job.ops.reduce((sum, op) => sum + (op.detail?.cells ?? 0) + (op.detail?.objects ?? 0), 0);
}

/* ── the shared paper ─────────────────────────────────────── */

/** The card body every member of the family wears: one inset paper, one radius, one gutter. */
const PAPER: CSSProperties = {
  background: INSET,
  border: edge,
  borderRadius: 24,
  padding: CARD_PAD,
  display: 'flex',
  flexDirection: 'column',
  gap: 9,
  overflow: 'hidden',
  boxShadow: 'none',
};

/**
 * A flip face: the same paper, absolutely placed so the card can measure the taller of the two.
 *
 * `backface-visibility` IS LOAD-BEARING, not a polish. Both faces stand in the same box and the back
 * one paints LAST, so without it the turned-away face covers the front and the whole receipt reads
 * MIRRORED. It only takes effect inside a 3D rendering context, which is why nothing between the
 * `perspective` box and these faces may carry a grouping property (`opacity`, `filter`, `clip-path`)
 * — that would flatten the context and take the hiding with it. Hence the rolled-back dim below is
 * worn by each FACE rather than by the card.
 */
const FACE: CSSProperties = {
  ...PAPER,
  position: 'absolute',
  inset: 0,
  backfaceVisibility: 'hidden',
  WebkitBackfaceVisibility: 'hidden',
};

/** The one-face cards (`.aticket`): the same paper standing in the flow. */
const TICKET: CSSProperties = { ...PAPER, flex: '0 0 auto' };

/** The card's foot (`.tfoot`). It WRAPS, as the artifact's does: two worded pills, or a confirm
 *  pair standing in one of their seats, will not share a line at every locale's word lengths, and a
 *  verb sliced off the card's edge is a verb nobody can press. */
const FOOT: CSSProperties = {
  marginTop: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
};

/** The foot's spacer (`.tfoot .sp`), which is what puts the quiet verb at the row's far end and lets
 *  a confirm open in its seat without moving the lit one. */
const SPACER: CSSProperties = { flex: 1 };

/** The order line (`.forder`), and the stop card's kept-edits FACT at the same rung. */
const HEADLINE: CSSProperties = {
  ...roleFont('action'),
  fontFamily: font.family,
  color: PLATE_INK,
  lineHeight: 1.3,
  overflowWrap: 'anywhere',
};

/** The model's closing words (`.tsum`): one rung down, receding. */
const SUMMARY: CSSProperties = {
  ...roleFont('note'),
  fontFamily: font.family,
  color: colors.brownText,
  lineHeight: 1.4,
};

/** The same line where it is the card's ONLY body (`.tsum.onmap`): a compact settle says what is on
 *  the map, and that fact is not small print. */
const ON_MAP: CSSProperties = { ...SUMMARY, color: PLATE_INK };

/**
 * The receipt's thinking line, or null where there was none to report.
 *
 * A JOB THAT THOUGHT IN ONE TURN SAYS SO IN ONE CLAUSE: "across 1 turns" is a count of a thing that
 * did not happen twice, and the turn count is only interesting where the thinking was spread.
 */
function thoughtLine(job: JobView, t: T): string | null {
  const thought = job.thought;
  if (!thought || thought.ms <= 0) return null;
  const clock = fmtClock(thought.ms / 1000);
  if (clock === null) return null;
  return thought.turns > 1
    ? t('agent3.thoughts_total', { t: clock, n: thought.turns })
    : t('agent3.thoughts_total_one', { t: clock });
}

/**
 * THE ONE HONEST TOTAL, and the whole of what a receipt says about thinking.
 *
 * A chain of thought is working material rather than the product, so no transcript reaches this
 * card and no per-turn row does either: what the record owes is that the job spent this long
 * thinking, across this many turns. Said quietly, in the small rung, under the figures that ARE the
 * product.
 */
const THOUGHT_TOTAL: CSSProperties = {
  ...roleFont('small'),
  fontFamily: font.family,
  color: colors.brownText,
  fontVariantNumeric: 'tabular-nums',
};

/** The provenance stamp in the seat where a done receipt wears its score (`.hstamp`). */
const HEAD_STAMP: CSSProperties = {
  marginLeft: 'auto',
  ...roleFont('small'),
  fontFamily: font.family,
  color: colors.brownText,
  fontVariantNumeric: 'tabular-nums',
};

/** The floor a flip card measures to (prototype `.fticket`), and the compact settle's own. Both
 *  faces are absolute, so the card cannot measure them: it stands at the taller face's floor. */
const CARD_FLOOR = 290;
const COMPACT_FLOOR = 118;

/**
 * THE CARD EARNS ITS HEIGHT: both faces are absolutely placed, so the box holding them has no
 * content height of its own and takes the TALLER of the two (floored).
 *
 * Without this the front face's own content overflows a fixed box and its foot is sliced off — the
 * two verbs at the bottom of a done receipt, which is exactly what the card is for. `scrollHeight`
 * reads what the face WANTS because the face is stretched to the box rather than to its content.
 *
 * IT LOOPS, and that is the artifact's own note rather than superstition: a face is a flex column,
 * so one pass measures children that are still being squeezed and under-reads a long summary. It
 * settles the moment the reading stops moving, and three passes is the cap.
 *
 * `useLayoutEffect`, so the height lands before the browser paints: a frame at the wrong height is a
 * visible jump on a card that has only just arrived.
 */
const SIZE_PASSES = 3;

function useFaceHeight(
  inner: RefObject<HTMLDivElement | null>,
  floor: number,
  key: unknown,
): void {
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return undefined;
    const measure = () => {
      for (let pass = 0; pass < SIZE_PASSES; pass++) {
        let wanted = floor;
        for (const face of el.querySelectorAll<HTMLElement>('[data-face-body]')) {
          wanted = Math.max(wanted, face.scrollHeight);
        }
        if (el.style.height === `${wanted}px`) break;
        el.style.height = `${wanted}px`;
      }
    };
    measure();
    // The panel's own width is fixed, but the CHROME zoom is not, and a locale change rewraps every
    // line on the card: both reach here as a resize of the faces.
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    for (const face of el.querySelectorAll<HTMLElement>('[data-face-body]')) ro.observe(face);
    return () => { ro.disconnect(); };
  }, [inner, floor, key]);
}

/* ── the pieces ───────────────────────────────────────────── */

function Stamp({ outcome, rewound = false }: { outcome: JobOutcome; rewound?: boolean }) {
  const t = useT();
  const stamp = rewound ? REWOUND_STAMP : OUTCOME_STAMP[outcome];
  return (
    <span
      data-testid="ticket-stamp"
      data-rewound={rewound}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        borderRadius: 999,
        padding: '5px 12px',
        background: stamp.paper,
        color: INK,
        ...roleFont('small'),
        fontFamily: font.family,
      }}
    >
      <Icon id={stamp.icon} size={13} />
      {t(stamp.key)}
    </span>
  );
}

/**
 * A figure counting up from zero to what was built, once.
 *
 * ZEROED IN THE SAME FRAME IT RENDERS, so it can only ever count UP: a figure that mounted at its
 * total and then jumped to zero would read as the card correcting itself. Under reduced motion it
 * mounts at the total and no animation is started at all — the number is the carrier, and the run
 * only says that it was earned.
 */
function CountUp({ value }: { value: number }) {
  const reduced = useReducedMotionConfig() === true;
  const [shown, setShown] = useState(() => (reduced ? value : 0));

  useEffect(() => {
    if (reduced) {
      setShown(value);
      return undefined;
    }
    const run = animate(0, value, {
      ...framerMotion('panel.stat.count'),
      onUpdate: (v) => setShown(Math.round(v)),
    });
    return () => { run.stop(); };
  }, [reduced, value]);

  return <>{shown}</>;
}

/** The done receipt's hero row of figures (`.statrow`). */
function StatRow({ job }: { job: JobView }) {
  const t = useT();
  const stats = statsOf(job);
  if (stats.length === 0) return null;
  return (
    <div data-testid="ticket-stats" style={{ display: 'flex', gap: 8, flex: '0 0 auto' }}>
      {stats.map((stat) => (
        <span
          key={stat.key}
          data-testid="ticket-stat"
          style={{
            flex: 1,
            minWidth: 0,
            background: PLATE,
            borderRadius: 12,
            padding: '7px 10px 8px',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <b
            data-testid="ticket-stat-n"
            style={{
              ...roleFont('lead'),
              fontFamily: font.family,
              color: INK,
              fontVariantNumeric: 'tabular-nums',
              lineHeight: 1.2,
            }}
          >
            <CountUp value={stat.n} />
          </b>
          <span
            data-testid="ticket-stat-label"
            style={{ ...roleFont('caption'), fontFamily: font.family, color: colors.brownText, lineHeight: 1.15 }}
          >
            {t(stat.key)}
          </span>
        </span>
      ))}
    </div>
  );
}

/** One row of a step list, in whichever of the three lists is drawing it. */
interface StepRow {
  name: string;
  /** The figure at the row's far end, where the row has one to state. */
  stat?: string;
  /** A stage the run never reached: open, in revert ink, behind a dashed border. */
  unreached?: boolean;
  /** This step's work is off the map again. */
  rewound?: boolean;
  /** A standing rewind confirm would DISCARD this row. It ghosts, so what the press would take is
   *  visible before the press (the artifact's `.step.preview`). */
  preview?: boolean;
  /** The control (or mark) at the row's end. */
  trailing?: ReactNode;
}

const STEP_NO: CSSProperties = {
  width: 20,
  height: 20,
  borderRadius: 999,
  flex: '0 0 auto',
  background: PLATE,
  color: INK,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  ...roleFont('small'),
  fontFamily: font.family,
  fontVariantNumeric: 'tabular-nums',
};

/** The dashed edge an unreached stage stands behind, and the ink it reads in: the house revert
 *  amber, the one colour that already means "the work is not on the map". */
const UNREACHED_EDGE = `1px dashed ${withAlpha(colors.revertAmber, 0.55)}`;

function StepList({ rows, testId }: { rows: readonly StepRow[]; testId: string }) {
  return (
    <div data-testid={`${testId}-list`} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {rows.map((row, i) => (
        <div
          key={`${row.name}-${i}`}
          data-testid={testId}
          data-rewound={row.rewound === true}
          data-unreached={row.unreached === true}
          data-preview={row.preview === true}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            borderRadius: 12,
            padding: '5px 8px',
            opacity: row.rewound === true || row.preview === true ? 0.55 : 1,
            ...(row.unreached === true ? { border: UNREACHED_EDGE } : {}),
          }}
        >
          <span
            data-testid={`${testId}-no`}
            style={{ ...STEP_NO, ...(row.unreached === true ? { color: colors.revertAmber } : {}) }}
          >
            {i + 1}
          </span>
          <span
            data-testid={`${testId}-name`}
            style={{
              ...roleFont('label'),
              fontFamily: font.family,
              color: row.unreached === true ? colors.revertAmber : PLATE_INK,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {row.name}
          </span>
          {row.stat !== undefined && (
            <span
              data-testid={`${testId}-stat`}
              style={{
                marginLeft: 'auto',
                flex: '0 0 auto',
                ...roleFont('small'),
                fontFamily: font.family,
                color: row.unreached === true ? colors.revertAmber : colors.brownText,
              }}
            >
              {row.stat}
            </span>
          )}
          {row.trailing}
        </div>
      ))}
    </div>
  );
}

/** The one square a step row's take-back is worn by (prototype `.hact`). */
const STEP_ACTION: CSSProperties = {
  marginLeft: 'auto',
  width: 26,
  height: 26,
  borderRadius: 9,
  flex: '0 0 auto',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: PLATE,
  color: INK,
  border: 'none',
  cursor: cursors.clickable,
  boxShadow: 'none',
};

/** The same square ASKING: the danger fill, and the room its words need. `width: auto` because the
 *  cost is the label and a 26px box cannot hold it; the height is the square's, so the step's own row
 *  keeps the line it had. */
const STEP_ASKING: CSSProperties = {
  width: 'auto',
  padding: '0 9px',
  gap: 5,
  background: colors.dangerBg,
  color: colors.dangerText,
  ...roleFont('small'),
  fontFamily: font.family,
  whiteSpace: 'nowrap',
};

/**
 * The step a checkpoint goes by. A stage label is MODEL-AUTHORED, so it can arrive blank or as
 * whitespace; a step with no name at all is worse than the generic one, hence the trim before the
 * fall back rather than a plain nullish check.
 */
function stepName(
  job: JobView,
  checkpoint: Checkpoint,
  i: number,
  t: (k: string, p?: Record<string, string | number>) => string,
): string {
  const staged = checkpoint.stageIndex !== undefined
    ? job.plan?.stages[checkpoint.stageIndex]?.label?.trim()
    : undefined;
  if (staged !== undefined && staged !== '') return staged;
  return t(stepKey(checkpoint.label), { n: (checkpoint.stageIndex ?? i) + 1 });
}

/**
 * BACK TO PAST JOBS, AND CLEAR THIS RECORD — the archive foot, worn by every card an opened record
 * can be (this file's `ArchiveCard`, and `AnswerPaper` for a record whose product was words).
 *
 * Back is the one LIT act and stands first; Clear stands last, quiet, the row's width away and
 * behind its own confirm. The confirm opens IN ITS TRIGGER'S SEAT while Back dims where it stands,
 * so the row never reflows around the question (`InlineConfirm`'s own rule).
 */
export function ArchiveFoot({
  orderSeq,
  onBack,
  onClear,
}: {
  orderSeq: number;
  onBack?(): void;
  onClear?(orderSeq: number): void;
}) {
  const t = useT();
  const [asking, setAsking] = useState(false);
  if (!onBack && !onClear) return null;
  return (
    <div data-testid="archive-foot" style={FOOT}>
      {onBack && (
        <span style={asking ? HUSHED : undefined}>
          <Pill variant="active" on="inset" data-testid="archive-back" onClick={onBack}>
            {t('agent3.ticket_back_to_history')}
          </Pill>
        </span>
      )}
      <span style={SPACER} />
      {onClear && (
        <InlineConfirm
          question={t('agent3.ticket_clear_record_q')}
          arm={CONFIRM_ARM}
          open={asking}
          onOpenChange={setAsking}
          onConfirm={() => onClear(orderSeq)}
          onCancel={() => setAsking(false)}
        >
          {(armed) => (
            <Pill variant={armed ? 'danger' : 'quiet'} on="inset" data-testid="archive-clear">
              {t(armed ? 'agent3.ticket_clear_record_q' : 'agent3.ticket_clear_record')}
            </Pill>
          )}
        </InlineConfirm>
      )}
    </div>
  );
}

/* ── the flip family: done, done at the cap, the compact settle ── */

export function FlipTicket({
  job,
  score,
  thumb,
  postcard,
  compact = false,
  archiveStamp,
  rolledBack = false,
  undoDepth,
  onRewind,
  onRewindAll,
  onFileAway,
  onKeepGoing,
}: {
  job: JobView;
  /** The evaluator's reading, where the shell has one. */
  score?: number;
  /** A small rendered map thumbnail, where the shell has one. */
  thumb?: ReactNode;
  /** The built thing as a full-width photograph, for the `done` hero. */
  postcard?: ReactNode;
  /** The two-line settle a standing question compresses the receipt to. */
  compact?: boolean;
  /** What the header seat says on a compact settle: the record's own provenance. */
  archiveStamp?: string;
  /** The job's edits are no longer on the map. */
  rolledBack?: boolean;
  /** The live undo depth, so each take-back's confirm can name what it would pop (`rollback.ts`).
   *  Absent, the confirms keep their unnumbered question rather than stating a size they cannot
   *  measure. */
  undoDepth?: number;
  /** A rewind press hands back the checkpoint it stands on; its `undoIndex` is the watermark. */
  onRewind?: (checkpoint: Checkpoint) => void;
  /** Take the WHOLE job back, from the back face, behind its own confirm. */
  onRewindAll?: () => void;
  /** Put the record away: the card leaves the job zone and the history row is what it becomes. */
  onFileAway?: (orderSeq: number) => void;
  /** The capped card's ink primary: send the continue order. */
  onKeepGoing?: () => void;
}) {
  const t = useT();
  const reduced = useReducedMotionConfig() === true;
  const [flipped, setFlipped] = useState(false);
  const [askingAll, setAskingAll] = useState(false);
  /** The capped card's continue order has been filed. Idempotence lives here rather than in the
   *  caller alone, because the second press lands in the frame before the job's first event does. */
  const [sent, setSent] = useState(false);
  /** Which step row's rewind is standing behind its confirm, by index, or null. Held here rather
   *  than per row so the rows BELOW it can ghost: what the press would discard is shown before the
   *  press. */
  const [askingStep, setAskingStep] = useState<number | null>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const capped = job.outcome === 'capped';
  const stats = statsOf(job);
  const thoughtTotal = thoughtLine(job, t);
  const canRewind = Boolean(onRewind) && !rolledBack;
  /** What taking the WHOLE job back would pop, for the confirm that asks about it. */
  const wholeCost = job.checkpoints[0]
    ? rollbackCost(job.checkpoints[0].undoIndex, undoDepth, job.endUndoIndex)
    : null;
  const wholeCopy = rewindConfirmCopy(t, wholeCost);
  /* A job that recorded no checkpoint has no story to turn to — a read-only order is a legitimate
   * one — so the card keeps its one face and grows no flip control at all, rather than offering a
   * turn onto a heading over blank paper. */
  const hasBack = job.checkpoints.length > 0;
  /* The capped ledger is the PLAN's, not the checkpoint list's: what the card is reporting is which
   * STAGE the cap stopped under. No plan, no ledger — a run that hit the cap without one has nothing
   * to draw as an open row, and its summary says what remains. */
  const ledger = capped ? job.plan?.stages ?? [] : [];
  /**
   * A CAPPED CARD LEADS WITH THE UNREACHED STAGE, and a capped run with no plan has no stage to lead
   * with. The artifact's own capped receipt always has one, so its rule ("no counts, no postcard")
   * reads as the ledger taking their place — and a model that never filed a plan left the card with
   * the flag, the order and two verbs, telling the user the LEAST about 119 objects and a painted
   * cell. Where there is no ledger the built thing is the hero, exactly as a done receipt's is.
   */
  const leadsWithStages = ledger.length > 0;
  /**
   * How much of the plan the CAPPED run got through, or undefined otherwise.
   *
   * THE TAPE IS THE CAPPED HIERARCHY'S OWN. The artifact's `done` card puts the postcard straight
   * under the order line and carries no gauge at all — the fraction only has something to say where
   * the run stopped short of its plan, which is exactly what `capped` means. A finished job earns no
   * bar for finishing.
   */
  const planFraction = capped && job.plan && job.plan.stages.length > 0
    ? Math.max(0, Math.min(1, job.plan.doneCount / job.plan.stages.length))
    : undefined;
  /** What a record whose edits are off the map wears. On the FACES, never on the perspective box. */
  const dimmed: CSSProperties = rolledBack ? { opacity: 0.55 } : {};
  /** What the flip verb and the back face's heading call the story: a rewound card is not offering
   *  to show how a thing was built, it is offering to show what was taken away. */
  const storyKey = rolledBack ? 'agent3.ticket_what_taken_back' : 'agent3.ticket_how_built';

  // Remeasured whenever the card's CONTENT could have changed size. The flip is deliberately absent:
  // turning the card swaps which face is showing, and the box already stands at the taller of them.
  useFaceHeight(
    innerRef,
    compact ? COMPACT_FLOOR : CARD_FLOOR,
    `${job.orderSeq}:${job.checkpoints.length}:${job.summary ?? ''}:${String(rolledBack)}:${String(postcard !== undefined)}`,
  );

  /**
   * A TURNED CARD IS READ FROM ITS OWN TOP.
   *
   * The two faces stand in one box inside a zone that scrolls, so a front face read at an offset
   * turned into a back face opened at that same offset — the reader landed in the middle of a story
   * they had not started, and on a shorter back face that offset was past its foot: an empty plate
   * with two verbs on it. The turn brings the card's own head back under the eye, which is where the
   * heading it turns onto is.
   */
  const flip = (): void => {
    setFlipped((f) => !f);
    const el = innerRef.current;
    if (typeof el?.scrollIntoView === 'function') el.scrollIntoView({ block: 'start' });
  };

  /* Each face carries its own copy of the one toggle, as the prototype does: the front's says where
   * it goes, the back's says how to come home. They are the SAME control, so both report the card's
   * state through `aria-pressed`. */
  const flipButton = (side: 'front' | 'back', small: boolean) => (
    <button
      type="button"
      data-testid={side === 'front' ? 'flip-button' : 'flip-button-back'}
      aria-pressed={flipped}
      onClick={flip}
      style={{
        ...windowPill('quiet', false, 'inset'),
        ...(small ? { padding: '5px 10px', ...roleFont('small') } : {}),
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        boxShadow: 'none',
      }}
    >
      <Icon id="pw-rotate" size={13} />
      {t(side === 'back' ? 'agent3.ticket_back' : storyKey)}
    </button>
  );

  const fileAway = onFileAway && (
    <Pill variant="quiet" on="inset" data-testid="ticket-file-away" onClick={() => onFileAway(job.orderSeq)}>
      {t('agent3.action_file_away')}
    </Pill>
  );

  /**
   * THE HEADER SEAT, and which of three facts sits in it.
   *
   * The capped card's READ VERB rides here because the stages already stand on its front and the
   * foot belongs to the decision; a done receipt wears its score there; a compact settle wears its
   * provenance. At most one, always.
   */
  const headSeat = capped && hasBack
    ? <span style={{ marginLeft: 'auto' }}>{flipButton('front', true)}</span>
    : !capped && !rolledBack && score !== undefined
      ? (
        <span
          title={t('agent3.ticket_score')}
          style={{
            marginLeft: 'auto',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            background: PLATE,
            borderRadius: 999,
            padding: '5px 11px',
            color: INK,
            ...roleFont('small'),
            fontFamily: font.family,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          <Icon id="pw-evaluate" size={13} />
          <span data-testid="ticket-score">{score}</span>
        </span>
      )
      : compact && archiveStamp !== undefined
        ? <span data-testid="ticket-head-stamp" style={HEAD_STAMP}>{archiveStamp}</span>
        : null;

  return (
    <div
      data-testid="flip-ticket"
      data-face={flipped ? 'back' : 'front'}
      data-shape={capped ? 'capped' : compact ? 'compact' : 'full'}
      /* NO OPACITY ON THIS BOX: it is the `perspective` element, and a grouping property here
         flattens the 3D context the faces' `backface-visibility` depends on. The dim goes on the
         faces (see `FACE`).

         THE PROJECTION'S ORIGIN IS THE CARD'S BOTTOM EDGE, because the card turns inside a zone
         that scrolls: a perspective projection magnifies the rotating card's near half past its own
         box, the scroller counts that projected geometry as scrollable overflow, and only DOWNWARD
         overflow is scrollable (above the scroll origin it is unreachable and counts for nothing).
         With the origin on the bottom edge every point of both faces projects away from that line,
         upward, so no angle of the turn reaches below the box — measured live, the centred origin
         grew the job zone's scrollHeight 390→424 mid-turn and a transient scrollbar took its 11px
         of the rows' width for the length of the flip. */
      style={{ perspective: 1100, perspectiveOrigin: '50% 100%', flex: '0 0 auto' }}
    >
      <div
        ref={innerRef}
        data-testid="flip-inner"
        data-reduced={reduced}
        style={{
          position: 'relative',
          minHeight: compact ? COMPACT_FLOOR : CARD_FLOOR,
          transformStyle: 'preserve-3d',
          transform: flipped ? 'rotateY(180deg)' : undefined,
          transition: cssMotion('panel.ticket.flip', ['transform'], reduced),
        }}
      >
        <div data-testid="flip-face-front" data-face-body aria-hidden={flipped} style={{ ...FACE, ...dimmed }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {job.outcome && <Stamp outcome={job.outcome} rewound={rolledBack} />}
            {headSeat}
          </div>

          <div data-testid="ticket-order" style={HEADLINE}>{job.orderText}</div>

          {planFraction !== undefined && <TapeBar mode={{ fraction: planFraction }} />}

          {/* THE CAPPED FRONT LEDGER: a tick on every stage that finished, the first unreached one
              standing open. Said once, at the rung it earns. */}
          {ledger.length > 0 && (
            <StepList
              testId="ticket-ledger"
              rows={ledger.map((stage, i) => {
                const done = i < (job.plan?.doneCount ?? 0);
                const figure = done ? stageFigure(job, i, t) : undefined;
                return {
                  name: stage.label,
                  ...(done
                    ? {
                      ...(figure !== undefined ? { stat: figure } : {}),
                      trailing: <span data-testid="ticket-ledger-tick" style={{ marginLeft: 'auto', flex: '0 0 auto', color: INK, display: 'inline-flex' }}><Icon id="pw-check" size={13} /></span>,
                    }
                    : { unreached: true, stat: t('agent3.ticket_stage_not_reached') }),
                };
              })}
            />
          )}

          {!leadsWithStages && !compact && !rolledBack && postcard !== undefined && (
            <div
              data-testid="ticket-postcard"
              style={{
                display: 'block',
                width: '100%',
                height: POSTCARD.height,
                borderRadius: 12,
                overflow: 'hidden',
                border: edge,
                flex: '0 0 auto',
              }}
            >
              {postcard}
            </div>
          )}

          {/* The small thumbnail survives for a caller that has a picture but no room for the hero
              (nothing draws one today; the slot is the gate card's own shape). */}
          {thumb !== undefined && (
            <div
              data-testid="ticket-thumb"
              style={{ flex: '0 0 auto', width: 104, height: 78, borderRadius: 12, border: edge, overflow: 'hidden' }}
            >
              {thumb}
            </div>
          )}

          {!leadsWithStages && !compact && !rolledBack && stats.length > 0 && <StatRow job={job} />}

          {thoughtTotal !== null && (
            <div data-testid="ticket-thoughts" style={THOUGHT_TOTAL}>{thoughtTotal}</div>
          )}

          {/* A REWOUND CARD SAYS WHAT IS TRUE OF THE MAP NOW, in the panel's own voice: the model's
              closing words described a thing that is no longer there. */}
          {rolledBack ? (
            <div data-testid="ticket-summary" style={ON_MAP}>{t('agent3.ticket_rewound_sum')}</div>
          ) : job.summary ? (
            <ModelProse testId="ticket-summary" text={job.summary} style={compact ? ON_MAP : SUMMARY} />
          ) : null}

          {/* THE FOOT. The capped decision owns it (one primary, one quiet no); a done receipt
              carries the read verb and the settle; a compact settle carries the read verb alone,
              because answering the question standing under it is what files the record. */}
          {capped ? (
            <div data-testid="ticket-actions" style={FOOT}>
              {/* KEEP GOING FILES THE SAME ORDER AGAIN, and there is only one of it to file. A
                  second press reached `runner.send` with a job already in flight, where it fell
                  through to the steer route and queued the user's own order text as a note to the
                  model. The button stands down the moment it has been pressed. */}
              {onKeepGoing && (
                <AskPrimary
                  testId="ticket-keep-going"
                  disabled={sent}
                  onClick={() => { setSent(true); onKeepGoing(); }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                    <Icon id="pw-resume" size={15} />
                    {t('agent3.ticket_keep_going')}
                  </span>
                </AskPrimary>
              )}
              {fileAway}
            </div>
          ) : (
            (hasBack || fileAway) && (
              <div style={FOOT}>
                {hasBack && flipButton('front', compact)}
                {!compact && fileAway}
              </div>
            )
          )}
        </div>

        {hasBack && (
        <div
          data-testid="flip-face-back"
          data-face-body
          aria-hidden={!flipped}
          style={{ ...FACE, ...dimmed, transform: 'rotateY(180deg)' }}
        >
          <div data-testid="ticket-back-head" style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ ...roleFont('action'), fontFamily: font.family, color: INK }}>
              {t(storyKey)}
            </span>
            {/* A back face with no op behind its checkpoint has nothing to count, and "0 steps" is
                the same sentence about nothing the kept-edits fact below already refuses. */}
            {job.ops.length > 0 && (
              <span data-testid="ticket-back-stamp" style={HEAD_STAMP}>
                {t(job.ops.length === 1 ? 'agent3.steps_count_one' : 'agent3.steps_count', { n: job.ops.length })}
              </span>
            )}
          </div>

          {/* A PER-STEP REWIND TAKES EVERY LATER STEP WITH IT, so the press asks first and the rows
              it would discard ghost while the question stands (the artifact's own `.step.preview`).
              The confirm stands in the row's own trailing seat and takes the stat's place, so the
              list never reflows around the question. */}
          <StepList
            testId="ticket-step"
            rows={job.checkpoints.map((checkpoint, i) => {
              const asking = askingStep === i;
              const stepCopy = rewindConfirmCopy(
                t, rollbackCost(checkpoint.undoIndex, undoDepth, job.endUndoIndex),
              );
              const offers = canRewind && rollbackReaches(checkpoint.undoIndex, undoDepth);
              return {
                name: stepName(job, checkpoint, i, t),
                ...(askingStep !== null && i >= askingStep && !rolledBack ? { preview: true } : {}),
                ...(rolledBack ? { rewound: true, stat: t('agent3.ticket_step_rewound') } : {}),
                ...(offers
                  ? {
                    trailing: (
                      <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 5, alignItems: 'center' }}>
                        <InlineConfirm
                          question={stepCopy.question}
                          arm={CONFIRM_ARM}
                          open={asking}
                          onOpenChange={(open) => setAskingStep(open ? i : null)}
                          onConfirm={() => { setAskingStep(null); onRewind?.(checkpoint); }}
                          onCancel={() => setAskingStep(null)}
                        >
                          {/* THE SQUARE GAINS ITS WORDS WHEN IT IS ASKING, and the words are the
                              COST: a glyph cannot name what a take-back takes, so the armed state is
                              where "Rewind 4 steps?" is said. */}
                          {(armed) => (
                            <button
                              type="button"
                              data-testid="ticket-step-rewind"
                              title={t('agent3.ticket_rewind')}
                              aria-label={armed ? stepCopy.confirmLabel : t('agent3.ticket_rewind')}
                              style={armed
                                ? { ...STEP_ACTION, ...STEP_ASKING, marginLeft: 0 }
                                : { ...STEP_ACTION, marginLeft: 0 }}
                            >
                              <Icon id="pw-rewind" size={13} />
                              {armed ? <span>{stepCopy.confirmLabel}</span> : null}
                            </button>
                          )}
                        </InlineConfirm>
                      </span>
                    ),
                  }
                  : {}),
              };
            })}
          />

          {/* EVERY TAKE-BACK LIVES HERE, the whole-job one included: it stands at the row's far end
              behind its confirm, and the way home dims where it is rather than moving. */}
          <div style={FOOT}>
            <span style={askingAll ? HUSHED : undefined}>{flipButton('back', compact)}</span>
            <span style={SPACER} />
            {canRewind && onRewindAll && (
              <InlineConfirm
                question={wholeCopy.question}
                arm={CONFIRM_ARM}
                open={askingAll}
                onOpenChange={setAskingAll}
                onConfirm={onRewindAll}
                onCancel={() => setAskingAll(false)}
              >
                {(armed) => (
                  <Pill variant={armed ? 'danger' : 'quiet'} on="inset" data-testid="ticket-rewind-all">
                    <Icon id="pw-undo-arrow" size={12} />
                    {armed ? wholeCopy.confirmLabel : t('agent3.ticket_rewind_all')}
                  </Pill>
                )}
              </InlineConfirm>
            )}
          </div>
        </div>
        )}
      </div>
    </div>
  );
}

/* ── the stop card: one face, two answers ─────────────────── */

/**
 * A job the user stopped (`aborted`), as the decision it always was.
 *
 * NO FLIP AND NO RECEIPT. There is no built thing to lead with and no story worth turning the card
 * over for: what the user needs is the order that was stopped, whether their map kept anything, and
 * the two answers to that. The kept-edits fact takes the HEADLINE rung because it is the thing they
 * will act on; the Ctrl+Z note is the summary, since it says what the other route is rather than
 * offering a second control for it.
 */
export function StopCard({
  job,
  clock,
  rolledBack = false,
  undoDepth,
  unanswered = false,
  onRewindAll,
  onFileAway,
}: {
  job: JobView;
  /** How long the job had run when it was stopped, as the dock reads it. */
  clock?: string;
  /** The job ended with a question of its own standing. The ASK card goes with the job (the panel
   *  draws only the running job's), so without this line the record of what was asked is nowhere: a
   *  key revoked mid-approval left a user who re-keyed with a desk that never mentioned it. */
  unanswered?: boolean;
  /** The job's edits are already off the map, so there is nothing left to take back. */
  rolledBack?: boolean;
  /** The live undo depth, so the confirm can name what the take-back would pop (`rollback.ts`). */
  undoDepth?: number;
  onRewindAll?: () => void;
  onFileAway?: (orderSeq: number) => void;
}) {
  const t = useT();
  const [asking, setAsking] = useState(false);
  const edits = editCount(job);
  const canRewind = Boolean(onRewindAll) && !rolledBack && job.checkpoints.length > 0;
  const copy = rewindConfirmCopy(t, job.checkpoints[0]
    ? rollbackCost(job.checkpoints[0].undoIndex, undoDepth, job.endUndoIndex)
    : null);

  return (
    <div data-testid="stop-card" style={{ ...TICKET, opacity: rolledBack ? 0.55 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Stamp outcome="aborted" rewound={rolledBack} />
        {clock !== undefined && <span data-testid="stop-clock" style={HEAD_STAMP}>{clock}</span>}
      </div>

      <div data-testid="ticket-order" style={HEADLINE}>{job.orderText}</div>

      {/* THE KEPT-EDITS FACT IS THE WHOLE REASON THIS CARD EXISTS, so it goes the moment it stops
          being true: a rewound stop card stating "9 edits are on your map" at the headline rung, with
          no way left to take them back, is the card lying about the one thing it is for. ZERO IS
          SUPPRESSED for the same reason — a stop that landed before anything was written has no
          kept-edits fact, and "0 edits are on your map" is a sentence about nothing. */}
      {!rolledBack && edits > 0 && (
        <div data-testid="stop-fact" style={HEADLINE}>
          {t(edits === 1 ? 'agent3.ticket_edits_kept_one' : 'agent3.ticket_edits_kept', { n: edits })}
        </div>
      )}

      {rolledBack && (
        <div data-testid="stop-fact" style={HEADLINE}>{t('agent3.ticket_rewound_sum')}</div>
      )}

      {unanswered && (
        <div data-testid="stop-lapsed" style={SUMMARY}>{t('agent3.ticket_question_lapsed')}</div>
      )}

      {canRewind && <div data-testid="stop-note" style={SUMMARY}>{t('agent3.ticket_ctrlz_note')}</div>}

      <div style={FOOT}>
        {canRewind && onRewindAll && (
          <InlineConfirm
            question={copy.question}
            arm={CONFIRM_ARM}
            open={asking}
            onOpenChange={setAsking}
            onConfirm={onRewindAll}
            onCancel={() => setAsking(false)}
          >
            {(armed) => (
              <Pill variant={armed ? 'danger' : 'quiet'} on="inset" data-testid="stop-rewind">
                <Icon id="pw-undo-arrow" size={13} />
                {armed ? copy.confirmLabel : t('agent3.ticket_rewind_all')}
              </Pill>
            )}
          </InlineConfirm>
        )}
        <span style={SPACER} />
        {onFileAway && (
          <span style={asking ? HUSHED : undefined}>
            <Pill variant="quiet" on="inset" data-testid="ticket-file-away" onClick={() => onFileAway(job.orderSeq)}>
              {t('agent3.action_file_away')}
            </Pill>
          </span>
        )}
      </div>
    </div>
  );
}

/* ── the archive card: a past record, opened ──────────────── */

/**
 * A record from the past-jobs list, opened as its own reading.
 *
 * ARCHIVE DRESS. The provenance stamp sits in the seat where a done receipt wears its score; the
 * steps stand INLINE, because inspection wants the story and a flip that hid it would be friction
 * pointed the wrong way; and there are no counts, no postcard and no celebration, since none of that
 * is news about a job that finished some time ago.
 *
 * AND NO PER-STEP REWIND. Later jobs sit on top of a mid-job state, so rewinding INTO one would
 * take their work with it silently. The whole-job roll back keeps its seat on the history row, where
 * the map's own order is visible.
 */
/**
 * THE ORDER THAT STOPPED, standing under an incident's banner (artifact `error.overflow` /
 * `error.retries-exhausted`).
 *
 * The banner and this card are NOT the same trouble twice, which is the reading that left the zone
 * empty behind every incident: the banner names the CLASS and the repair ("This job has grown past
 * what I can hold" + New order / Export it), and the card names WHICH ORDER and HOW FAR IT GOT. With
 * only the banner, the panel answered "too big for me" over ~112px of empty cream and the user could
 * not see which of their orders it was about.
 *
 * IT IS A STALLED TICKET, not a receipt: the tape band stands exactly where the work stopped and is
 * dimmed (`TapeBar held`), the step count says how many calls the job made and that none is drawn
 * below it, and the side stamps ride along because a compaction or a damper is part of how the job
 * came to end this way. No verbs of its own — the banner holds both, and the same pair twice is the
 * shape this card was withheld to avoid.
 */
export function IncidentCard({ job, stamps }: {
  job: JobView;
  /** Icon + already-translated line per side stamp, resolved by the caller (`JobTicket` owns that
   *  table, and importing it here would close a cycle). */
  stamps?: readonly { key: string; icon: IconId; text: string }[];
}) {
  const total = job.plan ? job.plan.stages.length : 0;
  return (
    <div data-testid="incident-card" style={TICKET}>
      <div data-testid="ticket-order" style={HEADLINE}>{job.orderText}</div>
      <TapeBar mode={total > 0 ? { fraction: job.plan!.doneCount / total } : 'indeterminate'} held />
      {job.ops.length > 0 && <CountPill total={job.ops.length} shown={0} />}
      {(stamps ?? []).map((s) => (
        <StampLine key={s.key} icon={s.icon}>{s.text}</StampLine>
      ))}
    </div>
  );
}

export function ArchiveCard({
  job,
  stamp,
  rolledBack = false,
  onBack,
  onClear,
}: {
  job: JobView;
  /** When this record was made, in the caller's own words. */
  stamp?: string;
  rolledBack?: boolean;
  onBack?(): void;
  onClear?(orderSeq: number): void;
}) {
  const t = useT();
  return (
    <div data-testid="archive-card" style={{ ...TICKET, opacity: rolledBack ? 0.55 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {job.outcome && <Stamp outcome={job.outcome} rewound={rolledBack} />}
        {stamp !== undefined && <span data-testid="archive-stamp" style={HEAD_STAMP}>{stamp}</span>}
      </div>

      <div data-testid="ticket-order" style={HEADLINE}>{job.orderText}</div>

      {job.summary && <ModelProse testId="ticket-summary" text={job.summary} style={ON_MAP} />}

      {job.checkpoints.length > 0 && (
        <StepList
          testId="archive-step"
          rows={job.checkpoints.map((checkpoint, i) => ({
            name: stepName(job, checkpoint, i, t),
            ...(rolledBack ? { rewound: true, stat: t('agent3.ticket_step_rewound') } : {}),
          }))}
        />
      )}

      <ArchiveFoot
        orderSeq={job.orderSeq}
        {...(onBack ? { onBack } : {})}
        {...(onClear ? { onClear } : {})}
      />
    </div>
  );
}
