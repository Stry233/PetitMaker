/**
 * Imports a planet from a recorded scan of the map view, all on this device, in the two passes `run.ts`
 * describes. A decode worker first tries to decode the file with WebCodecs and send its frames to
 * the scan worker (`decode-side.ts`, `scan-file.ts`). Where it cannot, the page decodes the video
 * through playback (`decode-browser.ts`) and posts the frames, at most `QUEUE` in flight to the scan
 * worker; the video waits for it beyond that. Cancelling stops the video and terminates the workers,
 * which frees everything the scan held.
 */
import { createWorkerClient, WorkerFailure, type WorkerClient } from '../../core/runtime/worker-client';
import { openVideo, VideoBusyError, VideoReadError, type VideoFrameImage, type VideoFrames } from './decode-browser';
import { isScanFailure, type ScanFailure } from './errors';
import type { ScanPreview } from './preview';
import type { DecodeReply, DecodeRequest, ScanReply, ScanRequest } from './protocol';
import type { ScanOutcome } from './run';

/** The stages the import reports, in order. */
export const SCAN_STAGES = ['reading', 'tracking', 'ground'] as const;
export type ScanStage = typeof SCAN_STAGES[number];

/** Where the import stands: its stage and the share of it done, null while it cannot be told. */
export interface ScanProgress {
  readonly stage: ScanStage;
  readonly share: number | null;
  /** The video is read again through playback after the decoder gave up on it part way. */
  readonly again?: boolean;
  /** The ground read so far, when a newer one arrived since the last report. */
  readonly preview?: ScanPreview;
}

/** Why an import did not produce a planet: a scan failure, a video the browser cannot read, a page
 *  too busy to read every frame, or the scan stopping for another reason. */
export type ImportFailure = ScanFailure | 'unreadable' | 'busy' | 'failed';

export class VideoImportError extends Error {
  constructor(readonly reason: ImportFailure, readonly detail?: unknown) {
    super(`video import failed: ${reason}`);
    this.name = 'VideoImportError';
  }
}

/** Frames posted to the worker and not yet answered, at most. */
const QUEUE = 4;

/** The least time between two progress reports of one stage, in ms. */
const REPORT_MS = 250;

/** Two presentation times closer than this are one frame, in seconds. */
const SAME_FRAME = 5e-4;

export interface ScanVideoOptions {
  readonly signal: AbortSignal;
  readonly onProgress?: (progress: ScanProgress) => void;
}

/** The function the import window calls; tests replace it with a scripted one. */
export type ScanVideo = (file: Blob, options: ScanVideoOptions) => Promise<ScanOutcome>;

/**
 * The frames posted to the worker and not yet answered. Playback holds only while `QUEUE` of them
 * wait; a failed request stops it, and `drain` throws its error.
 */
class FrameQueue {
  private waiting = 0;
  private failure: { error: unknown } | null = null;
  /** Everyone waiting for an answer: `room` callers and `drain`, each woken by every settle. */
  private waiters: (() => void)[] = [];

  add(request: Promise<unknown>): void {
    this.waiting++;
    request.then(() => this.settle(), (error: unknown) => { this.failure ??= { error }; this.settle(); });
  }

  private settle(): void {
    this.waiting--;
    const waiters = this.waiters;
    this.waiters = [];
    for (const wake of waiters) wake();
  }

  private next(): Promise<void> {
    return new Promise((resolve) => { this.waiters.push(resolve); });
  }

  /** Whether another frame may be posted: true while fewer than `QUEUE` wait, a promise of it
   *  otherwise, false once a request failed. */
  room(): boolean | Promise<boolean> {
    if (this.failure) return false;
    if (this.waiting < QUEUE) return true;
    return (async () => {
      while (!this.failure && this.waiting >= QUEUE) await this.next();
      return !this.failure;
    })();
  }

  /** Waits for every request; throws the first failure. */
  async drain(): Promise<void> {
    while (this.waiting > 0 && !this.failure) await this.next();
    if (this.failure) throw this.failure.error;
  }
}

