/*
 * HistoryStrip.tsx — the past jobs: one quiet inset row in the record, and a FLOATING list of lines
 * that opens under it (normative prototype `.hrow` + `.ddCard.hist`, the `idle.history` state).
 *
 * THE LIST FLOATS, AND THE PANEL NEVER MAKES ROOM FOR IT. Every dropdown in this panel
 * is the house one — `ui/primitives/FloatMenu`, a body-level card anchored to its row — so opening
 * this list neither grows the job zone nor moves the composer under the hand travelling toward it.
 * It is also what lets the job zone waive its 72px floor for a rest state whose whole record is this
 * one closed row: the row is all there is in the zone, open or shut.
 *
 * IT TAKES THE CARD, NOT THE ITEM MODEL. A `FloatMenu` row is one `menuitem` button, and these rows
 * carry a SECOND control (roll this job back) that cannot nest inside one — so the rows are built
 * here and handed over as the card's `body`, which is what that escape hatch exists for.
 *
 * THE LIST IS GROUPED, AND THE GROUPS ARE THE ARTIFACT'S OWN (`histListParts`): the open map's jobs
 * under day headers — Today, Yesterday, Earlier — and then, under a header of their own, the jobs
 * built somewhere else. A day is read off the record's `orderAt` against the caller's `now`, so the
 * grouping is the record's own date rather than a position in the list.
 *
 * A JOB'S OWN GLYPH AND ITS EDIT COUNT ARE READ OFF ITS OPS, never passed in: the glyph is the last
 * writing tool the job ran (`iconForTool`, the same table `OpRow` draws from), and the count is the
 * cells plus objects its tool results reported. A job that only ever read the map shows a zero
 * count, which is the honest reading of a job that changed nothing.
 *
 * "ROLLED BACK" IS PRESENTATIONAL, and this component is told rather than deciding: the shell owns
 * the undo watermark and hands down the set of order seqs whose edits are no longer on the map.
 * Such a row dims, states `rolled back` where its count would be, and drops its roll-back action —
 * there is nothing left to take back.
 *
 * AND SO ARE THE TWO ROLLBACK REFUSALS (`otherMap`, `unknownMap`). A ROLLBACK MAY NOT AIM AT A MAP
 * THAT IS NOT STANDING: undoing a job whose edits are on another map would pop this map's undo stack
 * instead, so such a row stands in its own group, dimmed, OPEN to read and offering no roll back at
 * all. The refusal is the absent control plus the notice the panel stands over the list, rather than
 * a press that fails — a control that refuses must not answer the pointer. The SECOND group is the
 * records that name no map at all (a log written before the order carried one): unverifiable rather
 * than elsewhere, refused for the same reason and said in its own words, because a record that may
 * well be this map's must not be told it is not.
 *
 * THE WHOLE ROW OPENS THE TICKET, as the prototype's own row does (`.hitem` IS the button there):
 * the open action is a real button STRETCHED over the row (`position: absolute; inset: 0`), which a
 * nested button could not be, so the row's own content is pointer-deaf and paints above it while
 * every press on the row body lands on the button underneath. The open-the-ticket square at the
 * right is therefore DRAWING — the control it depicts is the row. Roll back is the one press that
 * must not be the row's, so it is a button of its own, layered over the stretch and taking its own
 * clicks. Tab order is open then roll back, which puts the ordinary answer first and the
 * destructive one second. NO ANCESTOR OF THE STRETCH MAY CARRY A TRANSFORM: it would become the
 * containing block and the button would cover the wrong box.
 *
 * The prototype reveals a row's actions on hover (`.hitem:hover .acts`), which is a stylesheet rule
 * this inline-styled component has no equivalent for; pointer/focus state stands in. Both the count
 * and the actions live in ONE grid cell, stacked, so the reveal cannot move the row: the cell is as
 * wide as the wider of the two whichever one is showing, and the roll-back button stays in the DOM
 * (transparent, pointer-deaf) so a keyboard tab reaches it and reveals it by focus alone.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { motion } from 'framer-motion';
import { Icon, type IconId } from './icons';
import { amplitude, CONFIRM_ARM, framerMotion } from './motion';
import { iconForTool } from './tool-meta';
import { rewindConfirmCopy, rollbackCost, rollbackReaches } from './rollback';
import { FloatMenu } from '../primitives/FloatMenu';
import { HUSHED, InlineConfirm } from '../primitives/InlineConfirm';
import { useFrameZoom } from '../shell/use-frame-zoom';
import { INK, PLATE, PLATE_INK } from '../design/tokens';
import { colors, cursors, font, UNAVAILABLE } from '../design/styles';
import { roleFont } from '../design/text-weight';
import { useT } from '../../i18n/context';
import type { JobView } from '../../agent/core/project-view';

/** How far a row drops in from, on the fold's own clock. The fold declares no travel of its own (it
 *  is a rotation and a list appearing), so the rows borrow the op row's rise — one arrival distance
 *  for the panel's lists rather than a second number nobody can find. */
