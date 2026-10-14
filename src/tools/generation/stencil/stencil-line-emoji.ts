import type { EmojiDrawing } from './stencil-emoji-mask';
import { analyzeTextGrid, type TextGridModel } from './stencil-text-grid';

/** Emoji use their perimeter and contrasting features, rather than the medial axis of a filled body. */
export function emojiLineModel(drawing: EmojiDrawing): TextGridModel | null {
  const { width, height, silhouette, details } = drawing;
  const coverage = new Uint8Array(width * height);
  const radius = Math.max(1, Math.round(Math.min(width, height) / 32));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (silhouette[i]! < 128) continue;
    for (let dy = -radius; dy <= radius && !coverage[i]; dy++) for (let dx = -radius; dx <= radius; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height || silhouette[ny * width + nx]! < 128) {
        coverage[i] = 255;
        break;
      }
    }
  }
  for (const feature of details) for (const i of feature) coverage[i] = 255;
  return analyzeTextGrid({ width, height, coverage });
}
