// ModelScope over its own `images/generations`: a JSON call carrying an `images` array in
// role order (style, then source last), no custom headers beyond Authorization/Content-Type since
// the endpoint's CORS allow-list is closed and an extra header would fail preflight.
import type { AspectOption } from '../normalize';
import { fetchProviderImage, type ImageDataReply } from './fetch-image';
import { listModelIds, requestJson } from './http';
import { StylizeError, type StylizeDialect } from './types';
import { orderByRole } from './request';

const ASPECTS: readonly AspectOption[] = [
  { id: '1:1', ratio: 1 },
  { id: '4:3', ratio: 4 / 3 },
  { id: '3:4', ratio: 3 / 4 },
  { id: '16:9', ratio: 16 / 9 },
  { id: '9:16', ratio: 9 / 16 },
];

interface GenerationsResponse extends ImageDataReply {
  images?: Array<{ url?: string }>;
  output?: { images?: Array<{ url?: string }> };
}

/** `b64_json` first, then the three `url` shapes this endpoint has been seen to answer with; a
 *  `url` is short-lived, so it is fetched now and re-encoded rather than kept as a remote
 *  reference (the caller holds the result for the whole session). */
async function extractImage(json: GenerationsResponse, signal?: AbortSignal): Promise<string> {
  const item = json.data?.[0];
  if (item?.b64_json) return `data:image/png;base64,${item.b64_json}`;
  const url = item?.url ?? json.images?.[0]?.url ?? json.output?.images?.[0]?.url;
  if (url) return fetchProviderImage(url, signal);
  throw new StylizeError('bad_response');
}

export const modelscopeImagesDialect: StylizeDialect = {
  aspects: ASPECTS,
  maxEdge: 1408,
  maxImages: 2,
  imageOrder: ['style', 'source'],
  canJudge: false,

  async listModels(cfg, signal) {
    const ids = await listModelIds(cfg, '/v1/models', { field: 'data', idKey: 'id', signal });
    // This endpoint answers an empty list for accounts it will still serve; the typed model stands.
    return ids && ids.length > 0 ? ids : null;
  },

  async generate(cfg, req, signal) {
    const images = orderByRole(req.images, modelscopeImagesDialect.imageOrder).map((img) => img.dataUrl);
    const body = { model: cfg.model, prompt: req.prompt, images };

    const json = await requestJson(cfg, '/v1/images/generations', { json: body, signal });
    return extractImage(json as GenerationsResponse, signal);
  },
};
