// @vitest-environment jsdom
/**
 * Playback-driven decoding on a scripted video element: every frame reaches the consumer in order
 * whatever the page fails to present, a variable frame rate does not slow playback, and a page that
 * can neither present nor fetch the frames fails as busy.
 */
import { describe, expect, it, vi } from 'vitest';
import { FramePacer, OPEN_TIMEOUT_MS, openVideo, playFrames, VideoBusyError, VideoReadError, type PlaybackElement, type VideoFrameImage } from '../../../../pipelines/planet-scan/media/decode-browser';

/** A video element over frames at `times`, presenting those `present(index, rate)` allows. */
class FakeVideo extends EventTarget implements PlaybackElement {
  ended = false;
  readonly readyState = 4;
  playbackRate = 1;
  private time = 0;
  private playing = false;
  private next = 0;
  private callback: ((now: number, meta: { mediaTime: number }) => void) | null = null;
  decoded = 0;
  seeks = 0;
  /** Frame indices handed to the page's callback. */
  readonly presented: number[] = [];

  constructor(
    readonly times: readonly number[], private readonly present: (index: number, rate: number) => boolean, private readonly seekWorks = true,
    counts = true,
  ) {
    super();
    if (counts) this.getVideoPlaybackQuality = () => ({ totalVideoFrames: this.decoded });
  }

  get duration(): number { return this.times[this.times.length - 1]! + 1 / 60; }
  get currentTime(): number { return this.time; }
  set currentTime(t: number) {
    this.time = t;
    this.seeks++;
    let k = 0;
    while (k + 1 < this.times.length && this.times[k + 1]! <= t) k++;
    this.next = k + 1;
    this.decoded++;
    if (this.seekWorks) setTimeout(() => this.dispatchEvent(new Event('seeked')), 0);
  }

  /** The frame the element shows now. */
  shown(): number {
    let k = 0;
    while (k + 1 < this.times.length && this.times[k + 1]! <= this.time + 1e-9) k++;
    return k;
  }

  play(): Promise<void> {
    if (!this.playing) { this.playing = true; setTimeout(() => this.tick(), 0); }
    return Promise.resolve();
  }
  pause(): void { this.playing = false; }
  requestVideoFrameCallback(cb: (now: number, meta: { mediaTime: number }) => void): number { this.callback = cb; return 1; }
  cancelVideoFrameCallback(): void { this.callback = null; }
  getVideoPlaybackQuality?: () => { totalVideoFrames: number };

  private tick(): void {
    if (!this.playing) return;
    const k = this.next;
    if (k >= this.times.length) { this.playing = false; this.ended = true; this.dispatchEvent(new Event('ended')); return; }
    this.next++;
    this.time = this.times[k]! + 1e-4;
    this.decoded++;
    if (this.present(k, this.playbackRate) && this.callback) {
      const cb = this.callback;
      this.callback = null;
      this.presented.push(k);
      cb(0, { mediaTime: this.times[k]! });
    }
    setTimeout(() => this.tick(), 0);
  }
}

/** A frame whose first byte is the index of the frame the element shows. */
const drawOf = (video: FakeVideo) => (): VideoFrameImage => {
  const data = new Uint8ClampedArray(4);
  data[0] = video.shown() % 256;
  data[1] = video.shown() >> 8;
  return { width: 1, height: 1, data };
};

/** Plays `video` to its end on a fake clock, so the element's frame ticks and the decoder's seek
 *  deadline run in order and no machine load can fire a deadline early. */
async function collect(video: FakeVideo, sink?: (k: number) => Promise<void> | void) {
  const got: { index: number; time: number }[] = [];
  vi.useFakeTimers();
  try {
    const played = playFrames(video, drawOf(video), (frame, time) => {
      const index = frame.data[0]! + (frame.data[1]! << 8);
      got.push({ index, time });
      return sink?.(index);
    }, { signal: new AbortController().signal });
    played.catch(() => {});
    await vi.runAllTimersAsync();
    await played;
    return got;
  } finally {
    vi.useRealTimers();
  }
}

