// @vitest-environment jsdom
/** Fault and hold behavior. Repair controls render only when wired, dismissed faults remain as
 * muted notices, setting a job aside files it, and an unavailable resume action is not shown. */
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
import { ACTIVE, INK, PLATE, TRACK } from '../../../ui/design/tokens';
import { mixHex } from '../../../ui/design/styles';
import { statePaper } from '../../../ui/agent/panel-skin';
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

/** Pushes a colour through the same DOM round-trip on both sides of a comparison, since jsdom's
 *  cssstyle can normalize a hex differently from a var()-free literal though the two agree in
 *  meaning (matches `desk-header.test.tsx`'s own `asBackground`). */
function asBackground(value: string): string {
  const probe = document.createElement('span');
  probe.style.background = value;
  return probe.style.background;
}

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

/* ── the banner's own table ───────────────────────────────── */

describe('Banner: what each trouble offers', () => {
  it('gives every actionable class a repair pill, and never more than two', () => {
    for (const cls of BANNER_CLASSES) {
      const { getByTestId, unmount } = renderWithI18n(<Banner cls={cls} onAction={() => {}} />);
      const list = actions(getByTestId('banner'));
      expect(list.length, cls).toBeLessThanOrEqual(2);
      unmount();
    }
  });

  /** Each actionable fault maps to the repair id the panel routes. */
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

  /** The corrupt notice's dismiss is a discard: the set-aside bytes go with it, and the word says so
   *  rather than borrowing the storage banner's "put this away". */
  it('words the corrupt notice\'s dismiss as a discard', () => {
    const { getByTestId } = renderWithI18n(<Banner cls="storage-corrupt" onAction={() => {}} />);
    const dismiss = getByTestId('banner').querySelector('[data-action="dismiss"]')!;
    expect(dismiss.textContent).toBe(t('agent.banner_action_discard'));
  });

  /* The third dress. Terminal is the danger paper, recover the wait paper, and a dismissed fault
     demotes to the muted inset strip — quieter, but not gone. */
  it('demotes to the standing strip, keeping the sentence and dropping only the dismissal', () => {
    const loud = renderWithI18n(<Banner cls="auth" onAction={() => {}} />);
    expect(loud.getByTestId('banner').getAttribute('data-standing')).toBeNull();
    expect(actions(loud.getByTestId('banner'))).toEqual(['fix-key', 'set-aside']);
    loud.unmount();

    const { getByTestId } = renderWithI18n(<Banner cls="auth" standing onAction={() => {}} />);
    const strip = getByTestId('banner');
    expect(strip.getAttribute('data-standing')).toBe('true');
    expect(strip.textContent).toContain(t('agent.banner_auth'));
    // The repair survives the demotion; the answered verb does not.
    expect(actions(strip)).toEqual(['fix-key']);
  });

  /** A repair-less class has nothing left once the put-down filter runs, so it must keep its one
   *  pill standing rather than collapse the row: the banner's height may not change just because
   *  its only action was the one that got answered. */
  it('keeps its one pill standing, for a class with no repair to fall back on', () => {
    for (const cls of ['storage-pruned', 'storage-full'] as const) {
      const { getByTestId, unmount } = renderWithI18n(<Banner cls={cls} standing onAction={() => {}} />);
      expect(actions(getByTestId('banner')), cls).toEqual(['dismiss']);
      unmount();
    }
  });
});

/* ── the outline every card on the plate owes ─────────────── */

/**
 * A card that lost its hairline. `tokens.ts:edge` is the whole border shorthand, so
 * `1px solid ${edge}` emits one invalid declaration the engine drops silently, and the card ships
 * with no outline. The resolved border is asserted, since the string is what looked right.
 */
function expectOutlined(el: HTMLElement, at: string): void {
  expect(el.style.borderTopStyle, `${at}: border-style`).toBe('solid');
  expect(el.style.borderTopWidth, `${at}: border-width`).toBe('1px');
  expect(el.style.borderTopColor, `${at}: border-colour`).not.toBe('');
}

