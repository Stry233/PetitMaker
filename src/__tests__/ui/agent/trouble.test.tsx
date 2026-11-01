// @vitest-environment jsdom
/** Faults and holds: the banner's repairs, the resume offer, and what the panel stands for a job the
 *  key went away under. */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, cleanup } from '@testing-library/react';
import { translateFor } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { Banner, BANNER_CLASSES, type BannerActionId } from '../../../ui/agent/desk/Banner';
import { ResumeCard } from '../../../ui/agent/record/ResumeCard';
import { PanelShell } from '../../../ui/agent/PanelShell';
import { useAgentConnection } from '../../../agent/connection/store';
import { PROVIDER_IDS, type ProviderId } from '../../../agent/providers/defaults';
import type { JobView, PanelView } from '../../../agent/core/project-view';
import { makeView, panelProps, renderWithI18n } from '../../_support/agent-panel';
import type { TextKey } from '../../../i18n/keys';

const backing = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
};

const t = (key: TextKey, params?: Record<string, string | number>) => translateFor('en', key, params);

beforeEach(() => {
  backing.clear();
  useEditorStore.setState({ locale: 'en' });
  useAgentConnection.setState({
    provider: 'claude',
    model: Object.fromEntries(PROVIDER_IDS.map((id) => [id, ''])) as Record<ProviderId, string>,
    oversight: 'checkpoint', customBaseUrl: '', keyed: [], hydrated: true,
  });
});

function makeJob(over: Partial<JobView> = {}): JobView {
  return {
    orderSeq: 1, orderText: 'Plant a forest along the ridge', orderAt: 0,
    asks: [], ops: [], steerNotes: [], checkpoints: [], stamps: [], celebrate: false, skills: [],
    ...over,
  };
}

const VERBS = {
  onSend: () => {}, onStop: () => {}, onPause: () => {}, onGateAnswer: () => {},
};

/** A settled job that ended on `cls`, which is what puts the panel in the trouble state. */
function incidentView(cls: JobView['errorCls'], over: Partial<JobView> = {}): PanelView {
  return makeView({
    phase: 'incident',
    jobs: [makeJob({ outcome: 'incident', errorCls: cls, ...over })],
  });
}

function actions(root: HTMLElement): string[] {
  return [...root.querySelectorAll('[data-testid="banner-action"]')]
    .map((el) => el.getAttribute('data-action') ?? '');
}

