import { describe, it, expect } from 'vitest';
import { describeToolCall } from '../../agent/describe-call';
import { WRITE_TOOLS } from '../../agent/tools';
import { translateFor } from '../../i18n/context';
import { translations } from '../../i18n/translations';
import type { Locale } from '../../core/model/types';

// The real table, so a key the line asks for but no locale defines shows up here
// as the raw key rather than as copy.
const tr = (loc: Locale = 'en') => (k: string, p?: Record<string, string | number>) => translateFor(loc, k, p);
const en = tr();

/** One typical input per tool the panel can describe, so a locale sweep sees the
 *  connecting words of every describer, not just the ones with no arguments. */
const CALLS: { name: string; input: Record<string, unknown> }[] = [
  { name: 'paint_terrain', input: { rect: { x1: 2, y1: 2, x2: 8, y2: 6 }, terrain: 'mountain', elevation: 3, smooth: 'round' } },
  { name: 'paint_terrain', input: { circle: { cx: 4, cy: 4, r: 3 }, terrain: 'water', elevation: 0 } },
  { name: 'paint_terrain', input: { cells: [{ x: 1, y: 1 }, { x: 2, y: 2 }], terrain: 'mountain', elevation: 1 } },
  { name: 'paint_terrain', input: { rect: { x1: 1, y1: 1, x2: 9, y2: 9 }, outline: true, terrain: 'mountain', elevation: 2 } },
  { name: 'erase_terrain', input: { line: { x1: 1, y1: 2, x2: 9, y2: 9, width: 2 } } },
  { name: 'clear_area', input: { rect: { x1: 1, y1: 1, x2: 4, y2: 4 } } },
  { name: 'place_object', input: { catalogId: 'building-myhouse', x: 3, y: 4, rotation: 90 } },
  { name: 'remove_object', input: { objectId: 'obj-7' } },
  { name: 'rotate_object', input: { objectId: 'obj-7', rotation: 180 } },
  { name: 'trim_corner', input: { x: 3, y: 4, corner: 'TL', style: 'fan' } },
  { name: 'build_road', input: { catalogId: 'path-overgrown-dirt', line: { x1: 1, y1: 1, x2: 8, y2: 1 } } },
  { name: 'scatter_objects', input: { catalogIds: ['tree-a', 'tree-b', 'tree-c'], count: 30 } },
  { name: 'scatter_objects', input: { catalogIds: ['flora-a'], count: 5, rect: { x1: 1, y1: 1, x2: 6, y2: 6 } } },
  { name: 'sculpt_terrace', input: { cx: 10, cy: 10, baseRadius: 6, tiers: 3 } },
  { name: 'carve_river', input: { points: [{ x: 1, y: 2 }, { x: 9, y: 9 }], width: 3 } },
  { name: 'run_generator', input: { algorithm: 'maze', seed: 42, rect: { x1: 0, y1: 0, x2: 9, y2: 9 } } },
  { name: 'run_generator', input: {} },
  ...['orchard', 'farm', 'garden', 'hamlet', 'waterfront', 'peak', 'nonesuch']
    .map((theme) => ({ name: 'decorate_zone', input: { theme, x: 1, y: 2, w: 3, h: 4 } })),
  { name: 'plant_forest', input: { x: 1, y: 2, w: 3, h: 4, density: 0.6 } },
  { name: 'build_road_network', input: {} },
  { name: 'frame_crossing', input: { x: 5, y: 6 } },
  { name: 'undo', input: { steps: 2 } },
  { name: 'update_plan', input: { stages: [{ label: 'Shape the hill' }, { label: 'Lay the paths' }, { label: 'Plant' }, { label: 'Review' }] } },
];

