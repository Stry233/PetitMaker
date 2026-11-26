/** Which runner verb each session phase admits, as the desk's seat and the manage card read it. */
import { describe, it, expect } from 'vitest';
import { PHASE_TRAITS } from '../../../agent/boot';
import type { SessionPhase } from '../../../agent/panel';

const PHASES = Object.keys(PHASE_TRAITS) as SessionPhase[];
const where = (trait: 'pausable' | 'waiting' | 'parkable'): SessionPhase[] => PHASES.filter((phase) => PHASE_TRAITS[phase][trait]).sort();

describe('the runner verb a phase admits', () => {
  it('admits Pause only while the job moves under its own power', () => {
    expect(where('pausable')).toEqual(['executing', 'streaming', 'thinking']);
    for (const phase of PHASES) expect(PHASE_TRAITS[phase].pausable, phase).toBe(PHASE_TRAITS[phase].running);
  });

  it('leaves only Stop for a job in flight that waits: on a question, a retry clock or a pause already asked', () => {
    const stopOnly = PHASES.filter((phase) => PHASE_TRAITS[phase].inFlight && !PHASE_TRAITS[phase].pausable).sort();
    expect(stopOnly).toEqual(['gated', 'pausing', 'retrying']);
    expect(where('waiting')).toEqual(['gated', 'retrying']);
  });

  it('parks a job only on a retry clock, never under an open question', () => {
    expect(where('parkable')).toEqual(['retrying']);
    expect(PHASE_TRAITS.gated.parkable).toBe(false);
  });

  it('offers Resume only on hold', () => {
    expect(PHASES.filter((phase) => PHASE_TRAITS[phase].onHold)).toEqual(['paused']);
    expect(PHASE_TRAITS.paused.inFlight).toBe(false);
  });
});
