import { createWorker, OEM, PSM } from 'tesseract.js';
import workerPath from 'tesseract.js/dist/worker.min.js?url';
import corePath from 'tesseract.js-core/tesseract-core-lstm.wasm.js?url';
import simdPath from 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js?url';
import { simd } from 'wasm-feature-detect';
import { confirmedReading, restrictedReading } from './evidence';
import { crop } from './raster';

export async function checkLetters(views: OffscreenCanvas[], assetBase: string): Promise<boolean> {
  const worker = await createWorker('eng+chi_sim+chi_tra', OEM.LSTM_ONLY, {
    workerPath, workerBlobURL: false,
    corePath: await simd() ? simdPath : corePath,
    langPath: new URL('ocr/', assetBase).href,
    cacheMethod: 'none',
    errorHandler: () => {},
  });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    let confirmations = 0;
    for (const canvas of views) {
      const result = await worker.recognize(canvas as unknown as HTMLCanvasElement, {}, { blocks: true, text: true });
      const lines = result.data.blocks?.flatMap(b => b.paragraphs.flatMap(p => p.lines)) ?? [];
      for (const line of lines) {
        if (!restrictedReading(line.text, line.confidence)) continue;
        if (++confirmations > 4) return false;
        const { x0, y0, x1, y1 } = line.bbox;
        const x = Math.max(0, x0 - 12), y = Math.max(0, y0 - 12);
        const w = Math.min(canvas.width, x1 + 12) - x, h = Math.min(canvas.height, y1 + 12) - y;
        if (w <= 0 || h <= 0) continue;
        const close = crop(canvas, x, y, w, h, Math.min(1600, Math.max(300, w * 2)));
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE });
        const check = await worker.recognize(close as unknown as HTMLCanvasElement);
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
        if (confirmedReading(line.text, check.data.text, check.data.confidence)) return true;
      }
    }
    return false;
  } finally { await worker.terminate(); }
}
