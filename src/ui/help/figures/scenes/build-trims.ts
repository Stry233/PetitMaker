/** The Help Center's trim scenes: one corner, several at once, a notch, and a road's corners. */
import { trimRoadCommand } from '../../../../core/model/command-build';
import { TerrainType, type Corners } from '../../../../core/model/types';
import { validateCut } from '../../../../core/domain/edge-cut/cut-validator';
import { CORNER_INDEX, SQUARE_CORNERS } from '../../../../core/model/corners';
import { CANONICAL_ROAD_STATES, canonicalToActual, cornersMatch, detectRoadConn } from '../../../../core/domain/edge-cut/road-cut-states';
import { roadLookup } from '../../../../state/object-index';
import { SandboxWorld } from '../../../../editor/sandbox/demo-world';
import { rect, ROAD_TILE, type Stage, type SceneStep, trimCmd, type HelpScene } from './common';
import type { TextKey } from '../../../../i18n/keys';


const trim: HelpScene = {
  stage: { x1: 66, y1: 98, x2: 79, y2: 105, tile: 26 },
  strip: { kind: 'tools', active: 'draw' },
  run: ({ world }) => {
    world.beginStroke();
    const block = rect(71, 100, 72, 101);
    world.paint(block, TerrainType.Mountain, 1);
    world.paint(block, TerrainType.Mountain, 2);
    world.commit();
    return [
      { move: { strip: 2 }, pointer: 'clickable', dur: 550 },
      { press: true, tool: 'trim', dur: 500 },
      { press: false, capKey: 'help.fig.trim_1', move: [72.9, 101.9], pointer: 'edge-cut', dur: 550 },
      { press: true, dur: 160, on: ({ world: w }) => { w.execute(trimCmd(w, 72, 101, CORNER_INDEX.BR, 1)); } },
      { press: false, dur: 800 },
      { capKey: 'help.fig.trim_2', press: true, dur: 160, on: ({ world: w }) => { w.execute(trimCmd(w, 72, 101, CORNER_INDEX.BR, 2)); } },
      { press: false, dur: 800 },
      { capKey: 'help.fig.trim_3', press: true, dur: 160, on: ({ world: w }) => { w.execute(trimCmd(w, 72, 101, CORNER_INDEX.BR, 0)); } },
      { press: false, dur: 900 },
    ];
  },
};

/** The stage both trim figures share with the page's lead: close enough that one corner reads. */
const TRIM_STAGE: Stage = { x1: 66, y1: 98, x2: 79, y2: 105, tile: 26 };

/** A diagonal pinch: two blocks meeting corner to corner, so one intersection carries two cut
 *  sites. Every click here goes through the real tool (`SandboxWorld.trimClick`), which is what makes
 *  the combinations the figure walks the live cycle's own. */
const trimmulti: HelpScene = {
  stage: TRIM_STAGE,
  run: ({ world }) => {
    world.beginStroke();
    world.paint(rect(68, 99, 69, 100), TerrainType.Mountain, 1);
    world.commit();
    world.beginStroke();
    world.paint(rect(70, 101, 71, 102), TerrainType.Mountain, 1);
    world.commit();
    // The vertex the two blocks share: the tool gathers both their corners there.
    const pinch = { x: 69, y: 100 };
    const click = (capKey: TextKey | null): SceneStep[] => [
      { capKey, press: true, dur: 170, on: ({ world: w }) => { w.trimClick(pinch.x, pinch.y); } },
      { press: false, dur: 850 },
    ];
    return [
      { capKey: 'help.fig.trimmulti_1', move: [pinch.x + 0.9, pinch.y + 0.9], pointer: 'edge-cut', dur: 700 },
      ...click('help.fig.trimmulti_2'),
      ...click(null),
      ...click('help.fig.trimmulti_3'),
      ...click(null),
      { dur: 900 },
    ];
  },
};

/** A concave corner hard against terrain one layer taller: the click rounds the taller block, and
 *  what it leaves in the hollow is a cosmetic patch rather than ground to build on. */
