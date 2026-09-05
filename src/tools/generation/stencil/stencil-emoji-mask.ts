import type { SourcePixels } from './stencil-sample';
import { stencilFromPixels } from './stencil-sample';
import type { Stencil } from '../../../core/model/types';
import { textTopology } from './stencil-text-grid';

const EDGE = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;

export interface EmojiDrawing {
  width: number;
  height: number;
  coverage: Uint8Array;
  silhouette: Uint8Array;
  details: number[][];
  pieces: number;
  edgeRuns: number[];
}

/** Split runs near an outer edge carry notches such as a heart's cleft or the gap between ears. */
function edgeRuns(coverage: Uint8Array, width: number, height: number): number[] {
  let left = width, top = height, right = -1, bottom = -1;
  coverage.forEach((value, i) => {
    if (value < 128) return;
    left = Math.min(left, i % width); right = Math.max(right, i % width);
    top = Math.min(top, Math.floor(i / width)); bottom = Math.max(bottom, Math.floor(i / width));
  });
  if (right < left) return [0, 0, 0, 0];
  const w = right - left + 1, h = bottom - top + 1;
  coverage = Uint8Array.from({ length: w * h }, (_, i) => coverage[(Math.floor(i / w) + top) * width + i % w + left]!);
  width = w; height = h;
  return [0, 1, 2, 3].map(edge => {
    const vertical = edge >= 2, span = vertical ? height : width, depth = vertical ? width : height;
    let best = 0;
    for (let d = Math.floor(depth * 0.08); d < Math.max(1, Math.floor(depth / 4)); d++) {
      const row = edge % 2 ? depth - 1 - d : d;
      let count = 0, length = 0, gap = span;
      for (let c = 0; c <= span; c++) {
        const filled = c < span && coverage[vertical ? c * width + row : row * width + c]! >= 128;
        if (filled) { length++; continue; }
        if (length >= Math.max(1, Math.floor(span * 0.1)) && gap >= Math.max(1, Math.floor(span * 0.04))) count++;
        if (length) gap = 0;
        length = 0; gap++;
      }
      best = Math.max(best, count);
    }
    return best;
  });
}

/** Area sampling retains filled regions and internal details once several cells can carry them. */
function sampleTextMask(source: Pick<Stencil, 'width' | 'height' | 'coverage'>, box: { width: number; height: number }): Stencil | null {
  const data = new Uint8Array(source.width * source.height * 4);
  source.coverage.forEach((value, i) => { data[i * 4 + 3] = value; });
  const stencil = stencilFromPixels({ width: source.width, height: source.height, data }, box, { background: false, trim: false, nature: 'photographic' });
  if (stencil) { stencil.cellAligned = true; delete stencil.quad; }
  return stencil;
}

function contrastSplit(histogram: Uint32Array): number {
  let count = 0, sum = 0;
  for (let i = 0; i < histogram.length; i++) { count += histogram[i]!; sum += i * histogram[i]!; }
  let leftCount = 0, leftSum = 0, best = 0, split = 0;
  for (let i = 0; i < histogram.length - 1; i++) {
    leftCount += histogram[i]!; leftSum += i * histogram[i]!;
    if (!leftCount || leftCount === count) continue;
    const gap = leftSum / leftCount - (sum - leftSum) / (count - leftCount);
    const variance = leftCount * (count - leftCount) * gap * gap;
    if (variance > best) { best = variance; split = i; }
  }
  return Math.max(45, split);
}

