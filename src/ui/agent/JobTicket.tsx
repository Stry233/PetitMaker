/*
 * JobTicket.tsx — the order slip a job's whole story stands on: the order line, the region it was
 * filed under, the construction-tape progress band, the model's own says-line, then ONE body of
 * items — the plan rail or a flat op list, the helper lane, the side stamps, and a hold's own mark
 * and verbs (normative prototype `.ticket`).
 *
 * THE ORDER LINE IS STICKY. The body scrolls inside the job zone and the ticket can be taller than
 * the room it has, so the title rides at the top of its own card (`.ticket .order`, offset by the
 * card's padding AND its border so it sits flush) — the panel's subject is the one thing that must
 * not scroll away while a long record is read.
 *
 * PLAN VS. FLAT OPS IS EXCLUSIVE, never both: a `JobView` carries one flat `ops` list for the
 * whole job (there is no per-stage partition in the data), so when a plan exists that SAME list
 * nests under the plan rail's active stage (`PlanRail`) and the ticket does not also print it
 * below the rail — a planless job prints it directly instead. A job with neither a plan nor any
 * ops yet (freshly ordered, still thinking) renders NEITHER: `PlanRail` never appears as an empty
 * scaffold waiting for a plan that has not arrived.
 *
 * WHERE A STAMP STANDS SAYS WHAT IT EXPLAINS. The two that describe what comes NEXT lead the body —
 * a revised plan stands over the rail it revised, and a playbook stands with the call that opened it
 * (`OpRow` renders that one, so it lands in op order rather than at the foot). The rest look BACK at
 * work already recorded and stand under it: the notes the user sent, a tidy-up, a change of
 * approach, an interruption.
 *
 * THE TAPE ONLY EVER DESCRIBES THE LIVE JOB'S OWN PROGRESS: a settled job (`job.outcome` set) or one
 * rendered where the caller says `live={false}` (a past job standing in the log) shows no band at
 * all, matching the prototype's finished-ticket flip card taking over from here instead. `held`
 * freezes whatever band there is, for the states where nothing is moving.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotionConfig } from 'framer-motion';
import { RESUME_PRIMARY, Stamp, TapeBar, type TapeMode } from './atoms';
import { ThoughtRow, ThoughtsBox } from './ThoughtsBox';
import { Icon, type IconId } from './icons';
import { inlineProseRuns, INLINE_PROSE_STYLE } from './model-prose';
import { OpsList } from './OpRow';
import { PlanRail } from './PlanRail';
import type { LaneView } from './Lane';
import { edge } from './tokens';
import type { Checkpoint } from './FlipTicket';
import { INSET, PLATE, PLATE_INK } from '../design/tokens';
import { colors, cursors, font } from '../design/styles';
import { roleFont } from '../design/text-weight';
import { windowPill } from '../design/window-skin';
import { LoadingDots } from '../primitives/LoadingDots';
import { framerMotion } from './motion';
import { useT } from '../../i18n/context';
import type { JobView } from '../../agent/core/project-view';

/** Icon + i18n key for each side stamp a job can carry, as literal key strings (see OpRow.tsx's
 *  own note on why the drift detector needs that, not a template). */
const STAMP_META: Record<JobView['stamps'][number]['kind'], { icon: IconId; key: string }> = {
  compaction: { icon: 'pw-compress', key: 'agent3.stamp_compaction' },
  damper: { icon: 'pw-rotate', key: 'agent3.stamp_damper' },
  interrupted: { icon: 'pw-pause', key: 'agent3.stamp_interrupted' },
};

/** A job's side stamps as a card can draw them, resolved through the table above so the incident's
 *  own standing card (`FlipTicket.tsx:IncidentCard`) reads the same words this ticket does rather
 *  than carrying a second copy of the table. */
export function jobStamps(
  job: JobView, t: (key: string) => string,
): { key: string; icon: IconId; text: string }[] {
  return job.stamps.map((s) => ({
    key: s.kind, icon: STAMP_META[s.kind].icon, text: t(STAMP_META[s.kind].key),
  }));
}

/** The plate's own inset and border, so the sticky order line can offset itself by exactly what
 *  stands above it (prototype: `padding:12px` + a 1px edge, `top:-13px`). */
