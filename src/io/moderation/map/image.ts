import * as tf from '@tensorflow/tfjs';
import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm';
import wasm from '@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm.wasm?url';
import simd from '@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm-simd.wasm?url';
import threaded from '@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm-threaded-simd.wasm?url';
import { load } from 'nsfwjs/core';
import { explicitImage } from './evidence';
import { crop } from './raster';

export async function checkImage(views: OffscreenCanvas[], assetBase: string): Promise<boolean> {
  setWasmPaths({ 'tfjs-backend-wasm.wasm': wasm, 'tfjs-backend-wasm-simd.wasm': simd, 'tfjs-backend-wasm-threaded-simd.wasm': threaded });
  tf.enableProdMode();
  await tf.setBackend('wasm'); await tf.ready();
  const model = await load(new URL('nsfw/model.json', assetBase).href);
  const predict = async (canvas: OffscreenCanvas) => {
    const image = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    const tensor = tf.browser.fromPixels(image);
    try { return explicitImage(await model.classify(tensor)); } finally { tensor.dispose(); }
  };
  try {
    for (const view of views) {
      const regions = [[0, 0, view.width, view.height]];
      // Large overlapping regions preserve context and bound both inference cost and false alarms.
      if (view.width > 400 && view.height > 400) {
        for (const x of [0, 0.35]) for (const y of [0, 0.35]) regions.push([view.width * x, view.height * y, view.width * 0.65, view.height * 0.65]);
      }
      for (const [x, y, w, h] of regions) {
        const first = await predict(crop(view, x!, y!, w!, h!, 224));
        if (first && first === await predict(crop(view, x!, y!, w!, h!, 256, true))) return true;
      }
    }
    return false;
  } finally { model.dispose(); }
}
