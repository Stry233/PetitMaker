/**
 * job-ticket.test.tsx — the job ticket at its final grammar: the sticky order line, the region it
 * was filed under, the tape, the says line, the op rows with their end marks and result chips, the
 * plan rail's rollups and flags, and a hold's own mark and verbs.
 *
 * `JobTicket`/`OpRow`/`PlanRail` all read `useT()`, so every render here goes through
 * `I18nProvider` (matching `__tests__/ui/agent/header-row.test.tsx`'s own wrapper) with a stubbed
 * `localStorage` the store's persistence can write to safely in jsdom.
 *
 * Colour assertions push both sides of a comparison through the same DOM round-trip
 * (`asColor`), mirroring atoms.test.tsx — jsdom's cssstyle can normalize a hex differently from a
 * var()-free literal though the two agree in meaning.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, fireEvent } from '@testing-library/react';
import { I18nProvider } from '../../../i18n/context';
import { translations } from '../../../i18n/translations';
import { useEditorStore } from '../../../state/store';
import { JobTicket } from '../../../ui/agent/JobTicket';
import { OpRow } from '../../../ui/agent/OpRow';
import { tickInk } from '../../../ui/agent/tokens';
import { ACTIVE, INK } from '../../../ui/design/tokens';
import type { JobView, OpRow as OpRowData } from '../../../agent/core/project-view';
import type { Locale } from '../../../core/model/types';

const backing = new Map<string, string>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).localStorage = {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
};

function Wrapper({ children }: { children: React.ReactNode }) {
  return <I18nProvider>{children}</I18nProvider>;
}

function renderWithI18n(node: React.ReactElement) {
  return render(node, { wrapper: Wrapper });
}

beforeEach(() => {
  backing.clear();
  act(() => useEditorStore.setState({ locale: 'en' }));
});

function asColor(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

function asBackground(value: string): string {
  const probe = document.createElement('span');
  probe.style.background = value;
  return probe.style.background;
}

let opSeq = 0;
function makeOp(over: Partial<OpRowData> = {}): OpRowData {
  opSeq += 1;
  return {
    callId: `op-${opSeq}`,
    name: 'place_object',
    status: 'ok',
    summary: '',
    isRead: false,
    ...over,
  };
}

function makeJob(over: Partial<JobView> = {}): JobView {
  return {
    orderSeq: 1,
    orderText: 'Build a fishing village on the east shore',
    orderAt: 0,
    ops: [],
    steerNotes: [],
    checkpoints: [],
    stamps: [],
    celebrate: false,
    asks: [],
    skills: [],
    ...over,
  };
}

describe('JobTicket: plan rail presence', () => {
  it('a planless job renders no plan rail element at all', () => {
    const job = makeJob({ ops: [makeOp()] });
    const { queryByTestId } = renderWithI18n(<JobTicket job={job} live />);
    expect(queryByTestId('plan-rail')).toBeNull();
  });

  it('a job with a plan renders exactly one plan rail, and no bare ops list beside it', () => {
    const job = makeJob({
      ops: [makeOp()],
      plan: { stages: [{ label: 'Stage A' }, { label: 'Stage B' }], currentIndex: 0, doneCount: 0, revision: 1 },
    });
    const { getAllByTestId } = renderWithI18n(<JobTicket job={job} live />);
    expect(getAllByTestId('plan-rail').length).toBe(1);
  });
});

describe('JobTicket: newest-3 collapse', () => {
  it('collapses ops beyond the newest 3 into one count pill; expanding shows all', () => {
    const ops = Array.from({ length: 5 }, () => makeOp());
    const job = makeJob({ ops });
    const { getAllByTestId, getByTestId, queryByTestId } = renderWithI18n(<JobTicket job={job} live />);
    expect(getAllByTestId('op-row').length).toBe(3);
    const pill = getByTestId('ops-count-pill');
    // The pill names the tail it left showing, not just the total: "5 steps" over three rows would
    // read as a claim that all five are drawn below it.
    expect(pill.textContent).toBe('5 steps, last 3');
    fireEvent.click(pill);
    expect(getAllByTestId('op-row').length).toBe(5);
    expect(queryByTestId('ops-count-pill')).toBeNull();
  });

  it('never collapses 3 or fewer ops', () => {
    const ops = Array.from({ length: 3 }, () => makeOp());
    const job = makeJob({ ops });
    const { getAllByTestId, queryByTestId } = renderWithI18n(<JobTicket job={job} live />);
    expect(getAllByTestId('op-row').length).toBe(3);
    expect(queryByTestId('ops-count-pill')).toBeNull();
  });
});

describe('OpRow: one line, expandable detail, muted read tools', () => {
  it('renders a readable verb and keeps model-facing read data out of the detail well', () => {
    const op = makeOp({ name: 'view_map', status: 'ok', summary: 'view_map: terrain_type=water object_id=obj-4' });
    const { getByTestId, queryByTestId } = renderWithI18n(<OpRow op={op} />);
    const row = getByTestId('op-row');
    expect(row.querySelector('use')).not.toBeNull();
    expect(getByTestId('op-phrase').textContent).toBe('Viewing the map');
    expect(getByTestId('tick-dot')).not.toBeNull();
    expect(row.getAttribute('data-open')).toBe('false');
    expect(queryByTestId('op-detail')).toBeNull();

    fireEvent.click(row);
    expect(row.getAttribute('data-open')).toBe('false');
    expect(queryByTestId('op-detail')).toBeNull();
  });

  it('a row carrying the picture the model saw says so as a chip, and opens to the picture itself', () => {
    const op = makeOp({ name: 'view_map', status: 'ok', summary: 'Rendered view attached.', image: 'data:image/png;base64,AAAA', isRead: true });
    const { getByTestId, queryByTestId, getByText } = renderWithI18n(<OpRow op={op} />);
    getByText('saw the map');
    expect(queryByTestId('op-image')).toBeNull();
    fireEvent.click(getByTestId('op-row'));
    const img = getByTestId('op-image') as HTMLImageElement;
    expect(img.src).toBe('data:image/png;base64,AAAA');
    // The alt is the reader's caption, so it is a localized string rather than a file name.
    expect(img.alt).not.toBe('');
  });

  it('marks a read tool\'s row muted', () => {
    const readOp = makeOp({ name: 'get_objects', isRead: true });
    const writeOp = makeOp({ name: 'place_object', isRead: false });
    const read = renderWithI18n(<OpRow op={readOp} />);
    const readRow = read.container.querySelector('[data-testid="op-row"]') as HTMLElement;
    read.unmount();
    const write = renderWithI18n(<OpRow op={writeOp} />);
    const writeRow = write.container.querySelector('[data-testid="op-row"]') as HTMLElement;
    expect(readRow.getAttribute('data-muted')).toBe('true');
    expect(writeRow.getAttribute('data-muted')).toBe('false');
  });

  it('a row with nothing to say is not clickable', () => {
    const op = makeOp({ name: 'place_object', status: 'run', summary: '' });
    const { getByTestId } = renderWithI18n(<OpRow op={op} />);
    expect(getByTestId('op-row').getAttribute('role')).toBeNull();
  });
});

describe('PlanRail (via JobTicket): stages and the active stage\'s nested ops', () => {
  const plan: NonNullable<JobView['plan']> = {
    stages: [{ label: 'Read the shoreline' }, { label: 'Lay the boardwalk' }, { label: 'Plant the pines' }],
    currentIndex: 1,
    doneCount: 1,
    revision: 1,
  };

  it('marks done stages with a drawn check, turns a loader in the active box, and dims pending ones', () => {
    const ops = [makeOp({ name: 'place_object', status: 'run' })];
    const job = makeJob({ plan, ops });
    const { getAllByTestId } = renderWithI18n(<JobTicket job={job} live />);
    const stages = getAllByTestId('plan-stage');
    expect(stages.length).toBe(3);
    expect(stages[0]!.getAttribute('data-state')).toBe('done');
    expect(stages[1]!.getAttribute('data-state')).toBe('now');
    expect(stages[2]!.getAttribute('data-state')).toBe('todo');

    const boxes = getAllByTestId('stage-box');
    expect(boxes[0]!.querySelector('use')?.getAttribute('href')).toBe('#pw-check');
    // The stage being worked is the one place on the rail where something is happening.
    expect(boxes[1]!.querySelector('.pw-busy')).not.toBeNull();

    const pendingLabel = stages[2]!.querySelector('[data-testid="plan-stage-label"]') as HTMLElement;
    expect(Number(pendingLabel.style.opacity)).toBeLessThan(1);
  });

  /** How much of the active stage's work did not stick, which a bare label cannot say. Only the
   *  ACTIVE stage can carry one: the view holds a single flat op list for the whole job, so there is
   *  nothing to count a finished stage's reverts from. */
  it('rolls up the active stage\'s reverts, and puts the pill on no other stage', () => {
    const ops = [
      makeOp({ name: 'carve_river', status: 'revert' }),
      makeOp({ name: 'place_object', status: 'ok' }),
    ];
    const { getAllByTestId, getAllByTestId: all } = renderWithI18n(<JobTicket job={makeJob({ plan, ops })} live />);
    const rollups = all('stage-rollup');
    expect(rollups.length).toBe(1);
    expect(rollups[0]!.textContent).toBe('1 put back');
    expect(getAllByTestId('plan-stage')[1]!.querySelector('[data-testid="stage-rollup"]')).not.toBeNull();
  });

  it('grows no rollup where every step stuck', () => {
    const ops = [makeOp({ name: 'place_object', status: 'ok' })];
    const { queryAllByTestId } = renderWithI18n(<JobTicket job={makeJob({ plan, ops })} live />);
    expect(queryAllByTestId('stage-rollup').length).toBe(0);
  });

  /** The stages the user was told the assistant would stop at keep saying so while the plan runs. */
  it('keeps an approved plan\'s checkpoint flags on the rail', () => {
    const flagged: NonNullable<JobView['plan']> = {
      stages: [{ label: 'Terrace' , checkpoint: true }, { label: 'Carve' }, { label: 'Build', checkpoint: true }],
      currentIndex: 1, doneCount: 1, revision: 1,
    };
    const { getAllByTestId, queryAllByTestId } = renderWithI18n(<JobTicket job={makeJob({ plan: flagged })} live />);
    expect(queryAllByTestId('stage-flag').length).toBe(2);
    const stages = getAllByTestId('plan-stage');
    expect(stages[1]!.querySelector('[data-testid="stage-flag"]')).toBeNull();
  });

  it('nests the active stage\'s live op row under it, and only there', () => {
    const ops = [makeOp({ name: 'place_object', status: 'run' })];
    const job = makeJob({ plan, ops });
    const { getAllByTestId } = renderWithI18n(<JobTicket job={job} live />);
    const stages = getAllByTestId('plan-stage');
    expect(stages[1]!.querySelector('[data-testid="op-row"]')).not.toBeNull();
    expect(stages[0]!.querySelector('[data-testid="op-row"]')).toBeNull();
    expect(stages[2]!.querySelector('[data-testid="op-row"]')).toBeNull();
  });

  it('offers a done stage its own rewind, and hands the press the whole checkpoint', () => {
    const onRewind = vi.fn();
    const checkpoints: JobView['checkpoints'] = [
      { undoIndex: 7, label: 'stage', stageIndex: 0 },
      { undoIndex: 31, label: 'write' },
    ];
    const job = makeJob({ plan, ops: [], checkpoints });
    const { getAllByTestId } = renderWithI18n(<JobTicket job={job} live onRewind={onRewind} />);
    const buttons = getAllByTestId('plan-rewind');
    // Only the DONE stage the checkpoint named, so one control on a three-stage rail.
    expect(buttons.length).toBe(1);
    fireEvent.click(buttons[0]!);
    // The checkpoint ITSELF, not its index: `undoIndex` is the watermark the shell rewinds to, and
    // FlipTicket's rewind speaks the same shape.
    expect(onRewind).toHaveBeenCalledWith({ undoIndex: 7, label: 'stage', stageIndex: 0 });
  });

  it('names a stage the model left blank rather than drawing a nameless rung', () => {
    const blank: NonNullable<JobView['plan']> = {
      stages: [{ label: '   ' }, { label: 'Lay the boardwalk' }],
      currentIndex: 1,
      doneCount: 1,
      revision: 1,
    };
    const { getAllByTestId } = renderWithI18n(<JobTicket job={makeJob({ plan: blank })} live />);
    const labels = getAllByTestId('plan-stage-label');
    expect(labels[0]!.textContent).toBe('Stage 1');
    expect(labels[1]!.textContent).toBe('Lay the boardwalk');
  });

  it('joins every stage but the last with a connecting spine', () => {
    const job = makeJob({ plan, ops: [] });
    const { getAllByTestId, queryAllByTestId } = renderWithI18n(<JobTicket job={job} live />);
    const stages = getAllByTestId('plan-stage');
    const connectors = queryAllByTestId('stage-connector');
    // Three stages produce two connecting spines; the last stage has no continuation.
    expect(connectors.length).toBe(2);
    expect(stages[0]!.querySelector('[data-testid="stage-connector"]')).not.toBeNull();
    expect(stages[1]!.querySelector('[data-testid="stage-connector"]')).not.toBeNull();
    expect(stages[2]!.querySelector('[data-testid="stage-connector"]')).toBeNull();
  });

  /** An active last stage keeps its spine beside the nested operation rows. */
  it('grows the last stage a spine when it is the one nesting the work', () => {
    const onLast: NonNullable<JobView['plan']> = {
      stages: [{ label: 'A' }, { label: 'B' }], currentIndex: 1, doneCount: 1, revision: 1,
    };
    const job = makeJob({ plan: onLast, ops: [makeOp({ status: 'run' })] });
    const { getAllByTestId } = renderWithI18n(<JobTicket job={job} live />);
    expect(getAllByTestId('plan-stage')[1]!.querySelector('[data-testid="stage-connector"]')).not.toBeNull();
  });
});

