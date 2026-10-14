// @vitest-environment node
/**
 * A file scan across its two workers, on a real MP4, a Matroska file built here and a scripted decoder: the decode side sends
 * every frame prepared and in order, waiting while its credits are used up, stops when the scan
 * says so, then sends exactly the distinct frames pass 1 named; a file or codec the decoder cannot
 * read, or a decoder failing in pass 1, answers unsupported so the page can read it through
 * playback, and a failure in pass 2 is a decode error.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { serveFile, surveySamples, type FramingSurvey } from '../../../pipelines/planet-scan/media/decode-side';
import { CALIBRATED_FRAMING, surveyPlacement, type Placement, type ScanFraming } from '../../../pipelines/planet-scan/frame/framing';
import type { VideoTrack } from '../../../pipelines/planet-scan/media/container';
import { DECODE_QUEUE, DecodeError, type CodecPlatform, type DecodedFrame, type FrameDecoder } from '../../../pipelines/planet-scan/media/decode-webcodecs';
import { LINK_CREDITS, type DecoderMessage, type LinkPort, type ScanMessage } from '../../../pipelines/planet-scan/track/frame-link';
import { SCAN_PROFILE } from '../../../pipelines/planet-scan/profile';
import { buildSampleMap, rectifyGrey, rgbaToGrey } from '../../../pipelines/planet-scan/frame/rectify';
import { MAP_VIEW_RECTIFICATION } from '../../../pipelines/planet-scan/profile';
import { FramePrep, type PreparedFrame, type ScanOutcome } from '../../../pipelines/planet-scan/run';
import { scanFromPort, type ScanPasses } from '../../../pipelines/planet-scan/scan-file';
import { surveyFraming } from '../../../pipelines/planet-scan/media/survey';
import { ScanError } from '../../../pipelines/planet-scan/errors';
import type { RgbaImage } from '../../../pipelines/planet-scan/types';
import { planetFixture } from '../../_support/planet';
import { cluster, frame, mkvFile, simpleBlock } from './ebml';
import { hudFrame, plainFrame, rng } from './synthetic';

const MP4 = readFileSync(join(__dirname, '../../fixtures/mp4/avc-bframes.mp4'));
const FRAMES = 20;
const { width: FW, height: FH } = SCAN_PROFILE.frame;
const OUTCOME: ScanOutcome = {
  template: planetFixture(), rimSand: [], review: [], landmark: null, unplaced: [], tooFar: [], blocked: [], estimated: [], coverage: 1, partial: false,
};

/** Two ends of a channel delivering each message on a later turn, as ports do. */
function channel() {
  const make = () => ({ onmessage: null as ((e: MessageEvent) => void) | null, postMessage: (_m: unknown, _t?: Transferable[]) => {} });
  const a = make();
  const b = make();
  a.postMessage = (m) => { setTimeout(() => b.onmessage?.({ data: m } as MessageEvent), 0); };
  b.postMessage = (m) => { setTimeout(() => a.onmessage?.({ data: m } as MessageEvent), 0); };
  return { decoder: a as LinkPort<ScanMessage, DecoderMessage>, scan: b as LinkPort<DecoderMessage, ScanMessage> };
}

/** A decoder that outputs each chunk's frame on a later turn, drawn as a map-view frame on even
 *  presentation times and a plain frame on odd ones; `failAt` fails the `failAt`th chunk of a run. */
function platform(opts: { supported?: boolean; failAt?: number; failPass?: number; allMap?: boolean } = {}, placed: Placement[] = []) {
  let runs = 0;
  const p: CodecPlatform = {
    createDecoder(output, error) {
      runs++;
      const run = runs;
      let queued = 0;
      let n = 0;
      let state = 'unconfigured';
      const held: number[] = [];
      const d: FrameDecoder = {
        get decodeQueueSize() { return queued; },
        get state() { return state; },
        configure() { state = 'configured'; },
        decode(chunk) {
          queued++;
          const k = n++;
          setTimeout(() => {
            queued--;
            if (state === 'closed') return;
            if (opts.failAt === k && run >= (opts.failPass ?? 1)) { state = 'closed'; error(new Error('decoder failed')); return; }
            held.push(chunk.timestamp);
            held.sort((x, y) => x - y);
            while (held.length > 2) output({ timestamp: held.shift()!, close() {} } as DecodedFrame);
          }, 0);
        },
        async flush() {
          while (queued > 0) await new Promise((r) => setTimeout(r, 0));
          if (state === 'closed') throw new Error('closed');
          while (held.length) output({ timestamp: held.shift()!, close() {} } as DecodedFrame);
        },
        close() { state = 'closed'; },
      };
      return d;
    },
    isConfigSupported: async () => opts.supported ?? true,
    draw(frame) {
      const index = Math.round((frame.timestamp * 30) / 1e6);
      return { width: FW, height: FH, data: opts.allMap || index % 2 === 0 ? hudFrame() : plainFrame() };
    },
    place(at) { placed.push(at); },
  };
  return p;
}

