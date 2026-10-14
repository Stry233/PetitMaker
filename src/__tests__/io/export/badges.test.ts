import { describe, it, expect } from 'vitest';
import { badgeScale, exportComposition } from '../../../io/export/render';
import type { MapProvenanceSummary } from '../../../core/provenance/types';
import type { ExportOptions } from '../../../io/export/types';
import { makeState } from '../../_support/map-state';

const OPTIONS: ExportOptions = {
  title: 'Bay', description: '', preset: 'plain', showBadge: true, layerPreview: false, card3d: false,
  grid: false, footer: false, annotations: false, footerTemplate: '', resolution: 'compact',
};
/** The badges an export with the badge option on wears for `summary`. */
const badgesFor = (summary: MapProvenanceSummary | null) => exportComposition(OPTIONS, makeState(), summary, { aspect: 1, px: { w: 100, h: 100 } }).badges;

const base: MapProvenanceSummary = {
  exportDisclosure: 'human_created', containsAi: false, containsProcedural: false,
  aiEverUsed: false, aiUsedNoRemaining: false, aiTerrainPct: 0, aiObjectCount: 0, proceduralAreaPct: 0,
  humanAfterAi: false, aiAfterHuman: false,
};
const s = (o: Partial<MapProvenanceSummary>) => ({ ...base, ...o });

describe('export badges (presence-based)', () => {
  it('human-only → no badges', () => expect(badgesFor(s({}))).toEqual([]));
  it('AI only → AI badge', () => expect(badgesFor(s({ containsAi: true })).map(b => b.label)).toEqual(['export.badge_ai']));
  it('procedural only → procedural badge', () => expect(badgesFor(s({ containsProcedural: true })).map(b => b.label)).toEqual(['export.badge_proc']));
  it('both → AI then procedural', () => expect(badgesFor(s({ containsAi: true, containsProcedural: true })).map(b => b.label)).toEqual(['export.badge_ai', 'export.badge_proc']));
  it('AI used but edited away → no AI badge', () => expect(badgesFor(s({ aiEverUsed: true, aiUsedNoRemaining: true }))).toEqual([]));
  it('null summary → []', () => expect(badgesFor(null)).toEqual([]));
});

describe('badgeScale', () => {
  it('one badge → full size', () => expect(badgeScale(1)).toBe(1));
  it('two badges → reduced', () => expect(badgeScale(2)).toBe(0.8));
  it('zero → 1', () => expect(badgeScale(0)).toBe(1));
});
