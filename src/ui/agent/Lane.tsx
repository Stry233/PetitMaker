import { displayAgentText } from '../../agent/tool-labels';
/*
 * Shows a `delegate_task` child's live work inside the parent ticket: its name, step count, current
 * tool and any retry or error. When the child settles, `laneRollup` reduces its retained operation
 * details to a result chip on the delegate row. Errors remain visible in both places while live
 * because the nested lane may be hidden by a collapsed operation list.
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

/** Lane indentation in CSS pixels, separating child work from the parent's next step. */
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
  if (ops.some((o) => o.status === 'revert')) return { text: t(detail.partialRevert ? 'agent3.op_chip_partial' : 'agent3.op_chip_put_back'), tone: 'warn' };
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
    : t('agent3.lane_helper', { task: displayAgentText(helperName(lane), t) });
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
      {/* Model-authored helper names wrap to two lines instead of ellipsizing their identifying text. */}
      <span
        data-testid="lane-name"
        style={{
          ...roleFont('small'),
          fontFamily: font.family,
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
  const phrase = verbKey ? t(verbKey) : displayAgentText(lane.task, t);

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
        {/* The plate background separates the result chip from the lane's inset paper. */}
        {erring && <span style={{ marginLeft: 'auto', flex: '0 0 auto', background: PLATE, borderRadius: 999 }}>
          <ResultChip tone="bad">{t('agent3.op_detail_failed')}</ResultChip>
        </span>}
      </div>
    </div>
  );
}
