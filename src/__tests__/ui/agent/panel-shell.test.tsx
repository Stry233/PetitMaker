// @vitest-environment jsdom
/**
 * PanelShell's composition: which zones stand, what fills the job zone per phase, which verb each
 * control calls, and the four top-level groups the layout rests on. Rendered under reduced motion
 * so the character and the tape mount without the Web Animations API.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useState } from 'react';
import { render, fireEvent, act, waitFor } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { I18nProvider } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { translations } from '../../_support/locale-tables';
import { PanelShell, JOB_ZONE_FLOOR, knobCarry, PANEL_RADIUS, PINNED_HEIGHT, plateVariants } from '../../../ui/agent/PanelShell';
import { PANEL_MIN_HEIGHT, PANEL_PAD, PANEL_WIDTH } from '../../../ui/agent/panel-skin';
import { PIN_KNOB, PIN_KNOB_OUT } from '../../../ui/agent/parts/IconButton';
import { STATUS_CARD_HEIGHT } from '../../../ui/agent/desk/StatusCard';
import { DREAMS } from '../../../ui/agent/desk/DreamOffice';
import { DOCK_CHROME_FILE_H, DOCK_CHROME_W } from '../../../ui/shell/panel-frame';
import { easingCss, seconds } from '../../../ui/design/motion';
import { useAgentConnection } from '../../../agent/connection/store';
import { PROVIDER_IDS, type ProviderId } from '../../../agent/providers/defaults';
import { POSES } from '../../../ui/agent/character/poses';
import { Character } from '../../../ui/agent/character/Character';
import { onCharacterCue } from '../../../ui/agent/character/intent';
import type { JobView, SessionPhase } from '../../../agent/core/project-view';
import type { Locale } from '../../../core/model/locale';
import { makeJob, makeView, panelProps, renderWithI18n } from '../../_support/agent-panel';

const backing = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
};

beforeEach(() => {
  backing.clear();
  useEditorStore.setState({ locale: 'en' });
  useAgentConnection.setState({
    provider: 'claude',
    model: Object.fromEntries(PROVIDER_IDS.map((id) => [id, ''])) as Record<ProviderId, string>,
    oversight: 'checkpoint', customBaseUrl: '', keyed: [], hydrated: true,
  });
});

const VERBS = {
  onSend: () => {},
  onStop: () => {},
  onPause: () => {},
  onGateAnswer: () => {},
};

/** The panel's laid-out children, leaving out the `display: none` icon sprite. */
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
        <PanelShell {...panelProps({
          view: makeView({
            phase,
            current: phase === 'idle' || phase === 'aborted' || phase === 'incident' ? undefined : makeJob(),
            ...(phase === 'gated' ? { gate: { gateId: 'g1', scope: 'tool' as const, summary: 'paint a hill' } } : {}),
            ...(phase === 'retrying' ? { retry: { attempt: 2, cls: 'rate-limit' as const, delayMs: 9000, since: 0 } } : {}),
          }),
          connected: true,
          now: 0,
          ...VERBS,
        })}
        />,
      );
      const panel = getByTestId('panel-shell');
      expect(zones(panel).length, `phase ${phase}`).toBe(4);
      unmount();
    }
  });

  /** A screen owns the composer's zone too: its own action row stands at the foot instead. */
  it('stands three while the keyless rest owns the zone, its own verb at the foot', () => {
    const { getByTestId } = renderWithI18n(
      <PanelShell {...panelProps({ view: makeView(), connected: false, now: 0, ...VERBS })} />,
    );
    expect(zones(getByTestId('panel-shell')).length).toBe(3);
    expect(getByTestId('panel-job-zone').contains(getByTestId('dream-office'))).toBe(true);
    expect(getByTestId('desk-header')).toBeTruthy();
    expect(getByTestId('panel-job-zone').contains(getByTestId('dream-connect'))).toBe(true);
  });

  it('keeps the steer zone standing whether or not a note is queued', () => {
    const empty = renderWithI18n(<PanelShell {...panelProps({ view: makeView(), connected: true, now: 0, ...VERBS })} />);
    expect(empty.getByTestId('panel-steer-zone')).toBeTruthy();
    expect(empty.queryByTestId('panel-steer-chip')).toBeNull();
    empty.unmount();

    const queued = renderWithI18n(
      <PanelShell {...panelProps({
        view: makeView({ phase: 'thinking', current: makeJob(), queuedSteers: [{ seq: 4, text: 'use stone' }] }),
        connected: true,
        now: 0,
        ...VERBS,
      })}
      />,
    );
    expect(queued.getByTestId('panel-steer-chip').textContent).toContain('use stone');
    expect(queued.getByTestId('panel-steer-chip').textContent)
      .toContain(translations.en['agent.steer_at_next_step']);
  });

  /** The column builds the `LaneView` and `Lane` draws it (each pinned in its own suite); this pins
   *  the panel passing it down through the ticket. */
  it('carries a live helper lane through to the visible panel', () => {
    const { getByTestId } = renderWithI18n(
      <PanelShell {...panelProps({
        view: makeView({
          phase: 'executing',
          current: makeJob({
            ops: [{
              callId: 'd1', name: 'delegate_task', status: 'run', summary: 'planting the grove',
              isRead: false,
            }],
          }),
        }),
        connected: true,
        now: 0,
        ...VERBS,
        lane: { task: 'planting the grove', ops: 4, opName: 'plant_forest' },
      })}
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
      <PanelShell {...panelProps({ view: makeView(), connected: false, now: 0, ...VERBS })} />,
    );
    expect(getByTestId('dream-office')).toBeTruthy();
    expect(queryByTestId('setup-screen'), 'the form is not put up unasked').toBeNull();
    expect(queryByTestId('job-ticket')).toBeNull();
    // No message box: with nowhere to send, the screen's own verb is the bottom of the panel.
    expect(queryByTestId('composer')).toBeNull();
    expect(getByTestId('dream-connect')).toBeTruthy();
  });

  /**
   * `dream-connect` is the only way into setup, and at 1280x800 the office (385 to 462 px by locale)
   * outgrows the 186 px zone. jsdom lays nothing out, so the structure is asserted: the board scrolls,
   * the verb stands outside the scroller at the office's foot.
   */
  it('keeps Connect out of the scrolling part of the keyless rest', () => {
    const { getByTestId } = renderWithI18n(
      <PanelShell {...panelProps({ view: makeView(), connected: false, now: 0, ...VERBS })} />,
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
        <PanelShell {...panelProps({ view: makeView(), connected: false, now: 0, ...VERBS })} />
      </>,
    );
    const cues: string[] = [];
    const off = onCharacterCue((cue) => cues.push(cue.kind));
    fireEvent.click(getByTestId('dream-connect'));
    off();
    expect(cues).toEqual(['acknowledge', 'wake']);
    expect(getByTestId('setup-screen')).toBeTruthy();
    unmount();
  });

  it('walks into setup on Connect, and back out to the rest when the form leaves', () => {
    const onCollapse = vi.fn();
    const { getByTestId, queryByTestId } = renderWithI18n(
      <PanelShell {...panelProps({ view: makeView(), connected: false, now: 0, ...VERBS, onCollapse })} />,
    );
    fireEvent.click(getByTestId('dream-connect'));
    expect(getByTestId('setup-screen')).toBeTruthy();
    expect(queryByTestId('dream-office')).toBeNull();

    // Back returns to the rest and no further; putting the panel away is the character's press.
    fireEvent.click(getByTestId('setup-leave'));
    expect(getByTestId('dream-office')).toBeTruthy();
    expect(onCollapse).not.toHaveBeenCalled();
  });

  /**
   * `connected` turns true at the first of setup's three steps (the key is filed once the provider is
   * known), so a zone keyed on `connected` alone would drop the screen mid-flow, before a model is
   * chosen. The screen stands until `onDone`.
   */
  it('keeps the setup screen standing after the key is filed, until it says it is done', () => {
    const view = makeView();
    const { getByTestId, queryByTestId, rerender } = renderWithI18n(
      <PanelShell {...panelProps({ view, connected: false, now: 0, ...VERBS })} />,
    );
    fireEvent.click(getByTestId('dream-connect'));
    expect(getByTestId('setup-screen')).toBeTruthy();
    expect(queryByTestId('history-strip')).toBeNull();

    // RTL re-applies the wrapper on rerender, so the bare element keeps `PanelShell` mounted.
    rerender(<PanelShell {...panelProps({ view, connected: true, now: 0, ...VERBS })} />);
    expect(getByTestId('setup-screen'), 'the key is filed, setup is not finished').toBeTruthy();
    // The gear's surface is already showing, so the card offers no gear.
    expect(queryByTestId('dock-gear')).toBeNull();
  });

  /**
   * A refused key is filed and then dropped, so `connected` goes true then false in one gesture; the
   * form stays to show the refusal rather than folding back to the rest.
   */
  it('keeps the form standing when the key it just filed is refused', () => {
    const view = makeView();
    const { getByTestId, queryByTestId, rerender } = renderWithI18n(
      <PanelShell {...panelProps({ view, connected: false, now: 0, ...VERBS })} />,
    );
    fireEvent.click(getByTestId('dream-connect'));
    rerender(<PanelShell {...panelProps({ view, connected: true, now: 0, ...VERBS })} />);
    rerender(<PanelShell {...panelProps({ view, connected: false, now: 0, ...VERBS })} />);
    expect(getByTestId('setup-screen'), 'the refusal has a face and this is where it stands').toBeTruthy();
    expect(queryByTestId('dream-office')).toBeNull();
  });

  /** The panel carries the setup screen's step report up to the desk's status card. */
  it('carries the setup screen\'s step up to the status card', () => {
    const { getByTestId } = renderWithI18n(
      <PanelShell {...panelProps({ view: makeView(), connected: false, now: 0, ...VERBS })} />,
    );
    expect(getByTestId('dock-sentence').textContent).toBe(translations.en['agent.dock_disconnected']);
    fireEvent.click(getByTestId('dream-connect'));
    expect(getByTestId('dock-sentence').textContent).toBe(translations.en['agent.dock_setup_awake']);

    fireEvent.change(getByTestId('setup-key-input'), { target: { value: 'sk-ant-api03-abcdefghijkl' } });
    expect(getByTestId('dock-sentence').textContent).toBe(translations.en['agent.dock_setup_reading']);
    expect(getByTestId('dock-glyph').getAttribute('data-icon')).toBe('pw-key');
    expect(getByTestId('dock').getAttribute('data-paper')).toBe('work');

    // An emptied field is the asking step again.
    fireEvent.change(getByTestId('setup-key-input'), { target: { value: '' } });
    expect(getByTestId('dock-sentence').textContent).toBe(translations.en['agent.dock_setup_awake']);
  });

  it('puts the keyless rest back the moment the key goes away', () => {
    const view = makeView();
    const { getByTestId, queryByTestId, rerender } = renderWithI18n(
      <PanelShell {...panelProps({ view, connected: true, now: 0, ...VERBS })} />,
    );
    expect(queryByTestId('dream-office')).toBeNull();
    rerender(<PanelShell {...panelProps({ view, connected: false, now: 0, ...VERBS })} />);
    expect(getByTestId('dream-office')).toBeTruthy();
    expect(queryByTestId('setup-screen')).toBeNull();
  });

  /** On a keyless panel there is no key for the caller to drop, so the panel focuses the field itself. */
  it('answers the keyless key act with the setup field rather than passing it on', () => {
    const acts: string[] = [];
    const { getByTestId } = renderWithI18n(
      <PanelShell {...panelProps({
        view: makeView({ phase: 'incident', jobs: [makeJob({ outcome: 'incident', errorCls: 'quota' })] }),
        connected: false,
        now: 0,
        ...VERBS,
        onRepair: (a) => acts.push(a),
      })}
      />,
    );
    fireEvent.click(getByTestId('dock-act'));
    expect(acts, 'nothing travels to the caller').toEqual([]);
    expect(document.activeElement).toBe(getByTestId('setup-key-input'));
  });

  /** The caller's key drop is what mounts the field, so focus must wait for the commit that brings it. */
  it('reaches the key field on ONE press when the act has to drop a key first', () => {
    function DropsOnAct() {
      const [connected, setConnected] = useState(true);
      return (
        <PanelShell {...panelProps({
          view: makeView({ phase: 'incident', jobs: [makeJob({ outcome: 'incident', errorCls: 'auth' })] }),
          connected,
          now: 0,
          ...VERBS,
          onRepair: (a) => { if (a === 'fix-key') setConnected(false); },
        })}
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
    // A complete connection, so Done has nothing owed and opens the session again.
    useAgentConnection.getState().connectKey('claude', 'sk-ant-api03-abcdefghijkl');
    useAgentConnection.getState().setModel('claude-opus-4-1');
    // Filed, so the record is the past-jobs strip.
    const view = makeView({ jobs: [makeJob({ outcome: 'done' })] });
    const filed = new Set([1]);
    const { getByTestId, queryByTestId } = renderWithI18n(
      <PanelShell {...panelProps({ view, connected: true, now: 0, filed, ...VERBS })} />,
    );
    expect(queryByTestId('manage-screen')).toBeNull();
    expect(getByTestId('history-strip')).toBeTruthy();

    fireEvent.click(getByTestId('dock-gear'));
    expect(getByTestId('manage-screen')).toBeTruthy();
    expect(queryByTestId('history-strip'), 'the record gives the zone up').toBeNull();
    expect(getByTestId('dock-sentence').textContent).toBe(translations.en['agent.dock_connection']);

    fireEvent.click(getByTestId('manage-done'));
    expect(queryByTestId('manage-screen')).toBeNull();
    expect(getByTestId('history-strip')).toBeTruthy();
  });

  /** The manage card edits the connection itself, provider and model possibly mid-change, so no
   *  field below it invites an order. */
  it('draws no composer behind the manage card, and hands the field back on Done', () => {
    // A complete connection, so Done has nothing owed and opens the session again.
    useAgentConnection.getState().connectKey('claude', 'sk-ant-api03-abcdefghijkl');
    useAgentConnection.getState().setModel('claude-opus-4-1');
    const view = makeView({ jobs: [makeJob({ outcome: 'done' })] });
    const filed = new Set([1]);
    const { getByTestId, queryByTestId } = renderWithI18n(
      <PanelShell {...panelProps({ view, connected: true, initialZone: { kind: 'manage' }, now: 0, filed, ...VERBS })} />,
    );
    expect(queryByTestId('composer')).toBeNull();
    expect(getByTestId('manage-done')).toBeTruthy();

    fireEvent.click(getByTestId('manage-done'));
    const input = getByTestId('composer-input') as HTMLInputElement;
    expect(input.disabled).toBe(false);
    expect(input.placeholder).toBe(translations.en['agent.composer_order']);
  });

  /** Every step of the connection screen has its own verb, and none is an order. */
  it('draws no composer on the connection screen either', () => {
    const { getByTestId, queryByTestId } = renderWithI18n(
      <PanelShell {...panelProps({ view: makeView(), connected: false, now: 0, onCollapse: () => {}, ...VERBS })} />,
    );
    fireEvent.click(getByTestId('dream-connect'));
    expect(getByTestId('setup-screen')).toBeTruthy();
    expect(queryByTestId('composer')).toBeNull();
    expect(getByTestId('setup-leave')).toBeTruthy();
  });

  /** Clearing marks a record rather than removing it (`store.clearRecord`), so the count leaves out
   *  cleared records rather than reading `view.jobs`. */
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
      <PanelShell {...panelProps({ view, connected: true, initialZone: { kind: 'manage' }, now: 0, filed, ...VERBS, onClearJobs: () => {} })} />,
    );
    expect(getByTestId('manage-clear-jobs').textContent)
      .toBe(translations.en['agent.setup_manage_clear_jobs']!.replace('{n}', '3'));

    rerender(
      <PanelShell {...panelProps({
        view, connected: true, initialZone: { kind: 'manage' }, now: 0, filed, cleared: new Set([1, 2]),
        ...VERBS, onClearJobs: () => {},
      })}
      />,
    );
    expect(getByTestId('manage-clear-jobs').textContent)
      .toBe(translations.en['agent.setup_manage_clear_jobs']!.replace('{n}', '1'));

    rerender(
      <PanelShell {...panelProps({
        view, connected: true, initialZone: { kind: 'manage' }, now: 0, filed, cleared: new Set([1, 2, 3]),
        ...VERBS, onClearJobs: () => {},
      })}
      />,
    );
    expect((getByTestId('manage-clear-jobs') as HTMLButtonElement).disabled).toBe(true);
  });

  /** A filed record is news put away, so the desk reads its rest. The panel works this out, so the
   *  wiring is pinned here and not on the dock alone. */
  it('rests the status card once the settled record is filed, and keeps a capped one\'s reading', () => {
    const done = makeView({ jobs: [makeJob({ outcome: 'done', kind: 'build' })] });
    const filedDone = renderWithI18n(
      <PanelShell {...panelProps({ view: done, connected: true, now: 0, filed: new Set([1]), mapName: "Hexia", ...VERBS })} />,
    );
    expect(filedDone.getByTestId('dock-sentence').textContent).toBe(translations.en['agent.dock_idle']);
    filedDone.unmount();

    const capped = makeView({
      jobs: [makeJob({
        outcome: 'capped',
        plan: { stages: [{ label: 'a' }, { label: 'b' }], currentIndex: 1, doneCount: 1, revision: 1 },
      })],
    });
    const filedCapped = renderWithI18n(
      <PanelShell {...panelProps({ view: capped, connected: true, now: 0, filed: new Set([1]), ...VERBS })} />,
    );
    expect(filedCapped.getByTestId('dock-sentence').textContent)
      .toBe(translations.en['agent.dock_capped']);
  });

  it('shows the running job as a live ticket, and no setup', () => {
    const { getByTestId, queryByTestId } = renderWithI18n(
      <PanelShell {...panelProps({
        view: makeView({ phase: 'executing', current: makeJob({ orderText: 'pave the square' }) }),
        connected: true,
        now: 0,
        ...VERBS,
      })}
      />,
    );
    expect(queryByTestId('setup-screen')).toBeNull();
    expect(getByTestId('ticket-order').textContent).toBe('pave the square');
    expect(getByTestId('tape-bar')).toBeTruthy();
  });

  // The card draws from the job's ask record, so it survives the answer; `view.gate` is the open half.
  it('shows the open gate, and answers it by gateId', () => {
    const answers: [string, string][] = [];
    const { getAllByTestId } = renderWithI18n(
      <PanelShell {...panelProps({
        view: makeView({
          phase: 'gated',
          current: makeJob({ asks: [{ gateId: 'g7', scope: 'tool', summary: 'paint a hill' }] }),
          gate: { gateId: 'g7', scope: 'tool', summary: 'paint a hill' },
        }),
        connected: true,
        now: 0,
        ...VERBS,
        onGateAnswer: (id, a) => answers.push([id, a]),
      })}
      />,
    );
    fireEvent.click(getAllByTestId('gate-approve')[0]!);
    expect(answers).toEqual([['g7', 'allow']]);
  });

  it("captions an incident from the settled job's own class, not from the outcome alone", () => {
    const { getByText } = renderWithI18n(
      <PanelShell {...panelProps({
        view: makeView({
          phase: 'incident',
          jobs: [makeJob({ outcome: 'incident', errorCls: 'auth' })],
        }),
        connected: true,
        now: 0,
        ...VERBS,
      })}
      />,
    );
    expect(getByText(translations.en['agent.banner_auth']!)).toBeTruthy();
  });

  it('falls back to the generic notice for an incident that named no class', () => {
    const { getByText } = renderWithI18n(
      <PanelShell {...panelProps({
        view: makeView({ phase: 'incident', jobs: [makeJob({ outcome: 'incident' })] }),
        connected: true,
        now: 0,
        ...VERBS,
      })}
      />,
    );
    expect(getByText(translations.en['agent.banner_incident']!)).toBeTruthy();
  });

  /** The notice demotes rather than leaving, and the caller still hears of it. */
  it('takes a dismissal itself and still reports it', () => {
    const acted: string[] = [];
    const { getAllByTestId, getByTestId } = renderWithI18n(
      <PanelShell {...panelProps({
        view: makeView({ phase: 'incident', jobs: [makeJob({ outcome: 'incident', errorCls: 'unknown' })] }),
        connected: true,
        now: 0,
        ...VERBS,
        onRepair: (a) => acted.push(a),
      })}
      />,
    );
    const dismiss = getAllByTestId('banner-action').find((el) => el.getAttribute('data-action') === 'dismiss')!;
    fireEvent.click(dismiss);
    expect(acted).toEqual(['dismiss']);
    // Quieter, not gone: the fault still holds, and a vanishing notice would shift the record under the
    // pointer (`trouble.test.tsx` holds the styling).
    expect(getByTestId('banner').getAttribute('data-standing')).toBe('true');
  });

  /** `session/store.ts:storageNotice` reports a save pruned, lost or read back corrupt (its own tests
   *  drive all three through a real quota failure); the panel banners each. */
  it('banners each of the three storage readings, and tells them apart', () => {
    const said: string[] = [];
    for (const [notice, key] of [
      ['pruned', 'agent.banner_storage_pruned'],
      ['lost', 'agent.banner_storage_full'],
      ['corrupt', 'agent.banner_storage_corrupt'],
    ] as const) {
      const { getByTestId, unmount } = renderWithI18n(
        <PanelShell {...panelProps({ view: makeView(), connected: true, now: 0, ...VERBS, storageNotice: notice })} />,
      );
      said.push(getByTestId('banner').textContent ?? '');
      expect(said[said.length - 1], notice).toContain(translations.en[key]!);
      unmount();
    }
    expect(new Set(said).size).toBe(3);
  });

  /**
   * A `lost` or `pruned` dismissal demotes locally like the incident banner's; the store clears the
   * fact on the next clean save. `corrupt`'s Discard drops the set-aside bytes, so it goes to the caller.
   */
  it('hands the corrupt notice\'s discard back to the caller, and demotes lost/pruned locally instead', () => {
    let dismissed = 0;
    const lost = renderWithI18n(
      <PanelShell {...panelProps({
        view: makeView(),
        connected: true,
        now: 0,
        ...VERBS,
        storageNotice: "lost",
        onDismissStorage: () => { dismissed += 1; },
      })}
      />,
    );
    fireEvent.click(lost.getAllByTestId('banner-action').find((el) => el.getAttribute('data-action') === 'dismiss')!);
    expect(dismissed, 'a lost/pruned dismissal never reaches the caller').toBe(0);
    expect(lost.getByTestId('banner').getAttribute('data-standing')).toBe('true');
    lost.unmount();

    const corrupt = renderWithI18n(
      <PanelShell {...panelProps({
        view: makeView(), connected: true, now: 0, ...VERBS,
        storageNotice: "corrupt",
        onDismissStorage: () => { dismissed += 1; },
      })}
      />,
    );
    fireEvent.click(corrupt.getAllByTestId('banner-action').find((el) => el.getAttribute('data-action') === 'dismiss')!);
    expect(dismissed, 'the corrupt notice\'s Discard still does').toBe(1);
  });

  it('stands no storage banner where the session reports no trouble', () => {
    const { queryByTestId } = renderWithI18n(
      <PanelShell {...panelProps({ view: makeView(), connected: true, now: 0, ...VERBS, storageNotice: null })} />,
    );
    expect(queryByTestId('banner')).toBeNull();
  });

  /** A dismissal answers one incident, not its class. */
  it('shows the next incident of a class already dismissed', () => {
    const first = makeView({
      phase: 'incident',
      jobs: [makeJob({ orderSeq: 1, outcome: 'incident', errorCls: 'unknown' })],
    });
    const { getAllByTestId, getByTestId, rerender } = renderWithI18n(
      <PanelShell {...panelProps({ view: first, connected: true, now: 0, ...VERBS })} />,
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
    rerender(<PanelShell {...panelProps({ view: second, connected: true, now: 0, ...VERBS })} />);
    expect(getByTestId('banner').getAttribute('data-standing')).toBeNull();
  });

  it('shows the settled jobs as the history strip, and nothing when there are none', () => {
    const none = renderWithI18n(<PanelShell {...panelProps({ view: makeView(), connected: true, now: 0, ...VERBS })} />);
    expect(none.queryByTestId('history-toggle')).toBeNull();
    none.unmount();

    const some = renderWithI18n(
      <PanelShell {...panelProps({
        view: makeView({ jobs: [makeJob({ outcome: 'done' }), makeJob({ orderSeq: 2, outcome: 'done' })] }),
        connected: true,
        now: 0,
        // Both filed; an unfiled newest record would stand as a card instead.
        filed: new Set([1, 2]),
        ...VERBS,
      })}
      />,
    );
    expect(some.getByTestId('history-toggle').textContent).toContain('2');
  });

  it('invites the answer in the composer while a settled question stands', () => {
    const asked = makeView({ jobs: [makeJob({ outcome: 'done', question: true })] });
    const { getByTestId, rerender } = renderWithI18n(
      <PanelShell {...panelProps({ view: asked, connected: true, now: 0, ...VERBS })} />,
    );
    const field = () => getByTestId('composer').querySelector('textarea') as HTMLTextAreaElement;
    expect(field().placeholder).toBe(translations.en['agent.composer_answer_short']);

    rerender(<PanelShell {...panelProps({ view: makeView({ jobs: [makeJob({ outcome: 'done' })] }), connected: true, now: 0, ...VERBS })} />);
    expect(field().placeholder).toBe(translations.en['agent.composer_order']);
  });
});