/** Color details become negative space inside the silhouette, preserving faces and emblems in one material. */
export function emojiTextDrawing(source: SourcePixels, minimumDetail = 0.0025): EmojiDrawing {
  let x0 = source.width, y0 = source.height, x1 = -1, y1 = -1;
  for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
    if (source.data[(y * source.width + x) * 4 + 3]! < 128) continue;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  if (x1 >= x0 && y1 >= y0) {
    const width = x1 - x0 + 1, height = y1 - y0 + 1, data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) data.set(source.data.subarray(((y + y0) * source.width + x0) * 4, ((y + y0) * source.width + x1 + 1) * 4), y * width * 4);
    source = { width, height, data };
  }
  const { width, height, data } = source;
  const coverage = Uint8Array.from({ length: width * height }, (_, i) => data[i * 4 + 3]!);
  const silhouette = coverage.slice();
  const details: number[][] = [];
  const seen = new Uint8Array(coverage.length);
  const distance = new Uint16Array(coverage.length);
  const detail = new Uint8Array(coverage.length);
  for (let start = 0; start < coverage.length; start++) {
    if (seen[start] || coverage[start]! < 128) continue;
    const pixels = [start]; seen[start] = 1;
    const histogram = new Uint32Array(512), sums = new Float64Array(512 * 3);
    const border: number[] = [];
    let left = width, right = 0, top = height, bottom = 0;
    for (let head = 0; head < pixels.length; head++) {
      const i = pixels[head]!, x = i % width, y = Math.floor(i / width), p = i * 4;
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      const bucket = (data[p]! >> 5) * 64 + (data[p + 1]! >> 5) * 8 + (data[p + 2]! >> 5);
      histogram[bucket] = histogram[bucket]! + 1;
      for (let channel = 0; channel < 3; channel++) sums[bucket * 3 + channel] = sums[bucket * 3 + channel]! + data[p + channel]!;
      let edge = false;
      for (const [dx, dy] of EDGE) {
        const nx = x + dx, ny = y + dy, j = ny * width + nx;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height || coverage[j]! < 128) { edge = true; continue; }
        if (!seen[j]) { seen[j] = 1; pixels.push(j); }
      }
      if (edge) { distance[i] = 1; border.push(i); }
    }
    let dominant = 0;
    for (let i = 1; i < histogram.length; i++) if (histogram[i]! > histogram[dominant]!) dominant = i;
    const color = [0, 1, 2].map(c => sums[dominant * 3 + c]! / histogram[dominant]!);
    const contrasts = new Uint32Array(256);
    const delta = (i: number) => Math.min(255, Math.round(Math.sqrt(color.reduce((sum, v, c) => sum + (data[i * 4 + c]! - v) ** 2, 0) / 3)));
    for (const i of pixels) contrasts[delta(i)]!++;
    const threshold = contrastSplit(contrasts);
    const rim = Math.max(1, Math.round(Math.min(right - left + 1, bottom - top + 1) * 0.05));
    for (let head = 0; head < border.length; head++) {
      const i = border[head]!, x = i % width, y = Math.floor(i / width);
      for (const [dx, dy] of EDGE) {
        const nx = x + dx, ny = y + dy, j = ny * width + nx;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height || coverage[j]! < 128 || distance[j]) continue;
        distance[j] = distance[i]! + 1; border.push(j);
      }
    }
    for (const i of pixels) if (distance[i]! > rim && delta(i) > threshold) detail[i] = 1;
    for (const i of pixels) {
      if (!detail[i]) continue;
      const feature = [i]; detail[i] = 0;
      for (let head = 0; head < feature.length; head++) {
        const j = feature[head]!, x = j % width, y = Math.floor(j / width);
        for (const [dx, dy] of EDGE) {
          const nx = x + dx, ny = y + dy, k = ny * width + nx;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height || !detail[k]) continue;
          detail[k] = 0; feature.push(k);
        }
      }
      if (feature.length < Math.max(4, pixels.length * minimumDetail)) continue;
      // A dark outline follows the outside edge; it must not become an interior cutout.
      if (feature.reduce((sum, i) => sum + distance[i]!, 0) / feature.length < rim * 1.4) continue;
      const average = [0, 1, 2].map(c => feature.reduce((sum, i) => sum + data[i * 4 + c]!, 0) / feature.length);
      const brightness = (rgb: number[]) => rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
      const tint = (rgb: number[]) => {
        const low = Math.min(...rgb), span = Math.max(...rgb) - low;
        return span < 25 ? null : rgb.map(value => (value - low) / span);
      };
      const baseTint = tint(color), detailTint = tint(average);
      const sameTint = !baseTint || !detailTint || baseTint.every((value, c) => Math.abs(value - detailTint[c]!) < 0.3);
      const centerY = feature.reduce((sum, i) => sum + Math.floor(i / width), 0) / feature.length;
      const nearEdge = centerY < top + (bottom - top) * 0.35 || centerY > top + (bottom - top) * 0.82;
      if (nearEdge && sameTint && brightness(average) > brightness(color) + 20) continue;
      let contrast = 0, perimeter = 0;
      for (const j of feature) {
        const x = j % width, y = Math.floor(j / width);
        for (const [dx, dy] of EDGE) {
          const nx = x + dx, ny = y + dy, k = ny * width + nx;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height || (distance[k]! > rim && delta(k) > threshold)) continue;
          contrast += Math.sqrt([0, 1, 2].reduce((sum, c) => sum + (data[j * 4 + c]! - data[k * 4 + c]!) ** 2, 0) / 3);
          perimeter++;
        }
      }
      // Gradual lighting changes do not carry the identity of a face, emblem or symbol.
      if (contrast / Math.max(1, perimeter) >= 12) {
        details.push(feature);
        for (const j of feature) coverage[j] = 0;
      }
    }
  }
  const ink = Uint8Array.from(coverage, value => value >= 128 ? 1 : 0);
  return { width, height, coverage, silhouette, details, pieces: textTopology(ink, width, height).pieces, edgeRuns: edgeRuns(silhouette, width, height) };
}

