/**
 * The assistant: the design's not-connected card, and the Site Log behind it.
 *
 * The assertions are on what the user can read and press, never on the rects: the panel is the
 * design's plate at two heights and a rect assertion would only restate `assistant-frame.ts`. What
 * is worth pinning is that the not-connected face carries the three things the design draws, that
 * every entry kind the turn runner can produce still renders once a key exists, that the region the
 * user painted is visible beside the assistant, and that a refusal for straying out of it is
 * readable.
 *
 * The panel body is a lazy chunk, so every connected assertion goes through `findBy*`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import { I18nProvider, translate } from '../../../i18n/context';
import { revertCopy } from '../../../agent/feed';
import { SESSION_LS_KEY, useAgentSession } from '../../../agent/session';
import { useAgentStore } from '../../../agent/store';
import { PROVIDER_IDS } from '../../../agent/providers/defaults';
import { useEditorStore } from '../../../state/store';
import { sampleInspirations, INSPIRATIONS } from '../../../ui/agent/inspirations';
import { ScaleProvider } from '../../../ui/design/scale';
import { Assistant } from '../../../ui/shell/assistant/Assistant';

const backing = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
});

function mount() {
  return render(
    <I18nProvider>
      <ScaleProvider value={0.5}>
        <Assistant />
      </ScaleProvider>
    </I18nProvider>,
  );
}

/** A key the vault has already handed back: what "connected" means to the panel. */
function connect() {
  act(() => {
    useAgentStore.getState().setProvider('claude');
    useAgentStore.getState().setKey('claude', 'sk-ant-api03-000000000000');
  });
}

type NewEntry = Parameters<ReturnType<typeof useAgentSession.getState>['pushEntry']>[0];

function push(e: NewEntry) {
  act(() => { useAgentSession.getState().pushEntry(e); });
}

beforeEach(() => {
  // The panel is the subject here; its block in the mode row is `narrow-viewport.test.tsx`'s.
  useEditorStore.setState({ locale: 'en', region: [], selectingRegion: false, assistantOpen: true });
  useAgentSession.setState({ log: [], running: false, thinking: false, gate: null });
  useAgentStore.setState({ keysHydrated: true, setupOpen: null });
  act(() => { useAgentStore.getState().setKey('claude', ''); });
});

afterEach(() => {
  cleanup();
  useEditorStore.setState({ region: [], selectingRegion: false });
});

describe('the not-connected face', () => {
  it('carries the three things the design draws: the introduction, the key field and the button', async () => {
    mount();
    const card = await screen.findByTestId('shell-assistant-intro');
    // The introduction names the platforms and how many there are, from the live registry rather
    // than from a number typed into a translation.
    expect(within(card).getByText(new RegExp(String(PROVIDER_IDS.length)))).toBeTruthy();
    expect(within(card).getByPlaceholderText(translate('agent2.paste_key'))).toBeTruthy();
    expect(within(card).getByText(translate('agent2.connect'))).toBeTruthy();
  });

  it('is what a key-less panel shows, and the site log is what a connected one shows', async () => {
    mount();
    await screen.findByTestId('shell-assistant-intro');
    connect();
    // The one case where the chunk is fetched MID-test rather than at mount, so the wait is the
    // import's and not the render's; a loaded machine running the whole suite takes longer than the
    // one second `findBy` allows by default.
    expect(await screen.findByTestId('sitelog', undefined, { timeout: 5000 })).toBeTruthy();
    expect(screen.queryByTestId('shell-assistant-intro')).toBeNull();
  });

  it('files a pasted key under the platform its own format names', async () => {
    mount();
    const card = await screen.findByTestId('shell-assistant-intro');
    const field = within(card).getByPlaceholderText(translate('agent2.paste_key'));
    fireEvent.change(field, { target: { value: 'sk-ant-api03-abcdefabcdefabcdef' } });
    await act(async () => { fireEvent.keyDown(field, { key: 'Enter' }); });
    expect(useAgentStore.getState().settings.provider).toBe('claude');
    expect(useAgentStore.getState().settings.keys.claude).toContain('sk-ant-');
    expect(await screen.findByTestId('sitelog')).toBeTruthy();
  });

  it('hands over to the full setup screen for the questions the card cannot put', async () => {
    mount();
    const card = await screen.findByTestId('shell-assistant-intro');
    fireEvent.click(within(card).getByText(translate('agent2.setup')));
    expect(await screen.findByText(translate('agent2.byok_title'))).toBeTruthy();
  });
});