describe("PanelShell: the rolled-back reading is the shell's own", () => {
  const jobs = [
    makeJob({ orderSeq: 1, outcome: 'done', checkpoints: [{ undoIndex: 4, label: 'job' }] }),
    makeJob({ orderSeq: 2, outcome: 'done', checkpoints: [{ undoIndex: 9, label: 'job' }] }),
  ];

  function rolledLabels(undoDepth?: number) {
    const view = renderWithI18n(
      <PanelShell {...panelProps({
        view: makeView({ jobs }),
        connected: true,
        now: 0,
        // Both filed, so both are strip rows.
        filed: new Set([1, 2]),
        ...(undoDepth !== undefined ? { undoDepth } : {}),
        ...VERBS,
      })}
      />,
    );
    fireEvent.click(view.getByTestId('history-toggle'));
    const rows = view.getAllByTestId('history-item');
    const flags = rows.map((r) => r.textContent?.includes(translations.en['agent.history_rolled_back']!) ?? false);
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
 * The terminal card's three shapes carry `key={settled.job.orderSeq}`; without it React reuses one
 * instance across settled jobs, and a local confirm opened on job 1 would stand over job 2. Nothing
 * else in this suite notices the keys' removal.
 */
describe('PanelShell: the terminal card is keyed by its own record', () => {
  it('does not leave a standing rewind-all confirm over the next settled job', async () => {
    const job1 = makeJob({ orderSeq: 1, outcome: 'done', checkpoints: [{ undoIndex: 0, label: 'job' }] });
    const job2 = makeJob({ orderSeq: 2, outcome: 'done', checkpoints: [{ undoIndex: 0, label: 'job' }] });
    const { getByTestId, rerender } = renderWithI18n(
      <PanelShell {...panelProps({ view: makeView({ jobs: [job1] }), connected: true, now: 0, ...VERBS, onRewind: () => {}, onRewindAll: () => {} })} />,
    );
    fireEvent.click(getByTestId('flip-button'));
    fireEvent.click(getByTestId('ticket-rewind-all'));
    const armed = () => [...document.querySelectorAll('[data-testid="ticket-rewind-all-ask"]')];
    expect(armed()).toHaveLength(1);

    // Job 1 files itself away and job 2 takes its place as the standing record.
    rerender(
      <PanelShell {...panelProps({
        view: makeView({ jobs: [job1, job2] }),
        connected: true,
        now: 0,
        filed: new Set([1]),
        ...VERBS,
        onRewind: () => {},
        onRewindAll: () => {},
      })}
      />,
    );
    await waitFor(() => expect(armed()).toHaveLength(0));
  });
});

describe('PanelShell: leaving a question', () => {
  it.each(['answer', 'build'] as const)('files a closing question from a %s without sending an answer', (kind) => {
    const onSend = vi.fn();
    const onStop = vi.fn();
    const onFileAway = vi.fn();
    const job = makeJob({ kind, outcome: 'done', question: true, summary: 'Where should it go?' });
    const view = makeView({ jobs: [job] });
    const props = { view, connected: true, now: 0, ...VERBS, onSend, onStop, onFileAway };
    const ui = renderWithI18n(<PanelShell {...panelProps(props)} />);
    expect(ui.queryByTestId('question-cancel-task')).toBeNull();
    const fileAway = ui.getByRole('button', { name: translations.en['agent.action_file_away'] });
    expect(fileAway.closest('[data-testid="answer-paper"], [data-testid="flip-face-front"]')).not.toBeNull();
    fireEvent.click(fileAway);
    expect(onFileAway).toHaveBeenCalledWith(job.orderSeq);
    expect(onSend).not.toHaveBeenCalled();
    expect(onStop).not.toHaveBeenCalled();
    ui.rerender(<PanelShell {...panelProps({ ...props, filed: new Set([job.orderSeq]) })} />);
    expect(ui.queryByRole('button', { name: translations.en['agent.action_file_away'] })).toBeNull();
    expect(ui.queryByTestId('question-cancel-task')).toBeNull();
    expect(ui.getByTestId('dock-sentence').textContent).toBe(translations.en['agent.dock_idle']);
    expect((ui.getByTestId('composer-input') as HTMLTextAreaElement).placeholder).toBe(translations.en['agent.composer_order']);
  });

  it('offers cancellation beside a live question and uses the shared stop confirmation', () => {
    const onStop = vi.fn();
    const onGateAnswer = vi.fn();
    const ask = { gateId: 'ask-1', scope: 'tool' as const, summary: 'Where should it go?' };
    const view = makeView({ phase: 'gated', current: makeJob({ asks: [ask] }), gate: ask });
    const ui = renderWithI18n(<PanelShell {...panelProps({ view, connected: true, now: 0, ...VERBS, onStop, onGateAnswer })} />);
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
      <PanelShell {...panelProps({ view: makeView(), connected: true, now: 0, ...VERBS, onSend: (text) => sent.push(text) })} />,
    );
    const input = getByTestId('composer').querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'build a village' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(sent).toEqual(['build a village']);
  });

  /** One seat control per family (`DeskHeader`'s seat table): pause while running, stop at a gate,
   *  and the stop asks on the card first. */
  it('hands the status card its seat verbs', () => {
    const calls: string[] = [];
    const running = renderWithI18n(
      <PanelShell {...panelProps({
        view: makeView({ phase: 'executing', current: makeJob() }),
        connected: true,
        now: 0,
        ...VERBS,
        onPause: () => calls.push('pause'),
        onStop: () => calls.push('stop'),
      })}
      />,
    );
    fireEvent.click(running.getByTestId('dock-seat'));
    running.unmount();

    const asking = renderWithI18n(
      <PanelShell {...panelProps({
        view: makeView({
          phase: 'gated', current: makeJob(),
          gate: { gateId: 'g1', scope: 'tool', summary: '86 cells' },
        }),
        connected: true,
        now: 0,
        ...VERBS,
        onPause: () => calls.push('pause'),
        onStop: () => calls.push('stop'),
      })}
      />,
    );
    fireEvent.click(asking.getByTestId('dock-seat'));
    fireEvent.click(asking.getByTestId('dock-confirm-stop'));
    expect(calls).toEqual(['pause', 'stop']);
  });

  /** The composer's stop square raises the same confirmation as the dock's stop, in the same seat. */
  it('asks from the composer\'s square before it stops anything, leaving the desk card as it was', async () => {
    const calls: string[] = [];
    const view = makeView({ phase: 'executing', current: makeJob() });
    const { getByTestId, queryByTestId } = renderWithI18n(
      <PanelShell {...panelProps({ view, connected: true, now: 0, ...VERBS, onStop: () => calls.push('stop') })} />,
    );

    fireEvent.click(getByTestId('composer-stop'));
    expect(calls, 'nothing is stopped by the press that asks').toEqual([]);
    expect(getByTestId('dock-confirm-stop')).toBeTruthy();
    expect(getByTestId('dock-sentence').textContent, 'the card is not the question').toBe(translations.en['agent.dock_executing']);

    fireEvent.click(getByTestId('dock-confirm-cancel'));
    expect(calls).toEqual([]);
    await waitFor(() => expect(queryByTestId('dock-confirm-stop')).toBeNull());

    fireEvent.click(getByTestId('composer-stop'));
    fireEvent.click(getByTestId('dock-confirm-stop'));
    expect(calls).toEqual(['stop']);
  });

  it('unrolls the same question from the desk seat, and lets it lapse with the job it asked about', async () => {
    const calls: string[] = [];
    const running = makeView({ phase: 'gated', current: makeJob() });
    const { getByTestId, queryByTestId, rerender } = renderWithI18n(
      <PanelShell {...panelProps({ view: running, connected: true, now: 0, ...VERBS, onStop: () => calls.push('stop') })} />,
    );
    fireEvent.click(getByTestId('dock-seat'));
    expect(getByTestId('dock-confirm-stop')).toBeTruthy();
    expect(getByTestId('dock-seat').getAttribute('data-act'), 'the seat itself is unchanged').toBe('stop');

    rerender(<PanelShell {...panelProps({ view: makeView({ phase: 'idle', jobs: [makeJob({ outcome: 'done' })] }), connected: true, now: 0, ...VERBS, onStop: () => calls.push('stop') })} />);
    await waitFor(() => expect(queryByTestId('dock-confirm-stop')).toBeNull());
    const later = makeView({ phase: 'gated', current: makeJob({ orderSeq: 2 }) });
    rerender(<PanelShell {...panelProps({ view: later, connected: true, now: 0, ...VERBS, onStop: () => calls.push('stop') })} />);
    expect(queryByTestId('dock-confirm-stop'), 'a later job never inherits the question').toBeNull();
    expect(calls).toEqual([]);
  });

  it('offers a take-back only where the caller can honour one', () => {
    const view = makeView({ phase: 'thinking', current: makeJob(), queuedSteers: [{ seq: 4, text: 'use stone' }] });
    const without = renderWithI18n(<PanelShell {...panelProps({ view, connected: true, now: 0, ...VERBS })} />);
    expect(without.queryByTestId('panel-steer-recall')).toBeNull();
    without.unmount();

    const recalled: number[] = [];
    const withIt = renderWithI18n(
      <PanelShell {...panelProps({ view, connected: true, now: 0, ...VERBS, onRecallSteer: (s) => recalled.push(s) })} />,
    );
    fireEvent.click(withIt.getByTestId('panel-steer-recall'));
    expect(recalled).toEqual([4]);
  });

  it('feeds the composer suggestion from the projection, not from a store field', () => {
    const { getByTestId } = renderWithI18n(
      <PanelShell {...panelProps({ view: makeView({ suggestion: 'Yes, add the bridge' }), connected: true, now: 0, ...VERBS })} />,
    );
    expect(getByTestId('composer-ghost').textContent).toBe('Yes, add the bridge');
  });

  /** The ghost is a projection, so the panel records its refusal, as it does a banner's dismissal. */
  it('drops the suggestion ghost on Escape, and then sends nothing on an empty Enter', () => {
    const sent: string[] = [];
    const view = makeView({ suggestion: 'Add a bridge over the river' });
    const { getByTestId, queryByTestId } = renderWithI18n(
      <PanelShell {...panelProps({ view, connected: true, now: 0, ...VERBS, onSend: (text) => sent.push(text) })} />,
    );
    const input = getByTestId('composer-input');
    expect(queryByTestId('composer-ghost')).not.toBeNull();

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(queryByTestId('composer-ghost')).toBeNull();

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(sent).toEqual([]);
  });

  /** A fresh order nulls the projection, so a later suggestion is a live one again. */
  it('leaves the next suggestion standing', () => {
    const { getByTestId, queryByTestId, rerender } = renderWithI18n(
      <PanelShell {...panelProps({ view: makeView({ suggestion: 'first' }), connected: true, now: 0, ...VERBS })} />,
    );
    fireEvent.keyDown(getByTestId('composer-input'), { key: 'Escape' });
    expect(queryByTestId('composer-ghost')).toBeNull();

    rerender(<PanelShell {...panelProps({ view: makeView({ suggestion: 'second' }), connected: true, now: 0, ...VERBS })} />);
    expect(getByTestId('composer-ghost').textContent).toBe('second');
  });

  it('offers identical reply text again for a later order without replacing a typed draft', () => {
    const view = (seq: number) => makeView({ jobs: [makeJob({ orderSeq: seq, outcome: 'done', question: true })], suggestion: 'Yes, add flowers' });
    const ui = renderWithI18n(<PanelShell {...panelProps({ view: view(1), connected: true, now: 0, ...VERBS })} />);
    fireEvent.keyDown(ui.getByTestId('composer-input'), { key: 'Escape' });
    expect(ui.queryByTestId('composer-ghost')).toBeNull();
    ui.rerender(<PanelShell {...panelProps({ view: view(20), connected: true, now: 0, ...VERBS })} />);
    expect(ui.getByTestId('composer-ghost').textContent).toBe('Yes, add flowers');
    fireEvent.change(ui.getByTestId('composer-input'), { target: { value: 'Use blue flowers' } });
    ui.rerender(<PanelShell {...panelProps({ view: view(30), connected: true, now: 0, ...VERBS })} />);
    expect((ui.getByTestId('composer-input') as HTMLTextAreaElement).value).toBe('Use blue flowers');
    expect(ui.queryByTestId('composer-ghost')).toBeNull();
  });
});

/**
 * The dock's elapsed time and retry countdown derive from a render input, so the panel runs its own
 * ~1Hz clock while, and only while, a face is counting; a hold or a receipt reads a stamp instead.
 */
describe('PanelShell: the status-card clock', () => {
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
        <PanelShell {...panelProps({ view: retrying(0), connected: true, ...VERBS })} />,
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
      const idle = renderWithI18n(<PanelShell {...panelProps({ view: makeView(), connected: true, ...VERBS })} />);
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
      const { rerender } = renderWithI18n(<PanelShell {...panelProps({ view: retrying(0), connected: true, ...VERBS })} />);
      expect(vi.getTimerCount()).toBeGreaterThan(0);

      // The wait is over but the job's elapsed reading still moves.
      rerender(<PanelShell {...panelProps({ view: makeView({ phase: 'executing', current: makeJob() }), connected: true, ...VERBS })} />);
      expect(vi.getTimerCount()).toBeGreaterThan(0);

      rerender(<PanelShell {...panelProps({ view: makeView(), connected: true, ...VERBS })} />);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('an injected clock overrides its own, so a test reads an exact second', () => {
    vi.useFakeTimers();
    try {
      const { getByTestId } = renderWithI18n(
        <PanelShell {...panelProps({ view: retrying(0), connected: true, now: 4_000, ...VERBS })} />,
      );
      expect(getByTestId('retry-seconds').textContent).toBe('5');
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('PanelShell: the celebrate edge', () => {
  /** The hook reads the projection's `JobView.celebrate` (done, a write landed, no closing question),
   *  so fixtures carry the flag; the answer family's negatives are in `answer-paper.test.tsx`. */
  const settled = (seq: number, outcome: JobView['outcome'], celebrate = outcome === 'done') =>
    makeView({ jobs: [makeJob({ orderSeq: seq, outcome, celebrate, kind: 'build' })] });

  it('celebrates when a job finishes well, once, and settles back', () => {
    vi.useFakeTimers();
    try {
      const { getByTestId, rerender } = renderWithI18n(
        <PanelShell {...panelProps({ view: makeView({ phase: 'executing', current: makeJob() }), connected: true, now: 0, ...VERBS })} />,
      );
      const pose = () => getByTestId('desk-header-char-slot').firstElementChild?.getAttribute('data-pose');
      expect(pose()).not.toBe('celebrating');

      rerender(<PanelShell {...panelProps({ view: settled(1, 'done'), connected: true, now: 0, ...VERBS })} />);
      expect(pose()).toBe('celebrating');

      // A re-render of the same settled job is not a second finish.
      act(() => { vi.advanceTimersByTime(POSES.celebrating.settleAt ?? 0); });
      expect(pose()).not.toBe('celebrating');
      rerender(<PanelShell {...panelProps({ view: settled(1, 'done'), connected: true, now: 0, ...VERBS })} />);
      expect(pose()).not.toBe('celebrating');
    } finally {
      vi.useRealTimers();
    }
  });

  /** A bad settlement must lower the dance even though its own branch starts none. */
  it('stops the moment the next job settles badly, well inside the clock', () => {
    vi.useFakeTimers();
    try {
      const { getByTestId, rerender } = renderWithI18n(
        <PanelShell {...panelProps({ view: makeView({ phase: 'executing', current: makeJob() }), connected: true, now: 0, ...VERBS })} />,
      );
      const pose = () => getByTestId('desk-header-char-slot').firstElementChild?.getAttribute('data-pose');

      rerender(<PanelShell {...panelProps({ view: settled(1, 'done'), connected: true, now: 0, ...VERBS })} />);
      expect(pose()).toBe('celebrating');

      act(() => { vi.advanceTimersByTime(200); });
      rerender(
        <PanelShell {...panelProps({
          view: makeView({
            phase: 'incident',
            jobs: [
              makeJob({ orderSeq: 1, outcome: 'done', kind: 'build', celebrate: true }),
              makeJob({ orderSeq: 2, outcome: 'incident', errorCls: 'network' }),
            ],
          }),
          connected: true,
          now: 0,
          ...VERBS,
        })}
        />,
      );
      expect(pose()).not.toBe('celebrating');

      // It stays down through the rest of the first job's window.
      act(() => { vi.advanceTimersByTime(POSES.celebrating.settleAt ?? 0); });
      expect(pose()).not.toBe('celebrating');
    } finally {
      vi.useRealTimers();
    }
  });

  it('never celebrates on arrival at a session that was already finished', () => {
    const { getByTestId } = renderWithI18n(
      <PanelShell {...panelProps({ view: settled(7, 'done'), connected: true, now: 0, ...VERBS })} />,
    );
    expect(getByTestId('desk-header-char-slot').firstElementChild?.getAttribute('data-pose'))
      .not.toBe('celebrating');
  });

  it('does not celebrate a job that was stopped, capped or broken', () => {
    for (const outcome of ['aborted', 'capped', 'incident'] as const) {
      const { getByTestId, rerender, unmount } = renderWithI18n(
        <PanelShell {...panelProps({ view: makeView({ phase: 'executing', current: makeJob() }), connected: true, now: 0, ...VERBS })} />,
      );
      rerender(<PanelShell {...panelProps({ view: settled(1, outcome), connected: true, now: 0, ...VERBS })} />);
      expect(
        getByTestId('desk-header-char-slot').firstElementChild?.getAttribute('data-pose'),
        outcome,
      ).not.toBe('celebrating');
      unmount();
    }
  });
});

/**
 * The frame's room wins over the panel's wanted height. CSS resolves `min-height` against
 * `max-height` in the min's favour, so the floor is `min(want, cap)`.
 */
describe('PanelShell: how tall it stands', () => {
  it('takes its authored height when the caller names no cap', () => {
    const { getByTestId } = renderWithI18n(<PanelShell {...panelProps({ view: makeView(), connected: true, now: 0, ...VERBS })} />);
    const style = getByTestId('panel-shell').style;
    expect(style.minHeight).toBe(`${PANEL_MIN_HEIGHT}px`);
    expect(style.maxHeight).toBe('');
  });

  it('yields the wanted height to the cap, rather than overflowing it', () => {
    const cap = 'calc(100vh - 480px)';
    const { getByTestId } = renderWithI18n(
      <PanelShell {...panelProps({ view: makeView(), connected: true, now: 0, maxHeight: cap, ...VERBS })} />,
    );
    const style = getByTestId('panel-shell').style;
    expect(style.maxHeight).toBe(cap);
    expect(style.minHeight.replace(/\s+/g, '')).toBe(`min(${PANEL_MIN_HEIGHT}px,${cap})`.replace(/\s+/g, ''));
  });

  /** Connection screens supply their own height and remain bounded by the caller's cap. */
  it('hugs a connection screen instead of standing at the want', () => {
    const cap = 'calc(100vh - 480px)';
    const rest = renderWithI18n(
      <PanelShell {...panelProps({ view: makeView(), connected: false, now: 0, maxHeight: cap, ...VERBS })} />,
    );
    expect(rest.getByTestId('dream-office')).toBeTruthy();
    expect(rest.getByTestId('panel-shell').style.minHeight).toBe('0');
    expect(rest.getByTestId('panel-shell').style.maxHeight).toBe(cap);

    fireEvent.click(rest.getByTestId('dream-connect'));
    expect(rest.getByTestId('setup-screen')).toBeTruthy();
    expect(rest.getByTestId('panel-shell').style.minHeight).toBe('0');
    rest.unmount();

    // A desk with the record under it still wants its column.
    const record = renderWithI18n(
      <PanelShell {...panelProps({ view: makeView(), connected: true, now: 0, maxHeight: cap, ...VERBS })} />,
    );
    expect(record.getByTestId('panel-shell').style.minHeight.replace(/\s+/g, ''))
      .toBe(`min(${PANEL_MIN_HEIGHT}px,${cap})`.replace(/\s+/g, ''));
  });
});

/**
 * Desk pinned on top, composer pinned at the bottom, and only the job zone between them scrolls.
 * jsdom lays nothing out, so the flex and overflow declarations are asserted.
 */
describe('PanelShell: the three zones', () => {
  function zoneStyles(connected = true) {
    const view = renderWithI18n(
      <PanelShell {...panelProps({
        view: makeView({ phase: 'executing', current: makeJob() }),
        connected,
        now: 0,
        maxHeight: "calc(100vh - 480px)",
        ...VERBS,
      })}
      />,
    );
    const panel = view.getByTestId('panel-shell');
    return { view, panel, children: [...panel.children] as HTMLElement[] };
  }

  it('pins the desk and the composer, and scrolls the job zone alone', () => {
    const { view, panel, children } = zoneStyles();
    const laidOut = children.filter((el) => el.style.display !== 'none');

    for (const el of laidOut) {
      const isZone = el.dataset.testid === 'panel-job-frame';
      // The steer stack may shrink too, though only its chips box scrolls (`SteerQueue`'s suite).
      const mayShrink = el.dataset.testid === 'panel-steer-zone';
      expect(el.style.flex, el.dataset.testid ?? el.tagName)
        .toBe(isZone ? '1 1 auto' : mayShrink ? '0 1 auto' : '0 0 auto');
      expect(el.style.overflowY, el.dataset.testid ?? el.tagName).toBe('');
    }
    expect(panel.style.maxHeight).toBe('calc(100vh - 480px)');
    // The desk band also seats the docked controls.
    expect(view.getByTestId('desk-header').parentElement).toBe(view.getByTestId('desk-band'));
    expect(view.getByTestId('desk-band').parentElement).toBe(panel);
    expect(view.getByTestId('composer').parentElement).toBe(panel);
    view.unmount();
  });

  /** A key lost under a running job is not a screen: the record stays and the composer is blocked in
   *  place with the repair on it. */
  it('keeps all four zones where the record still stands, key or no key', () => {
    const { view, children } = zoneStyles(false);
    const zone = children.find((el) => el.dataset.testid === 'panel-job-frame')!;
    expect(zone.style.flex).toBe('1 1 auto');
    expect(view.getByTestId('composer').style.flex).toBe('0 0 auto');
    view.unmount();
  });

  it('keeps control clearance inside the scroll viewport', () => {
    const { view } = zoneStyles();
    const zone = view.getByTestId('panel-job-zone');
    const content = zone.querySelector<HTMLElement>('[data-scroll-content]')!;
    expect(content.style.padding).toBe('var(--control-clearance)');
    expect(zone.style.overflowX).toBe('hidden');
    view.unmount();
  });

  /**
   * A floor that beat the cap would push the composer out of the panel: at 1280x800 under the frame's
   * 1.25 zoom, Object mode leaves 233px and Generate mode 159 against 180 pinned (desk 74, composer 48,
   * three 10px gaps, 28 of padding). So the floor is what the pinned zones leave, at most the full floor.
   */
  it('floors the record only as far as the cap allows', () => {
    const capped = renderWithI18n(
      <PanelShell {...panelProps({
        view: makeView({ phase: 'executing', current: makeJob() }),
        connected: true,
        now: 0,
        maxHeight: "calc(100vh - 480px)",
        ...VERBS,
      })}
      />,
    );
    const floor = capped.getByTestId('panel-job-frame').style.minHeight.replace(/\s+/g, '');
    expect(floor).toBe(`min(${JOB_ZONE_FLOOR}px,max(0px,calc(calc(100vh - 480px) - ${PINNED_HEIGHT}px)))`.replace(/\s+/g, ''));
    capped.unmount();

    // With no cap, the floor stands as is.
    const free = renderWithI18n(
      <PanelShell {...panelProps({ view: makeView({ phase: 'executing', current: makeJob() }), connected: true, now: 0, ...VERBS })} />,
    );
    expect(free.getByTestId('panel-job-frame').style.minHeight).toBe(`${JOB_ZONE_FLOOR}px`);
    free.unmount();
  });

  /** Where the room is smaller than the pinned zones, the record shrinks to nothing. jsdom resolves no
   *  `min()` or `max()`, so the expression is asserted; it resolves to `0px` in a browser's 159px room. */
  it('lets the record be squeezed to nothing', () => {
    const { getByTestId } = renderWithI18n(
      <PanelShell {...panelProps({
        view: makeView({ phase: 'executing', current: makeJob() }),
        connected: true,
        now: 0,
        maxHeight: "100px",
        ...VERBS,
      })}
      />,
    );
    const floor = getByTestId('panel-job-frame').style.minHeight.replace(/\s+/g, '');
    expect(floor).toContain('max(0px,');
    expect(floor).toContain(`calc(100px-${PINNED_HEIGHT}px)`); // whitespace stripped
  });

  it('waives the floor for a lone closed history row', () => {
    const done = makeJob({ outcome: 'done', kind: 'build' });
    const rest = renderWithI18n(
      <PanelShell {...panelProps({
        view: makeView({ jobs: [done] }),
        connected: true,
        now: 0,
        filed: new Set([done.orderSeq]),
        ...VERBS,
      })}
      />,
    );
    expect(rest.getByTestId('panel-job-frame').style.minHeight).toBe('0');
    rest.unmount();

    // A record still standing as a card keeps its floor.
    const carded = renderWithI18n(
      <PanelShell {...panelProps({ view: makeView({ jobs: [done] }), connected: true, now: 0, ...VERBS })} />,
    );
    expect(carded.getByTestId('panel-job-frame').style.minHeight).toBe(`${JOB_ZONE_FLOOR}px`);
    carded.unmount();

    // An empty desk keeps it: the zone is where the next thing lands.
    const empty = renderWithI18n(<PanelShell {...panelProps({ view: makeView(), connected: true, now: 0, ...VERBS })} />);
    expect(empty.getByTestId('panel-job-frame').style.minHeight).toBe(`${JOB_ZONE_FLOOR}px`);
    empty.unmount();
  });

  /** The shade covers only what scrolls away, and jsdom's 0x0 boxes read as everything fitting. */
  it('keeps the scroll viewport unmasked', () => {
    const { view } = zoneStyles();
    const zone = view.getByTestId('panel-job-zone');
    expect(zone.style.maskImage).toBe('');
    view.unmount();
  });
});

/** Scroll dimensions are explicit because jsdom does not lay out the panel. */
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
    const { view, zone, box } = standAtFoot(200);
    box.scrollHeight = 600;
    view.rerender(<PanelShell {...panelProps({ view: makeView({ phase: 'idle', jobs: [makeJob({ outcome: 'done' })] }), connected: true, now: 0, ...VERBS })} />);
    expect(zone.scrollTop).toBe(400);
    view.unmount();
  });

  /** The setup screen is a form read top down, not a record to follow. */
  it('leaves the setup screen where it opens', () => {
    const watch = watchScroll();
    try {
      renderWithI18n(<PanelShell {...panelProps({ view: makeView(), connected: false, now: 0, ...VERBS })} />);
      expect(watch.writes).toEqual([]);
    } finally { watch.restore(); }
  });

  function standAtFoot(scrollTop: number) {
    const view = renderWithI18n(
      <PanelShell {...panelProps({ view: makeView({ phase: 'executing', current: makeJob() }), connected: true, now: 0, ...VERBS })} />,
    );
    const zone = view.getByTestId('panel-job-zone');
    const box = { scrollHeight: 400, clientHeight: 200 };
    for (const k of ['scrollHeight', 'clientHeight'] as const) {
      Object.defineProperty(zone, k, { configurable: true, get: () => box[k] });
    }
    let top = 0;
    Object.defineProperty(zone, 'scrollTop', {
      configurable: true,
      get: () => (top = Math.min(top, Math.max(0, box.scrollHeight - box.clientHeight))),
      set: (value: number) => { top = Math.max(0, Math.min(value, box.scrollHeight - box.clientHeight)); },
    });
    zone.scrollTop = scrollTop;
    fireEvent.scroll(zone);
    return { view, zone, box };
  }

  it('re-takes the foot when the box changes under a record that was at it', () => {
    const { view, zone, box } = standAtFoot(200);
    // The zone grows and the browser drags the position with it, as a resize does.
    box.clientHeight = 260;
    zone.scrollTop = 140;
    fireEvent.scroll(zone);
    expect(zone.scrollTop).toBe(140);
    box.clientHeight = 180;
    view.rerender(<PanelShell {...panelProps({ view: makeView({ phase: 'executing', current: makeJob() }), connected: true, now: 0, ...VERBS })} />);
    expect(zone.scrollTop).toBe(220);
    view.unmount();
  });

  it('leaves a record the user has scrolled up in exactly where they left it', () => {
    const { view, zone } = standAtFoot(200);
    zone.scrollTop = 100;
    fireEvent.scroll(zone);
    expect(zone.scrollTop, 'the box did not move, so this one is the hand on the wheel').toBe(100);

    // A later reshape does not haul them back down.
    fireEvent.scroll(zone);
    expect(zone.scrollTop).toBe(100);
    view.unmount();
  });

  it('keeps the user scroll made right after content grew under an unchanged box', () => {
    const { view, zone, box } = standAtFoot(200);
    box.scrollHeight = 800;
    zone.scrollTop = 100;
    fireEvent.scroll(zone);
    expect(zone.scrollTop, 'the box did not move, so this one is the hand on the wheel').toBe(100);
    view.unmount();
  });
});

describe('PanelShell: the character slots', () => {
  it('draws its own character until an entrance plate is given', () => {
    const { getByTestId } = renderWithI18n(<PanelShell {...panelProps({ view: makeView(), connected: true, now: 0, ...VERBS })} />);
    expect(getByTestId('desk-header-char-slot').children.length).toBeGreaterThan(0);
  });

  /** The flip leap measures both slots in viewport coordinates and positions the character `fixed`;
   *  a transform anywhere above either endpoint would become its containing block. */
  it('puts no transform or filter on any ancestor of the desk slot', () => {
    const { getByTestId } = renderWithI18n(<PanelShell {...panelProps({ view: makeView(), connected: true, now: 0, ...VERBS })} />);
    let el: HTMLElement | null = getByTestId('desk-header-char-slot');
    while (el && el !== document.body) {
      expect(el.style.transform, el.getAttribute('data-testid') ?? el.tagName).toBe('');
      expect(el.style.filter, el.getAttribute('data-testid') ?? el.tagName).toBe('');
      el = el.parentElement;
    }
  });
});

/**
 * The free panel's dock knob floats on the plate's top-right corner: outside the plate in the tree,
 * since the plate clips; centred on the right edge, so the half on the paper stays within the plate's
 * padding.
 */
describe('PanelShell: the dock knob', () => {
  const knob = () => renderWithI18n(
    <PanelShell {...panelProps({ view: makeView(), connected: true, now: 0, ...VERBS, onTogglePin: () => {} })} />,
  );

  it('floats on the plate\'s top-right corner, centred on the edge', () => {
    const { getByTestId } = knob();
    const cluster = getByTestId('desk-pin');
    expect(parseFloat(cluster.style.right)).toBe(-PIN_KNOB_OUT);
    expect(PIN_KNOB_OUT).toBe(PIN_KNOB.size / 2);
    expect(PIN_KNOB_OUT).toBeLessThanOrEqual(PANEL_PAD);
  });

  it('hangs from the plate\'s own corner, clear of both the curve and the caption above', () => {
    // Any higher and its inner half stands over the corner curve with no paper behind it; above the
    // plate's top it would reach the selected block's caption clearance.
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
    expect(cluster.parentElement).toBe(plate.parentElement);
    expect(plate.style.overflow).toBe('hidden');
  });

  /** The holder carries the fade and the open gesture's travel, so the knob leaves with the panel. */
  it('shares the holder the gesture is carried on', () => {
    const { getByTestId } = knob();
    const holder = getByTestId('panel-shell').parentElement as HTMLElement;
    expect(holder.style.position).toBe('relative');
    expect(holder.style.background).toBe('');
    expect(holder.style.borderRadius).toBe('');
  });

  it('gives way to a stacked pair of buttons once the panel is docked', () => {
    const { getByTestId, queryByTestId } = renderWithI18n(
      <PanelShell {...panelProps({
        view: makeView(),
        connected: true,
        now: 0,
        ...VERBS,
        pinned: true,
        onTogglePin: () => {},
        onSwitchSide: () => {},
      })}
      />,
    );
    const cluster = getByTestId('desk-pin');
    expect(cluster.style.flexDirection).toBe('column');
    expect(getByTestId('panel-shell').contains(cluster)).toBe(true);
    expect(queryByTestId('dock-switch')).not.toBeNull();
  });

  /** The status card starts at the plate's padding and is `STATUS_CARD_HEIGHT` tall; the pair shares its midline. */
  it('centres the docked pair on the status-card band it stands beside', () => {
    const { getByTestId } = renderWithI18n(
      <PanelShell {...panelProps({
        view: makeView(),
        connected: true,
        now: 0,
        ...VERBS,
        pinned: true,
        onTogglePin: () => {},
        onSwitchSide: () => {},
      })}
      />,
    );
    const top = parseFloat(getByTestId('desk-pin').style.top);
    expect(top + DOCK_CHROME_FILE_H / 2).toBe(PANEL_PAD + STATUS_CARD_HEIGHT / 2);
  });

  it('stands the docked pair at the right edge whichever side the panel is docked to', () => {
    for (const side of ['left', 'right'] as const) {
      const { getByTestId, unmount } = renderWithI18n(
        <PanelShell {...panelProps({
          view: makeView(),
          connected: true,
          now: 0,
          ...VERBS,
          pinned: true,
          edge: side,
          onTogglePin: () => {},
          onSwitchSide: () => {},
        })}
        />,
      );
      const cluster = getByTestId('desk-pin');
      expect(cluster.style.right, side).toBe(`${PANEL_PAD}px`);
      expect(cluster.style.left, side).toBe('');
      unmount();
    }
  });

  it('reserves the buttons\' seat in the desk band alone, and only while docked', () => {
    const docked = renderWithI18n(
      <PanelShell {...panelProps({
        view: makeView(),
        connected: true,
        now: 0,
        ...VERBS,
        pinned: true,
        onTogglePin: () => {},
        onSwitchSide: () => {},
      })}
      />,
    );
    expect(docked.getByTestId('desk-band').style.paddingRight).toBe(`${DOCK_CHROME_W}px`);
    docked.unmount();
    const free = renderWithI18n(
      <PanelShell {...panelProps({ view: makeView(), connected: true, now: 0, ...VERBS, onTogglePin: () => {} })} />,
    );
    expect(parseFloat(free.getByTestId('desk-band').style.paddingRight)).toBe(0);
  });
});

/**
 * The plate's entrance and exit clip it to a rect growing from its top-left corner, and the knob stands
 * outside that clip, so the knob's carry is computed from the same animated clip value: one driver, as
 * the character's `placeCarried` keeps for her seat.
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

  /** An inset serializes to fewer components when edges agree; a missed spelling makes the disc jump. */
  it('reads every inset arity the engine can serialize', () => {
    expect(knobCarry('inset(50%)').scale).toBeCloseTo(0.5, 6);
    expect(knobCarry('inset(0% 50%)').x).toBeCloseTo(-PANEL_WIDTH / 2, 6);
    expect(knobCarry('inset(0% 50%)').y).toBeCloseTo(0, 6);
    expect(knobCarry('inset(0% 40% 20%)').y)
      .toBeCloseTo(-(PANEL_RADIUS + PIN_KNOB.size / 2) * 0.2, 6);
    expect(knobCarry('none')).toEqual({ x: 0, y: 0, scale: 1 });
  });

  it('carries the free knob on the plate\'s own clip', () => {
    const { getByTestId } = render(
      <MotionConfig reducedMotion="never">
        <I18nProvider>
          <PanelShell {...panelProps({ view: makeView(), connected: true, now: 0, ...VERBS, hosted: true, onTogglePin: () => {} })} />
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
      <PanelShell {...panelProps({ view: makeView(), connected: true, now: 0, ...VERBS, onTogglePin: () => {} })} />,
    );
    expect(['', 'none']).toContain(free.getByTestId('desk-pin').style.transform);
    free.unmount();
    const docked = renderWithI18n(
      <PanelShell {...panelProps({ view: makeView(), connected: true, now: 0, ...VERBS, pinned: true, onTogglePin: () => {} })} />,
    );
    expect(['', 'none']).toContain(docked.getByTestId('desk-pin').style.transform);
  });
});

/**
 * Framer applies even an instant transition a frame late, while the docked-to-free geometry swap is
 * React's, so the folded beat hides the holder with inline `visibility`, which lands in the same paint.
 */
describe('PanelShell: the covered beat', () => {
  const shell = (away?: 'leaving' | 'folded') => (
    <PanelShell {...panelProps({
      view: makeView(),
      connected: true,
      now: 0,
      ...VERBS,
      ...(away ? { away } : {}),
      onTogglePin: () => {},
    })}
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

/** Docked, the zone is the window's height: the keyless rest shows the whole dream pool, and the idle
 *  rest seats its sketch card at the zone's foot, nearest the composer. */
describe('PanelShell: the docked zone uses its room', () => {
  it('stands the whole dream pool on the keyless rest while docked', () => {
    const { getAllByTestId } = renderWithI18n(
      <PanelShell {...panelProps({
        view: makeView(),
        connected: false,
        now: 0,
        ...VERBS,
        pinned: true,
        onTogglePin: () => {},
      })}
      />,
    );
    expect(getAllByTestId('dream-row')).toHaveLength(DREAMS.length);
  });

  it('seats the idle sketch card at the zone\'s foot while docked, and in the flow while free', () => {
    const card = <div data-testid="sketch-card-stub" />;
    const docked = renderWithI18n(
      <PanelShell {...panelProps({
        view: makeView(),
        connected: true,
        now: 0,
        ...VERBS,
        sketchbook: card,
        pinned: true,
        onTogglePin: () => {},
      })}
      />,
    );
    expect(docked.getByTestId('sketch-seat').style.marginTop).toBe('auto');
    docked.unmount();
    const free = renderWithI18n(
      <PanelShell {...panelProps({ view: makeView(), connected: true, now: 0, ...VERBS, sketchbook: card })} />,
    );
    expect(parseFloat(free.getByTestId('sketch-seat').style.marginTop)).toBe(0);
  });
});

describe('panel copy, in every locale', () => {
  const KEYS = [
    'agent.steer_at_next_step', 'agent.steer_take_back', 'agent.dock_disconnected',
    'agent.dock_setup_awake', 'agent.dock_setup_show_key', 'agent.banner_rate_limit',
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
});

/**
 * The panel tweens its real `height` with Web Animations (`panel.height`), not a framer `layout`
 * transform, which would become the containing block of the `fixed` character in its desk. jsdom has
 * no Web Animations API, so `animate` is stubbed and the call is asserted.
 */
describe('PanelShell: the height tween', () => {
  interface Call { frames: Record<string, unknown>[]; options: { duration?: number; easing?: string } }

  /**
   * Stubs the panel's `offsetHeight`, moved only when the test moves it. The tween reads
   * `offsetHeight`, not a rect: under the frame's css `zoom` a rect answers in screen px (550 for a
   * 440px panel at 1.25) while `height` is in the element's own px.
   */
  function withStubs(initial: number) {
    const calls: Call[] = [];
    const realAnimate = (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
    const own = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
    let height = initial;
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

  /** The before height is the last commit's, carried in a ref; two readings in one layout effect
   *  would be equal by construction. */
  it('animates the real height property, from the height it had to the one it wants', () => {
    const stub = withStubs(300);
    try {
      const { rerender } = render(
        <PanelShell {...panelProps({ view: makeView(), connected: true, now: 0, ...VERBS })} />,
        { wrapper: Moving },
      );
      expect(stub.calls, 'the first measurement never animates').toEqual([]);

      stub.grow(460);
      rerender(<PanelShell {...panelProps({ view: gated, connected: true, now: 0, ...VERBS })} />);

      expect(stub.calls).toHaveLength(1);
      const call = stub.calls[0]!;
      expect(call.frames.map((f) => f.height)).toEqual(['300px', '460px']);
      expect(call.frames.map((f) => [f.minHeight, f.maxHeight])).toEqual([
        ['300px', '300px'], ['460px', '460px'],
      ]);
      expect(call.options.duration).toBe(seconds('panel.height') * 1000);
      expect(call.options.easing).toBe(easingCss('panel.height'));
    } finally {
      stub.restore();
    }
  });

  it('runs nothing where the height did not move', () => {
    const stub = withStubs(300);
    try {
      const { rerender } = render(
        <PanelShell {...panelProps({ view: makeView(), connected: true, now: 0, ...VERBS })} />,
        { wrapper: Moving },
      );
      rerender(<PanelShell {...panelProps({ view: gated, connected: true, now: 0, ...VERBS })} />);
      expect(stub.calls).toEqual([]);
    } finally {
      stub.restore();
    }
  });

  /** A mode switch changes only the cap (367 to 159 own px), so the shape key carries the cap. */
  it('sees a change of cap, with the record standing still', () => {
    const stub = withStubs(367);
    try {
      const { rerender } = render(
        <PanelShell {...panelProps({ view: makeView(), connected: true, now: 0, maxHeight: "calc(100vh - 300px)", ...VERBS })} />,
        { wrapper: Moving },
      );
      stub.grow(159);
      rerender(<PanelShell {...panelProps({ view: makeView(), connected: true, now: 0, maxHeight: "calc(100vh - 500px)", ...VERBS })} />);
      expect(stub.calls.map((c) => c.frames.map((f) => f.height))).toEqual([['367px', '159px']]);
      expect(stub.calls[0]!.frames.map((f) => f.maxHeight)).toEqual(['367px', '159px']);
    } finally {
      stub.restore();
    }
  });

  /** The cap is a css expression on the window, so a resize changes the height with no commit; the
   *  remembered height must re-baseline or the next shape change animates from a stale value. */
  it('re-baselines on a change of room, and tweens nothing for the resize itself', () => {
    const stub = withStubs(367);
    const wasHeight = window.innerHeight;
    try {
      const { rerender } = render(
        <PanelShell {...panelProps({ view: makeView(), connected: true, now: 0, ...VERBS })} />,
        { wrapper: Moving },
      );
      // The window grows and the cap with it.
      stub.grow(430);
      act(() => {
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1100 });
        window.dispatchEvent(new Event('resize'));
      });
      expect(stub.calls, 'a resize is the box tracking the window, not a shape change').toEqual([]);

      rerender(<PanelShell {...panelProps({ view: gated, connected: true, now: 0, ...VERBS })} />);
      expect(stub.calls, 'the remembered height is the one on screen').toEqual([]);

      // A real change starts from the height on screen.
      stub.grow(245);
      rerender(<PanelShell {...panelProps({ view: makeView(), connected: true, now: 0, ...VERBS })} />);
      expect(stub.calls.map((c) => c.frames.map((f) => f.height))).toEqual([['430px', '245px']]);
    } finally {
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: wasHeight });
      stub.restore();
    }
  });

  it('runs nothing under reduced motion', () => {
    const stub = withStubs(300);
    try {
      const { rerender } = renderWithI18n(<PanelShell {...panelProps({ view: makeView(), connected: true, now: 0, ...VERBS })} />);
      stub.grow(460);
      rerender(<PanelShell {...panelProps({ view: gated, connected: true, now: 0, ...VERBS })} />);
      expect(stub.calls).toEqual([]);
    } finally {
      stub.restore();
    }
  });
});

/**
 * `HELD`, `ON_HOLD` and the `streaming` and `thinking` flags feed `JobTicket` straight off
 * `view.phase` and `saysStreaming`; nothing else in this suite would notice them break.
 */
describe('PanelShell: the phase-derived ticket facts', () => {
  const ALL_PHASES: SessionPhase[] = [
    'idle', 'thinking', 'streaming', 'executing', 'gated', 'retrying',
    'pausing', 'paused', 'aborted', 'incident',
  ];

  /** `PanelShell`'s `HELD`: the tape freezes, `pausing` included since the ticket is not progressing. */
  const HELD_PHASES: ReadonlySet<SessionPhase> = new Set(['gated', 'retrying', 'pausing', 'paused']);

  /** `PanelShell`'s `ON_HOLD`; not `pausing`, which has nothing to resume from yet. */
  const ON_HOLD_PHASES: ReadonlySet<SessionPhase> = new Set(['paused']);

  it('freezes the tape\'s fill exactly on the phases where nothing is moving', () => {
    for (const phase of ALL_PHASES) {
      const { getByTestId, unmount } = renderWithI18n(
        <PanelShell {...panelProps({ view: makeView({ phase, current: makeJob() }), connected: true, now: 0, ...VERBS })} />,
      );
      const fill = getByTestId('tape-bar').querySelector('span') as HTMLElement;
      expect(fill.style.opacity, `phase ${phase}`).toBe(HELD_PHASES.has(phase) ? '0.45' : '');
      unmount();
    }
  });

  it('carries the pausemark and the hold\'s two verbs on exactly one phase', () => {
    for (const phase of ALL_PHASES) {
      const { queryByTestId, unmount } = renderWithI18n(
        <PanelShell {...panelProps({ view: makeView({ phase, current: makeJob() }), connected: true, now: 0, ...VERBS })} />,
      );
      const onHold = ON_HOLD_PHASES.has(phase);
      expect(!!queryByTestId('pausemark'), `pausemark @ ${phase}`).toBe(onHold);
      expect(!!queryByTestId('ticket-actions'), `ticket-actions @ ${phase}`).toBe(onHold);
      unmount();
    }
  });

  it('carries the caret only while the says line is still arriving', () => {
    const arriving = renderWithI18n(
      <PanelShell {...panelProps({
        view: makeView({ phase: 'streaming', current: makeJob({ says: 'raising the wall', saysStreaming: true }) }),
        connected: true, now: 0, ...VERBS,
      })}
      />,
    );
    expect(arriving.getByTestId('says-caret')).toBeTruthy();
    arriving.unmount();

    const landed = renderWithI18n(
      <PanelShell {...panelProps({
        view: makeView({ phase: 'streaming', current: makeJob({ says: 'raising the wall' }) }),
        connected: true, now: 0, ...VERBS,
      })}
      />,
    );
    expect(landed.queryByTestId('says-caret')).toBeNull();
  });

  it('shows the progress bar without a spare loading row before words arrive', () => {
    const thinking = renderWithI18n(
      <PanelShell {...panelProps({ view: makeView({ phase: 'thinking', current: makeJob() }), connected: true, now: 0, ...VERBS })} />,
    );
    expect(thinking.getByTestId('tape-bar')).toBeTruthy();
    expect(thinking.queryByTestId('says-dots')).toBeNull();
    expect(thinking.queryByTestId('says')).toBeNull();
    thinking.unmount();

    const executing = renderWithI18n(
      <PanelShell {...panelProps({ view: makeView({ phase: 'executing', current: makeJob() }), connected: true, now: 0, ...VERBS })} />,
    );
    expect(executing.queryByTestId('says')).toBeNull();
  });
});

describe('the caveat under the composer', () => {
  it('stands while the assistant waits for an order and leaves with the composer', () => {
    const props = { view: makeView(), connected: true, now: 0, ...VERBS };
    const ui = renderWithI18n(<PanelShell {...panelProps(props)} />);
    expect(ui.getByTestId('agent-caveat').textContent).toBe(translations.en['agent.caveat']);
    ui.rerender(<PanelShell {...panelProps({ ...props, connected: false })} />);
    expect(ui.queryByTestId('composer')).toBeNull();
    expect(ui.queryByTestId('agent-caveat')).toBeNull();
  });
});
