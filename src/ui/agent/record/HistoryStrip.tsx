/*
 * Past jobs in a body-level floating menu, grouped by date and map identity. Rolled-back jobs and
 * jobs not tied to the open map offer no rollback. The row-wide open button sits behind a separate
 * rollback button, so ancestors must not establish a transformed containing block.
 */
import { useState, type CSSProperties } from 'react';
import { motion } from 'framer-motion';
import { Icon, type IconId } from '../parts/sprite';
import { editCount } from '../derive/job-stats';
import { DAY_KEY, dayOf, type Day } from '../derive/days';
import { amplitude, framerMotion } from '../../design/motion';
import { iconForTool } from '../parts/tool-meta';
import { rollbackCost, rollbackReaches } from '../derive/rollback';
import { RewindSquare } from '../parts/RewindSquare';
import { ActionButton } from '../../primitives/ActionButton';
import { FloatMenu } from '../../primitives/FloatMenu';
import { useFrameZoom } from '../../shell/use-frame-zoom';
import { DANGER_SURFACE, INK, MUTED, PLATE, PLATE_INK } from '../../design/tokens';
import { font, radii } from '../../design/styles';
import { roleFont } from '../../design/text-weight';
import { useT } from '../../../i18n/context';
import type { JobView } from '../../../agent/panel';
import { recede } from '../panel-skin';
import type { I18nKey } from '../../../i18n/keys';

/** How far a row drops in from, on the fold's own clock. The fold declares no travel of its own (it
 *  is a rotation and a list appearing), so the rows borrow the op row's rise — one arrival distance
 *  for the panel's lists rather than a second number nobody can find. */
const FOLD_RISE = amplitude('panel.op.enter') ?? 0;

/** A job with no tool call to its name (an order the model only answered in words) still needs a
 *  mark; the history glyph is the one that claims no particular kind of work. */
const NO_WORK_ICON: IconId = 'pw-history';

/**
 * The glyph of the last writing tool the job ran. An answer wears the reply bubble and a silent
 * give-up the record mark, by the projection's `kind`.
 */
function glyphFor(job: JobView): IconId {
  if (job.kind === 'answer') return 'pw-reply-bubble';
  if (job.kind === 'quiet') return NO_WORK_ICON;
  const writes = job.ops.filter((op) => !op.isRead);
  const pool = writes.length > 0 ? writes : job.ops;
  const last = pool[pool.length - 1];
  return last ? iconForTool(last.name) : NO_WORK_ICON;
}

/**
 * A row's count: an answer says what it was, a row with no edits says so whatever ended it (`kind` is
 * set only for finished jobs), and a row with edits keeps the count a take-back pops.
 */
function statKeyFor(job: JobView): I18nKey | null {
  if (job.kind === 'answer') return 'agent.history_answered';
  if (job.kind === 'quiet') return 'agent.history_ended';
  if (editCount(job) === 0) return 'agent.dock_no_edits';
  return null;
}

/* ── the day the record was made ──────────────────────────── */

/** Why a record may not be rolled back from here, which is also which group it stands in. The two
 *  are different facts and the list says them separately: one is proven elsewhere, the other is
 *  merely unproven, and a record that may well be this map's must not be told it is not. */
export type Blocked = 'other-map' | 'unknown-map';

const BLOCKED_KEY: Record<Blocked, I18nKey> = {
  'other-map': 'agent.history_other_map',
  'unknown-map': 'agent.history_unknown_map',
};

/** The 26px action square shared by real actions and the decorative open-ticket glyph. */
const ACTION_SQUARE: CSSProperties = {
  width: 26,
  height: 26,
  borderRadius: radii.chip,
  flex: '0 0 auto',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: PLATE,
  color: INK,
  border: 'none',
  boxShadow: 'none',
};

/** Quiet group header that locates the rows below it. */
const DAY_HEAD: CSSProperties = {
  ...roleFont('small'),
  fontFamily: font.family,
  color: MUTED,
  padding: '6px 10px 2px',
  flex: '0 0 auto',
};

