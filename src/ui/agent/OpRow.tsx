/*
 * OpRow.tsx — one line per tool call: an icon, a present-participle verb phrase, what came of it in
 * a word (the result chip) and its END MARK (normative prototype `.op` / `.op .ph2` / `.op .rchip` /
 * `.op .end`). A read tool (`op.isRead`) recedes into the muted ink, matching `.op.read`. A row with
 * something to say opens an inset detail well on click (`.op.open` / `.op .dt`).
 *
 * A REFUSAL IS NEVER SHOWN IN THE MODEL'S OWN WORDS. Every tool answer on this seam is English
 * written FOR a model — "REVERTED:", "OUT OF REGION: this edit reached (61,40) …", a `(system)`
 * nudge, a rule id in brackets with a hint after it — and none of it belongs in a panel that speaks
 * seven languages. So a refused row says the outcome in the user's own language and lifts exactly
 * one fact out of the model's copy: the RULE TEXT, which is the only part a person can act on
 * (`ruleText` below strips the id and the model-facing hint off it, and `Category:` reads bold,
 * since the taxonomy is the lesson). A refusal with nothing left after that treatment falls back to
 * the panel's own sentence. A SUCCESSFUL row's detail is the one deliberate exception: it shows the
 * tool's own first data line verbatim ("Placed 12 trees …"), the per-surface decision
 * `model-prose.tsx`'s header records.
 *
 * A REFUSED row opens on arrival rather than waiting for a click, wherever it has a sentence to
 * give: the prototype ships `open:true` on every one of them, since the reason IS the point of the
 * row. A refusal with nothing to add stays shut.
 *
 * Which glyph and which phrase a tool name draws is `tool-meta.ts`, beside this file: the lane and
 * the past-jobs strip read the same table.
 *
 * `OpsList` is the newest-3-collapse both the flat ticket body and the plan rail's active stage
 * want: beyond three rows, the older ones fold into one count pill (`CountPill`) that expands to the
 * full list on click. Shared here rather than duplicated in JobTicket/PlanRail.
 */
import { Fragment, useState, type ReactNode, type KeyboardEvent } from 'react';
import { motion } from 'framer-motion';
import { amplitude, framerMotion } from './motion';
import { Icon } from './icons';
import { iconForTool, verbKeyForTool } from './tool-meta';
import { CountPill, ResultChip, Stamp, TickDot } from './atoms';
import { Lane, laneRollup, type LaneView } from './Lane';
import { withAlpha } from './tokens';
import { INK, INSET, PLATE_INK } from '../design/tokens';
import { colors, cursors, font } from '../design/styles';
import { roleFont } from '../design/text-weight';
import { useT } from '../../i18n/context';
import type { OpRow as OpRowData } from '../../agent/core/project-view';

/** The tool whose work runs in a helper lane rather than on this row. */
const DELEGATE = 'delegate_task';

/** The rule categories the error taxonomy uses ("Category: reason", `docs/ARCHITECTURE.md`). The
 *  prefix reads BOLD in a detail well, because which rule refused the call is the lesson in it.
 *  ENGLISH ON PURPOSE: this list answers for the rule text lifted out of the MODEL's own copy, which
 *  reaches the panel already translated for the model (`translateFor('en', …)`). A refusal carrying
 *  its rule structurally (`op.detail.violations`) is translated here instead, and its category is
 *  read off the taxonomy's own punctuation — see `boldToColon`. */
const RULE_CATEGORIES = ['Placement', 'Water', 'Terrain', 'Bridge', 'Zone', 'Layer'];

/** A loop-authored note standing where a tool's own answer would be (`project-messages.ts`'s
 *  `(system) …` convention: a nudge, a budget warning, the reissue demand). */
function isSystemNote(text: string): boolean {
  return text.startsWith('(system)');
}

/** The rule text a person can act on, out of the line the model was sent: the bracketed rule id
 *  leads it and a model-facing `Hint:` follows it, and neither means anything here. */
function ruleText(summary: string): string {
  return summary
    .replace(/^\[[^\]]*\]\s*/, '')
    .replace(/\s*Hint:.*$/, '')
    .trim();
}

/** The rule line with its `Category:` prefix in the panel's one emphasis weight (`.op .dt b`). A
 *  bare `<b>` resolves bolder to 900, so the weight is written rather than inherited. */
