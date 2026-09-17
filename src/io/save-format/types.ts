/** Versioned save contracts. Pure migrations run before decoding. */
import type { SerializedProvenance } from '../../core/provenance/serialize';
import type { ImageAttribution } from '../../core/provenance/image-attribution';
import type { MapNotes } from '../../core/model/types';

export type { MapNotes };

/** The on-disk save-format version this build writes. Bump on every breaking
 *  change and add a matching migration in ./migrations. */
export const CURRENT_VERSION = 1;

/** A persisted object record (current wire shape). Mirrors the encoder in json-codec. */
export interface SaveObject {
  id: string;
  catalogId: string;
  x: number;
  y: number;
  rotation: number;
  elevation?: number;
  spanLength?: number;
  corners?: string;
  patchOnly?: boolean;
}

/** Camera poses are stored separately because the 2D and 3D views use different coordinates. */
export interface PersistedCamera {
  view2d?: { x: number; y: number; zoom: number };
  view3d?: { az: number; el: number; dist: number; tx?: number; tz?: number };
}

/** The current on-disk save envelope. */
export interface SaveFile {
  version: number; // always CURRENT_VERSION when freshly written
  templateId: string;
  cells: string;
  objects: SaveObject[];
  metadata: { savedAt: string };
  provenance?: SerializedProvenance;
  /** Additive sections need no version bump. Their owning codecs validate unknown input. */
  notes?: MapNotes;
  imageAttribution?: ImageAttribution;
  /** Optional annotation data, validated and bounded by json-codec. */
  annotations?: unknown;
  generation?: unknown;
  session?: unknown;
  history?: unknown;
  stats?: unknown;
  catalogInfo?: unknown;
  manifest?: unknown;
  /** Optional per-view camera state for autosave. */
  camera?: PersistedCamera;
}

/** Untrusted JSON envelope. Migrations depend on this wire shape rather than mutable domain types. */
export type RawSave = Record<string, unknown> & { version?: number };

/** Lifts a save from version `from` to `from + 1`. Pure JSON → JSON: treat the input as
 *  read-only and return a fresh (or shallow-copied) object — the engine copies the result
 *  before stamping the version, but it cannot protect nested data a migration mutates. */
export interface Migration {
  /** The version this migration consumes. */
  readonly from: number;
  /** What changed and why — surfaced in code review and the migration list. */
  readonly description: string;
  migrate(raw: RawSave): RawSave;
}