describe('a connected session', () => {
  it('renders every entry kind the turn runner can produce', async () => {
    connect();
    push({ kind: 'oslip', text: 'Build a village by the water' });
    push({ kind: 'note', text: 'Looking at the island first.' });
    push({
      kind: 'ticket', icon: 'build', tile: '#FFDA7E', title: 'Placed six houses',
      rail: [{ s: 'ok', i: 'build', t: 'house' }], undoable: true, checkpoint: { undoIndex: 0 },
    });
    push({
      kind: 'sketches', picked: null,
      opts: [{ icon: 'plan', tile: '#FFDA7E', name: 'Terraced', sub: 'steps down to the shore' }],
    });
    push({
      kind: 'bp', goal: 'A village by the water', stages: ['Shape the land', 'Lay roads'],
      draft: false, paused: false, done: false, doneCount: 1, currentIdx: 1, notes: {},
      steps: 2, checkpoints: [{ undoIndex: 0 }],
    });
    mount();
    const log = await screen.findByTestId('sitelog');
    const kinds = [...log.querySelectorAll('[data-ekind]')].map((el) => el.getAttribute('data-ekind'));
    expect(kinds).toEqual(['oslip', 'note', 'ticket', 'sketches', 'bp']);
    expect(within(log).getByText('Build a village by the water')).toBeTruthy();
    expect(within(log).getByText('Placed six houses')).toBeTruthy();
    expect(within(log).getByText('A village by the water')).toBeTruthy();
  });

  it('comes back from a reload with a mid-run plan paused, not running', async () => {
    connect();
    // What the session wrote before the page closed: a blueprint in progress.
    localStorage.setItem(SESSION_LS_KEY, JSON.stringify({
      v: 1,
      log: [{
        id: 41, kind: 'bp', goal: 'A village by the water', stages: ['Shape the land', 'Lay roads'],
        draft: false, paused: false, done: false, doneCount: 1, currentIdx: 1, notes: {},
        steps: 2, checkpoints: [{ undoIndex: 0 }],
      }],
      vitals: { water: 0, tree: 0, build: 0, flower: 0 },
      resumeSummary: '',
    }));
    act(() => { useAgentSession.getState().hydrateFromStorage(); });
    const bp = useAgentSession.getState().log[0];
    expect(bp?.kind === 'bp' && bp.paused).toBe(true);

    mount();
    const log = await screen.findByTestId('sitelog');
    // The card offers to pick the plan up, which is the paused card's own affordance; a running one
    // has nothing to resume.
    expect(within(log).getByText(translate('agent2.resume'))).toBeTruthy();
    expect(useAgentSession.getState().running).toBe(false);
  });
});

describe('the painted region', () => {
  it('is shown beside the assistant only while one stands', async () => {
    connect();
    mount();
    await screen.findByTestId('sitelog');
    expect(screen.queryByTestId('shell-assistant-region-badge')).toBeNull();

    act(() => { useEditorStore.getState().setRegion([{ x: 4, y: 4 }, { x: 5, y: 4 }, { x: 4, y: 5 }]); });
    const badge = await screen.findByTestId('shell-assistant-region-badge');
    expect(badge.textContent).toContain('3');

    act(() => { useEditorStore.getState().setRegion([]); });
    expect(screen.queryByTestId('shell-assistant-region-badge')).toBeNull();
  });

  it('says where an edit strayed and what it was supposed to stay inside', () => {
    // The wording the tool bridge hands back, verbatim.
    const refusal =
      'OUT OF REGION: this edit reached (40,12), outside the region the user selected '
      + '(289 cells within (4,4)-(20,20)). Nothing was applied. Every cell you write, and every '
      + 'object you place or remove, must lie inside that region.';
    const copy = revertCopy(refusal, translate);
    expect(copy).not.toBe(translate('agent2.rv_generic'));
    for (const n of ['40', '12', '4', '20']) expect(copy).toContain(n);
  });

  it('reads an out-of-region refusal out on the card that carries it', async () => {
    connect();
    push({
      kind: 'ticket', icon: 'build', tile: '#FFDA7E', title: 'Placed six houses', flipped: true,
      rail: [{ s: 'revert', i: 'build', t: 'adjusted' }],
      steps: [{ s: 'revert', t: revertCopy(
        'OUT OF REGION: this edit reached (40,12), outside the region the user selected '
        + '(289 cells within (4,4)-(20,20)). Nothing was applied.', translate) }],
    });
    mount();
    const log = await screen.findByTestId('sitelog');
    expect(within(log).getByText(/40/)).toBeTruthy();
  });
});

describe('another batch of starters', () => {
  it('never hands back one that is already on screen', () => {
    const shown = sampleInspirations(3);
    for (let i = 0; i < 40; i++) {
      const next = sampleInspirations(3, shown);
      expect(next).toHaveLength(3);
      for (const n of next) expect(shown.some((s) => s.key === n.key)).toBe(false);
    }
  });

  it('still draws from the whole pool when nothing is held out', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) for (const s of sampleInspirations(3)) seen.add(s.key);
    // A sampler that had collapsed onto a few phrases would fail this long before the pool's size.
    expect(seen.size).toBeGreaterThan(INSPIRATIONS.length / 2);
  });
});
