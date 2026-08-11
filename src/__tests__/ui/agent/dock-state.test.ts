import { describe, it, expect } from 'vitest';
import { DOCK_BG, STAGE_ICONS, deriveDock, type DockInput } from '../../../ui/agent/dock-state';
import type { BlueprintEntry, Vitals } from '../../../agent/session';

/** Echo translator: assertions pin the i18n KEYS the dock renders. */
const t = (key: string) => key;

const vitals: Vitals = { water: 1, tree: 2, build: 3, flower: 4 };

const base: DockInput = {
  gate: null,
  waitingGate: false,
  waitingPick: false,
  bp: null,
  running: false,
  thinking: false,
  vitals,
};

const bp = (over: Partial<BlueprintEntry> = {}): BlueprintEntry => ({
  id: 1,
  kind: 'bp',
  goal: 'A cozy village with a stream',
  stages: ['Shape the land', 'Water and paths', 'Raise the buildings', 'Dress the scene'],
  draft: false,
  paused: false,
  done: false,
  doneCount: 1,
  currentIdx: 1,
  notes: {},
  steps: 0,
  checkpoints: [],
  ...over,
});

describe('DOCK_BG', () => {
  it('maps every kind to the prototype color (ask and gate share pale)', () => {
    expect(DOCK_BG).toEqual({
      idle: '#F3EEE8',
      think: '#E8E1D2',
      work: '#CED779',
      ask: '#FFE196',
      gate: '#FFE196',
      wait: '#CFC7B7',
    });
  });
});

describe('deriveDock — table rows', () => {
  it('idle: vitals row, key carries the counts', () => {
    const d = deriveDock(base, t);
    expect(d.kind).toBe('idle');
    expect(d.icon).toBe('eval');
    expect(d.vitals).toBe(true);
    expect(d.key).toBe('idle1.2.3.4');
    const d2 = deriveDock({ ...base, vitals: { ...vitals, flower: 9 } }, t);
    expect(d2.key).not.toBe(d.key); // a vitals bump crossfades the idle tile
  });

  it('thinking: field-deep stripes', () => {
    const d = deriveDock({ ...base, running: true, thinking: true }, t);
    expect(d.kind).toBe('think');
    expect(d.icon).toBe('eval');
    expect(d.title).toBe('agent2.dock_thinking');
    expect(d.sub).toBe('agent2.dock_walking');
    expect(d.stripes).toBe(true);
    expect(d.segs).toBeUndefined();
  });

  it('running small job: green stripes, no segments', () => {
    const d = deriveDock({ ...base, running: true }, t);
    expect(d.kind).toBe('work');
    expect(d.icon).toBe('build');
    expect(d.title).toBe('agent2.dock_onit');
    expect(d.sub).toBe('agent2.dock_smalljob');
    expect(d.stripes).toBe(true);
  });

  it('running blueprint: stage title, now-line sub, d/N right, segments', () => {
    const d = deriveDock({ ...base, running: true, bp: bp({ now: 'Carving the stream…' }) }, t);
    expect(d.kind).toBe('work');
    expect(d.icon).toBe(STAGE_ICONS[1]); // 'water'
    expect(d.title).toBe('Water and paths');
    expect(d.sub).toBe('Carving the stream…');
    expect(d.right).toBe('1/4');
    expect(d.segs).toEqual([1, 4]);
    expect(d.stripes).toBeUndefined();
  });

  it('running blueprint with helpers and no now-line: helpers sub', () => {
    const helpers = [{ icon: 'build' as const, color: '#C98A5B', name: 'Helper · Homes', task: 'placing cabins', done: false }];
    const d = deriveDock({ ...base, running: true, bp: bp({ currentIdx: 2, doneCount: 2, now: null, helpers }) }, t);
    expect(d.icon).toBe('build'); // STAGE_ICONS[2]
    expect(d.sub).toBe('agent2.dock_helpers');
    expect(d.segs).toEqual([2, 4]);
  });

  it('running blueprint clamps a not-yet-started stage index to 0', () => {
    const d = deriveDock({ ...base, running: true, bp: bp({ currentIdx: -1, doneCount: 0 }) }, t);
    expect(d.icon).toBe('terrain');
    expect(d.title).toBe('Shape the land');
  });

  it('paused blueprint: taupe wait with the goal as sub', () => {
    const d = deriveDock({ ...base, bp: bp({ paused: true }) }, t);
    expect(d.kind).toBe('wait');
    expect(d.icon).toBe('plan');
    expect(d.title).toBe('agent2.dock_paused');
    expect(d.sub).toBe('A cozy village with a stream');
  });

  it('sketches ask: pale tile prompting the pick', () => {
    const d = deriveDock({ ...base, waitingPick: true }, t);
    expect(d.kind).toBe('ask');
    expect(d.icon).toBe('terrain');
    expect(d.title).toBe('agent2.dock_sketches');
    expect(d.sub).toBe('agent2.dock_pick');
  });

  it('blueprint-draft ask: pale tile pointing at the draft', () => {
    const d = deriveDock({ ...base, waitingGate: true }, t);
    expect(d.kind).toBe('ask');
    expect(d.icon).toBe('plan');
    expect(d.title).toBe('agent2.dock_drafted');
    expect(d.sub).toBe('agent2.dock_review');
  });

  it('gate: "May I?" with Allow / Always / Skip-it chips', () => {
    const d = deriveDock({ ...base, gate: { sub: 'Clear 90 cells of scrub' } }, t);
    expect(d.kind).toBe('gate');
    expect(d.icon).toBe('build');
    expect(d.title).toBe('agent2.may_i');
    expect(d.sub).toBe('Clear 90 cells of scrub');
    expect(d.chips).toEqual([
      { label: 'agent2.allow', cls: 'yes', act: 'allow' },
      { label: 'agent2.always', cls: '', act: 'allow-all' },
      { label: 'agent2.skip', cls: 'no', act: 'deny' },
    ]);
  });
});