function withBoldCategory(text: string): ReactNode {
  for (const category of RULE_CATEGORIES) {
    const prefix = `${category}:`;
    if (!text.startsWith(prefix)) continue;
    return (
      <>
        <span style={{ fontWeight: 800 }}>{prefix}</span>
        {text.slice(prefix.length)}
      </>
    );
  }
  return text;
}

/**
 * THE CATEGORY IS THE TAXONOMY'S OWN PUNCTUATION, in whatever language the rule was just said in.
 *
 * Every one of these messages is "Category: reason" by the error-message standard, in all seven
 * locales, and each locale writes the colon its own way (fr spaces it, zh and ja use the fullwidth
 * form). So the prefix is what stands before the first colon — the format itself rather than a guess
 * — and the English name list above cannot answer for a localized string.
 */
function boldToColon(text: string): ReactNode {
  const at = text.search(/[:：]/);
  if (at <= 0 || at > 24) return text;
  return (
    <>
      <span style={{ fontWeight: 800 }}>{text.slice(0, at + 1)}</span>
      {text.slice(at + 1)}
    </>
  );
}

/** The refusal's own rule, said in the reader's language, or nothing where the result carried none
 *  (an older log, a refusal that is not a rule violation at all). */
function localizedRule(op: OpRowData, t: Translate): ReactNode | undefined {
  const first = op.detail?.violations?.[0];
  return first === undefined ? undefined : boldToColon(t(first.message, first.params));
}

/** A translated sentence with a rich fragment standing in for its one `{text}` token. `t()`'s own
 *  interpolation takes strings, and passing the rule text through it would flatten the bold
 *  category back to plain type. */
function withFragment(template: string, node: ReactNode): ReactNode {
  const [before = '', after = ''] = template.split('{text}');
  return <>{before}{node}{after}</>;
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** THE REFUSALS OPEN WITHOUT BEING ASKED, every one of them that has a sentence to give (the
 *  prototype ships `open:true` on each): a closed row reports that something went wrong and hides
 *  what, which is the one thing the user needs from it. A refusal with nothing to add stays shut,
 *  since there is nothing behind it. */
const OPENS_ON_ARRIVAL: ReadonlySet<OpRowData['status']> = new Set<OpRowData['status']>([
  'revert', 'blocked', 'error',
]);

/**
 * What the row's detail well says, in the user's language, or `undefined` for a row with nothing to
 * add (which is also what makes the row unclickable).
 */
function detailFor(op: OpRowData, t: Translate): ReactNode | undefined {
  const text = ruleText(op.summary);
  // THE RULE IN THE READER'S LANGUAGE FIRST. Where the result carried its violation structurally,
  // that is the same refusal the model was sent, keyed — so the well says it in the panel's own
  // locale instead of standing three lines of English inside a Russian card. The model's English
  // copy remains the fallback, for a log written before the carrier existed.
  const rule = localizedRule(op, t);
  if (op.status === 'blocked') return t('agent3.op_detail_region');
  if (op.status === 'revert') {
    if (rule !== undefined) return withFragment(t('agent3.op_detail_put_back'), rule);
    if (text === '' || isSystemNote(text)) return t('agent3.op_reverted_reason');
    return withFragment(t('agent3.op_detail_put_back'), withBoldCategory(text));
  }
  if (op.status === 'error') {
    if (rule !== undefined) return withFragment(t('agent3.op_detail_sent_back'), rule);
    if (isSystemNote(text)) return t('agent3.op_detail_unreadable');
    if (text === '') return undefined;
    return withFragment(t('agent3.op_detail_sent_back'), withBoldCategory(text));
  }
  return op.summary === '' ? undefined : op.summary;
}

/** The chip beside a row: the outcome in a word or two, where the mark alone cannot say it. A live
 *  helper's trouble reads HERE as well as in its lane, so a folded lane never hides it. */
function chipFor(
  op: OpRowData, helper: LaneView | undefined, t: Translate,
): { text: string; tone?: 'warn' | 'bad' } | undefined {
  if (helper?.error !== undefined) return { text: helper.error, tone: 'bad' };
  if (op.name === DELEGATE && helper === undefined) return laneRollup(op.detail, t);
  if (op.skill) return { text: op.skill.title };
  // A row that carries the picture the model was shown says so at a glance; the click opens it.
  if (op.image !== undefined) return { text: t('agent3.op_chip_saw') };
  if (op.status === 'blocked') return { text: t('agent3.op_chip_region') };
  if (op.status === 'revert') return { text: t('agent3.op_chip_put_back'), tone: 'warn' };
  if (op.status === 'skipped') return { text: t('agent3.op_chip_declined') };
  if (op.status === 'words') return { text: t('agent3.op_chip_words') };
  if (op.status === 'error' && isSystemNote(ruleText(op.summary))) {
    return { text: t('agent3.op_chip_unreadable'), tone: 'bad' };
  }
  return undefined;
}

function activate(e: KeyboardEvent<HTMLDivElement>, fn: () => void) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fn();
  }
}

