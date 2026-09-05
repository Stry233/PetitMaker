// StepFun (阶跃星辰) over its OpenAI-shaped `images/edits`: a single-image edit call, no size field
// (the model follows its one input's own shape). `maxImages: 1` means the engine's style anchor
// self-disables on this dialect — there is no second slot for it to ride in.
import { dataUrlToBlob } from '../../image-export';
import type { AspectOption } from '../normalize';
import { classify, scrub } from './errors';
import { StylizeError, type DialectConfig, type StylizeDialect, type StylizeImage } from './types';

const DEFAULT_BASE = 'https://api.stepfun.com';

const ASPECTS: readonly AspectOption[] = [
  { id: '1:1', ratio: 1 },
  { id: '4:3', ratio: 4 / 3 },
  { id: '3:4', ratio: 3 / 4 },
  { id: '16:9', ratio: 16 / 9 },
  { id: '9:16', ratio: 9 / 16 },
];

function baseOf(cfg: DialectConfig): string {
  return cfg.baseUrl || DEFAULT_BASE;
}

/** Reads a fetched image reply straight off its `ArrayBuffer`, never through `Blob`: browsers
 *  agree on `Response#arrayBuffer`, and it is the one path that needs no intermediate object. */
async function responseToDataUrl(res: Response): Promise<string> {
  const bytes = new Uint8Array(await res.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  const mime = res.headers.get('content-type')?.split(';')[0]?.trim() || 'image/png';
  return `data:${mime};base64,${btoa(binary)}`;
}

interface EditsResponse { data?: Array<{ b64_json?: string; url?: string }> }

export const stepfunImagesDialect: StylizeDialect = {
  aspects: ASPECTS,
  maxEdge: 1408,
  maxImages: 1,
  canJudge: false,

  async listModels(cfg, signal) {
    let res: Response;
    try {
      res = await fetch(`${baseOf(cfg)}/v1/models`, {
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
      .filter((id) => /step.*(image|1x)/i.test(id))
      .sort()
      .reverse();
  },

  async generate(cfg, req, signal) {
    // A single input image; the last role-tagged entry is the source (the only role the engine
    // still sends once `maxImages: 1` has dropped style and layout).
    const source = req.images[req.images.length - 1] as StylizeImage | undefined;
    if (!source) throw new StylizeError('bad_response', 'no image supplied');

    const form = new FormData();
    form.append('model', cfg.model);
    form.append('image', dataUrlToBlob(source.dataUrl), 'image.png');
    form.append('prompt', req.prompt);
    form.append('response_format', 'b64_json');

    let res: Response;
    try {
      res = await fetch(`${baseOf(cfg)}/v1/images/edits`, {
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

    const item = (json as EditsResponse).data?.[0];
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
