/**
 * projection-routing.test.ts — EVERY BYTE THE BACKEND LOGS HAS A DECLARED DESTINATION.
 *
 * The session log is the state and everything else is a projection of it, so a new event kind — or
 * a new field on an existing one — that nobody routed is a silent hole: the loop records a fact and
 * no surface ever shows it, or a surface is owed a fact the log never carries. `deriveView`'s own
 * `never` default already forces a fold decision per KIND; this table forces a decision per FIELD,
 * per systemNote tag and per `ToolResultDetail` member, and says what that decision IS.
 *
 * HOW IT FORCES. The tables are typed exhaustively over the unions in `agent/core/types.ts`
 * (mapped types over `SessionEvent['kind']` and each kind's own payload keys), so adding a kind, a
 * field or a tag without a row here fails `npm run lint` — and removing one leaves an excess row,
 * which fails the same way. The runtime half walks the tables so a malformed route cannot ride in
 * on a type assertion.
 *
 * THE FOUR DESTINATIONS, and what each claims:
 *
 *   ui:     a panel surface renders it — the route names the component or testid.
 *   model:  `project-messages.ts` (or an adapter) sends it back to the provider.
 *   fold:   `project-view.ts` reads it to drive a projected fact (phase, status, a stamp) without
 *           displaying the field itself.
 *   record: kept in the log deliberately UNDISPLAYED — evidence for the run dump, the raw-log
 *           export, or a named future reader. A `record:` route is a decision, not a leftover: its
 *           string says who the record is for.
 *
 * A field may route several ways; it must route at least one.
 */
import { describe, it, expect } from 'vitest';
import type { SessionEvent, ToolResultDetail } from '../../../agent/core/types';

type Kind = SessionEvent['kind'];
type EventOf<K extends Kind> = Extract<SessionEvent, { kind: K }>;
type PayloadKeys<K extends Kind> = Exclude<keyof EventOf<K>, 'kind' | 'seq' | 'at'>;

type Route = `${'ui' | 'model' | 'fold' | 'record'}:${string}`;
type Routes = readonly [Route, ...Route[]];

/** Every field of one kind, `-?` so an optional field still needs its row. */
type FieldTable<K extends Kind> = { [F in PayloadKeys<K>]-?: Routes };

const ROUTING: { [K in Kind]: FieldTable<K> } = {
  order: {
    text: ['ui:ticket-order / answer-order / record headline / history row', 'model:the exchange opener'],
    mapContext: ['model:the <map_context> block on the opener; never shown, it is prompt prose'],
    region: ['ui:ticket-region line + region vignette', 'fold:JobView.region'],
    mapId: ['fold:the rollback guard and the other-map/unknown-map banners key on it'],
  },
  assistant: {
    parts: [
      'ui:says line (live text), op rows (tool parts), thought marks and boxes (reasoning)',
      'model:replayed as the assistant turn',
    ],
    stop: ['fold:DROPPED_STOPS drops the suggestion off a cut turn', 'model:DROPPED_STOPS drops the whole turn from replay'],
    usage: ['record:the log\'s token accounting; no reader today, a token meter would read it here'],
    raw: ['model:the Anthropic dialect echoes signed blocks to their own minter; storage strips it'],
    rawModel: ['model:rawIsAllFrom gates that echo; storage strips it beside raw'],
    error: ['record:the turn\'s own fault as logged; the retry/incident events carry what the panel banners'],
    quirks: ['record:evidence of adapter wire normalization (tool-call-as-prose) for the run dump'],
  },
  toolResult: {
    callId: ['fold:joins the result to its op row', 'model:the tool message\'s id'],
    name: ['ui:the op row\'s verb phrase via tool-meta', 'model:the tool message\'s name'],
    content: ['ui:resultLine → the op row\'s summary and open detail well', 'model:verbatim, it is written for the model'],
    isError: ['ui:the row\'s error status and chip', 'model:the tool message\'s flag'],
    image: ['model:the view_map picture, replayed newest-only; storage strips it, no surface shows it'],
    detail: ['ui:see DETAIL_ROUTING below, member by member'],
    write: ['fold:OpRow.isRead, the build/answer boundary, the reads line'],
    turnSeq: ['record:the occurrence key for a reissued callId; stamped by the loop, no reader today'],
  },
  steer: {
    text: ['ui:SteerQueue rows and the ticket\'s Noted stamps', 'model:delivered as a user message'],
  },
  steerRecalled: {
    steerSeq: ['fold:drops the note from queue and ticket', 'model:suppresses the delivery'],
  },
  steerDelivered: {
    steerSeq: ['fold:moves the note from queue to ticket', 'model:the user message lands here'],
  },
  gateAsked: {
    gateId: ['fold:pairs the ask with its answer'],
    scope: ['ui:which card family stands (tool gate / plan gate)'],
    callId: ['fold:pending-gate status, the map-shot footprint, callApproved provenance'],
    summary: ['ui:gate-summary, verbatim in the locale it was asked in'],
    turnSeq: ['record:the occurrence key, same as toolResult.turnSeq; no reader today'],
    quickAnswers: ['ui:QuickRow pills on the standing ask; the answered card\'s "quick" verdict refinement'],
    options: ['ui:OptionPick cards; the answered card\'s "picked" verdict refinement'],
  },
  gateAnswered: {
    gateId: ['fold:clears the open gate, files the verdict on its ask'],
    answer: ['ui:the verdict chip', 'fold:skipped/words op status, allowAll'],
    words: ['ui:the verdict chip\'s quoted word', 'model:echoed back as "(about your request) …"'],
  },
  plan: {
    stages: ['ui:PlanRail / PlanGate stage rows'],
    revision: ['ui:the "plan revised" stamp above the rail'],
  },
  stage: {
    index: ['ui:the rail\'s current stage and done count', 'fold:stamps later calls with their stage'],
  },
  checkpoint: {
    undoIndex: ['ui:rollback cost arithmetic behind every take-back confirm'],
    label: ['ui:the receipt\'s step rows (stepKey)'],
    stageIndex: ['ui:the per-stage rewind', 'fold:advances the stage stamp'],
  },
  pauseRequested: {},
  paused: {},
  resumed: {
    note: ['record:the log\'s own copy of the resume note; the copy everything reads is the steer queued beside it (composer-routing.ts)'],
  },
  systemNote: {
    text: ['model:replayed as a user message where it landed; the panel shows the damper stamp, not the words'],
    note: ['fold:the damper stamp', 'record:see NOTE_TAG_ROUTING'],
  },
  retry: {
    attempt: ['ui:the retry dock\'s "try n of m" line'],
    cls: ['ui:the retry face\'s icon and wording (RETRY_ICON/RETRY_WORD)'],
    delayMs: ['ui:the TimedButton countdown', 'fold:pacingFloorMs reads the log\'s own retry events'],
  },
  compaction: {
    summary: ['model:the "(conversation summary)" opener; the panel shows the compaction stamp, not the text'],
    retainedFromSeq: ['model:the replay window\'s cut', 'fold:persist prunes behind it'],
  },
  incident: {
    error: [
      'ui:cls keys the banner and the dock\'s trouble face (JobView.errorCls)',
      'record:detail is the redacted provider text, reachable via the banner\'s export-log; never rendered',
    ],
  },
  jobEnd: {
    outcome: ['ui:which terminal card stands (receipt / paper / stop / incident)', 'fold:phase, vitals.jobs'],
    summary: ['ui:the answer paper\'s body and the receipt\'s closing words, as rendered markdown'],
    question: ['ui:the asking dress (spine + quick row) on the settled card', 'fold:celebrate withheld'],
    undoIndex: ['ui:the take-back confirm\'s "n steps, m yours" split'],
  },
};

