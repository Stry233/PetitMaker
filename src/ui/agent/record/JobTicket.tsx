/*
 * A job ticket keeps its sticky order line above the progress, model output and work record. Jobs
 * with plans place their flat operation list under the active plan stage; planless jobs render the
 * same list directly. Settled and historical jobs omit the live progress band, while held jobs
 * freeze it. Stamps are placed next to the work they describe.
 */
import { useReadingIntent } from '../parts/scroll-intent';
import { useToggleSet } from '../hooks/use-toggle-set';
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotionConfig } from 'framer-motion';
import { Stamp, TapeBar, type TapeMode } from '../parts/panel-parts';
import { HoldActions } from '../parts/HoldActions';
import { ActionButton } from '../../primitives/ActionButton';
import { ThoughtRow, ThoughtsBox } from './ThoughtsBox';
import { Icon, type IconId } from '../parts/sprite';
import { inlineProseRuns, INLINE_PROSE_STYLE } from '../parts/model-prose';
import { OpsList } from './OpRow';
import { PlanRail } from './PlanRail';
import type { LaneView } from './Lane';
import { edge, recede } from '../panel-skin';
import type { Checkpoint } from './ticket-parts';
import { ACTIVE, INSET, MUTED, PLATE, PLATE_INK } from '../../design/tokens';
import { font, radii } from '../../design/styles';
import { roleFont } from '../../design/text-weight';
import { cssMotion, framerMotion } from '../../design/motion';
import { useT } from '../../../i18n/context';
import type { JobView } from '../../../agent/panel';
import type { Translate, I18nKey } from '../../../i18n/keys';

/** Icon + i18n key for each side stamp a job can carry, as literal key strings (see OpRow.tsx's
 *  own note on why the drift detector needs that, not a template). */
const STAMP_META: Record<JobView['stamps'][number]['kind'], { icon: IconId; key: I18nKey }> = {
  compaction: { icon: 'pw-compress', key: 'agent.stamp_compaction' },
  damper: { icon: 'pw-rotate', key: 'agent.stamp_damper' },
  interrupted: { icon: 'pw-pause', key: 'agent.stamp_interrupted' },
};

/** A job's side stamps as a card can draw them, resolved through the table above so the incident's
 *  own standing card (`FlipTicket.tsx:IncidentCard`) reads the same words this ticket does rather
 *  than carrying a second copy of the table. */
export function jobStamps(
  job: JobView, t: Translate,
): { key: string; icon: IconId; text: string }[] {
  return job.stamps.map((s) => ({
    key: s.kind, icon: STAMP_META[s.kind].icon, text: t(STAMP_META[s.kind].key),
  }));
}

/** Ticket inset in local CSS pixels. */
const TICKET_PAD = 12;

/** How far past its own words the parked order line's opaque backing reaches, in px. */
const STICKY_BLEED = 4;

/** The tape's own mode, or `undefined` for no band at all. Only a live, unsettled job animates a
 *  progress read: a filed plan reports its stage fraction, a job still running with no plan yet
 *  reports indeterminate, and a settled job or a non-live (history) rendering shows nothing here. */
function tapeModeFor(job: JobView, live: boolean): TapeMode | undefined {
  if (!live || job.outcome) return undefined;
  if (job.plan) {
    const total = job.plan.stages.length;
    return { fraction: total > 0 ? job.plan.doneCount / total : 0 };
  }
  return 'indeterminate';
}

/** The caret's blink, as a two-step opacity track: a typewriter mark, never a fade (see
 *  `panel.says.caret`). Under reduced motion it stands lit, which reads as a mark at the end of the
 *  line rather than as a hung one. */
const CARET_BLINK = { opacity: [1, 1, 0, 0] };

/** The says line's closed height: the two clamped lines, at the note rung's own size and the
 *  line-height the span declares. The unfold animates between this and the whole text. */
const SAYS_CLOSED_H = Math.round(roleFont('note').fontSize * 1.4 * 2);