/** What a scan reads with: the workers it spawns and the video it opens. */
export interface ScanVideoDeps {
  readonly spawn: () => Worker;
  /** The decode worker that hands the scan worker a file's frames; without it every file is read
   *  through playback. */
  readonly spawnDecoder?: () => Worker;
  readonly open: (file: Blob, signal: AbortSignal) => Promise<VideoFrames>;
}

const spawnScanWorker = () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
const spawnDecodeWorker = () => new Worker(new URL('./decode-worker.ts', import.meta.url), { type: 'module' });

/** A video read failing for the page rather than the recording. */
const playbackFailure = (error: unknown): unknown =>
  error instanceof VideoReadError ? new VideoImportError('unreadable', error)
    : error instanceof VideoBusyError ? new VideoImportError('busy', error) : error;

/** The scan of `deps`; `scanVideo` is the page's. */
export function createScanVideo(deps: ScanVideoDeps): ScanVideo {
  return (file, options) => scan(deps, file, options);
}

/** Reads a planet from `file`. Rejects with `VideoImportError`, or an `AbortError` when cancelled. */
export const scanVideo: ScanVideo = createScanVideo({ spawn: spawnScanWorker, spawnDecoder: spawnDecodeWorker, open: openVideo });

/**
 * Reads `file` through the decode worker, which sends its frames to the scan worker over a channel
 * of their own; null when the decoder cannot read it and playback must. A decode worker that
 * crashes ends the scan through `abandon`, which disposes the scan worker.
 */
async function scanDirect(spawn: () => Worker, file: Blob, signal: AbortSignal, ask: (message: ScanRequest, transfer?: Transferable[]) => Promise<ScanReply>, abandon: () => void): Promise<ScanOutcome | null> {
  let decoder: WorkerClient | null = createWorkerClient({ spawn, idleMs: 0, keyed: true, holdOpen: () => decoder !== null });
  const channel = new MessageChannel();
  decoder.request<DecodeReply>({ message: { op: 'open', file, port: channel.port1 } satisfies DecodeRequest, transfer: [channel.port1], signal })
    .catch(() => { if (decoder && !signal.aborted) abandon(); });
  try {
    const reply = await ask({ op: 'scan', port: channel.port2 }, [channel.port2]);
    return reply.op === 'done' ? reply.outcome : null;
  } finally {
    const d = decoder;
    decoder = null;
    d.dispose();
  }
}