const FOLD_RISE = amplitude('panel.op.enter') ?? 0;

/** A job with no tool call to its name (an order the model only answered in words) still needs a
 *  mark; the history glyph is the one that claims no particular kind of work. */
const NO_WORK_ICON: IconId = 'pw-history';

/**
 * The glyph of the last WRITING tool the job ran, which is the work a reader remembers it by — a job
 * that laid a road and read the map twice afterwards is still the road job.
 *
 * AN ANSWER IS NOT REMEMBERED BY THE TOOL IT READ WITH. A job whose product was words wears the
 * reply bubble and a silent giveup the record mark, because "it looked at the map" is machinery
 * rather than the thing that happened; the boundary is the projection's `kind` (see `AnswerPaper`).
 */
function glyphFor(job: JobView): IconId {
  if (job.kind === 'answer') return 'pw-reply-bubble';
  if (job.kind === 'quiet') return NO_WORK_ICON;
  const writes = job.ops.filter((op) => !op.isRead);
  const pool = writes.length > 0 ? writes : job.ops;
  const last = pool[pool.length - 1];
  return last ? iconForTool(last.name) : NO_WORK_ICON;
}

/** Cells painted plus objects placed, as the job's tool results reported them. */
function editsIn(job: JobView): number {
  return job.ops.reduce((sum, op) => sum + (op.detail?.cells ?? 0) + (op.detail?.objects ?? 0), 0);
}

/**
 * What a row states where a build states its edit count: an answer says what it WAS, since "0 edits"
 * reports a build that went nowhere and this job never set out to edit anything.
 *
 * AND `kind` IS A DONE-JOB READING (`project-view.ts:settle` sets it only for `outcome: 'done'`), so
 * an aborted, capped or errored run had no kind to be caught by and fell straight through to the
 * count: every stop, every turn cap and every fault read "0 edits" for a run that was cut off before
 * it could make any. So the last test is the COUNT rather than the kind — a row with nothing to count
 * says so, whatever ended it, the finished build whose only write the user declined included. A run
 * that DID leave edits keeps its count either way: that figure is what a take-back pops.
 */
function statKeyFor(job: JobView): string | null {
  if (job.kind === 'answer') return 'agent3.history_answered';
  if (job.kind === 'quiet') return 'agent3.history_ended';
  if (editsIn(job) === 0) return 'agent3.dock_no_edits';
  return null;
}

/* ── the day the record was made ──────────────────────────── */

/** The three days the list groups by, and the header each wears. */
export type Day = 'today' | 'yesterday' | 'earlier';

/** Why a record may not be rolled back from here, which is also which group it stands in. The two
 *  are different facts and the list says them separately: one is PROVEN elsewhere, the other is
 *  merely unproven, and a record that may well be this map's must not be told it is not. */
export type Blocked = 'other-map' | 'unknown-map';

const BLOCKED_KEY: Record<Blocked, string> = {
  'other-map': 'agent3.history_other_map',
  'unknown-map': 'agent3.history_unknown_map',
};

const DAY_KEY: Record<Day, string> = {
  today: 'agent3.history_day_today',
  yesterday: 'agent3.history_day_yesterday',
  earlier: 'agent3.history_day_earlier',
};

/** Midnight before `ms`, in the reader's own timezone. A day boundary is LOCAL: a job filed at 23:50
 *  is yesterday's the moment the clock passes midnight, wherever the reader is, and a UTC reading
 *  would put a whole evening's work under the wrong header for most of the world. */
function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const DAY_MS = 86_400_000;

/** Which day header a record stands under. */
export function dayOf(at: number, now: number): Day {
  const midnight = startOfDay(now);
  if (at >= midnight) return 'today';
  if (at >= midnight - DAY_MS) return 'yesterday';
  return 'earlier';
}

/** The 26px action square (prototype `.hact`), worn by a real button and by the open-the-ticket
 *  glyph alike — that glyph is DRAWING, the control under it is the row-wide button below. */
const ACTION_SQUARE: CSSProperties = {
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
  boxShadow: 'none',
};