const ORDER_STYLE: CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 1,
  background: PLATE,
  // The backing is wider than the words, and the negative margin hands the room straight back so no
  // layout moves for it: a line parked over a scroller has content sliding up to its own edge, and
  // an ascender arriving flush against a descender reads as the two lines touching.
  paddingBottom: STICKY_BLEED,
  marginBottom: -STICKY_BLEED,
  // `lead` is the house rung for "the one bigger line a panel gets", which is what the order is.
  ...roleFont('lead'),
  fontFamily: font.family,
  color: PLATE_INK,
  lineHeight: 1.3,
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
  // A pasted URL in an order has no space to break at; without this the clamp clips it mid-word
  // and the second line never exists.
  overflowWrap: 'anywhere',
};

/** Compact spacing for the operation list within the roomier ticket layout. */
const BODY_STYLE: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2 };

/** The open-set key of the turn still streaming, which has no log seq of its own yet. Negative, so
 *  it can never collide with one. */
const LIVE_TURN = -1;

/** Button beside the model output that opens the current turn's reasoning. */
const THOUGHTS_PILL: CSSProperties = {
  flex: '0 0 auto',
  border: 'none',
  borderRadius: radii.pill,
  padding: '2px 8px',
  ...roleFont('small'),
  fontFamily: font.family,
  color: MUTED,
};

/** The says line's expand chevron, at the line's own height. */
const SAYS_EXPAND: CSSProperties = {
  flex: '0 0 auto', width: 20, height: 20, border: 'none', padding: 0,
  borderRadius: radii.chip, color: MUTED,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
};

interface JobTicketProps {
  job: JobView;
  live?: boolean;
  /** Nothing is moving: a pause, a stop, a wait on the provider. Freezes the tape where it stands. */
  held?: boolean;
  /** The words are still arriving, so the says line carries its caret. */
  streaming?: boolean;
  /** The job is on hold: its own mark, and the two verbs that end the hold. */
  paused?: boolean;
  /** The live helper lane (`store.childLive`), for the delegate row that has one. */
  lane?: LaneView;
  /** The region vignette that stands beside "in the marked region"; the line renders without it. */
  regionVignette?: ReactNode;
  /** A job is in flight, so the rail's per-stage take-back stands disabled and says why. */
  busy?: boolean;
  /** The live undo depth, so a stage's take-back can name what it would pop. */
  undoDepth?: number;
  onRewind?: (checkpoint: Checkpoint) => void;
  onResume?: () => void;
  onStop?: () => void;

}

