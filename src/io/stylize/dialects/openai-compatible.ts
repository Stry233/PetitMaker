// The SiliconFlow shape (also the custom-endpoint row's dialect): a JSON `images/generations`
// call carrying the Qwen-Image-Edit-2509 three-image convention, source/style/layout mapped to
// image/image2/image3. No size param: an edit model follows its input's own shape.
import type { AspectOption } from '../normalize';
import { classify, scrub } from './errors';
import { firstReplyImage } from './fetch-image';
import { StylizeError, type StylizeDialect } from './types';
import { roleOf } from './request';

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

    return firstReplyImage(json, signal);
  },
};
