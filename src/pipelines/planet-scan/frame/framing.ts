import { SCAN_PROFILE } from '../profile';
import type { PixelRect, RgbaImage } from '../types';

// Where the game window lies in a decoded picture, and how the picture is drawn into the scan's
// frame so the window reads like the calibrated one. The window is found from the margins around
// it over several pictures (`WindowSurvey`); the placement then puts the window's centre on the
// frame's centre at the scale that gives it the frame's height, or the frame's width for a window
// wider than the frame. The world follows the window's height, so it keeps the calibrated scale
// unless the window had to shrink to fit the frame's width (`ScanFraming.world`).

const { width: FW, height: FH } = SCAN_PROFILE.frame;
const WINDOW = SCAN_PROFILE.window;

/** A decoded picture's size in its own pixels. */
export interface PictureSize {
  readonly width: number;
  readonly height: number;
}

/** Where a picture lands in the scan's frame: its top left corner in frame pixels and the frame
 *  pixels one picture pixel spans. */
export interface Placement {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
}

/** How a recording is read: the picture's placement, the game window it puts in the frame, the
 *  world's scale there against the calibrated window's, and the HUD's horizontal inset inside the
 *  window in frame pixels. */
export interface ScanFraming {
  readonly placement: Placement;
  /** The game window in frame pixels; edges may fall between pixels. */
  readonly window: PixelRect;
  /** Frame pixels one calibrated frame pixel of the world spans, about the frame's centre. */
  readonly world: number;
  readonly hudInset: number;
}

/** The calibrated window as the scan's frame holds it (`SCAN_PROFILE.view`). */
export const CALIBRATED_WINDOW: PixelRect = {
  x0: SCAN_PROFILE.view.x0,
  y0: 0,
  x1: SCAN_PROFILE.view.x0 + FH * SCAN_PROFILE.view.aspect,
  y1: FH,
};

/** The framing of the reference recordings, for frames already drawn at the frame's size: a 16:9
 *  picture holding the calibrated window. */
export const CALIBRATED_FRAMING: ScanFraming = {
  placement: { x: 0, y: 0, scale: 1 },
  window: CALIBRATED_WINDOW,
  world: 1,
  hudInset: SCAN_PROFILE.hud.inset.calibrated,
};

/** The whole picture fit into the frame and centred, as the survey reads it. */
export function surveyPlacement(picture: PictureSize): Placement {
  const scale = Math.min(FW / picture.width, FH / picture.height);
  return { x: (FW - picture.width * scale) / 2, y: (FH - picture.height * scale) / 2, scale };
}

/**
 * The framing that puts the game window `window` (picture pixels) of `picture` where the scan reads
 * it, before the HUD's inset is measured: the window's centre on the frame's, unless that lies
 * within `window.snap` frame pixels of where the picture's own centred fit puts it, which keeps the
 * picture on the frame's pixel grid (recorders place a window a pixel off the centre). The window
 * keeps its exact place in the frame, which the HUD's layout follows.
 */
export function placeWindow(gameWindow: PixelRect, picture: PictureSize): Omit<ScanFraming, 'hudInset'> {
  const w = gameWindow.x1 - gameWindow.x0;
  const h = gameWindow.y1 - gameWindow.y0;
  const scale = Math.min(FH / h, FW / w);
  const offset = (centre: number, frame: number, size: number) => {
    const ideal = frame / 2 - centre * scale;
    const fit = (frame - size * scale) / 2;
    return Math.abs(ideal - fit) <= WINDOW.snap ? fit : ideal;
  };
  const x = offset((gameWindow.x0 + gameWindow.x1) / 2, FW, picture.width);
  const y = offset((gameWindow.y0 + gameWindow.y1) / 2, FH, picture.height);
  return {
    placement: { x, y, scale },
    window: { x0: x + gameWindow.x0 * scale, y0: y + gameWindow.y0 * scale, x1: x + gameWindow.x1 * scale, y1: y + gameWindow.y1 * scale },
    world: (h * scale) / FH,
  };
}

/** Whether the world's scale was measured on recordings of this window's shape, rather than
 *  following the fitted rule alone. */
export function worldMeasured(framing: ScanFraming): boolean {
  const { x0, y0, x1, y1 } = framing.window;
  const aspect = (x1 - x0) / (y1 - y0);
  const [low, high] = WINDOW.measuredAspect;
  return aspect >= low * (1 - WINDOW.aspectSlack) && aspect <= high * (1 + WINDOW.aspectSlack);
}

/** Per line over the surveyed pictures: how often it was dark and plain, the range of its level
 *  then, and its summed level. */
class Lines {
  readonly margin: Uint16Array;
  readonly low: Float32Array;
  readonly high: Float32Array;
  readonly level: Float64Array;
  constructor(n: number) {
    this.margin = new Uint16Array(n);
    this.low = new Float32Array(n).fill(Infinity);
    this.high = new Float32Array(n).fill(-Infinity);
    this.level = new Float64Array(n);
  }
}