describe('deriveDock — precedence and keys', () => {
  it('gate wins over every other state', () => {
    const d = deriveDock(
      { ...base, gate: { sub: 'x' }, waitingGate: true, waitingPick: true, running: true, thinking: true, bp: bp({ paused: true }) },
      t,
    );
    expect(d.kind).toBe('gate');
  });

  it('blueprint-draft ask wins over sketches ask, which wins over paused', () => {
    const both = deriveDock({ ...base, waitingGate: true, waitingPick: true, bp: bp({ paused: true }) }, t);
    expect(both.title).toBe('agent2.dock_drafted');
    const pick = deriveDock({ ...base, waitingPick: true, bp: bp({ paused: true }) }, t);
    expect(pick.title).toBe('agent2.dock_sketches');
  });

  it('paused wins over the running-blueprint row; thinking over plain running', () => {
    expect(deriveDock({ ...base, running: true, bp: bp({ paused: true }) }, t).kind).toBe('wait');
    expect(deriveDock({ ...base, running: true, thinking: true }, t).kind).toBe('think');
  });

  it('a done or undone blueprint no longer drives the dock', () => {
    expect(deriveDock({ ...base, running: true, bp: bp({ done: true }) }, t).sub).toBe('agent2.dock_smalljob');
    expect(deriveDock({ ...base, bp: bp({ paused: true, undone: true }) }, t).kind).toBe('idle');
  });

  it('a draft blueprint without the ask flag does not read as running work', () => {
    const d = deriveDock({ ...base, running: true, bp: bp({ draft: true }) }, t);
    expect(d.kind).toBe('work');
    expect(d.stripes).toBe(true); // small-job row, not the segmented bp row
  });

  it('same kind, different content = different key (crossfade discriminator)', () => {
    const a = deriveDock({ ...base, running: true, bp: bp({ now: 'Terracing…' }) }, t);
    const b = deriveDock({ ...base, running: true, bp: bp({ now: 'Planting…' }) }, t);
    expect(a.kind).toBe(b.kind);
    expect(a.key).not.toBe(b.key);
    const c = deriveDock({ ...base, running: true, bp: bp({ now: 'Terracing…', doneCount: 2 }) }, t);
    expect(c.key).not.toBe(a.key); // segment progress also crossfades
  });
});
