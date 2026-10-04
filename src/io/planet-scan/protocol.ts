import type { ScanFailure } from './errors';
import type { ScanPreview } from './preview';
import type { ScanOutcome } from './run';

// Messages between the page and the scan worker, and between the page and the decode worker. `scan`
// hands the scan worker the port the decode worker sends a file's frames on (`frame-link.ts`); on
// the playback path frames travel from the page as transferred RGBA buffers at the profile's frame
// size. Progress and the playback path's answers carry a `preview` of the ground read so far at
// most every `preview.ts:PREVIEW_MS`.

/** To the decode worker: decode `file` for the scan worker at the other end of `port`. Answered
 *  `closed` once the scan has every frame it asked for, or the decoder gave up. */
export type DecodeRequest = { readonly op: 'open'; readonly file: Blob; readonly port: MessagePort };
export type DecodeReply = { readonly op: 'closed' };

export type ScanRequest =
  /** Reads the frames arriving on `port`: answered `done`, `failed`, `unreadable`, or `unsupported`
   *  when the page must read the file through playback, after any number of `progress` messages. */
  | { readonly op: 'scan'; readonly port: MessagePort }
  /** Starts a session for the playback path, with the decoded picture's size where known. */
  | { readonly op: 'start'; readonly picture?: { readonly width: number; readonly height: number } }
  /** Pass 1: the next frame, shown at `time` seconds. */
  | { readonly op: 'frame'; readonly time: number; readonly width: number; readonly height: number; readonly buffer: ArrayBuffer }
  /** Ends pass 1. */
  | { readonly op: 'end' }
  /** Pass 2: distinct frame `index`. */
  | { readonly op: 'distinct'; readonly index: number; readonly width: number; readonly height: number; readonly buffer: ArrayBuffer }
  | { readonly op: 'finish' };

export type ScanReply =
  | { readonly op: 'started' }
  /** `accepting` turns false once the recording has left the map view. */
  | { readonly op: 'read'; readonly accepting: boolean; readonly distinct: number; readonly preview?: ScanPreview }
  /** The distinct frames' times pass 2 reads, in order. */
  | { readonly op: 'solved'; readonly times: number[] }
  | { readonly op: 'added'; readonly preview?: ScanPreview }
  | { readonly op: 'done'; readonly outcome: ScanOutcome }
  /** A `scan` in progress: its stage and the share of it done, null while it cannot be told. */
  | { readonly op: 'progress'; readonly stage: 'reading' | 'tracking' | 'ground'; readonly share: number | null; readonly preview?: ScanPreview }
  /** The worker cannot decode this file; `why` is for diagnostics. */
  | { readonly op: 'unsupported'; readonly why: string }
  /** The file stopped decoding after the scan had read it once. */
  | { readonly op: 'unreadable' }
  | { readonly op: 'failed'; readonly reason: ScanFailure }
  | { readonly op: 'error'; readonly message: string };