const constant = (n: number, fps = 60) => Array.from({ length: n }, (_, k) => k / fps);

describe('the frame pacer', () => {
  it('locates skipped frames from the median gap', () => {
    const pacer = new FramePacer();
    const missing: number[] = [];
    for (const k of [0, 1, 2, 3, 4, 5, 6, 8, 9, 10, 13]) missing.push(...pacer.present(k / 60).missing);
    expect(missing.map((t) => Math.round(t * 60))).toEqual([7, 11, 12]);
    expect(pacer.skipped).toBe(3);
  });

  it('follows a variable frame rate without slowing playback', () => {
    for (const counts of [true, false]) {
      const pacer = new FramePacer();
      let decoded = 0;
      let t = 0;
      const times: number[] = [];
      for (let k = 0; k < 600; k++) { times.push(t); t += Math.floor(k / 100) % 2 ? 2 / 60 : 1 / 60; }
      for (const time of times) expect(pacer.present(time, counts ? decoded++ : undefined).slowed).toBe(false);
      expect(pacer.rate).toBe(1);
    }
  });

  it('slows playback while the decoder counts frames that went unpresented', () => {
    const pacer = new FramePacer();
    let decoded = 0;
    let slowed = false;
    for (let k = 0; k < 400; k++) {
      decoded += k % 3 === 0 ? 2 : 1;
      slowed ||= pacer.present(k / 60, decoded).slowed;
    }
    expect(slowed).toBe(true);
    expect(pacer.rate).toBeLessThan(1);
  });
});

describe('playback-driven decoding', () => {
  it('hands every frame over in order when every frame is presented', async () => {
    const video = new FakeVideo(constant(200), () => true);
    const got = await collect(video);
    expect(got.map((g) => g.index)).toEqual(constant(200).map((_, k) => k));
  });

  it('fetches the frames the page skipped before the next one, so none is lost', async () => {
    const video = new FakeVideo(constant(300), (k) => k < 20 || k % 4 !== 1);
    const got = await collect(video);
    expect(got.map((g) => g.index)).toEqual(constant(300).map((_, k) => k));
    expect(video.seeks).toBeGreaterThan(1);
  });

  it('waits for a slow consumer, frames presented meanwhile keeping their place', async () => {
    const video = new FakeVideo(constant(120), () => true);
    const got = await collect(video, (k) => (k % 10 === 0 ? new Promise<void>((r) => setTimeout(r, 5)) : undefined));
    expect(got.map((g) => g.index)).toEqual(constant(120).map((_, k) => k));
  });

  it('does not slow a variable frame rate', async () => {
    const times: number[] = [];
    let t = 0;
    for (let k = 0; k < 400; k++) { times.push(t); t += Math.floor(k / 100) % 2 ? 2 / 60 : 1 / 60; }
    const video = new FakeVideo(times, () => true);
    await collect(video);
    expect(video.playbackRate).toBe(1);
  });

  it('fails as busy when the skipped frames cannot be fetched either', async () => {
    const video = new FakeVideo(constant(300), (k) => k < 20 || k % 3 !== 1, false);
    await expect(collect(video)).rejects.toBeInstanceOf(VideoBusyError);
  });

  it('fails as busy when the decoder counts frames no gap located', async () => {
    // Every other frame unpresented: the gaps read a 30 fps video, only the decoder's count knows.
    const video = new FakeVideo(constant(300), (k) => k % 2 === 0);
    await expect(collect(video)).rejects.toBeInstanceOf(VideoBusyError);
  });
});

describe('opening a video for playback', () => {
  it('gives up on a video whose first frame never loads, as unreadable rather than busy', async () => {
    vi.useFakeTimers();
    const url = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as never);
    try {
      const opening = openVideo(new Blob([]), new AbortController().signal);
      const settled = opening.catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(OPEN_TIMEOUT_MS + 1);
      expect(await settled).toBeInstanceOf(VideoReadError);
      expect(revoke).toHaveBeenCalledWith('blob:test');
    } finally {
      vi.useRealTimers();
      for (const spy of [url, revoke, load, pause, getContext]) spy.mockRestore();
    }
  });
});
