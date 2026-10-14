// OpenAI's `images/edits`: a multipart edit call, the source image first in `image[]` since that
// is the edit target the API redraws; any style/layout roles ride after it as extra references.
import { dataUrlToBlob } from '../../../platform/remote/data-url';
import type { AspectOption } from '../normalize';
import { firstReplyImage } from './fetch-image';
import { listModelIds, newestFirst, requestJson } from './http';
import type { StylizeDialect } from './types';
import { orderByRole } from './request';

const ASPECTS: readonly AspectOption[] = [
  { id: '1:1', ratio: 1 },
  { id: '3:2', ratio: 3 / 2 },
  { id: '2:3', ratio: 2 / 3 },
];

export const openaiImagesDialect: StylizeDialect = {
  aspects: ASPECTS,
  maxEdge: 1536,
  maxImages: 3,
  imageOrder: ['source', 'style', 'layout'],
  canJudge: false,

  async listModels(cfg, signal) {
    const ids = await listModelIds(cfg, '/v1/models', { field: 'data', idKey: 'id', signal });
    return ids && newestFirst(ids.filter((id) => /^(gpt-image|dall-e)/.test(id)));
  },

  async generate(cfg, req, signal) {
    const form = new FormData();
    form.append('model', cfg.model);
    for (const img of orderByRole(req.images, openaiImagesDialect.imageOrder)) form.append('image[]', dataUrlToBlob(img.dataUrl), 'image.png');
    form.append('prompt', req.prompt);
    form.append('size', 'auto');
    form.append('n', '1');

    const json = await requestJson(cfg, '/v1/images/edits', { form, signal });
    return firstReplyImage(json, signal);
  },
};
