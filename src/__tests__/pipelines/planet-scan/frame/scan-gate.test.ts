import { describe, expect, it } from 'vitest';
import type { HudReading } from '../../../../pipelines/planet-scan/frame/hud';
import { ScanGate } from '../../../../pipelines/planet-scan/frame/scan-gate';
import { SCAN_PROFILE } from '../../../../pipelines/planet-scan/profile';

const HUD = SCAN_PROFILE.hud;
const MAX = HUD.zoom.knobCentre;
/** The knob's row at the minimum zoom, its track's other end. */
const MIN = HUD.zoom.y1 - 12;
/** The recordings' frame rate. */
const FPS = 30;

const whole = (knob: number): HudReading => ({ mapView: true, whole: true, knob });
/** A frame where the cursor covers one structure: still the map view, the knob unread. */
const covered: HudReading = { mapView: true, whole: false, knob: null };
const elsewhere: HudReading = { mapView: false, whole: false, knob: null };
/** A frame off the map view whose knob still reads, as in the map view's closing fade. */
const fading = (knob: number): HudReading => ({ mapView: false, whole: false, knob });

/** Admits `frames` one per `1 / FPS` seconds from the gate's last time. */
function feed(gate: ScanGate, frames: readonly HudReading[], from = { k: 0 }): boolean[] {
  return frames.map((f) => gate.admit(f, from.k++ / FPS));
}
const repeat = <T,>(n: number, f: T): T[] => Array.from({ length: n }, () => f);
/** Frames spanning `seconds` at the frame rate. */
const span = (seconds: number) => Math.round(seconds * FPS);

describe('the scan gate', () => {
  it('skips an opening at the minimum zoom and the zoom between, then reads from the first frame at the maximum', () => {
    const gate = new ScanGate();
    const frames = [...repeat(30, whole(MIN)), ...repeat(3, whole(MIN - 3)), ...repeat(14, covered), ...repeat(100, whole(MAX))];
    const read = feed(gate, frames);
    expect(read.indexOf(true)).toBe(47);
    expect(read.slice(47).every(Boolean)).toBe(true);
    expect(gate.read).toBe(100);
    expect(gate.otherZoom).toBe(33);
    expect(gate.zoomChanged).toBe(false);
  });

  it('starts only on a frame whose every structure matches', () => {
    expect(feed(new ScanGate(), [covered, { mapView: true, whole: false, knob: MAX }, whole(MAX)])).toEqual([false, false, true]);
  });

  it('keeps reading through a covered structure and stops once the map view is gone long enough', () => {
    const gate = new ScanGate();
    const short = repeat(span(HUD.endAfter) - 2, elsewhere);
    const read = feed(gate, [whole(MAX), covered, whole(MAX), ...short, whole(MAX), ...repeat(span(HUD.endAfter) + 1, elsewhere), whole(MAX)]);
    expect(read.filter(Boolean).length).toBe(4);
    expect(gate.ended).toBe(true);
    expect(gate.zoomChanged).toBe(false);
  });

  it('skips a moment at another zoom and reads on, but ends a zoom held off the maximum and says it changed', () => {
    const off = whole(MAX + HUD.zoom.knobDrift + 1);
    const brief = new ScanGate();
    const read = feed(brief, [...repeat(80, whole(MAX)), ...repeat(span(HUD.endAfter) - 2, off), ...repeat(10, whole(MAX))]);
    expect(read.filter(Boolean).length).toBe(90);
    expect(brief.zoomChanged).toBe(false);
    const held = new ScanGate();
    feed(held, [...repeat(80, whole(MAX)), ...repeat(span(HUD.endAfter) + 1, off), whole(MAX)]);
    expect(held.read).toBe(80);
    expect(held.zoomChanged).toBe(true);
    expect(held.ended).toBe(true);
  });

  it('says the zoom changed when the map view goes once the knob has stood off the maximum long enough', () => {
    const off = whole(MAX + HUD.zoom.knobDrift + 1);
    const held = new ScanGate();
    feed(held, [...repeat(80, whole(MAX)), ...repeat(span(HUD.endAfter), off), ...repeat(span(HUD.endAfter) + 1, elsewhere)]);
    expect(held.ended).toBe(true);
    expect(held.zoomChanged).toBe(true);
    const brief = new ScanGate();
    feed(brief, [...repeat(80, whole(MAX)), ...repeat(span(HUD.endAfter) - 2, off), ...repeat(span(HUD.endAfter) + 1, elsewhere)]);
    expect(brief.ended).toBe(true);
    expect(brief.zoomChanged).toBe(false);
  });

  it('ignores the knob on frames that are not the map view, as in the closing fade', () => {
    const gate = new ScanGate();
    feed(gate, [...repeat(80, whole(MAX)), ...repeat(span(HUD.endAfter) + 1, fading(MIN))]);
    expect(gate.ended).toBe(true);
    expect(gate.zoomChanged).toBe(false);
  });

  it('gives up on a recording that never reaches the maximum zoom within its time', () => {
    const gate = new ScanGate();
    const from = { k: 0 };
    while (!gate.ended) feed(gate, [whole(MIN)], from);
    expect(from.k - 1).toBe(span(HUD.startWithin));
    expect(gate.read).toBe(0);
    expect(gate.admit(whole(MAX), from.k / FPS)).toBe(false);
  });
});