describe('Banner: what each trouble offers', () => {
  it('gives every actionable class a repair pill, and never more than two', () => {
    for (const cls of BANNER_CLASSES) {
      const { getByTestId, unmount } = renderWithI18n(<Banner cls={cls} onAction={() => {}} />);
      const list = actions(getByTestId('banner'));
      expect(list.length, cls).toBeLessThanOrEqual(2);
      unmount();
    }
  });

  it('names the repair for each actionable fault', () => {
    const wanted: [Parameters<typeof Banner>[0]['cls'], BannerActionId][] = [
      ['auth', 'fix-key'],
      ['quota', 'change-provider'],
      ['cors', 'edit-endpoint'],
      ['overflow', 'new-order'],
      ['network', 'try-again'],
      ['overloaded', 'try-again'],
      ['rate-limit', 'try-again'],
      ['config', 'edit-endpoint'],
      ['model', 'edit-model'],
      ['storage-corrupt', 'export-log'],
    ];
    for (const [cls, action] of wanted) {
      const { getByTestId, unmount } = renderWithI18n(<Banner cls={cls} onAction={() => {}} />);
      expect(actions(getByTestId('banner')), cls).toContain(action);
      unmount();
    }
  });

  it('calls back with the id of the pill that was pressed', () => {
    const onAction = vi.fn();
    const { getByTestId } = renderWithI18n(<Banner cls="quota" onAction={onAction} />);
    fireEvent.click(getByTestId('banner').querySelector('[data-action="change-provider"]')!);
    expect(onAction.mock.calls).toEqual([['change-provider']]);
  });

  /** The set-aside bytes go with the corrupt notice's dismiss. */
  it('words the corrupt notice\'s dismiss as a discard', () => {
    const { getByTestId } = renderWithI18n(<Banner cls="storage-corrupt" onAction={() => {}} />);
    const dismiss = getByTestId('banner').querySelector('[data-action="dismiss"]')!;
    expect(dismiss.textContent).toBe(t('agent.banner_action_discard'));
  });

  it('demotes to the standing strip, keeping the sentence and dropping only the dismissal', () => {
    const loud = renderWithI18n(<Banner cls="auth" onAction={() => {}} />);
    expect(loud.getByTestId('banner').getAttribute('data-standing')).toBeNull();
    expect(actions(loud.getByTestId('banner'))).toEqual(['fix-key', 'set-aside']);
    loud.unmount();

    const { getByTestId } = renderWithI18n(<Banner cls="auth" standing onAction={() => {}} />);
    const strip = getByTestId('banner');
    expect(strip.getAttribute('data-standing')).toBe('true');
    expect(strip.textContent).toContain(t('agent.banner_auth'));
    expect(actions(strip)).toEqual(['fix-key']);
  });

  /** The banner's height may not change because its only action was the one answered. */
  it('keeps its one pill standing, for a class with no repair to fall back on', () => {
    for (const cls of ['storage-pruned', 'storage-full'] as const) {
      const { getByTestId, unmount } = renderWithI18n(<Banner cls={cls} standing onAction={() => {}} />);
      expect(actions(getByTestId('banner')), cls).toEqual(['dismiss']);
      unmount();
    }
  });
});

describe('ResumeCard: a held job offered back', () => {

  it('names the order, where it stopped and what is already on the map', () => {
    const { getByTestId } = renderWithI18n(
      <ResumeCard
        order="Terrace the hill and build the shrine path"
        pausemark="paused after step 2 of 4"
        note="Two stages are already on your map."
        onResume={() => {}}
        onSetAside={() => {}}
      />,
    );
    expect(getByTestId('resume-order').textContent).toBe('Terrace the hill and build the shrine path');
    expect(getByTestId('resume-pausemark').textContent).toContain('paused after step 2 of 4');
    expect(getByTestId('resume-note').textContent).toBe('Two stages are already on your map.');
    expect(getByTestId('resume-resume')).toBeTruthy();
    expect(getByTestId('resume-set-aside')).toBeTruthy();
  });

  it('draws NO Resume on a blocked offer, and the reason plus the repair instead', () => {
    const { getByTestId, queryByTestId } = renderWithI18n(
      <ResumeCard
        order="Plant a forest along the ridge"
        pausemark="paused after step 2 of 4"
        blocked="The job ended when the key was cleared. A new order picks up the work."
        onResume={() => {}}
        onFixKey={() => {}}
        onSetAside={() => {}}
      />,
    );
    expect(queryByTestId('resume-resume')).toBeNull();
    expect(getByTestId('resume-blocked').textContent).toBe('The job ended when the key was cleared. A new order picks up the work.');
    expect(getByTestId('resume-fix-key')).toBeTruthy();
    expect(getByTestId('resume-set-aside')).toBeTruthy();
  });

  /** The loop honours a pause only at a call boundary, and a held job has none coming. */
  it('offers no pause verb of any kind', () => {
    const { getByTestId } = renderWithI18n(
      <ResumeCard order="Plant a forest" onResume={() => {}} onSetAside={() => {}} />,
    );
    const words = getByTestId('resume-card').textContent ?? '';
    expect(words).not.toContain(t('agent.dock_pause_at_step'));
    expect(getByTestId('resume-card').querySelector('[data-testid*="pause"]')).toBeNull();
  });

  it('draws a verb only where its caller wired one', () => {
    const { queryByTestId } = renderWithI18n(<ResumeCard order="Plant a forest" />);
    expect(queryByTestId('resume-resume')).toBeNull();
    expect(queryByTestId('resume-set-aside')).toBeNull();
  });

});