/** The same square ASKING: the danger fill, and the room the cost needs. `width: auto` because the
 *  words are the cost and a 26px box cannot hold them; the height is the square's, so the row keeps
 *  the line it had. */
const SQUARE_ASKING: CSSProperties = {
  width: 'auto',
  padding: '0 9px',
  gap: 5,
  background: colors.dangerBg,
  color: colors.dangerText,
  ...roleFont('small'),
  fontFamily: font.family,
  whiteSpace: 'nowrap',
};

/** A group's header (prototype `.dhead`): the quietest line in the card, since it names where the
 *  rows are rather than saying anything about them. */
const DAY_HEAD: CSSProperties = {
  ...roleFont('small'),
  fontFamily: font.family,
  color: colors.brownText,
  padding: '6px 10px 2px',
  flex: '0 0 auto',
};

function HistoryRow({
  job,
  rolledBack,
  blocked,
  undoDepth,
  busy = false,
  asking,
  onAsk,
  onOpen,
  onRollBack,
}: {
  job: JobView;
  rolledBack: boolean;
  /** Why this job may not be rolled back here, or undefined where it may (see the file header). */
  blocked?: Blocked;
  /** The live undo depth, so the confirm can name what the press would pop. */
  undoDepth?: number;
  /** A job is in flight, so neither of this row's presses may land (see the strip's header). Both
   *  controls stand DISABLED with the reason readable rather than vanishing. */
  busy?: boolean;
  /** This row's roll back is standing behind its confirm. Held by the LIST, so a second row's
   *  question closes the first: two open confirms would be two aimed destructive presses. */
  asking: boolean;
  onAsk: (open: boolean) => void;
  onOpen?: (job: JobView) => void;
  onRollBack?: (job: JobView) => void;
}) {
  const t = useT();
  const [revealed, setRevealed] = useState(false);
  const watermark = job.checkpoints[0]?.undoIndex;
  const rollable = onRollBack !== undefined && !rolledBack && blocked === undefined
    && watermark !== undefined && rollbackReaches(watermark, undoDepth);
  const actions = (onOpen ? 1 : 0) + (rollable ? 1 : 0);
  const dim = rolledBack || blocked !== undefined;
  const copy = rewindConfirmCopy(
    t, watermark === undefined ? null : rollbackCost(watermark, undoDepth, job.endUndoIndex),
  );
  const busyWhy = t('agent3.rollback_busy');
  /** What a control that is standing but cannot answer wears: dimmed where it is, deaf, and saying
   *  why. Never removed, or the row would reshape under the hand reaching for it. */
  const held: CSSProperties = busy
    ? { opacity: UNAVAILABLE, cursor: cursors.blocked }
    : { cursor: cursors.clickable };

  return (
    <div
      data-testid="history-item"
      data-order-seq={job.orderSeq}
      data-rolled-back={rolledBack}
      data-other-map={blocked === 'other-map'}
      data-unknown-map={blocked === 'unknown-map'}
      data-preview={asking}
      onPointerEnter={() => setRevealed(true)}
      onPointerLeave={() => setRevealed(false)}
      onFocus={() => setRevealed(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setRevealed(false);
      }}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        borderRadius: 12,
        padding: '8px 10px',
        background: asking ? colors.dangerBg : revealed ? PLATE : 'transparent',
        opacity: dim ? 0.55 : 1,
      }}
    >
      {onOpen && (
        <button
          type="button"
          data-testid="history-open"
          aria-label={busy ? `${t('agent3.history_open_ticket')} (${busyWhy})` : t('agent3.history_open_ticket')}
          title={busy ? busyWhy : t('agent3.history_open_ticket')}
          disabled={asking || busy}
          {...(busy ? { 'aria-disabled': true } : {})}
          onClick={() => onOpen(job)}
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 12,
            background: 'transparent',
            border: 'none',
            padding: 0,
            cursor: busy ? cursors.blocked : cursors.clickable,
            boxShadow: 'none',
          }}
        />
      )}
      <span style={{ position: 'relative', flex: '0 0 auto', color: INK, display: 'inline-flex', pointerEvents: 'none' }}>
        <Icon id={glyphFor(job)} size={15} />
      </span>
      <span
        data-testid="history-item-name"
        style={{
          position: 'relative',
          ...roleFont('label'),
          fontFamily: font.family,
          color: PLATE_INK,
          flex: '1 1 auto',
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
        }}
      >
        {job.orderText}
      </span>
      <span
        style={{
          position: 'relative',
          flex: '0 0 auto',
          display: 'grid',
          justifyItems: 'end',
          alignItems: 'center',
          pointerEvents: 'none',
        }}
      >
        <span
          data-testid="history-item-stat"
          style={{
            gridArea: '1 / 1',
            ...roleFont('small'),
            fontFamily: font.family,
            color: colors.brownText,
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap',
            opacity: asking || (revealed && actions > 0) ? 0 : 1,
          }}
        >
          {rolledBack
            ? t('agent3.history_rolled_back')
            : statKeyFor(job) !== null
              ? t(statKeyFor(job)!)
              : t(editsIn(job) === 1 ? 'agent3.history_edits_one' : 'agent3.history_edits', { n: editsIn(job) })}
        </span>
        {actions > 0 && (
          <span
            data-testid="history-item-acts"
            style={{
              gridArea: '1 / 1',
              display: 'flex',
              gap: 5,
              opacity: revealed || asking ? 1 : 0,
              pointerEvents: revealed || asking ? 'auto' : 'none',
            }}
          >
            {/* THE ONE DESTRUCTIVE PRESS ON A ROW, so it asks first and NAMES THE SIZE — in the
                square's own words, since a glyph cannot say what a roll-back takes. The count beside
                it stands down while the question is up, exactly as the artifact's row does. */}
            {rollable && (
              <InlineConfirm
                question={copy.question}
                arm={CONFIRM_ARM}
                open={asking}
                onOpenChange={onAsk}
                onConfirm={() => { onAsk(false); onRollBack?.(job); }}
                onCancel={() => onAsk(false)}
              >
                {(armed) => (
                  <button
                    type="button"
                    data-testid="history-roll-back"
                    aria-label={armed
                      ? copy.confirmLabel
                      : busy ? `${t('agent3.history_roll_back')} (${busyWhy})` : t('agent3.history_roll_back')}
                    title={armed ? copy.confirmLabel : busy ? busyWhy : t('agent3.history_roll_back')}
                    disabled={busy}
                    {...(busy ? { 'aria-disabled': true } : {})}
                    style={armed ? { ...ACTION_SQUARE, ...held, ...SQUARE_ASKING } : { ...ACTION_SQUARE, ...held }}
                  >
                    <Icon id="pw-undo-arrow" size={13} />
                    {armed ? <span>{copy.confirmLabel}</span> : null}
                  </button>
                )}
              </InlineConfirm>
            )}
            {/* The open-the-ticket square is DRAWING (the control it depicts is the row itself), and
                it is HUSHED rather than dropped while the question stands: a square leaving the
                cluster is the row's actions changing width under the answer being aimed at. */}
            {onOpen && (
              <span
                data-testid="history-open-mark"
                aria-hidden="true"
                style={asking ? { ...ACTION_SQUARE, ...HUSHED } : ACTION_SQUARE}
              >
                <Icon id="pw-rotate" size={13} />
              </span>
            )}
          </span>
        )}
      </span>
    </div>
  );
}

