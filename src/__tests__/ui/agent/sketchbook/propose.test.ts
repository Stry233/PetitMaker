/** The sketch card's proposals carry the words they are said in: a line and an order per kind, and the
 *  compass word for their quarter. The proposals themselves are pinned in `agent/tools/sketch.ts`. */
import { describe, expect, it, vi } from 'vitest';
import type { SketchProposal } from '../../../../agent/panel';
import type { GridState } from '../../../../core/model/types';

const KINDS = ['lane', 'pond', 'bridge', 'grove'] as const;
const DIRS = ['north', 'south', 'east', 'west', 'middle'] as const;

vi.mock('../../../../agent/panel', () => ({
  proposeSketches: (): SketchProposal[] => KINDS.map((kind, i) => ({
    kind, dir: DIRS[i % DIRS.length]!, params: { n: i + 1 }, art: { shape: 'grove', pips: [] },
  })),
}));

const { proposeSketches } = await import('../../../../ui/agent/sketchbook/propose');

describe('sketch ideas', () => {
  it('name each kind its own line and order, and each quarter its word', () => {
    const ideas = proposeSketches({} as GridState);
    expect(ideas.map((idea) => idea.kind)).toEqual([...KINDS]);
    for (const idea of ideas) {
      expect(idea.capKey).toBe(`agent.sketch_${idea.kind}_cap`);
      expect(idea.orderKey).toBe(`agent.sketch_${idea.kind}_order`);
      expect(idea.dirKey).toBe(`agent.sketch_dir_${idea.dir}`);
      expect(idea.params.n).toBeGreaterThan(0);
    }
  });
});
