/**
 * panel-shell.test.tsx — the assembly.
 *
 * What is under test here is COMPOSITION, not any component's own drawing (each of those has its
 * own suite): which zones stand, what goes in the job zone for a given phase, which verb a control
 * calls, and the one structural invariant the layout rests on — FOUR top-level groups, whatever the
 * panel is doing.
 *
 * Wrapper and localStorage stub match `desk-header.test.tsx`: `I18nProvider` under
 * `MotionConfig reducedMotion="always"`, so the character and the tape mount without jsdom's
 * missing Web Animations API.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useState } from 'react';
import { render, fireEvent, act } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { I18nProvider } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { translations } from '../../../i18n/translations';
import { PanelShell } from '../../../ui/agent/PanelShell';
import { PANEL_MIN_HEIGHT, PANEL_PAD, PANEL_WIDTH } from '../../../ui/agent/tokens';
import { PIN_KNOB, PIN_KNOB_OUT } from '../../../ui/agent/atoms';
import {
  JOB_ZONE_FLOOR, knobCarry, PANEL_RADIUS, PINNED_HEIGHT, plateVariants,
} from '../../../ui/agent/PanelShell';
import { DOCK_HEIGHT } from '../../../ui/agent/DeskHeader';
import { DREAMS } from '../../../ui/agent/DreamOffice';
import { DOCK_CHROME_FILE_H, DOCK_CHROME_W } from '../../../ui/shell/panel-frame';
import { easingCss, seconds } from '../../../ui/agent/motion';
import { useAgentPanelSettings } from '../../../ui/agent/settings';
import { PROVIDER_IDS, type ProviderId } from '../../../agent/providers/defaults';
import { POSES } from '../../../ui/agent/character/poses';
import { Character, getCharacterHandle } from '../../../ui/agent/character/Character';
import type { JobView, PanelView, SessionPhase } from '../../../agent/core/project-view';
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
  return (
    <MotionConfig reducedMotion="always">
      <I18nProvider>{children}</I18nProvider>
    </MotionConfig>
  );
}

function renderWithI18n(node: React.ReactElement) {
  return render(node, { wrapper: Wrapper });
}

beforeEach(() => {
  backing.clear();
  useEditorStore.setState({ locale: 'en' });
  useAgentPanelSettings.setState({
    provider: 'claude',
    model: Object.fromEntries(PROVIDER_IDS.map((id) => [id, ''])) as Record<ProviderId, string>,
    oversight: 'checkpoint', customBaseUrl: '', keyed: [], hydrated: true,
  });
});

function makeView(over: Partial<PanelView> = {}): PanelView {
  return {
    phase: 'idle',
    jobs: [],
    queuedSteers: [],
    vitals: { cells: 0, objects: 0, reverts: 0, jobs: 0 },
    suggestion: null,
    lastEventAt: 0,
    ...over,
  };
}

function makeJob(over: Partial<JobView> = {}): JobView {
  return {
    orderSeq: 1, orderText: 'build a village', orderAt: 0,
    asks: [], ops: [], steerNotes: [], checkpoints: [], stamps: [], celebrate: false, skills: [],
    ...over,
  };
}

const VERBS = {
  onSend: () => {},
  onStop: () => {},
  onPause: () => {},
  onGateAnswer: () => {},
};

/** The panel's LAID-OUT children. The icon sprite is mounted here too and is not a zone: it is a
 *  `display: none` sheet of symbol definitions, drawing nothing and taking no space, so the
 *  four-groups rule counts what stands. */
function zones(panel: HTMLElement): Element[] {
  return [...panel.children].filter((el) => (el as HTMLElement).style.display !== 'none');
}

describe('PanelShell: the four zones', () => {
  it('stands exactly four top-level groups, in every phase', () => {
    const phases: SessionPhase[] = [
      'idle', 'thinking', 'streaming', 'executing', 'gated', 'retrying',
      'pausing', 'paused', 'aborted', 'incident',
    ];
    for (const phase of phases) {
      const { getByTestId, unmount } = renderWithI18n(
        <PanelShell
          view={makeView({
            phase,
            current: phase === 'idle' || phase === 'aborted' || phase === 'incident' ? undefined : makeJob(),
            ...(phase === 'gated' ? { gate: { gateId: 'g1', scope: 'tool' as const, summary: 'paint a hill' } } : {}),
            ...(phase === 'retrying' ? { retry: { attempt: 2, cls: 'rate-limit' as const, delayMs: 9000, since: 0 } } : {}),
          })}
          connected
          now={0}
          {...VERBS}
        />,
      );
      const panel = getByTestId('panel-shell');
      expect(zones(panel).length, `phase ${phase}`).toBe(4);
      unmount();
    }
  });

  /** A SCREEN OWNS THE BOTTOM ZONE AS WELL AS THE RECORD. The composer is the zone the setup family
   *  does not have, and what stands in its place is the screen's own action row, pinned to the foot
   *  of the zone the screen fills. */
  it('stands three while the keyless rest owns the zone, its own verb at the foot', () => {
    const { getByTestId } = renderWithI18n(
      <PanelShell view={makeView()} connected={false} now={0} {...VERBS} />,
    );
    expect(zones(getByTestId('panel-shell')).length).toBe(3);
    expect(getByTestId('panel-job-zone').contains(getByTestId('dream-office'))).toBe(true);
    expect(getByTestId('desk-header')).toBeTruthy();
    expect(getByTestId('panel-job-zone').contains(getByTestId('dream-connect'))).toBe(true);
  });

  it('keeps the steer zone standing whether or not a note is queued', () => {
    const empty = renderWithI18n(<PanelShell view={makeView()} connected now={0} {...VERBS} />);
    expect(empty.getByTestId('panel-steer-zone')).toBeTruthy();
    expect(empty.queryByTestId('panel-steer-chip')).toBeNull();
    empty.unmount();

    const queued = renderWithI18n(
      <PanelShell
        view={makeView({ phase: 'thinking', current: makeJob(), queuedSteers: [{ seq: 4, text: 'use stone' }] })}
        connected
        now={0}
        {...VERBS}
      />,
    );
    expect(queued.getByTestId('panel-steer-chip').textContent).toContain('use stone');
    expect(queued.getByTestId('panel-steer-chip').textContent)
      .toContain(translations.en['agent3.steer_at_next_step']);
  });

  /**
   * THE HELPER LANE'S LIVE LINE REACHES THE GLASS, which is the half neither of its two suites saw.
   *
   * `store.childLive` is folded into a `LaneView` by the column (pinned there) and `Lane` draws one
   * (pinned in its own file), and between those two the panel has to actually pass it down through
   * the ticket. A panel that carries the prop with nothing rendering it type-checks all the same,
   * and a delegate at work then says nothing at all: this is the seam that fact crosses.
   */
  it('carries a live helper lane through to the visible panel', () => {
    const { getByTestId } = renderWithI18n(
      <PanelShell
        view={makeView({
          phase: 'executing',
          current: makeJob({
            ops: [{
              callId: 'd1', name: 'delegate_task', status: 'run', summary: 'planting the grove',
              isRead: false,
            }],
          }),
        })}
        connected
        now={0}
        {...VERBS}
        lane={{ task: 'planting the grove', ops: 4, opName: 'plant_forest' }}
      />,
    );
    expect(getByTestId('lane-name').textContent).toContain('planting the grove');
    expect(getByTestId('lane-count').textContent).toContain('4');
  });
});