async function scan(deps: ScanVideoDeps, file: Blob, { signal, onProgress }: ScanVideoOptions): Promise<ScanOutcome> {
  let client: WorkerClient | null = createWorkerClient({ spawn: deps.spawn, idleMs: 0, keyed: true, holdOpen: () => client !== null });
  const ask = async (message: ScanRequest, transfer?: Transferable[]): Promise<ScanReply> => {
    if (!client) throw new DOMException('Cancelled', 'AbortError');
    let reply: ScanReply;
    try {
      reply = await client.request<ScanReply>({
        message,
        signal,
        ...(transfer ? { transfer } : {}),
        read: (data) => {
          const r = data as ScanReply;
          if (r.op !== 'progress') return r;
          if (r.stage !== 'reading' || (r.share ?? 0) > 0) readPart = true;
          if (r.preview) preview = r.preview;
          report(r.stage, r.share);
          return undefined;
        },
      });
    } catch (error) {
      if (error instanceof WorkerFailure) throw new VideoImportError('failed', error);
      throw error;
    }
    if (reply.op === 'failed') throw new VideoImportError(isScanFailure(reply.reason) ? reply.reason : 'failed');
    if (reply.op === 'unreadable') throw new VideoImportError('unreadable');
    if (reply.op === 'error') throw new VideoImportError('failed', new Error(reply.message));
    return reply;
  };
  // Reports reach the page's interface at most every `REPORT_MS` within a stage: a re-render per
  // frame would take the main thread the video needs to present its frames.
  let reported: { stage: ScanStage; at: number } | null = null;
  /** The decode worker reported reading part of the file; `again` marks the playback after it. */
  let readPart = false;
  let again = false;
  /** The newest preview not reported yet. */
  let preview: ScanPreview | null = null;
  const report = (stage: ScanStage, share: number | null, force = false) => {
    const now = performance.now();
    if (!force && reported?.stage === stage && now - reported.at < REPORT_MS && share !== 1) return;
    reported = { stage, at: now };
    const shown = preview;
    preview = null;
    onProgress?.({ stage, share: share === null ? null : Math.max(0, Math.min(1, share)), ...(again ? { again } : {}), ...(shown ? { preview: shown } : {}) });
  };

  let video: VideoFrames | null = null;
  try {
    report('reading', 0);
    if (deps.spawnDecoder && typeof MessageChannel !== 'undefined') {
      const outcome = await scanDirect(deps.spawnDecoder, file, signal, ask, () => client?.dispose());
      if (outcome) {
        report('ground', 1);
        return outcome;
      }
      if (readPart) {
        again = true;
        report('reading', 0, true);
      }
    }
    try {
      video = await deps.open(file, signal);
    } catch (error) {
      throw playbackFailure(error);
    }
    const { duration } = video;
    await ask(video.picture ? { op: 'start', picture: video.picture } : { op: 'start' });

    // Pass 1: every frame, until the recording leaves the map view.
    let accepting = true;
    const first = new FrameQueue();
    try {
      await video.play((frame, time) => {
        const buffer = frame.data.buffer as ArrayBuffer;
        first.add(ask({ op: 'frame', time, width: frame.width, height: frame.height, buffer }, [buffer]).then((reply) => {
          if (reply.op !== 'read') return;
          if (!reply.accepting) accepting = false;
          if (reply.preview) preview = reply.preview;
        }));
        report('reading', time / duration);
        const room = first.room();
        return room instanceof Promise ? room.then((ok) => ok && accepting) : room && accepting;
      }, { signal });
    } catch (error) {
      throw playbackFailure(error);
    }
    await first.drain();

    report('tracking', null);
    const solved = await ask({ op: 'end' });
    if (solved.op !== 'solved') throw new VideoImportError('failed');
    const times = solved.times;

    // Pass 2: the distinct frames again, by their times; a frame the playback did not present is
    // fetched by seeking afterwards.
    report('ground', 0);
    let next = 0;
    let added = 0;
    const missed: number[] = [];
    const second = new FrameQueue();
    const send = (index: number, frame: VideoFrameImage) => {
      const buffer = frame.data.buffer as ArrayBuffer;
      second.add(ask({ op: 'distinct', index, width: frame.width, height: frame.height, buffer }, [buffer]).then((reply) => {
        if (reply.op === 'added' && reply.preview) preview = reply.preview;
        added++;
        report('ground', added / times.length);
      }));
      return second.room();
    };
    const due = (time: number) => {
      while (next < times.length && times[next]! < time - SAME_FRAME) missed.push(next++);
      return next < times.length && Math.abs(times[next]! - time) <= SAME_FRAME;
    };
    try {
      await video.play((frame) => {
        const room = send(next++, frame);
        return room instanceof Promise ? room.then((ok) => ok && next < times.length) : room && next < times.length;
      }, { signal, wanted: due });
      while (next < times.length) missed.push(next++);
      for (const index of missed) if (!(await send(index, await video.frameAt(times[index]!, signal)))) break;
    } catch (error) {
      throw playbackFailure(error);
    }
    await second.drain();

    const done = await ask({ op: 'finish' });
    if (done.op !== 'done') throw new VideoImportError('failed');
    report('ground', 1);
    return done.outcome;
  } finally {
    video?.close();
    const c = client;
    client = null;
    c?.dispose();
  }
}