describe('every card on the plate draws its outline', () => {
  it('outlines the resume offer, in both faces', () => {
    const offered = renderWithI18n(<ResumeCard order="Terrace the hill" onResume={() => {}} />);
    expectOutlined(offered.getByTestId('resume-card'), 'resume offer');
    offered.unmount();

    const blocked = renderWithI18n(<ResumeCard order="Terrace the hill" blocked="the key went away" />);
    expectOutlined(blocked.getByTestId('resume-card'), 'blocked offer');
  });

  it('outlines every banner dress, loud and demoted alike', () => {
    for (const cls of BANNER_CLASSES) {
      for (const standing of [false, true]) {
        const { getByTestId, unmount } = renderWithI18n(
          <Banner cls={cls} {...(standing ? { standing: true } : {})} onAction={() => {}} />,
        );
        expectOutlined(getByTestId('banner'), `${cls}${standing ? ' (standing)' : ''}`);
        unmount();
      }
    }
  });
});

/* ── the resume card ──────────────────────────────────────── */

describe('ResumeCard: a held job offered back', () => {
  it('stands on a plain wait-tinted paper every engine can paint', () => {
    // `color-mix()` arrived in Chrome 111; an engine without it drops the declaration and the card
    // loses its tint entirely, so the mix is computed here.
    const { getByTestId } = renderWithI18n(<ResumeCard order="Terrace the hill" onResume={() => {}} />);
    const rgbOf = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
    expect(getByTestId('resume-card').style.background).toBe(rgbOf(mixHex(statePaper.wait, PLATE, 0.42)));
  });

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

  /**
   * The one negative this card exists for. A hold that cannot be lifted offers no Resume: the reason
   * line plus the repair are the whole card, and a control that would refuse the press is worse than
   * no control at all.
   */
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

  /** A hold surface may never offer a pause: the loop honours one only at a call boundary, and a
   *  job that is already held has no boundary coming, so the press would deadlock the surface. */
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

  /** Held-job actions use the standard primary and quiet fills, not the attention color for asks. */
  it('paints Resume and Fix key with the dark ink primary, never the ask colour', () => {
    const resuming = renderWithI18n(
      <ResumeCard order="Plant a forest along the ridge" onResume={() => {}} onSetAside={() => {}} />,
    );
    expect(asBackground(resuming.getByTestId('resume-resume').style.background)).toBe(asBackground(INK));
    expect(asBackground(resuming.getByTestId('resume-set-aside').style.background)).toBe(asBackground(PLATE));
    resuming.unmount();

    const blocked = renderWithI18n(
      <ResumeCard
        order="Plant a forest along the ridge"
        blocked="The job ended when the key was cleared. A new order picks up the work."
        onResume={() => {}}
        onFixKey={() => {}}
        onSetAside={() => {}}
      />,
    );
    expect(asBackground(blocked.getByTestId('resume-fix-key').style.background)).toBe(asBackground(INK));
    expect(asBackground(blocked.getByTestId('resume-fix-key').style.background)).not.toBe(asBackground(ACTIVE));
  });
});

/* ── the panel's own wiring ───────────────────────────────── */