describe('describeToolCall (human-readable approvals)', () => {
  it('renders the common write tools without raw JSON', () => {
    expect(describeToolCall({ name: 'place_object', input: { catalogId: 'building-myhouse', x: 3, y: 4 } }, en))
      .toBe('place_object: building-myhouse at (3,4)');
    expect(describeToolCall({ name: 'paint_terrain', input: { rect: { x1: 2, y1: 2, x2: 8, y2: 6 }, terrain: 'water', elevation: 0 } }, en))
      .toBe('paint_terrain: water elev 0 on (2,2)→(8,6)');
    expect(describeToolCall({ name: 'scatter_objects', input: { catalogIds: ['tree-a', 'tree-b', 'tree-c'], count: 30 } }, en))
      .toContain('30 × [tree-a, tree-b +1]');
    expect(describeToolCall({ name: 'carve_river', input: { points: [{ x: 1, y: 2 }, { x: 9, y: 9 }], width: 3 } }, en))
      .toContain('(1,2)→(9,9)');
  });

  it('never emits JSON braces for any write tool with typical inputs', () => {
    for (const name of WRITE_TOOLS) {
      const text = describeToolCall({ name, input: { x: 1, y: 2, w: 3, h: 4, catalogId: 'path-overgrown-dirt', theme: 'farm' } }, en);
      expect(text).not.toMatch(/[{}"]/);
      expect(text).toContain(name);
    }
  });

  it('names the plan being approved: stages counted, first three labels, +N tail past three', () => {
    const stages = [{ label: 'Shape the hill' }, { label: 'Lay the paths' }, { label: 'Plant' }, { label: 'Review' }];
    expect(describeToolCall({ name: 'update_plan', input: { stages } }, en))
      .toBe('update_plan: 4 stages: Shape the hill, Lay the paths, Plant +1');
  });

  it('lists three or fewer stages whole, with no tail', () => {
    const stages = [{ label: 'Shape the hill' }, { label: 'Lay the paths' }, { label: 'Plant' }];
    expect(describeToolCall({ name: 'update_plan', input: { stages } }, en))
      .toBe('update_plan: 3 stages: Shape the hill, Lay the paths, Plant');
  });

  it('falls back to the bare tool name when stages is missing, empty, or not an array', () => {
    expect(describeToolCall({ name: 'update_plan', input: {} }, en)).toBe('update_plan');
    expect(describeToolCall({ name: 'update_plan', input: { stages: [] } }, en)).toBe('update_plan');
    expect(describeToolCall({ name: 'update_plan', input: { stages: 'not-an-array' } }, en)).toBe('update_plan');
  });

  it('names a delegated task by its short label, over the full self-contained instructions', () => {
    const input = { task: 'Complete, self-contained instructions: plant an oak grove north of the lake.', label: 'north grove' };
    expect(describeToolCall({ name: 'delegate_task', input }, en)).toBe('delegate_task: north grove');
  });

  it('falls back to the task text itself when a delegated call carries no label', () => {
    expect(describeToolCall({ name: 'delegate_task', input: { task: 'raise a hill' } }, en))
      .toBe('delegate_task: raise a hill');
  });

  it('falls back to compact key=value pairs for unknown tools', () => {
    expect(describeToolCall({ name: 'mystery_tool', input: { a: 1, b: 'x', deep: { no: 1 } } }, en))
      .toBe('mystery_tool: a=1 b=x');
    expect(describeToolCall({ name: 'mystery_tool', input: {} }, en)).toBe('mystery_tool');
  });

  it('every connecting word is real copy in every locale, never a bare key', () => {
    for (const loc of Object.keys(translations) as Locale[]) {
      for (const call of CALLS) {
        const text = describeToolCall(call, tr(loc));
        expect({ loc, call: call.name, text }).not.toMatchObject({ text: expect.stringContaining('agent2.') });
        expect({ loc, call: call.name, text }).not.toMatchObject({ text: expect.stringContaining('{') });
      }
    }
  });

  it('the localized line never borrows the English words', () => {
    const zh = describeToolCall({ name: 'paint_terrain', input: { rect: { x1: 2, y1: 2, x2: 8, y2: 6 }, terrain: 'mountain', elevation: 3 } }, tr('zh'));
    expect(zh).toBe('paint_terrain: 山体 高度3 在(2,2)→(8,6)');
    expect(describeToolCall({ name: 'build_road_network', input: {} }, tr('zh'))).toBe('build_road_network: 连通所有建筑');
    expect(describeToolCall({ name: 'scatter_objects', input: { catalogIds: ['tree-a'], count: 4 } }, tr('zh')))
      .toBe('scatter_objects: 4 × [tree-a] 于所选区域');
  });

  it('stays compact: no locale doubles the English line', () => {
    for (const loc of Object.keys(translations) as Locale[]) {
      for (const call of CALLS) {
        const enLen = describeToolCall(call, en).length;
        expect({ loc, call: call.name, over: describeToolCall(call, tr(loc)).length > enLen * 2 })
          .toMatchObject({ over: false });
      }
    }
  });
});