describe('PanelShell: a fault names its repair and the repair acts', () => {
  it('stands the order the trouble is about, under the banner and without verbs of its own', () => {
    const { getByTestId, queryByTestId } = renderWithI18n(
      <PanelShell {...panelProps({
        view: incidentView('overflow', {
          ops: Array.from({ length: 64 }, () => ({ callId: 'c', name: 'paint_terrain', status: 'ok' as const, summary: '', isRead: false })),
          stamps: [{ kind: 'compaction' as const, beforeIndex: 0 }],
        }),
        connected: true, now: 0, ...VERBS, onRepair: () => {},
      })}
      />,
    );
    const card = getByTestId('incident-card');
    expect(card.textContent).toContain('Plant a forest along the ridge');
    expect(card.querySelector('[data-testid="tape-bar"]')).not.toBeNull();
    expect(card.querySelector('[data-testid="ops-count-pill"]')!.textContent).toBe('64 steps, last 0');
    expect(card.textContent).toContain(t('agent.stamp_compaction'));
    // The repairs are the banner's alone.
    expect(card.querySelector('[data-testid="pill"]')).toBeNull();
    expect(queryByTestId('banner')).toBeTruthy();
  });

  it('hands every banner press but the dismissal to the caller', () => {
    const onRepair = vi.fn();
    const { getByTestId } = renderWithI18n(
      <PanelShell {...panelProps({ view: incidentView('quota'), connected: true, now: 0, ...VERBS, onRepair })} />,
    );
    fireEvent.click(getByTestId('banner').querySelector('[data-action="change-provider"]')!);
    expect(onRepair.mock.calls).toEqual([['change-provider']]);
  });

  it('demotes the standing fault rather than unmounting it', () => {
    const { getByTestId } = renderWithI18n(
      <PanelShell {...panelProps({ view: incidentView('unknown'), connected: true, now: 0, ...VERBS, onRepair: () => {} })} />,
    );
    expect(getByTestId('banner').getAttribute('data-standing')).toBeNull();
    fireEvent.click(getByTestId('banner').querySelector('[data-action="dismiss"]')!);
    expect(getByTestId('banner').getAttribute('data-standing')).toBe('true');
  });

  it('files the job on set-aside, and stays on the connected rest', () => {
    const onFileAway = vi.fn();
    const onRepair = vi.fn();
    const { getByTestId, queryByTestId } = renderWithI18n(
      <PanelShell {...panelProps({
        view: incidentView('quota'),
        connected: true,
        now: 0,
        ...VERBS,
        onFileAway,
        onRepair,
      })}
      />,
    );
    fireEvent.click(getByTestId('banner').querySelector('[data-action="set-aside"]')!);
    expect(onFileAway.mock.calls, 'the record must be filed, not dropped').toEqual([[1]]);
    expect(onRepair.mock.calls).toEqual([['set-aside']]);
    expect(queryByTestId('setup-screen')).toBeNull();
    expect(queryByTestId('dream-office')).toBeNull();
  });

  /** The panel owns the composer, so it answers `new-order` itself. */
  it('answers new-order itself by putting the caret in the composer', () => {
    const onRepair = vi.fn();
    const { getByTestId } = renderWithI18n(
      <PanelShell {...panelProps({ view: incidentView('overflow'), connected: true, now: 0, ...VERBS, onRepair })} />,
    );
    fireEvent.click(getByTestId('banner').querySelector('[data-action="new-order"]')!);
    expect(document.activeElement).toBe(getByTestId('composer-input'));
  });
});

/**
 * The host answered, so a retry sends the same model and the URL is not at fault: the one repair is
 * the model row behind the gear, and the sentence names the model, since any typed id can be armed.
 */
