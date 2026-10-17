import { SCAN_PROFILE } from '../profile';
import { atScanZoom, type HudReading } from './hud';

// Which frames of a recording the scan reads, from each frame's HUD and time. The scan starts at the
// first frame whose every HUD structure matches with the zoom knob at the calibrated zoom, the
// maximum: frames before it, a fade-in or an opening zoom, are skipped, and the picture has settled
// by the frame the knob reaches the end of its track. Once started, a frame off the map view or with
// the knob read at another zoom is skipped. The map view gone for `hud.endAfter` seconds ends the
// scan, as leaving it does; the knob read at another zoom on every map-view frame for as long ends
// it as a zoom change, also when the map view goes after it, since a person who zooms keeps the new
// zoom, while one misread knob, a cursor over the slider or a frame of the closing fade, lasts a
// frame or two.

const HUD = SCAN_PROFILE.hud;

export class ScanGate {
  /** Frames the scan read. */
  read = 0;
  /** Frames before the start that showed the whole map view at another zoom. */
  otherZoom = 0;
  /** The knob stood off the calibrated zoom for `hud.endAfter` seconds after the scan started. */
  zoomChanged = false;
  /** The scan takes no more frames. */
  ended = false;
  private firstTime: number | null = null;
  /** The time of the last frame read, and of the first map-view frame since then at another zoom. */
  private lastRead = 0;
  private offZoomSince: number | null = null;

  /** Whether the scan reads the frame shown at `time` seconds that `hud` was read off. */
  admit(hud: HudReading, time: number): boolean {
    if (this.ended) return false;
    this.firstTime ??= time;
    if (this.read === 0) {
      if (hud.whole && hud.knob !== null && atScanZoom(hud.knob)) return this.take(time);
      if (hud.whole) this.otherZoom++;
      if (time - this.firstTime >= HUD.startWithin) this.ended = true;
      return false;
    }
    const offZoom = hud.mapView && hud.knob !== null && !atScanZoom(hud.knob);
    if (offZoom) this.offZoomSince ??= time;
    if (offZoom || !hud.mapView) {
      // A frame's time ends the one before, so the knob has stood off from `offZoomSince` up to now
      // on the frame that leaves the map view too.
      if (this.offZoomSince !== null && time - this.offZoomSince >= HUD.endAfter) this.zoomChanged = this.ended = true;
      else if (!hud.mapView && time - this.lastRead >= HUD.endAfter) this.ended = true;
      return false;
    }
    return this.take(time);
  }

  private take(time: number): boolean {
    this.read++;
    this.lastRead = time;
    this.offZoomSince = null;
    return true;
  }
}
