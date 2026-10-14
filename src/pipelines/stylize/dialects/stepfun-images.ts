// StepFun over its OpenAI-shaped `images/edits`: a single-image edit call, no size field
// (the model follows its one input's own shape). `maxImages: 1` means the engine's style anchor
// self-disables on this dialect — there is no second slot for it to ride in.
import { dataUrlToBlob } from '../../../platform/remote/data-url';
import type { AspectOption } from '../normalize';
import { firstReplyImage } from './fetch-image';
import { listModelIds, newestFirst, requestJson } from './http';
import { StylizeError, type StylizeDialect } from './types';
import { orderByRole } from './request';

const ASPECTS: readonly AspectOption[] = [
  { id: '1:1', ratio: 1 },
  { id: '4:3', ratio: 4 / 3 },
  { id: '3:4', ratio: 3 / 4 },
  { id: '16:9', ratio: 16 / 9 },
  { id: '9:16', ratio: 9 / 16 },
];

export const stepfunImagesDialect: StylizeDialect = {
  aspects: ASPECTS,
  maxEdge: 1408,
  maxImages: 1,
  imageOrder: ['source'],
  canJudge: false,

  async listModels(cfg, signal) {
    const ids = await listModelIds(cfg, '/v1/models', { field: 'data', idKey: 'id', signal });
    return ids && newestFirst(ids.filter((id) => /step.*(image|1x)/i.test(id)));
  },

  async generate(cfg, req, signal) {
    const [source] = orderByRole(req.images, stepfunImagesDialect.imageOrder);
    if (!source) throw new StylizeError('bad_response', 'no image supplied');

    const form = new FormData();
    form.append('model', cfg.model);
    form.append('image', dataUrlToBlob(source.dataUrl), 'image.png');
    form.append('prompt', req.prompt);
    form.append('response_format', 'b64_json');

    const json = await requestJson(cfg, '/v1/images/edits', { form, signal });
    return firstReplyImage(json, signal);
  },
};
