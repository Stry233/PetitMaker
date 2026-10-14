// The SiliconFlow shape (also the custom-endpoint row's dialect): a JSON `images/generations`
// call carrying the Qwen-Image-Edit-2509 three-image convention, source/style/layout mapped to
// image/image2/image3. No size param: an edit model follows its input's own shape.
import type { AspectOption } from '../normalize';
import { firstReplyImage } from './fetch-image';
import { listModelIds, requestJson } from './http';
import type { StylizeDialect } from './types';
import { orderByRole } from './request';

const ASPECTS: readonly AspectOption[] = [
  { id: '1:1', ratio: 1 },
  { id: '4:3', ratio: 4 / 3 },
  { id: '3:4', ratio: 3 / 4 },
  { id: '16:9', ratio: 16 / 9 },
  { id: '9:16', ratio: 9 / 16 },
];

export const openaiCompatibleDialect: StylizeDialect = {
  aspects: ASPECTS,
  maxEdge: 1408,
  maxImages: 3,
  // `image`, `image2`, `image3` in this order.
  imageOrder: ['source', 'style', 'layout'],
  canJudge: false,

  listModels(cfg, signal) {
    return listModelIds(cfg, '/v1/models', { field: 'data', idKey: 'id', signal });
  },

  async generate(cfg, req, signal) {
    const [first, second, third] = orderByRole(req.images, openaiCompatibleDialect.imageOrder);
    const body: Record<string, string> = { model: cfg.model, prompt: req.prompt, image: first?.dataUrl ?? '' };
    if (second) body.image2 = second.dataUrl;
    if (third) body.image3 = third.dataUrl;

    const json = await requestJson(cfg, '/v1/images/generations', { json: body, signal });
    return firstReplyImage(json, signal);
  },
};