describe('Banner: the model the endpoint does not serve', () => {
  it('names the armed model in its sentence, and falls back to the bare wording with none given', () => {
    const named = renderWithI18n(<Banner cls="model" model="Claude Sonnet 4.5" onAction={() => {}} />);
    expect(named.getByTestId('banner').textContent).toContain('Claude Sonnet 4.5');
    expect(named.getByTestId('banner').textContent).not.toContain('{model}');
    named.unmount();

    const bare = renderWithI18n(<Banner cls="model" onAction={() => {}} />);
    expect(bare.getByTestId('banner').textContent).toContain(t('agent.banner_model_bare'));
    expect(bare.getByTestId('banner').textContent).not.toContain('{model}');
  });

  it('leads with the model repair rather than another attempt', () => {
    const { getByTestId } = renderWithI18n(<Banner cls="model" onAction={() => {}} />);
    const pills = [...getByTestId('banner').querySelectorAll('[data-testid="banner-action"]')];
    expect(pills.map((el) => el.getAttribute('data-action'))).toEqual(['edit-model', 'set-aside']);
    expect(pills.some((el) => el.getAttribute('data-action') === 'try-again')).toBe(false);
  });

  it('hands the model repair to the caller, which is where the settings card is owned', () => {
    const onRepair = vi.fn();
    const { getByTestId } = renderWithI18n(
      <PanelShell {...panelProps({
        view: incidentView('model'),
        connected: true,
        now: 0,
        modelName: "Claude Sonnet 4.5",
        ...VERBS,
        onRepair,
      })}
      />,
    );
    expect(getByTestId('banner').textContent).toContain('Claude Sonnet 4.5');
    fireEvent.click(getByTestId('banner').querySelector('[data-action="edit-model"]')!);
    expect(onRepair.mock.calls).toEqual([['edit-model']]);
    // The connection screen would repair the wrong field.
    expect(getByTestId('panel-shell').querySelector('[data-testid="setup-screen"]')).toBeNull();
  });
});

describe('PanelShell: the OFF composer says the one instruction', () => {
  it('names the repair in the placeholder and disables the field', () => {
    const { getByTestId } = renderWithI18n(
      <PanelShell {...panelProps({ view: incidentView('quota'), connected: true, now: 0, ...VERBS })} />,
    );
    const input = getByTestId('composer-input') as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(input.placeholder).toBe(t('agent.composer_blocked_provider'));
  });

  it('leaves the field LIVE where a shorter order is the repair', () => {
    const { getByTestId } = renderWithI18n(
      <PanelShell {...panelProps({ view: incidentView('overflow'), connected: true, now: 0, ...VERBS })} />,
    );
    const input = getByTestId('composer-input') as HTMLInputElement;
    expect(input.disabled).toBe(false);
    expect(input.placeholder).toBe(t('agent.composer_shorter'));
  });

  it('refuses the field and the send while the fault stands', () => {
    const { getByTestId } = renderWithI18n(
      <PanelShell {...panelProps({ view: incidentView('cors'), connected: true, now: 0, ...VERBS })} />,
    );
    expect((getByTestId('composer-input') as HTMLInputElement).disabled).toBe(true);
    expect((getByTestId('composer-send') as HTMLButtonElement).disabled).toBe(true);
  });

  /** A demoted strip that kept the composer off would be a fault with no way past it. */
  it('gives the field back once the fault is demoted', () => {
    const { getByTestId } = renderWithI18n(
      <PanelShell {...panelProps({ view: incidentView('rate-limit'), connected: true, now: 0, ...VERBS, onRepair: () => {} })} />,
    );
    expect((getByTestId('composer-input') as HTMLInputElement).disabled).toBe(true);
    // `rate-limit` is put down by filing the job rather than a bare dismissal; both demote.
    fireEvent.click(getByTestId('banner').querySelector('[data-action="set-aside"]')!);
    expect((getByTestId('composer-input') as HTMLInputElement).disabled).toBe(false);
  });
});

