// Google Gemini over the classic REST `generateContent` path (never the newer Interactions API,
// which sets a custom header that fails browser preflight). Images ride as `inline_data` parts,
// source LAST: that final image is what dictates the model's own sense of output aspect.
import type { AspectOption } from '../normalize';
import { classify, scrub } from './errors';
import { StylizeError, type DialectConfig, type StylizeDialect, type StylizeImage } from './types';

const DEFAULT_BASE = 'https://generativelanguage.googleapis.com';

const ASPECTS: readonly AspectOption[] = [
  { id: '1:1', ratio: 1 },
  { id: '3:2', ratio: 3 / 2 },
  { id: '2:3', ratio: 2 / 3 },
  { id: '3:4', ratio: 3 / 4 },
  { id: '4:3', ratio: 4 / 3 },
  { id: '4:5', ratio: 4 / 5 },
  { id: '5:4', ratio: 5 / 4 },
  { id: '9:16', ratio: 9 / 16 },
  { id: '16:9', ratio: 16 / 9 },
  { id: '21:9', ratio: 21 / 9 },
];

/** `data:<mime>;base64,<data>` -> its two parts; a malformed source is a caller bug (it always
 *  built the data URL itself), so this throws rather than smuggling a bare string past the API. */
function parseDataUrl(dataUrl: string): { mimeType: string; data: string } {
  const match = /^data:([^;]+);base64,([\s\S]*)$/.exec(dataUrl);
  if (!match) throw new StylizeError('bad_response', 'malformed image data');
  return { mimeType: match[1]!, data: match[2]! };
}

/** Style, then layout, then source last, dropping any role absent from this call. */
function orderImages(images: readonly StylizeImage[]): StylizeImage[] {
  const byRole = (role: StylizeImage['role']) => images.filter((i) => i.role === role);
  return [...byRole('style'), ...byRole('layout'), ...byRole('source')];
}

function baseOf(cfg: DialectConfig): string {
  return cfg.baseUrl || DEFAULT_BASE;
}

async function post(cfg: DialectConfig, path: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${baseOf(cfg)}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': cfg.key },
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
  return json;
}

interface GenerateContentResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> } }>;
}

export const geminiDialect: StylizeDialect = {
  aspects: ASPECTS,
  maxEdge: 1536,
  maxImages: 4,
  canJudge: true,

  async listModels(cfg, signal) {
    let res: Response;
    try {
      res = await fetch(`${baseOf(cfg)}/v1beta/models?pageSize=1000`, {
        headers: { 'x-goog-api-key': cfg.key },
        signal,
      });
    } catch {
      return null;
    }
    if (!res.ok) return null;
    const json = (await res.json().catch(() => null)) as { models?: Array<{ name: string }> } | null;
    if (!json?.models) return null;
    return json.models
      .map((m) => m.name)
      .filter((name) => name.includes('image'))
      .map((name) => name.replace(/^models\//, ''))
      .sort()
      .reverse();
  },

  async generate(cfg, req, signal) {
    const parts = [
      ...orderImages(req.images).map((img) => ({ inline_data: parseDataUrl(img.dataUrl) })),
      { text: req.prompt },
    ];
    const body = {
      contents: [{ parts }],
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: req.aspectId } },
    };
    const json = (await post(cfg, `/v1beta/models/${cfg.model}:generateContent`, body, signal)) as GenerateContentResponse;
    const parts_ = json.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts_) || parts_.length === 0) throw new StylizeError('bad_response');
    const imagePart = parts_.find((p) => p.inlineData);
    if (!imagePart?.inlineData) throw new StylizeError('refused');
    return `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
  },

  async judge(cfg, req, signal) {
    const body = {
      contents: [{
        parts: [
          { inline_data: parseDataUrl(req.source) },
          { inline_data: parseDataUrl(req.output) },
          {
            text: 'Compare the second image against the first as a redraw of the same planning map. '
              + `The map is known to contain: ${req.scene.join('; ')}. `
              + 'List, as short imperative lines, anything the second image drew in the wrong place or omitted. '
              + 'If it faithfully preserves the layout, answer exactly "all clear".',
          },
        ],
      }],
      generationConfig: { responseModalities: ['TEXT'] },
    };
    const json = (await post(cfg, `/v1beta/models/${cfg.model}:generateContent`, body, signal)) as GenerateContentResponse;
    const textPart = json.candidates?.[0]?.content?.parts?.find((p) => typeof p.text === 'string');
    const text = (textPart?.text ?? '').trim();
    if (text.length === 0 || /all clear/i.test(text)) return [];
    return text.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
  },
};
