/**
 * Site Log session store (spec 2026-07-16-agent-v2-sitelog-design.md §3):
 * entry model, undone semantics, conversation-only clear, persistence
 * round-trip (transient flags stripped, running blueprint demoted to paused),
 * and the askBeforeEdits → oversight migration in key-storage.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useAgentSession, SESSION_LS_KEY, discardStoredSession } from '../../agent/session';
import { loadAgentSettings, saveAgentSettings } from '../../agent/key-storage';

const S = () => useAgentSession.getState();

beforeEach(() => {
  localStorage.clear();
  S().clearLog();
  useAgentSession.setState({
    running: false, thinking: false, gate: null,
    vitals: { water: 0, tree: 0, build: 0, flower: 0 },
    resumeSummary: '',
  });
});

describe('log entries', () => {
  it('pushes entries with increasing ids and patches in place', () => {
    const a = S().pushEntry({ kind: 'oslip', text: 'Add a pond' });
    const b = S().pushEntry({ kind: 'note', text: 'On it.' });
    expect(b).toBeGreaterThan(a);
    S().patchEntry(b, { text: 'Done.' });
    const note = S().getEntry(b);
    expect(note && note.kind === 'note' && note.text).toBe('Done.');
    expect(S().log).toHaveLength(2);
  });

  it('markUndone dims the entry and strips its undo affordance', () => {
    const id = S().pushEntry({
      kind: 'ticket', icon: 'water', tile: '#FFE196', title: 'Pond',
      rail: [{ s: 'ok', i: 'water', t: 'Painted' }], undoable: true,
      checkpoint: { undoIndex: 3 },
    });
    S().markUndone(id);
    const e = S().getEntry(id);
    expect(e?.undone).toBe(true);
    expect(e && e.kind === 'ticket' && e.undoable).toBe(false);
  });

  it('clearLog clears the conversation but keeps vitals (the map is untouched)', () => {
    S().pushEntry({ kind: 'oslip', text: 'hi' });
    S().bumpVitals('tree', 4);
    S().clearLog();
    expect(S().log).toHaveLength(0);
    expect(S().vitals.tree).toBe(4);
  });
});

describe('persistence', () => {
  it('round-trips the log and demotes a running blueprint to paused, stripping transients', async () => {
    S().pushEntry({ kind: 'note', text: 'Walking the site', busy: true, icon: 'eval' });
    S().pushEntry({
      kind: 'bp', goal: 'A cozy village', stages: ['A', 'B'], draft: false, paused: false,
      done: false, doneCount: 1, currentIdx: 1, notes: { 0: 'done A' },
      rail: [{ s: 'run', i: 'water', t: 'Stream' }], now: 'Carving…',
      steps: 14, checkpoints: [{ undoIndex: 2 }],
    });
    S().bumpVitals('water', 2);
    await new Promise((r) => setTimeout(r, 600)); // debounced write
    const raw = localStorage.getItem(SESSION_LS_KEY);
    expect(raw).toBeTruthy();

    // simulate a fresh boot
    useAgentSession.setState({ log: [] });
    S().hydrateFromStorage();
    const log = S().log;
    expect(log).toHaveLength(2);
    const note = log[0]!;
    expect(note.kind === 'note' && note.busy).toBeFalsy();
    const bp = log[1]!;
    expect(bp.kind).toBe('bp');
    if (bp.kind === 'bp') {
      expect(bp.paused).toBe(true);
      expect(bp.rail ?? null).toBeNull();
      expect(bp.now ?? null).toBeNull();
      expect(bp.doneCount).toBe(1);
    }
    expect(S().vitals.water).toBe(2);
  });

  it('drops corrupt payloads instead of throwing', () => {
    localStorage.setItem(SESSION_LS_KEY, '{"v":1,"log":"nope"}');
    expect(() => S().hydrateFromStorage()).not.toThrow();
    expect(S().log).toHaveLength(0);
  });

  it('discardStoredSession forgets the stored log (start fresh at the welcome bubble)', async () => {
    S().pushEntry({ kind: 'note', text: 'Old work' });
    await new Promise((r) => setTimeout(r, 600)); // debounced write
    expect(localStorage.getItem(SESSION_LS_KEY)).toBeTruthy();
    discardStoredSession();
    expect(localStorage.getItem(SESSION_LS_KEY)).toBeNull();
    // a later hydrate (nothing stored) leaves the fresh session untouched
    useAgentSession.setState({ log: [] });
    S().hydrateFromStorage();
    expect(S().log).toHaveLength(0);
  });
});

describe('oversight migration (key-storage)', () => {
  it('askBeforeEdits true migrates to strict, false to checkpoint', () => {
    localStorage.setItem('petit-agent-settings-v1', JSON.stringify({ askBeforeEdits: true }));
    expect(loadAgentSettings().oversight).toBe('strict');
    localStorage.setItem('petit-agent-settings-v1', JSON.stringify({ askBeforeEdits: false }));
    expect(loadAgentSettings().oversight).toBe('checkpoint');
    localStorage.removeItem('petit-agent-settings-v1');
    expect(loadAgentSettings().oversight).toBe('checkpoint');
  });

  it('a stored oversight value wins over the legacy flag and round-trips', () => {
    localStorage.setItem('petit-agent-settings-v1', JSON.stringify({ askBeforeEdits: true, oversight: 'yolo' }));
    expect(loadAgentSettings().oversight).toBe('yolo');
    const s = loadAgentSettings();
    saveAgentSettings({ ...s, oversight: 'strict' });
    const re = loadAgentSettings();
    expect(re.oversight).toBe('strict');
    expect(re.askBeforeEdits).toBe(true); // back-compat mirror
  });

  // 'yolo' was stored as 'autopilot' before the identifier was renamed to match the
  // label. Dropping the old name would silently reset those users to checkpoint —
  // someone who asked never to be interrupted would start being interrupted.
  it("a stored 'autopilot' still selects the mode it named", () => {
    localStorage.setItem('petit-agent-settings-v1', JSON.stringify({ oversight: 'autopilot' }));
    expect(loadAgentSettings().oversight).toBe('yolo');
    // and it is read-only: the next save writes the current name.
    saveAgentSettings(loadAgentSettings());
    expect(localStorage.getItem('petit-agent-settings-v1')).toContain('"oversight":"yolo"');
    expect(loadAgentSettings().oversight).toBe('yolo');
  });

  it('an unrecognised oversight falls back rather than sticking', () => {
    localStorage.setItem('petit-agent-settings-v1', JSON.stringify({ oversight: 'nonesuch' }));
    expect(loadAgentSettings().oversight).toBe('checkpoint');
    localStorage.setItem('petit-agent-settings-v1', JSON.stringify({ oversight: 'nonesuch', askBeforeEdits: true }));
    expect(loadAgentSettings().oversight).toBe('strict');
  });
});