export function JobTicket({
  job,
  live = false,
  held = false,
  streaming = false,
  paused = false,
  lane,
  regionVignette,
  busy = false,
  undoDepth,
  onRewind,
  onResume,
  onStop,
}: JobTicketProps) {
  const t = useT();
  const reduced = useReducedMotionConfig() === true;
  const [saysOpen, setSaysOpen] = useState(false);
  // The says line re-renders on every epoch bump while a job streams; the markdown parse only
  // owes the renders where the text itself moved.
  const saysRuns = useMemo(() => (job.says === undefined ? null : inlineProseRuns(job.says, t)), [job.says, t]);
  const tapeMode = tapeModeFor(job, live);
  const preserveReading = useReadingIntent();
  const toggleSays = () => { preserveReading(); setSaysOpen((o) => !o); };
  /** Open thoughts by turn seq, plus `LIVE_TURN` for the turn still streaming; several may stand open. */
  const openThoughts = useToggleSet<number>();
  const toggleThought = (id: number) => { preserveReading(); openThoughts.toggle(id); };
  // A revision above the first is a plan the model re-filed mid-job: the rail would otherwise change
  // shape under the user with nothing saying it had.
  const revised = job.plan !== undefined && job.plan.revision > 1;
  const liveThought = job.thought?.live;
  /** Per-turn thought marks, filed above their op row only when ops stand flat; a planned job's thinking is counted by the status card and the receipt. */
  const markAt = (index: number): ReactNode => {
    const marks = (job.thought?.marks ?? []).filter((mark) => mark.beforeIndex === index);
    const stamps = job.stamps.filter((s) => s.beforeIndex === index);
    if (marks.length === 0 && stamps.length === 0) return null;
    return (
      <>
        {marks.map((mark) => (
          <ThoughtRow
            key={mark.seq}
            mark={mark}
            open={openThoughts.has(mark.seq)}
            onToggle={() => toggleThought(mark.seq)}
          />
        ))}
        {stamps.map((s) => (
          <Stamp key={`stamp-${s.kind}`} icon={STAMP_META[s.kind].icon}>{t(STAMP_META[s.kind].key)}</Stamp>
        ))}
      </>
    );
  };
  /** Whether the flat list is the one standing, which is the same condition the body renders it
   *  under: a planned job files its stamps at the foot, since the rail has no row for them. */
  const flatOps = job.plan === undefined && (job.ops.length > 0 || (job.thought?.marks.length ?? 0) > 0);

  return (
    <article
      data-testid="job-ticket"
      style={{
        background: PLATE,
        border: edge,
        borderRadius: radii.md,
        padding: TICKET_PAD,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        boxShadow: 'none',
      }}
    >
      <div data-testid="ticket-order" style={ORDER_STYLE}>{job.orderText}</div>

      {/* The region as filed, which is the ticket's own record: the paint may have changed since,
          and the composer's chip is what tracks the live one. */}
      {job.region && (
        <div
          data-testid="ticket-region"
          style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: -2 }}
        >
          {regionVignette}
          <span style={{ ...roleFont('small'), fontFamily: font.family, color: MUTED }}>
            {t('agent.ticket_in_region')}
          </span>
        </div>
      )}

      {tapeMode !== undefined && <TapeBar mode={tapeMode} held={held} />}

      {(job.says !== undefined || liveThought !== undefined) && (
        <div>
          <div data-testid="says" style={{ display: 'flex', alignItems: 'flex-start', gap: 6, minHeight: 17 }}>
            {job.says !== undefined && (
              <>
                {/* The unclamp unfolds on the shared beat (`panel.detail.unfold`): the wrapper's height
                    opens to the whole text and closes back to the two-line cap, which is the same cut
                    the clamp makes — the clamp only adds the ellipsis on top. */}
                <motion.div
                  initial={false}
                  animate={{ height: saysOpen ? 'auto' : SAYS_CLOSED_H }}
                  transition={framerMotion('panel.detail.unfold')}
                  style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}
                >
                <span
                  data-testid="says-line"
                  data-open={saysOpen}
                  style={{
                    // The panel's own prose rung, not `body`: the says line is the assistant speaking,
                    // in the receding ink, and `body` is a paragraph rung in the plate's own.
                    ...roleFont('note'),
                    fontFamily: font.family,
                    color: MUTED,
                    display: '-webkit-box',
                    lineHeight: 1.4,
                    WebkitLineClamp: saysOpen ? undefined : 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    // The model writes markdown, and this seat is one clamped run: its emphasis is
                    // rendered inline and its own line breaks are kept, which is as much of the
                    // written shape as two lines of a card can hold.
                    ...INLINE_PROSE_STYLE,
                  }}
                >
                  {saysRuns}
                  {streaming && (
                    <motion.span
                      data-testid="says-caret"
                      animate={reduced ? { opacity: 1 } : CARET_BLINK}
                      transition={{ ...framerMotion('panel.says.caret'), repeat: Infinity }}
                      style={{
                        display: 'inline-block',
                        width: 7,
                        height: 11,
                        marginLeft: 2,
                        borderRadius: radii.hair,
                        background: MUTED,
                        opacity: recede.aside,
                        verticalAlign: -1,
                      }}
                    />
                  )}
                </span>
                </motion.div>
                {/* The whole line is one press away, since a clamped two lines can end mid-clause. */}
                <ActionButton
                  data-testid="says-expand"
                  aria-label={t(saysOpen ? 'agent.says_less' : 'agent.says_more')}
                  aria-expanded={saysOpen}
                  onClick={toggleSays}
                  hoverFill={INSET}
                  style={SAYS_EXPAND}
                >
                  {/* The turn rides the same unfold beat as the text it points at. */}
                  <span style={{ display: 'inline-flex', transform: saysOpen ? 'rotate(180deg)' : undefined, transition: cssMotion('panel.detail.unfold', ['transform'], reduced) }}>
                    <Icon id="pw-chevron" size={13} />
                  </span>
                </ActionButton>
              </>
            )}
            {/* Reasoning remains accessible even before the model writes its first answer text. */}
            {liveThought !== undefined && (
              <ActionButton
                data-testid="thoughts-toggle"
                interaction="pill"
                aria-expanded={openThoughts.has(LIVE_TURN)}
                onClick={() => toggleThought(LIVE_TURN)}
                fill={INSET}
                hoverFill={ACTIVE}
                style={THOUGHTS_PILL}
              >
                {t('agent.thoughts_so_far')}
              </ActionButton>
            )}
          </div>
          <AnimatePresence initial={false}>
            {liveThought !== undefined && openThoughts.has(LIVE_TURN) && <ThoughtsBox text={liveThought} spaceBefore={9} streaming={live && !held} />}
          </AnimatePresence>
        </div>
      )}

      <div data-testid="ticket-body" style={BODY_STYLE}>
        {revised && (
          <Stamp icon="pw-plan">
            {t(
              'agent.stamp_plan_revised',
              { n: job.plan?.stages.length ?? 0 },
            )}
          </Stamp>
        )}

        {job.plan ? (
          <PlanRail
            key={job.plan.revision}
            plan={job.plan}
            ops={job.ops}
            checkpoints={job.checkpoints}
            {...(lane ? { lane } : {})}
            busy={busy}
            {...(undoDepth !== undefined ? { undoDepth } : {})}
            {...(onRewind ? { onRewind } : {})}
          />
        ) : (
          flatOps && <OpsList ops={job.ops} {...(lane ? { lane } : {})} marks={markAt} />
        )}

        {job.steerNotes.map((note, i) => (
          <Stamp key={`steer-${i}`} icon="pw-note">
            {t('agent.steer_noted', { text: note })}
          </Stamp>
        ))}
        {job.refusals?.map((line, i) => (
          <Stamp key={`refusal-${i}`} icon="pw-note">
            {line}
          </Stamp>
        ))}

        {/* A stamp files where it happened, which is inside the list wherever the list is flat (see
            `markAt`): a compaction has the whole run it made room for after it, and read at the foot
            it would claim to be the newest thing the job did. The foot is where the ones with no row
            to stand above go — a planned job's, whose rail files no marks, and a job with no op list
            at all. */}
        {!flatOps && job.stamps.map((s) => (
          <Stamp key={`stamp-${s.kind}`} icon={STAMP_META[s.kind].icon}>
            {t(STAMP_META[s.kind].key)}
          </Stamp>
        ))}

        {paused && (
          <span data-testid="pausemark" style={PAUSEMARK_STYLE}>
            <Icon id="pw-pause" size={12} />
            {pausedWhere(job, t)}
          </span>
        )}
      </div>

      {/* The hold's verbs stand at the foot of the ticket that stopped. */}
      {paused && <HoldActions ids="ticket" {...(onResume ? { onResume } : {})} {...(onStop ? { onStop } : {})} style={{ marginTop: 2 }} />}
    </article>
  );
}

/** Muted pill describing where the work stopped. */
const PAUSEMARK_STYLE: CSSProperties = {
  alignSelf: 'flex-start',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  background: INSET,
  borderRadius: radii.pill,
  padding: '4px 10px',
  ...roleFont('small'),
  fontFamily: font.family,
  color: MUTED,
};

/** Where a hold landed: a named stage of a filed plan, or the step boundary the loop reached. The resume offer says the same sentence. */
export function pausedWhere(job: JobView, t: Translate): string {
  // "AFTER step n" is a count of what is done, which is `doneCount` and not the index of the step the
  // job had reached: reading the index claimed the step in progress as finished, so a hold with two
  // stages banked said "paused after step 3 of 4" directly above an offer note saying two of four
  // are on the map. With nothing banked there is no step to name and the boundary is the whole fact.
  if (job.plan === undefined || job.plan.doneCount === 0) return t('agent.ticket_paused_boundary');
  return t('agent.ticket_paused_after', { n: job.plan.doneCount, m: job.plan.stages.length });
}