const trimnotch: HelpScene = {
  stage: TRIM_STAGE,
  run: ({ world }) => {
    world.beginStroke();
    world.paint(rect(72, 99, 74, 101), TerrainType.Mountain, 1);
    world.commit();
    // An L at the upper tier, its inside angle around the one cell left a layer lower.
    world.beginStroke();
    world.paint([{ x: 72, y: 99 }, { x: 73, y: 99 }, { x: 74, y: 99 }, { x: 72, y: 100 }, { x: 72, y: 101 }], TerrainType.Mountain, 2);
    world.commit();
    const notch = { x: 72, y: 99 };
    return [
      { capKey: 'help.fig.trimnotch_1', move: [notch.x + 0.9, notch.y + 0.9], pointer: 'edge-cut', dur: 750 },
      { press: true, dur: 170, on: ({ world: w }) => { w.trimClick(notch.x, notch.y); } },
      { press: false, capKey: 'help.fig.trimnotch_2', dur: 1300 },
      { press: true, dur: 170, on: ({ world: w }) => { w.trimClick(notch.x, notch.y); } },
      { press: false, capKey: 'help.fig.trimnotch_3', dur: 1800 },
    ];
  },
};

/** The next cut for a connected road tile, exactly as the live tool cycles it: the canonical
 *  state table walked in order, each candidate held to `validateCut` for the tile's own seam, the
 *  first legal one landed as the command (`afterCorners` stays canonical; the renderer rotates by
 *  connection side). */
function roadTrimClick(world: SandboxWorld, tile: { x: number; y: number }): void {
  const roads = roadLookup(world.state);
  const roadObj = roads(tile.x, tile.y);
  if (!roadObj) return;
  const conn = detectRoadConn(roads, roadObj);
  let currentIdx = 0;
  for (let i = 0; i < CANONICAL_ROAD_STATES.length; i++) {
    if (cornersMatch(roadObj.corners, CANONICAL_ROAD_STATES[i])) { currentIdx = i; break; }
  }
  for (let i = 1; i < CANONICAL_ROAD_STATES.length; i++) {
    const nextIdx = (currentIdx + i) % CANONICAL_ROAD_STATES.length;
    const canonical = CANONICAL_ROAD_STATES[nextIdx];
    const corners: Corners = canonical ? [...canonical] : [...SQUARE_CORNERS];
    if (!validateCut(world.state, roads, { x: tile.x, y: tile.y }, 'road', canonicalToActual(corners, conn))) continue;
    world.execute(trimRoadCommand(roadObj, tile.x, tile.y, corners));
    return;
  }
}

const roadtrim: HelpScene = {
  stage: { x1: 66, y1: 98, x2: 79, y2: 105, tile: 26 },
  strip: { kind: 'tools', active: 'draw', surface: 'road' },
  run: ({ world }) => {
    world.place(ROAD_TILE, 71, 101);
    world.place(ROAD_TILE, 72, 101);
    world.place(ROAD_TILE, 73, 101);
    const end = { x: 73, y: 101 };
    return [
      { move: { strip: 2 }, pointer: 'clickable', dur: 550 },
      { press: true, tool: 'trim', dur: 500 },
      { press: false, capKey: 'help.fig.roadtrim_1', move: [73.9, 101.9], pointer: 'edge-cut', dur: 550 },
      { press: true, dur: 160, on: ({ world: w }) => { roadTrimClick(w, end); } },
      { press: false, dur: 900 },
      { capKey: 'help.fig.roadtrim_2', press: true, dur: 160, on: ({ world: w }) => { roadTrimClick(w, end); } },
      { press: false, dur: 900 },
      { capKey: 'help.fig.roadtrim_3', press: true, dur: 160, on: ({ world: w }) => { roadTrimClick(w, end); } },
      { press: false, dur: 1100 },
    ];
  },
};

export const BUILD_TRIM_SCENES: Record<string, HelpScene> = { trim, trimmulti, trimnotch, roadtrim };