/** Preserve the silhouette while assigning each visible contrast feature distinct interior cells. */
export function fitEmojiDrawing(source: EmojiDrawing, box: { width: number; height: number }): { stencil: Stencil; ok: boolean; loss: number } | null {
  if (![box.width, box.height].every(side => Number.isInteger(side) && side >= 5)) return null;
  const first = fitDrawing(source, box);
  if (!first || (first.ok && !first.notches)) return first;
  let best = first;
  // A spare row or column can move a thin feature onto a cell without enlarging the region.
  for (const [dx, dy] of [[1, 1], [1, 0], [0, 1], [2, 2]]) {
    const width = box.width - dx!, height = box.height - dy!;
    if (width < 5 || height < 5) continue;
    const smaller = fitDrawing(source, { width, height });
    if (!smaller?.ok || (best.ok && smaller.notches >= best.notches)) continue;
    const coverage = new Uint8Array(box.width * box.height), ox = Math.floor(dx! / 2), oy = Math.floor(dy! / 2);
    for (let y = 0; y < height; y++) coverage.set(smaller.stencil.coverage.subarray(y * width, (y + 1) * width), (y + oy) * box.width + ox);
    best = { ...smaller, stencil: { ...box, coverage, color: new Uint32Array(coverage.length), cellAligned: true } };
    if (!best.notches) return best;
  }
  return best;
}

function fitDrawing(source: EmojiDrawing, box: { width: number; height: number }): { stencil: Stencil; ok: boolean; loss: number; notches: number } | null {
  const stencil = sampleTextMask({ ...source, coverage: source.silhouette }, box);
  if (!stencil) return null;
  const { width, height } = box;
  const scale = Math.min(width / source.width, height / source.height);
  const ox = (width - source.width * scale) / 2, oy = (height - source.height * scale) / 2;
  const body = stencil.coverage.slice();
  const sampled = sampleTextMask(source, box)!;
  const labels = new Int16Array(width * height).fill(-1);
  let missing = 0, nativeMissing = 0;
  const features = source.details.map((pixels, id) => ({ pixels, id, area: pixels.length * scale * scale }))
    .filter(feature => feature.area >= 0.12).sort((a, b) => a.area - b.area);
  for (const { pixels, id, area } of features) {
    const weights = new Float32Array(width * height);
    let cx = 0, cy = 0;
    for (const i of pixels) {
      const x0 = (i % source.width) * scale + ox, y0 = Math.floor(i / source.width) * scale + oy;
      const x1 = x0 + scale, y1 = y0 + scale;
      cx += (x0 + x1) / 2; cy += (y0 + y1) / 2;
      for (let y = Math.max(0, Math.floor(y0)); y < Math.min(height, Math.ceil(y1)); y++) {
        for (let x = Math.max(0, Math.floor(x0)); x < Math.min(width, Math.ceil(x1)); x++) {
          const at = y * width + x;
          weights[at] = weights[at]! + (Math.min(x + 1, x1) - Math.max(x, x0)) * (Math.min(y + 1, y1) - Math.max(y, y0));
        }
      }
    }
    cx /= pixels.length; cy /= pixels.length;
    const candidates: { i: number; score: number }[] = [];
    for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      if (body[i]! < 128 || EDGE.some(([dx, dy]) => body[(y + dy) * width + x + dx]! < 128)) continue;
      const distance = (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2;
      if (weights[i]! > 0 || distance < 2) candidates.push({ i, score: weights[i]! - distance * 0.015 });
    }
    candidates.sort((a, b) => b.score - a.score);
    if (!candidates.some(({ i }) => sampled.coverage[i]! < 128 && weights[i]! > 0)) nativeMissing++;
    const wanted = Math.max(1, Math.round(area));
    let kept = 0;
    for (const { i, score } of candidates) {
      if (kept >= wanted || (kept && score <= 0)) break;
      const x = i % width, y = Math.floor(i / width);
      if (labels[i] !== -1 || EDGE.some(([dx, dy]) => {
        const label = labels[(y + dy) * width + x + dx]!;
        return label !== -1 && label !== id;
      })) continue;
      labels[i] = id;
      stencil.coverage[i] = 0;
      kept++;
    }
    if (!kept) missing++;
  }
  const mass = body.reduce((sum, value) => sum + value, 0);
  if (!mass) return null;
  const error = (candidate: Stencil) => candidate.coverage.reduce((sum, value, i) => sum + Math.abs((value >= 128 ? 255 : 0) - sampled.coverage[i]!), 0) / mass;
  const fittedError = error(stencil), nativeError = error(sampled);
  const result = nativeError + nativeMissing * 0.05 < fittedError + missing * 0.05 ? sampled : stencil;
  result.coverage = Uint8Array.from(result.coverage, value => value >= 128 ? 255 : 0);
  const pieces = textTopology(result.coverage, width, height).pieces;
  const edges = edgeRuns(body, width, height);
  const lostNotches = source.edgeRuns.reduce((sum, runs, i) => sum + Math.max(0, runs - Math.max(1, edges[i]!)), 0);
  const loss = Math.max(0, (result === sampled ? nativeError : fittedError) + Math.max(0, source.pieces - pieces) * 0.025 - 0.35);
  return { stencil: result, ok: loss === 0, loss, notches: lostNotches };
}
