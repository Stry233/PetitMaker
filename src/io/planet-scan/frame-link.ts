import type { ScanFraming } from './framing';
import type { HudReading } from './hud';

// The message port between the decode worker and the scan worker when a file is decoded with
// WebCodecs. The decoder feeds no chunk while `LINK_CREDITS` frames wait for the scan's
// acknowledgement, so at most that many are outstanding beyond the frames already inside the
// decoder (`DECODE_QUEUE` chunks and those it holds back for reordering). Each acknowledgement
// returns the frame's buffers for reuse. Frames travel as transferred buffers.

/** Frames sent and not yet acknowledged past which decoding waits. */
export const LINK_CREDITS = 4;

/** Decoder to scan. */
export type DecoderMessage =
  /** The file opened: its duration in seconds, its picture's size and the framing its survey
   *  found, null when it found no window to read (no frames follow then). */
  | { readonly op: 'opened'; readonly duration: number; readonly width: number; readonly height: number; readonly framing: ScanFraming | null }
  /** The file cannot be decoded here; `why` is for diagnostics. */
  | { readonly op: 'unsupported'; readonly why: string }
  /** Pass 1: a frame shown at `time` seconds, its HUD, and its rectified grey tile for a map-view
   *  frame. */
  | { readonly op: 'frame'; readonly time: number; readonly hud: HudReading; readonly tile: Float32Array<ArrayBuffer> | null; readonly width: number; readonly height: number; readonly rgba: Uint8ClampedArray<ArrayBuffer> }
  | { readonly op: 'read-all' }
  /** Pass 2: distinct frame `index`. */
  | { readonly op: 'distinct'; readonly index: number; readonly width: number; readonly height: number; readonly rgba: Uint8ClampedArray<ArrayBuffer> }
  | { readonly op: 'read-distinct' }
  /** Decoding failed in pass `pass`. */
  | { readonly op: 'failed'; readonly pass: 1 | 2; readonly message: string };

/** Scan to decoder. */
export type ScanMessage =
  /** One frame was read; its tile and pixel buffers come back for reuse. */
  | { readonly op: 'ack'; readonly tile?: Float32Array<ArrayBuffer>; readonly rgba?: Uint8ClampedArray<ArrayBuffer> }
  /** Pass 1 needs no more frames. */
  | { readonly op: 'stop' }
  /** Pass 2: decode the frames at these presentation times, in seconds. */
  | { readonly op: 'distinct'; readonly times: number[] };

/** The parts of a `MessagePort` the link uses. */
export interface LinkPort<In, Out> {
  postMessage(message: Out, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<In>) => void) | null;
}

/** A port's messages as an awaitable queue. */
export class Inbox<In> {
  private readonly queue: In[] = [];
  private waiting: ((message: In) => void) | null = null;

  constructor(port: { onmessage: ((event: MessageEvent<In>) => void) | null }, private readonly handle?: (message: In) => boolean) {
    port.onmessage = ({ data }) => {
      if (this.handle?.(data)) return;
      const wake = this.waiting;
      this.waiting = null;
      if (wake) wake(data);
      else this.queue.push(data);
    };
  }

  next(): Promise<In> {
    const message = this.queue.shift();
    if (message !== undefined) return Promise.resolve(message);
    return new Promise((resolve) => { this.waiting = resolve; });
  }
}
