/**
 * The scanning half of a file scan, in the scan worker: frames come over a port from the decode
 * worker (`decode-side.ts`), already decoded with WebCodecs and prepared, pass 1 every frame and
 * pass 2 the distinct frames only, which the decoder decodes again from their key frames. A file
 * the decoder cannot read answers `unsupported` before the scan reports a result, and the page reads
 * it through video playback instead; a decoder failing during pass 1 answers the same, since the
 * page's path starts over.
 */
import { DecodeError } from './decode-webcodecs';
import { Inbox, type DecoderMessage, type LinkPort, type ScanMessage } from './frame-link';
import { PreviewClock, type ScanPreview } from './preview';
import type { PictureSize, PreparedFrame, ScanOutcome } from './run';
import type { RgbaImage } from './types';

/** The passes of a `ScanSession` this path drives. */
export interface ScanPasses {
  readonly accepting: boolean;
  pushPrepared(frame: RgbaImage, prepared: PreparedFrame, time: number): void;
  endFirstPass(): number[];
  pushDistinct(index: number, frame: RgbaImage): void;
  finish(): ScanOutcome;
  preview(): ScanPreview | null;
}

export type FileScanStage = 'reading' | 'tracking' | 'ground';

export type FileScanResult =
  | { readonly kind: 'done'; readonly outcome: ScanOutcome }
  | { readonly kind: 'unsupported'; readonly why: string };

/** The least time between two progress reports of one stage, in ms. */
const REPORT_MS = 100;

/**
 * Scans the frames arriving on `port`. Throws `ScanError` for a recording that cannot make a planet
 * and `DecodeError` when pass 2 cannot decode a frame pass 1 read.
 */
export async function scanFromPort(
  port: LinkPort<DecoderMessage, ScanMessage>, session: (picture: PictureSize) => ScanPasses,
  onProgress: (stage: FileScanStage, share: number | null, preview?: ScanPreview) => void,
): Promise<FileScanResult> {
  const inbox = new Inbox<DecoderMessage>(port);
  const send = (message: ScanMessage, transfer: Transferable[] = []) => port.postMessage(message, transfer);
  let last = -Infinity;
  let s: ScanPasses | null = null;
  const previews = new PreviewClock();
  const report = (stage: FileScanStage, share: number | null, force = false) => {
    const now = Date.now();
    if (!force && now - last < REPORT_MS) return;
    last = now;
    const preview = s && previews.due() ? s.preview() : null;
    if (preview) onProgress(stage, share, preview);
    else onProgress(stage, share);
  };

  const opened = await inbox.next();
  if (opened.op === 'unsupported') return { kind: 'unsupported', why: opened.why };
  if (opened.op !== 'opened') return { kind: 'unsupported', why: `unexpected ${opened.op}` };
  const duration = opened.duration > 0 ? opened.duration : 1;

  s = session({ width: opened.width, height: opened.height });
  report('reading', 0, true);
  let stopping = false;
  for (;;) {
    const m = await inbox.next();
    if (m.op === 'read-all') break;
    if (m.op === 'failed') return { kind: 'unsupported', why: `decoding failed: ${m.message}` };
    if (m.op !== 'frame') continue;
    s.pushPrepared({ width: m.width, height: m.height, data: m.rgba }, { hud: m.hud, tile: m.tile }, m.time);
    send(m.tile ? { op: 'ack', tile: m.tile, rgba: m.rgba } : { op: 'ack', rgba: m.rgba }, m.tile ? [m.tile.buffer, m.rgba.buffer] : [m.rgba.buffer]);
    report('reading', m.time / duration);
    if (!s.accepting && !stopping) { stopping = true; send({ op: 'stop' }); }
  }

  report('tracking', null, true);
  const times = s.endFirstPass();
  report('ground', 0, true);
  send({ op: 'distinct', times });
  let added = 0;
  for (;;) {
    const m = await inbox.next();
    if (m.op === 'read-distinct') break;
    if (m.op === 'failed') throw new DecodeError(m.message);
    if (m.op !== 'distinct') continue;
    s.pushDistinct(m.index, { width: m.width, height: m.height, data: m.rgba });
    send({ op: 'ack', rgba: m.rgba }, [m.rgba.buffer]);
    report('ground', ++added / times.length);
  }
  return { kind: 'done', outcome: s.finish() };
}
