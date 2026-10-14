// @vitest-environment jsdom
/**
 * The panel's text seats against the worst strings the backend can hand them, through the CSS that
 * decides whether a hostile string wraps, ellipsizes or leaves its card:
 *
 *   wrapping seats (prose, orders, details, stamps, lane names) need `overflow-wrap: anywhere`, or
 *   one unbroken token such as a 500-char URL overflows the card or is clipped mid-word;
 *
 *   one-line seats (the op phrase, result chips, the verdict word, a queued steer) need `nowrap`,
 *   `hidden` and `ellipsis`, or the row's controls are pushed off the edge.
 *
 * jsdom lays nothing out, so the declared style is read off the element.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { I18nProvider } from '../../../i18n/context';
import { AnswerPaper } from '../../../ui/agent/record/AnswerPaper';
import { ArchiveCard } from '../../../ui/agent/record/ArchiveCard';
import { GateBlock } from '../../../ui/agent/record/GateBlock';
import { JobTicket } from '../../../ui/agent/record/JobTicket';
import { Lane } from '../../../ui/agent/record/Lane';
import { ModelProse, INLINE_PROSE_STYLE } from '../../../ui/agent/parts/model-prose';
import { OpsList } from '../../../ui/agent/record/OpRow';
import { Stamp } from '../../../ui/agent/parts/panel-parts';
import type { AskRecord, JobView, OpRow as OpRowData } from '../../../agent/core/project-view';

/** One operation row as every list draws it: a single-row `OpsList`. */
function OpRow({ op }: { op: OpRowData }) {
  return <OpsList ops={[op]} />;
}

const backing = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
};

beforeEach(() => backing.clear());

function Wrapper({ children }: { children: React.ReactNode }) {
  return <I18nProvider>{children}</I18nProvider>;
}

const renderWithI18n = (node: React.ReactElement) => render(node, { wrapper: Wrapper });

/** One unbroken token longer than any card is wide: the shape a model id, a URL or a pasted hash
 *  actually takes. No spaces, so only `overflow-wrap: anywhere` can break it. */
const TOKEN = `https://example.com/${'a'.repeat(480)}`;

function makeJob(over: Partial<JobView> = {}): JobView {
  return {
    orderSeq: 1,
    orderText: TOKEN,
    orderAt: 0,
    asks: [],
    ops: [],
    steerNotes: [],
    checkpoints: [],
    stamps: [],
    celebrate: false,
    skills: [],
    ...over,
  };
}

const wraps = (el: HTMLElement) => el.style.overflowWrap;

describe('wrapping seats break an unbroken token instead of overflowing', () => {
  it('ModelProse carries overflow-wrap on its container (answer body, summaries, thoughts)', () => {
    const { getByTestId } = renderWithI18n(<ModelProse text={TOKEN} testId="prose" />);
    expect(wraps(getByTestId('prose'))).toBe('anywhere');
  });

  it('the says line carries it through INLINE_PROSE_STYLE', () => {
    expect(INLINE_PROSE_STYLE.overflowWrap).toBe('anywhere');
    const { getByTestId } = renderWithI18n(
      <JobTicket job={makeJob({ says: TOKEN })} live />,
    );
    expect(wraps(getByTestId('says-line'))).toBe('anywhere');
  });

  it('the ticket order line wraps the token inside its two-line clamp', () => {
    const { getByTestId } = renderWithI18n(<JobTicket job={makeJob()} live />);
    expect(wraps(getByTestId('ticket-order'))).toBe('anywhere');
  });

  it('the answer paper order line does too', () => {
    const { getByTestId } = renderWithI18n(
      <AnswerPaper job={makeJob({ outcome: 'done', kind: 'answer', summary: 'Done.' })} />,
    );
    expect(wraps(getByTestId('answer-order'))).toBe('anywhere');
  });

  it('the settled record headline does too', () => {
    const { getByTestId } = renderWithI18n(
      <ArchiveCard job={makeJob({ outcome: 'done', kind: 'build' })} />,
    );
    expect(wraps(getByTestId('ticket-order'))).toBe('anywhere');
  });

  it('the gate summary wraps whatever the call describer interpolated into it', () => {
    const ask: AskRecord = { gateId: 'g1', scope: 'tool', summary: TOKEN };
    const { getByTestId } = renderWithI18n(
      <GateBlock ask={ask} onAnswer={() => {}} />,
    );
    expect(wraps(getByTestId('gate-summary'))).toBe('anywhere');
  });

  it("the op row's open detail well wraps the tool's own line", () => {
    const op: OpRowData = {
      callId: 'c1', name: 'paint_terrain', status: 'error', summary: TOKEN, isRead: false,
    };
    const { getByTestId } = renderWithI18n(<OpRow op={op} />);
    // An erring row opens on arrival, so the well is already standing.
    expect(wraps(getByTestId('op-detail'))).toBe('anywhere');
  });

  it('a stamp (steer notes ride it) wraps inside its clamp', () => {
    const { getByTestId } = renderWithI18n(<Stamp icon="pw-note">{TOKEN}</Stamp>);
    expect(wraps(getByTestId('stamp-text'))).toBe('anywhere');
  });

  it("the helper lane's name wraps the model-authored task", () => {
    const { getByTestId } = renderWithI18n(<Lane lane={{ task: TOKEN, ops: 0 }} />);
    expect(wraps(getByTestId('lane-name'))).toBe('anywhere');
  });
});

describe('one-line seats ellipsize instead of pushing their row apart', () => {
  it('the closed op phrase is nowrap + hidden + ellipsis', () => {
    const op: OpRowData = { callId: 'c2', name: TOKEN, status: 'ok', summary: '', isRead: false };
    const { getByTestId } = renderWithI18n(<OpRow op={op} />);
    const phrase = getByTestId('op-phrase');
    expect(phrase.style.whiteSpace).toBe('nowrap');
    expect(phrase.style.overflow).toBe('hidden');
    expect(phrase.style.textOverflow).toBe('ellipsis');
  });

  it("the lane's in-flight line ellipsizes", () => {
    const { getByTestId } = renderWithI18n(<Lane lane={{ task: 'short', ops: 1, opName: 'view_map' }} />);
    const line = getByTestId('lane-line');
    const span = line.querySelector<HTMLElement>('span:nth-of-type(2)');
    expect(span?.style.textOverflow).toBe('ellipsis');
    expect(span?.style.whiteSpace).toBe('nowrap');
  });
});
