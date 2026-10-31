// @vitest-environment jsdom
/**
 * The re-arrangement morph's geometry: each piece is drawn from the box it stood in to the place the
 * new layout gives it, and nothing of the morph stays once it has run.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubCanvasContext } from '../../_support/canvas-context';
import { installWebAnimations, type RecordedAnimation } from '../../_support/web-animations';
import {
  MORPH_ANIMATION, MORPH_PIECE_ATTR, MORPH_PRESENCE_ATTR, MORPH_RAISED_ATTR, MORPH_SHAPE_ATTR, MORPH_STAND_IN_ATTR, MORPHING_ATTR,
  measureMorph, morphScope, onMorph, playMorph, restingRect, stopMorph, watchShownBoxes,
  type MorphRun,
} from '../../../ui/primitives/morph';
import { outSeconds, seconds } from '../../../ui/design/motion';

let env: ReturnType<typeof installWebAnimations>;

function sizeWindow(w: number, h: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: h });
}

function piece(id: string, box: { left: number; top: number; width: number; height: number }): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('data-morph', id);
  place(el, box);
  document.body.appendChild(el);
  return el;
}

function place(el: HTMLElement, { left, top, width, height }: { left: number; top: number; width: number; height: number }): void {
  Object.assign(el.style, { position: 'fixed', left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
}

const nextFrame = () => new Promise<void>((r) => { requestAnimationFrame(() => r()); });
const transformsOf = (el: Element) => env.animations
  .filter((a) => a.target === el && a.animation.id === MORPH_ANIMATION && a.keyframes[0]?.transform !== undefined);

/** Where a transform keyframe draws a piece laid out at `box`, scaled from its top left corner. */
function drawn(frame: Keyframe, box: { left: number; top: number; width: number; height: number }) {
  const m = /translate\(([-\d.e]+)px, ([-\d.e]+)px\) scale\(([-\d.e]+)(?:, ([-\d.e]+))?\)/.exec(String(frame.transform))!;
  const [tx, ty, sx] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const sy = m[4] === undefined ? sx : Number(m[4]);
  return { left: box.left + tx, top: box.top + ty, width: box.width * sx, height: box.height * sy };
}

beforeEach(() => {
  sizeWindow(800, 600);
  env = installWebAnimations('[data-morph], [data-morph-piece], [data-scope-root], [inert], [data-kid], [data-morph-presence], [data-clip]');
});

afterEach(() => {
  env.restore();
  document.body.innerHTML = '';
  document.documentElement.removeAttribute(MORPHING_ATTR);
});

