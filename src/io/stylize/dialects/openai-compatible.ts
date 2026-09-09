// The SiliconFlow shape (also the custom-endpoint row's dialect): a JSON `images/generations`
// call carrying the Qwen-Image-Edit-2509 three-image convention, source/style/layout mapped to
// image/image2/image3. No size param: an edit model follows its input's own shape.
import type { AspectOption } from '../normalize';
import { classify, scrub } from './errors';
import { responseToDataUrl } from './image-response';
import { StylizeError, type StylizeDialect, type StylizeImage } from './types';

const ASPECTS: readonly AspectOption[] = [
  { id: '1:1', ratio: 1 },
  { id: '4:3', ratio: 4 / 3 },
  { id: '3:4', ratio: 3 / 4 },
  { id: '16:9', ratio: 16 / 9 },
  { id: '9:16', ratio: 9 / 16 },
];

/** Reads a fetched image reply straight off its `ArrayBuffer`, never through `Blob`: browsers
 *  agree on `Response#arrayBuffer`, and it is the one path that needs no intermediate object. */
function roleOf(images: readonly StylizeImage[], role: StylizeImage['role']): StylizeImage | undefined {
  return images.find((i) => i.role === role);
}

interface GenerationsResponse { data?: Array<{ b64_json?: string; url?: string }> }

export const openaiCompatibleDialect: StylizeDialect = {
  aspects: ASPECTS,
  maxEdge: 1408,
  maxImages: 3,
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
    if (!json?.data) return null;
    return json.data.map((m) => m.id);
  },

  async generate(cfg, req, signal) {
    const source = roleOf(req.images, 'source');
    const style = roleOf(req.images, 'style');
    const layout = roleOf(req.images, 'layout');
    const body: Record<string, string> = { model: cfg.model, prompt: req.prompt, image: source?.dataUrl ?? '' };
    if (style) body.image2 = style.dataUrl;
    if (layout) body.image3 = layout.dataUrl;

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

    const item = (json as GenerationsResponse).data?.[0];
    if (!item) throw new StylizeError('bad_response');
    if (item.b64_json) return `data:image/png;base64,${item.b64_json}`;
    if (item.url) {
      // The url is short-lived: fetch it now and re-encode, since the caller keeps the result
      // around for the session (versionStore never persists a remote reference).
      let imgRes: Response;
      try {
        imgRes = await fetch(item.url, { signal });
      } catch (err) {
        throw new StylizeError('network', scrub(String(err instanceof Error ? err.message : err)));
      }
      if (!imgRes.ok) throw new StylizeError('bad_response');
      return responseToDataUrl(imgRes);
    }
    throw new StylizeError('bad_response');
  },
};