/** The systemNote tags, each a decision of its own: the once-guards count by tag, and the panel
 *  deliberately collapses both into one damper stamp. A new tag must say what it does here. */
type NoteTag = EventOf<'systemNote'>['note'];
const NOTE_TAG_ROUTING: Record<NoteTag, Routes> = {
  delivery: ['fold:damper stamp', 'record:the loop\'s one-per-job zero-write closing nudge; wording undisplayed'],
  review: ['fold:damper stamp', 'record:the loop\'s one-per-job review invitation; wording undisplayed'],
  'plan-close': ['fold:damper stamp', 'record:the loop\'s one-per-job unfinished-plan closing guard; wording undisplayed'],
};

/** Every `ToolResultDetail` member — the view-only extras a result carries. */
const DETAIL_ROUTING: { [F in keyof ToolResultDetail]-?: Routes } = {
  partialRevert: ['ui:the op row and helper rollup distinguish retained edits from a full rollback'],
  cells: ['fold:vitals.cells', 'record:the run dump\'s totals; no panel meter today'],
  objects: ['fold:vitals.objects', 'record:the run dump\'s totals; no panel meter today'],
  reverted: ['ui:the op row\'s revert status and chip', 'fold:vitals.reverts, writeApplied withheld'],
  regionBlocked: ['ui:the op row\'s blocked status and region chip'],
  skill: ['ui:the op row\'s skill chip, the playbook stamp, the dock\'s skill name'],
  damper: ['ui:the job\'s damper stamp'],
  repeatRefused: ['fold:governor\'s streak counter must not count a refusal as an attempt', 'record:the run dump shows the refusal honestly'],
  childOps: ['ui:laneRollup — the settled delegate row\'s chip'],
  childError: ['ui:laneRollup\'s "helper stopped" chip'],
  violations: ['ui:the detail well\'s localized rule, translated at the well'],
};

const ROUTE_SHAPE = /^(ui|model|fold|record):\S.*$/;

function assertRoutes(owner: string, routes: Routes): void {
  expect(routes.length, `${owner} routes nowhere`).toBeGreaterThan(0);
  for (const route of routes) {
    expect(route, `${owner} carries a malformed route`).toMatch(ROUTE_SHAPE);
  }
}

describe('every log event field has a declared destination', () => {
  it('routes every kind and field', () => {
    for (const [kind, fields] of Object.entries(ROUTING)) {
      for (const [field, routes] of Object.entries(fields as Record<string, Routes>)) {
        assertRoutes(`${kind}.${field}`, routes);
      }
    }
  });

  it('routes every systemNote tag', () => {
    for (const [tag, routes] of Object.entries(NOTE_TAG_ROUTING)) assertRoutes(`systemNote:${tag}`, routes);
  });

  it('routes every ToolResultDetail member', () => {
    for (const [field, routes] of Object.entries(DETAIL_ROUTING)) assertRoutes(`detail.${field}`, routes);
  });
});