describe('a re-arrangement drawn as a move', () => {
  it('starts each piece centred on the box it stood in at the same area and ends with no transform of its own', async () => {
    const el = piece('corner', { left: 10, top: 20, width: 100, height: 50 });
    const first = measureMorph();
    const now = { left: 300, top: 200, width: 200, height: 100 };
    place(el, now);
    playMorph(first, 'shell.shape.morph');
    const [move] = transformsOf(el) as [RecordedAnimation];
    const from = drawn(move.keyframes[0]!, now);
    // Area kept: a 100 x 50 piece now 200 x 100 starts at half its size, its centre on the old centre.
    expect(from.width * from.height).toBeCloseTo(100 * 50);
    expect(from.left + from.width / 2).toBeCloseTo(10 + 50);
    expect(from.top + from.height / 2).toBeCloseTo(20 + 25);
    expect(move.keyframes.at(-1)!.transform).toBe('translate(0px, 0px) scale(1)');
    expect(move.options.composite).toBe('add');
    expect(move.options.fill ?? 'none').toBe('none');
    expect(move.options.duration).toBe(seconds('shell.shape.morph') * 1000);
  });

  it('moves a piece that wears no transform of its own alone, not added to another, from the same start about its own origin', () => {
    const el = piece('rail', { left: 10, top: 20, width: 100, height: 50 });
    el.style.transformOrigin = '50px 25px';
    const first = measureMorph();
    const now = { left: 300, top: 200, width: 200, height: 100 };
    place(el, now);
    playMorph(first, 'shell.shape.morph');
    const [move] = transformsOf(el) as [RecordedAnimation];
    // A replacing transform is one the compositor can run while the main thread is busy.
    expect(move.options.composite ?? 'replace').toBe('replace');
    expect(env.animations.some((a) => a.target === el && a.keyframes[0]?.transformOrigin !== undefined), 'no origin of its own to hold').toBe(false);
    // Scaled about its origin, the translation folding that origin in: the same start as the added move.
    const m = /translate\(([-\d.e]+)px, ([-\d.e]+)px\) scale\(([-\d.e]+), ([-\d.e]+)\)/.exec(String(move.keyframes[0]!.transform))!;
    const [tx, ty, sx, sy] = m.slice(1).map(Number) as [number, number, number, number];
    const left = now.left + tx + 50 * (1 - sx), top = now.top + ty + 25 * (1 - sy);
    expect(now.width * sx * now.height * sy).toBeCloseTo(100 * 50);
    expect(left + (now.width * sx) / 2).toBeCloseTo(10 + 50);
    expect(top + (now.height * sy) / 2).toBeCloseTo(20 + 25);
    expect(move.keyframes.at(-1)!.transform).toBe('translate(0px, 0px) scale(1)');
  });

  it('reads an element inside a moving piece where the piece will stand, not where it is drawn on its way', () => {
    const el = piece('assistant', { left: 0, top: 0, width: 200, height: 100 });
    el.setAttribute(MORPH_SHAPE_ATTR, 'fill');
    const seat = document.createElement('div');
    seat.setAttribute('data-kid', '');
    el.appendChild(seat);
    const first = measureMorph();
    place(el, { left: 100, top: 300, width: 200, height: 100 });
    playMorph(first, 'shell.shape.morph');
    // Drawn with its piece at the piece's start, the old box.
    place(seat, { left: 10, top: 20, width: 20, height: 10 });
    const r = restingRect(seat);
    expect([r.left, r.top, r.width, r.height].map((v) => +v.toFixed(3))).toEqual([110, 320, 20, 10]);
    expect(restingRect(el).left, 'the piece itself, at its box').toBe(100);
    stopMorph();
    expect(restingRect(seat).left, 'with no morph running, where it is drawn').toBe(10);
  });

  it('[UI-28] reads an element inside a piece where it is drawn once the pass has run, so a later resize moves what is placed from it', async () => {
    const el = piece('assistant-block', { left: 0, top: 0, width: 100, height: 100 });
    const seat = document.createElement('div');
    seat.setAttribute('data-kid', '');
    el.appendChild(seat);
    place(seat, { left: 10, top: 10, width: 50, height: 50 });
    const first = measureMorph();
    place(el, { left: 200, top: 300, width: 100, height: 100 });
    place(seat, { left: 210, top: 310, width: 50, height: 50 });
    const told: MorphRun[] = [];
    const stop = onMorph((run) => told.push(run));
    playMorph(first, 'shell.shape.morph');
    await nextFrame();
    for (const a of env.animations) a.animation.finish();
    await told[0]!.settled;
    // A resize after the pass lays the piece out smaller elsewhere: the seat is read there.
    place(el, { left: 150, top: 250, width: 80, height: 80 });
    place(seat, { left: 158, top: 258, width: 40, height: 40 });
    const r = restingRect(seat);
    expect([r.left, r.top, r.width, r.height]).toEqual([158, 258, 40, 40]);
    stop();
  });

  it('[UI-27] fades the old content of a piece that re-flows out where it stood as the new fades in, so none of it jumps', () => {
    const el = piece('bar', { left: 0, top: 500, width: 400, height: 60 });
    el.setAttribute(MORPH_SHAPE_ATTR, 'span-start');
    const kid = document.createElement('div');
    kid.setAttribute('data-kid', '');
    kid.textContent = 'Brush Size';
    place(kid, { left: 300, top: 510, width: 80, height: 30 });
    el.appendChild(kid);
    const first = measureMorph();
    // The other mode's layout stands the control elsewhere in the same bar.
    place(kid, { left: 340, top: 510, width: 80, height: 30 });
    playMorph(first, 'shell.mode.resize');
    const copy = [...el.children].find((c) => c !== kid) as HTMLElement;
    expect(copy?.textContent, 'a copy of the old content stands in the bar').toBe('Brush Size');
    expect(copy.getAttribute('inert')).toBe('');
    const r = copy.getBoundingClientRect();
    expect([r.left, r.top], 'where the control stood').toEqual([300, 510]);
    const fades = env.animations.filter((a) => a.keyframes.some((k) => k.opacity !== undefined));
    expect(fades.some((a) => a.target === copy && a.keyframes.at(-1)!.opacity === 0), 'the copy fades out').toBe(true);
    expect(fades.some((a) => a.target === kid && a.keyframes[0]!.opacity === 0 && a.options.fill === 'backwards'), 'the new content fades in').toBe(true);
  });

  it('[UI-28] stands a piece that drops to a lower layer on its old rung while it is carried, and gives the rung back', () => {
    const el = piece('assistant', { left: 0, top: 0, width: 200, height: 300 });
    el.style.zIndex = '40';
    const first = measureMorph();
    el.style.zIndex = '2';
    place(el, { left: 0, top: 400, width: 400, height: 300 });
    playMorph(first, 'shell.shape.morph');
    expect(el.hasAttribute(MORPH_RAISED_ATTR), 'over what it stood over').toBe(true);
    expect(el.style.getPropertyValue('--morph-z')).toBe('40');
    expect(el.style.zIndex, 'the rung its owner gives it is left alone').toBe('2');
    stopMorph();
    expect(el.hasAttribute(MORPH_RAISED_ATTR)).toBe(false);
    expect(el.style.zIndex).toBe('2');
  });

  it('[UI-28] gives a layer the rung its owner set last when a second turn ends while it is still raised', () => {
    const el = piece('assistant', { left: 0, top: 0, width: 200, height: 300 });
    el.style.zIndex = '40';
    const one = measureMorph();
    el.style.zIndex = '2';
    place(el, { left: 0, top: 400, width: 400, height: 300 });
    playMorph(one, 'shell.shape.morph');
    const two = measureMorph();
    // The owner floats it again, over the map, as the second turn lands.
    el.style.zIndex = '40';
    place(el, { left: 0, top: 0, width: 200, height: 300 });
    playMorph(two, 'shell.shape.morph');
    stopMorph();
    expect(el.style.zIndex).toBe('40');
    expect(el.hasAttribute(MORPH_RAISED_ATTR)).toBe(false);
  });

  it('takes a plate marked to fill from its old box exactly, stretching it', () => {
    const el = piece('band', { left: 0, top: 500, width: 800, height: 100 });
    el.setAttribute(MORPH_SHAPE_ATTR, 'fill');
    const first = measureMorph();
    const now = { left: 0, top: 460, width: 800, height: 140 };
    place(el, now);
    playMorph(first, 'shell.mode.resize');
    const from = drawn(transformsOf(el)[0]!.keyframes[0]!, now);
    expect([from.left, from.top, from.width, from.height].map((v) => +v.toFixed(3))).toEqual([0, 500, 800, 100]);
  });

  it('scales a piece whose width the window decides by its heights, keeping its leading edge or its centre', () => {
    const start = piece('row', { left: 20, top: 500, width: 760, height: 80 });
    start.setAttribute(MORPH_SHAPE_ATTR, 'span-start');
    const centre = piece('notice', { left: 20, top: 300, width: 760, height: 40 });
    centre.setAttribute(MORPH_SHAPE_ATTR, 'span-centre');
    const first = measureMorph();
    const nowStart = { left: 30, top: 480, width: 740, height: 100 };
    const nowCentre = { left: 30, top: 290, width: 740, height: 50 };
    place(start, nowStart);
    place(centre, nowCentre);
    playMorph(first, 'shell.mode.resize');
    const a = drawn(transformsOf(start)[0]!.keyframes[0]!, nowStart);
    expect([a.left, a.top, a.height, a.width / a.height].map((v) => +v.toFixed(3))).toEqual([20, 500, 80, +(740 / 100).toFixed(3)]);
    const b = drawn(transformsOf(centre)[0]!.keyframes[0]!, nowCentre);
    expect(b.left + b.width / 2).toBeCloseTo(20 + 380);
    expect([b.top, b.height].map((v) => +v.toFixed(3))).toEqual([300, 40]);
  });

  it('starts a fitted piece evenly scaled within its old box, about its centre, whichever way its content re-flowed', () => {
    const wider = piece('caption', { left: 100, top: 500, width: 200, height: 60 });
    wider.setAttribute(MORPH_SHAPE_ATTR, 'fit');
    const first = measureMorph();
    // One line where it stood on two: by its heights it would start half again wider than it stood.
    const now = { left: 40, top: 300, width: 300, height: 30 };
    place(wider, now);
    playMorph(first, 'shell.mode.resize');
    const a = drawn(transformsOf(wider)[0]!.keyframes[0]!, now);
    expect(a.width / a.height).toBeCloseTo(300 / 30);
    expect(a.width).toBeCloseTo(200);
    expect(a.left).toBeCloseTo(100);
    expect(a.top + a.height / 2).toBeCloseTo(530);
  });

  it('draws a card whose content re-flows from its old outline exactly, its content at its own size from the card\'s top left corner', () => {
    const card = piece('window', { left: 100, top: 50, width: 400, height: 500 });
    card.setAttribute(MORPH_SHAPE_ATTR, 'card');
    card.style.overflow = 'hidden';
    const kid = (box: { left: number; top: number; width: number; height: number }) => {
      const el = document.createElement('div');
      el.setAttribute('data-kid', '');
      place(el, box);
      card.appendChild(el);
      return el;
    };
    const head = kid({ left: 100, top: 50, width: 400, height: 40 });
    const body = kid({ left: 100, top: 90, width: 400, height: 460 });
    const first = measureMorph();
    // Its content re-flows narrower and taller at the same zoom, still within the old outline.
    const now = { left: 150, top: 20, width: 300, height: 560 };
    place(card, now);
    place(head, { left: 150, top: 20, width: 300, height: 40 });
    place(body, { left: 150, top: 60, width: 300, height: 400 });
    playMorph(first, 'shell.mode.resize');
    const outline = transformsOf(card)[0]!;
    const from = drawn(outline.keyframes[0]!, now);
    expect([from.left, from.top, from.width, from.height].map((v) => +v.toFixed(3))).toEqual([100, 50, 400, 500]);
    const [sx, sy] = [400 / 300, 500 / 560];
    for (const el of [head, body]) {
      const [scale] = transformsOf(el) as [RecordedAnimation];
      const m = /scale\(([-\d.e]+), ([-\d.e]+)\)/.exec(String(scale.keyframes[0]!.transform))!;
      // Drawn under the card's own scale, the content stands evenly at its own size.
      expect(Number(m[1]) * sx).toBeCloseTo(1);
      expect(Number(m[2]) * sy).toBeCloseTo(1);
      expect(scale.keyframes.at(-1)!.transform).toBe('translate(0px, 0px) scale(1)');
      expect(scale.options.composite).toBe('add');
      const origin = env.animations.find((a) => a.target === el && a.keyframes[0]?.transformOrigin !== undefined)!;
      expect(origin.keyframes[0]!.transformOrigin).toBe(`${now.left - el.getBoundingClientRect().left}px ${now.top - el.getBoundingClientRect().top}px`);
    }
    // The card's own overflow cuts the content off at its outline; no clip of the morph's own is drawn.
    expect(env.animations.filter((a) => a.keyframes[0]?.clipPath !== undefined)).toEqual([]);
  });

  it('[UI-28] starts a card\'s content no larger than its old outline holds it, so its foot stays inside the outline all the way', () => {
    const card = piece('window', { left: 100, top: 300, width: 400, height: 300 });
    card.setAttribute(MORPH_SHAPE_ATTR, 'card');
    card.style.overflow = 'hidden';
    const body = document.createElement('div');
    body.setAttribute('data-kid', '');
    place(body, { left: 100, top: 300, width: 400, height: 300 });
    card.appendChild(body);
    const first = measureMorph();
    // Turned upright, the same content re-flows into a sheet twice as tall as the card stood.
    const now = { left: 0, top: 0, width: 400, height: 600 };
    place(card, now);
    place(body, { left: 0, top: 0, width: 400, height: 580 });
    playMorph(first, 'shell.shape.morph');
    const outline = transformsOf(card)[0]!;
    const sy = drawn(outline.keyframes[0]!, now).height / now.height;
    const [scale] = transformsOf(body) as [RecordedAnimation];
    for (const frame of scale.keyframes) {
      const p = Number(frame.offset);
      const m = /scale\(([-\d.e]+), ([-\d.e]+)\)/.exec(String(frame.transform));
      const own = m ? Number(m[2]) : 1;
      // The outline's height and the content's foot on the card's own axis at this point of the motion.
      const held = sy + (1 - sy) * p;
      expect(own * held * 580).toBeLessThanOrEqual(held * 600 + 1e-6);
    }
    // At the start the content's foot stands on the old outline's foot.
    const m0 = /scale\(([-\d.e]+), ([-\d.e]+)\)/.exec(String(scale.keyframes[0]!.transform))!;
    expect(Number(m0[2]) * sy * 580).toBeCloseTo(sy * 600);
  });

  it('carries the old centres across a window resized since the first measure, in proportion', () => {
    const el = piece('row', { left: 100, top: 500, width: 80, height: 40 });
    const first = measureMorph();
    sizeWindow(600, 800);
    const now = { left: 20, top: 20, width: 80, height: 40 };
    place(el, now);
    playMorph(first, 'shell.shape.morph');
    const from = drawn(transformsOf(el)[0]!.keyframes[0]!, now);
    expect(from.left + from.width / 2).toBeCloseTo((140 * 600) / 800);
    expect(from.top + from.height / 2).toBeCloseTo((520 * 800) / 600);
  });

  it('[UI-28] starts a piece from where the screen last showed it when the window turned before the morph measured', async () => {
    stopMorph();
    const stop = watchShownBoxes();
    const el = piece('row', { left: 100, top: 500, width: 80, height: 40 });
    await nextFrame();
    await nextFrame();
    // The window turns and lays the old arrangement out at its new size, which no frame shows,
    // before the commit that re-arranges is measured.
    sizeWindow(600, 800);
    place(el, { left: 100, top: 900, width: 80, height: 40 });
    const first = measureMorph();
    const now = { left: 20, top: 20, width: 80, height: 40 };
    place(el, now);
    playMorph(first, 'shell.shape.morph');
    const from = drawn(transformsOf(el)[0]!.keyframes[0]!, now);
    // From the box last shown, carried across the turn in proportion.
    expect(from.left + from.width / 2).toBeCloseTo((140 * 600) / 800);
    expect(from.top + from.height / 2).toBeCloseTo((520 * 800) / 600);
    stop();
  });

  it('holds every piece at its start through the frame that lays out the new arrangement, then plays and tells its followers when it has settled', async () => {
    const el = piece('kit', { left: 0, top: 0, width: 40, height: 40 });
    const first = measureMorph();
    expect(document.documentElement.hasAttribute(MORPHING_ATTR)).toBe(true);
    place(el, { left: 200, top: 0, width: 40, height: 40 });
    const told: MorphRun[] = [];
    const stop = onMorph((run) => told.push(run));
    playMorph(first, 'shell.shape.morph');
    expect(document.documentElement.hasAttribute(MORPHING_ATTR)).toBe(false);
    const morph = env.animations.filter((a) => a.animation.id === MORPH_ANIMATION);
    expect(morph.length).toBeGreaterThan(0);
    expect(morph.every((a) => a.animation.playState === 'paused')).toBe(true);
    await nextFrame();
    expect(morph.every((a) => a.animation.playState === 'running')).toBe(true);
    expect(told).toHaveLength(1);
    let settled = false;
    void told[0]!.settled.then(() => { settled = true; });
    for (const a of morph.slice(1)) a.animation.finish();
    await Promise.resolve();
    expect(settled, 'a run settles only once all of it has').toBe(false);
    morph[0]!.animation.cancel();
    await told[0]!.settled;
    stop();
  });

  it('a held morph keeps its pieces where they stood until the same measure is played', async () => {
    const el = piece('kit', { left: 0, top: 0, width: 40, height: 40 });
    const first = measureMorph();
    place(el, { left: 200, top: 0, width: 40, height: 40 });
    playMorph(first, 'shell.shape.morph', { held: true });
    await nextFrame();
    const held = env.animations.filter((a) => a.animation.id === MORPH_ANIMATION);
    expect(held.every((a) => a.animation.playState === 'paused')).toBe(true);
    expect(document.documentElement.hasAttribute(MORPHING_ATTR)).toBe(true);
    playMorph(first, 'shell.shape.morph');
    expect(held.every((a) => a.animation.playState === 'idle')).toBe(true);
    expect(document.documentElement.hasAttribute(MORPHING_ATTR)).toBe(false);
  });

  it('fades in a piece only the new arrangement has, and fades out one only the old had where it stood, then removes it', async () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const gone = piece('band', { left: 0, top: 500, width: 800, height: 100 });
    parent.appendChild(gone);
    const first = measureMorph();
    gone.remove();
    const arrived = piece('handle', { left: 0, top: 300, width: 800, height: 20 });
    playMorph(first, 'shell.shape.morph');
    const fadeIn = env.animations.find((a) => a.target === arrived)!;
    expect(fadeIn.keyframes[0]).toMatchObject({ opacity: 0, offset: 0 });
    // The leaving piece stands back in its old parent, inert, over its old box.
    expect(gone.parentElement).toBe(parent);
    expect(gone.hasAttribute('inert')).toBe(true);
    expect(gone.hasAttribute('data-morph')).toBe(false);
    expect([gone.style.left, gone.style.top, gone.style.width, gone.style.height]).toEqual(['0px', '500px', '800px', '100px']);
    const fadeOut = env.animations.find((a) => a.target === gone)!;
    expect(fadeOut.keyframes.at(-1)).toMatchObject({ opacity: 0 });
    fadeOut.animation.finish();
    await fadeOut.animation.finished;
    await Promise.resolve();
    expect(gone.isConnected).toBe(false);
  });
});