export function HistoryStrip({
  jobs,
  rolledBack,
  otherMap,
  unknownMap,
  undoDepth,
  busy = false,
  now,
  open: openProp,
  onOpenChange,
  onOpen,
  onRollBack,
}: {
  /** Settled jobs, oldest first, exactly as `PanelView.jobs` carries them. */
  jobs: readonly JobView[];
  /** The order seqs whose edits the shell has taken back off the map. */
  rolledBack?: ReadonlySet<number>;
  /** The order seqs whose edits are on a map that is not the one open. */
  otherMap?: ReadonlySet<number>;
  /** The order seqs whose record does not say which map it was built on, so no roll back from here
   *  can be proven to aim at the map that is standing. */
  unknownMap?: ReadonlySet<number>;
  /** The live undo depth, so a row's confirm can name what its press would pop (`rollback.ts`). */
  undoDepth?: number;
  /** A job is in flight. Every row's presses stand DISABLED and say why. */
  busy?: boolean;
  /** The clock the day headers are read against. Defaults to now, and is passed in by a test or a
   *  fixture that needs the grouping to be the same picture every run. */
  now?: number;
  /**
   * Whether the list stands open, for a caller that OUTLIVES this component: `PanelShell` unmounts
   * the strip while a record it opened covers the job zone, so the strip's own `useState` forgets it
   * was open the moment the press that opened the record lands. Uncontrolled (the strip keeps the
   * fact itself) where the caller has no reason to reach past the press that toggles it.
   */
  open?: boolean;
  /** Told every time the open flag would change, whether or not the caller is driving it. */
  onOpenChange?: (open: boolean) => void;
  onOpen?: (job: JobView) => void;
  onRollBack?: (job: JobView) => void;
}) {
  const t = useT();
  const zoom = useFrameZoom();
  const [internalOpen, setInternalOpen] = useState(false);
  /** Which row's roll back is standing behind its confirm, by order seq. ONE at a time, and it is
   *  the LIST that holds it: a question left standing on a row the user has walked away from is a
   *  destructive press still aimed, so closing the list, or asking on another row, drops it. */
  const [askingSeq, setAskingSeq] = useState<number | null>(null);
  const open = openProp ?? internalOpen;
  const setOpen = (next: boolean) => {
    if (!next) setAskingSeq(null);
    onOpenChange?.(next);
    if (openProp === undefined) setInternalOpen(next);
  };
  // A record that has left the list (cleared, or a session replaced) takes its standing question
  // with it: the seq would otherwise re-open the question on whatever row inherits the number.
  useEffect(() => {
    setAskingSeq((seq) => (seq !== null && jobs.some((job) => job.orderSeq === seq) ? seq : null));
  }, [jobs]);
  useEffect(() => { if (!open) setAskingSeq(null); }, [open]);
  // A job STARTING drops a standing question too: the stack it was measured against is moving.
  useEffect(() => { if (busy) setAskingSeq(null); }, [busy]);
  if (jobs.length === 0) return null;

  const clock = now ?? Date.now();
  // Newest first, which is the order a reader looks for the job they just finished in.
  const newestFirst = jobs.slice().reverse();
  /** PROVEN ELSEWHERE OUTRANKS UNPROVEN: a record in both sets names a map, and what it names is
   *  the sharper fact. */
  const blockedOf = (job: JobView): Blocked | undefined => (
    otherMap?.has(job.orderSeq) === true ? 'other-map'
      : unknownMap?.has(job.orderSeq) === true ? 'unknown-map'
        : undefined);
  const here = newestFirst.filter((job) => blockedOf(job) === undefined);
  const elsewhere = newestFirst.filter((job) => blockedOf(job) === 'other-map');
  const unrecorded = newestFirst.filter((job) => blockedOf(job) === 'unknown-map');

  /** One group's header plus its rows, or nothing where the group is empty: a header over no rows
   *  says a day has jobs in it that the list is not showing. */
  const group = (key: string, label: string, rows: readonly JobView[]) => (rows.length === 0 ? null : (
    <div key={key} data-testid="history-group" data-group={key}>
      <div data-testid="history-day-head" style={DAY_HEAD}>{label}</div>
      {rows.map((job) => (
        /* The rows arrive on the fold's own clock, newest first, so the list reads as unfolding
           out of the row that opened it rather than as a second card appearing over it. */
        <motion.div
          key={job.orderSeq}
          initial={{ opacity: 0, y: -FOLD_RISE }}
          animate={{ opacity: 1, y: 0 }}
          transition={framerMotion('panel.history.fold')}
        >
          <HistoryRow
            job={job}
            rolledBack={rolledBack?.has(job.orderSeq) ?? false}
            {...(blockedOf(job) ? { blocked: blockedOf(job)! } : {})}
            {...(undoDepth !== undefined ? { undoDepth } : {})}
            busy={busy}
            asking={askingSeq === job.orderSeq}
            onAsk={(on) => setAskingSeq(on ? job.orderSeq : null)}
            {...(onOpen ? { onOpen } : {})}
            {...(onRollBack ? { onRollBack } : {})}
          />
        </motion.div>
      ))}
    </div>
  ));

  const days: Day[] = ['today', 'yesterday', 'earlier'];

  return (
    <div data-testid="history-strip" data-open={open} style={{ flex: '0 0 auto' }}>
      <FloatMenu
        data-testid="history-toggle"
        aria-label={t('agent3.history_past_jobs')}
        open={open}
        onOpen={() => setOpen(true)}
        onClose={() => setOpen(false)}
        zoom={zoom}
        row={(
          <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {t('agent3.history_past_jobs')}
            </span>
            {/* The count sits at the row's far end, next to the chevron (artifact `.hrow .n`). */}
            <span
              data-testid="history-count"
              style={{
                marginLeft: 'auto',
                ...roleFont('small'),
                fontFamily: font.family,
                color: colors.brownText,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {jobs.length}
            </span>
          </span>
        )}
        body={[
          ...days.map((day) => group(day, t(DAY_KEY[day]), here.filter((job) => dayOf(job.orderAt, clock) === day))),
          group('other-map', t(BLOCKED_KEY['other-map']), elsewhere),
          group('unknown-map', t(BLOCKED_KEY['unknown-map']), unrecorded),
        ]}
      />
    </div>
  );
}
