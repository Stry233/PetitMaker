// The dialect barrel: one table from DialectId to its implementation, the module's only
// UI-consumed surface alongside the shared types and error helpers.
import { arkImagesDialect } from './ark-images';
import { geminiDialect } from './gemini';
import { modelscopeImagesDialect } from './modelscope-images';
import { openaiCompatibleDialect } from './openai-compatible';
import { openaiImagesDialect } from './openai-images';
import { stepfunImagesDialect } from './stepfun-images';
import type { DialectId, StylizeDialect } from './types';

export * from './types';
export { classify, scrub } from './errors';

export const DIALECTS: Record<DialectId, StylizeDialect> = {
  gemini: geminiDialect,
  'openai-images': openaiImagesDialect,
  'openai-compatible': openaiCompatibleDialect,
  'stepfun-images': stepfunImagesDialect,
  'modelscope-images': modelscopeImagesDialect,
  'ark-images': arkImagesDialect,
};