describe('OpRow: a reverted row', () => {
  it('states that a partially reverted edit still has changes on the map', () => {
    const op = makeOp({
      name: 'paint_terrain', status: 'revert',
      detail: { reverted: true, partialRevert: true, cells: 1 },
    });
    const { getByTestId, container } = renderWithI18n(<OpRow op={op} />);
    expect(getByTestId('op-detail').textContent).toContain('The rest remain on the map.');
    expect(container.textContent).not.toContain('Put back:');
    fireEvent.click(getByTestId('op-row'));
    expect(container.textContent).toContain('partly kept');
  });

  it('shows the amber mark and a friendly reason, and never the raw REVERTED prefix', () => {
    // What the fold hands the row is already the rule LINE rather than the tool's own banner
    // (`project-view.ts:resultLine`), which is the whole point of that treatment.
    const op = makeOp({
      name: 'carve_river',
      status: 'revert',
      summary: '[V-WTR-02] Water: the pond needs a closed bank at (3,4). Hint: ring it first.',
      detail: { reverted: true },
    });
    const { getByTestId, container } = renderWithI18n(<OpRow op={op} />);
    const row = getByTestId('op-row');
    // A revert opens on arrival: the friendly reason is the point of the row.
    expect(row.getAttribute('data-open')).toBe('true');
    expect(asColor(getByTestId('tick-dot').style.color)).toBe(asColor(tickInk.revert));
    const detail = getByTestId('op-detail');
    expect(container.textContent).not.toContain('REVERTED');
    // Older logs without a keyed rule receive a localized explanation.
    expect(detail.textContent).toContain('The edit broke a rule and was undone.');
    expect(detail.textContent).not.toContain('V-WTR-02');
    expect(detail.textContent).not.toContain('Hint:');
    expect(detail.textContent).not.toContain('Put back:');
  });

  it('does not expose diagnostics from older tool failures', () => {
    const op = makeOp({ name: 'place_object', status: 'error', summary: '[V-PLACE-TRAIT] Placement: catalogId=building-house failed in place_object' });
    const { getByTestId } = renderWithI18n(<OpRow op={op} />);
    expect(getByTestId('op-detail').textContent).toBe(translations.en['agent3.op_detail_failed']);
  });

  /**
   * A REFUSAL REACHES THE READER IN THEIR OWN LANGUAGE, and the model's copy stays English.
   *
   * `tools-common.ts:formatErrors` writes the tool result FOR the model (`translateFor('en', …)`),
   * which is right — the model reasons over stable rule feedback. A panel that lifted the rule out
   * of that copy and showed it as-is would hand a Russian card three lines of English for a sentence
   * that ships keyed in all seven locales. The refusal travels as its rule
   * (`ToolResultDetail.violations`) and the well translates it.
   */
  it.each([
    ['ru', 'Размещение:'],
    ['zh', '放置：'],
    ['fr', 'Placement :'],
  ] as const)('says the rule in the reader s own language (%s)', (locale, category) => {
    act(() => useEditorStore.setState({ locale }));
    const op = makeOp({
      name: 'place_object',
      status: 'error',
      summary: '[V-PLACE-TRAIT] Placement: requires flat ground with no elevation change or water nearby. Hint: ask first.',
      detail: { violations: [{ ruleId: 'V-PLACE-TRAIT', message: 'error.placement_not_flat' }] },
    });
    const { getByTestId } = renderWithI18n(<OpRow op={op} />);
    const detail = getByTestId('op-detail');
    expect(detail.textContent).toContain(translations[locale]['error.placement_not_flat']!.replace(/^[^:\uff1a]{1,24}[:\uff1a]\s*/, ''));
    expect(detail.textContent, 'no English left standing').not.toContain('requires flat ground');
    expect(detail.textContent).not.toContain(category);
    act(() => useEditorStore.setState({ locale: 'en' }));
  });

  /** Every locale says the app sent something TO the model; ru's genitive said the model had
   *  ANSWERED, which is the opposite of what happened — a rule refused the call. */
  it('names the direction of a sent-back refusal the same way in every locale', () => {
    for (const locale of Object.keys(translations) as Locale[]) {
      const line = translations[locale]['agent3.op_detail_sent_back']!;
      expect(line, locale).toContain('{text}');
      expect(line, locale).not.toBe(translations[locale]['agent3.op_detail_put_back']);
    }
    // The one that reversed: "Ответ модели" reads as the model's own answer.
    expect(translations.ru['agent3.op_detail_sent_back']).not.toContain('Ответ модели');
  });

  /** A region rollback is refused work rather than broken work: the outline shield in the revert
   *  ink, its own chip, and the sentence open on arrival. */
  it('renders a region-blocked row with the shield, the kept-in-region chip and its reason', () => {
    const op = makeOp({
      name: 'place_object',
      status: 'blocked',
      summary: 'OUT OF REGION: this edit reached (61,40), outside the region the user selected.',
      detail: { regionBlocked: true },
    });
    const { getByTestId, container } = renderWithI18n(<OpRow op={op} />);
    expect(getByTestId('op-row').getAttribute('data-open')).toBe('true');
    expect(getByTestId('tick-dot').querySelector('use')?.getAttribute('href')).toBe('#pw-shield-hold');
    expect(getByTestId('op-detail').textContent).toContain('outside the area you marked');
    expect(container.textContent).not.toContain('OUT OF REGION');
    // The chip yields its space to the open detail, so it reads once the row is folded shut.
    fireEvent.click(getByTestId('op-row'));
    expect(getByTestId('op-chip').textContent).toBe('kept in your region');
  });

  /** A call the turn was cut off mid-arguments never reached a tool at all: the loop's own
   *  `(system)` demand for a reissue is what the model was sent, and the panel says it plainly. */
  it('renders an unreadable call in the panel\'s own words, never the system note', () => {
    const op = makeOp({
      name: 'build_road',
      status: 'error',
      summary: '(system) The turn was cut off before the arguments were complete.',
    });
    const { getByTestId, container, queryByTestId } = renderWithI18n(<OpRow op={op} />);
    // A refusal with a sentence opens on arrival, and its chip yields the space to it.
    expect(getByTestId('op-row').getAttribute('data-open')).toBe('true');
    expect(queryByTestId('op-chip')).toBeNull();
    expect(getByTestId('op-detail').textContent).toContain('asked for that wrong');
    expect(container.textContent).not.toContain('(system)');
  });

  /** A proposal is not a record of work: a call awaiting an answer, one the answer turned into
   *  words and one the user declined all wear the dashed outline. */
  it('draws the three proposal rows as ghosts, and a landed one plainly', () => {
    for (const status of ['pending-gate', 'words', 'skipped'] as const) {
      const view = renderWithI18n(<OpRow op={makeOp({ status })} />);
      expect(view.getByTestId('op-row').getAttribute('data-ghost'), status).toBe('true');
      expect(view.getByTestId('op-row').style.border, status).toContain('dashed');
      view.unmount();
    }
    const plain = renderWithI18n(<OpRow op={makeOp({ status: 'ok' })} />);
    expect(plain.getByTestId('op-row').getAttribute('data-ghost')).toBe('false');
  });

  it('names the user\'s own decline rather than colouring it as a fault', () => {
    const { getByTestId } = renderWithI18n(<OpRow op={makeOp({ status: 'skipped' })} />);
    expect(getByTestId('op-chip').textContent).toBe('you said no');
    expect(asColor(getByTestId('tick-dot').style.color)).not.toBe(asColor(tickInk.error));
  });

  /** A playbook says whose recipe the ops below it follow. Only a STYLE skill is one. */
  it('chips a loaded skill with its title and stamps a playbook under the row', () => {
    const styled = renderWithI18n(
      <OpRow op={makeOp({ name: 'load_skill', isRead: true, skill: { name: 'cozy', kind: 'style', title: 'Cozy Village' } })} />,
    );
    expect(styled.getByTestId('op-chip').textContent).toBe('Cozy Village');
    expect(styled.getByTestId('stamp').textContent).toBe('Building from the Cozy Village playbook');
    styled.unmount();

    const method = renderWithI18n(
      <OpRow op={makeOp({ name: 'load_skill', isRead: true, skill: { name: 'terrain', kind: 'method', title: 'Terrain shaping' } })} />,
    );
    expect(method.getByTestId('op-chip').textContent).toBe('Terrain shaping');
    expect(method.queryByTestId('stamp')).toBeNull();
  });
});

