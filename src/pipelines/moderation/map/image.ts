import * as tf from '@tensorflow/tfjs';
import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm';
import { NSFW_MODEL, TF_WASM_PATHS } from './assets';
import { load } from 'nsfwjs/core';
import { explicitImage } from './evidence';
import { crop } from './raster';

export async function checkImage(views: OffscreenCanvas[], assetBase: string): Promise<boolean> {
  setWasmPaths({ ...TF_WASM_PATHS });
  tf.enableProdMode();
  await tf.setBackend('wasm'); await tf.ready();
  const model = await load(new URL(NSFW_MODEL, assetBase).href);
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
        const first = await predict(crop(view, { x: x!, y: y!, width: w!, height: h! }, 224));
        if (first && first === await predict(crop(view, { x: x!, y: y!, width: w!, height: h! }, 256, true))) return true;
      }
    }
    return false;
  } finally { model.dispose(); }
}
