// ModelScope (魔搭) over its own `images/generations`: a JSON call carrying an `images` array in
// role order (style, then source last), no custom headers beyond Authorization/Content-Type since
// the endpoint's CORS allow-list is closed and an extra header would fail preflight.
import type { AspectOption } from '../normalize';
import { classify, scrub } from './errors';
import { fetchProviderImage } from './fetch-image';
import { StylizeError, type StylizeDialect, type StylizeImage } from './types';

const ASPECTS: readonly AspectOption[] = [
  { id: '1:1', ratio: 1 },
  { id: '4:3', ratio: 4 / 3 },
  { id: '3:4', ratio: 3 / 4 },
  { id: '16:9', ratio: 16 / 9 },
  { id: '9:16', ratio: 9 / 16 },
];

function roleOf(images: readonly StylizeImage[], role: StylizeImage['role']): StylizeImage | undefined {
  return images.find((i) => i.role === role);
}

interface GenerationsResponse {
  data?: Array<{ b64_json?: string; url?: string }>;
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
  canJudge: false,

  async listModels(cfg, signal) {
    let res: Response;
    try {
      res = await fetch(`${cfg.baseUrl}/v1/models`, {
        headers: { Authorization: `Bearer ${cfg.key}` },
        signal,
      });
    } catch {
      return null;
    }
    if (!res.ok) return null;
    const json = (await res.json().catch(() => null)) as { data?: Array<{ id: string }> } | null;
    if (!json?.data || json.data.length === 0) return null;
    return json.data.map((m) => m.id);
  },

  async generate(cfg, req, signal) {
    const style = roleOf(req.images, 'style');
    const source = roleOf(req.images, 'source');
    const images = [style, source].filter((img): img is StylizeImage => !!img).map((img) => img.dataUrl);
    const body = { model: cfg.model, prompt: req.prompt, images };

    let res: Response;
    try {
      res = await fetch(`${cfg.baseUrl}/v1/images/generations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${cfg.key}` },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      throw new StylizeError('network', scrub(String(err instanceof Error ? err.message : err)));
    }
    const raw = await res.text();
    let json: unknown;
    try { json = raw ? JSON.parse(raw) : undefined; } catch { json = raw; }
    if (!res.ok) throw classify(res.status, json);

    return extractImage(json as GenerationsResponse, signal);
  },
};
