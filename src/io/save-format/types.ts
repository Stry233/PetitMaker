/**
 * Save-format versioning contracts.
 *
 * The on-disk save evolves over time; `CURRENT_VERSION` names the shape this build
 * writes. Older files are lifted to the current shape by the migration chain (see
 * ./migrate + ./migrations) *before* the decoder ever sees them, so the decoder in
 * json-codec only ever knows the current grammar.
 */
import type { SerializedProvenance } from '../../core/provenance/serialize';
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

/**
 * A view's camera pose at save time, kept PER VIEW because a 2D pan/zoom and a 3D orbit
 * are different shapes — restoring one into the other would be worse than restoring
 * neither. Mirrors (without importing, to keep io/ view-layer-free) the 2D
 * `host.camera.get2d` shape and the 3D `CameraAngle` (canvas/map3d/capture.ts); both sides
 * convert structurally.
 */
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
  /** Optional export-json sections (additive, no version bump — old builds ignore unknown
   *  keys, so old files load in new builds and new-section files load in old builds). Loose
   *  `unknown` on purpose: json-codec must not gain a dependency on generation/history/etc
   *  types — only io/export-json (write) and io/import-sections (read, future task) parse them. */
  notes?: MapNotes;
  generation?: unknown;
  session?: unknown;
  history?: unknown;
  stats?: unknown;
  catalogInfo?: unknown;
  manifest?: unknown;
  /** The autosave's camera round-trip (io/autosave + io/json-codec's readSaveCamera). Additive
   *  and optional like the sections above, so a pre-existing save simply lacks it: no migration,
   *  and an old build loading a new save ignores the key it doesn't know. */
  camera?: PersistedCamera;
}

/**
 * An untrusted plain-JSON save of *some* version. Deliberately loose: migrations
 * operate on this structural shape and MUST NOT import domain types, so a migration
 * written today keeps running unchanged after the in-memory model evolves.
 */
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