describe('PanelShell: what the job zone shows', () => {
  /** The disconnected rest precedes credential entry, which opens only after Connect is pressed. */
  it('shows the keyless rest, and stands its Connect where the composer would be', () => {
    const { getByTestId, queryByTestId } = renderWithI18n(
      <PanelShell view={makeView()} connected={false} now={0} {...VERBS} />,
    );
    expect(getByTestId('dream-office')).toBeTruthy();
    expect(queryByTestId('setup-screen'), 'the form is not put up unasked').toBeNull();
    expect(queryByTestId('job-ticket')).toBeNull();
    // NO MESSAGE BOX AT ALL. A field with nowhere to send is an invitation the screen above it
    // contradicts, so the screen's own verb is the bottom of the panel.
    expect(queryByTestId('composer')).toBeNull();
    expect(getByTestId('dream-connect')).toBeTruthy();
  });

  /**
   * THE SCREEN'S ONE VERB IS NOT SOMETHING THE DREAM MAY PUSH OFF THE FOLD.
   *
   * `dream-connect` is the only route from the keyless rest into the setup form (the board's rows are
   * inert pictures), and an office that simply grew as a column would put it below the fold: at
   * 1280x800 the record zone is 186 frame px and the office wants 385 in en, 443 in fr, 462 in ru,
   * so `elementFromPoint` at the verb's centre answers the canvas. jsdom lays nothing out, so
   * what is asserted here is the STRUCTURE that makes the fold impossible: the dream is inside its
   * own scroller and the verb is outside it, at the office's foot.
   */
  it('keeps Connect out of the scrolling part of the keyless rest', () => {
    const { getByTestId } = renderWithI18n(
      <PanelShell view={makeView()} connected={false} now={0} {...VERBS} />,
    );
    const office = getByTestId('dream-office');
    const scroll = getByTestId('dream-scroll');
    const connect = getByTestId('dream-connect');
    expect(scroll.contains(getByTestId('dream-rows')), 'the board is what gives way').toBe(true);
    expect(scroll.contains(connect), 'the verb stands outside the scroller').toBe(false);
    expect(office.contains(connect)).toBe(true);
    expect(scroll.style.overflowY).toBe('auto');
    // Both must be able to shrink below their content, or the zone above scrolls instead.
    expect(office.style.minHeight).toBe('0');
    expect(scroll.style.minHeight).toBe('0');
  });

  /** Connect acknowledges and wakes the mounted character before opening credential entry. */
  it('hands the Connect press to the character: one acknowledgement, one wake', () => {
    const { getByTestId, unmount } = renderWithI18n(
      <>
        <Character pose="sleeping" size={64} />
        <PanelShell view={makeView()} connected={false} now={0} {...VERBS} />
      </>,
    );
    const hero = getCharacterHandle();
    expect(hero).not.toBeNull();
    const wake = vi.spyOn(hero!, 'wake');
    const acknowledge = vi.spyOn(hero!, 'acknowledge');
    fireEvent.click(getByTestId('dream-connect'));
    expect(wake).toHaveBeenCalledTimes(1);
    expect(acknowledge).toHaveBeenCalledTimes(1);
    expect(getByTestId('setup-screen')).toBeTruthy();
    unmount();
  });

  it('walks into setup on Connect, and back out to the rest when the form leaves', () => {
    const onCollapse = vi.fn();
    const { getByTestId, queryByTestId } = renderWithI18n(
      <PanelShell view={makeView()} connected={false} now={0} {...VERBS} onCollapse={onCollapse} />,
    );
    fireEvent.click(getByTestId('dream-connect'));
    expect(getByTestId('setup-screen')).toBeTruthy();
    expect(queryByTestId('dream-office')).toBeNull();

    // BACK GOES BACK, AND NO FURTHER: the rest this form was walked into from is what returns, and
    // the panel keeps standing — putting it away is the character's own press, not a step's verb.
    fireEvent.click(getByTestId('setup-leave'));
    expect(getByTestId('dream-office')).toBeTruthy();
    expect(onCollapse).not.toHaveBeenCalled();
  });

  /**
   * SETUP LEAVES ON ITS OWN WORD.
   *
   * `connected` turns true at the FIRST of the setup screen's three steps (a key is filed the moment
   * the provider is known), so a zone keyed on `connected` alone swaps the screen out mid-flow: the
   * draft goes with it, the model step is unreachable, and the panel says "Ready for orders" with no
   * model chosen. The screen stands until `onDone`, and a key going away puts it back.
   */
  it('keeps the setup screen standing after the key is filed, until it says it is done', () => {
    const view = makeView();
    const { getByTestId, queryByTestId, rerender } = renderWithI18n(
      <PanelShell view={view} connected={false} now={0} {...VERBS} />,
    );
    fireEvent.click(getByTestId('dream-connect'));
    expect(getByTestId('setup-screen')).toBeTruthy();
    expect(queryByTestId('history-strip')).toBeNull();

    // The key lands: the screen must NOT be replaced by the record.
    // RTL re-applies the wrapper on rerender, so the element passed here is the BARE one: a
    // differently-nested tree would remount `PanelShell` and reset the very state under test.
    rerender(<PanelShell view={view} connected now={0} {...VERBS} />);
    expect(getByTestId('setup-screen'), 'the key is filed, setup is not finished').toBeTruthy();
    // The DESK reads keyless too: the gear's own surface is what the zone is showing, so the card
    // stands gearless rather than offering a door to the screen already open.
    expect(queryByTestId('dock-gear')).toBeNull();
    // The screen's own Done is the only way out, and `SetupScreen`'s suite holds that it is only
    // offered once a key, a provider AND a model are settled.
  });

  /**
   * A REFUSAL IS A KEY ARRIVING AND GOING AWAY AGAIN, and the form has to survive it.
   *
   * The screen files the key the moment the provider is known, the provider then refuses it and the
   * screen drops it — so `connected` goes true and false in one gesture. Read as "no key means the
   * rest", that second edge folded the form away at the exact moment it had something to say: the
   * refused face was unreachable in the app, and a user who pasted a bad key landed back in the
   * dreaming office with no word about why.
   */
  it('keeps the form standing when the key it just filed is refused', () => {
    const view = makeView();
    const { getByTestId, queryByTestId, rerender } = renderWithI18n(
      <PanelShell view={view} connected={false} now={0} {...VERBS} />,
    );
    fireEvent.click(getByTestId('dream-connect'));
    rerender(<PanelShell view={view} connected now={0} {...VERBS} />);
    rerender(<PanelShell view={view} connected={false} now={0} {...VERBS} />);
    expect(getByTestId('setup-screen'), 'the refusal has a face and this is where it stands').toBeTruthy();
    expect(queryByTestId('dream-office')).toBeNull();
  });

  /**
   * THE CARD ABOVE THE SETUP SCREEN SAYS WHICH STEP IT IS ON. The panel carries the screen's own
   * report the one hop to the desk; without it the dock said "Not connected" over a key that was
   * being read, and stood on the calm idle paper while the field was in danger.
   */
  it('carries the setup screen\'s step up to the dock', () => {
    const { getByTestId } = renderWithI18n(
      <PanelShell view={makeView()} connected={false} now={0} {...VERBS} />,
    );
    // The keyless REST says it is not connected; the FORM is what says she is awake and asking.
    expect(getByTestId('dock-sentence').textContent).toBe(translations.en['agent3.dock_disconnected']);
    fireEvent.click(getByTestId('dream-connect'));
    expect(getByTestId('dock-sentence').textContent).toBe(translations.en['agent3.dock_setup_awake']);

    fireEvent.change(getByTestId('setup-key-input'), { target: { value: 'sk-ant-api03-abcdefghijkl' } });
    expect(getByTestId('dock-sentence').textContent).toBe(translations.en['agent3.dock_setup_reading']);
    expect(getByTestId('dock-glyph').getAttribute('data-icon')).toBe('pw-key');
    expect(getByTestId('dock').getAttribute('data-paper')).toBe('work');

    // The field emptied is the mouth again, which is a STEP of the flow like the rest of them: the
    // screen is standing and asking, so the card is awake and asking with it.
    fireEvent.change(getByTestId('setup-key-input'), { target: { value: '' } });
    expect(getByTestId('dock-sentence').textContent).toBe(translations.en['agent3.dock_setup_awake']);
  });

  /** Clearing the active key returns the panel to its disconnected rest. */
  it('puts the keyless rest back the moment the key goes away', () => {
    const view = makeView();
    const { getByTestId, queryByTestId, rerender } = renderWithI18n(
      <PanelShell view={view} connected now={0} {...VERBS} />,
    );
    expect(queryByTestId('dream-office')).toBeNull();
    rerender(<PanelShell view={view} connected={false} now={0} {...VERBS} />);
    expect(getByTestId('dream-office')).toBeTruthy();
    expect(queryByTestId('setup-screen')).toBeNull();
  });

  /**
   * "Enter a key" over a keyless panel is answered HERE, by the field the setup screen is already
   * showing. The caller's verb for that act DROPS the refused key, and on a panel that holds none
   * there is nothing to drop: without this the press did nothing at all.
   */
  it('answers the keyless key act with the setup field rather than passing it on', () => {
    const acts: string[] = [];
    const { getByTestId } = renderWithI18n(
      <PanelShell
        view={makeView({ phase: 'incident', jobs: [makeJob({ outcome: 'incident', errorCls: 'quota' })] })}
        connected={false}
        now={0}
        {...VERBS}
        onDockAct={(a) => acts.push(a)}
      />,
    );
    fireEvent.click(getByTestId('dock-act'));
    expect(acts, 'nothing travels to the caller').toEqual([]);
    expect(document.activeElement).toBe(getByTestId('setup-key-input'));
  });

  /**
   * ONE PRESS, ONE FIELD, over a panel that DOES hold a key. That act has two halves and only the
   * first is the caller's: dropping the key is what mounts the screen the second half aims at, so the
   * field is not in the tree on the commit the press lands in, so focus aimed there in that commit
   * lands on `BODY` and the field waits for a second press.
   */
  it('reaches the key field on ONE press when the act has to drop a key first', () => {
    function DropsOnAct() {
      const [connected, setConnected] = useState(true);
      return (
        <PanelShell
          view={makeView({ phase: 'incident', jobs: [makeJob({ outcome: 'incident', errorCls: 'auth' })] })}
          connected={connected}
          now={0}
          {...VERBS}
          onDockAct={(a) => { if (a === 'fix-key') setConnected(false); }}
        />
      );
    }
    const { getByTestId, queryByTestId } = renderWithI18n(<DropsOnAct />);
    expect(queryByTestId('setup-key-input'), 'a key is held, so no screen is standing').toBeNull();

    fireEvent.click(getByTestId('dock-act'));
    expect(document.activeElement).toBe(getByTestId('setup-key-input'));
  });

  /** The gear's door: chrome over the session, so the record goes and the desk keeps its own face. */
  it('puts the manage card in the zone while the gear is lit, and takes it away on Done', () => {
    // FILED, so the record is a past-jobs row rather than a card standing in the zone: what is
    // under test here is the strip giving the zone up, not which card was in it.
    const view = makeView({ jobs: [makeJob({ outcome: 'done' })] });
    const filed = new Set([1]);
    const { getByTestId, queryByTestId, rerender } = renderWithI18n(
      <PanelShell view={view} connected now={0} filed={filed} {...VERBS} />,
    );
    expect(queryByTestId('manage-screen')).toBeNull();
    expect(getByTestId('history-strip')).toBeTruthy();

    rerender(<PanelShell view={view} connected managing now={0} filed={filed} {...VERBS} />);
    expect(getByTestId('manage-screen')).toBeTruthy();
    expect(queryByTestId('history-strip'), 'the record gives the zone up').toBeNull();
    // The gear reads as lit, and the dock says what the open card is about.
    expect(getByTestId('dock-sentence').textContent).toBe(translations.en['agent3.dock_connection']);
  });

  /**
   * THE COMPOSER NEVER INVITES AN ORDER FROM A FACE THAT CANNOT TAKE ONE.
   *
   * The manage card belongs to the not-ready family. "Chrome over a live session" is true of the
   * WIRING and beside the point on
   * the glass — the zone is filled with the connection being edited, the provider and the model can
   * both be mid-change under the pointer, so a field below would be inviting work the whole time. An
   * invitation the surface above it is contradicting is worse than no invitation. It says which of
   * the three not-ready faces it is (never "connect a provider first", which over a live connection
   * would be a plain falsehood) and it hands the field back on Done.
   */
  it('draws no composer behind the manage card, and hands the field back on Done', () => {
    const view = makeView({ jobs: [makeJob({ outcome: 'done' })] });
    const filed = new Set([1]);
    const { getByTestId, queryByTestId, rerender } = renderWithI18n(
      <PanelShell view={view} connected managing now={0} filed={filed} {...VERBS} />,
    );
    expect(queryByTestId('composer')).toBeNull();
    // The card's own Done is the panel's bottom control while it stands.
    expect(getByTestId('manage-done')).toBeTruthy();

    rerender(<PanelShell view={view} connected now={0} filed={filed} {...VERBS} />);
    const input = getByTestId('composer-input') as HTMLInputElement;
    expect(input.disabled).toBe(false);
    expect(input.placeholder).toBe(translations.en['agent3.composer_order']);
  });

  /** THE WHOLE SETUP FAMILY, ONE RULE: every step of the connection screen is a step with its own
   *  verb, and none of them is an order. */
  it('draws no composer on the connection screen either', () => {
    const { getByTestId, queryByTestId } = renderWithI18n(
      <PanelShell view={makeView()} connected={false} now={0} onCollapse={() => {}} {...VERBS} />,
    );
    fireEvent.click(getByTestId('dream-connect'));
    expect(getByTestId('setup-screen')).toBeTruthy();
    expect(queryByTestId('composer')).toBeNull();
    // The screen's foot is pinned to the bottom of the zone it fills, so the step's own verb is
    // what stands at the panel's foot.
    expect(getByTestId('setup-leave')).toBeTruthy();
  });

  /**
   * "CLEAR JOBS (N)" COUNTS WHAT THE PRESS WOULD CLEAR. Clearing a record is a MARK rather than a
   * removal (`store.clearRecord`), and this component already filters those out of the list — so
   * counting `view.jobs` left the card reading "Clear jobs (3)" over an emptied history, with the
   * `disabled` guard never firing and the press answering with silence.
   */
  it('counts only the records a clear would still remove, and stands down at none', () => {
    const view = makeView({
      jobs: [
        makeJob({ orderSeq: 1, outcome: 'done' }),
        makeJob({ orderSeq: 2, outcome: 'done' }),
        makeJob({ orderSeq: 3, outcome: 'done' }),
      ],
    });
    const filed = new Set([1, 2, 3]);
    const { getByTestId, rerender } = renderWithI18n(
      <PanelShell view={view} connected managing now={0} filed={filed} {...VERBS} onClearJobs={() => {}} />,
    );
    expect(getByTestId('manage-clear-jobs').textContent)
      .toBe(translations.en['agent3.setup_manage_clear_jobs']!.replace('{n}', '3'));

    rerender(
      <PanelShell
        view={view} connected managing now={0} filed={filed} cleared={new Set([1, 2])}
        {...VERBS} onClearJobs={() => {}}
      />,
    );
    expect(getByTestId('manage-clear-jobs').textContent)
      .toBe(translations.en['agent3.setup_manage_clear_jobs']!.replace('{n}', '1'));

    rerender(
      <PanelShell
        view={view} connected managing now={0} filed={filed} cleared={new Set([1, 2, 3])}
        {...VERBS} onClearJobs={() => {}}
      />,
    );
    expect((getByTestId('manage-clear-jobs') as HTMLButtonElement).disabled).toBe(true);
  });

  /**
   * THE DOCK AND THE ZONE SAY ONE THING. A filed record is a past-jobs row, and the card that said
   * "All done." over it is the same piece of news put away — so the desk reads its own rest. Pinned
   * HERE rather than on the dock alone: the fact is the panel's to work out, and a wiring that
   * compares a value that is `undefined` against `null` has the dock go on reporting a receipt
   * nobody can see while the dock's own unit tests pass.
   */
  it('rests the dock once the settled record is filed, and keeps a capped one\'s reading', () => {
    const done = makeView({ jobs: [makeJob({ outcome: 'done', kind: 'build' })] });
    const filedDone = renderWithI18n(
      <PanelShell view={done} connected now={0} filed={new Set([1])} mapName="Hexia" {...VERBS} />,
    );
    expect(filedDone.getByTestId('dock-sentence').textContent).toBe(translations.en['agent3.dock_idle']);
    filedDone.unmount();

    const capped = makeView({
      jobs: [makeJob({
        outcome: 'capped',
        plan: { stages: [{ label: 'a' }, { label: 'b' }], currentIndex: 1, doneCount: 1, revision: 1 },
      })],
    });
    const filedCapped = renderWithI18n(
      <PanelShell view={capped} connected now={0} filed={new Set([1])} {...VERBS} />,
    );
    expect(filedCapped.getByTestId('dock-sentence').textContent)
      .toBe(translations.en['agent3.dock_capped']);
  });

  it('shows the running job as a live ticket, and no setup', () => {
    const { getByTestId, queryByTestId } = renderWithI18n(
      <PanelShell
        view={makeView({ phase: 'executing', current: makeJob({ orderText: 'pave the square' }) })}
        connected
        now={0}
        {...VERBS}
      />,
    );
    expect(queryByTestId('setup-screen')).toBeNull();
    expect(getByTestId('ticket-order').textContent).toBe('pave the square');
    expect(getByTestId('tape-bar')).toBeTruthy();
  });

  // The ask is a RECORD on the job and `view.gate` is the half of it that can still be answered:
  // the projection writes both, and the card is drawn from the record so it survives the answer.
  it('shows the open gate, and answers it by gateId', () => {
    const answers: [string, string][] = [];
    const { getAllByTestId } = renderWithI18n(
      <PanelShell
        view={makeView({
          phase: 'gated',
          current: makeJob({ asks: [{ gateId: 'g7', scope: 'tool', summary: 'paint a hill' }] }),
          gate: { gateId: 'g7', scope: 'tool', summary: 'paint a hill' },
        })}
        connected
        now={0}
        {...VERBS}
        onGateAnswer={(id, a) => answers.push([id, a])}
      />,
    );
    fireEvent.click(getAllByTestId('gate-approve')[0]!);
    expect(answers).toEqual([['g7', 'allow']]);
  });

  it("captions an incident from the settled job's own class, not from the outcome alone", () => {
    const { getByText } = renderWithI18n(
      <PanelShell
        view={makeView({
          phase: 'incident',
          jobs: [makeJob({ outcome: 'incident', errorCls: 'auth' })],
        })}
        connected
        now={0}
        {...VERBS}
      />,
    );
    expect(getByText(translations.en['agent3.banner_auth']!)).toBeTruthy();
  });

  it('falls back to the generic notice for an incident that named no class', () => {
    const { getByText } = renderWithI18n(
      <PanelShell
        view={makeView({ phase: 'incident', jobs: [makeJob({ outcome: 'incident' })] })}
        connected
        now={0}
        {...VERBS}
      />,
    );
    expect(getByText(translations.en['agent3.banner_incident']!)).toBeTruthy();
  });

  /** A dismissal is answered HERE (the notice demotes rather than leaving) and still reported: the
   *  caller may want to know, and one of them does. */
  it('takes a dismissal itself and still reports it', () => {
    const acted: string[] = [];
    const { getAllByTestId, getByTestId } = renderWithI18n(
      <PanelShell
        view={makeView({ phase: 'incident', jobs: [makeJob({ outcome: 'incident', errorCls: 'unknown' })] })}
        connected
        now={0}
        {...VERBS}
        onBannerAction={(a) => acted.push(a)}
      />,
    );
    const dismiss = getAllByTestId('banner-action').find((el) => el.getAttribute('data-action') === 'dismiss')!;
    fireEvent.click(dismiss);
    expect(acted).toEqual(['dismiss']);
    // QUIETER, NOT GONE: the fault is still true, and a notice that vanished under the pointer that
    // dismissed it would shorten the record by its own height (`trouble.test.tsx` holds the dress).
    expect(getByTestId('banner').getAttribute('data-standing')).toBe('true');
  });

  /**
   * THE STORAGE NOTICE IS A PRODUCED CLASS, which is the whole point of these three.
   *
   * The store knows when a save was pruned, lost or read back corrupt
   * (`session/store.ts:storageNotice`, and its own tests drive all three through a real quota
   * failure), and the panel asks for it. A banner class no code path constructs would read as a
   * shipped feature from the suite alone.
   */
  it('banners each of the three storage readings, and tells them apart', () => {
    const said: string[] = [];
    for (const [notice, key] of [
      ['pruned', 'agent3.banner_storage_pruned'],
      ['lost', 'agent3.banner_storage_full'],
      ['corrupt', 'agent3.banner_storage_corrupt'],
    ] as const) {
      const { getByTestId, unmount } = renderWithI18n(
        <PanelShell view={makeView()} connected now={0} {...VERBS} storageNotice={notice} />,
      );
      said.push(getByTestId('banner').textContent ?? '');
      expect(said[said.length - 1], notice).toContain(translations.en[key]!);
      unmount();
    }
    expect(new Set(said).size).toBe(3);
  });

  /**
   * THE HOUSE RULE BINDS BOTH: a `lost`/`pruned` dismissal demotes exactly
   * like the incident banner's does, so it answers LOCALLY and never reaches the caller — the store
   * only clears the fact itself, on the next clean save. `corrupt`'s Discard is the one exception,
   * because it genuinely drops the set-aside bytes (the label says so), so it still hands the press
   * to the caller.
   */
  it('hands the corrupt notice\'s discard back to the caller, and demotes lost/pruned locally instead', () => {
    let dismissed = 0;
    const lost = renderWithI18n(
      <PanelShell
        view={makeView()}
        connected
        now={0}
        {...VERBS}
        storageNotice="lost"
        onDismissStorage={() => { dismissed += 1; }}
      />,
    );
    fireEvent.click(lost.getAllByTestId('banner-action').find((el) => el.getAttribute('data-action') === 'dismiss')!);
    expect(dismissed, 'a lost/pruned dismissal never reaches the caller').toBe(0);
    expect(lost.getByTestId('banner').getAttribute('data-standing')).toBe('true');
    lost.unmount();

    const corrupt = renderWithI18n(
      <PanelShell
        view={makeView()} connected now={0} {...VERBS}
        storageNotice="corrupt"
        onDismissStorage={() => { dismissed += 1; }}
      />,
    );
    fireEvent.click(corrupt.getAllByTestId('banner-action').find((el) => el.getAttribute('data-action') === 'dismiss')!);
    expect(dismissed, 'the corrupt notice\'s Discard still does').toBe(1);
  });

  it('stands no storage banner where the session reports no trouble', () => {
    const { queryByTestId } = renderWithI18n(
      <PanelShell view={makeView()} connected now={0} {...VERBS} storageNotice={null} />,
    );
    expect(queryByTestId('banner')).toBeNull();
  });

  /** A dismissal answers ONE incident, not a class of them for the panel's life: the next failure of
   *  the same kind comes back LOUD rather than arriving already demoted. */
  it('shows the next incident of a class already dismissed', () => {
    const first = makeView({
      phase: 'incident',
      jobs: [makeJob({ orderSeq: 1, outcome: 'incident', errorCls: 'unknown' })],
    });
    const { getAllByTestId, getByTestId, rerender } = renderWithI18n(
      <PanelShell view={first} connected now={0} {...VERBS} />,
    );
    fireEvent.click(getAllByTestId('banner-action').find((el) => el.getAttribute('data-action') === 'dismiss')!);
    expect(getByTestId('banner').getAttribute('data-standing')).toBe('true');

    const second = makeView({
      phase: 'incident',
      jobs: [
        makeJob({ orderSeq: 1, outcome: 'incident', errorCls: 'unknown' }),
        makeJob({ orderSeq: 2, outcome: 'incident', errorCls: 'unknown' }),
      ],
    });
    rerender(<PanelShell view={second} connected now={0} {...VERBS} />);
    expect(getByTestId('banner').getAttribute('data-standing')).toBeNull();
  });

  it('shows the settled jobs as the history strip, and nothing when there are none', () => {
    const none = renderWithI18n(<PanelShell view={makeView()} connected now={0} {...VERBS} />);
    expect(none.queryByTestId('history-toggle')).toBeNull();
    none.unmount();

    const some = renderWithI18n(
      <PanelShell
        view={makeView({ jobs: [makeJob({ outcome: 'done' }), makeJob({ orderSeq: 2, outcome: 'done' })] })}
        connected
        now={0}
        // Both filed: the strip lists the jobs that are PAST, and the newest record stands as a card
        // in the zone until it is put away.
        filed={new Set([1, 2])}
        {...VERBS}
      />,
    );
    expect(some.getByTestId('history-toggle').textContent).toContain('2');
  });

  /**
   * A JOB THAT ENDED ON A QUESTION LEAVES THE COMPOSER AS THE ONLY REPLY, and it now says so. The
   * settle is compact and offers no quick answers (nothing produces them yet), so a field reading
   * "Give an order" was the whole of what the one face built around a question offered back.
   */
  it('invites the answer in the composer while a settled question stands', () => {
    const asked = makeView({ jobs: [makeJob({ outcome: 'done', question: true })] });
    const { getByTestId, rerender } = renderWithI18n(
      <PanelShell view={asked} connected now={0} {...VERBS} />,
    );
    const field = () => getByTestId('composer').querySelector('textarea') as HTMLTextAreaElement;
    expect(field().placeholder).toBe(translations.en['agent3.composer_answer_short']);

    // A record that asked nothing is back to the ordinary invitation.
    rerender(<PanelShell view={makeView({ jobs: [makeJob({ outcome: 'done' })] })} connected now={0} {...VERBS} />);
    expect(field().placeholder).toBe(translations.en['agent3.composer_order']);
  });
});