const TICKET_PAD = 12;
const TICKET_BORDER = 1;

/** How far past its own words the parked order line's opaque backing reaches, in px. */
const STICKY_BLEED = 4;

/** The tape's own mode, or `undefined` for no band at all. Only a LIVE, unsettled job animates a
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

const ORDER_STYLE: CSSProperties = {
  position: 'sticky',
  top: -(TICKET_PAD + TICKET_BORDER),
  zIndex: 2,
  background: PLATE,
  // THE BACKING IS WIDER THAN THE WORDS, and the negative margin hands the room straight back so no
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

/** The body's own tight rhythm (prototype `.ops`), against the ticket's roomier one between the
 *  order line, the tape and the says line. */
const BODY_STYLE: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2 };

/** No thought open. A module constant so a fresh mount's set is the same object every time. */
const NONE_OPEN: ReadonlySet<number> = new Set();

/** The open-set key of the turn still streaming, which has no log seq of its own yet. Negative, so
 *  it can never collide with one. */
const LIVE_TURN = -1;

/** The pill beside the says row that opens the CURRENT turn's thinking (prototype `.thoughts`). */
const THOUGHTS_PILL: CSSProperties = {
  flex: '0 0 auto',
  border: 'none',
  background: INSET,
  borderRadius: 999,
  padding: '2px 9px',
  ...roleFont('small'),
  fontFamily: font.family,
  color: colors.brownText,
  cursor: cursors.clickable,
};

export interface JobTicketProps {
  job: JobView;
  live?: boolean;
  /** Nothing is moving: a pause, a stop, a wait on the provider. Freezes the tape where it stands. */
  held?: boolean;
  /** The words are still arriving, so the says line carries its caret. */
  streaming?: boolean;
  /** The model is working and has said nothing yet, so the says line is three dots. */
  thinking?: boolean;
  /** The job is on hold: its own mark, and the two verbs that end the hold. */
  paused?: boolean;
  /** The live helper lane (`store.childLive`), for the delegate row that has one. */
  lane?: LaneView;
  /** The region vignette that stands beside "in the marked region"; the line renders without it. */
  regionVignette?: ReactNode;
  /** A job is IN FLIGHT, so the rail's per-stage take-back stands disabled and says why. */
  busy?: boolean;
  onRewind?: (checkpoint: Checkpoint) => void;
  onResume?: () => void;
  onStop?: () => void;
  /**
   * A THOUGHTS BOX IS OPEN, or the last one has closed.
   *
   * The record FOLLOWS ITS OWN FOOT while a job appends, and a box opened mid-run would be yanked
   * away from the reader every time the projection moved — several times a second, for exactly the
   * length of the thought being read. The zone owns the follow, so the ticket reports the fact and
   * the zone stands down.
   */
  onThoughtsOpenChange?: (open: boolean) => void;
}