describe('content only one arrangement shows', () => {
  function inPiece() {
    const host = piece('panel', { left: 0, top: 0, width: 800, height: 600 });
    const add = (id: string, box: { left: number; top: number; width: number; height: number }, parent: HTMLElement = host) => {
      const el = document.createElement('div');
      el.setAttribute(MORPH_PRESENCE_ATTR, id);
      place(el, box);
      parent.appendChild(el);
      return el;
    };
    return { host, add };
  }
  const fadesOf = (el: Element) => env.animations
    .filter((a) => a.target === el && a.animation.id === MORPH_ANIMATION && a.keyframes.some((k) => k.opacity !== undefined));

  it('fades in what is shown only now and fades out what was shown only before where it stood, leaving what both show alone', async () => {
    const { host, add } = inPiece();
    const kept = add('kept', { left: 10, top: 10, width: 100, height: 40 });
    const gone = add('keyboard', { left: 10, top: 300, width: 600, height: 200 });
    const first = measureMorph();
    gone.remove();
    const arrived = add('immersive', { left: 10, top: 60, width: 200, height: 30 });
    playMorph(first, 'shell.mode.resize');
    expect(fadesOf(kept)).toEqual([]);
    const [fadeIn] = fadesOf(arrived) as [RecordedAnimation];
    expect(fadeIn.keyframes[0]).toMatchObject({ opacity: 0, offset: 0 });
    // Over the same stretch as what leaves, so no moment shows neither.
    expect(fadeIn.options.delay ?? 0).toBe(0);
    expect(fadeIn.options.duration).toBe(outSeconds('shell.mode.resize') * 1000);
    // The leaving content stands back in its old parent, inert, over its old box, and is gone once faded.
    expect(gone.parentElement).toBe(host);
    expect(gone.hasAttribute('inert')).toBe(true);
    expect(gone.hasAttribute(MORPH_PRESENCE_ATTR)).toBe(false);
    expect([gone.style.left, gone.style.top, gone.style.width, gone.style.height]).toEqual(['10px', '300px', '600px', '200px']);
    const [fadeOut] = fadesOf(gone) as [RecordedAnimation];
    expect(fadeOut.keyframes.at(-1)).toMatchObject({ opacity: 0 });
    expect(fadeOut.options.duration).toBe(outSeconds('shell.mode.resize') * 1000);
    fadeOut.animation.finish();
    await fadeOut.animation.finished;
    await Promise.resolve();
    expect(gone.isConnected).toBe(false);
  });

  it('fades out a copy of what its scroller no longer shows, standing outside that scroller, and fades in what it now shows', () => {
    const { host, add } = inPiece();
    const row = document.createElement('div');
    row.setAttribute('data-clip', '');
    place(row, { left: 0, top: 500, width: 400, height: 80 });
    row.style.overflow = 'hidden';
    host.appendChild(row);
    const shown = add('card-a', { left: 300, top: 510, width: 60, height: 60 }, row);
    const hidden = add('card-b', { left: 500, top: 510, width: 60, height: 60 }, row);
    const first = measureMorph();
    // The row re-arranges: the first card scrolls past its end, the second into view.
    place(shown, { left: 450, top: 510, width: 60, height: 60 });
    place(hidden, { left: 200, top: 510, width: 60, height: 60 });
    playMorph(first, 'shell.mode.resize');
    expect(fadesOf(hidden)[0]!.keyframes[0]).toMatchObject({ opacity: 0, offset: 0 });
    // The card itself stays in its row; a copy of it, outside the scroller, fades where it stood.
    expect(shown.parentElement).toBe(row);
    const copy = [...host.children].find((el) => el !== row && el.hasAttribute('inert')) as HTMLElement;
    expect(copy).toBeDefined();
    expect([copy.style.left, copy.style.top]).toEqual(['300px', '510px']);
    expect(fadesOf(copy)[0]!.keyframes.at(-1)).toMatchObject({ opacity: 0 });
  });

  it('lets content inside an arriving piece arrive with it, and draws nothing in a scoped morph', () => {
    const first = measureMorph();
    const panel = piece('panel', { left: 0, top: 0, width: 400, height: 300 });
    const row = document.createElement('div');
    row.setAttribute(MORPH_PRESENCE_ATTR, 'row');
    place(row, { left: 10, top: 10, width: 100, height: 20 });
    panel.appendChild(row);
    playMorph(first, 'shell.mode.resize');
    expect(fadesOf(panel)).toHaveLength(1);
    expect(fadesOf(row)).toEqual([]);
  });
});

