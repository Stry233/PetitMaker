// The provider-agnostic shape every dialect implements, and the classified errors that reach the
// UI's status slot. `StylizeStatus` is intentionally coarse: the UI wears exactly one face per
// status (bad_key/refused/network/bad_response), never the provider's own wording.
import type { AspectOption } from '../normalize';

/** `device` is an on-device model this machine could not load or run; `inappropriate` and
 *  `unchecked` come from the local text check of custom preferences, before any provider call. */
export type StylizeStatus = 'bad_key' | 'refused' | 'network' | 'bad_response' | 'device' | 'inappropriate' | 'unchecked';

export class StylizeError extends Error {
  status: StylizeStatus;
  constructor(status: StylizeStatus, detail?: string) {
    super(detail ?? status);
    this.name = 'StylizeError';
    this.status = status;
  }
}

export type ImageRole = 'style' | 'layout' | 'source';
export interface StylizeImage { role: ImageRole; dataUrl: string }

export interface DialectConfig { key: string; baseUrl: string; model: string }

export type DialectId = 'gemini' | 'openai-images' | 'openai-compatible' | 'stepfun-images' | 'modelscope-images' | 'ark-images';

/** One generation call. The prompt copy is the engine's; a dialect only places it on its wire. */
export interface GenerateRequest {
  images: StylizeImage[];
  prompt: string;
  /** The trust and policy text, which `prompt` also carries: a dialect whose API takes a system
   *  instruction sends it there as well. */
  system: string;
  aspectId: string;
}

/** One critique call: the two pictures, the scene clauses and the judge's own instructions. */
export interface JudgeRequest { source: string; output: string; scene: string[]; instructions: string }

export interface StylizeDialect {
  /** Aspect frames this dialect can ask for (drives planNormalize). */
  aspects: readonly AspectOption[];
  /** Long-edge ceiling for the input image sent to the provider. */
  maxEdge: number;
  /** How many input images one call may carry (1 = source only; extra roles are dropped
   *  style-first by the engine). */
  maxImages: number;
  /** The roles this dialect carries, in the order its wire places them: `generate` sends images in
   *  this order, drops any role it omits, and the prompt labels each image by its position here. */
  imageOrder: readonly ImageRole[];
  /** Whether this dialect can act as the judge (vision critique) in a refine recipe. */
  canJudge: boolean;
  /** `null` means the endpoint would not enumerate (a fetch failure or a non-2xx reply other than
   *  401/403); an empty array is a successful call that found nothing to list. A 401 or 403 throws
   *  the classified `StylizeError`, so a key the provider turned away fails the connection check. */
  listModels(cfg: DialectConfig, signal?: AbortSignal): Promise<string[] | null>;
  /** `images` arrives role-tagged; the dialect places them in `imageOrder`. */
  generate(cfg: DialectConfig, req: GenerateRequest, signal?: AbortSignal): Promise<string>;
  /** One vision critique of `output` against `source` + the manifest clauses; returns correction
   *  clauses, or [] when faithful. Only where `canJudge`. */
  judge?(cfg: DialectConfig, req: JudgeRequest, signal?: AbortSignal): Promise<string[]>;
}