describe('PanelShell: a fault names its repair and the repair acts', () => {
  /** The incident card preserves order context and progress; repair actions belong to the banner. */
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
    // The card retains its stalled progress, step count, and stamps.
    expect(card.querySelector('[data-testid="tape-bar"]')).not.toBeNull();
    expect(card.querySelector('[data-testid="ops-count-pill"]')!.textContent).toBe('64 steps, last 0');
    expect(card.textContent).toContain(t('agent.stamp_compaction'));
    // And no second set of answers beside the banner's own.
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

  /**
   * Escape invariant 2. Set-aside files the record — it never drops the job, and it never lands the
   * panel on the disconnected rest while a key is held.
   */
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
    // Still the connected panel: no setup screen, no dreaming office.
    expect(queryByTestId('setup-screen')).toBeNull();
    expect(queryByTestId('dream-office')).toBeNull();
  });

  /** `new-order` points at the composer this file's own child owns, so it is answered here. */
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
 * The model the endpoint will not serve, which is the address's neighbour and not the address.
 *
 * The host answered, so another attempt sends the same model again and re-entering the URL changes
 * nothing: the one repair is the model row, and that row lives behind the gear. So the sentence names
 * the model (a nine-provider panel that can arm any typed id says nothing useful with "the model is
 * unavailable"), the act is the settings card, and the press travels to the caller that owns it.
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
    // No retry offered at all: the next attempt would name the same model.
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
    // The panel names the armed model in the sentence it renders, not just in an isolated Banner.
    expect(getByTestId('banner').textContent).toContain('Claude Sonnet 4.5');
    fireEvent.click(getByTestId('banner').querySelector('[data-action="edit-model"]')!);
    expect(onRepair.mock.calls).toEqual([['edit-model']]);
    // And it does not answer the press with the connection screen, which repairs the wrong field.
    expect(getByTestId('panel-shell').querySelector('[data-testid="setup-screen"]')).toBeNull();
  });
});

describe('PanelShell: the OFF composer says the one instruction', () => {
  /** A fault the user must repair first turns the field off and puts the repair in its placeholder,
   *  so the composer is not an invitation the panel cannot honour. */
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

  /** A disabled composer stays fully legible because its placeholder communicates the repair. */
  it('says the refusal with the tokens, never with a fade', () => {
    const { getByTestId } = renderWithI18n(
      <PanelShell {...panelProps({ view: incidentView('cors'), connected: true, now: 0, ...VERBS })} />,
    );
    // No fade anywhere in the group: not on the box, not on the field, not on the send.
    for (const id of ['composer', 'composer-send']) {
      const fade = getByTestId(id).style.opacity;
      expect(fade === '' || fade === '1', `${id} opacity ${fade}`).toBe(true);
    }
    expect(getByTestId('composer-well').style.background).toBe(asBackground(TRACK));
    expect(getByTestId('composer-send').style.background).toBe(asBackground(TRACK));
    // And the refusal is real, per control: a fault leaves the well reachable (the region frame is a
    // live verb here), so the two that cannot act say so themselves.
    expect((getByTestId('composer-input') as HTMLInputElement).disabled).toBe(true);
    expect((getByTestId('composer-send') as HTMLButtonElement).disabled).toBe(true);
    expect(getByTestId('composer').style.pointerEvents).toBe('');
  });

  /** Dismissing the notice is the user saying they have read it, and the field comes back: a
   *  demoted strip that kept the composer off would be a fault with no way past it. */
  it('gives the field back once the fault is demoted', () => {
    const { getByTestId } = renderWithI18n(
      <PanelShell {...panelProps({ view: incidentView('rate-limit'), connected: true, now: 0, ...VERBS, onRepair: () => {} })} />,
    );
    expect((getByTestId('composer-input') as HTMLInputElement).disabled).toBe(true);
    // `rate-limit` puts itself down by filing the job rather than by a bare dismissal, and both
    // demote: this is the same press the standing strip is reached by.
    fireEvent.click(getByTestId('banner').querySelector('[data-action="set-aside"]')!);
    expect((getByTestId('composer-input') as HTMLInputElement).disabled).toBe(false);
  });
});

