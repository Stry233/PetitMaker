/*
 * smart-menu.ts — what smart build offers on each surface, and where the open cell draws.
 *
 * Each surface offers its OWN actions. The design source draws the road action under all three
 * bars because one group is reused there; the list below is what each surface actually offers.
 *
 * An AIM action builds where the user points, so it needs a target cell before it can run; a
 * PROPOSAL action works over the whole buildable region and needs none. That is the only thing the
 * kind decides here — `applyMacro` implements both the same way.
 *
 * EVERY MACRO THE ENGINE IMPLEMENTS IS OFFERED. `MACRO_IDS` is the list, and a macro that exists
 * without a way to reach it is a feature nobody can use; `smart-build.test.ts` holds the two equal
 * so a sixth cannot be written and left stranded. `patch-tree`/`patch-flora` are the object
 * shelf's two cards, which is why the surfaces here are not only the terrain ones.
 */
import type { MacroId } from '../../../tools/macros';
import type { Glyph } from '../frame';
import type { TerrainSurface } from './terrain-cells';

/** The shelves that offer smart build: the three terrain surfaces, and the object shelf. */
export type SmartSurface = TerrainSurface | 'object';

import smartGlyph from '../../../assets/shell/shelf-mountain/tools/smart-build/polygon.svg';

export interface SmartAction {
  id: MacroId;
  /** What the open cell names it. */
  labelKey: string;
  /** Whether it builds at a cell the user points at. */
  aim: boolean;
}

export const SMART_MENU: Record<SmartSurface, readonly SmartAction[]> = {
  mountain: [
    // ONE verb: a tap lays a mound, a hold climbs it a terrace at a time, a drag lays a ridge. Split
    // into two entries it is one builder behind a boolean, offering two names for a choice nobody
    // could make.
    { id: 'raise', labelKey: 'smart.raise', aim: true },
  ],
  water: [
    { id: 'stream', labelKey: 'smart.stream', aim: true },
  ],
  road: [
    // `roads` is the WHOLE-MAP press: no aim, over the painted region when one stands, else the
    // whole buildable map, one edit and one undo entry per press. `road-link` AIMS: a press marks
    // a point (or spurs one building's own gate) and a second press commits.
    { id: 'roads', labelKey: 'smart.roads', aim: false },
    { id: 'road-link', labelKey: 'smart.road_link', aim: true },
  ],
  // Coverage-test data only: `SmartBuild` (the segment row that would show both labels at once)
  // never mounts on this surface, since `surface` there is typed `TerrainSurface`, which excludes
  // 'object'. The object shelf's own card (`ItemCard.tsx:SmartCard`) is one card per category tab
  // and hardcodes `smart.patch` directly, never reading `labelKey` from here. The duplicate below
  // would collide if either of those ever changed to render this list as segments.
  object: [
    { id: 'patch-tree', labelKey: 'smart.patch', aim: true },
    { id: 'patch-flora', labelKey: 'smart.patch', aim: true },
  ],
};

/** The smart-build mark and the command that reaches it. */
export const SMART = {
  /** The keyboard command that arms smart build, so the cell wears a badge like the seven tools
   *  beside it. The binding itself is the keymap's (`core/runtime/keybindings`), read live: this
   *  names which command the control is, and `terrain-bar.test.tsx` holds the two ends together. */
  commandId: 'tool.smart',
  /** The star as a `Glyph`, so the cell can be a `ToolCell` like the seven beside it — and so the
   *  object shelf's card can draw the same mark. The ink is MEASURED off the drawing's own paths
   *  (bbox, filled area, centroid), the way every sibling glyph's is: claiming the whole box as
   *  ink over-weights `apparentSize` and draws the star a quarter smaller than the row it stands
   *  in. */
  cellGlyph: {
    w: 93, h: 67,
    ink: { x: 3.04, y: 6.04, w: 85.87, h: 54.94, gx: 45.39, gy: 34.06, area: 2020.7 },
    parts: [{ src: smartGlyph, x: 0, y: 0, w: 93, h: 67 }],
  } as Glyph,
} as const;
