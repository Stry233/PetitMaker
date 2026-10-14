/**
 * The video import's loop between the page and the workers, on scripted workers and a scripted
 * video. A file the decode worker reads goes to the scan worker without playback, its progress
 * reaches the page, and a crash or a cancel ends both workers; a file it cannot read falls back to
 * playback. On playback, frames in flight stay bounded, pass 2 fetches the distinct frames playback
 * skipped, cancelling terminates the worker, and a crash or a busy page ends as the matching failure.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createScanVideo, VideoImportError, type ScanProgress } from '../../../pipelines/planet-scan/import-video';
import type { ScanPreview } from '../../../pipelines/planet-scan/ground/preview';
import { VideoBusyError, type FrameSink, type PlayOptions, type VideoFrameImage, type VideoFrames } from '../../../pipelines/planet-scan/media/decode-browser';
import type { ScanOutcome } from '../../../pipelines/planet-scan/run';
import type { ScanRequest } from '../../../pipelines/planet-scan/scan.worker';
import { planetFixture } from '../../_support/planet';
import { CALIBRATED_FRAMING, surveyPlacement, type Placement } from '../../../pipelines/planet-scan/frame/framing';
import { SCAN_PROFILE } from '../../../pipelines/planet-scan/profile';
import { hudFrame } from './synthetic';

const { width: FW, height: FH } = SCAN_PROFILE.frame;

const OUTCOME: ScanOutcome = {
  template: planetFixture(), rimSand: [], review: [], landmark: null, unplaced: [], tooFar: [], blocked: [], estimated: [], coverage: 1, partial: false,
};

/** A worker answering each request after `delayMs`, recording the most frames it held unanswered. */
class FakeWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminated = false;
  outstanding = 0;
  most = 0;
  readonly distinct: number[] = [];
  /** How the worker answers `scan`: as a file it read, one the page must play, or a stopped decoder. */
  direct: 'done' | 'unsupported' | 'unreadable' | 'never' = 'unsupported';
  readonly ops: string[] = [];
  /** The `start` request the playback path sent. */
  start: ScanRequest | null = null;
  /** A preview the worker's progress and pass 1 answers carry. */
  preview: ScanPreview | null = null;
  constructor(private readonly times: number[], private readonly delayMs = 1, private readonly crashOn: ScanRequest['op'] | null = null) {}

  postMessage(message: ScanRequest & { id: number }): void {
    this.ops.push(message.op);
    if (message.op === 'start') this.start = message;
    if (message.op === 'scan') {
      if (this.direct === 'never') return;
      setTimeout(() => {
        if (this.terminated) return;
        this.onmessage?.({ data: { op: 'progress', stage: 'tracking', share: null, id: message.id, ...(this.preview ? { preview: this.preview } : {}) } } as MessageEvent);
        const reply = this.direct === 'done' ? { op: 'done', outcome: OUTCOME } : this.direct === 'unreadable' ? { op: 'unreadable' } : { op: 'unsupported', why: 'test' };
        setTimeout(() => { if (!this.terminated) this.onmessage?.({ data: { ...reply, id: message.id } } as MessageEvent); }, this.delayMs);
      }, this.delayMs);
      return;
    }
    if (message.op === 'frame' || message.op === 'distinct') this.most = Math.max(this.most, ++this.outstanding);
    if (message.op === 'distinct') this.distinct.push(message.index);
    setTimeout(() => {
      if (this.terminated) return;
      if (message.op === this.crashOn) { this.onerror?.(); return; }
      if (message.op === 'frame' || message.op === 'distinct') this.outstanding--;
      const reply = message.op === 'start' ? { op: 'started' }
        : message.op === 'frame' ? { op: 'read', accepting: true, distinct: 0, ...(this.preview ? { preview: this.preview } : {}) }
          : message.op === 'end' ? { op: 'solved', times: this.times }
            : message.op === 'distinct' ? { op: 'added' } : { op: 'done', outcome: OUTCOME };
      this.onmessage?.({ data: { ...reply, id: message.id } } as MessageEvent);
    }, this.delayMs);
  }

  terminate(): void { this.terminated = true; }
}