describe('PanelShell: the key that went away', () => {
  const keyCleared = () => incidentView('auth');

  /** A keyless panel is the dreaming office, except over a job the key's removal stopped. */
  it('shows the held job rather than the dreaming office', () => {
    const { getByTestId, queryByTestId } = renderWithI18n(
      <PanelShell {...panelProps({ view: keyCleared(), connected: false, now: 0, ...VERBS, onRepair: () => {} })} />,
    );
    expect(queryByTestId('dream-office')).toBeNull();
    expect(getByTestId('resume-card')).toBeTruthy();
    expect(getByTestId('banner').getAttribute('data-cls')).toBe('key-cleared');
  });

  it('offers no Resume, and the repair opens the connection surface', () => {
    const onRepair = vi.fn();
    const { getByTestId, queryByTestId } = renderWithI18n(
      <PanelShell {...panelProps({ view: keyCleared(), connected: false, now: 0, ...VERBS, onRepair })} />,
    );
    expect(queryByTestId('resume-resume')).toBeNull();
    fireEvent.click(getByTestId('resume-fix-key'));
    // No key is held, so the panel opens the field itself.
    expect(getByTestId('setup-screen')).toBeTruthy();
    expect(onRepair).not.toHaveBeenCalled();
  });

  it('files the job on set-aside before anything else happens to it', () => {
    const onFileAway = vi.fn();
    const { getByTestId } = renderWithI18n(
      <PanelShell {...panelProps({
        view: keyCleared(), connected: false, now: 0, ...VERBS,
        onFileAway, onRepair: () => {},
      })}
      />,
    );
    fireEvent.click(getByTestId('resume-set-aside'));
    expect(onFileAway.mock.calls).toEqual([[1]]);
  });

  it('says connect a provider in the OFF composer', () => {
    const { getByTestId } = renderWithI18n(
      <PanelShell {...panelProps({ view: keyCleared(), connected: false, now: 0, ...VERBS, onRepair: () => {} })} />,
    );
    const input = getByTestId('composer-input') as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(input.placeholder).toBe(t('agent.composer_disconnected'));
  });

  /**
   * Besides the auth incident, a user revoking a key reaches a job paused when the key went (nothing
   * was in flight, so the phase stands at `paused`) and a job the revoke aborted.
   */
  const heldNoKey = (): PanelView => makeView({
    phase: 'paused',
    current: makeJob({ checkpoints: [{ undoIndex: 3, label: 'the ridge' }] }),
  });
  const abortedNoKey = (): PanelView => makeView({
    phase: 'aborted',
    jobs: [makeJob({ outcome: 'aborted', endUndoIndex: 9 })],
  });

  it('shows a PAUSED job rather than the dreaming office', () => {
    const { getByTestId, queryByTestId } = renderWithI18n(
      <PanelShell {...panelProps({ view: heldNoKey(), connected: false, now: 0, ...VERBS, onRepair: () => {} })} />,
    );
    expect(queryByTestId('dream-office')).toBeNull();
    expect(getByTestId('resume-card')).toBeTruthy();
    expect(getByTestId('banner').getAttribute('data-cls')).toBe('key-cleared');
    // Resume would need the key that is gone.
    expect(queryByTestId('resume-resume')).toBeNull();
    expect(getByTestId('resume-fix-key')).toBeTruthy();
  });

  /** Filing a paused job would leave the session holding a hold nothing shows, so it is settled. */
  it('settles a paused job on set-aside rather than merely filing it', () => {
    const onSetAside = vi.fn();
    const onFileAway = vi.fn();
    const { getByTestId } = renderWithI18n(
      <PanelShell {...panelProps({
        view: heldNoKey(), connected: false, now: 0, ...VERBS,
        onSetAside, onFileAway, onRepair: () => {},
      })}
      />,
    );
    fireEvent.click(getByTestId('resume-set-aside'));
    expect(onSetAside.mock.calls).toEqual([[1]]);
    expect(onFileAway.mock.calls).toEqual([]);
  });

  it('shows an ABORTED job rather than the dreaming office', () => {
    const { getByTestId, queryByTestId } = renderWithI18n(
      <PanelShell {...panelProps({ view: abortedNoKey(), connected: false, now: 0, ...VERBS, onRepair: () => {} })} />,
    );
    expect(queryByTestId('dream-office')).toBeNull();
    expect(getByTestId('resume-card')).toBeTruthy();
    expect(getByTestId('banner').getAttribute('data-cls')).toBe('key-cleared');
  });

  /** The loop notices an abort only at its next await, so every in-flight phase is reachable with no
   *  key; the job is still running, so the live ticket is the record. */
  it.each(['thinking', 'streaming', 'executing', 'gated', 'retrying', 'pausing'] as const)(
    'shows the live ticket rather than the dreaming office while %s with no key',
    (phase) => {
      const view = makeView({ phase, current: makeJob({}) });
      const { getByTestId, queryByTestId } = renderWithI18n(
        <PanelShell {...panelProps({ view, connected: false, now: 0, ...VERBS, onRepair: () => {} })} />,
      );
      expect(queryByTestId('dream-office')).toBeNull();
      expect(getByTestId('job-ticket')).toBeTruthy();
      expect(queryByTestId('resume-card')).toBeNull();
    },
  );

  /** Each card renders correctly alone; only the panel can show it does not stand both for one order. */
  it('stands exactly one card for one job, and the offer is the one that stands', () => {
    const { getByTestId, queryByTestId } = renderWithI18n(
      <PanelShell {...panelProps({ view: abortedNoKey(), connected: false, now: 0, ...VERBS, onRepair: () => {} })} />,
    );
    expect(getByTestId('resume-card')).toBeTruthy();
    expect(queryByTestId('stop-card'), 'the settled card is the offer, said once').toBeNull();
    // With a key held the same view is an ordinary stopped job.
    cleanup();
    const withKey = renderWithI18n(
      <PanelShell {...panelProps({ view: abortedNoKey(), connected: true, now: 0, ...VERBS, onRepair: () => {} })} />,
    );
    expect(withKey.getByTestId('stop-card')).toBeTruthy();
    expect(withKey.queryByTestId('resume-card')).toBeNull();
  });

  /** In the in-flight window the abort is requested but has not landed, so no completed tense. */
  it('says the stop is still happening while the job is still in flight', () => {
    const live = renderWithI18n(
      <PanelShell {...panelProps({
        view: makeView({ phase: 'thinking', current: makeJob({}) }),
        connected: false, now: 0, ...VERBS, onRepair: () => {},
      })}
      />,
    );
    expect(live.getByTestId('banner').getAttribute('data-cls')).toBe('key-clearing');
    expect(live.getByTestId('banner').textContent).toContain(t('agent.banner_key_clearing'));
    cleanup();
    const settled = renderWithI18n(
      <PanelShell {...panelProps({ view: abortedNoKey(), connected: false, now: 0, ...VERBS, onRepair: () => {} })} />,
    );
    expect(settled.getByTestId('banner').getAttribute('data-cls')).toBe('key-cleared');
  });

  it('returns to the dreaming office once the held job has been filed', () => {
    const { queryByTestId } = renderWithI18n(
      <PanelShell {...panelProps({
        view: abortedNoKey(), connected: false, now: 0, ...VERBS,
        filed: new Set([1]), onRepair: () => {},
      })}
      />,
    );
    expect(queryByTestId('dream-office')).toBeTruthy();
  });

  it('keeps the dreaming office for a session with no job at all', () => {
    const { queryByTestId } = renderWithI18n(
      <PanelShell {...panelProps({ view: makeView(), connected: false, now: 0, ...VERBS })} />,
    );
    expect(queryByTestId('dream-office')).toBeTruthy();
  });
});

