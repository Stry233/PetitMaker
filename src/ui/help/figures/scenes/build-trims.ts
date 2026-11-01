/** The Help Center's trim scenes: one corner, several at once, a notch, and a road's corners, each
 *  click pressed through the world's live corner trim at the pictured pointer. */
import { TerrainType } from '../../../../core/model/types';
import { Hand, pickTool, rect, ROAD_TILE, TRIM, type Stage, type SceneStep, type HelpScene } from './common';
import type { TextKey } from '../../../../i18n/keys';


/** The stage the trim figures share with the page's lead: close enough that one corner reads. */
const TRIM_STAGE: Stage = { x1: 66, y1: 98, x2: 79, y2: 105, tile: 26 };

/** One click where the hand stands, captioned `capKey` when a beat names one. */
function click(hand: Hand, capKey: TextKey | null | undefined, settle: number): SceneStep[] {
  return [hand.press({ ...(capKey === undefined ? {} : { capKey }), dur: 170 }), hand.release({ dur: settle })];
}

const trim: HelpScene = {
  stage: TRIM_STAGE,
  plot: { x1: 71, y1: 100, x2: 72, y2: 101 },
  strip: { kind: 'tools', active: 'draw' },
  run: ({ world }, _t, form) => {
    world.beginStroke();
    const block = rect(71, 100, 72, 101);
    world.paint(block, TerrainType.Mountain, 1);
    world.paint(block, TerrainType.Mountain, 2);
    world.commit();
    const hand = new Hand(form);
    // The block's south-east vertex: the corner the trim cycles is the one the pointer is on.
    return [
      hand.strip(2, { pointer: 'clickable', dur: 550 }),
      { press: true, tool: 'trim', dur: 500, on: (c) => pickTool(c, TRIM) },
      hand.glide(72.5, 101.5, { press: false, capKey: 'help.fig.trim_1', pointer: 'edge-cut', dur: 550 }),
      ...click(hand, undefined, 800),
      ...click(hand, 'help.fig.trim_2', 800),
      ...click(hand, 'help.fig.trim_3', 900),
    ];
  },
};

/** A diagonal pinch: two blocks meeting corner to corner, so one vertex carries two cut sites and
 *  each click steps the tool's own odometer over both. */
const trimmulti: HelpScene = {
  stage: TRIM_STAGE,
  plot: { x1: 68, y1: 99, x2: 71, y2: 102 },
  run: (ctx, _t, form) => {
    const { world } = ctx;
    world.beginStroke();
    world.paint(rect(68, 99, 69, 100), TerrainType.Mountain, 1);
    world.commit();
    world.beginStroke();
    world.paint(rect(70, 101, 71, 102), TerrainType.Mountain, 1);
    world.commit();
    pickTool(ctx, TRIM);
    const hand = new Hand(form);
    return [
      hand.glide(69.5, 100.5, { capKey: 'help.fig.trimmulti_1', pointer: 'edge-cut', dur: 700 }),
      ...click(hand, 'help.fig.trimmulti_2', 850),
      ...click(hand, null, 850),
      ...click(hand, 'help.fig.trimmulti_3', 850),
      ...click(hand, null, 850),
      { dur: 900 },
    ];
  },
};

/** A concave corner hard against terrain one layer taller: the click rounds the taller block, and
 *  what it leaves in the hollow is a cosmetic patch rather than ground to build on. */
const trimnotch: HelpScene = {
  stage: TRIM_STAGE,
  plot: { x1: 72, y1: 99, x2: 74, y2: 101 },
  run: (ctx, _t, form) => {
    const { world } = ctx;
    world.beginStroke();
    world.paint(rect(72, 99, 74, 101), TerrainType.Mountain, 1);
    world.commit();
    // An L at the upper tier, its inside angle around the one cell left a layer lower.
    world.beginStroke();
    world.paint([{ x: 72, y: 99 }, { x: 73, y: 99 }, { x: 74, y: 99 }, { x: 72, y: 100 }, { x: 72, y: 101 }], TerrainType.Mountain, 2);
    world.commit();
    pickTool(ctx, TRIM);
    const hand = new Hand(form);
    // The hollow's north-west vertex, where the L's inside angle meets it.
    return [
      hand.glide(72.5, 99.5, { capKey: 'help.fig.trimnotch_1', pointer: 'edge-cut', dur: 750 }),
      ...click(hand, 'help.fig.trimnotch_2', 1300),
      ...click(hand, 'help.fig.trimnotch_3', 1800),
    ];
  },
};

const roadtrim: HelpScene = {
  stage: TRIM_STAGE,
  plot: { x1: 71, y1: 101, x2: 73, y2: 101 },
  strip: { kind: 'tools', active: 'draw', surface: 'road' },
  run: ({ world }, _t, form) => {
    world.place(ROAD_TILE, 71, 101);
    world.place(ROAD_TILE, 72, 101);
    world.place(ROAD_TILE, 73, 101);
    const hand = new Hand(form);
    // On the street's east end tile: the tool cycles that tile through the cuts its junction allows.
    return [
      hand.strip(2, { pointer: 'clickable', dur: 550 }),
      { press: true, tool: 'trim', dur: 500, on: (c) => pickTool(c, TRIM) },
      hand.glide(73.7, 101.5, { press: false, capKey: 'help.fig.roadtrim_1', pointer: 'edge-cut', dur: 550 }),
      ...click(hand, undefined, 900),
      ...click(hand, 'help.fig.roadtrim_2', 900),
      ...click(hand, 'help.fig.roadtrim_3', 1100),
    ];
  },
};

export const BUILD_TRIM_SCENES: Record<string, HelpScene> = { trim, trimmulti, trimnotch, roadtrim };
