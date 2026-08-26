/*
 * Lane.tsx — the helper lane: what a `delegate_task` child is doing, inside the parent's own ticket
 * (normative prototype `.lane` / `.lanehead` / `.laneline`).
 *
 * A DELEGATE IS NEVER A BLACK HOLE. The child runs its own loop against its own log, which dies with
 * the call, so without a lane the parent's record carries one row reading "Delegating the task" for
 * minutes and then a result. The lane is that row's work said as it happens: the task as a name, a
 * step count that rises, the tool in flight, and — where the helper hits trouble — the SAME grammar
 * the parent uses for its own, so nothing about a helper's failure needs a second vocabulary.
 *
 * THE CAUSE READS TWICE, and that is deliberate: on the lane, and as the delegate row's own chip
 * (`OpRow`'s `chipFor`). The lane is a nested block that a collapsed op list can hide, and a
 * refusal the user cannot see is a refusal that did not happen as far as they know.
 *
 * IT ROLLS UP WHEN THE HELPER FINISHES (prototype: "the lane rolls up onto the delegate row"). A
 * settled call has no lane at all — the child's log is gone, and what survives it is the record on
 * the result (`ToolResultDetail.childOps`/`childError`), which `laneRollup` says in one chip.
 *
 * `LaneView` IS THE SHAPE, NOT THE CARRIER. `store.childLive` fills the live half of it today
 * (task, step count, the tool in flight); `retry` and `error` are the faces the artifact draws for a
 * helper in trouble and are rendered and tested from a `LaneView` here, awaiting the live carrier
 * that reports them (the child's own newest result knows both).
 */
import type { ReactNode } from 'react';
import { Icon, type IconId } from './icons';
import { ResultChip } from './atoms';
import { iconForTool, verbKeyForTool } from './tool-meta';
import { INSET, PLATE, PLATE_INK } from '../design/tokens';
import { colors, font } from '../design/styles';
import { roleFont } from '../design/text-weight';
import { Spinner } from '../primitives/Spinner';
import { useT } from '../../i18n/context';
import type { ToolResultDetail } from '../../agent/core/types';

export interface LaneView {
  /** The helper's own order: complete, self-contained instructions, which is why it is NOT the
   *  lane's name (see `label`) — a paragraph clamped to two lines names nothing. */
  task: string;
  /** The model's own short name for this helper (`delegate_task`'s optional `label` arg), shown as
   *  the lane's name in place of `task` when given. `undefined` falls back to `task`'s first line. */
  label?: string;
  /** How many steps the helper has taken. */
  ops: number;
  /** The tool the helper is on, by name — its glyph and phrase lead the lane's line. */
  opName?: string;
  /** The helper is waiting out a backoff: which attempt, of how many, and how long is left. */
  retry?: { attempt: number; of: number; seconds: number };
  /** The helper's trouble, in the words both the lane and the delegate row wear. */
  error?: string;
  /** The helper has finished, so nothing on the lane is pending. */
  done?: boolean;
}

/** How far the lane is indented from the rows it belongs under, in px (prototype `.lane`): far
 *  enough to read as the delegate row's own work rather than as the next step of the parent's. */
const LANE_INDENT = 28;

/** The spinner and the glyphs on a lane, in px. */
const LANE_SPIN = 13;
const LANE_GLYPH = 12;

/**
 * What a settled delegate call leaves on its own row, once its lane has rolled up: the helper's
 * trouble, or the work it did as a count. `undefined` for a result carrying neither, which is a call
 * that never reached a child at all (a malformed task, an abort before the first step).
 */
export function laneRollup(
  detail: ToolResultDetail | undefined,
  t: (key: string, params?: Record<string, string | number>) => string,
): { text: string; tone?: 'warn' | 'bad' } | undefined {
  if (detail === undefined) return undefined;
  if (detail.childError !== undefined) return { text: t('agent3.lane_stopped'), tone: 'bad' };
  const ops = detail.childOps;
  if (ops === undefined || ops.length === 0) return undefined;
  // A child call that was refused or put back is the one thing worth naming over the count: the
  // helper came back with less than it was asked for.
  if (ops.some((o) => o.status === 'error')) return { text: t('agent3.lane_refused'), tone: 'bad' };
  if (ops.some((o) => o.status === 'revert')) return { text: t('agent3.op_chip_put_back'), tone: 'warn' };
  return { text: t(ops.length === 1 ? 'agent3.steps_count_one' : 'agent3.steps_count', { n: ops.length }) };
}

/** The helper's DISPLAY name: the model's own short `label` when it gave one, else the first LINE of
 *  the (possibly long, self-contained) `task` — a two-line clamped name reading a whole paragraph is
 *  the conflict `label` exists to resolve, structurally, not by capping `task` itself. */
function helperName(lane: LaneView): string {
  return lane.label ?? lane.task.split('\n')[0]!.slice(0, 96);
}

