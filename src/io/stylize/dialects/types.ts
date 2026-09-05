// The provider-agnostic shape every dialect implements, and the classified errors that reach the
// UI's status slot. `StylizeStatus` is intentionally coarse: the UI wears exactly one face per
// status (bad_key/refused/network/bad_response), never the provider's own wording.
import type { AspectOption } from '../normalize';

/** `device` is the one outcome with no provider behind it: an on-device model that this machine could
 *  not load or run. */
export type StylizeStatus = 'bad_key' | 'refused' | 'network' | 'bad_response' | 'device';

export class StylizeError extends Error {
  status: StylizeStatus;
  constructor(status: StylizeStatus, detail?: string) {
    super(detail ?? status);
    this.name = 'StylizeError';
    this.status = status;
  }
}

export interface StylizeImage { role: 'style' | 'layout' | 'source'; dataUrl: string }

export interface DialectConfig { key: string; baseUrl: string; model: string }

export type DialectId = 'gemini' | 'openai-images' | 'openai-compatible' | 'stepfun-images' | 'modelscope-images' | 'ark-images';

export interface StylizeDialect {
  /** Aspect frames this dialect can ask for (drives planNormalize). */
  aspects: readonly AspectOption[];
  /** Long-edge ceiling for the input image sent to the provider. */
  maxEdge: number;
  /** How many input images one call may carry (1 = source only; extra roles are dropped
   *  style-first by the engine). */
  maxImages: number;
  /** Whether this dialect can act as the judge (vision critique) in a refine recipe. */
  canJudge: boolean;
  /** `null` means the endpoint would not enumerate (a fetch failure or a non-2xx reply); an empty
   *  array is a successful call that found nothing to list. */
  listModels(cfg: DialectConfig, signal?: AbortSignal): Promise<string[] | null>;
  /** `images` arrives role-tagged; EACH DIALECT places them per its own wire convention: gemini
   *  sends the source LAST (the last image dictates output aspect there), openai-images sends the
   *  source FIRST (the edit target), openai-compatible maps source->image, style->image2,
   *  layout->image3. */
  generate(cfg: DialectConfig, req: { images: StylizeImage[]; prompt: string; aspectId: string }, signal?: AbortSignal): Promise<string>;
  /** One vision critique of `output` against `source` + the manifest clauses; returns correction
   *  clauses, or [] when faithful. Only where `canJudge`. */
  judge?(cfg: DialectConfig, req: { source: string; output: string; scene: string[] }, signal?: AbortSignal): Promise<string[]>;
}