describe('PanelShell: the key that went away', () => {
  const keyCleared = () => incidentView('auth');

  /** A keyless panel is the dreaming office — except where a job is standing that stopped because
   *  the key went away. That job is the screen's news, and dreaming over it would lose it. */
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
    // No key is held, so nothing is dropped: the panel opens the field itself.
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
   * The auth incident is one entrance of three, and the other two are the ones a user reaches by
   * revoking a key themselves: a job paused when the credential went (nothing was in flight, so the
   * abort settled nothing and the phase stands at `paused`) and a job aborted by that revoke.
   * Unnamed, both fall through to the dreaming office — a session with partial edits on the map,
   * its rewind unreachable, behind a screen reading "No key yet, so I sleep and dream of orders".
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
    // No Resume: it would need the key that is gone. The repair is the card's own.
    expect(queryByTestId('resume-resume')).toBeNull();
    expect(getByTestId('resume-fix-key')).toBeTruthy();
  });

  /** A job still in the seat has to be settled before it is filed, which is what `onSetAside` does
   *  and `onFileAway` cannot: filing a paused job would leave the session holding a hold nothing is
   *  showing. (The settled entrances keep filing — see the auth case above.) */
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

  /** The abort is asynchronous: the loop notices at its next await, a whole streaming response or
   *  tool call away, so every in-flight phase is reachable with no key. There the job is not an
   *  Offer — it is still running — so the live ticket is the record, and dreaming over it was the
   *  worst of the three faces. */
  it.each(['thinking', 'streaming', 'executing', 'gated', 'retrying', 'pausing'] as const)(
    'shows the live ticket rather than the dreaming office while %s with no key',
    (phase) => {
      const view = makeView({ phase, current: makeJob({}) });
      const { getByTestId, queryByTestId } = renderWithI18n(
        <PanelShell {...panelProps({ view, connected: false, now: 0, ...VERBS, onRepair: () => {} })} />,
      );
      expect(queryByTestId('dream-office')).toBeNull();
      expect(getByTestId('job-ticket')).toBeTruthy();
      // Not an offer card: a job the loop still has cannot be "resumed", only stopped.
      expect(queryByTestId('resume-card')).toBeNull();
    },
  );

  /**
   * One job, one card, and this is the pair no component suite can see: `ResumeCard` and the stop
   * card each render correctly on their own, and the zone stood both for the same order — a resume
   * card reading "paused at the step boundary" over a stop card reading "Stopped by you", neither
   * true of a job the key ended, with two ways to put it away and the rewind on only one.
   */
  it('stands exactly one card for one job, and the offer is the one that stands', () => {
    const { getByTestId, queryByTestId } = renderWithI18n(
      <PanelShell {...panelProps({ view: abortedNoKey(), connected: false, now: 0, ...VERBS, onRepair: () => {} })} />,
    );
    expect(getByTestId('resume-card')).toBeTruthy();
    expect(queryByTestId('stop-card'), 'the settled card is the offer, said once').toBeNull();
    // Control: with a key held the same view is an ordinary stopped job, and the stop card is it.
    cleanup();
    const withKey = renderWithI18n(
      <PanelShell {...panelProps({ view: abortedNoKey(), connected: true, now: 0, ...VERBS, onRepair: () => {} })} />,
    );
    expect(withKey.getByTestId('stop-card')).toBeTruthy();
    expect(withKey.queryByTestId('resume-card')).toBeNull();
  });

  /**
   * The banner may not report a completed stop over a running job. In the in-flight window above,
   * the abort has been requested and has not landed — the ticket is live and the dock offers Stop —
   * so "the job stopped at the end of the step" is a completed tense over an unfinished fact.
   */
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
    // And the settled reading is unchanged: there the stop has happened.
    const settled = renderWithI18n(
      <PanelShell {...panelProps({ view: abortedNoKey(), connected: false, now: 0, ...VERBS, onRepair: () => {} })} />,
    );
    expect(settled.getByTestId('banner').getAttribute('data-cls')).toBe('key-cleared');
  });

  /** A job the user has already put away owes them nothing, so the rest comes back. */
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

  /** A session that never ran anything is the plain keyless rest, and must stay it. */
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

  /** The house rule binds the storage notice too: dismissing `lost`/`pruned` demotes rather than
   *  unmounting, so the record does not shorten under the very press that answered it, and the
   *  store's own fact survives the press. */
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

  /** Nothing competes with a standing warning: the banner and its two verbs are the whole content,
   *  so the rest state's own dressing waits until it has been answered. */
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
  /** Hold controls follow the card that explains why the job stopped. */
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

  /** With no card between the ticket and the hold, the ticket's own foot is where they belong. */
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

  /** N4, armed: neither hold surface may offer a pause. */
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

  /**
   * And the guard is the verb, not the testid (mirroring `manage.test.tsx`'s own sweep). A deadlock
   * is a class of control rather than one named button: a second pill
   * offered under any other name, wired to the same pause, ships past an assertion that only looks
   * for `hold-resume`/`hold-stop`. So every control the `hold-actions` row renders over a gate-denied
   * hold is pressed, and the pause verb must never be reached from any of them.
   */
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

    // One press per mount (a press can take another control away with it), and whatever a press
    // Reveals is pressed too, in that same mount.
    for (let i = 0; i < count; i++) {
      const view = renderWithI18n(<PanelShell {...panelProps({ view: gateDenied, connected: true, now: 0, ...props })} />);
      fireEvent.click(buttons()[i]!);
      for (const revealed of buttons()) fireEvent.click(revealed);
      view.unmount();
    }
    expect(onPause, 'a control in the hold-actions row reached the pause verb').not.toHaveBeenCalled();
    expect(/\bpause\b/i.test(words), words).toBe(false);
  });

  /**
   * One verb, two sites, one paint. Resume on a hold is an action on a held job rather than the
   * dock's "this needs you" ask, so it takes the dark ink primary and never the amber `active` pill
   * — the ruling `JobTicket`'s `TICKET_RESUME` and `ResumeCard` already state. The hold after an ask
   * is the commonest hold there is (a skipped gate is what produces most of them), so both sites
   * are pinned here.
   */
  it.each([
    ['at the ticket\'s foot', 'ticket-resume', makeView({ phase: 'paused', current: makeJob() })],
    ['after the ask that produced the hold', 'hold-resume', makeView({
      phase: 'paused',
      current: makeJob({
        asks: [{ gateId: 'g1', scope: 'tool', summary: 'Pave a road to the mill', verdict: 'declined' }],
      }),
    })],
  ] as const)('paints the hold\'s Resume with the primary ink %s', (_where, testId, view) => {
    const { getByTestId } = renderWithI18n(
      <PanelShell {...panelProps({ view, connected: true, now: 0, ...VERBS, onResume: () => {} })} />,
    );
    const paint = asBackground(getByTestId(testId).style.background);
    expect(paint).toBe(asBackground(INK));
    expect(paint).not.toBe(asBackground(ACTIVE));
    expect(asBackground(getByTestId(testId).style.color)).toBe(asBackground(PLATE));
  });
});

describe('PanelShell: the resume offer', () => {
  const restored = () => makeView({ phase: 'paused', current: makeJob({ plan: {
    stages: [{ label: 'a' }, { label: 'b' }, { label: 'c' }, { label: 'd' }],
    currentIndex: 1, doneCount: 2, revision: 1,
  } }) });

  /** A session that came back holding a paused job is an offer, not a hold the user is standing in:
   *  the card is compact, the two answers are "Resume" and "For later", and the ticket's live dress
   *  (which says a run is under way) is not what a restored session should wear. */
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

  /** “For later” files the offer without deleting its record. */
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

  /** The same phase, standing live rather than restored, is the hold — not the offer. */
  it('is not the face a live pause wears', () => {
    const { getByTestId, queryByTestId } = renderWithI18n(
      <PanelShell {...panelProps({ view: restored(), connected: true, now: 0, ...VERBS, onResume: () => {} })} />,
    );
    expect(queryByTestId('resume-card')).toBeNull();
    expect(getByTestId('job-ticket')).toBeTruthy();
  });
});
