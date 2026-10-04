// OpenAI's `images/edits`: a multipart edit call, the source image FIRST in `image[]` since that
// is the edit target the API redraws; any style/layout roles ride after it as extra references.
import { dataUrlToBlob } from '../../image-export';
import type { AspectOption } from '../normalize';
import { classify, scrub } from './errors';
import { firstReplyImage } from './fetch-image';
import { StylizeError, type StylizeDialect } from './types';
import { baseOf, orderByRole } from './request';

const DEFAULT_BASE = 'https://api.openai.com';

const ASPECTS: readonly AspectOption[] = [
  { id: '1:1', ratio: 1 },
  { id: '3:2', ratio: 3 / 2 },
  { id: '2:3', ratio: 2 / 3 },
];

export const openaiImagesDialect: StylizeDialect = {
  aspects: ASPECTS,
  maxEdge: 1536,
  maxImages: 3,
  canJudge: false,

  async listModels(cfg, signal) {
    let res: Response;
    try {
      res = await fetch(`${baseOf(cfg, DEFAULT_BASE)}/v1/models`, {
        headers: { Authorization: `Bearer ${cfg.key}` },
        signal,
      });
    } catch {
      return null;
    }
    if (!res.ok) return null;
    const json = (await res.json().catch(() => null)) as { data?: Array<{ id: string }> } | null;
    if (!json?.data) return null;
    return json.data
      .map((m) => m.id)
      .filter((id) => /^(gpt-image|dall-e)/.test(id))
      .sort()
      .reverse();
  },

  async generate(cfg, req, signal) {
    const form = new FormData();
    form.append('model', cfg.model);
    // Source first (the edit target), then any remaining roles as references.
    for (const img of orderByRole(req.images, ['source'], 'keep')) form.append('image[]', dataUrlToBlob(img.dataUrl), 'image.png');
    form.append('prompt', req.prompt);
    form.append('size', 'auto');
    form.append('n', '1');

    let res: Response;
    try {
      res = await fetch(`${baseOf(cfg, DEFAULT_BASE)}/v1/images/edits`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.key}` },
        body: form,
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
