import { createWorker, OEM, PSM } from 'tesseract.js';
import { OCR_LANGUAGES, OCR_WORKER_URL, ocrCoreUrl } from './assets';
import { simd } from 'wasm-feature-detect';
import { confirmedReading, restrictedReading } from './evidence';
import { loadLexicon, type Provisional } from '../text/segmenter';
import { crop } from './raster';

/** A provisional phrase hit loads the segmentation lexicon once, then the reading is evaluated again. */
async function confirmed(evaluate: () => Provisional<boolean>): Promise<boolean> {
  const first = evaluate();
  if (!first.provisional) return first.verdict;
  await loadLexicon();
  return evaluate().verdict;
}

/** `unavailable` when the close-reading budget runs out before every line is read. */
export type LetterCheck = 'blocked' | 'clear' | 'unavailable';

export async function checkLetters(views: OffscreenCanvas[], assetBase: string): Promise<LetterCheck> {
  const worker = await createWorker(OCR_LANGUAGES.join('+'), OEM.LSTM_ONLY, {
    workerPath: OCR_WORKER_URL, workerBlobURL: false,
    corePath: ocrCoreUrl(await simd()),
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
        if (!(await confirmed(() => restrictedReading(line.text, line.confidence)))) continue;
        if (++confirmations > 4) return 'unavailable';
        const { x0, y0, x1, y1 } = line.bbox;
        const x = Math.max(0, x0 - 12), y = Math.max(0, y0 - 12);
        const w = Math.min(canvas.width, x1 + 12) - x, h = Math.min(canvas.height, y1 + 12) - y;
        if (w <= 0 || h <= 0) continue;
        const close = crop(canvas, { x, y, width: w, height: h }, Math.min(1600, Math.max(300, w * 2)));
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE });
        const check = await worker.recognize(close as unknown as HTMLCanvasElement);
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
        if (await confirmed(() => confirmedReading(line.text, check.data.text, check.data.confidence))) return 'blocked';
      }
    }
    return 'clear';
  } finally { await worker.terminate(); }
}
