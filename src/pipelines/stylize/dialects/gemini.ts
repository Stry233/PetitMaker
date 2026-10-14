// Google Gemini over the classic rest `generateContent` path (never the newer Interactions API,
// which sets a custom header that fails browser preflight). Images ride as `inline_data` parts,
// source last: that final image is what dictates the model's own sense of output aspect.
import type { AspectOption } from '../normalize';
import { parseDataUrl } from '../../../platform/remote/data-url';
import { quotePromptData } from '../../../platform/remote/prompt-data';
import { listModelIds, newestFirst, requestJson } from './http';
import { StylizeError, type StylizeDialect } from './types';
import { orderByRole } from './request';

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

/** An image as Gemini's `inline_data` part. A malformed source is a caller bug (it always built the
 *  data URL itself), so this throws rather than smuggling a bare string past the API. */
function inlineData(dataUrl: string): { mimeType: string; data: string } {
  const parts = parseDataUrl(dataUrl);
  if (!parts) throw new StylizeError('bad_response', 'malformed image data');
  return { mimeType: parts.mime, data: parts.base64 };
}

interface GenerateContentResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> } }>;
}

export const geminiDialect: StylizeDialect = {
  aspects: ASPECTS,
  maxEdge: 1536,
  maxImages: 4,
  imageOrder: ['style', 'layout', 'source'],
  canJudge: true,

  async listModels(cfg, signal) {
    const names = await listModelIds(cfg, '/v1beta/models?pageSize=1000', { auth: 'goog', field: 'models', idKey: 'name', signal });
    return names && newestFirst(names.filter((name) => name.includes('image')).map((name) => name.replace(/^models\//, '')));
  },

  async generate(cfg, req, signal) {
    const parts = [
      ...orderByRole(req.images, geminiDialect.imageOrder).map((img) => ({ inline_data: inlineData(img.dataUrl) })),
      { text: req.prompt },
    ];
    const body = {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: 'user', parts }],
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: req.aspectId } },
    };
    const json = (await requestJson(cfg, `/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`, { auth: 'goog', json: body, signal })) as GenerateContentResponse;
    const parts_ = json.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts_) || parts_.length === 0) throw new StylizeError('bad_response');
    const imagePart = parts_.find((p) => p.inlineData);
    if (!imagePart?.inlineData) throw new StylizeError('refused');
    return `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
  },

  async judge(cfg, req, signal) {
    const body = {
      systemInstruction: { parts: [{ text: req.instructions }] },
      contents: [{
        role: 'user',
        parts: [
          { inline_data: inlineData(req.source) },
          { inline_data: inlineData(req.output) },
          {
            text: `Scene facts: <scene_data>${quotePromptData(req.scene)}</scene_data>`,
          },
        ],
      }],
      generationConfig: { responseModalities: ['TEXT'] },
    };
    const json = (await requestJson(cfg, `/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`, { auth: 'goog', json: body, signal })) as GenerateContentResponse;
    const textPart = json.candidates?.[0]?.content?.parts?.find((p) => typeof p.text === 'string');
    const text = (textPart?.text ?? '').trim();
    if (text.length === 0 || /all clear/i.test(text)) return [];
    return text.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
  },
};
