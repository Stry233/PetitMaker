/** Pins the phase trait table and the per-class repair table the desk card, banner and composer share. */
import { describe, it, expect } from 'vitest';
import { PHASE } from '../../../../ui/agent/derive/phase';
import { jobOwnsMap } from '../../../../agent/core/view-types';
import { ACT_LABEL, deskActLabel, REPAIR } from '../../../../ui/agent/derive/repair';
import { translations } from '../../../../i18n/translations';
import type { SessionPhase } from '../../../../agent/core/project-view';

const PHASES = Object.keys(PHASE) as SessionPhase[];

describe('phase traits', () => {
  it('stands every phase either in flight or at rest, never both', () => {
    for (const phase of PHASES) {
      expect(PHASE[phase].inFlight !== PHASE[phase].atRest, phase).toBe(true);
    }
  });

  it('runs only phases the loop owns, and holds only a paused job', () => {
    for (const phase of PHASES) {
      if (PHASE[phase].running) expect(PHASE[phase].inFlight, phase).toBe(true);
      if (PHASE[phase].awaitingStream) expect(PHASE[phase].running, phase).toBe(true);
    }
    expect(PHASES.filter((phase) => PHASE[phase].onHold)).toEqual(['paused']);
    expect(PHASES.filter((phase) => PHASE[phase].running)).toEqual(['thinking', 'streaming', 'executing']);
  });

  it('leaves the map to the user only once no job is in flight or held', () => {
    expect(PHASES.filter(jobOwnsMap)).toEqual(['thinking', 'streaming', 'executing', 'gated', 'retrying', 'pausing', 'paused']);
    // The panel's traits say the same: a phase owns the map exactly when it is in flight or on hold.
    expect(PHASES.filter((phase) => PHASE[phase].inFlight || PHASE[phase].onHold)).toEqual(PHASES.filter(jobOwnsMap));
  });

  it('names a status word that exists in every locale', () => {
    for (const phase of PHASES) {
      for (const table of Object.values(translations)) expect(table[PHASE[phase].word], phase).toBeTruthy();
    }
  });
});

describe('the repair table', () => {
  it('leads every class\'s banner actions with the repair the desk card offers', () => {
    for (const [cls, row] of Object.entries(REPAIR)) {
      expect(row.actions[0], cls).toBe(row.act);
    }
  });

  it('labels every act in every locale, on the banner and on the desk card', () => {
    for (const table of Object.values(translations)) {
      for (const act of Object.keys(ACT_LABEL) as (keyof typeof ACT_LABEL)[]) {
        expect(table[ACT_LABEL[act]], act).toBeTruthy();
        expect(table[deskActLabel(act)], act).toBeTruthy();
      }
    }
  });

  it('keeps the wait paper for exactly the transient classes whose retries ran out', () => {
    const exhausted = Object.entries(REPAIR).filter(([, row]) => row.exhausted).map(([cls]) => cls).sort();
    expect(exhausted).toEqual(['network', 'overloaded', 'rate-limit']);
    for (const cls of exhausted) expect(REPAIR[cls as keyof typeof REPAIR].paper).toBe('wait');
  });
});
