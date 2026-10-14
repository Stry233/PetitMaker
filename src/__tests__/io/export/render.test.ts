import { describe, it, expect } from 'vitest';
import { exportComposition } from '../../../io/export/render';
import { computeComposition } from '../../../io/export/compose';
import { layersFor } from '../../../io/export/layer-preview';
import { ProvenanceTracker } from '../../../core/provenance/tracker';
import { ProvSource } from '../../../core/provenance/types';
import type { ExportOptions } from '../../../io/export/types';
import { makeState } from '../../_support/map-state';

const OPTIONS: ExportOptions = {
  title: 'Bay', description: '', preset: 'plain', showBadge: true, layerPreview: true, card3d: false,
  grid: true, footer: true, annotations: false, footerTemplate: '', resolution: 'compact',
};

function aiSummary() {
  const t = new ProvenanceTracker(4, 4, { now: () => 0 });
  t.withSource({ source: ProvSource.AiWrite, ai: { model: 'm' } }, () => t.record('create', [{ x: 0, y: 0 }], [], { layers: [1], zones: [2] }));
  return t.getSummary();
}

describe('exportComposition', () => {
  it('lays out the map with its disclosure badges and its layer count', () => {
    const state = makeState();
    const mapPx = { w: 600, h: 500 };
    const comp = exportComposition(OPTIONS, state, aiSummary(), { aspect: 1.2, px: mapPx });
    expect(comp.badges.map((b) => b.label)).toEqual(['export.badge_ai']);
    expect(comp).toEqual(computeComposition(OPTIONS, 1.2, comp.badges, { layerCount: layersFor(state).length, mapPx }));
  });

  it('shows no badges when the badge option is off or nothing needs disclosing', () => {
    const state = makeState();
    expect(exportComposition({ ...OPTIONS, showBadge: false }, state, aiSummary(), { aspect: 1.2, px: { w: 600, h: 500 } }).badges).toEqual([]);
    expect(exportComposition(OPTIONS, state, null, { aspect: 1.2, px: { w: 600, h: 500 } }).badges).toEqual([]);
  });
});