/** The lane's head: the helper's name (or its wait), the shield that says it inherits every
 *  restriction the parent has, the step count, and what it is doing right now. */
function LaneHead({ lane }: { lane: LaneView }) {
  const t = useT();
  const name = lane.retry
    ? t('agent3.lane_retrying', { s: lane.retry.seconds })
    : t('agent3.lane_helper', { task: helperName(lane) });
  // A LANE OPENS AT ZERO AND STAYS THERE FOR ITS WHOLE FIRST THINK: the executor reports the child
  // BEFORE running it, so the first `childLive` the panel sees carries no ops and holds none until
  // the child's first tool result — seconds to minutes on a reasoning model. "0 steps" beside a live
  // spinner is a count of an absence, the class this panel suppresses everywhere else. The seat keeps
  // standing (empty), so nothing moves when the first step lands.
  const count = lane.retry
    ? t('agent3.lane_try_of', { n: lane.retry.attempt, m: lane.retry.of })
    : lane.ops === 0 ? ''
      : t(lane.ops === 1 ? 'agent3.steps_count_one' : 'agent3.steps_count', { n: lane.ops });

  return (
    <div data-testid="lane-head" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {/* THE TASK IS MODEL-AUTHORED, so the name WRAPS rather than ellipsizing (the prototype's
          `.lanehead .nm` carries no nowrap): a helper's whole job cut off at "Helper: planting
          the…" names nothing at all, and a long locale reaches that point on the first word. Two
          lines is the cap, the same one every other clamped line in the panel takes. */}
      <span
        data-testid="lane-name"
        style={{
          ...roleFont('caption'),
          fontFamily: font.family,
          fontWeight: 800,
          color: PLATE_INK,
          minWidth: 0,
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          lineHeight: 1.3,
          overflowWrap: 'anywhere',
        }}
      >
        {name}
      </span>
      {/* A helper inherits the painted region and every rule the parent obeys; the shield is that
          promise standing where the delegation is, not in a tooltip nobody opens. */}
      <span
        title={t('agent3.lane_inherits')}
        style={{ flex: '0 0 auto', display: 'inline-flex', color: colors.brownText }}
      >
        <Icon id="pw-shield" size={LANE_GLYPH} />
      </span>
      <span
        data-testid="lane-count"
        style={{
          marginLeft: 'auto',
          flex: '0 0 auto',
          ...roleFont('small'),
          fontFamily: font.family,
          fontVariantNumeric: 'tabular-nums',
          color: colors.brownText,
          whiteSpace: 'nowrap',
        }}
      >
        {count}
      </span>
      {laneStatus(lane)}
    </div>
  );
}

/** The head's trailing mark: the cause glyph while the helper waits, the spinner while it works,
 *  nothing once it is done. */
function laneStatus(lane: LaneView): ReactNode {
  if (lane.done === true) return null;
  if (lane.retry) {
    return (
      <span data-testid="lane-cause" style={{ flex: '0 0 auto', display: 'inline-flex', color: colors.brownText }}>
        <Icon id="pw-retry-clock" size={LANE_SPIN} />
      </span>
    );
  }
  return (
    <span data-testid="lane-spin" style={{ flex: '0 0 auto', display: 'inline-flex' }}>
      <Spinner size={LANE_SPIN} color={PLATE_INK} />
    </span>
  );
}

/** The helper's work, as one line under the lane's head: the tool in flight, or the task itself
 *  before the first step lands. An erring lane reads the whole line in the danger ink AND wears the
 *  cause as a chip, since the line alone would say only which step it was on. */
export function Lane({ lane }: { lane: LaneView }) {
  const t = useT();
  const erring = lane.error !== undefined;
  const glyph: IconId = lane.opName ? iconForTool(lane.opName) : 'pw-subagent';
  const verbKey = lane.opName ? verbKeyForTool(lane.opName) : null;
  const phrase = verbKey ? t(verbKey) : lane.task;

  return (
    <div
      data-testid="lane"
      data-erring={erring}
      style={{
        marginLeft: LANE_INDENT,
        background: INSET,
        borderRadius: 8,
        padding: '6px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        boxShadow: 'none',
      }}
    >
      <LaneHead lane={lane} />
      <div
        data-testid="lane-line"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          ...roleFont('note'),
          fontFamily: font.family,
          color: erring ? colors.dangerText : colors.brownText,
        }}
      >
        <span style={{ flex: '0 0 auto', display: 'inline-flex' }}><Icon id={glyph} size={LANE_SPIN} /></span>
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {phrase}
        </span>
        {/* On the lane's own paper, so the chip stands off the inset the way it stands off the plate
            in an op row (prototype `.laneline .rchip{background:var(--plate)}`). */}
        {erring && <span style={{ marginLeft: 'auto', flex: '0 0 auto', background: PLATE, borderRadius: 999 }}>
          <ResultChip tone="bad">{lane.error}</ResultChip>
        </span>}
      </div>
    </div>
  );
}
