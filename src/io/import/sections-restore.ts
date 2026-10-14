/**
 * Installs the optional sections `save/sections.ts` writes, after the map itself has loaded.
 * `generation`, `session` and `history` are restored independently: a malformed one is dropped and
 * reported to the caller, never failing the import. Notes need nothing here, since
 * `save/json-codec.ts:decodeSave` already put them on the map.
 */

import type { HistoryEntry } from '../../core/commands/command-apply';
import { decodeHistory } from '../save/history-codec';
import type { GridState } from '../../core/model/types';
import { isGenerationConfig } from '../save/generation-record';
import { ELEVATION_MAX } from '../../core/game/profile';
import { persistedCamera, readParsedSaveCamera, readView2d } from '../save/camera';
import type { PersistedCamera } from '../save/format';

export interface SectionRestoreDeps {
  executor: { restoreHistory(entries: HistoryEntry[]): void } | null;
  state: GridState;
  setLayerLocked: (layer: number, locked: boolean) => void;
  /** Poses the views for the installed map. */
  setCamera: (c: PersistedCamera) => void;
}

export interface SectionRestoreResult { restored: string[]; dropped: string[] }

/** Best-effort restore of the optional top-level sections a "keep everything" export may
 *  carry. Each section is independent: a throw or shape mismatch drops just that section. */
export function applyOptionalSections(raw: unknown, deps: SectionRestoreDeps): SectionRestoreResult {
  const restored: string[] = [];
  const dropped: string[] = [];
  if (!raw || typeof raw !== 'object') return { restored, dropped };
  const obj = raw as Record<string, unknown>;

  if ('generation' in obj) {
    try {
      const g = obj.generation;
      if (isGenerationConfig(g)) {
        deps.state.generation = g;
        restored.push('generation');
      } else {
        dropped.push('generation');
      }
    } catch {
      dropped.push('generation');
    }
  }

  if ('session' in obj) {
    try {
      const s = obj.session as { v?: unknown; lockedLayers?: unknown; camera?: unknown } | null | undefined;
      if (s && typeof s === 'object' && s.v === 1) {
        if (Array.isArray(s.lockedLayers)) {
          for (const layer of s.lockedLayers) {
            if (Number.isInteger(layer) && layer >= 1 && layer <= ELEVATION_MAX) deps.setLayerLocked(layer, true);
          }
        }
        // The camera travels as `camera`, as autosave writes it; files before that kept a 2D pose here.
        // The view holds the zoom inside its own range, so a save loads the same whatever that range is.
        const camera = readParsedSaveCamera(obj) ?? persistedCamera(readView2d(s.camera));
        if (camera) deps.setCamera(camera);
        restored.push('session');
      } else {
        dropped.push('session');
      }
    } catch {
      dropped.push('session');
    }
  }

  if ('history' in obj) {
    try {
      const entries = decodeHistory(obj.history, deps.state.template, deps.state.objects);
      if (entries && deps.executor) {
        deps.executor.restoreHistory(entries);
        restored.push('history');
      } else {
        dropped.push('history');
      }
    } catch {
      dropped.push('history');
    }
  }

  return { restored, dropped };
}
