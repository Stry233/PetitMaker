import { vi } from 'vitest';

/** One animation `Element.animate` started, as the stand-in recorded it. */
export interface RecordedAnimation {
  target: Element;
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
  animation: StandInAnimation;
}

/** The part of `Animation` a page's code drives; time never advances on its own. */
export class StandInAnimation {
  id = '';
  playState: AnimationPlayState = 'running';
  currentTime: number | null = 0;
  readonly finished: Promise<this>;
  private settle!: (a: this) => void;
  private fail!: (e: unknown) => void;

  constructor(readonly target: Element, readonly keyframes: Keyframe[]) {
    this.finished = new Promise<this>((resolve, reject) => { this.settle = resolve; this.fail = reject; });
    this.finished.catch(() => {});
  }

  pause(): void { if (this.playState !== 'finished') this.playState = 'paused'; }
  play(): void { if (this.playState !== 'finished') this.playState = 'running'; }
  cancel(): void {
    if (this.playState === 'finished' || this.playState === 'idle') return;
    this.playState = 'idle';
    this.fail(new DOMException('cancelled', 'AbortError'));
  }
  finish(): void {
    if (this.playState === 'idle' || this.playState === 'finished') return;
    this.playState = 'finished';
    this.settle(this);
  }
}

const lengthOf = (v: string): number | null => {
  const n = parseFloat(v);
  return v === '' || v === 'auto' || Number.isNaN(n) ? null : n;
};

/**
 * jsdom lays nothing out and has no Web Animations. This lays out each element matching `laidOut`
 * from its own inline `left`, `right`, `top`, `bottom`, `width` and `height` against the window, in
 * its own px under the inline `zoom` of it and its ancestors, which draws them that much larger, moved
 * by the first `translate` of an additive animation on it, which stands at its start since time never
 * advances (its scale is not drawn), and stands in for
 * `Element.animate` and `KeyframeEffect`, recording every animation started. Returns the record and
 * the restore function.
 */
export function installWebAnimations(laidOut: string): { animations: RecordedAnimation[]; restore: () => void } {
  const animations: RecordedAnimation[] = [];
  const realRect = Element.prototype.getBoundingClientRect;
  const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (!(this instanceof HTMLElement) || !this.matches(laidOut)) return realRect.call(this);
    const s = this.style;
    let zoom = 1;
    for (let at: HTMLElement | null = this; at; at = at.parentElement) zoom *= lengthOf(at.style.zoom) ?? 1;
    const W = window.innerWidth / zoom, H = window.innerHeight / zoom;
    const [l, r, t, b] = [lengthOf(s.left), lengthOf(s.right), lengthOf(s.top), lengthOf(s.bottom)];
    const w = lengthOf(s.width) ?? (l !== null && r !== null ? W - l - r : 40);
    const h = lengthOf(s.height) ?? (t !== null && b !== null ? H - t - b : 40);
    let left = (l ?? (r !== null ? W - r - w : 0)) * zoom;
    let top = (t ?? (b !== null ? H - b - h : 0)) * zoom;
    for (const a of animations) {
      const live = a.animation.playState === 'paused' || a.animation.playState === 'running';
      if (a.target !== this || !live || a.options.composite !== 'add') continue;
      const m = /translate\(([-\d.e]+)px, ([-\d.e]+)px\)/.exec(String(a.keyframes[0]?.transform ?? ''));
      if (m) { left += Number(m[1]); top += Number(m[2]); }
    }
    const [width, height] = [w * zoom, h * zoom];
    return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}) } as DOMRect;
  });
  const hadAnimate = 'animate' in Element.prototype;
  const realAnimate = (Element.prototype as { animate?: unknown }).animate;
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    writable: true,
    value(this: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions = {}) {
      const animation = new StandInAnimation(this, keyframes);
      animations.push({ target: this, keyframes, options, animation });
      return animation;
    },
  });
  const hadEffect = 'KeyframeEffect' in globalThis;
  const realEffect = (globalThis as { KeyframeEffect?: unknown }).KeyframeEffect;
  Object.defineProperty(globalThis, 'KeyframeEffect', {
    configurable: true,
    writable: true,
    value: class {
      composite: CompositeOperation;
      constructor(_target: Element | null, _frames: Keyframe[], options: KeyframeEffectOptions = {}) {
        this.composite = options.composite ?? 'replace';
      }
    },
  });
  return {
    animations,
    restore: () => {
      rect.mockRestore();
      if (hadAnimate) Object.defineProperty(Element.prototype, 'animate', { configurable: true, writable: true, value: realAnimate });
      else delete (Element.prototype as { animate?: unknown }).animate;
      if (hadEffect) Object.defineProperty(globalThis, 'KeyframeEffect', { configurable: true, writable: true, value: realEffect });
      else delete (globalThis as { KeyframeEffect?: unknown }).KeyframeEffect;
    },
  };
}
