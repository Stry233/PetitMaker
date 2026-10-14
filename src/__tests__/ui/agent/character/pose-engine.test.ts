// @vitest-environment jsdom
/** Pins the PoseEngine against fake parts and a test clock: dwell, badges, cues and disposal. */
import { describe, it, expect } from 'vitest';
import { PoseEngine, type PoseClock, type PoseParts } from '../../../../ui/agent/character/pose-engine';
import { POSE_DWELL, POSES, WAKE_BEAT } from '../../../../ui/agent/character/poses';

interface Played { el: string; opts: KeyframeAnimationOptions }

/** Elements that record what was animated on them, and a clock the test advances. */
function rig() {
  const played: Played[] = [];
  const el = (name: string): HTMLElement => {
    const node = document.createElement('div');
    node.dataset.name = name;
    node.animate = ((_frames: Keyframe[], opts: KeyframeAnimationOptions) => {
      played.push({ el: name, opts });
      return { cancel: () => {}, persist: () => {}, playState: 'running' } as unknown as Animation;
    }) as HTMLElement['animate'];
    node.getAnimations = () => [];
    return node;
  };
  const parts: PoseParts = {
    root: el('root'), flip: el('flip'), pose: el('pose'), body: el('body'), badge: el('badge'), spin: el('spin'),
    lids: [el('lid-l'), el('lid-r')],
  };
  let now = 0;
  let queue: { at: number; fn: () => void; id: number }[] = [];
  let ids = 0;
  const clock: PoseClock = {
    set: (fn, ms) => { const id = ++ids; queue.push({ at: now + ms, fn, id }); return id; },
    clear: (id) => { queue = queue.filter((t) => t.id !== id); },
    now: () => now,
  };
  const advance = (ms: number) => {
    const until = now + ms;
    for (;;) {
      const next = queue.filter((t) => t.at <= until).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      queue = queue.filter((t) => t !== next);
      now = next.at;
      next.fn();
    }
    now = until;
  };
  const badges: (string | null)[] = [];
  const engine = new PoseEngine(parts, (id) => badges.push(id), 300, clock);
  return { engine, parts, played, advance, badges, pending: () => queue.length };
}

describe('the pose engine', () => {
  it('wears the first pose at once and holds a new one until the dwell ends', () => {
    const { engine, advance } = rig();
    engine.wear('idle', false);
    expect(engine.wearing).toBe('idle');
    engine.wear('thinking', false);
    expect(engine.wearing, 'inside the dwell').toBe('idle');
    engine.wear('working', false);
    advance(POSE_DWELL);
    expect(engine.wearing, 'the newest asked lands on the deadline').toBe('working');
  });

  it('wears every pose at once under reduced motion', () => {
    const { engine } = rig();
    engine.wear('idle', true);
    engine.wear('paused', true);
    expect(engine.wearing).toBe('paused');
  });

  it('closes the lids for sleep and opens them for anything else', () => {
    const { engine, parts, advance } = rig();
    engine.wear('sleeping', false);
    expect(parts.lids.every((lid) => lid.style.transform === 'scaleY(1)')).toBe(true);
    engine.wear('idle', false);
    advance(POSE_DWELL);
    expect(parts.lids.every((lid) => lid.style.transform === 'scaleY(0)')).toBe(true);
  });

  it('rises from sleep on a wake cue, and plays nothing for one while awake', () => {
    const { engine, played, advance } = rig();
    engine.wear('sleeping', false);
    advance(POSE_DWELL);
    played.length = 0;
    engine.wake();
    expect(played.filter((p) => p.el === 'pose').map((p) => p.opts.duration)).toEqual([WAKE_BEAT.dur]);
    engine.wear('idle', false);
    played.length = 0;
    engine.wake();
    expect(played).toEqual([]);
  });

  it('shows a garnish badge for its time and then the pose badge again', () => {
    const { engine, badges, advance } = rig();
    engine.wear('idle', true);
    badges.length = 0;
    engine.garnish([], { id: 'note', ms: 1000 });
    expect(badges).toEqual(['note']);
    advance(1000);
    expect(badges[badges.length - 1]).toBe(POSES.idle.badge);
  });

  it('leaves no timer standing once disposed', () => {
    const { engine, pending } = rig();
    engine.wear('working', false);
    engine.garnish([], { id: 'note', ms: 1000 });
    engine.dispose();
    expect(pending()).toBe(0);
    expect(engine.wearing).toBeNull();
  });

  it('plays garnish moves on the parts they name', () => {
    const { engine, played } = rig();
    engine.wear('idle', false);
    played.length = 0;
    engine.garnish([{ part: 'body', dur: 120, easing: 'linear', composite: 'add', keyframes: [] }]);
    expect(played).toEqual([{ el: 'body', opts: expect.objectContaining({ duration: 120, composite: 'add', fill: 'none' }) }]);
  });

  it('skips moves but keeps the badge under reduced motion', () => {
    const { engine, played, badges } = rig();
    engine.wear('idle', true);
    played.length = 0;
    engine.garnish([{ part: 'body', dur: 120, easing: 'linear', keyframes: [] }], { id: 'note', ms: 50 });
    expect(played).toEqual([]);
    expect(badges).toContain('note');
  });
});