/** A session recording what reached it; it stops accepting after `stopAfter` frames and names
 *  every third frame distinct. */
function session(stopAfter = Infinity) {
  const seen = { frames: [] as { time: number; mapView: boolean; tile: boolean }[], distinct: [] as number[], finished: false };
  let accepting = true;
  const s: ScanPasses = {
    get accepting() { return accepting; },
    pushPrepared(_frame: RgbaImage, prepared: PreparedFrame, time: number) {
      if (!accepting) return;
      seen.frames.push({ time, mapView: prepared.hud.mapView, tile: prepared.tile !== null });
      if (seen.frames.length >= stopAfter) accepting = false;
    },
    endFirstPass: () => seen.frames.filter((_, k) => k % 3 === 0).map((f) => f.time),
    pushDistinct(index: number) { seen.distinct.push(index); },
    finish() { seen.finished = true; return OUTCOME; },
    preview: () => null,
  };
  return { s, seen };
}

/** The calibrated framing, for pictures the scripted decoder does not draw. */
const calibrated: FramingSurvey = async () => CALIBRATED_FRAMING;

/** Runs both sides; `outstanding` records the most frames sent and not acknowledged. */
async function scan(file: Blob, p: CodecPlatform, stopAfter?: number, survey: FramingSurvey = calibrated) {
  const { decoder, scan: scanEnd } = channel();
  let outstanding = 0;
  let most = 0;
  const send = decoder.postMessage.bind(decoder);
  decoder.postMessage = (m, t) => { if (m.op === 'frame' || m.op === 'distinct') most = Math.max(most, ++outstanding); send(m, t); };
  const recv = scanEnd.postMessage.bind(scanEnd);
  scanEnd.postMessage = (m, t) => { if (m.op === 'ack') outstanding--; recv(m, t); };
  const { s, seen } = session(stopAfter);
  const progress: string[] = [];
  const served = serveFile(file, decoder, p, survey);
  let framing: ScanFraming | null | undefined;
  const result = await scanFromPort(
    scanEnd, (f) => { framing = f; return s; }, (stage) => { if (progress[progress.length - 1] !== stage) progress.push(stage); },
  ).finally(() => served);
  return { result, seen, most, progress, framing };
}

