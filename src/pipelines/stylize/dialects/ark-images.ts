// Doubao / Seedream over the Volcano Ark `images/generations` route: one JSON call, reference
// images as data URLs (`image` takes a string or an array), the output asked back as base64.
// The CN endpoint (`ark.cn-beijing.volces.com`) answers browser CORS with the caller's own origin
// and allows the Authorization header; the international BytePlus mirror does not allow
// `Authorization` through preflight, so a browser cannot speak to it and only the CN host is
// offered. Seedream stamps its own watermark by default — sent `false`, since the export pipeline
// draws the AI notation itself.
import type { AspectOption } from '../normalize';
import { firstReplyImage } from './fetch-image';
import { requestJson } from './http';
import { StylizeError, type StylizeDialect } from './types';
import { orderByRole } from './request';

/** Seedream's documented 2K preset table: the size sent is the exact preset for the chosen
 *  aspect, which keeps the request inside the model's total-pixel window
 *  [1280x720, 2048x2048x1.1025] at its best quality tier. */
const SIZE_BY_ASPECT: Record<string, string> = {
  '1:1': '2048x2048',
  '4:3': '2368x1776',
  '3:4': '1776x2368',
  '3:2': '2496x1664',
  '2:3': '1664x2496',
  '16:9': '2816x1584',
  '9:16': '1584x2816',
};

const ASPECTS: readonly AspectOption[] = [
  { id: '1:1', ratio: 1 },
  { id: '4:3', ratio: 4 / 3 },
  { id: '3:4', ratio: 3 / 4 },
  { id: '3:2', ratio: 3 / 2 },
  { id: '2:3', ratio: 2 / 3 },
  { id: '16:9', ratio: 16 / 9 },
  { id: '9:16', ratio: 9 / 16 },
];

export const arkImagesDialect: StylizeDialect = {
  aspects: ASPECTS,
  maxEdge: 2048,
  // Source plus the style anchor; Seedream reads multiple reference images in one call.
  maxImages: 2,
  // Seedream reads the array in order: the map first, the style anchor after it.
  imageOrder: ['source', 'style'],
  canJudge: false,

  // Ark's model list sends no CORS headers, so a browser can never read it; the typed model stands
  // and the first generation tests the key.
  listModels() {
    return Promise.resolve(null);
  },

  async generate(cfg, req, signal) {
    const ordered = orderByRole(req.images, arkImagesDialect.imageOrder);
    if (ordered.length === 0) throw new StylizeError('bad_response', 'no image supplied');
    const urls = ordered.map((i) => i.dataUrl);

    const body = {
      model: cfg.model,
      prompt: req.prompt,
      image: urls.length === 1 ? urls[0] : urls,
      size: SIZE_BY_ASPECT[req.aspectId] ?? '2048x2048',
      response_format: 'b64_json',
      watermark: false,
      sequential_image_generation: 'disabled',
    };

    const json = await requestJson(cfg, '/api/v3/images/generations', { json: body, signal });
    return firstReplyImage(json, signal);
  },
};