export function JobTicket({
  job,
  live = false,
  held = false,
  streaming = false,
  thinking = false,
  paused = false,
  lane,
  regionVignette,
  busy = false,
  onRewind,
  onResume,
  onStop,
  onThoughtsOpenChange,
}: JobTicketProps) {
  const t = useT();
  const reduced = useReducedMotionConfig() === true;
  const [saysOpen, setSaysOpen] = useState(false);
  const tapeMode = tapeModeFor(job, live);
  const toggleSays = () => setSaysOpen((o) => !o);
  /**
   * WHICH THOUGHTS ARE OPEN, by the turn's own log seq — plus `LIVE_TURN` for the turn still
   * streaming, which has no seq yet because it has not been logged.
   *
   * A SET RATHER THAN ONE OPEN AT A TIME: each mark is a different turn's thinking, and a reader
   * comparing what the model thought before a call with what it thought after should not have to
   * close one to see the other.
   */
  const [openThoughts, setOpenThoughts] = useState<ReadonlySet<number>>(NONE_OPEN);
  const toggleThought = (id: number) => setOpenThoughts((open) => {
    const next = new Set(open);
    if (!next.delete(id)) next.add(id);
    return next;
  });
  // REPORTED ON CHANGE, AND ON THE WAY OUT. A mount reports nothing (the host's own default is
  // closed), and a ticket that leaves with a box open — the job settles, the record swaps — hands
  // the follow back, which a report keyed on the state alone would never do.
  const report = useRef(onThoughtsOpenChange);
  report.current = onThoughtsOpenChange;
  const reportedOpen = useRef(false);
  useEffect(() => {
    const open = openThoughts.size > 0;
    if (reportedOpen.current === open) return;
    reportedOpen.current = open;
    report.current?.(open);
  }, [openThoughts]);
  useEffect(() => () => { if (reportedOpen.current) report.current?.(false); }, []);
  // A revision above the first is a plan the model re-filed mid-job: the rail would otherwise change
  // shape under the user with nothing saying it had.
  const revised = job.plan !== undefined && job.plan.revision > 1;
  const liveThought = job.thought?.live;
  /**
   * THE PER-TURN MARKS, by the op row they file above.
   *
   * ONLY WHERE THE OPS STAND FLAT. A filed plan nests the same op list under the rail's active
   * stage, and a turn is not a stage: a mark hung on the rail would claim the turn belonged to
   * whichever stage was running when it thought, which the log does not say. A planned job's
   * thinking is still fully reported — the dock counts it live and the receipt carries the one
   * total — it simply files no row.
   */
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
        borderRadius: 12,
        padding: TICKET_PAD,
        display: 'flex',
        flexDirection: 'column',
        gap: 9,
        boxShadow: 'none',
      }}
    >
      <div data-testid="ticket-order" style={ORDER_STYLE}>{job.orderText}</div>

      {/* THE REGION AS FILED, which is the ticket's own record: the paint may have changed since,
          and the composer's chip is what tracks the live one. */}
      {job.region && (
        <div
          data-testid="ticket-region"
          style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: -3 }}
        >
          {regionVignette}
          <span style={{ ...roleFont('small'), fontFamily: font.family, color: colors.brownText }}>
            {t('agent3.ticket_in_region')}
          </span>
        </div>
      )}

      {tapeMode !== undefined && <TapeBar mode={tapeMode} held={held} />}

      {(job.says !== undefined || thinking) && (
        <>
        <div data-testid="says" style={{ display: 'flex', alignItems: 'flex-start', gap: 6, minHeight: 17 }}>
          {job.says === undefined ? (
            <span data-testid="says-dots" style={{ paddingTop: 5 }}>
              <LoadingDots color={colors.brownText} size={5} />
            </span>
          ) : (
            <>
              <span
                data-testid="says-line"
                data-open={saysOpen}
                style={{
                  // The panel's own prose rung, not `body`: the says line is the assistant SPEAKING,
                  // in the receding ink, and `body` is a paragraph rung in the plate's own.
                  ...roleFont('note'),
                  fontFamily: font.family,
                  color: colors.brownText,
                  flex: 1,
                  minWidth: 0,
                  lineHeight: 1.4,
                  display: '-webkit-box',
                  WebkitLineClamp: saysOpen ? undefined : 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                  // The model writes markdown, and this seat is ONE clamped run: its emphasis is
                  // rendered inline and its own line breaks are kept, which is as much of the
                  // written shape as two lines of a card can hold.
                  ...INLINE_PROSE_STYLE,
                }}
              >
                {inlineProseRuns(job.says)}
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
                      borderRadius: 2,
                      background: colors.brownText,
                      opacity: 0.7,
                      verticalAlign: -1,
                    }}
                  />
                )}
              </span>
              {/* The whole line is one press away, since a clamped two lines can end mid-clause. */}
              <button
                type="button"
                data-testid="says-expand"
                aria-label={t(saysOpen ? 'agent3.says_less' : 'agent3.says_more')}
                aria-expanded={saysOpen}
                onClick={toggleSays}
                style={{
                  flex: '0 0 auto',
                  width: 20,
                  height: 20,
                  border: 'none',
                  background: 'none',
                  padding: 0,
                  color: colors.brownText,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: cursors.clickable,
                  transform: saysOpen ? 'rotate(180deg)' : undefined,
                }}
              >
                <Icon id="pw-chevron" size={13} />
              </button>
            </>
          )}
          {/* THE THOUGHTS AFFORDANCE, and the only way into the current turn's thinking. It stands
              beside the dots and beside a spoken line alike: what the model is thinking and what it
              has said are two different things, and the pill never becomes the second one. Where no
              reasoning text arrived there is no pill — a control that opened onto nothing would
              promise a transcript the provider does not send. */}
          {liveThought !== undefined && (
            <button
              type="button"
              data-testid="thoughts-toggle"
              aria-expanded={openThoughts.has(LIVE_TURN)}
              onClick={() => toggleThought(LIVE_TURN)}
              style={THOUGHTS_PILL}
            >
              {t('agent3.thoughts_so_far')}
            </button>
          )}
        </div>
        <AnimatePresence initial={false}>
          {liveThought !== undefined && openThoughts.has(LIVE_TURN) && <ThoughtsBox text={liveThought} />}
        </AnimatePresence>
        </>
      )}

      <div data-testid="ticket-body" style={BODY_STYLE}>
        {revised && (
          <Stamp icon="pw-plan">
            {t(
              (job.plan?.stages.length ?? 0) === 1 ? 'agent3.stamp_plan_revised_one' : 'agent3.stamp_plan_revised',
              { n: job.plan?.stages.length ?? 0 },
            )}
          </Stamp>
        )}

        {job.plan ? (
          <PlanRail
            plan={job.plan}
            ops={job.ops}
            checkpoints={job.checkpoints}
            {...(lane ? { lane } : {})}
            busy={busy}
            {...(onRewind ? { onRewind } : {})}
          />
        ) : (
          flatOps && <OpsList ops={job.ops} {...(lane ? { lane } : {})} marks={markAt} />
        )}

        {job.steerNotes.map((note, i) => (
          <Stamp key={`steer-${i}`} icon="pw-note">
            {t('agent3.steer_noted', { text: note })}
          </Stamp>
        ))}

        {/* A STAMP FILES WHERE IT HAPPENED, which is inside the list wherever the list is flat (see
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

      {/* THE HOLD'S VERBS STAND WITH THE HOLD, at the foot of the ticket that stopped: the dock says
          the state and this is where the answer to it lives. */}
      {paused && (onResume !== undefined || onStop !== undefined) && (
        <div data-testid="ticket-actions" style={{ display: 'flex', gap: 8, marginTop: 2 }}>
          {onResume !== undefined && (
            <button
              type="button"
              data-testid="ticket-resume"
              onClick={onResume}
              style={RESUME_PRIMARY}
            >
              {t('agent3.action_resume')}
            </button>
          )}
          {onStop !== undefined && (
            <button
              type="button"
              data-testid="ticket-stop"
              onClick={onStop}
              style={{ ...windowPill('danger', false, 'plate'), boxShadow: 'none' }}
            >
              {t('agent3.action_stop')}
            </button>
          )}
        </div>
      )}
    </article>
  );
}

