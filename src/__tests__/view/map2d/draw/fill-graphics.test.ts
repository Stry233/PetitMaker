// @vitest-environment jsdom
/**
 * FillGraphics replays a fill-only Graphics itself on the Canvas2D fallback, to compute the
 * '#rrggbb' style once per colour instead of once per item. The promise is that the canvas sees
 * the same drawing calls with the same effective style state, so these tests render the same
 * content twice — once through pixi's own CanvasGraphicsRenderer, once through FillGraphics — into
 * a recording context and compare the two op logs. The second half pins the gate: content the
 * replay does not recognise is handed back to pixi rather than approximated.
 */
import '../../../_support/pixi-env';
import { describe, it, expect, vi } from 'vitest';
import * as PIXI from 'pixi.js-legacy';
import { FillGraphics } from '../../../../view/map2d/draw/fill-graphics';

/** A 2D context that logs every draw with the style state in force at that moment. */
function recordingContext(): { ops: string[]; fillWrites: () => number; ctx: CanvasRenderingContext2D } {
  const ops: string[] = [];
  let fill = '';
  let fillWrites = 0;
  let alpha = 1;
  let path: string[] = [];
  const ctx = {
    set fillStyle(v: string) { fill = v; fillWrites++; },
    get fillStyle() { return fill; },
    set globalAlpha(v: number) { alpha = v; },
    get globalAlpha() { return alpha; },
    set strokeStyle(_v: string) { /* no stroke in these fixtures */ },
    set lineWidth(_v: number) { /* pixi writes these per item; they draw nothing */ },
    set lineCap(_v: string) { /* as above */ },
    set lineJoin(_v: string) { /* as above */ },
    set miterLimit(_v: number) { /* as above */ },
    fillRect: (x: number, y: number, w: number, h: number) =>
      ops.push(`fillRect ${x},${y},${w},${h} fill=${fill} alpha=${alpha}`),
    strokeRect: (x: number, y: number, w: number, h: number) =>
      ops.push(`strokeRect ${x},${y},${w},${h} alpha=${alpha}`),
    beginPath: () => { path = []; },
    moveTo: (x: number, y: number) => path.push(`M${x},${y}`),
    lineTo: (x: number, y: number) => path.push(`L${x},${y}`),
    closePath: () => path.push('Z'),
    fill: () => ops.push(`fill ${path.join(' ')} fill=${fill} alpha=${alpha}`),
    stroke: () => ops.push(`stroke ${path.join(' ')}`),
    arc: (x: number, y: number, r: number) => path.push(`A${x},${y},${r}`),
  };
  return { ops, fillWrites: () => fillWrites, ctx: ctx as unknown as CanvasRenderingContext2D };
}

function harness() {
  const { ops, fillWrites, ctx } = recordingContext();
  const renderer = {
    canvasContext: { activeContext: ctx, setContextTransform: vi.fn(), setBlendMode: vi.fn() },
    plugins: {},
  } as unknown as PIXI.CanvasRenderer;
  const plugin = new PIXI.CanvasGraphicsRenderer(renderer);
  (renderer as unknown as { plugins: Record<string, unknown> }).plugins = { graphics: plugin };
  return { ops, fillWrites, renderer, plugin };
}

/** What pixi's own renderer makes of this content — the reference log. */
function reference(build: (g: PIXI.Graphics) => void, tint?: number): string[] {
  const { ops, plugin } = harness();
  const g = new PIXI.Graphics();
  if (tint !== undefined) g.tint = tint;
  build(g);
  g.finishPoly();
  plugin.render(g);
  return ops;
}

/** What FillGraphics makes of it, how often it set the fill style, and whether it handed the work back to pixi. */
function replayed(
  build: (g: PIXI.Graphics) => void,
  tint?: number,
): { ops: string[]; fillWrites: number; delegated: boolean } {
  const { ops, fillWrites, renderer, plugin } = harness();
  const spy = vi.spyOn(plugin, 'render');
  const g = new FillGraphics();
  if (tint !== undefined) g.tint = tint;
  build(g);
  g._renderCanvas(renderer);
  return { ops, fillWrites: fillWrites(), delegated: spy.mock.calls.length > 0 };
}

