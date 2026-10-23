/**
 * A map leaving the editor and coming back the way a person moves it: the JSON export the export
 * window writes, the file Import reads by content, the share code a Share Image carries, and the
 * message Import shows for a file it refuses. Maps compare as a person sees them (cells and objects
 * where they stand, whatever their runtime ids).
 */
import { serializeWithSections, carrying, type ExportJsonOptions, type SectionKey } from '../../../io/save/sections';
import { inspectImportFile, type ImportFileDeps, type ImportInspection } from '../../../io/import/file';
import { canonicalize } from '../../../io/save/canonical';
import { CURRENT_VERSION } from '../../../io/save/format';
import { buildShareCode, importFromRaster, type ImportResult } from '../../../io/share';
import { reportImport } from '../../../editor/editing/import-report';
import { setToastPresenter } from '../../../platform/channels/toast-bus';
import { createExecutor } from '../../../state/executor';
import { createDefaultRegistry } from '../../../rules';
import type { CommandExecutor } from '../../../core/commands/command-executor';
import type { PersistedCamera } from '../../../io/save/format';
import type { GridState } from '../../../core/model/types';
import { exportable } from '../../_support/exportable';
import { TerrainType, rect, world, type SpecWorld } from '../_world';

/** The map as a person sees it: every cell and every object where it stands, runtime ids aside. */
export const seen = (state: GridState): string => JSON.stringify(canonicalize(state));

/** A built-in planet with a person's work on it: a mountain block, two trees on open ground and a
 *  numbered zone note. */
export function builtMap(templateId?: string): SpecWorld {
  const w = world(templateId);
  const at = w.openGround(10, 6);
  if (!w.stroke(rect(at, 4, 4), TerrainType.Mountain, 1).ok) throw new Error('the mountain stroke was refused');
  for (const dx of [6, 8]) if (!w.place('tree-apple', at.x + dx, at.y + 2).ok) throw new Error('the tree was refused');
  w.sandbox.addNote({ kind: 'zone', id: 'zone-1', cells: rect({ x: at.x + 6, y: at.y }, 3, 2), color: '#FF8A7A', tag: null, num: 1, size: 'm' });
  return w;
}

/** The JSON file the export window writes for `state` with the sections in `carry` switched on. */
export function exportJson(
  state: GridState, carry: readonly SectionKey[] = ['annotations'], extra: Omit<Partial<ExportJsonOptions>, 'carry'> = {},
): string {
  return serializeWithSections(exportable(state), { carry: carrying(...carry), pretty: false, ...extra });
}

/** Import reading `text` as a dropped file named `name`, before anything is installed. */
export function inspect(text: string, name = 'map.json'): Promise<ImportInspection> {
  return inspectImportFile(new Blob([text], { type: 'application/json' }), name);
}

/** What the import confirmation would install: the decoded map of a file Import accepts. */
export async function preview(text: string, name = 'map.json') {
  const inspection = await inspect(text, name);
  if (inspection.status !== 'ready') throw new Error(`import refused the file: ${JSON.stringify(inspection)}`);
  return inspection;
}

/** The editor a confirmed import installs into: the map, a fresh executor over it, the layers it
 *  locks and the camera it parks. */
export interface Installed {
  state: GridState | null;
  executor: CommandExecutor | null;
  locked: number[];
  camera: PersistedCamera | null;
}

/** The import wiring the live editor gives `commit`, recording what was installed. */
export function installInto(): { deps: ImportFileDeps; installed: Installed } {
  const installed: Installed = { state: null, executor: null, locked: [], camera: null };
  const deps: ImportFileDeps = {
    loadMap: (state) => { installed.state = state; installed.executor = createExecutor(state, createDefaultRegistry()); },
    getSectionDeps: () => ({
      executor: installed.executor,
      state: installed.state!,
      setLayerLocked: (layer, locked) => { if (locked) installed.locked.push(layer); },
      setCamera: (camera) => { installed.camera = camera; },
    }),
  };
  return { deps, installed };
}

/** The toasts the import surface shows for `outcome`, in order. */
export function importToasts(outcome: Parameters<typeof reportImport>[0]): { text: string; tone: string }[] {
  const shown: { text: string; tone: string }[] = [];
  const stop = setToastPresenter((text, tone) => { shown.push({ text, tone }); });
  try { reportImport(outcome); } finally { stop(); }
  return shown;
}

/** The share code a Share Image of `state` carries at the Standard width, as raw pixels. */
export async function shareCode(state: GridState) {
  const code = await buildShareCode(exportable(state), null, { appVersion: 'spec', saveVersion: CURRENT_VERSION }, 1600);
  if (!code) throw new Error('no share code at this width');
  return code;
}

/** Import reading a share code's pixels. */
export function importCode(code: { rgba: Uint8Array; width: number; height: number }): Promise<ImportResult> {
  return importFromRaster(new Uint8Array(code.rgba), code.width, code.height);
}
