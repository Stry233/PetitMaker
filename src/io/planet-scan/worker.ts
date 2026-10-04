/**
 * The planet scan's worker. `scan` reads the frames the decode worker (`decode-worker.ts`) sends
 * over a port (`scan-file.ts`), reporting progress on the way. Otherwise one `ScanSession` is fed
 * frame by frame from the page's video playback. Every request is answered once, so the page can
 * bound the frames in flight by the answers it waits for.
 */
import { DecodeError } from './decode-webcodecs';
import { ScanError } from './errors';
import { PreviewClock } from './preview';
import { ScanSession } from './run';
import { scanFromPort } from './scan-file';
import type { ScanReply, ScanRequest } from './protocol';

type Reply = ScanReply & { id: number };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ScanRequest & { id: number }>) => void) | null;
  postMessage: (reply: Reply) => void;
};

let session: ScanSession | null = null;
/** Paces the previews the playback path's answers carry. */
let previews = new PreviewClock();

function frameOf(width: number, height: number, buffer: ArrayBuffer) {
  return { width, height, data: new Uint8ClampedArray(buffer) };
}

async function scan(port: MessagePort, id: number): Promise<ScanReply> {
  session = null;
  const result = await scanFromPort(port, (framing) => new ScanSession({ framing }),
    (stage, share, preview) => scope.postMessage(preview ? { op: 'progress', stage, share, preview, id } : { op: 'progress', stage, share, id }));
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

scope.onmessage = ({ data }) => {
  const { id } = data;
  if (data.op === 'scan') {
    scan(data.port, id).then((reply) => scope.postMessage({ ...reply, id }), (error: unknown) => scope.postMessage({ ...failure(error), id }));
    return;
  }
  let reply: ScanReply;
  try {
    reply = answer(data);
  } catch (error) {
    reply = failure(error);
  }
  scope.postMessage({ ...reply, id });
};