/* The terrain's own shape: half-tile quadrant rects in long same-colour runs, with the odd
   trimmed corner as a triangle and a fillet drawn over it at a different alpha. */
const terrainLike = (g: PIXI.Graphics): void => {
  const colors = [0xa3d070, 0xa3d070, 0x93c956, 0x93c956, 0x93c956, 0x97e1ff];
  for (let i = 0; i < colors.length; i++) {
    g.beginFill(colors[i]!, 1);
    g.drawRect(i * 32, 0, 32, 32);
    g.endFill();
  }
  g.beginFill(0x5cb837, 1);
  g.moveTo(0, 64); g.lineTo(32, 64); g.lineTo(0, 96); g.closePath();
  g.endFill();
  g.beginFill(0x1b7511, 0.6);
  g.drawRect(64, 64, 32, 32);
  g.endFill();
};

describe('FillGraphics — the Canvas2D fill replay', () => {
  it('draws what pixi draws, in the same order, under the same style state', () => {
    const ref = reference(terrainLike);
    const fast = replayed(terrainLike);
    expect(fast.delegated).toBe(false);
    expect(fast.ops).toEqual(ref);
    expect(ref.length).toBe(8);
  });

  it('carries a tint through the same conversion pixi uses', () => {
    const ref = reference(terrainLike, 0xff8844);
    const fast = replayed(terrainLike, 0xff8844);
    expect(fast.delegated).toBe(false);
    expect(fast.ops).toEqual(ref);
    // A tint that is not white must actually change the drawn colours, or this proves nothing.
    expect(ref).not.toEqual(reference(terrainLike));
  });

  it('sets the fill style once per run of one colour, not once per item', () => {
    const ref = reference(terrainLike);
    const colours = ref.map((o) => o.split('fill=')[1]!.split(' ')[0]);
    const runs = colours.filter((c, i) => i === 0 || c !== colours[i - 1]).length;
    expect(runs).toBeLessThan(ref.length);
    expect(replayed(terrainLike).fillWrites).toBe(runs);
  });

  const unsupported: Array<[string, (g: PIXI.Graphics) => void]> = [
    ['a line style', (g) => { g.lineStyle(2, 0x000000, 1); g.beginFill(0xff0000); g.drawRect(0, 0, 8, 8); g.endFill(); }],
    ['a hole', (g) => { g.beginFill(0xff0000); g.drawRect(0, 0, 32, 32); g.beginHole(); g.drawRect(8, 8, 8, 8); g.endHole(); g.endFill(); }],
    ['a circle', (g) => { g.beginFill(0xff0000); g.drawCircle(16, 16, 8); g.endFill(); }],
    ['a textured fill', (g) => { g.beginTextureFill({ texture: PIXI.Texture.EMPTY }); g.drawRect(0, 0, 8, 8); g.endFill(); }],
  ];
  for (const [what, build] of unsupported) {
    it(`hands ${what} back to pixi untouched`, () => {
      const fast = replayed(build);
      expect(fast.delegated).toBe(true);
      expect(fast.ops).toEqual(reference(build));
    });
  }

  it('is what the terrain chunks and the zone base are made of', async () => {
    const { TerrainLayer } = await import('../../../../view/map2d/layers/terrain-layer');
    const { BaseLayer } = await import('../../../../view/map2d/layers/base-layer');
    const { makeState, setTerrain } = await import('../../../_support/map-state');
    const { TerrainType } = await import('../../../../core/model/types');
    const state = makeState(8, 8);
    setTerrain(state, 1, 1, TerrainType.Mountain, 2);

    const terrain = new TerrainLayer(() => {});
    terrain.drawFull(state);
    const base = new BaseLayer(() => {});
    base.drawFull(state);

    const graphics: PIXI.Graphics[] = [];
    const walk = (c: PIXI.Container): void => {
      for (const ch of c.children) {
        if (ch instanceof PIXI.Graphics) graphics.push(ch);
        else if (ch instanceof PIXI.Container) walk(ch);
      }
    };
    walk(terrain.container);
    walk(base.container);
    expect(graphics.length).toBeGreaterThan(0);
    expect(graphics.every((g) => g instanceof FillGraphics)).toBe(true);
  });
});
