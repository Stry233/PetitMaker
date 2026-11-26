/** Pins how the job zone shows a session: the welcome, the notices, the sketch seat and the height floor.
 *  Where each job stands is `agent/core/job-readings.ts:jobStanding`'s, tested beside it. */
import { describe, it, expect } from 'vitest';
import { sessionLayout, type SessionInputs } from '../../../../ui/agent/derive/session-layout';
import type { JobView, PanelView } from '../../../../agent/core/project-view';

function job(over: Partial<JobView> = {}): JobView {
  return {
    orderSeq: 1, orderText: 'Build', orderAt: 0, ops: [], steerNotes: [], checkpoints: [], stamps: [],
    celebrate: false, asks: [], skills: [], ...over,
  };
}

function view(over: Partial<PanelView> = {}): PanelView {
  return { phase: 'idle', jobs: [], queuedSteers: [], vitals: { cells: 0, objects: 0, reverts: 0, jobs: 0 }, suggestion: null, lastEventAt: 0, ...over };
}

function inputs(over: Partial<SessionInputs> = {}): SessionInputs {
  return {
    view: view(), connected: true, zone: { kind: 'session' }, filed: new Set(), cleared: new Set(),
    restored: false, dismissed: null, hasAsk: false, sketch: false, marking: false, ...over,
  };
}

describe('the session layout', () => {
  it('rests keyless on the welcome only with nothing outstanding', () => {
    expect(sessionLayout(inputs({ connected: false })).showWelcome).toBe(true);
    const stopped = view({ phase: 'paused', current: job() });
    expect(sessionLayout(inputs({ connected: false, view: stopped })).showWelcome).toBe(false);
  });

  it('names another map before an unknown one, and neither over a screen', () => {
    const jobs = [job({ orderSeq: 1, outcome: 'done' }), job({ orderSeq: 2, outcome: 'done' })];
    const base = inputs({ view: view({ jobs }), otherMap: new Set([1]), unknownMap: new Set([2]) });
    expect(sessionLayout(base).noticeCls).toBe('other-map');
    expect(sessionLayout({ ...base, zone: { kind: 'manage' } }).noticeCls).toBeNull();
  });

  it('opens the past record the zone names in place of the card', () => {
    const jobs = [job({ orderSeq: 1, outcome: 'done' }), job({ orderSeq: 2, outcome: 'done' })];
    const layout = sessionLayout(inputs({ view: view({ jobs }), zone: { kind: 'record', seq: 1 } }));
    expect([layout.opened, layout.settled, layout.noticeCls]).toEqual([jobs[0], null, null]);
  });

  it('dresses the idle zone with the sketch only when nothing else stands', () => {
    expect(sessionLayout(inputs({ sketch: true })).dressed).toBe(true);
    expect(sessionLayout(inputs({ sketch: true, storageNotice: 'corrupt' })).dressed).toBe(false);
    expect(sessionLayout(inputs({ sketch: true, hasAsk: true })).dressed).toBe(false);
  });

  it('waives the height floor where only the history row stands, or while marking', () => {
    const filedOnly = inputs({ view: view({ jobs: [job({ outcome: 'done' })] }), filed: new Set([1]) });
    expect(sessionLayout(filedOnly).zoneEmpty).toBe(true);
    expect(sessionLayout(inputs({ marking: true })).zoneEmpty).toBe(true);
    expect(sessionLayout(inputs()).zoneEmpty).toBe(false);
  });
});