describe("PanelShell: the rolled-back reading is the shell's own", () => {
  const jobs = [
    makeJob({ orderSeq: 1, outcome: 'done', checkpoints: [{ undoIndex: 4, label: 'job' }] }),
    makeJob({ orderSeq: 2, outcome: 'done', checkpoints: [{ undoIndex: 9, label: 'job' }] }),
  ];

  function rolledLabels(undoDepth?: number) {
    const view = renderWithI18n(
      <PanelShell
        view={makeView({ jobs })}
        connected
        now={0}
        // Both records filed, so both are ROWS: this is the strip's reading, not the card's.
        filed={new Set([1, 2])}
        {...(undoDepth !== undefined ? { undoDepth } : {})}
        {...VERBS}
      />,
    );
    fireEvent.click(view.getByTestId('history-toggle'));
    const rows = view.getAllByTestId('history-item');
    const flags = rows.map((r) => r.textContent?.includes(translations.en['agent3.history_rolled_back']!) ?? false);
    view.unmount();
    return flags;
  }

  // The strip lists the newest job first, so these arrays read job 2 then job 1.
  it('reports a job rolled back once the undo depth is back at its first checkpoint', () => {
    // Depth 9 is exactly at job 2's own checkpoint, and still above job 1's.
    expect(rolledLabels(9)).toEqual([true, false]);
    // Depth 4 has taken both back.
    expect(rolledLabels(4)).toEqual([true, true]);
    // Above both, nothing has been taken back.
    expect(rolledLabels(12)).toEqual([false, false]);
  });

  it('reports nothing at all with no undo depth in hand', () => {
    expect(rolledLabels()).toEqual([false, false]);
  });
});

