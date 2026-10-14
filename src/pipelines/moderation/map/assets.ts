/**
 * Every file the map check loads besides its code, named once for the check itself and for the
 * page's prefetch: the model and OCR data under the site's moderation folder (content-hashed in web
 * builds, so the host caches it as immutable), and the runtime binaries Vite emits as hashed assets.
 * URL imports only: nothing here loads a runtime.
 */
import tfWasm from '@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm.wasm?url';
import tfSimd from '@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm-simd.wasm?url';
import tfThreaded from '@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm-threaded-simd.wasm?url';
import ocrWorker from 'tesseract.js/dist/worker.min.js?url';
import ocrCore from 'tesseract.js-core/tesseract-core-lstm.wasm.js?url';
import ocrCoreSimd from 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js?url';

/** The image classifier's backend binaries, by the names the backend asks for. */
export const TF_WASM_PATHS = {
  'tfjs-backend-wasm.wasm': tfWasm,
  'tfjs-backend-wasm-simd.wasm': tfSimd,
  'tfjs-backend-wasm-threaded-simd.wasm': tfThreaded,
} as const;

export const OCR_WORKER_URL = ocrWorker;
/** The OCR engine for a WebAssembly engine with SIMD, or without it. */
export function ocrCoreUrl(simd: boolean): string {
  return simd ? ocrCoreSimd : ocrCore;
}

/** OCR languages, in the order the engine reads them. */
export const OCR_LANGUAGES = ['eng', 'chi_sim', 'chi_tra'] as const;

export const NSFW_MODEL = 'nsfw/model.json';
/** Every file under the moderation folder the check reads; `nsfw/model.json` names its weights. */
export const MAP_CHECK_DATA = [NSFW_MODEL, 'nsfw/weights.bin', ...OCR_LANGUAGES.map((lang) => `ocr/${lang}.traineddata.gz`)];

/** The moderation folder's absolute URL. */
export function mapCheckAssetBase(): string {
  const dir = typeof __PETIT_MODERATION_DIR__ === 'string' ? __PETIT_MODERATION_DIR__ : 'moderation/';
  return new URL(`${import.meta.env.BASE_URL}${dir}`, location.origin).href;
}

/** The binaries the map check fetches in this browser: the image backend without threads (the page is not
 *  cross-origin isolated) and one OCR engine. */
export function mapCheckRuntimeUrls(simd: boolean): string[] {
  return [simd ? tfSimd : tfWasm, OCR_WORKER_URL, ocrCoreUrl(simd)];
}