/** How far a fresh row rises from, per its declaration. */
const ROW_RISE = amplitude('panel.op.enter') ?? 0;

/** The statuses whose row is a PROPOSAL rather than a record of work: a call awaiting an answer, one
 *  the answer turned into words, one the user declined. Drawn as the dashed ghost row
 *  (`.op.ghostrow`) — an outline around something that did not happen. */
const GHOST_ROWS: ReadonlySet<OpRowData['status']> = new Set<OpRowData['status']>([
  'pending-gate', 'words', 'skipped',
]);

/** The dashed ghost outline's own ink (prototype `.op.ghostrow`), derived from the house ink so the
 *  two cannot drift. */
const GHOST_EDGE = `1px dashed ${withAlpha(INK, 0.35)}`;

/** One op, one line.
 *
 *  A ROW ARRIVES FROM BELOW (`panel.op.enter`, the prototype's `blockEnter`): it is the next line of
 *  a record being written, and a line that appeared in place read as a redraw of the whole ticket.
 *  Only a NEW row animates — `OpsList` keys by `callId`, so an existing row re-rendering with a new
 *  status is the same element and stands still while its mark reports instead.
 *
 *  `lane` is the LIVE helper lane, and `OpsList` hands the SAME one to every row in the job — there
 *  is only ever one child in flight, but a job that delegates twice carries one SETTLED row beside
 *  it, and the settled one must not wear the live helper's lane. This row alone decides whether the
 *  lane is its business: `delegate_task` AND still `run`ning. A settled delegate row builds its own
 *  from the record the call left behind instead (`laneRollup`). */
