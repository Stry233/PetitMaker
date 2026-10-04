/**
 * The decoding half of a file scan, in its own worker so decoding, drawing and the per-frame
 * preparation (`FramePrep`) run beside the scan's tracking rather than before it. Pass 1 sends
 * every frame until the scan says stop; pass 2 sends the frames at the times the scan asks for.
 */
import { checkSupported, decodeFrames, decodeTimes, type CodecPlatform } from './decode-webcodecs';
import { Inbox, LINK_CREDITS, type DecoderMessage, type LinkPort, type ScanMessage } from './frame-link';
import { blobSource, Mp4Unsupported, readMp4VideoTrack } from './mp4';
import { FramePrep } from './run';
import { SCAN_PROFILE } from './profile';
import type { RgbaImage } from './types';

const { width: TW, height: TH } = SCAN_PROFILE.tile;

/** Decodes `file` for the scan at the other end of `port`; resolves once the scan has what it asked for. */
export async function serveFile(file: Blob, port: LinkPort<ScanMessage, DecoderMessage>, platform: CodecPlatform | null): Promise<void> {
  const send = (message: DecoderMessage, transfer: Transferable[] = []) => port.postMessage(message, transfer);
  if (!platform) { send({ op: 'unsupported', why: 'no WebCodecs' }); return; }
  const src = blobSource(file);
  let track;
  try {
    track = await readMp4VideoTrack(src, { maxSamples: SCAN_PROFILE.import.maxFrames });
  } catch (error) {
    send({ op: 'unsupported', why: error instanceof Mp4Unsupported ? error.why : String(error) });
    return;
  }
  if (!(await checkSupported(platform, track))) { send({ op: 'unsupported', why: `codec ${track.codec}` }); return; }

  let outstanding = 0;
  let stopped = false;
  let wake: (() => void) | null = null;
  const tiles: Float32Array<ArrayBuffer>[] = [];
  const frames: Uint8ClampedArray<ArrayBuffer>[] = [];
  /** `image`'s pixels in a buffer the scan returned, so frames do not leave a 2 MB buffer each for
   *  the collector. */
  const pooled = (image: RgbaImage): Uint8ClampedArray<ArrayBuffer> => {
    let out = frames.pop();
    if (!out || out.length !== image.data.length) out = new Uint8ClampedArray(image.data.length);
    out.set(image.data);
    return out;
  };
  const inbox = new Inbox<ScanMessage>(port, (message) => {
    if (message.op === 'ack') {
      outstanding--;
      if (message.tile) tiles.push(message.tile);
      if (message.rgba) frames.push(message.rgba);
    } else if (message.op === 'stop') stopped = true;
    else return false;
    const w = wake;
    wake = null;
    w?.();
    return true;
  });
  const hold = async () => {
    while (outstanding >= LINK_CREDITS && !stopped) await new Promise<void>((resolve) => { wake = resolve; });
  };

  send({ op: 'opened', duration: track.duration, width: track.codedWidth, height: track.codedHeight });
  const prep = new FramePrep();
  try {
    await decodeFrames(platform, src, track, (frame, time) => {
      if (stopped) return false;
      const rgba = pooled(frame);
      const buffer = tiles.pop() ?? new Float32Array(TW * TH);
      const { hud, tile } = prep.prepare(frame, buffer);
      if (!tile) tiles.push(buffer);
      outstanding++;
      const transfer: Transferable[] = [rgba.buffer];
      if (tile) transfer.push(tile.buffer);
      send({ op: 'frame', time, hud, tile: tile as Float32Array<ArrayBuffer> | null, width: frame.width, height: frame.height, rgba }, transfer);
      return true;
    }, { hold });
  } catch (error) {
    send({ op: 'failed', pass: 1, message: String(error) });
    return;
  }
  send({ op: 'read-all' });
  tiles.length = 0;

  const ask = await inbox.next();
  if (ask.op !== 'distinct') return;
  stopped = false;
  try {
    await decodeTimes(platform, src, track, ask.times, (index, frame) => {
      outstanding++;
      const rgba = pooled(frame);
      send({ op: 'distinct', index, width: frame.width, height: frame.height, rgba }, [rgba.buffer]);
    }, { hold });
  } catch (error) {
    send({ op: 'failed', pass: 2, message: String(error) });
    return;
  }
  send({ op: 'read-distinct' });
}
