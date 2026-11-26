/**
 * Render-on-demand bookkeeping both views drive: the render window a request opens, the move
 * sources that hold it open, the canvas beats they step, the paint waiters a drawn frame answers and
 * the dirty flags a frame flushes. Engine-free; each view supplies the clock that runs its frames.
 */
import type { EventBus } from '../../../core/commands/event-bus';
import type { EditorEvents } from '../../../state/editing/events';

/** Frames a request keeps drawing, so a mutation's follow-up work lands before the view rests. */
const RENDER_WINDOW_FRAMES = 4;
/** Frames a moving source keeps open past its last move. */
export const MOVE_WINDOW_FRAMES = 2;

export class FrameLoop {
  private window = 0;
  private waiters: Array<() => void> = [];

  /**
   * @param wake starts the view's clock for the next frame.
   * @param movers polled once per frame with the frame's time in ms, every one of them; a true
   *   answer means something moved.
   */
  constructor(private readonly wake: () => void, private readonly movers: ReadonlyArray<(now: number) => boolean> = []) {}

  /** Opens the render window (coalesced, spam-safe) and wakes the clock. */
  request(): void {
    this.window = RENDER_WINDOW_FRAMES;
    this.wake();
  }

  /** Keeps at least `frames` frames of the window open without waking the clock. */
  keepOpen(frames: number): void {
    this.window = Math.max(this.window, frames);
  }

  /** Polls the movers at `now`, the frame's time in ms, then spends one frame of the window; false
   *  when the window is closed. */
  advance(now: number): boolean {
    let moved = false;
    for (const mover of this.movers) if (mover(now)) moved = true;
    if (moved) this.keepOpen(MOVE_WINDOW_FRAMES);
    if (this.window <= 0) return false;
    this.window--;
    return true;
  }

  get isOpen(): boolean {
    return this.window > 0;
  }

  /** Runs `cb` after the next frame the view draws. A frame boundary proves nothing in a view that
   *  renders on demand, so the request also opens the window. */
  onNextPaint(cb: () => void): void {
    this.waiters.push(cb);
    this.request();
  }

  get awaitingPaint(): boolean {
    return this.waiters.length > 0;
  }

  /** A frame was drawn (or the view is gone and never will draw again): answers every waiter. */
  painted(): void {
    if (this.waiters.length === 0) return;
    const waiting = this.waiters;
    this.waiters = [];
    for (const cb of waiting) cb();
  }
}

/**
 * A canvas animation driven by a view's frame loop. A caller checks the reduced-motion gate
 * (`shared/motion/anim-config.ts`) before it plays one, landing on the end state instead.
 */
export interface Beat {
  /** One frame at `now`, the loop's time in ms; true while the beat wants another frame. */
  step(now: number): boolean;
  /** Lands on the end state at once: the view stopped drawing frames. */
  settle(): void;
}

/** Starts a beat on a view's loop and returns its cancel, which leaves it where it stands. */
export type PlayBeat = (beat: Beat) => () => void;

/** Plays nothing: every beat lands on its end state at once, for a layer drawn without a frame loop
 *  (a capture built off stage). */
export const settleAtOnce: PlayBeat = (beat) => {
  beat.settle();
  return () => {};
};

/** A beat over `durationMs`: `frame(t)` runs each frame with `t` the share of it gone, 0 on the first
 *  frame and exactly 1 on the last, and settling runs `frame(1)`. A false answer ends it where it is
 *  (what it moves is gone). */
export function timedBeat(durationMs: number, frame: (t: number) => boolean | void): Beat {
  let start: number | null = null;
  let done = false;
  return {
    step(now) {
      if (done) return false;
      start ??= now;
      const t = durationMs > 0 ? Math.min((now - start) / durationMs, 1) : 1;
      if (frame(t) === false || t >= 1) done = true;
      return !done;
    },
    settle() {
      if (done) return;
      done = true;
      frame(1);
    },
  };
}

/** The beats a view's loop steps: a mover that answers true while any runs. */
export class Beats {
  private readonly live = new Set<Beat>();

  /** @param wake opens the view's render window, so a beat's first frame is drawn. */
  constructor(private readonly wake: () => void) {}

  readonly play: PlayBeat = (beat) => {
    this.live.add(beat);
    this.wake();
    return () => { this.live.delete(beat); };
  };

  /** Steps every live beat at `now`; true while any still runs. */
  step(now: number): boolean {
    for (const beat of [...this.live]) if (this.live.has(beat) && !beat.step(now)) this.live.delete(beat);
    return this.live.size > 0;
  }

  /** Lands every live beat on its end state: the view stopped drawing. */
  settle(): void {
    const live = [...this.live];
    this.live.clear();
    for (const beat of live) beat.settle();
  }

  /** Drops every beat where it stands: what they move is being destroyed. */
  clear(): void {
    this.live.clear();
  }
}

/** Work an event marks and a frame runs once, in a fixed order, however many marks it received. */
export class DirtyFlags<K extends string> {
  private readonly marked = new Set<K>();

  /** @param flushes each flag's work, in the order a flush runs it. */
  constructor(private readonly flushes: ReadonlyArray<readonly [K, () => void]>) {}

  mark(key: K): void {
    this.marked.add(key);
  }

  /** Runs the marked work in declaration order, clearing each flag before its work runs. */
  flush(): void {
    if (this.marked.size === 0) return;
    for (const [key, run] of this.flushes) {
      if (!this.marked.delete(key)) continue;
      run();
    }
  }
}

type BusHandlers = { [K in keyof EditorEvents]?: (data: EditorEvents[K]) => void };

/** Subscribes every handler and returns one detach for them all. */
export function listenAll(bus: EventBus<EditorEvents>, handlers: BusHandlers): () => void {
  const offs = (Object.keys(handlers) as Array<keyof EditorEvents>).map((event) =>
    bus.on(event, handlers[event] as (data: EditorEvents[typeof event]) => void));
  return () => { for (const off of offs) off(); };
}
