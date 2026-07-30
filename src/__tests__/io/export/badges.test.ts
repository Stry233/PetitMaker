import { describe, it, expect } from 'vitest';
import { badgesFor, badgeScale } from '../../../io/export/render';
import type { MapProvenanceSummary } from '../../../core/provenance/types';

const base: MapProvenanceSummary = {
  exportDisclosure: 'human_created', dominant: 'human_created', containsAi: false, containsProcedural: false,
  aiEverUsed: false, aiUsedNoRemaining: false, aiTerrainPct: 0, aiObjectCount: 0, aiAreaPct: 0, proceduralAreaPct: 0,
  humanAfterAi: false, aiAfterHuman: false, counts: { aiWrites: 0, aiAccepted: 0, proceduralRuns: 0, analysisOnlyCalls: 0 },
};
const s = (o: Partial<MapProvenanceSummary>) => ({ ...base, ...o });

describe('badgesFor (presence-based)', () => {
  it('human-only → no badges', () => expect(badgesFor(s({}))).toEqual([]));
  it('AI only → AI badge', () => expect(badgesFor(s({ containsAi: true })).map(b => b.label)).toEqual(['prov.badge_ai']));
  it('procedural only → procedural badge', () => expect(badgesFor(s({ containsProcedural: true })).map(b => b.label)).toEqual(['prov.badge_proc']));
  it('both → AI then procedural', () => expect(badgesFor(s({ containsAi: true, containsProcedural: true })).map(b => b.label)).toEqual(['prov.badge_ai', 'prov.badge_proc']));
  it('AI used but edited away → no AI badge', () => expect(badgesFor(s({ aiEverUsed: true, aiUsedNoRemaining: true }))).toEqual([]));
  it('null summary → []', () => expect(badgesFor(null)).toEqual([]));
});

describe('badgeScale', () => {
  it('one badge → full size', () => expect(badgeScale(1)).toBe(1));
  it('two badges → reduced', () => expect(badgeScale(2)).toBe(0.8));
  it('zero → 1', () => expect(badgeScale(0)).toBe(1));
});