describe('a morph confined to one element', () => {
  function scene() {
    const root = document.createElement('div');
    root.setAttribute('data-scope-root', '');
    place(root, { left: 0, top: 400, width: 300, height: 100 });
    document.body.appendChild(root);
    const card = (id: string, box: { left: number; top: number; width: number; height: number }) => {
      const el = document.createElement('div');
      el.setAttribute(MORPH_PIECE_ATTR, id);
      place(el, box);
      root.appendChild(el);
      return el;
    };
    return { root, card };
  }

  it('draws each card from its old slot into its new one and ends at the layout, the page left alone', async () => {
    const chrome = piece('corner', { left: 600, top: 10, width: 40, height: 40 });
    const page = measureMorph();
    place(chrome, { left: 500, top: 10, width: 40, height: 40 });
    const told: MorphRun[] = [];
    const stop = onMorph((run) => told.push(run));
    playMorph(page, 'shell.shape.morph');
    const { root, card } = scene();
    const a = card('a', { left: 10, top: 420, width: 60, height: 60 });
    const scope = morphScope();
    const first = scope.measure(root);
    expect(root.hasAttribute(MORPHING_ATTR)).toBe(true);
    const now = { left: 80, top: 300, width: 60, height: 60 };
    place(a, now);
    scope.play(first, 'shelf.layout.morph');
    expect(root.hasAttribute(MORPHING_ATTR)).toBe(false);
    const [move] = transformsOf(a) as [RecordedAnimation];
    const from = drawn(move.keyframes[0]!, now);
    expect([from.left, from.top]).toEqual([10, 420]);
    expect(move.keyframes.at(-1)!.transform).toBe('translate(0px, 0px) scale(1)');
    expect(move.options.duration).toBe(seconds('shelf.layout.morph') * 1000);
    expect(transformsOf(chrome)[0]!.animation.playState, 'the page morph runs on').not.toBe('idle');
    expect(told, 'only the page morph tells its followers').toHaveLength(1);
    scope.stop();
    stop();
  });

  it('fades in a card that stood scrolled out of the element\'s box rather than flying it in', () => {
    const { root, card } = scene();
    const far = card('far', { left: 900, top: 420, width: 60, height: 60 });
    const scope = morphScope();
    const first = scope.measure(root);
    place(far, { left: 10, top: 420, width: 60, height: 60 });
    scope.play(first, 'shelf.layout.morph');
    expect(transformsOf(far)).toHaveLength(0);
    const fade = env.animations.find((r) => r.target === far && r.animation.id === MORPH_ANIMATION);
    expect(fade?.keyframes[0]?.opacity).toBe(0);
    scope.stop();
  });

  it('gives a card out of the element\'s box before and after no animation at all', () => {
    const { root, card } = scene();
    const far = card('far', { left: 900, top: 420, width: 60, height: 60 });
    const scope = morphScope();
    const first = scope.measure(root);
    place(far, { left: 10, top: 600, width: 60, height: 60 });
    scope.play(first, 'shelf.layout.morph');
    expect(env.animations.filter((r) => r.target === far)).toHaveLength(0);
    scope.stop();
  });

  it('a page morph pass leaves a running scoped pass running', () => {
    const { root, card } = scene();
    const one = card('one', { left: 10, top: 410, width: 60, height: 60 });
    const scope = morphScope();
    const first = scope.measure(root);
    place(one, { left: 100, top: 410, width: 60, height: 60 });
    scope.play(first, 'shelf.layout.morph');
    const scoped = env.animations.filter((r) => r.target === one && r.animation.id === MORPH_ANIMATION);
    expect(scoped.length).toBeGreaterThan(0);
    const chrome = piece('corner', { left: 600, top: 10, width: 40, height: 40 });
    const page = measureMorph();
    place(chrome, { left: 500, top: 10, width: 40, height: 40 });
    playMorph(page, 'shell.shape.morph');
    expect(scoped.every((r) => r.animation.playState !== 'idle')).toBe(true);
    stopMorph();
    scope.stop();
  });
});

