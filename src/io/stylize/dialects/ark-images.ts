// Doubao / Seedream over the Volcano Ark `images/generations` route: one JSON call, reference
// images as data URLs (`image` takes a string or an array), the output asked back as base64.
// The CN endpoint (`ark.cn-beijing.volces.com`) answers browser CORS with the caller's own origin
// and allows the Authorization header; the international BytePlus mirror does not allow
// `Authorization` through preflight, so a browser cannot speak to it and only the CN host is
// offered. Seedream stamps its own watermark by default — sent `false`, since the export pipeline
// draws the AI notation itself.
import type { AspectOption } from '../normalize';
import { classify, scrub } from './errors';
import { StylizeError, type DialectConfig, type StylizeDialect } from './types';

const DEFAULT_BASE = 'https://ark.cn-beijing.volces.com';

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

function baseOf(cfg: DialectConfig): string {
  return cfg.baseUrl || DEFAULT_BASE;
}

interface GenerationsResponse { data?: Array<{ b64_json?: string; url?: string }> }

async function responseToDataUrl(res: Response): Promise<string> {
  const bytes = new Uint8Array(await res.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  const mime = res.headers.get('content-type')?.split(';')[0]?.trim() || 'image/png';
  return `data:${mime};base64,${btoa(binary)}`;
}

export const arkImagesDialect: StylizeDialect = {
  aspects: ASPECTS,
  maxEdge: 2048,
  // Source plus the style anchor; Seedream reads multiple reference images in one call.
  maxImages: 2,
  canJudge: false,

  async listModels(cfg, signal) {
    let res: Response;
    try {
      res = await fetch(`${baseOf(cfg)}/api/v3/models`, {
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
      .filter((id) => /seedream|seededit/i.test(id))
      .sort()
      .reverse();
  },

  async generate(cfg, req, signal) {
    // Source first, the style anchor after it: Seedream reads the array in order, and the prompt's
    // role labels speak of the map before the reference.
    const ordered = [...req.images].sort((a, b) => (a.role === 'source' ? -1 : 0) - (b.role === 'source' ? -1 : 0));
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

    let res: Response;
    try {
      res = await fetch(`${baseOf(cfg)}/api/v3/images/generations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
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