/**
 * THE TERMINAL CARD IS KEYED BY ITS OWN RECORD (`key={settled.job.orderSeq}` on each of the three
 * shapes in `PanelShell`). Without it React reuses the same component instance across two different
 * settled jobs and a local confirm (the receipt's rewind-all, the stop card's, the answer paper's)
 * travels with it: a rewind confirm opened on job 1 would still be standing, unanswered, over job 2
 * once job 1 files itself away and job 2 becomes the standing record — asking about a job the user
 * is no longer looking at. Removing the three `key`s leaves the rest of this suite
 * green, so this is the one test that would catch their removal.
 */
describe('PanelShell: the terminal card is keyed by its own record', () => {
  it('does not leave a standing rewind-all confirm over the next settled job', () => {
    const job1 = makeJob({ orderSeq: 1, outcome: 'done', checkpoints: [{ undoIndex: 0, label: 'job' }] });
    const job2 = makeJob({ orderSeq: 2, outcome: 'done', checkpoints: [{ undoIndex: 0, label: 'job' }] });
    const { getByTestId, rerender } = renderWithI18n(
      <PanelShell view={makeView({ jobs: [job1] })} connected now={0} {...VERBS} onRewind={() => {}} onRewindAll={() => {}} />,
    );
    fireEvent.click(getByTestId('flip-button'));
    fireEvent.click(getByTestId('ticket-rewind-all'));
    const armed = () => [...document.querySelectorAll('[data-confirm-armed]')];
    expect(armed()).toHaveLength(1);

    // Job 1 files itself away and job 2 takes its place as the standing record.
    rerender(
      <PanelShell
        view={makeView({ jobs: [job1, job2] })}
        connected
        now={0}
        filed={new Set([1])}
        {...VERBS}
        onRewind={() => {}}
        onRewindAll={() => {}}
      />,
    );
    expect(armed()).toHaveLength(0);
  });
});

describe('PanelShell: cancelling a question', () => {
  it.each(['answer', 'build'] as const)('dismisses a closing question from a %s without sending an answer', (kind) => {
    const onSend = vi.fn();
    const onStop = vi.fn();
    const onFileAway = vi.fn();
    const job = makeJob({ kind, outcome: 'done', question: true, summary: 'Where should it go?' });
    const view = makeView({ jobs: [job] });
    const props = { view, connected: true, now: 0, ...VERBS, onSend, onStop, onFileAway };
    const ui = renderWithI18n(<PanelShell {...props} />);
    fireEvent.click(ui.getByRole('button', { name: 'Cancel task' }));
    expect(onFileAway).toHaveBeenCalledWith(job.orderSeq);
    expect(onSend).not.toHaveBeenCalled();
    expect(onStop).not.toHaveBeenCalled();
    ui.rerender(<PanelShell {...props} filed={new Set([job.orderSeq])} />);
    expect(ui.queryByTestId('question-cancel-task')).toBeNull();
    expect(ui.getByTestId('dock-sentence').textContent).toBe(translations.en['agent3.dock_idle']);
    expect((ui.getByTestId('composer-input') as HTMLTextAreaElement).placeholder).toBe('Give an order');
  });

  it('offers cancellation beside a live question and uses the shared stop confirmation', () => {
    const onStop = vi.fn();
    const onGateAnswer = vi.fn();
    const ask = { gateId: 'ask-1', scope: 'tool' as const, summary: 'Where should it go?' };
    const view = makeView({ phase: 'gated', current: makeJob({ asks: [ask] }), gate: ask });
    const ui = renderWithI18n(<PanelShell view={view} connected now={0} {...VERBS} onStop={onStop} onGateAnswer={onGateAnswer} />);
    fireEvent.click(ui.getByRole('button', { name: 'Cancel task' }));
    expect(onStop).not.toHaveBeenCalled();
    fireEvent.click(ui.getByTestId('dock-confirm-cancel'));
    expect(ui.getByTestId('question-cancel-task')).toBeTruthy();
    fireEvent.click(ui.getByTestId('question-cancel-task'));
    fireEvent.click(ui.getByTestId('dock-confirm-stop'));
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onGateAnswer).not.toHaveBeenCalled();
  });
});

describe('PanelShell: the verbs', () => {
  it('routes the composer by phase and sends through the runner verb', () => {
    const sent: string[] = [];
    const { getByTestId } = renderWithI18n(
      <PanelShell view={makeView()} connected now={0} {...VERBS} onSend={(text) => sent.push(text)} />,
    );
    const input = getByTestId('composer').querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'build a village' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(sent).toEqual(['build a village']);
  });

  /** The dock's seat is ONE control per family (`DeskHeader`'s seat table), so a running job hands
   *  down pause and a gate hands down stop — and the stop asks on the card before it acts. */
  it('hands the dock its seat verbs', () => {
    const calls: string[] = [];
    const running = renderWithI18n(
      <PanelShell
        view={makeView({ phase: 'executing', current: makeJob() })}
        connected
        now={0}
        {...VERBS}
        onPause={() => calls.push('pause')}
        onStop={() => calls.push('stop')}
      />,
    );
    fireEvent.click(running.getByTestId('dock-seat'));
    running.unmount();

    const asking = renderWithI18n(
      <PanelShell
        view={makeView({
          phase: 'gated', current: makeJob(),
          gate: { gateId: 'g1', scope: 'tool', summary: '86 cells' },
        })}
        connected
        now={0}
        {...VERBS}
        onPause={() => calls.push('pause')}
        onStop={() => calls.push('stop')}
      />,
    );
    fireEvent.click(asking.getByTestId('dock-seat'));
    fireEvent.click(asking.getByTestId('dock-confirm-stop'));
    expect(calls).toEqual(['pause', 'stop']);
  });

  /**
   * ONE VERB, ONE SAFETY. A stop ends the run and its record then offers to take the edits back, so
   * the take-back law binds the press wherever it stands — and the square in the composer stopped
   * outright while the dock's stop asked first, the quieter of the two on the control nearest the
   * hand. Both raise the same question now, in the same seat, with the same two answers.
   */
  it('asks on the card before the composer\'s square stops anything, and cancels back to the standing face', () => {
    const calls: string[] = [];
    const view = makeView({ phase: 'executing', current: makeJob() });
    const { getByTestId, queryByTestId } = renderWithI18n(
      <PanelShell view={view} connected now={0} {...VERBS} onStop={() => calls.push('stop')} />,
    );

    fireEvent.click(getByTestId('composer-stop'));
    expect(calls, 'nothing is stopped by the press that asks').toEqual([]);
    expect(getByTestId('dock-sentence').textContent).toBe(translations.en['agent3.dock_stop_question']);

    fireEvent.click(getByTestId('dock-confirm-cancel'));
    expect(calls).toEqual([]);
    expect(queryByTestId('dock-confirm-stop')).toBeNull();

    fireEvent.click(getByTestId('composer-stop'));
    fireEvent.click(getByTestId('dock-confirm-stop'));
    expect(calls).toEqual(['stop']);
  });

  it('offers a take-back only where the caller can honour one', () => {
    const view = makeView({ phase: 'thinking', current: makeJob(), queuedSteers: [{ seq: 4, text: 'use stone' }] });
    const without = renderWithI18n(<PanelShell view={view} connected now={0} {...VERBS} />);
    expect(without.queryByTestId('panel-steer-recall')).toBeNull();
    without.unmount();

    const recalled: number[] = [];
    const withIt = renderWithI18n(
      <PanelShell view={view} connected now={0} {...VERBS} onRecallSteer={(s) => recalled.push(s)} />,
    );
    fireEvent.click(withIt.getByTestId('panel-steer-recall'));
    expect(recalled).toEqual([4]);
  });

  it('feeds the composer suggestion from the projection, not from a store field', () => {
    const { getByTestId } = renderWithI18n(
      <PanelShell view={makeView({ suggestion: 'Yes, add the bridge' })} connected now={0} {...VERBS} />,
    );
    expect(getByTestId('composer-ghost').textContent).toBe('Yes, add the bridge');
  });

  /* THE GHOST IS A PROJECTION, so a refusal has nowhere to be recorded but here — and the panel
   * already owns exactly this kind of dismissal for the banner beside it. Unanswered, Escape did
   * nothing and the next EMPTY Enter sent the very prediction that had just been refused. */
  it('drops the suggestion ghost on Escape, and then sends nothing on an empty Enter', () => {
    const sent: string[] = [];
    const view = makeView({ suggestion: 'Add a bridge over the river' });
    const { getByTestId, queryByTestId } = renderWithI18n(
      <PanelShell view={view} connected now={0} {...VERBS} onSend={(text) => sent.push(text)} />,
    );
    const input = getByTestId('composer-input');
    expect(queryByTestId('composer-ghost')).not.toBeNull();

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(queryByTestId('composer-ghost')).toBeNull();

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(sent).toEqual([]);
  });

  it('tells a caller that wants to know, without needing one to do the dropping', () => {
    const dropped: number[] = [];
    const { getByTestId } = renderWithI18n(
      <PanelShell
        view={makeView({ suggestion: 'Yes, add the bridge' })}
        connected
        now={0}
        {...VERBS}
        onDropSuggestion={() => dropped.push(1)}
      />,
    );
    fireEvent.keyDown(getByTestId('composer-input'), { key: 'Escape' });
    expect(dropped).toEqual([1]);
  });

  /** A fresh order nulls the projection, so a LATER suggestion is a live one again. */
  it('leaves the next suggestion standing', () => {
    const { getByTestId, queryByTestId, rerender } = renderWithI18n(
      <PanelShell view={makeView({ suggestion: 'first' })} connected now={0} {...VERBS} />,
    );
    fireEvent.keyDown(getByTestId('composer-input'), { key: 'Escape' });
    expect(queryByTestId('composer-ghost')).toBeNull();

    rerender(<PanelShell view={makeView({ suggestion: 'second' })} connected now={0} {...VERBS} />);
    expect(getByTestId('composer-ghost').textContent).toBe('second');
  });
});

/**
 * THE DOCK'S NUMBERS ARE DERIVED FROM A RENDER INPUT, so with nothing re-rendering the panel they
 * froze at whatever second the job (or the backoff) began and the wait read as a hang. The panel runs
 * its own ~1Hz clock while (and only while) a face is counting: a running job's elapsed reading and a
 * retry's countdown both move, and a hold or a receipt reads a stamp instead and needs no tick.
 */
