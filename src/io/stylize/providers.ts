// One row per supported BYOK image API, plus the custom endpoint. Display names live in i18n.
import type { DialectId } from './dialects/types.ts';

export interface StylizeProvider {
  id: 'gemini' | 'openai' | 'siliconflow' | 'stepfun' | 'modelscope' | 'doubao' | 'custom';
  dialect: DialectId;
  baseUrl: string;
  needsBaseUrl?: true;
  /** Prefilled into the typed model field where the endpoint's own list cannot enumerate, and the
   *  field is still empty; never overwrites text the user has already typed. */
  defaultModel?: string;
}

export const STYLIZE_PROVIDERS: readonly StylizeProvider[] = [
  { id: 'gemini', dialect: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com' },
  { id: 'openai', dialect: 'openai-images', baseUrl: 'https://api.openai.com' },
  { id: 'siliconflow', dialect: 'openai-compatible', baseUrl: 'https://api.siliconflow.cn' },
  { id: 'stepfun', dialect: 'stepfun-images', baseUrl: 'https://api.stepfun.com', defaultModel: 'step-image-edit-2' },
  { id: 'modelscope', dialect: 'modelscope-images', baseUrl: 'https://api-inference.modelscope.cn', defaultModel: 'Qwen/Qwen-Image-Edit-2509' },
  // BytePlus rejects browser Authorization preflights; Volcano Ark accepts cross-origin requests.
  { id: 'doubao', dialect: 'ark-images', baseUrl: 'https://ark.cn-beijing.volces.com', defaultModel: 'doubao-seedream-5-0-pro-260628' },
  { id: 'custom', dialect: 'openai-compatible', baseUrl: '', needsBaseUrl: true },
];