describe('a file scan across the decode and scan workers', () => {
  it('reads every frame prepared and in order, then exactly the distinct frames, within the credits', async () => {
    const { result, seen, most, progress } = await scan(new Blob([MP4]), platform());
    expect(result).toEqual({ kind: 'done', outcome: OUTCOME });
    expect(seen.frames.length).toBe(FRAMES);
    const times = seen.frames.map((f) => f.time);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(seen.frames.map((f) => f.mapView)).toEqual(times.map((_, k) => k % 2 === 0));
    expect(seen.frames.every((f) => f.tile === f.mapView)).toBe(true);
    expect(seen.distinct.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    // The decoder's queue and the two frames the scripted decoder holds back come out past the credits.
    expect(most).toBeLessThanOrEqual(LINK_CREDITS + DECODE_QUEUE + 2);
    expect(seen.finished).toBe(true);
    expect(progress).toEqual(['reading', 'tracking', 'ground']);
  });

  it('reads a Matroska recording through the decoder too', async () => {
    // 30 frames a second in milliseconds, a key frame every eight.
    const blocks = Array.from({ length: FRAMES }, (_, k) => simpleBlock(1, Math.round((k * 1000) / 30), k % 8 === 0, frame(k)));
    const { result, seen } = await scan(new Blob([mkvFile({ openSegment: true, clusters: [cluster(0, ...blocks)] })]), platform());
    expect(result).toEqual({ kind: 'done', outcome: OUTCOME });
    expect(seen.frames.length).toBe(FRAMES);
    expect(seen.frames.map((f) => f.mapView)).toEqual(seen.frames.map((_, k) => k % 2 === 0));
    expect(seen.distinct.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('surveys a recording\'s key frames for its framing before pass 1 and draws pass 1 where it puts the window', async () => {
    // A 16:9 recording of the calibrated window between bars, every frame showing the map view.
    const blocks = Array.from({ length: FRAMES }, (_, k) => simpleBlock(1, Math.round((k * 1000) / 30), k % 8 === 0, frame(k)));
    const placed: Placement[] = [];
    const { result, seen, framing } = await scan(
      new Blob([mkvFile({ openSegment: true, clusters: [cluster(0, ...blocks)] })]), platform({ allMap: true }, placed), undefined, surveyFraming,
    );
    expect(result.kind).toBe('done');
    expect(framing).not.toBeNull();
    for (const k of ['x0', 'y0', 'x1', 'y1'] as const) expect(Math.abs(framing!.window[k] - CALIBRATED_FRAMING.window[k])).toBeLessThanOrEqual(1);
    expect(Math.abs(framing!.hudInset - CALIBRATED_FRAMING.hudInset)).toBeLessThan(1);
    // The survey draws the whole picture, then where the scan reads it; pass 1 keeps that.
    expect(placed[0]).toEqual(surveyPlacement({ width: 1920, height: 1080 }));
    expect(placed[placed.length - 1]).toEqual(framing!.placement);
    expect(seen.frames.every((f) => f.mapView)).toBe(true);
  });

  it('sends no frames of a recording whose survey found no window, and opens it with no framing', async () => {
    const { decoder, scan: scanEnd } = channel();
    const served = serveFile(new Blob([MP4]), decoder, platform(), async () => null);
    let framing: ScanFraming | null | undefined;
    let frames = 0;
    const refusing: ScanPasses = { ...session().s, pushPrepared() { frames++; }, endFirstPass() { throw new ScanError('framing'); } };
    await expect(scanFromPort(scanEnd, (f) => { framing = f; return refusing; }, () => {})).rejects.toMatchObject({ reason: 'framing' });
    await served;
    expect(framing).toBeNull();
    expect(frames).toBe(0);
  });

  it('surveys key frames spread across the track, and the frames after them where keys are few', () => {
    const track = (n: number, keyEvery: number) => ({
      samples: {
        count: n, time: Float64Array.from({ length: n }, (_, k) => k * 1e6),
        key: Uint8Array.from({ length: n }, (_, k) => (k % keyEvery === 0 ? 1 : 0)),
      },
    }) as unknown as VideoTrack;
    expect(surveySamples(track(1000, 10), 4)).toEqual([120, 370, 620, 870]);
    expect(surveySamples(track(20, 8), 6)).toEqual([0, 1, 8, 9, 16, 17]);
    expect(surveySamples(track(3, 8), 6)).toEqual([0, 1, 2]);
  });

  it('stops pass 1 once the scan has left the map view', async () => {
    const { result, seen } = await scan(new Blob([MP4]), platform(), 6);
    expect(result.kind).toBe('done');
    expect(seen.frames.length).toBe(6);
    expect(seen.distinct.sort()).toEqual([0, 1]);
  });

  it('answers unsupported for a file no container reader reads, a codec the platform lacks, no WebCodecs, or a decoder failing in pass 1', async () => {
    expect((await scan(new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0])]), platform())).result.kind).toBe('unsupported');
    expect((await scan(new Blob([MP4]), platform({ supported: false }))).result.kind).toBe('unsupported');
    const { decoder, scan: scanEnd } = channel();
    const none = serveFile(new Blob([MP4]), decoder, null);
    expect((await scanFromPort(scanEnd, () => session().s, () => {})).kind).toBe('unsupported');
    await none;
    expect((await scan(new Blob([MP4]), platform({ failAt: 5 }))).result.kind).toBe('unsupported');
  });

  it('fails with a decode error when pass 2 cannot decode, its retry included', async () => {
    await expect(scan(new Blob([MP4]), platform({ failAt: 2, failPass: 2 }))).rejects.toBeInstanceOf(DecodeError);
  });
});

describe('preparing frames on the decoding thread', () => {
  it('rectifies the same tile as the full-frame grey conversion', () => {
    const data = hudFrame();
    const r = rng(7);
    // Texture over the ground, clear of the HUD's structures.
    for (let y = 40; y < 400; y++) for (let x = 100; x < 860; x++) data.set([r() * 255, r() * 255, r() * 255], (y * FW + x) * 4);
    const frame = { width: FW, height: FH, data };
    const prepared = new FramePrep().prepare(frame);
    expect(prepared.hud.mapView).toBe(true);
    const map = buildSampleMap(MAP_VIEW_RECTIFICATION, SCAN_PROFILE.tile, 1);
    expect(Array.from(prepared.tile!)).toEqual(Array.from(rectifyGrey(map, rgbaToGrey(frame)).data));
  });

  it('reads no tile off a frame outside the map view', () => {
    expect(new FramePrep().prepare({ width: FW, height: FH, data: plainFrame() }).tile).toBeNull();
  });
});