describe('PanelShell: the dock clock', () => {
  const retrying = (since: number) => makeView({
    phase: 'retrying',
    current: makeJob(),
    retry: { attempt: 2, cls: 'rate-limit', delayMs: 9000, since },
  });

  it('moves the countdown on its own, with nothing else re-rendering', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      const { getByTestId } = renderWithI18n(
        <PanelShell view={retrying(0)} connected {...VERBS} />,
      );
      expect(getByTestId('retry-seconds').textContent).toBe('9');

      act(() => { vi.advanceTimersByTime(2_000); });
      expect(getByTestId('retry-seconds').textContent).toBe('7');
    } finally {
      vi.useRealTimers();
    }
  });

  it('runs no clock at all when nothing is being waited out', () => {
    vi.useFakeTimers();
    try {
      const idle = renderWithI18n(<PanelShell view={makeView()} connected {...VERBS} />);
      expect(vi.getTimerCount()).toBe(0);
      idle.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops the clock when the session settles, and keeps it while a job runs', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      const { rerender } = renderWithI18n(<PanelShell view={retrying(0)} connected {...VERBS} />);
      expect(vi.getTimerCount()).toBeGreaterThan(0);

      // The wait is over but the job is not: the dock's elapsed reading is still moving.
      rerender(<PanelShell view={makeView({ phase: 'executing', current: makeJob() })} connected {...VERBS} />);
      expect(vi.getTimerCount()).toBeGreaterThan(0);

      rerender(<PanelShell view={makeView()} connected {...VERBS} />);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('an injected clock overrides its own, so a test reads an exact second', () => {
    vi.useFakeTimers();
    try {
      const { getByTestId } = renderWithI18n(
        <PanelShell view={retrying(0)} connected now={4_000} {...VERBS} />,
      );
      expect(getByTestId('retry-seconds').textContent).toBe('5');
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('PanelShell: the celebrate edge', () => {
  /** WHETHER A SETTLEMENT IS WORTH A DANCE IS THE PROJECTION'S ANSWER (`JobView.celebrate`: done, at
   *  least one write LANDED, not ended on a question), and the hook reads it rather than deriving
   *  one from the outcome — so these fixtures carry the flag the fold would have set. The answer
   *  family's own four negatives are held in `answer-paper.test.tsx`. */
  const settled = (seq: number, outcome: JobView['outcome'], celebrate = outcome === 'done') =>
    makeView({ jobs: [makeJob({ orderSeq: seq, outcome, celebrate, kind: 'build' })] });

  it('celebrates when a job finishes well, once, and settles back', () => {
    vi.useFakeTimers();
    try {
      const { getByTestId, rerender } = renderWithI18n(
        <PanelShell view={makeView({ phase: 'executing', current: makeJob() })} connected now={0} {...VERBS} />,
      );
      const pose = () => getByTestId('desk-header-char-slot').firstElementChild?.getAttribute('data-pose');
      expect(pose()).not.toBe('celebrating');

      rerender(<PanelShell view={settled(1, 'done')} connected now={0} {...VERBS} />);
      expect(pose()).toBe('celebrating');

      // A re-render of the SAME settled job is not a second finish.
      act(() => { vi.advanceTimersByTime(POSES.celebrating.settleAt ?? 0); });
      expect(pose()).not.toBe('celebrating');
      rerender(<PanelShell view={settled(1, 'done')} connected now={0} {...VERBS} />);
      expect(pose()).not.toBe('celebrating');
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * THE DANCE HAS TWO ENDINGS, and the second one is the one a cleanup can swallow: kill the clock
   * there and the newly settled job takes the non-firing branch, lowering nothing, so the character
   * goes on celebrating over its own failure banner until something else finishes well.
   */
  it('stops the moment the next job settles badly, well inside the clock', () => {
    vi.useFakeTimers();
    try {
      const { getByTestId, rerender } = renderWithI18n(
        <PanelShell view={makeView({ phase: 'executing', current: makeJob() })} connected now={0} {...VERBS} />,
      );
      const pose = () => getByTestId('desk-header-char-slot').firstElementChild?.getAttribute('data-pose');

      rerender(<PanelShell view={settled(1, 'done')} connected now={0} {...VERBS} />);
      expect(pose()).toBe('celebrating');

      act(() => { vi.advanceTimersByTime(200); });
      rerender(
        <PanelShell
          view={makeView({
            phase: 'incident',
            jobs: [
              makeJob({ orderSeq: 1, outcome: 'done', kind: 'build', celebrate: true }),
              makeJob({ orderSeq: 2, outcome: 'incident', errorCls: 'network' }),
            ],
          })}
          connected
          now={0}
          {...VERBS}
        />,
      );
      expect(pose()).not.toBe('celebrating');

      // And it stays down for the rest of what would have been the first job's window.
      act(() => { vi.advanceTimersByTime(POSES.celebrating.settleAt ?? 0); });
      expect(pose()).not.toBe('celebrating');
    } finally {
      vi.useRealTimers();
    }
  });

  it('never celebrates on arrival at a session that was already finished', () => {
    const { getByTestId } = renderWithI18n(
      <PanelShell view={settled(7, 'done')} connected now={0} {...VERBS} />,
    );
    expect(getByTestId('desk-header-char-slot').firstElementChild?.getAttribute('data-pose'))
      .not.toBe('celebrating');
  });

  it('does not celebrate a job that was stopped, capped or broken', () => {
    for (const outcome of ['aborted', 'capped', 'incident'] as const) {
      const { getByTestId, rerender, unmount } = renderWithI18n(
        <PanelShell view={makeView({ phase: 'executing', current: makeJob() })} connected now={0} {...VERBS} />,
      );
      rerender(<PanelShell view={settled(1, outcome)} connected now={0} {...VERBS} />);
      expect(
        getByTestId('desk-header-char-slot').firstElementChild?.getAttribute('data-pose'),
        outcome,
      ).not.toBe('celebrating');
      unmount();
    }
  });
});

/**
 * THE FRAME'S ROOM WINS OVER THE PANEL'S WANTED HEIGHT.
 *
 * A `min-height` written beside a `max-height` does not yield to it: CSS resolves the conflict in
 * the MIN's favour, so the panel stood at its authored 430 in a window that had 367 (the frame's own
 * reference window, 1280x800) and at 430 in a Generate-mode window that had 159, standing over the
 * shelf's candidate cards. `min()` is what makes a wanted height a want.
 */
describe('PanelShell: how tall it stands', () => {
  it('takes its authored height when the caller names no cap', () => {
    const { getByTestId } = renderWithI18n(<PanelShell view={makeView()} connected now={0} {...VERBS} />);
    const style = getByTestId('panel-shell').style;
    expect(style.minHeight).toBe(`${PANEL_MIN_HEIGHT}px`);
    expect(style.maxHeight).toBe('');
  });

  it('yields the wanted height to the cap, rather than overflowing it', () => {
    const cap = 'calc(100vh - 480px)';
    const { getByTestId } = renderWithI18n(
      <PanelShell view={makeView()} connected now={0} maxHeight={cap} {...VERBS} />,
    );
    const style = getByTestId('panel-shell').style;
    expect(style.maxHeight).toBe(cap);
    // The floor is the SMALLER of the two, so a short window caps the panel instead of being
    // overrun by it.
    expect(style.minHeight.replace(/\s+/g, '')).toBe(`min(${PANEL_MIN_HEIGHT}px,${cap})`.replace(/\s+/g, ''));
  });

  /** Connection screens supply their own height and remain bounded by the caller's cap. */
  it('hugs a connection screen instead of standing at the want', () => {
    const cap = 'calc(100vh - 480px)';
    const rest = renderWithI18n(
      <PanelShell view={makeView()} connected={false} now={0} maxHeight={cap} {...VERBS} />,
    );
    expect(rest.getByTestId('dream-office')).toBeTruthy();
    expect(rest.getByTestId('panel-shell').style.minHeight).toBe('0');
    expect(rest.getByTestId('panel-shell').style.maxHeight).toBe(cap);

    fireEvent.click(rest.getByTestId('dream-connect'));
    expect(rest.getByTestId('setup-screen')).toBeTruthy();
    expect(rest.getByTestId('panel-shell').style.minHeight).toBe('0');
    rest.unmount();

    // And a desk with the record under it still wants its column.
    const record = renderWithI18n(
      <PanelShell view={makeView()} connected now={0} maxHeight={cap} {...VERBS} />,
    );
    expect(record.getByTestId('panel-shell').style.minHeight.replace(/\s+/g, ''))
      .toBe(`min(${PANEL_MIN_HEIGHT}px,${cap})`.replace(/\s+/g, ''));
  });
});

/**
 * THE PANEL TAKES A MAX HEIGHT AND ONLY THE MIDDLE SCROLLS.
 *
 * A pinned desk on top, a pinned composer at the bottom, ONE scrolling job zone between them: the
 * two controls a user needs are the two that never move, and the record is what gives way. jsdom
 * lays nothing out, so what is asserted is the DECLARATIONS the layout rests on — a desk or composer
 * that could shrink, or a second scroller, is the defect this stands against.
 */
describe('PanelShell: the three zones', () => {
  function zoneStyles(connected = true) {
    const view = renderWithI18n(
      <PanelShell
        view={makeView({ phase: 'executing', current: makeJob() })}
        connected={connected}
        now={0}
        maxHeight="calc(100vh - 480px)"
        {...VERBS}
      />,
    );
    const panel = view.getByTestId('panel-shell');
    return { view, panel, children: [...panel.children] as HTMLElement[] };
  }

  it('pins the desk and the composer, and scrolls the job zone alone', () => {
    const { view, panel, children } = zoneStyles();
    const laidOut = children.filter((el) => el.style.display !== 'none');

    for (const el of laidOut) {
      const isZone = el.dataset.testid === 'panel-job-zone';
      // THE STEER STACK IS THE ONE ZONE THAT MAY GIVE WAY BESIDE THE RECORD, and it is not a second
      // scroller: the CHIPS box inside it scrolls, so a squeeze takes chip rows and never the count
      // line under them (`SteerQueue`'s own suite holds that half). The desk and the composer are
      // still pinned outright, which is the rule this stands on.
      const mayShrink = el.dataset.testid === 'panel-steer-zone';
      expect(el.style.flex, el.dataset.testid ?? el.tagName)
        .toBe(isZone ? '1 1 auto' : mayShrink ? '0 1 auto' : '0 0 auto');
      expect(el.style.overflowY, el.dataset.testid ?? el.tagName).toBe(isZone ? 'auto' : '');
    }
    // The cap is the panel's own, so the zone is what the cap squeezes.
    expect(panel.style.maxHeight).toBe('calc(100vh - 480px)');
    // The desk stands in its band (the box that seats the docked controls), and the band is the
    // panel's own child.
    expect(view.getByTestId('desk-header').parentElement).toBe(view.getByTestId('desk-band'));
    expect(view.getByTestId('desk-band').parentElement).toBe(panel);
    expect(view.getByTestId('composer').parentElement).toBe(panel);
    view.unmount();
  });

  /** A KEY THAT WENT AWAY UNDER A RUNNING JOB IS NOT A SCREEN: the zone keeps the record, so all
   *  four zones stand and the composer is blocked in place with the repair on it. The setup family
   *  (the keyless rest, the connection screen, the manage card) is what draws no composer at all. */
  it('keeps all four zones where the record still stands, key or no key', () => {
    const { view, children } = zoneStyles(false);
    const zone = children.find((el) => el.dataset.testid === 'panel-job-zone')!;
    expect(zone.style.flex).toBe('1 1 auto');
    expect(view.getByTestId('composer').style.flex).toBe('0 0 auto');
    view.unmount();
  });

  /**
   * HOVER GROWTH NEEDS ROOM INSIDE THE CLIP. The house press feedback scales a control to 1.03 about
   * its centre, so a 336px row grows 5.04px per side — past an `overflow-x: hidden` edge that had 1px
   * of padding, and the card's own border vanished under the pointer. The gutter IS that growth and
   * the negative margin hands the width back; the -5 is the 6 less the 1px the box already had.
   */
  it('carries the hover-growth gutter exactly', () => {
    const { view, children } = zoneStyles();
    const zone = children.find((el) => el.dataset.testid === 'panel-job-zone')!;
    expect(zone.style.padding).toBe('1px 6px');
    expect(zone.style.margin).toBe('0px -5px');
    expect(zone.style.overflowX).toBe('hidden');
    view.unmount();
  });

  /**
   * THE FLOOR YIELDS TO THE CAP, and the order of those two words is the whole of it: a floor that
   * wins pushes the COMPOSER out of the panel. Measured in the real frame at 1280x800
   * (the frame stands under a 1.25 zoom, so the room is the viewport DIVIDED by it): Object mode's
   * room is 233px against a pinned 180 (desk 74 + composer 48 + three 10px gaps + 28 of padding), so
   * a flat 72 asked for 252 and the last 19px of the composer were clipped away; Generate mode's is
   * 159, where the composer landed entirely outside the panel and a press on it answered CANVAS.
   *
   * So the floor is what is left after the pinned zones, capped at 72: it is the record's floor where
   * there is room for one, and nothing where there is not. The desk and the composer are sacred.
   */
  it('floors the record only as far as the cap allows', () => {
    const capped = renderWithI18n(
      <PanelShell
        view={makeView({ phase: 'executing', current: makeJob() })}
        connected
        now={0}
        maxHeight="calc(100vh - 480px)"
        {...VERBS}
      />,
    );
    const floor = capped.getByTestId('panel-job-zone').style.minHeight.replace(/\s+/g, '');
    expect(floor).toBe(`min(${JOB_ZONE_FLOOR}px,max(0px,calc(calc(100vh - 480px) - ${PINNED_HEIGHT}px)))`.replace(/\s+/g, ''));
    capped.unmount();

    // With no cap named the caller is not standing the panel in a room, so the floor is the floor.
    const free = renderWithI18n(
      <PanelShell view={makeView({ phase: 'executing', current: makeJob() })} connected now={0} {...VERBS} />,
    );
    expect(free.getByTestId('panel-job-zone').style.minHeight).toBe(`${JOB_ZONE_FLOOR}px`);
    free.unmount();
  });

  /** THE PROPERTY THE FLOOR MUST NOT BREAK: where the frame leaves less room than the zones want,
   *  the record gives way to NOTHING and the two standing controls keep their place. The waiver
   *  below is the other way to reach zero.
   *
   *  jsdom resolves no `min()`/`max()`, so what is asserted here is the EXPRESSION that yields zero;
   *  that it really resolves to `0px` in a 159px room is measured in a browser (Generate mode at
   *  1280x800). */
  it('lets the record be squeezed to nothing', () => {
    // A room smaller than the pinned zones: `max(0px, …)` is what keeps the floor from going
    // negative, and the arithmetic inside it is what makes it zero here.
    const { getByTestId } = renderWithI18n(
      <PanelShell
        view={makeView({ phase: 'executing', current: makeJob() })}
        connected
        now={0}
        maxHeight="100px"
        {...VERBS}
      />,
    );
    const floor = getByTestId('panel-job-zone').style.minHeight.replace(/\s+/g, '');
    expect(floor).toContain('max(0px,');
    expect(floor).toContain(`calc(100px-${PINNED_HEIGHT}px)`); // whitespace already stripped above
  });

  /** A lone closed history row needs no job-zone floor beneath it. */
  it('waives the floor for a lone closed history row', () => {
    const done = makeJob({ outcome: 'done', kind: 'build' });
    const rest = renderWithI18n(
      <PanelShell
        view={makeView({ jobs: [done] })}
        connected
        now={0}
        filed={new Set([done.orderSeq])}
        {...VERBS}
      />,
    );
    expect(rest.getByTestId('panel-job-zone').style.minHeight).toBe('0');
    rest.unmount();

    // A record still standing as a card is not that shape, and keeps its floor.
    const carded = renderWithI18n(
      <PanelShell view={makeView({ jobs: [done] })} connected now={0} {...VERBS} />,
    );
    expect(carded.getByTestId('panel-job-zone').style.minHeight).toBe(`${JOB_ZONE_FLOOR}px`);
    carded.unmount();

    // An empty desk keeps it: the zone is where the next thing lands.
    const empty = renderWithI18n(<PanelShell view={makeView()} connected now={0} {...VERBS} />);
    expect(empty.getByTestId('panel-job-zone').style.minHeight).toBe(`${JOB_ZONE_FLOOR}px`);
    empty.unmount();
  });

  /** The shade may only cover what scrolls away, so with nothing scrolling there is no mask at all
   *  (jsdom reports every box as 0x0, which is the "it all fits" reading). */
  it('wears no shade over a record that is all showing', () => {
    const { view, children } = zoneStyles();
    const zone = children.find((el) => el.dataset.testid === 'panel-job-zone')!;
    expect(zone.style.maskImage).toBe('');
    view.unmount();
  });
});

/** The job zone follows projection changes so new operations, gates, and summaries remain visible.
 * jsdom has no layout, so these tests observe writes to `scrollTop`. */
describe('PanelShell: the record follows the work', () => {
  function watchScroll() {
    const writes: number[] = [];
    const proto = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTop');
    Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
      configurable: true,
      get: () => 0,
      set(v: number) { writes.push(v); },
    });
    return { writes, restore: () => { if (proto) Object.defineProperty(HTMLElement.prototype, 'scrollTop', proto); } };
  }

  it('scrolls the job zone when the projection changes', () => {
    const watch = watchScroll();
    try {
      const { rerender } = renderWithI18n(
        <PanelShell view={makeView({ phase: 'executing', current: makeJob() })} connected now={0} {...VERBS} />,
      );
      const before = watch.writes.length;
      rerender(<PanelShell view={makeView({ phase: 'idle', jobs: [makeJob({ outcome: 'done' })] })} connected now={0} {...VERBS} />);
      expect(watch.writes.length).toBeGreaterThan(before);
    } finally { watch.restore(); }
  });

  /** The setup screen is a form read from the top down, not a record: scrolling it to the foot
   *  hides its opening line. */
  it('leaves the setup screen where it opens', () => {
    const watch = watchScroll();
    try {
      renderWithI18n(<PanelShell view={makeView()} connected={false} now={0} {...VERBS} />);
      expect(watch.writes).toEqual([]);
    } finally { watch.restore(); }
  });

  /**
   * THE PIN SURVIVES THE ROOM CHANGING, and telling a SCROLL from a RESHAPE is what it took. The
   * browser adjusts a scroller's own `scrollTop` as its box changes and fires `scroll` for it; read
   * as a scroll, that is the user saying "I am reading" about a move they never made, and the follow
   * was dropped for good — measured in the live app, an open gate's Approve 20px below the fold
   * after an 800 -> 780 -> 800 round trip and 50px after a width-only one.
   */
  function standAtFoot(scrollTop: number) {
    const view = renderWithI18n(
      <PanelShell view={makeView({ phase: 'executing', current: makeJob() })} connected now={0} {...VERBS} />,
    );
    const zone = view.getByTestId('panel-job-zone');
    const box = { scrollHeight: 400, clientHeight: 200 };
    for (const k of ['scrollHeight', 'clientHeight'] as const) {
      Object.defineProperty(zone, k, { configurable: true, get: () => box[k] });
    }
    // jsdom's own `scrollTop` swallows every write (nothing here is scrollable), so the element gets
    // a real one: the position IS the subject.
    Object.defineProperty(zone, 'scrollTop', { configurable: true, writable: true, value: 0 });
    zone.scrollTop = scrollTop;
    fireEvent.scroll(zone);
    return { view, zone, box };
  }

  it('re-takes the foot when the box changes under a record that was at it', () => {
    const { view, zone, box } = standAtFoot(400);
    // The zone grows and the browser drags the position with it, exactly as a resize does.
    box.clientHeight = 260;
    zone.scrollTop = 140;
    fireEvent.scroll(zone);
    expect(zone.scrollTop).toBe(400);
    view.unmount();
  });

  it('leaves a record the user has scrolled up in exactly where they left it', () => {
    const { view, zone } = standAtFoot(400);
    zone.scrollTop = 100;
    fireEvent.scroll(zone);
    expect(zone.scrollTop, 'the box did not move, so this one is the hand on the wheel').toBe(100);

    // And a later reshape does not haul them back down.
    fireEvent.scroll(zone);
    expect(zone.scrollTop).toBe(100);
    view.unmount();
  });

  /**
   * CONTENT GROWING INSIDE AN UNCHANGED BOX FIRES NO SCROLL OF ITS OWN (a deck fanning open on its
   * height, a thoughts box), so a cached scrollHeight is stale by the user's next scroll — read
   * against it, the hand on the wheel was taken for a reshape and yanked to the foot (measured live:
   * a fanned deck's reader re-pinned mid-read). Only the BOX changing makes the browser move
   * `scrollTop` on its own, so the box is the whole reshape test.
   */
  it('keeps the user scroll made right after content grew under an unchanged box', () => {
    const { view, zone, box } = standAtFoot(400);
    box.scrollHeight = 800;
    zone.scrollTop = 100;
    fireEvent.scroll(zone);
    expect(zone.scrollTop, 'the box did not move, so this one is the hand on the wheel').toBe(100);
    view.unmount();
  });
});

describe('PanelShell: the character slots', () => {
  it('draws its own character until an entrance plate is given', () => {
    const { getByTestId } = renderWithI18n(<PanelShell view={makeView()} connected now={0} {...VERBS} />);
    expect(getByTestId('desk-header-char-slot').children.length).toBeGreaterThan(0);
  });

  /** The FLIP leap measures both slots in viewport coordinates and positions the character `fixed`;
   *  a transform anywhere above either endpoint would become its containing block. */
  it('puts no transform or filter on any ancestor of the desk slot', () => {
    const { getByTestId } = renderWithI18n(<PanelShell view={makeView()} connected now={0} {...VERBS} />);
    let el: HTMLElement | null = getByTestId('desk-header-char-slot');
    while (el && el !== document.body) {
      expect(el.style.transform, el.getAttribute('data-testid') ?? el.tagName).toBe('');
      expect(el.style.filter, el.getAttribute('data-testid') ?? el.tagName).toBe('');
      el = el.parentElement;
    }
  });
});

/**
 * THE FREE PANEL'S DOCK CONTROL IS A DISC FLOATING ON ITS TOP-RIGHT CORNER, and three facts place it.
 *
 * It stands OUTSIDE the plate in the tree, because the plate clips (its own overflow, and the clip the
 * entrance wipe rides), so a child hanging past the edge would be cut off and half of it unpressable.
 * It is CENTRED ON THE RIGHT EDGE, so the half of it that lies on the paper reaches exactly the plate's
 * own padding — the gutter every one of the plate's children begins after — and cannot touch the
 * character's seat or the dock card whatever either holds. And its TOP is the plate's own top edge,
 * which is the line the selected block's caption stands above.
 */
describe('PanelShell: the dock knob', () => {
  const knob = () => renderWithI18n(
    <PanelShell view={makeView()} connected now={0} {...VERBS} onTogglePin={() => {}} />,
  );

  it('floats on the plate\'s top-right corner, centred on the edge', () => {
    const { getByTestId } = knob();
    const cluster = getByTestId('desk-pin');
    // Placed against the HOLDER, hanging out by half of itself: that is what "centred on the edge" is.
    expect(parseFloat(cluster.style.right)).toBe(-PIN_KNOB_OUT);
    expect(PIN_KNOB_OUT).toBe(PIN_KNOB.size / 2);
    // The half on the paper is the plate's own padding and no more.
    expect(PIN_KNOB_OUT).toBeLessThanOrEqual(PANEL_PAD);
  });

  it('hangs from the plate\'s own corner, clear of both the curve and the caption above', () => {
    // Higher than the radius its inner half stands over the curve, where there is no paper behind the
    // join; above the plate's top edge at all it reaches into the clearance the selected block's
    // caption box stands in.
    const { getByTestId } = knob();
    const top = parseFloat(getByTestId('desk-pin').style.top);
    expect(top).toBe(PANEL_RADIUS);
    expect(top).toBeGreaterThanOrEqual(0);
  });

  it('stands outside the plate in the tree, since the plate clips', () => {
    const { getByTestId } = knob();
    const plate = getByTestId('panel-shell');
    const cluster = getByTestId('desk-pin');
    expect(plate.contains(cluster)).toBe(false);
    // The holder is what they share, and it holds no paper, outline or clip of its own.
    expect(cluster.parentElement).toBe(plate.parentElement);
    expect(plate.style.overflow).toBe('hidden');
  });

  /** THE KNOB IS PART OF THE PANEL, so it goes where the panel goes: the HOLDER carries the fade and the
   *  open gesture's travel, or the knob would be left standing on the map after the panel had gone. */
  it('shares the holder the gesture is carried on', () => {
    const { getByTestId } = knob();
    const holder = getByTestId('panel-shell').parentElement as HTMLElement;
    expect(holder.style.position).toBe('relative');
    expect(holder.style.background).toBe('');
    expect(holder.style.borderRadius).toBe('');
  });

  it('gives way to a stacked pair of buttons once the panel is docked', () => {
    const { getByTestId, queryByTestId } = renderWithI18n(
      <PanelShell
        view={makeView()}
        connected
        now={0}
        {...VERBS}
        pinned
        onTogglePin={() => {}}
        onSwitchSide={() => {}}
      />,
    );
    const cluster = getByTestId('desk-pin');
    expect(cluster.style.flexDirection).toBe('column');
    expect(getByTestId('panel-shell').contains(cluster)).toBe(true);
    expect(queryByTestId('dock-switch')).not.toBeNull();
  });

  /**
   * DOCKED, THE PAIR IS CENTRED ON THE DOCK BAND rather than hung from the plate's corner: the card
   * beside them starts at the plate's padding and is `DOCK_HEIGHT` tall, so the file's own midline is
   * that band's midline and the two controls read as part of the row they stand in.
   */
  it('centres the docked pair on the dock band it stands beside', () => {
    const { getByTestId } = renderWithI18n(
      <PanelShell
        view={makeView()}
        connected
        now={0}
        {...VERBS}
        pinned
        onTogglePin={() => {}}
        onSwitchSide={() => {}}
      />,
    );
    const top = parseFloat(getByTestId('desk-pin').style.top);
    expect(top + DOCK_CHROME_FILE_H / 2).toBe(PANEL_PAD + DOCK_HEIGHT / 2);
  });

  /**
   * THE DOCKED PAIR STANDS AT THE RIGHT IN BOTH DOCK MODES: same spot whether the panel hugs the
   * left or the right window edge — no mirroring, no inner-seam variant.
   */
  it('stands the docked pair at the right edge whichever side the dock is at', () => {
    for (const side of ['left', 'right'] as const) {
      const { getByTestId, unmount } = renderWithI18n(
        <PanelShell
          view={makeView()}
          connected
          now={0}
          {...VERBS}
          pinned
          dockSide={side}
          onTogglePin={() => {}}
          onSwitchSide={() => {}}
        />,
      );
      const cluster = getByTestId('desk-pin');
      expect(cluster.style.right, side).toBe(`${PANEL_PAD}px`);
      expect(cluster.style.left, side).toBe('');
      unmount();
    }
  });

  /**
   * THE GUTTER IS THE BUTTONS' SEAT ONLY WHERE THE BUTTONS ARE: the desk band keeps clear of the
   * file of two, and everything below the dock band takes the docked column's whole width.
   */
  it('reserves the buttons\' seat in the desk band alone, and only while docked', () => {
    const docked = renderWithI18n(
      <PanelShell
        view={makeView()}
        connected
        now={0}
        {...VERBS}
        pinned
        onTogglePin={() => {}}
        onSwitchSide={() => {}}
      />,
    );
    expect(docked.getByTestId('desk-band').style.paddingRight).toBe(`${DOCK_CHROME_W}px`);
    docked.unmount();
    const free = renderWithI18n(
      <PanelShell view={makeView()} connected now={0} {...VERBS} onTogglePin={() => {}} />,
    );
    expect(parseFloat(free.getByTestId('desk-band').style.paddingRight)).toBe(0);
  });
});

/**
 * THE KNOB RIDES THE WIPE: the floating dock button is part of the panel. The plate's
 * entrance and exit clip its PAINT to a rect growing out of its top-left corner, and the knob stands
 * outside that clip — left unmoved, the disc hung whole over the map while the sheet it hangs on
 * shrank into the far corner. So its carry is ARITHMETIC over the same animated clip value the plate
 * paints with: one driver, never a second clock, the same contract the character's `placeCarried`
 * keeps for her seat.
 */
describe('PanelShell: the knob rides the wipe', () => {
  const clipOf = (state: string): string =>
    String((plateVariants[state] as { clipPath: string }).clipPath);

  it('reads the seed rect as the carry that folds the disc into the corner with the plate', () => {
    const carry = knobCarry(clipOf('hidden'));
    // Centred on the visible right edge: the whole of the clipped width, leftward.
    expect(carry.x).toBeCloseTo(-PANEL_WIDTH * 0.92, 3);
    // Proportionally down the visible height, from the disc's own resting centre.
    expect(carry.y).toBeCloseTo(-(PANEL_RADIUS + PIN_KNOB.size / 2) * 0.92, 3);
    // At the visible box's own share of the plate.
    expect(carry.scale).toBeCloseTo(0.08, 3);
  });

  it('carries the knob nowhere at the open rect, its hair of negative inset included', () => {
    for (const state of ['shown', 'ground'] as const) {
      const carry = knobCarry(clipOf(state));
      expect(carry.x, state).toBeCloseTo(0, 6);
      expect(carry.y, state).toBeCloseTo(0, 6);
      expect(carry.scale, state).toBeCloseTo(1, 6);
    }
  });

  /** An inset serializes to fewer components when edges agree, and the carry must read every
   *  spelling the engine can hand back or the disc jumps at a serialization boundary. */
  it('reads every inset arity the engine can serialize', () => {
    expect(knobCarry('inset(50%)').scale).toBeCloseTo(0.5, 6);
    expect(knobCarry('inset(0% 50%)').x).toBeCloseTo(-PANEL_WIDTH / 2, 6);
    expect(knobCarry('inset(0% 50%)').y).toBeCloseTo(0, 6);
    expect(knobCarry('inset(0% 40% 20%)').y)
      .toBeCloseTo(-(PANEL_RADIUS + PIN_KNOB.size / 2) * 0.2, 6);
    expect(knobCarry('none')).toEqual({ x: 0, y: 0, scale: 1 });
  });

  /** ONE DRIVER: the free knob's rendered transform is the plate's own clip read as a carry, on the
   *  entrance's first frame — not a second animation approximating the same journey. */
  it('carries the free knob on the plate\'s own clip', () => {
    const { getByTestId } = render(
      <MotionConfig reducedMotion="never">
        <I18nProvider>
          <PanelShell view={makeView()} connected now={0} {...VERBS} hosted onTogglePin={() => {}} />
        </I18nProvider>
      </MotionConfig>,
    );
    const carry = knobCarry(getByTestId('panel-shell').style.clipPath);
    expect(carry.scale).toBeLessThan(1);
    const t = getByTestId('desk-pin').style.transform;
    expect(parseFloat(/translateX\((-?[\d.]+)px\)/.exec(t)?.[1] ?? 'NaN')).toBeCloseTo(carry.x, 3);
    expect(parseFloat(/translateY\((-?[\d.]+)px\)/.exec(t)?.[1] ?? 'NaN')).toBeCloseTo(carry.y, 3);
    expect(parseFloat(/scale\((-?[\d.]+)\)/.exec(t)?.[1] ?? 'NaN')).toBeCloseTo(carry.scale, 3);
  });

  it('leaves the standing knob unmoved, reduced motion and docked alike', () => {
    const free = renderWithI18n(
      <PanelShell view={makeView()} connected now={0} {...VERBS} onTogglePin={() => {}} />,
    );
    expect(['', 'none']).toContain(free.getByTestId('desk-pin').style.transform);
    free.unmount();
    const docked = renderWithI18n(
      <PanelShell view={makeView()} connected now={0} {...VERBS} pinned onTogglePin={() => {}} />,
    );
    expect(['', 'none']).toContain(docked.getByTestId('desk-pin').style.transform);
  });
});

/**
 * THE COVERED BEAT LANDS WITH THE COMMIT. Framer applies even an instant transition on its own next
 * frame, while the swap from docked to free geometry is React's own — so for exactly that frame the
 * free plate stood whole and opaque wearing the ground's values, painted over the sheet that is
 * covering the window (measured on the too-narrow auto-undock). `visibility` is inline and discrete,
 * so it lands in the same paint as the geometry.
 */
describe('PanelShell: the covered beat', () => {
  const shell = (away?: 'leaving' | 'folded') => (
    <PanelShell
      view={makeView()}
      connected
      now={0}
      {...VERBS}
      {...(away ? { away } : {})}
      onTogglePin={() => {}}
    />
  );

  it('is invisible in the very commit the folded beat lands in', () => {
    const { getByTestId, rerender } = renderWithI18n(shell());
    const holder = () => getByTestId('panel-shell').parentElement as HTMLElement;
    expect(holder().style.visibility).toBe('');
    rerender(shell('folded'));
    expect(holder().style.visibility).toBe('hidden');
    rerender(shell());
    expect(holder().style.visibility).toBe('');
  });

  it('keeps the watched exit visible', () => {
    const { getByTestId } = renderWithI18n(shell('leaving'));
    expect((getByTestId('panel-shell').parentElement as HTMLElement).style.visibility).toBe('');
  });
});

/**
 * DOCKED, THE ZONE'S HEIGHT IS THE WINDOW'S, so a screen that rations itself for the floating
 * plate's room has hundreds of px standing empty under it. The keyless rest shows the whole dream
 * pool, and the idle rest seats its sketch card at the zone's foot, nearest the composer.
 */
describe('PanelShell: the docked zone uses its room', () => {
  it('stands the whole dream pool on the keyless rest while docked', () => {
    const { getAllByTestId } = renderWithI18n(
      <PanelShell
        view={makeView()}
        connected={false}
        now={0}
        {...VERBS}
        pinned
        onTogglePin={() => {}}
      />,
    );
    expect(getAllByTestId('dream-row')).toHaveLength(DREAMS.length);
  });

  it('seats the idle sketch card at the zone\'s foot while docked, and in the flow while free', () => {
    const card = <div data-testid="sketch-card-stub" />;
    const docked = renderWithI18n(
      <PanelShell
        view={makeView()}
        connected
        now={0}
        {...VERBS}
        sketchbook={card}
        pinned
        onTogglePin={() => {}}
      />,
    );
    expect(docked.getByTestId('sketch-seat').style.marginTop).toBe('auto');
    docked.unmount();
    const free = renderWithI18n(
      <PanelShell view={makeView()} connected now={0} {...VERBS} sketchbook={card} />,
    );
    expect(parseFloat(free.getByTestId('sketch-seat').style.marginTop)).toBe(0);
  });
});

describe('panel copy, in every locale', () => {
  const KEYS = [
    'agent3.steer_at_next_step', 'agent3.steer_take_back', 'agent3.dock_disconnected',
    'agent3.dock_setup_awake', 'agent3.dock_setup_show_key', 'agent3.banner_rate_limit',
  ];
  const locales = Object.keys(translations) as Locale[];

  it('is present in all seven and carries no em dash or dot separator', () => {
    for (const loc of locales) {
      for (const key of KEYS) {
        const value = translations[loc][key];
        expect(value, `${loc}/${key}`).toBeTruthy();
        expect(value, `${loc}/${key}`).not.toMatch(/[—·•]/);
      }
    }
  });

  /** The disconnected rest and credential form use distinct status messages; neither claims the
   * panel is ready for orders. */
  it('says not connected at the keyless rest, and awake once the form is asking', () => {
    const { getByTestId } = renderWithI18n(
      <PanelShell view={makeView()} connected={false} now={0} {...VERBS} />,
    );
    expect(getByTestId('dock-sentence').textContent).toBe(translations.en['agent3.dock_disconnected']);
    fireEvent.click(getByTestId('dream-connect'));
    expect(getByTestId('dock-sentence').textContent).toBe(translations.en['agent3.dock_setup_awake']);
  });
});

/**
 * THE PANEL BOX TWEENS TO ITS NEW CONTENT HEIGHT (`panel.height`), and the way it does so is the
 * point: a Web Animations keyframe pair on the real `height` property, never a framer `layout`
 * animation — that one animates a size change with a TRANSFORM, and a transform on the panel becomes
 * the containing block for the `fixed` character standing in its desk, so her leap would land
 * somewhere else entirely.
 *
 * jsdom has no Web Animations API, so `animate` is stubbed and what is asserted is the CALL: the two
 * heights, the declared length, the declared curve.
 */
describe('PanelShell: the height tween', () => {
  interface Call { frames: Record<string, unknown>[]; options: { duration?: number; easing?: string } }

  /**
   * The panel's OWN height, and a way to move it between commits.
   *
   * `offsetHeight` rather than a rect, which is the trap this measurement carries: the panel stands
   * inside the frame's css `zoom`, where `getBoundingClientRect` answers in SCREEN px (550 for a
   * 440px panel at zoom 1.25) while the `height` being animated is in the element's own px. jsdom
   * reports 0 for both, so the stub is what stands in for layout — but it moves only when the test
   * moves it, so the two readings the tween compares are a real before and after.
   */
  function withStubs(initial: number) {
    const calls: Call[] = [];
    const realAnimate = (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
    const own = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
    let height = initial;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (HTMLElement.prototype as any).animate = function animate(frames: Record<string, unknown>[], options: { duration?: number; easing?: string }) {
      // Framer drives the panel's own entrance through this same API; only the height pair is ours.
      if (Array.isArray(frames) && frames.some((f) => f && 'height' in f)) calls.push({ frames, options });
      return { cancel: () => {}, finish: () => {} };
    };
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get(this: HTMLElement) { return this.dataset.testid === 'panel-shell' ? height : 0; },
    });
    return {
      calls,
      grow: (to: number) => { height = to; },
      restore: () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (HTMLElement.prototype as any).animate = realAnimate;
        if (own) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', own);
        else delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetHeight;
      },
    };
  }

  function Moving({ children }: { children: React.ReactNode }) {
    return (
      <MotionConfig reducedMotion="never">
        <I18nProvider>{children}</I18nProvider>
      </MotionConfig>
    );
  }

  const gated = makeView({
    phase: 'gated', current: makeJob(), gate: { gateId: 'g1', scope: 'tool', summary: 'ask' },
  });

  /**
   * IT COMPARES ACROSS COMMITS, and that is the whole of it: two readings taken in the same layout
   * effect, AFTER the DOM already holds the new content, are equal by construction and the tween
   * never runs in the real app (four real shape changes, including 367 to 159 own px on a mode
   * switch, produce zero animations). The height the last commit left PAINTED is carried in a ref.
   */
  it('animates the real height property, from the height it had to the one it wants', () => {
    const stub = withStubs(300);
    try {
      const { rerender } = render(
        <PanelShell view={makeView()} connected now={0} {...VERBS} />,
        { wrapper: Moving },
      );
      expect(stub.calls, 'the first measurement never animates').toEqual([]);

      stub.grow(460);
      rerender(<PanelShell view={gated} connected now={0} {...VERBS} />);

      expect(stub.calls).toHaveLength(1);
      const call = stub.calls[0]!;
      expect(call.frames.map((f) => f.height)).toEqual(['300px', '460px']);
      expect(call.options.duration).toBe(seconds('panel.height') * 1000);
      expect(call.options.easing).toBe(easingCss('panel.height'));
    } finally {
      stub.restore();
    }
  });

  /** A commit that leaves the box where it was is not a height change, whatever else moved in it. */
  it('runs nothing where the height did not move', () => {
    const stub = withStubs(300);
    try {
      const { rerender } = render(
        <PanelShell view={makeView()} connected now={0} {...VERBS} />,
        { wrapper: Moving },
      );
      rerender(<PanelShell view={gated} connected now={0} {...VERBS} />);
      expect(stub.calls).toEqual([]);
    } finally {
      stub.restore();
    }
  });

  /** THE CAP IS PART OF THE SHAPE. The largest height change the app makes is a MODE SWITCH, which
   *  moves the room the frame has for the panel and nothing inside it (measured: 367 to 159 own px).
   *  A shape key that did not carry the cap could not see it. */
  it('sees a change of cap, with the record standing still', () => {
    const stub = withStubs(367);
    try {
      const { rerender } = render(
        <PanelShell view={makeView()} connected now={0} maxHeight="calc(100vh - 300px)" {...VERBS} />,
        { wrapper: Moving },
      );
      stub.grow(159);
      rerender(<PanelShell view={makeView()} connected now={0} maxHeight="calc(100vh - 500px)" {...VERBS} />);
      expect(stub.calls.map((c) => c.frames.map((f) => f.height))).toEqual([['367px', '159px']]);
    } finally {
      stub.restore();
    }
  });

  /**
   * A CHANGE OF ROOM RE-BASELINES RATHER THAN TWEENS. The cap is a css expression against the window,
   * so a resize repaints the panel at a new height with no React commit behind it and nothing here to
   * hear — the remembered height went stale by the resize's own delta, and the NEXT shape change then
   * animated from it: measured in the live app, a 63px jump on a mode change whose real height delta
   * was zero, and a 12px one after a 1280x800 -> 1100x700 resize.
   */
  it('re-baselines on a change of room, and tweens nothing for the resize itself', () => {
    const stub = withStubs(367);
    const wasHeight = window.innerHeight;
    try {
      const { rerender } = render(
        <PanelShell view={makeView()} connected now={0} {...VERBS} />,
        { wrapper: Moving },
      );
      // The window grows and the cap with it: the panel is painted taller, unasked.
      stub.grow(430);
      act(() => {
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1100 });
        window.dispatchEvent(new Event('resize'));
      });
      expect(stub.calls, 'a resize is the box tracking the window, not a shape change').toEqual([]);

      // A shape change that moves the box not at all must now move nothing.
      rerender(<PanelShell view={gated} connected now={0} {...VERBS} />);
      expect(stub.calls, 'the remembered height is the one on screen').toEqual([]);

      // And a real one starts from where the panel actually is.
      stub.grow(245);
      rerender(<PanelShell view={makeView()} connected now={0} {...VERBS} />);
      expect(stub.calls.map((c) => c.frames.map((f) => f.height))).toEqual([['430px', '245px']]);
    } finally {
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: wasHeight });
      stub.restore();
    }
  });

  /** A resize IS the carrier here (the panel now holds a different amount of standing content), and a
   *  jump cut says it just as well — so reduced motion cuts straight to the new height. */
  it('runs nothing under reduced motion', () => {
    const stub = withStubs(300);
    try {
      const { rerender } = renderWithI18n(<PanelShell view={makeView()} connected now={0} {...VERBS} />);
      stub.grow(460);
      rerender(<PanelShell view={gated} connected now={0} {...VERBS} />);
      expect(stub.calls).toEqual([]);
    } finally {
      stub.restore();
    }
  });
});

/**
 * PanelShell: the phase-derived ticket facts, pinned per state.
 *
 * `HELD`/`ON_HOLD` and the `streaming`/`thinking` derivations feed `JobTicket` straight off
 * `view.phase`/`view.current.saysStreaming` with no consumer of their own in this suite otherwise —
 * `HELD` emptied, `ON_HOLD` emptied, or `streaming`/`thinking` hard-coded false would all leave
 * every other test in this file green. `panel-column.test.tsx` pins its `lane` fold for the
 * same reason: a derivation with no test at its own seam is wiring nobody is holding.
 */
describe('PanelShell: the phase-derived ticket facts', () => {
  const ALL_PHASES: SessionPhase[] = [
    'idle', 'thinking', 'streaming', 'executing', 'gated', 'retrying',
    'pausing', 'paused', 'aborted', 'incident',
  ];

  /** The phases where nothing is moving, so the tape freezes where it stands (`PanelShell`'s
   *  `HELD`). `pausing` is included: the pause has not landed, but the ticket is not progressing
   *  either. */
  const HELD_PHASES: ReadonlySet<SessionPhase> = new Set(['gated', 'retrying', 'pausing', 'paused']);

  /** The one phase whose ticket carries the hold's own mark and the two verbs that end it
   *  (`PanelShell`'s `ON_HOLD`). `pausing` is excluded: the pause has not landed, so there is
   *  nothing yet to resume from. */
  const ON_HOLD_PHASES: ReadonlySet<SessionPhase> = new Set(['paused']);

  it('freezes the tape\'s fill exactly on the phases where nothing is moving', () => {
    for (const phase of ALL_PHASES) {
      const { getByTestId, unmount } = renderWithI18n(
        <PanelShell view={makeView({ phase, current: makeJob() })} connected now={0} {...VERBS} />,
      );
      const fill = getByTestId('tape-bar').querySelector('span') as HTMLElement;
      expect(fill.style.opacity, `phase ${phase}`).toBe(HELD_PHASES.has(phase) ? '0.45' : '');
      unmount();
    }
  });

  it('carries the pausemark and the hold\'s two verbs on exactly one phase', () => {
    for (const phase of ALL_PHASES) {
      const { queryByTestId, unmount } = renderWithI18n(
        <PanelShell view={makeView({ phase, current: makeJob() })} connected now={0} {...VERBS} />,
      );
      const onHold = ON_HOLD_PHASES.has(phase);
      expect(!!queryByTestId('pausemark'), `pausemark @ ${phase}`).toBe(onHold);
      expect(!!queryByTestId('ticket-actions'), `ticket-actions @ ${phase}`).toBe(onHold);
      unmount();
    }
  });

  it('carries the caret only while the says line is still arriving', () => {
    const arriving = renderWithI18n(
      <PanelShell
        view={makeView({ phase: 'streaming', current: makeJob({ says: 'raising the wall', saysStreaming: true }) })}
        connected now={0} {...VERBS}
      />,
    );
    expect(arriving.getByTestId('says-caret')).toBeTruthy();
    arriving.unmount();

    const landed = renderWithI18n(
      <PanelShell
        view={makeView({ phase: 'streaming', current: makeJob({ says: 'raising the wall' }) })}
        connected now={0} {...VERBS}
      />,
    );
    expect(landed.queryByTestId('says-caret')).toBeNull();
  });

  it('shows the progress bar without a spare loading row before words arrive', () => {
    const thinking = renderWithI18n(
      <PanelShell view={makeView({ phase: 'thinking', current: makeJob() })} connected now={0} {...VERBS} />,
    );
    expect(thinking.getByTestId('tape-bar')).toBeTruthy();
    expect(thinking.queryByTestId('says-dots')).toBeNull();
    expect(thinking.queryByTestId('says')).toBeNull();
    thinking.unmount();

    // Off `thinking` with nothing said yet, the says line has nothing to show at all.
    const executing = renderWithI18n(
      <PanelShell view={makeView({ phase: 'executing', current: makeJob() })} connected now={0} {...VERBS} />,
    );
    expect(executing.queryByTestId('says')).toBeNull();
  });
});

describe('the caveat under the composer', () => {
  it('stands while the assistant waits for an order and leaves with the composer', () => {
    const props = { view: makeView(), connected: true, now: 0, ...VERBS };
    const ui = renderWithI18n(<PanelShell {...props} />);
    expect(ui.getByTestId('agent-caveat').textContent).toBe(translations.en['agent3.caveat']);
    ui.rerender(<PanelShell {...props} connected={false} />);
    expect(ui.queryByTestId('composer')).toBeNull();
    expect(ui.queryByTestId('agent-caveat')).toBeNull();
  });
});