describe('a re-flowing piece\'s crossfade', () => {
  /** A bar whose content re-flows, holding one control as a child. */
  function bar() {
    const el = piece('bar', { left: 0, top: 500, width: 400, height: 60 });
    el.setAttribute(MORPH_SHAPE_ATTR, 'span-start');
    const kid = document.createElement('div');
    kid.setAttribute('data-kid', '');
    place(kid, { left: 300, top: 510, width: 80, height: 30 });
    el.appendChild(kid);
    return { el, kid };
  }
  const copiesIn = (el: Element) => [...el.children].filter((c) => c.hasAttribute(MORPH_STAND_IN_ATTR)) as HTMLElement[];
  const fadesOf = (el: Element) => env.animations.filter((a) => a.target === el && a.keyframes.some((k) => k.opacity !== undefined));

  /** A canvas of 30 by 20 device px standing in 15 by 10 CSS px, as at a device pixel ratio of 2. */
  const sharpCanvas = (kid: HTMLElement): HTMLCanvasElement => {
    const canvas = document.createElement('canvas');
    canvas.width = 30;
    canvas.height = 20;
    Object.defineProperties(canvas, { offsetWidth: { value: 15 }, offsetHeight: { value: 10 } });
    kid.appendChild(canvas);
    return canvas;
  };

  it('[UI-27] shows a canvas in the old content\'s copy with the pixels it showed, one per CSS px', () => {
    const { el, kid } = bar();
    const canvas = sharpCanvas(kid);
    const drawImage = vi.fn();
    const context = stubCanvasContext({ drawImage });
    try {
      const first = measureMorph();
      place(kid, { left: 340, top: 510, width: 80, height: 30 });
      playMorph(first, 'shell.mode.resize');
    } finally {
      context.mockRestore();
    }
    const [copy] = copiesIn(el);
    const twin = copy!.querySelector('canvas')!;
    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(drawImage).toHaveBeenCalledWith(canvas, 0, 0, 15, 10);
    expect([twin.width, twin.height, twin.style.width, twin.style.height]).toEqual([15, 10, '15px', '10px']);
  });

  it('[UI-27] leaves a WebGL canvas\'s copy blank rather than read it outside its frame', () => {
    const { kid } = bar();
    const canvas = sharpCanvas(kid);
    const drawImage = vi.fn();
    // The live canvas holds a WebGL context, so it has no 2D one to hand back; its copy would.
    const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      return (this === canvas ? null : { drawImage }) as unknown as ReturnType<HTMLCanvasElement['getContext']>;
    });
    try {
      const first = measureMorph();
      place(kid, { left: 340, top: 510, width: 80, height: 30 });
      playMorph(first, 'shell.mode.resize');
    } finally {
      context.mockRestore();
    }
    expect(drawImage).not.toHaveBeenCalled();
  });

  it('[UI-27] fades content only one arrangement shows inside a re-flowing piece once, with the rest of its content', () => {
    const { el, kid } = bar();
    const pin = document.createElement('div');
    pin.setAttribute(MORPH_PRESENCE_ATTR, 'desk-pin');
    place(pin, { left: 10, top: 510, width: 30, height: 30 });
    el.appendChild(pin);
    const first = measureMorph();
    pin.remove();
    place(kid, { left: 340, top: 510, width: 80, height: 30 });
    playMorph(first, 'shell.mode.resize');
    expect(copiesIn(el), 'a copy of each old child, the pin among them').toHaveLength(2);
    expect(fadesOf(pin), 'the pin itself is not faded a second time').toEqual([]);
    expect(env.animations.filter((a) => a.target.hasAttribute(MORPH_STAND_IN_ATTR) && a.keyframes.at(-1)?.opacity === 0)).toHaveLength(2);
  });

  it('[UI-27] leaves stand-ins out of a piece\'s layout, so a second switch before the first has faded re-flows nothing that stands still', () => {
    const { el, kid } = bar();
    const one = measureMorph();
    place(kid, { left: 340, top: 510, width: 80, height: 30 });
    playMorph(one, 'shell.mode.resize');
    expect(copiesIn(el)).toHaveLength(1);
    const before = env.animations.length;
    const two = measureMorph();
    playMorph(two, 'shell.mode.resize');
    expect(copiesIn(el), 'the first pass\'s copy gone, and no new one').toHaveLength(0);
    expect(env.animations.slice(before).some((a) => a.target === kid && a.keyframes[0]?.opacity === 0), 'nothing fades in again').toBe(false);
  });
});