describe('JobTicket: steer notes and side stamps', () => {
  /** A revised plan stands OVER the rail it revised: the rail would otherwise change shape under
   *  the user with nothing saying it had. */
  it('stamps a re-filed plan with its new stage count, above the rail', () => {
    const plan: NonNullable<JobView['plan']> = {
      stages: [{ label: 'A' }, { label: 'B' }, { label: 'C' }, { label: 'D' }, { label: 'E' }],
      currentIndex: 2, doneCount: 2, revision: 2,
    };
    const { getByTestId } = renderWithI18n(<JobTicket job={makeJob({ plan })} live />);
    const stamp = getByTestId('stamp');
    expect(stamp.textContent).toBe('Plan revised, 5 stages now');
    expect(stamp.compareDocumentPosition(getByTestId('plan-rail')) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
  });

  /** The reachable n=1 case: a plan revised down to one stage names it as one stage, not the plural. */
  it('names a plan revised to one stage in the singular', () => {
    const plan: NonNullable<JobView['plan']> = {
      stages: [{ label: 'A' }], currentIndex: 0, doneCount: 0, revision: 2,
    };
    const { getByTestId } = renderWithI18n(<JobTicket job={makeJob({ plan })} live />);
    expect(getByTestId('stamp').textContent).toBe('Plan revised, 1 stage now');
  });

  it('stamps nothing about the plan on its first revision', () => {
    const plan: NonNullable<JobView['plan']> = {
      stages: [{ label: 'A' }], currentIndex: 0, doneCount: 0, revision: 1,
    };
    const { queryByTestId } = renderWithI18n(<JobTicket job={makeJob({ plan })} live />);
    expect(queryByTestId('stamp')).toBeNull();
  });

  it('renders steer notes and compaction/damper/interrupted stamps as single-line stamps with icons', () => {
    const job = makeJob({
      steerNotes: ['Keep the shore clear of houses'],
      stamps: [
        { kind: 'compaction' as const, beforeIndex: 0 },
        { kind: 'damper' as const, beforeIndex: 0 },
        { kind: 'interrupted' as const, beforeIndex: 0 },
      ],
    });
    const { getAllByTestId } = renderWithI18n(<JobTicket job={job} live />);
    const stamps = getAllByTestId('stamp');
    expect(stamps.length).toBe(4);
    expect(stamps[0]!.textContent).toContain('Keep the shore clear of houses');
    expect(stamps[0]!.querySelector('use')?.getAttribute('href')).toBe('#pw-note');
    expect(stamps[1]!.querySelector('use')?.getAttribute('href')).toBe('#pw-compress');
    expect(stamps[2]!.querySelector('use')?.getAttribute('href')).toBe('#pw-rotate');
    expect(stamps[3]!.querySelector('use')?.getAttribute('href')).toBe('#pw-pause');
  });

  /** The compaction case: the run went ON after the tidying, so the stamp stands where it happened
   *  rather than under the rows that came after it. */
  it('files a stamp inside the flat op list, above the row it preceded', () => {
    const job = makeJob({
      ops: [makeOp({ callId: 'a' }), makeOp({ callId: 'b' })],
      stamps: [{ kind: 'compaction', beforeIndex: 1 }],
    });
    const { getByTestId, getAllByTestId } = renderWithI18n(<JobTicket job={job} live />);
    const stamp = getByTestId('stamp');
    expect(getByTestId('ops-list').contains(stamp)).toBe(true);
    const rows = getAllByTestId('op-row');
    // Between the two rows: after the first, before the second.
    expect(rows[0]!.compareDocumentPosition(stamp) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(rows[1]!.compareDocumentPosition(stamp) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it('files a planned job\'s stamp at the foot, where the rail has no row for it', () => {
    const job = makeJob({
      plan: { stages: [{ label: 'A' }], currentIndex: 0, doneCount: 0, revision: 1 },
      ops: [makeOp({ callId: 'a' })],
      stamps: [{ kind: 'compaction', beforeIndex: 0 }],
    });
    const { getByTestId } = renderWithI18n(<JobTicket job={job} live />);
    const stamp = getByTestId('stamp');
    expect(getByTestId('plan-rail').contains(stamp)).toBe(false);
    expect(getByTestId('plan-rail').compareDocumentPosition(stamp) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
  });
});

describe('JobTicket: the tape band', () => {
  it('shows a progress band for a live, unsettled job', () => {
    const job = makeJob({ ops: [makeOp()] });
    const { queryByTestId } = renderWithI18n(<JobTicket job={job} live />);
    expect(queryByTestId('tape-bar')).not.toBeNull();
  });

  it('shows no tape band for a settled job, even while live', () => {
    const job = makeJob({ ops: [makeOp()], outcome: 'done' });
    const { queryByTestId } = renderWithI18n(<JobTicket job={job} live />);
    expect(queryByTestId('tape-bar')).toBeNull();
  });

  it('shows no tape band for a non-live (history) rendering, even unsettled', () => {
    const job = makeJob({ ops: [makeOp()] });
    const { queryByTestId } = renderWithI18n(<JobTicket job={job} live={false} />);
    expect(queryByTestId('tape-bar')).toBeNull();
  });
});

describe('JobTicket: the says-line', () => {
  it('clamps at 2 lines and expands from its own chevron', () => {
    const job = makeJob({ says: 'A long thought that would run past two lines in the narrow panel width.' });
    const { getByTestId } = renderWithI18n(<JobTicket job={job} live />);
    const line = getByTestId('says-line');
    expect(line.style.webkitLineClamp).toBe('2');
    fireEvent.click(getByTestId('says-expand'));
    expect(line.getAttribute('data-open')).toBe('true');
    expect(line.style.webkitLineClamp).toBe('');
    fireEvent.click(getByTestId('says-expand'));
    expect(line.style.webkitLineClamp).toBe('2');
  });

  it('renders no says-line at all when the job has nothing to say', () => {
    const job = makeJob();
    const { queryByTestId } = renderWithI18n(<JobTicket job={job} live />);
    expect(queryByTestId('says-line')).toBeNull();
    expect(queryByTestId('says')).toBeNull();
  });

  it('uses the progress bar without a second loader or empty text row', () => {
    const { getByTestId, queryByTestId } = renderWithI18n(<JobTicket job={makeJob()} live />);
    expect(getByTestId('tape-bar')).toBeTruthy();
    expect(queryByTestId('says-dots')).toBeNull();
    expect(queryByTestId('says')).toBeNull();
    expect(queryByTestId('says-line')).toBeNull();
    expect(queryByTestId('says-caret')).toBeNull();
  });

  it('carries a caret only while the words are still arriving', () => {
    const job = makeJob({ says: 'Boardwalk first.' });
    const streaming = renderWithI18n(<JobTicket job={job} live streaming />);
    expect(streaming.getByTestId('says-caret')).toBeTruthy();
    streaming.unmount();
    const settled = renderWithI18n(<JobTicket job={job} live />);
    expect(settled.queryByTestId('says-caret')).toBeNull();
  });

  /**
   * THE MODEL WRITES MARKDOWN HERE TOO, and this seat is one clamped run of it: the emphasis is
   * rendered rather than printed, and the breaks it wrote survive as breaks. Printed flat the line
   * read `1. **Create a Lake**:` with its markers standing and every paragraph joined by a space.
   */
  it('renders the emphasis it was written with and keeps the line breaks, in one clamped run', () => {
    const job = makeJob({ says: 'Two things.\n\n- **The lake** goes in first\n- Then the pines' });
    const { getByTestId } = renderWithI18n(<JobTicket job={job} live />);
    const line = getByTestId('says-line');
    expect(line.style.whiteSpace).toBe('pre-line');
    expect(line.querySelectorAll('strong')).toHaveLength(1);
    expect(line.textContent).not.toContain('**');
    expect(line.textContent).toContain('The lake');
    // A list keeps the one marker this box can say it has, and the breaks between the items.
    expect(line.textContent).toContain('- The lake goes in first\n- Then the pines');
  });

  /** Reasoning metadata is separate from the assistant's user-facing summary. */
  it('says nothing about the thinking a job did', () => {
    const job = makeJob({ says: 'Boardwalk first.', thought: { chars: 4096, turns: 3, marks: [], ms: 0 } });
    const { getByTestId } = renderWithI18n(<JobTicket job={job} live />);
    expect(getByTestId('says-line').textContent).toBe('Boardwalk first.');
    expect(getByTestId('job-ticket').textContent).not.toContain('4096');
  });
});

describe('JobTicket: the order line and the region it was filed under', () => {
  /** The record scrolls inside the job zone and the ticket can outgrow the room it has; the panel's
   *  subject is the one thing that must not scroll away with it. */
  it('sticks the order line to the top of its own card', () => {
    const { getByTestId } = renderWithI18n(<JobTicket job={makeJob()} live />);
    const order = getByTestId('ticket-order');
    expect(order.style.position).toBe('sticky');
    // Offset by the card's own padding AND its border, so the line sits flush with the card's top.
    expect(order.style.top).toBe('-13px');
    expect(order.style.background).not.toBe('');
  });

  it('says a job was filed under a region, and stands the caller\'s vignette beside it', () => {
    const job = makeJob({ region: { count: 42, x1: 2, y1: 3, x2: 9, y2: 9 } });
    const { getByTestId } = renderWithI18n(
      <JobTicket job={job} live regionVignette={<span data-testid="vignette" />} />,
    );
    expect(getByTestId('ticket-region').textContent).toContain('in the marked region');
    expect(getByTestId('vignette')).toBeTruthy();
  });

  it('shows no region row for a job filed without one', () => {
    const { queryByTestId } = renderWithI18n(<JobTicket job={makeJob()} live />);
    expect(queryByTestId('ticket-region')).toBeNull();
  });
});

describe('JobTicket: a job on hold', () => {
  it('freezes the tape while the work is held', () => {
    const held = renderWithI18n(<JobTicket job={makeJob({ ops: [makeOp()] })} live held />);
    const fill = held.getByTestId('tape-bar').firstElementChild as HTMLElement;
    expect(fill.style.opacity).toBe('0.45');
    expect(fill.className).not.toContain('pw-stripes');
  });

  it('marks where a paused job stopped, by stage where it filed a plan', () => {
    const plan: NonNullable<JobView['plan']> = {
      stages: [{ label: 'A' }, { label: 'B' }, { label: 'C' }, { label: 'D' }],
      currentIndex: 1, doneCount: 1, revision: 1,
    };
    // AFTER step n is a count of what is BANKED: one stage done reads "after step 1", never the
    // index of the stage the job was working on when it stopped.
    const planned = renderWithI18n(<JobTicket job={makeJob({ plan })} live paused />);
    expect(planned.getByTestId('pausemark').textContent).toContain('paused after step 1 of 4');
    planned.unmount();

    // Nothing banked names no step: the boundary is the whole of what the log can say.
    const first = renderWithI18n(
      <JobTicket job={makeJob({ plan: { ...plan, currentIndex: 0, doneCount: 0 } })} live paused />,
    );
    expect(first.getByTestId('pausemark').textContent).toContain('step boundary');
    first.unmount();

    const planless = renderWithI18n(<JobTicket job={makeJob()} live paused />);
    expect(planless.getByTestId('pausemark').textContent).toContain('step boundary');
  });

  it('stands the hold\'s own two verbs under the ticket, and only while it is held', () => {
    const onResume = vi.fn();
    const onStop = vi.fn();
    const held = renderWithI18n(
      <JobTicket job={makeJob()} live paused onResume={onResume} onStop={onStop} />,
    );
    fireEvent.click(held.getByTestId('ticket-resume'));
    fireEvent.click(held.getByTestId('ticket-stop'));
    expect(onResume).toHaveBeenCalledOnce();
    expect(onStop).toHaveBeenCalledOnce();
    held.unmount();

    const running = renderWithI18n(<JobTicket job={makeJob()} live onResume={onResume} onStop={onStop} />);
    expect(running.queryByTestId('ticket-actions')).toBeNull();
  });

  /** Resuming a held job uses the standard dark primary, not the attention color used for asks. */
  it('paints the hold\'s own Resume with the dark ink primary, never the ask colour', () => {
    const { getByTestId } = renderWithI18n(
      <JobTicket job={makeJob()} live paused onResume={() => {}} onStop={() => {}} />,
    );
    expect(asBackground(getByTestId('ticket-resume').style.background)).toBe(asBackground(INK));
    expect(asBackground(getByTestId('ticket-resume').style.background)).not.toBe(asBackground(ACTIVE));
  });
});