/** The decode worker: answers `open` once the scan is over, or crashes when told to. */
class FakeDecoder {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminated = false;
  opened = 0;
  constructor(private readonly crash = false) {}
  postMessage(message: { op: string; id: number }): void {
    if (message.op !== 'open') return;
    this.opened++;
    if (this.crash) setTimeout(() => { if (!this.terminated) this.onerror?.(); }, 2);
  }
  terminate(): void { this.terminated = true; }
}

const frame = (): VideoFrameImage => ({ width: 1, height: 1, data: new Uint8ClampedArray(4) });

/** A video of frames at k / 60; pass 2 skips the frames `skip` names, which `frameAt` then fetches. */
function fakeVideo(n: number, skip: (k: number) => boolean = () => false, failWith?: unknown) {
  const fetched: number[] = [];
  let passes = 0;
  const video: VideoFrames = {
    duration: n / 60,
    async play(sink: FrameSink, options: PlayOptions) {
      passes++;
      if (failWith) throw failWith;
      for (let k = 0; k < n; k++) {
        if (options.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        const t = k / 60;
        if (options.wanted) {
          if (skip(k) || !options.wanted(t)) continue;
        }
        if ((await sink(frame(), t)) === false) return;
      }
    },
    async frameAt(time) { fetched.push(Math.round(time * 60)); return frame(); },
    place() {},
    close() {},
  };
  return { video, fetched, passes: () => passes };
}

describe('the video import loop', () => {
  // The client spawns only where the platform has workers; the spawned one is the fake.
  beforeAll(() => { if (typeof Worker === 'undefined') vi.stubGlobal('Worker', class {}); });

  it('keeps at most four frames waiting for the worker and returns its planet', async () => {
    const times = [0, 10, 20, 30].map((k) => k / 60);
    const worker = new FakeWorker(times, 2);
    const { video } = fakeVideo(60);
    const scan = createScanVideo({ spawn: () => worker as unknown as Worker, open: async () => video });
    const outcome = await scan(new Blob(), { signal: new AbortController().signal });
    expect(outcome).toBe(OUTCOME);
    expect(worker.most).toBeLessThanOrEqual(4);
    expect(worker.most).toBeGreaterThan(1);
    expect(worker.terminated).toBe(true);
  });

  it('surveys the played video for its framing first and plays it where the framing puts the window', async () => {
    const worker = new FakeWorker([0]);
    const { video, fetched } = fakeVideo(60);
    const placed: Placement[] = [];
    const surveyed: VideoFrames = {
      ...video,
      picture: { width: 1920, height: 1080 },
      async frameAt(time) { fetched.push(Math.round(time * 60)); return { width: FW, height: FH, data: hudFrame() }; },
      place(at) { placed.push(at); },
    };
    const scan = createScanVideo({ spawn: () => worker as unknown as Worker, open: async () => surveyed });
    await scan(new Blob(), { signal: new AbortController().signal });
    const start = worker.start as Extract<ScanRequest, { op: 'start' }>;
    expect(start.framing).not.toBeNull();
    expect(Math.abs(start.framing!.window.x0 - CALIBRATED_FRAMING.window.x0)).toBeLessThanOrEqual(1);
    // Two survey passes of every survey time, then the framing's placement for playback.
    expect(fetched.length).toBe(2 * SCAN_PROFILE.window.frames);
    expect(placed[0]).toEqual(surveyPlacement({ width: 1920, height: 1080 }));
    expect(placed[placed.length - 1]).toEqual(start.framing!.placement);
  });

  it('fetches the distinct frames pass 2 playback skipped, by their times', async () => {
    const times = [0, 5, 10, 15, 20].map((k) => k / 60);
    const worker = new FakeWorker(times);
    const { video, fetched } = fakeVideo(30, (k) => k === 10 || k === 20);
    const scan = createScanVideo({ spawn: () => worker as unknown as Worker, open: async () => video });
    await scan(new Blob(), { signal: new AbortController().signal });
    expect(fetched).toEqual([10, 20]);
    expect([...worker.distinct].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });

  it('terminates the worker when cancelled', async () => {
    const worker = new FakeWorker([0], 5);
    const { video } = fakeVideo(600);
    const scan = createScanVideo({ spawn: () => worker as unknown as Worker, open: async () => video });
    const controller = new AbortController();
    const running = scan(new Blob(), { signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker.terminated).toBe(true);
  });

  it('ends a worker crash as failed', async () => {
    const worker = new FakeWorker([0], 1, 'end');
    const { video } = fakeVideo(20);
    const scan = createScanVideo({ spawn: () => worker as unknown as Worker, open: async () => video });
    const error = await scan(new Blob(), { signal: new AbortController().signal }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VideoImportError);
    expect((error as VideoImportError).reason).toBe('failed');
  });

  it('ends a page too busy to read the frames as busy, not as a recording failure', async () => {
    const worker = new FakeWorker([0]);
    const { video } = fakeVideo(20, () => false, new VideoBusyError(30, 300));
    const scan = createScanVideo({ spawn: () => worker as unknown as Worker, open: async () => video });
    const error = await scan(new Blob(), { signal: new AbortController().signal }).catch((e: unknown) => e);
    expect((error as VideoImportError).reason).toBe('busy');
    expect(worker.terminated).toBe(true);
  });

  it('reads a file the decode worker can decode without playing it, passing its progress on', async () => {
    const worker = new FakeWorker([0]);
    worker.direct = 'done';
    const decoder = new FakeDecoder();
    const { video, passes } = fakeVideo(20);
    let opened = 0;
    const scan = createScanVideo(
      { spawn: () => worker as unknown as Worker, spawnDecoder: () => decoder as unknown as Worker, open: async () => { opened++; return video; } },
    );
    const progress: { stage: string; share: number | null }[] = [];
    const outcome = await scan(new Blob(), { signal: new AbortController().signal, onProgress: (p) => progress.push(p) });
    expect(outcome).toBe(OUTCOME);
    expect([opened, passes(), decoder.opened]).toEqual([0, 0, 1]);
    expect(worker.ops).toEqual(['scan']);
    expect(progress.some((p) => p.stage === 'tracking' && p.share === null)).toBe(true);
    expect([worker.terminated, decoder.terminated]).toEqual([true, true]);
  });

  it('passes the ground read so far on with the progress, on both paths', async () => {
    const preview: ScanPreview = { kind: 'coverage', x: 0, y: 0, unitW: 16, unitH: 16, cols: 1, rows: 1, classes: new Uint8Array([1]), view: { x: 0, y: 0, w: 1, h: 1 } };
    for (const direct of ['done', 'unsupported'] as const) {
      const worker = new FakeWorker([0]);
      worker.direct = direct;
      worker.preview = preview;
      const { video } = fakeVideo(20);
      const scan = createScanVideo(
        { spawn: () => worker as unknown as Worker, spawnDecoder: () => new FakeDecoder() as unknown as Worker, open: async () => video },
      );
      const seen: ScanProgress[] = [];
      await scan(new Blob(), { signal: new AbortController().signal, onProgress: (p) => seen.push(p) });
      expect(seen.some((p) => p.preview === preview)).toBe(true);
    }
  });

  it('plays a file the decode worker cannot decode', async () => {
    const worker = new FakeWorker([0, 5 / 60]);
    const decoder = new FakeDecoder();
    const { video, passes } = fakeVideo(20);
    const scan = createScanVideo({ spawn: () => worker as unknown as Worker, spawnDecoder: () => decoder as unknown as Worker, open: async () => video });
    expect(await scan(new Blob(), { signal: new AbortController().signal })).toBe(OUTCOME);
    expect(passes()).toBe(2);
    expect(worker.ops[0]).toBe('scan');
    expect(worker.ops[1]).toBe('start');
    expect(decoder.terminated).toBe(true);
  });

  it('labels the reading through playback as a second read once the decoder had read part of the file', async () => {
    const worker = new FakeWorker([0, 5 / 60]);
    const { video } = fakeVideo(20);
    const scan = createScanVideo(
      { spawn: () => worker as unknown as Worker, spawnDecoder: () => new FakeDecoder() as unknown as Worker, open: async () => video },
    );
    const progress: { stage: string; again?: boolean }[] = [];
    await scan(new Blob(), { signal: new AbortController().signal, onProgress: (p) => progress.push(p) });
    const fallback = progress.findIndex((p) => p.again);
    expect(fallback).toBeGreaterThan(0);
    expect(progress[fallback]!.stage).toBe('reading');
    expect(progress.slice(0, fallback).some((p) => p.again)).toBe(false);
  });

  it('ends a file that stopped decoding after pass 1 as unreadable', async () => {
    const worker = new FakeWorker([0]);
    worker.direct = 'unreadable';
    const scan = createScanVideo(
      { spawn: () => worker as unknown as Worker, spawnDecoder: () => new FakeDecoder() as unknown as Worker, open: async () => fakeVideo(1).video },
    );
    const error = await scan(new Blob(), { signal: new AbortController().signal }).catch((e: unknown) => e);
    expect((error as VideoImportError).reason).toBe('unreadable');
  });

  it('ends a decode worker crash as failed and terminates the scan worker', async () => {
    const worker = new FakeWorker([0]);
    worker.direct = 'never';
    const decoder = new FakeDecoder(true);
    const scan = createScanVideo(
      { spawn: () => worker as unknown as Worker, spawnDecoder: () => decoder as unknown as Worker, open: async () => fakeVideo(1).video },
    );
    const error = await scan(new Blob(), { signal: new AbortController().signal }).catch((e: unknown) => e);
    expect((error as VideoImportError).reason).toBe('failed');
    expect([worker.terminated, decoder.terminated]).toEqual([true, true]);
  });

  it('terminates both workers when a direct read is cancelled', async () => {
    const worker = new FakeWorker([0]);
    worker.direct = 'never';
    const decoder = new FakeDecoder();
    const scan = createScanVideo(
      { spawn: () => worker as unknown as Worker, spawnDecoder: () => decoder as unknown as Worker, open: async () => fakeVideo(1).video },
    );
    const controller = new AbortController();
    const running = scan(new Blob(), { signal: controller.signal });
    setTimeout(() => controller.abort(), 5);
    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    expect([worker.terminated, decoder.terminated]).toEqual([true, true]);
  });

  it('starts fresh workers for a retry after a scan worker crash, and the retry returns its planet', async () => {
    const workers = [new FakeWorker([0], 1, 'end'), new FakeWorker([0])];
    let spawned = 0;
    const scan = createScanVideo({ spawn: () => workers[spawned++] as unknown as Worker, open: async () => fakeVideo(20).video });
    const first = await scan(new Blob(), { signal: new AbortController().signal }).catch((e: unknown) => e);
    expect((first as VideoImportError).reason).toBe('failed');
    expect(workers[0]!.terminated).toBe(true);
    expect(await scan(new Blob(), { signal: new AbortController().signal })).toBe(OUTCOME);
    expect(spawned).toBe(2);
  });

  it('reads the file again after a decode worker crash', async () => {
    const scanWorkers = [new FakeWorker([0]), new FakeWorker([0])];
    scanWorkers[0]!.direct = 'never';
    scanWorkers[1]!.direct = 'done';
    const decoders = [new FakeDecoder(true), new FakeDecoder()];
    let spawned = 0, decoded = 0;
    const scan = createScanVideo({
      spawn: () => scanWorkers[spawned++] as unknown as Worker,
      spawnDecoder: () => decoders[decoded++] as unknown as Worker,
      open: async () => fakeVideo(1).video,
    });
    const first = await scan(new Blob(), { signal: new AbortController().signal }).catch((e: unknown) => e);
    expect((first as VideoImportError).reason).toBe('failed');
    expect(await scan(new Blob(), { signal: new AbortController().signal })).toBe(OUTCOME);
    expect(decoders.map((d) => d.terminated)).toEqual([true, true]);
  });

  it('closing while the file is still being opened ends the import, closes the video and leaves no worker running', async () => {
    const worker = new FakeWorker([0]);
    let spawned = 0;
    let release: (v: VideoFrames) => void = () => {};
    const controller = new AbortController();
    const scan = createScanVideo(
      { spawn: () => { spawned++; return worker as unknown as Worker; }, open: () => new Promise<VideoFrames>((resolve) => { release = resolve; }) },
    );
    const running = scan(new Blob(), { signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 5));
    controller.abort();
    const { video } = fakeVideo(600);
    const close = vi.spyOn(video, 'close');
    release(video);
    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    expect(spawned === 0 || worker.terminated).toBe(true);
    expect(close).toHaveBeenCalled();
  });
});
