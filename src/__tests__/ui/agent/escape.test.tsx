/** Exit behavior across panel states. Collapse is unconditional, automatic transitions never open
 * the panel, the folded overlay leaves the map interactive, and Back restores the preceding view.
 * Escape closes only the highest open layer on each press. */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readFileSync, readdirSync, statSync } from 'node:fs';

import { append } from '../../../agent/core/log';
import { useAgentSession } from '../../../agent/session/store';
import { PROVIDER_IDS, type ProviderId } from '../../../agent/providers/defaults';
import type { PanelView } from '../../../agent/core/project-view';
import { I18nProvider } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { TOUR_SEEN_KEY } from '../../../ui/chrome/tour/use-tour';
import { PanelShell } from '../../../ui/agent/PanelShell';
import { useAgentPanelSettings } from '../../../ui/agent/settings';
import { Shell } from '../../../ui/shell/Shell';

const backing = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => void backing.set(k, String(v)),
    removeItem: (k: string) => void backing.delete(k),
    clear: () => backing.clear(),
  },
});

/* ── the three states, as the fidelity rig names them ─────── */

function baseView(over: Partial<PanelView> = {}): PanelView {
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

const job = (over = {}) => ({
  orderSeq: 1, orderText: 'build a village', orderAt: 0,
  asks: [], ops: [], steerNotes: [], checkpoints: [], stamps: [], celebrate: false, skills: [],
  ...over,
});

/**
 * `setup.key-entry`, `run.gate` and `error.auth` as the panel sees them: the three states Escape has
 * to fold from, each of which owns the keyboard for something else.
 *
 * `setup.key-entry`'s `connected: false` alone lands on the keyless REST (`DreamOffice`), not the
 * key form this id names: Connect stands between the two. `renderPanel` presses it through, so the
 * fixture stands the form itself.
 */
const STATES: Record<string, { view: PanelView; connected: boolean }> = {
  'setup.key-entry': { view: baseView(), connected: false },
  'run.gate': {
    view: baseView({
      phase: 'gated',
      current: job(),
      gate: { gateId: 'g1', scope: 'tool', summary: 'lay the boardwalk, 86 cells' },
    }),
    connected: true,
  },
  'error.auth': {
    view: baseView({ phase: 'incident', jobs: [job({ outcome: 'incident', errorCls: 'auth' })] }),
    connected: true,
  },
};

/** The same three seeded into the REAL stores, for the Shell-level half. */
function seedStore(id: string): void {
  const model = Object.fromEntries(PROVIDER_IDS.map((p) => [p, ''])) as Record<ProviderId, string>;
  model.claude = 'claude-sonnet-4-5';
  useAgentPanelSettings.setState({
    provider: 'claude', model, oversight: 'checkpoint', customBaseUrl: '',
    keyed: id === 'setup.key-entry' ? [] : ['claude'], hydrated: true,
  });
  const log = useAgentSession.getState().log;
  if (id === 'run.gate') {
    append(log, { kind: 'order', text: 'build a village', mapContext: '' });
    append(log, {
      kind: 'gateAsked', gateId: 'g1', scope: 'tool', summary: 'lay the boardwalk, 86 cells',
    });
  }
  if (id === 'error.auth') {
    append(log, { kind: 'order', text: 'build a village', mapContext: '' });
    append(log, { kind: 'incident', error: { cls: 'auth', detail: 'refused (401)' } });
  }
}

const VERBS = { onSend: () => {}, onStop: () => {}, onPause: () => {}, onGateAnswer: () => {} };

function renderPanel(id: string, onCollapse: () => void) {
  const { view, connected } = STATES[id]!;
  const view_ = render(
    <MotionConfig reducedMotion="always">
      <I18nProvider>
        <PanelShell view={view} connected={connected} now={0} onCollapse={onCollapse} {...VERBS} />
      </I18nProvider>
    </MotionConfig>,
  );
  // Credential entry follows the disconnected rest, so the fixture presses Connect to reach it.
  if (id === 'setup.key-entry') fireEvent.click(view_.getByTestId('dream-connect'));
  return view_;
}

function mountShell() {
  return render(
    <I18nProvider>
      <Shell onRestoreSession={() => {}}><div data-testid="map-views" /></Shell>
    </I18nProvider>,
  );
}

/** The panel is a lazy chunk, and here `import()` COMPILES the assistant graph rather than fetching
 *  a built one. Paid once, before anything below is timed (`assistant-entrance.test.tsx` makes the
 *  same argument at greater length). */
beforeAll(async () => {
  backing.set(TOUR_SEEN_KEY, '1');
  useEditorStore.setState({ locale: 'en', assistantOpen: true });
  mountShell();
  await screen.findByTestId('shell-assistant-panel', undefined, { timeout: 30_000 });
  cleanup();
}, 40_000);

beforeEach(() => {
  backing.clear();
  backing.set(TOUR_SEEN_KEY, '1');
  useEditorStore.setState({ locale: 'en', assistantOpen: true });
  useAgentSession.getState().clearSession();
});

afterEach(cleanup);

describe('the collapse control never reads session state', () => {
  /** Every panel state can return to the map in one press. */
  it('folds the panel from setup, from an open gate and from a refused key alike', async () => {
    for (const id of Object.keys(STATES)) {
      seedStore(id);
      useEditorStore.setState({ assistantOpen: true });
      mountShell();
      await screen.findByTestId('shell-assistant-panel', undefined, { timeout: 30_000 });

      fireEvent.click(screen.getByTestId('entrance-plate-anchor'));
      expect(useEditorStore.getState().assistantOpen, id).toBe(false);

      // And back in, from the same press: the parked character is the standing way back.
      fireEvent.click(screen.getByTestId('entrance-plate-anchor'));
      expect(useEditorStore.getState().assistantOpen, id).toBe(true);

      cleanup();
      useAgentSession.getState().clearSession();
    }
  }, 40_000);

  it('answers Escape with the collapse verb in every one of the three', () => {
    for (const id of Object.keys(STATES)) {
      const folded: number[] = [];
      const view = renderPanel(id, () => folded.push(1));
      fireEvent.keyDown(view.getByTestId('panel-shell'), { key: 'Escape' });
      expect(folded, id).toEqual([1]);
      view.unmount();
    }
  });

  /**
   * THE FORM ITSELF, standing genuinely rather than assumed: `renderPanel` walks the disconnected
   * desk through Connect for `setup.key-entry`, and this is the tripwire that proves it landed
   * there rather than on the keyless rest the walk starts from — without it a fixture whose id says
   * "setup" tests the welcome screen. Escape folds from the form like every other surface here.
   */
  it('genuinely stands the key form, and folds from it', () => {
    const folded: number[] = [];
    const view = renderPanel('setup.key-entry', () => folded.push(1));
    expect(view.getByTestId('setup-screen'), 'the form, not the keyless rest it is walked in from').toBeTruthy();
    fireEvent.keyDown(view.getByTestId('panel-shell'), { key: 'Escape' });
    expect(folded).toEqual([1]);
    view.unmount();
  });

  /** And from the manage card, which is a fourth surface the job zone can be showing. */
  it('folds from the manage card too', () => {
    const folded: number[] = [];
    const view = render(
      <MotionConfig reducedMotion="always">
        <I18nProvider>
          <PanelShell
            view={baseView()}
            connected
            managing
            now={0}
            onCollapse={() => folded.push(1)}
            {...VERBS}
          />
        </I18nProvider>
      </MotionConfig>,
    );
    expect(view.getByTestId('manage-screen')).toBeTruthy();
    fireEvent.keyDown(view.getByTestId('panel-shell'), { key: 'Escape' });
    expect(folded).toEqual([1]);
  });

  /** And from an OPENED PAST RECORD, which is the fifth surface the job zone can be showing. Its
   *  own way out is Back; Escape is the way out of the panel, whatever is standing in it. */
  it('folds from an opened past record too', () => {
    const folded: number[] = [];
    const settled = job({ orderSeq: 7, outcome: 'done', kind: 'build' });
    const view = render(
      <MotionConfig reducedMotion="always">
        <I18nProvider>
          <PanelShell
            view={baseView({ jobs: [settled] })}
            connected
            filed={new Set([7])}
            openRecord={7}
            now={0}
            onCollapse={() => folded.push(1)}
            onCloseRecord={() => {}}
            {...VERBS}
          />
        </I18nProvider>
      </MotionConfig>,
    );
    // The record really is what the zone is showing, and the desk says so rather than claiming rest.
    expect(view.getByTestId('archive-card')).toBeTruthy();
    expect(view.getByTestId('dock-sentence').textContent).toContain('Reading a past job');
    fireEvent.keyDown(view.getByTestId('panel-shell'), { key: 'Escape' });
    expect(folded).toEqual([1]);
  });

  /**
   * A FOLD PUTS THE CARD AWAY WITH THE PANEL. `managing` lives in `PanelColumn` and nothing else
   * clears it, so a user who folded from the settings card came back to the settings card — a
   * surface they had already left, standing over the session they wanted.
   */
  it('does not bring the manage card back with the panel', async () => {
    seedStore('run.gate');
    useEditorStore.setState({ assistantOpen: true });
    mountShell();
    await screen.findByTestId('shell-assistant-panel', undefined, { timeout: 30_000 });

    fireEvent.click(screen.getByTestId('dock-gear'));
    expect(screen.getByTestId('manage-screen')).toBeTruthy();

    fireEvent.click(screen.getByTestId('entrance-plate-anchor'));
    expect(useEditorStore.getState().assistantOpen).toBe(false);
    fireEvent.click(screen.getByTestId('entrance-plate-anchor'));
    await screen.findByTestId('shell-assistant-panel', undefined, { timeout: 30_000 });

    expect(screen.queryByTestId('manage-screen'), 'the card the fold put away came back').toBeNull();
    // And the session it was standing over is the one that comes back (invariant 4).
    expect(screen.getByTestId('gate-block')).toBeTruthy();
  }, 40_000);

  /** Escape peels ONE layer per press: the composer's ghost first, then the field, and only a bare
   *  panel folds. Otherwise one press both cleared the field and put the panel away, which is two
   *  answers to one question. */
  it('lets the composer clear itself before the panel folds', () => {
    const folded: number[] = [];
    const view = render(
      <MotionConfig reducedMotion="always">
        <I18nProvider>
          <PanelShell
            view={baseView({ suggestion: 'Yes, add the bridge' })}
            connected
            now={0}
            onCollapse={() => folded.push(1)}
            {...VERBS}
          />
        </I18nProvider>
      </MotionConfig>,
    );
    const input = view.getByTestId('composer-input') as HTMLInputElement;

    // The ghost is standing: this press is the ghost's.
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(view.queryByTestId('composer-ghost')).toBeNull();
    expect(folded).toEqual([]);

    // Something typed: this press is the field's.
    fireEvent.change(input, { target: { value: 'pave the square' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('');
    expect(folded).toEqual([]);

    // Nothing left to clear: the panel folds.
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(folded).toEqual([1]);
  });
});

describe('a machine-initiated advance never writes the open flag', () => {
  /**
   * A SOURCE SCAN, because the defect is a WRITE that should not exist and no state of the app can
   * prove the absence of one. Exactly two files may move the flag: the store slice that owns it, and
   * the shell whose block the user presses. A probe timer, a retry settling or an arriving job
   * reaching for it would show up here as a third.
   */
  it('is written by the shell and the store slice only', () => {
    const walk = (dir: string): string[] => (readdirSync(dir) as string[]).flatMap((name) => {
      const full = `${dir}/${name}`;
      if (statSync(full).isDirectory()) return walk(full);
      return /\.tsx?$/.test(name) ? [full] : [];
    });
    const writers = walk('src')
      .filter((path) => !path.includes('/__tests__/'))
      .filter((path) => /setAssistantOpen|assistantOpen\s*:/.test(readFileSync(path, 'utf8')))
      .sort();
    expect(writers).toEqual([
      'src/state/slices/shell.ts',     // owns the flag, and persists nothing about it
      'src/ui/agent/PanelColumn.tsx',  // the panel's own Escape, and nothing else in the panel
      'src/ui/shell/Shell.tsx',        // the block the user presses, and the chip that reopens it
    ]);
  });

  it('leaves a collapsed panel collapsed while the session moves on underneath it', () => {
    vi.useFakeTimers();
    try {
      useEditorStore.setState({ assistantOpen: false });
      mountShell();
      const log = useAgentSession.getState().log;

      act(() => {
        append(log, { kind: 'order', text: 'build a village', mapContext: '' });
        append(log, { kind: 'retry', attempt: 1, cls: 'rate-limit', delayMs: 2000 });
        vi.advanceTimersByTime(5_000);
        append(log, { kind: 'jobEnd', outcome: 'done' });
        vi.advanceTimersByTime(5_000);
      });

      expect(useEditorStore.getState().assistantOpen).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('pointer containment', () => {
  /** The character stands in a layer of its own over the whole window, so the layer itself must be
   *  pointer-deaf: anything else makes a 0-size overlay swallow presses meant for the map (and for
   *  the entrance button directly underneath). */
  it('gives the character layer no pointer events, and the chip alone takes them back', () => {
    useEditorStore.setState({ assistantOpen: false });
    mountShell();
    expect(screen.getByTestId('character-layer').style.pointerEvents).toBe('none');
    // The chip is the one control in that layer (the way back into a running job), so it is the one
    // element allowed to hear a press.
    const chip = screen.queryByTestId('hero-chip');
    if (chip) expect(chip.style.pointerEvents).toBe('auto');
  });

  /** Every dropdown the panel opens is a body-level card in a layer that takes nothing: the map
   *  beside an open menu stays live, and no press is swallowed by an invisible plane. */
  it('opens the panel\'s one dropdown outside the panel, in a layer that takes no press', () => {
    const view = render(
      <MotionConfig reducedMotion="always">
        <I18nProvider>
          <PanelShell
            view={baseView({ jobs: [job({ outcome: 'done' }), job({ orderSeq: 2, outcome: 'done' })] })}
            connected
            now={0}
            {...VERBS}
          />
        </I18nProvider>
      </MotionConfig>,
    );
    const panel = view.getByTestId('panel-shell');
    fireEvent.click(view.getByTestId('history-toggle'));

    // The past-jobs card is a labelled GROUP rather than a menu: its rows carry a roll-back control
    // of their own, which a `menuitem` button could not nest.
    const card = document.body.querySelector('[role="group"]') as HTMLElement;
    expect(card).not.toBeNull();
    expect(panel.contains(card)).toBe(false);
    expect((card.parentElement as HTMLElement).style.pointerEvents).toBe('none');
    expect(card.style.pointerEvents).toBe('auto');
  });
});

/** `PanelColumn` retains the list's expanded state while an opened record temporarily replaces it. */
describe('the opened past record: Back reopens the list', () => {
  function seedConnected(): void {
    const model = Object.fromEntries(PROVIDER_IDS.map((p) => [p, ''])) as Record<ProviderId, string>;
    model.claude = 'claude-sonnet-4-5';
    useAgentPanelSettings.setState({
      provider: 'claude', model, oversight: 'checkpoint', customBaseUrl: '',
      keyed: ['claude'], hydrated: true,
    });
  }

  it('stands the list open again after Back, with its rows showing', async () => {
    seedConnected();
    const log = useAgentSession.getState().log;
    // Two settled jobs: the newer one stands as the receipt, the older one is what the strip lists.
    append(log, { kind: 'order', text: 'Terrace the east slope', mapContext: '' });
    append(log, { kind: 'jobEnd', outcome: 'done', summary: 'Terraces cut.' });
    append(log, { kind: 'order', text: 'Raise the mill', mapContext: '' });
    append(log, { kind: 'jobEnd', outcome: 'done', summary: 'Mill raised.' });

    useEditorStore.setState({ assistantOpen: true });
    mountShell();
    await screen.findByTestId('shell-assistant-panel', undefined, { timeout: 30_000 });

    fireEvent.click(screen.getByTestId('history-toggle'));
    expect(screen.getByTestId('history-strip').getAttribute('data-open')).toBe('true');

    fireEvent.click(screen.getAllByTestId('history-open')[0]!);
    // The opened record covers the zone: the strip stands down entirely while it does.
    expect(screen.queryByTestId('history-strip')).toBeNull();

    fireEvent.click(screen.getByTestId('archive-back'));

    const strip = await screen.findByTestId('history-strip');
    expect(strip.getAttribute('data-open'), 'the list reopens rather than standing collapsed').toBe('true');
    expect(screen.getAllByTestId('history-item').length).toBeGreaterThan(0);
  }, 40_000);
});
