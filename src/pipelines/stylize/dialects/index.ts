// The dialect barrel: one table from DialectId to its implementation, with the shared types and
// error helpers; outside the pipeline it is reached through `stylize/index.ts`.
import { arkImagesDialect } from './ark-images';
import { geminiDialect } from './gemini';
import { modelscopeImagesDialect } from './modelscope-images';
import { openaiCompatibleDialect } from './openai-compatible';
import { openaiImagesDialect } from './openai-images';
import { stepfunImagesDialect } from './stepfun-images';
import type { DialectId, StylizeDialect } from './types';

export * from './types';
export { classify, scrub, toStylizeStatus } from './errors';

export const DIALECTS: Record<DialectId, StylizeDialect> = {
  gemini: geminiDialect,
  'openai-images': openaiImagesDialect,
  'openai-compatible': openaiCompatibleDialect,
  'stepfun-images': stepfunImagesDialect,
  'modelscope-images': modelscopeImagesDialect,
  'ark-images': arkImagesDialect,
};
