/**
 * Import-side counterpart to `export-json.ts`'s optional sections.
 *
 * `applyOptionalSections` is a NON-FATAL restorer: `generation`/`session`/`history` are each
 * independently wrapped in try/catch — a malformed or missing section is dropped (reported to
 * the caller for a toast) but never fails the map import itself (the core cells/objects load
 * already succeeded by the time this runs). `notes` needs no work here — the plain
 * `deserialize()` path already restored it onto GridState.
 */

import type { HistoryEntry } from '../core/commands/command-apply';
import { decodeHistory } from './history-codec';
import type { GenerateConfig, GridState } from '../core/model/types';

export interface SectionRestoreDeps {
  executor: { restoreHistory(entries: HistoryEntry[]): void } | null;
  state: GridState;
  setLayerLocked: (layer: number, locked: boolean) => void;
  setCamera: (c: { x: number; y: number; zoom: number }) => void; // wraps host.camera.set2d
}

export interface SectionRestoreResult { restored: string[]; dropped: string[] }

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Best-effort restore of the optional top-level sections a "keep everything" export may
 *  carry. Each section is independent: a throw or shape mismatch drops just that section. */
export function applyOptionalSections(raw: unknown, deps: SectionRestoreDeps): SectionRestoreResult {
  const restored: string[] = [];
  const dropped: string[] = [];
  if (!raw || typeof raw !== 'object') return { restored, dropped };
  const obj = raw as Record<string, unknown>;

  if ('generation' in obj) {
    try {
      const g = obj.generation as Partial<GenerateConfig> | null | undefined;
      if (g && typeof g === 'object' && isFiniteNumber(g.seed) && typeof g.algorithm === 'string') {
        deps.state.generation = g as GenerateConfig;
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
            if (typeof layer === 'number' && layer >= 1 && layer <= 8) deps.setLayerLocked(layer, true);
          }
        }
        const cam = s.camera as { x?: unknown; y?: unknown; zoom?: unknown } | undefined;
        if (cam && typeof cam === 'object' && isFiniteNumber(cam.x) && isFiniteNumber(cam.y) && isFiniteNumber(cam.zoom)) {
          deps.setCamera({ x: cam.x, y: cam.y, zoom: cam.zoom });
        }
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
      const { width, height } = deps.state.template;
      const entries = decodeHistory(obj.history, { width, height });
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