describe('PanelShell: the storage warnings', () => {
  it('stands the full-storage notice over the live ticket and leaves the run alone', () => {
    const { getByTestId } = renderWithI18n(
      <PanelShell {...panelProps({
        view: makeView({ phase: 'executing', current: makeJob() }),
        connected: true, now: 0, ...VERBS,
        storageNotice: "lost",
        onDismissStorage: () => {},
      })}
      />,
    );
    expect(getByTestId('banner').getAttribute('data-cls')).toBe('storage-full');
    expect(getByTestId('job-ticket')).toBeTruthy();
  });

  it('routes the corrupt notice\'s two verbs to their two different answers', () => {
    const onDismissStorage = vi.fn();
    const onRepair = vi.fn();
    const { getByTestId } = renderWithI18n(
      <PanelShell {...panelProps({
        view: makeView(), connected: true, now: 0, ...VERBS,
        storageNotice: "corrupt",
        onDismissStorage,
        onRepair,
      })}
      />,
    );
    fireEvent.click(getByTestId('banner').querySelector('[data-action="export-log"]')!);
    expect(onRepair.mock.calls).toEqual([['export-log']]);
    expect(onDismissStorage.mock.calls.length, 'exporting leaves the notice standing').toBe(0);

    fireEvent.click(getByTestId('banner').querySelector('[data-action="dismiss"]')!);
    expect(onDismissStorage.mock.calls.length).toBe(1);
  });

  /** Dismissing `lost` or `pruned` demotes rather than unmounts, so the record does not shorten under
   *  the press, and the store's fact survives it. */
  it('demotes the lost notice instead of unmounting it', () => {
    const onDismissStorage = vi.fn();
    const { getByTestId } = renderWithI18n(
      <PanelShell {...panelProps({
        view: makeView({ phase: 'executing', current: makeJob() }),
        connected: true, now: 0, ...VERBS,
        storageNotice: "lost",
        onDismissStorage,
      })}
      />,
    );
    fireEvent.click(getByTestId('banner').querySelector('[data-action="dismiss"]')!);
    const banner = getByTestId('banner');
    expect(banner.getAttribute('data-cls')).toBe('storage-full');
    expect(banner.getAttribute('data-standing')).toBe('true');
    expect(onDismissStorage, 'the fact stays true; only the local read-mark changes').not.toHaveBeenCalled();
    expect(getByTestId('job-ticket'), 'the record beneath is untouched').toBeTruthy();
  });

  it('stands alone, with the idle dressing withheld', () => {
    const { queryByTestId } = renderWithI18n(
      <PanelShell {...panelProps({
        view: makeView(), connected: true, now: 0, ...VERBS,
        storageNotice: "corrupt",
        onDismissStorage: () => {},
        sketchbook: <div data-testid="sketchbook" />,
      })}
      />,
    );
    expect(queryByTestId('sketchbook')).toBeNull();
  });
});

