/**
 * The planet scan's worker. `scan` reads the frames the decode worker (`decode.worker.ts`) sends
 * over a port (`scan-file.ts`), reporting progress on the way. Otherwise one `ScanSession` is fed
 * frame by frame from the page's video playback. Every request is answered once, so the page can
 * bound the frames in flight by the answers it waits for.
 */
import { DecodeError } from './media/decode-webcodecs';
import { ScanError, type ScanFailure } from './errors';
import type { ScanFraming } from './frame/framing';
import { PreviewClock, type ScanPreview } from './ground/preview';
import { ScanSession, type ScanOutcome } from './run';
import { scanFromPort } from './scan-file';
import { workerScope, type Keyed } from '../../platform/async/worker-client';

// On the playback path frames travel from the page as transferred RGBA buffers at the profile's
// frame size. Progress and the playback path's answers carry a `preview` of the ground read so far
// at most every `preview.ts:PREVIEW_MS`.

export type ScanRequest =
  /** Reads the frames arriving on `port`: answered `done`, `failed`, `unreadable`, or `unsupported`
   *  when the page must read the file through playback, after any number of `progress` messages. */
  | { readonly op: 'scan'; readonly port: MessagePort }
  /** Starts a session for the playback path, with the framing the page's survey found (null for
   *  none; the calibrated framing where the picture's size is unknown). */
  | { readonly op: 'start'; readonly framing?: ScanFraming | null }
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

const scope = workerScope<Keyed<ScanRequest>, Keyed<ScanReply>>();

let session: ScanSession | null = null;
/** Paces the previews the playback path's answers carry. */
let previews = new PreviewClock();

function frameOf(width: number, height: number, buffer: ArrayBuffer) {
  return { width, height, data: new Uint8ClampedArray(buffer) };
}

async function scan(port: MessagePort, id: number): Promise<ScanReply> {
  session = null;
  const result = await scanFromPort(port, (framing) => new ScanSession({ framing }),
    (stage, share, preview) => scope.post(preview ? { op: 'progress', stage, share, preview, id } : { op: 'progress', stage, share, id }));
  port.close();
  return result.kind === 'done' ? { op: 'done', outcome: result.outcome } : { op: 'unsupported', why: result.why };
}

/** Answers a request of the playback path, within the message's turn. */
function answer(req: Exclude<ScanRequest, { op: 'scan' }>): ScanReply {
  switch (req.op) {
    case 'start':
      session = new ScanSession(req.framing === undefined ? {} : { framing: req.framing });
      previews = new PreviewClock();
      return { op: 'started' };
    case 'frame': {
      const s = need();
      s.push(frameOf(req.width, req.height, req.buffer), req.time);
      const preview = previews.due() ? s.preview() : null;
      return preview ? { op: 'read', accepting: s.accepting, distinct: s.distinct, preview } : { op: 'read', accepting: s.accepting, distinct: s.distinct };
    }
    case 'end':
      return { op: 'solved', times: need().endFirstPass() };
    case 'distinct': {
      const s = need();
      s.pushDistinct(req.index, frameOf(req.width, req.height, req.buffer));
      const preview = previews.due() ? s.preview() : null;
      return preview ? { op: 'added', preview } : { op: 'added' };
    }
    case 'finish': {
      const outcome = need().finish();
      session = null;
      return { op: 'done', outcome };
    }
  }
}

function need(): ScanSession {
  if (!session) throw new Error('the scan has not started');
  return session;
}

/** The answer to a request that threw. A refused scan is over; any other error leaves nothing worth
 *  keeping either. */
function failure(error: unknown): ScanReply {
  session = null;
  if (error instanceof ScanError) return { op: 'failed', reason: error.reason };
  if (error instanceof DecodeError) return { op: 'unreadable' };
  return { op: 'error', message: String(error) };
}

scope.listen((data) => {
  const { id } = data;
  if (data.op === 'scan') {
    scan(data.port, id).then((reply) => scope.post({ ...reply, id }), (error: unknown) => scope.post({ ...failure(error), id }));
    return;
  }
  let reply: ScanReply;
  try {
    reply = answer(data);
  } catch (error) {
    reply = failure(error);
  }
  scope.post({ ...reply, id });
});