describe('a pass that reads the page again as it sets off', () => {
  it('[UI-27] fades in a piece a commit a frame later mounts', async () => {
    piece('kit', { left: 0, top: 0, width: 40, height: 40 });
    const first = measureMorph();
    playMorph(first, 'shell.mode.resize', { late: true });
    // A size observer's commit mounts the window's late controls before the next frame.
    const late = piece('late', { left: 100, top: 100, width: 40, height: 40 });
    await nextFrame();
    const [fade] = env.animations.filter((a) => a.target === late);
    expect(fade?.keyframes[0]).toMatchObject({ opacity: 0, offset: 0 });
    expect(fade!.animation.playState, 'held with the rest through the frame that lays it out').toBe('paused');
    await nextFrame();
    expect(fade!.animation.playState, 'and setting off with them').toBe('running');
  });

  it('[UI-28] sets off what a piece mounts once a pass that moves nothing is running, and settles that pass', async () => {
    const still = piece('corner', { left: 0, top: 0, width: 40, height: 40 });
    const first = measureMorph();
    // Only a fade runs: a notice the new arrangement shows arrives, and nothing travels.
    piece('toasts', { left: 300, top: 0, width: 80, height: 30 });
    const told: MorphRun[] = [];
    const stop = onMorph((run) => told.push(run));
    playMorph(first, 'shell.mode.resize', { late: true });
    await nextFrame();
    await nextFrame();
    // Content the standing piece mounts after the pass set off (a late commit of the turn).
    const kid = document.createElement('div');
    kid.setAttribute('data-kid', '');
    place(kid, { left: 4, top: 4, width: 20, height: 20 });
    still.appendChild(kid);
    await new Promise((r) => setTimeout(r, 0));
    const [fade] = env.animations.filter((a) => a.target === kid);
    expect(fade!.animation.playState, 'running with the pass, not held for a clock that never starts').toBe('running');
    let settled = false;
    void told[0]!.settled.then(() => { settled = true; });
    for (const a of env.animations) a.animation.finish();
    await told[0]!.settled;
    expect(settled).toBe(true);
    stop();
  });

  it('[UI-34] carries a piece\'s own opacity from the one it stood at', () => {
    const el = piece('mode-water', { left: 0, top: 0, width: 40, height: 40 });
    el.style.opacity = '0.4';
    const first = measureMorph();
    el.style.opacity = '1';
    place(el, { left: 200, top: 300, width: 60, height: 60 });
    playMorph(first, 'shell.shape.morph');
    const fade = env.animations.find((a) => a.target === el && a.keyframes[0]?.opacity !== undefined)!;
    expect(fade.keyframes.map((k) => k.opacity)).toEqual(['0.4', '1']);
    expect(fade.options.duration).toBe(seconds('shell.shape.morph') * 1000);
  });

  it('[UI-28] starts content only one arrangement shows from where its piece was last shown when the window turned first', async () => {
    stopMorph();
    const stop = watchShownBoxes();
    const host = piece('panel', { left: 100, top: 500, width: 200, height: 100 });
    const pin = document.createElement('div');
    pin.setAttribute(MORPH_PRESENCE_ATTR, 'pin');
    place(pin, { left: 110, top: 510, width: 20, height: 20 });
    host.appendChild(pin);
    await nextFrame();
    await nextFrame();
    sizeWindow(600, 800);
    place(host, { left: 100, top: 900, width: 200, height: 100 });
    place(pin, { left: 110, top: 910, width: 20, height: 20 });
    const first = measureMorph();
    pin.remove();
    place(host, { left: 20, top: 20, width: 200, height: 100 });
    playMorph(first, 'shell.shape.morph');
    // Shifted with its piece to where it was shown, then carried across the turn in proportion.
    expect(parseFloat(pin.style.top)).toBeCloseTo((520 * 800) / 600 - 10);
    stop();
  });
});