function HistoryRow({
  job,
  rolledBack,
  blocked,
  undoDepth,
  busy = false,
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
   *  controls stand disabled with the reason readable rather than vanishing. */
  busy?: boolean;
  onOpen?: (job: JobView) => void;
  onRollBack?: (job: JobView) => void;
}) {
  const t = useT();
  const [revealed, setRevealed] = useState(false);
  /** The roll back's question stands, so the row previews what it would take; a running job closes it. */
  const [questioned, setAsking] = useState(false);
  const asking = questioned && !busy;
  const watermark = job.checkpoints[0]?.undoIndex;
  const rollable = onRollBack !== undefined && !rolledBack && blocked === undefined
    && watermark !== undefined && rollbackReaches(watermark, undoDepth);
  const actions = (onOpen ? 1 : 0) + (rollable ? 1 : 0);
  const statKey = statKeyFor(job);
  const edits = editCount(job);
  const dim = blocked !== undefined;
  const busyWhy = t('agent.rollback_busy');

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
        gap: 8,
        borderRadius: radii.md,
        padding: '8px 10px',
        background: asking ? DANGER_SURFACE : revealed ? PLATE : 'transparent',
        opacity: dim ? recede.apart : 1,
      }}
    >
      {onOpen && (
        <ActionButton
          data-testid="history-open"
          interaction="row"
          aria-label={busy ? t('agent.history_open_ticket_busy', { reason: busyWhy }) : t('agent.history_open_ticket')}
          title={busy ? busyWhy : t('agent.history_open_ticket')}
          disabled={asking || busy}
          onClick={() => onOpen(job)}
          style={{
            position: 'absolute', inset: 0, borderRadius: radii.md,
            background: 'transparent', border: 'none', padding: 0, boxShadow: 'none',
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
            color: MUTED,
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap',
            opacity: asking || (revealed && actions > 0) ? 0 : 1,
          }}
        >
          {rolledBack
            ? t('agent.history_rolled_back')
            : statKey !== null
              ? t(statKey)
              : t('agent.history_edits', { n: edits })}
        </span>
        {actions > 0 && (
          <span
            data-testid="history-item-acts"
            style={{
              gridArea: '1 / 1',
              display: 'flex',
              gap: 4,
              opacity: revealed || asking ? 1 : 0,
              pointerEvents: revealed || asking ? 'auto' : 'none',
            }}
          >
            {rollable && (
              <RewindSquare
                testId="history-roll-back"
                icon="pw-undo-arrow"
                label={t('agent.history_roll_back')}
                actLabel={t('agent.history_roll_back')}
                cost={rollbackCost(watermark!, undoDepth, job.endUndoIndex)}
                busy={busy}
                onAskChange={setAsking}
                onConfirm={() => onRollBack?.(job)}
              />
            )}
            {/* The open-the-ticket square is drawing: the control it depicts is the row itself. */}
            {onOpen && (
              <span data-testid="history-open-mark" aria-hidden="true" style={ACTION_SQUARE}>
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
  open,
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
  /** A job is in flight. Every row's presses stand disabled and say why. */
  busy?: boolean;
  /** The clock the day headers are read against. Defaults to now, and is passed in by a test or a
   *  fixture that needs the grouping to be the same picture every run. */
  now?: number;
  /** Held by the caller, which outlives the strip while an opened record covers the job zone. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpen?: (job: JobView) => void;
  onRollBack?: (job: JobView) => void;
}) {
  const t = useT();
  const zoom = useFrameZoom();
  const setOpen = (next: boolean) => onOpenChange(next);
  if (jobs.length === 0) return null;

  const clock = now ?? Date.now();
  // Newest first, which is the order a reader looks for the job they just finished in.
  const newestFirst = jobs.slice().reverse();
  /** Proven elsewhere outranks unproven: a record in both sets names a map, and what it names is
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
        aria-label={t('agent.history_past_jobs')}
        open={open}
        onOpen={() => setOpen(true)}
        onClose={() => setOpen(false)}
        zoom={zoom}
        row={(
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {t('agent.history_past_jobs')}
            </span>
            {/* Keep the count at the row's far end beside the chevron. */}
            <span
              data-testid="history-count"
              style={{
                marginLeft: 'auto',
                ...roleFont('small'),
                fontFamily: font.family,
                color: MUTED,
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