/** The pausemark (prototype `.pausemark`): a muted pill saying where the work stopped. */
const PAUSEMARK_STYLE: CSSProperties = {
  alignSelf: 'flex-start',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  background: INSET,
  borderRadius: 999,
  padding: '4px 10px',
  ...roleFont('small'),
  fontFamily: font.family,
  fontWeight: 800,
  color: colors.brownText,
};

/**
 * Where a hold landed: at a named stage of a filed plan, or at whatever step boundary the loop
 * reached (which is all a planless job can say — the pause is taken between calls).
 *
 * EXPORTED because the resume OFFER says the same fact about the same job, and two spellings of one
 * sentence drift the first time either is tuned.
 */
export function pausedWhere(job: JobView, t: (key: string, params?: Record<string, string | number>) => string): string {
  // "AFTER step n" IS A COUNT OF WHAT IS DONE, which is `doneCount` and not the index of the step the
  // job had reached: reading the index claimed the step in progress as finished, so a hold with two
  // stages banked said "paused after step 3 of 4" directly above an offer note saying two of four
  // are on the map. With nothing banked there is no step to name and the boundary is the whole fact.
  if (job.plan === undefined || job.plan.doneCount === 0) return t('agent3.ticket_paused_boundary');
  return t('agent3.ticket_paused_after', { n: job.plan.doneCount, m: job.plan.stages.length });
}
