// @vitest-environment jsdom
/**
 * PanelShell's composition: which zones stand, what fills the job zone per phase, which verb each
 * control calls, and the four top-level groups the layout rests on. Rendered under reduced motion
 * so the character and the tape mount without the Web Animations API.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, act, waitFor } from '@testing-library/react';
import { useEditorStore } from '../../../state/store';
import { translations } from '../../_support/locale-tables';
import { PanelShell } from '../../../ui/agent/PanelShell';
import { DREAMS } from '../../../ui/agent/desk/DreamOffice';
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

describe('PanelShell: the character slots', () => {
  it('draws its own character until an entrance plate is given', () => {
    const { getByTestId } = renderWithI18n(<PanelShell {...panelProps({ view: makeView(), connected: true, now: 0, ...VERBS })} />);
    expect(getByTestId('desk-header-char-slot').children.length).toBeGreaterThan(0);
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
 * `ON_HOLD` and the `streaming` and `thinking` flags feed `JobTicket` straight off
 * `view.phase` and `saysStreaming`; nothing else in this suite would notice them break.
 */
describe('PanelShell: the phase-derived ticket facts', () => {
  const ALL_PHASES: SessionPhase[] = [
    'idle', 'thinking', 'streaming', 'executing', 'gated', 'retrying',
    'pausing', 'paused', 'aborted', 'incident',
  ];

  /** `PanelShell`'s `ON_HOLD`; not `pausing`, which has nothing to resume from yet. */
  const ON_HOLD_PHASES: ReadonlySet<SessionPhase> = new Set(['paused']);

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
