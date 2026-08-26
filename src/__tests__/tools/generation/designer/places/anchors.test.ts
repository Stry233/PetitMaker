// Stage 1's placements: WHERE each anchor region's buildings stand and which way their doors look.
// The claims here are about the PLAN — the committed map is `pipeline.test.ts`'s subject — so they
// are the ones a commit cannot repair: every anchor gets a spot, no two footprints share a cell, a
// footprint stays inside its lot, and every door either faces the lot's entry side or the court lane
// that leads back to it.
import { describe, it, expect } from 'vitest';
import { MAP_TEMPLATES } from '../../../../../config/maps';
import type { MapTemplate, Rect } from '../../../../../core/model/types';
import { getCatalogItem } from '../../../../../state/catalog';
import { getRotatedSize } from '../../../../../state/object-geometry';
import { planAnchors, type AnchorPlan } from '../../../../../tools/generation/designer/places/anchors';
import { planDesignFor } from '../_design-plan';
import { anchorCatalogItems } from '../../../../../tools/generation/designer/places/region-list';
import { DOOR_ROTATION, type DesignPlan } from '../../../../../tools/generation/designer/types';

const HEXIA = MAP_TEMPLATES['hexia']!;
const TAFA = MAP_TEMPLATES['tafa']!;
const SEEDS = Array.from({ length: 10 }, (_, i) => 1 + i * 7919);
const DEFAULT_RICHNESS = 0.5;

function planned(seed: number, template: MapTemplate, richness = DEFAULT_RICHNESS): {
  design: DesignPlan; anchors: AnchorPlan;
} {
  const design = planDesignFor(seed, template, richness);
  return { design, anchors: planAnchors(seed, design) };
}

/** A placement's footprint, as the rules will read it (rotated). */
function footprint(catalogId: string, position: { x: number; y: number }, rotation: 0 | 90 | 180 | 270): Rect {
  const item = getCatalogItem(catalogId)!;
  const { w, h } = getRotatedSize(item, rotation);
  return { x: position.x, y: position.y, w, h };
}

const inside = (r: Rect, lot: Rect): boolean =>
  r.x >= lot.x && r.y >= lot.y && r.x + r.w <= lot.x + lot.w && r.y + r.h <= lot.y + lot.h;

const overlap = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('every anchor gets a place', () => {
  it('plans a placement for every anchor of every region, on both templates', () => {
    for (const template of [HEXIA, TAFA]) {
      for (const seed of SEEDS) {
        const { design, anchors } = planned(seed, template);
        const wanted = design.regions.flatMap((r) => r.anchors);
        const got = anchors.placements.map((p) => p.catalogId);
        expect(anchors.unplaced, `${template.id}/${seed}`).toEqual([]);
        expect([...got].sort(), `${template.id}/${seed}`).toEqual([...wanted].sort());
      }
    }
  });

  it('covers the whole placeable building and facility set exactly once', () => {
    const expected = anchorCatalogItems().map((i) => i.id).sort();
    for (const seed of SEEDS) {
      const { anchors } = planned(seed, HEXIA);
      expect(anchors.placements.map((p) => p.catalogId).sort(), `seed ${seed}`).toEqual(expected);
    }
  });

  it('holds at every richness the shelf can ask for', () => {
    for (const richness of [0, 0.25, 0.5, 0.75, 1]) {
      const { anchors } = planned(4242, HEXIA, richness);
      expect(anchors.unplaced, `richness ${richness}`).toEqual([]);
    }
  });
});

describe('the geometry a commit depends on', () => {
  it('keeps every footprint inside its own lot and off every other building', () => {
    for (const template of [HEXIA, TAFA]) {
      for (const seed of SEEDS) {
        const { design, anchors } = planned(seed, template);
        const rects: Rect[] = [];
        for (const p of anchors.placements) {
          const region = design.regions.find((r) => r.id === p.regionId)!;
          const rect = footprint(p.catalogId, p.position, p.rotation);
          expect(inside(rect, region.lot[0]!), `${template.id}/${seed} ${p.catalogId} in ${p.regionId}`).toBe(true);
          for (const other of rects) expect(overlap(rect, other), `${template.id}/${seed} ${p.catalogId}`).toBe(false);
          rects.push(rect);
        }
      }
    }
  });

  it('never runs a court lane through a building', () => {
    for (const template of [HEXIA, TAFA]) {
      for (const seed of SEEDS) {
        const { anchors } = planned(seed, template);
        const rects = anchors.placements.map((p) => footprint(p.catalogId, p.position, p.rotation));
        for (const lane of anchors.lanes) {
          for (const c of lane.cells) {
            const hit = rects.find((r) => overlap({ x: c.x, y: c.y, w: 1, h: 1 }, r));
            expect(hit, `${template.id}/${seed} lane of ${lane.regionId} at ${c.x},${c.y}`).toBeUndefined();
          }
        }
      }
    }
  });

  it('keeps a court lane inside its lot, 2 cells wide, with its mouth on the entry edge', () => {
    for (const seed of SEEDS) {
      const { design, anchors } = planned(seed, HEXIA);
      for (const lane of anchors.lanes) {
        const lot = design.regions.find((r) => r.id === lane.regionId)!.lot[0]!;
        for (const c of lane.cells) {
          expect(inside({ x: c.x, y: c.y, w: 1, h: 1 }, lot), `seed ${seed} ${lane.regionId}`).toBe(true);
        }
        expect(lane.mouth.length, `seed ${seed} ${lane.regionId}`).toBe(2);
        for (const m of lane.mouth) {
          expect(lane.cells.some((c) => c.x === m.x && c.y === m.y)).toBe(true);
        }
      }
    }
  });

  it('turns every building so its door faces the way in', () => {
    for (const template of [HEXIA, TAFA]) {
      for (const seed of SEEDS) {
        const { design, anchors } = planned(seed, template);
        for (const p of anchors.placements) {
          const region = design.regions.find((r) => r.id === p.regionId)!;
          expect(p.rotation, `${template.id}/${seed} ${p.catalogId}`).toBe(DOOR_ROTATION[p.facing]);
          const lane = anchors.lanes.find((l) => l.regionId === p.regionId);
          const onLane = !!lane?.cells.some((c) => c.x === p.approach.x && c.y === p.approach.y);
          // A door either opens on the frontage outside the lot's entry side, or on the region's
          // own court lane, which is the way in for the rows behind the first.
          const outward = p.facing === region.orientation
            && !inside({ x: p.approach.x, y: p.approach.y, w: 1, h: 1 }, region.lot[0]!);
          expect(outward || onLane, `${template.id}/${seed} ${p.catalogId} faces ${p.facing}`).toBe(true);
        }
      }
    }
  });
});

describe('determinism', () => {
  it('answers the same plan for the same inputs, and a different one for a different seed', () => {
    const a = planAnchors(31337, planDesignFor(31337, HEXIA, 0.7));
    const b = planAnchors(31337, planDesignFor(31337, HEXIA, 0.7));
    expect(b).toEqual(a);
    const c = planAnchors(31338, planDesignFor(31338, HEXIA, 0.7));
    expect(JSON.stringify(c)).not.toBe(JSON.stringify(a));
  });
});