export function OpRow({ op, lane }: { op: OpRowData; lane?: LaneView }) {
  const t = useT();
  const verbKey = verbKeyForTool(op.name);
  const phrase = verbKey ? t(verbKey) : op.name;
  // A LANE ONLY STANDS WHILE THE HELPER DOES: a settled call's child log is gone, and what it left
  // behind rolls up onto this row as a chip instead (`laneRollup`).
  const helper = op.name === DELEGATE && op.status === 'run' ? lane : undefined;
  const detail = detailFor(op, t);
  const chip = chipFor(op, helper, t);
  const canOpen = detail !== undefined || op.image !== undefined;
  const [open, setOpen] = useState(canOpen && OPENS_ON_ARRIVAL.has(op.status));
  const muted = op.isRead;
  const ghost = GHOST_ROWS.has(op.status);
  const toggle = () => canOpen && setOpen((o) => !o);
  const ink = muted || ghost ? colors.brownText : PLATE_INK;

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: ROW_RISE }}
        animate={{ opacity: 1, y: 0 }}
        transition={framerMotion('panel.op.enter')}
        data-testid="op-row"
        data-status={op.status}
        data-open={open}
        data-muted={muted}
        data-ghost={ghost}
        role={canOpen ? 'button' : undefined}
        tabIndex={canOpen ? 0 : undefined}
        onClick={canOpen ? toggle : undefined}
        onKeyDown={canOpen ? (e) => activate(e, toggle) : undefined}
        style={{
          display: 'flex',
          alignItems: open ? 'flex-start' : 'center',
          gap: 8,
          padding: open ? '6px' : '4px 6px',
          borderRadius: 8,
          background: open ? INSET : 'transparent',
          border: ghost ? GHOST_EDGE : undefined,
          cursor: canOpen ? cursors.clickable : cursors.default,
          boxShadow: 'none',
        }}
      >
        <span
          style={{
            flex: '0 0 auto',
            width: 16,
            height: 16,
            marginTop: open ? 2 : 0,
            color: ink,
          }}
        >
          <Icon id={iconForTool(op.name)} size={16} />
        </span>
        <span style={{ flex: '1 1 auto', minWidth: 0 }}>
          <span
            data-testid="op-phrase"
            style={{
              ...roleFont('label'),
              fontFamily: font.family,
              color: ink,
              display: 'block',
              whiteSpace: open ? 'normal' : 'nowrap',
              overflow: open ? 'visible' : 'hidden',
              textOverflow: open ? 'clip' : 'ellipsis',
            }}
          >
            {phrase}
          </span>
          {open && detail !== undefined && (
            <span
              data-testid="op-detail"
              style={{
                ...roleFont('note'),
                fontFamily: font.family,
                color: colors.brownText,
                display: 'block',
                marginTop: 2,
                lineHeight: 1.35,
                // A tool's data line can be one long coordinate list or URL with no space in it.
                overflowWrap: 'anywhere',
              }}
            >
              {detail}
            </span>
          )}
          {/* WHAT THE MODEL SAW, shown to the reader whole: the record must let a person check the
              model's eyes against their own map. Live sessions only — persistence strips images, so
              a rehydrated row keeps its summary line and the chip alone says a look happened. */}
          {open && op.image !== undefined && (
            <img
              data-testid="op-image"
              src={op.image}
              alt={t('agent3.op_view_alt')}
              style={{ display: 'block', width: '100%', marginTop: 6, borderRadius: 8, border: `1px solid ${withAlpha(INK, 0.15)}` }}
            />
          )}
        </span>
        {/* The detail line carries the whole answer, so the chip yields its space while open. */}
        {!open && chip !== undefined && <ResultChip {...(chip.tone ? { tone: chip.tone } : {})}>{chip.text}</ResultChip>}
        <span style={{ flex: '0 0 auto', marginTop: open ? 2 : 0 }}>
          <TickDot status={op.status} />
        </span>
      </motion.div>
      {helper && <Lane lane={helper} />}
      {/* A playbook says whose recipe the ops BELOW it follow, so the stamp stands with the call
          that opened it rather than at the foot of the whole job. Only a STYLE skill is a playbook:
          a method is transferable craft and names no set piece to build from. */}
      {op.skill?.kind === 'style' && (
        <Stamp icon="pw-skill">{t('agent3.stamp_skill', { title: op.skill.title })}</Stamp>
      )}
    </>
  );
}

/** How many op rows a collapsed list keeps showing. */
const TAIL = 3;

interface OpsListProps {
  ops: readonly OpRowData[];
  lane?: LaneView;
  /**
   * WHAT ELSE STANDS IN THE LIST, by the index of the op row it files ABOVE (`ops.length` for what
   * files after the last one). The per-turn thought marks are the one caller: their open state is
   * the ticket's own, so the ticket builds the node and this list only decides where it goes — and
   * a mark whose row the collapse has folded away folds with it, like anything else up there.
   */
  marks?: (index: number) => ReactNode;
}

/** The newest 3 op rows; anything older folds into one count pill naming the total AND the tail it
 *  left visible, which expands to the full list on click (prototype: `I.count('9 steps')` standing
 *  ahead of the rows it kept). Fewer than 4 ops never collapses — there is nothing behind the pill
 *  to hide. */
export function OpsList({ ops, lane, marks }: OpsListProps) {
  const [expanded, setExpanded] = useState(false);
  const overflow = ops.length > TAIL;
  const first = expanded || !overflow ? 0 : ops.length - TAIL;
  const visible = ops.slice(first);

  return (
    <div data-testid="ops-list" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {overflow && !expanded && (
        <CountPill total={ops.length} shown={TAIL} onClick={() => setExpanded(true)} />
      )}
      {visible.map((op, i) => (
        <Fragment key={op.callId}>
          {marks?.(first + i)}
          <OpRow op={op} {...(lane ? { lane } : {})} />
        </Fragment>
      ))}
      {/* A turn that thought and called nothing files after every row there is: it is the newest
          thing that happened, and the rows below it do not exist yet. */}
      {marks?.(ops.length)}
    </div>
  );
}