/**
 * The game window in a recording, from the margins around it. Each surveyed picture is drawn at
 * `placement` (the whole picture fit into the frame); a column or row is margin when it is dark,
 * plain and unchanging across nearly every picture (`SCAN_PROFILE.window`). Bars of any width on
 * any side are margins, while the game's own dark edges change as the camera moves and are not. Window edges
 * are located to a fraction of a survey pixel from the mean level of the line they cut.
 */
export class WindowSurvey {
  readonly placement: Placement;
  /** Frame pixels wholly covered by the picture. */
  private readonly area: PixelRect;
  private readonly cols = new Lines(FW);
  private readonly rows = new Lines(FH);
  private pictures = 0;

  constructor(readonly picture: PictureSize) {
    this.placement = surveyPlacement(picture);
    const { x, y, scale } = this.placement;
    this.area = {
      x0: Math.max(0, Math.ceil(x - 1e-6)),
      y0: Math.max(0, Math.ceil(y - 1e-6)),
      x1: Math.min(FW, Math.floor(x + picture.width * scale + 1e-6)),
      y1: Math.min(FH, Math.floor(y + picture.height * scale + 1e-6)),
    };
  }

  /** A picture drawn at `placement`, at the frame's size. */
  add(frame: RgbaImage): void {
    if (frame.width !== FW || frame.height !== FH) throw new Error(`the survey reads ${FW}x${FH} frames`);
    const { x0, y0, x1, y1 } = this.area;
    const { data } = frame;
    const brightest = (x: number, y: number) => {
      const i = (y * FW + x) * 4;
      return Math.max(data[i]!, data[i + 1]!, data[i + 2]!);
    };
    const line = (lines: Lines, k: number, at: (j: number) => number, from: number, to: number) => {
      let sum = 0;
      let sq = 0;
      let n = 0;
      for (let j = from; j < to; j += WINDOW.step) {
        const v = at(j);
        sum += v;
        sq += v * v;
        n++;
      }
      const mean = sum / n;
      lines.level[k]! += mean;
      if (mean <= WINDOW.level && Math.sqrt(Math.max(0, sq / n - mean * mean)) <= WINDOW.spread) {
        lines.margin[k]!++;
        lines.low[k] = Math.min(lines.low[k]!, mean);
        lines.high[k] = Math.max(lines.high[k]!, mean);
      }
    };
    for (let x = x0; x < x1; x++) line(this.cols, x, (y) => brightest(x, y), y0, y1);
    for (let y = y0; y < y1; y++) line(this.rows, y, (x) => brightest(x, y), x0, x1);
    this.pictures++;
  }

  /** The window's edges along one axis in frame pixels, or null when every line is margin. */
  private span(lines: Lines, from: number, to: number, start: number, end: number): [number, number] | null {
    const need = Math.ceil(WINDOW.share * this.pictures);
    const margin = (k: number) => lines.margin[k]! >= need && lines.high[k]! - lines.low[k]! <= WINDOW.steady;
    let a = from;
    while (a < to && margin(a)) a++;
    if (a >= to) return null;
    let b = to;
    while (b > a && margin(b - 1)) b--;
    const level = (k: number) => lines.level[k]! / this.pictures;
    const mean = (ks: number[]) => {
      const inside = ks.filter((k) => k >= from && k < to);
      return inside.length ? inside.reduce((s, k) => s + level(k), 0) / inside.length : null;
    };
    // The share of the first window line that is margin, from its level between the margin's and
    // the window's beyond it.
    const cut = (k: number, dir: 1 | -1) => {
      const outside = mean([k - dir, k - 2 * dir, k - 3 * dir]);
      const inside = mean([k + dir, k + 2 * dir, k + 3 * dir]);
      if (outside === null || inside === null || Math.abs(inside - outside) < 1) return 0;
      return Math.min(1, Math.max(0, (inside - level(k)) / (inside - outside)));
    };
    return [a > from ? a + cut(a, 1) : start, b < to ? b - cut(b - 1, -1) : end];
  }

  /** The game window in picture pixels, or null when the pictures hold none large enough to read. */
  window(): PixelRect | null {
    if (this.pictures === 0) return null;
    const { x, y, scale } = this.placement;
    const { width, height } = this.picture;
    const xs = this.span(this.cols, this.area.x0, this.area.x1, x, x + width * scale);
    const ys = this.span(this.rows, this.area.y0, this.area.y1, y, y + height * scale);
    if (!xs || !ys) return null;
    const [x0, x1] = xs.map((e) => (e - x) / scale) as [number, number];
    const [y0, y1] = ys.map((e) => (e - y) / scale) as [number, number];
    if (x1 - x0 < WINDOW.minWidth || y1 - y0 < WINDOW.minHeight) return null;
    return { x0, y0, x1, y1 };
  }
}