describe('PanelShell: the holds keep their verbs', () => {
  it('stands the hold\'s controls after the ask that produced it', () => {
    const gateDenied = makeView({
      phase: 'paused',
      current: makeJob({
        asks: [{ gateId: 'g1', scope: 'tool', summary: 'Pave a stone road from the plaza to the mill', verdict: 'declined' }],
      }),
    });
    const { getByTestId } = renderWithI18n(
      <PanelShell {...panelProps({ view: gateDenied, connected: true, now: 0, ...VERBS, onResume: () => {} })} />,
    );
    const hold = getByTestId('hold-actions');
    const ask = getByTestId('gate-block');
    expect(ask.compareDocumentPosition(hold) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(getByTestId('hold-resume')).toBeTruthy();
    expect(getByTestId('hold-stop')).toBeTruthy();
  });

  it('keeps them at the ticket\'s foot where no ask produced the hold', () => {
    const { getByTestId, queryByTestId } = renderWithI18n(
      <PanelShell {...panelProps({
        view: makeView({ phase: 'paused', current: makeJob() }),
        connected: true, now: 0, ...VERBS, onResume: () => {},
      })}
      />,
    );
    expect(getByTestId('ticket-resume')).toBeTruthy();
    expect(queryByTestId('hold-actions')).toBeNull();
  });

  it('offers no pause on either hold surface', () => {
    const { getByTestId } = renderWithI18n(
      <PanelShell {...panelProps({
        view: makeView({ phase: 'paused', current: makeJob() }),
        connected: true, now: 0, ...VERBS, onResume: () => {},
      })}
      />,
    );
    const foot = getByTestId('ticket-actions');
    expect(foot.textContent).not.toContain(t('agent.dock_pause_at_step'));
  });

  /** Every control in the row is pressed, since a pill under any other name could reach the pause. */
  it('reaches no pause verb from any control in the hold-actions row', () => {
    const onPause = vi.fn();
    const gateDenied = makeView({
      phase: 'paused',
      current: makeJob({
        asks: [{ gateId: 'g1', scope: 'tool', summary: 'Pave a stone road from the plaza to the mill', verdict: 'declined' }],
      }),
    });
    const props = { ...VERBS, onPause, onResume: () => {} };
    const buttons = () => [...document.querySelectorAll('[data-testid="hold-actions"] button')];

    const first = renderWithI18n(<PanelShell {...panelProps({ view: gateDenied, connected: true, now: 0, ...props })} />);
    const count = buttons().length;
    const words = first.getByTestId('hold-actions').textContent ?? '';
    expect(count, 'nothing was pressed, so nothing is proven').toBeGreaterThan(0);
    first.unmount();

    // One press per mount, since a press can take another control away; whatever it reveals is
    // pressed too.
    for (let i = 0; i < count; i++) {
      const view = renderWithI18n(<PanelShell {...panelProps({ view: gateDenied, connected: true, now: 0, ...props })} />);
      fireEvent.click(buttons()[i]!);
      for (const revealed of buttons()) fireEvent.click(revealed);
      view.unmount();
    }
    expect(onPause, 'a control in the hold-actions row reached the pause verb').not.toHaveBeenCalled();
    expect(/\bpause\b/i.test(words), words).toBe(false);
  });

});

describe('PanelShell: the resume offer', () => {
  const restored = () => makeView({ phase: 'paused', current: makeJob({ plan: {
    stages: [{ label: 'a' }, { label: 'b' }, { label: 'c' }, { label: 'd' }],
    currentIndex: 1, doneCount: 2, revision: 1,
  } }) });

  /** A restored paused job is an offer: the live ticket's dress would say a run is under way. */
  it('offers the restored job as a card rather than as a live ticket', () => {
    const { getByTestId, queryByTestId } = renderWithI18n(
      <PanelShell {...panelProps({ view: restored(), connected: true, now: 0, ...VERBS, restored: true, onResume: () => {}, onFileAway: () => {} })} />,
    );
    expect(getByTestId('resume-card')).toBeTruthy();
    expect(queryByTestId('job-ticket')).toBeNull();
    expect(getByTestId('resume-pausemark').textContent).toContain(t('agent.ticket_paused_after', { n: 2, m: 4 }));
  });

  it('resumes on the card\'s own press', () => {
    const onResume = vi.fn();
    const { getByTestId } = renderWithI18n(
      <PanelShell {...panelProps({ view: restored(), connected: true, now: 0, ...VERBS, restored: true, onResume, onFileAway: () => {} })} />,
    );
    fireEvent.click(getByTestId('resume-resume'));
    expect(onResume.mock.calls.length).toBe(1);
  });

  it('files the offer away rather than dropping it', () => {
    const onSetAside = vi.fn();
    const { getByTestId } = renderWithI18n(
      <PanelShell {...panelProps({
        view: restored(), connected: true, now: 0, ...VERBS,
        restored: true, onResume: () => {}, onFileAway: () => {}, onSetAside,
      })}
      />,
    );
    fireEvent.click(getByTestId('resume-set-aside'));
    expect(onSetAside.mock.calls).toEqual([[1]]);
  });

  it('is not the face a live pause wears', () => {
    const { getByTestId, queryByTestId } = renderWithI18n(
      <PanelShell {...panelProps({ view: restored(), connected: true, now: 0, ...VERBS, onResume: () => {} })} />,
    );
    expect(queryByTestId('resume-card')).toBeNull();
    expect(getByTestId('job-ticket')).toBeTruthy();
  });
});
