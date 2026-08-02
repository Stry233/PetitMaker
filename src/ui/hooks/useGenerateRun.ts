/*
 * useGenerateRun.ts — the Generate-panel run pipeline.
 *
 * Owns the in-flight generation state (the `generating` flag + the `genSignalRef`
 * cancel flag) and the effect that cancels a run when the user leaves the Generate
 * panel mid-flight. Exposes two callbacks the panel wires verbatim:
 *   - onGenerate(config): clear objects/terrain (region-scoped if a region is set),
 *     runSilentlyAsync generate + populate, support cancel, commit the stroke group,
 *     flash the affected area, toast the placed count.
 *   - onClear(): take back the last generation (its scope, its authorship) in one undo step,
 *     resync, toast.
 *
 * The genRegion / selectingRegion state is shared (region brush + panels + nav),
 * so App owns it and threads it in.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { petitWindow } from '../../core/runtime/window-bridge';
import { translate } from '../../i18n/context';
import { useEditorStore } from '../../state/store';
import { showToast } from '../chrome/Toast';
import { generateTerrain, clearAllTerrain, clearAllObjects } from '../../tools/generation/terrain-generator';
import { toGenConfig } from '../../tools/generation';
import { populate, yieldFrame, type GenSignal } from '../../tools/generation/placement';
import type { MacroCoord, GenerateConfig } from '../../core/model/types';
import { ProvSource } from '../../core/provenance/types';
import { hashJSON } from '../../core/model/hash';

export interface GenerateRunParams {
  menuView: 'home' | 'build' | 'placement' | 'generate';
  genRegion: MacroCoord[];
  setGenRegion: (cells: MacroCoord[]) => void;
  setSelectingRegion: (v: boolean) => void;
}

export interface GenerateRun {
  generating: boolean;
  onGenerate: (config: GenerateConfig) => void;
  onClear: () => void;
}

export function useGenerateRun({ menuView, genRegion, setGenRegion, setSelectingRegion }: GenerateRunParams): GenerateRun {
  const [generating, setGenerating] = useState(false);
  const genSignalRef = useRef<GenSignal | null>(null); // the in-flight generation's cancel flag (null = idle)
  const lastGenRegion = useRef<MacroCoord[] | null>(null); // the last run's scope; null = the whole map

  // Leaving the Generate panel mid-run cancels the in-flight generation (it bails at its next yield).
  useEffect(() => {
    if (menuView !== 'generate' && genSignalRef.current) genSignalRef.current.cancelled = true;
  }, [menuView]);

  const onGenerate = useCallback((config: GenerateConfig) => {
    if (genSignalRef.current) return; // a generation is already running
    setGenerating(true);
    const signal: GenSignal = { cancelled: false };
    genSignalRef.current = signal;
    const win = petitWindow();
    void (async () => {
      const exec = useEditorStore.getState().commandExecutor;
      const gs = useEditorStore.getState().gridState;
      const strokeStart = exec?.getUndoStackSize() ?? 0;
      try {
        if (!gs || !exec) return;
        const withRegion = { ...config, region: genRegion.length > 0 ? genRegion : null };
        const seed = typeof withRegion.seed === 'number' ? withRegion.seed : 0;
        const configHash = hashJSON(withRegion);
        exec.pushSource({ source: ProvSource.Procedural, tool: 'generate', procedural: { seed, algorithm: withRegion.algorithm, configHash } });
        try {
          await yieldFrame(); // let the loading spinner paint before the first (synchronous) chunk
          // Clear objects first (object-blocks-terrain would reject erasing/generating under them),
          // then terrain — region-scoped if a region is set. Grouped into one undo via the stroke.
          clearAllObjects(gs, (cmd) => exec.execute(cmd), withRegion.region ?? undefined);
          clearAllTerrain(gs, (cmd) => exec.execute(cmd), withRegion.region ?? undefined);
          win.__petitClearPreview?.();
          // Generation reject-and-skips many commands by design — silence the validation-failed
          // toasts. populate() yields between stages so the UI stays responsive + can cancel.
          const result = await exec.runSilentlyAsync(async () => {
            const r = generateTerrain(withRegion, gs, (cmd) => exec.execute(cmd));
            if (!signal.cancelled && withRegion.algorithm === 'random') {
              await populate(toGenConfig(withRegion), gs, (cmd) => exec.execute(cmd), exec.getRegistry(), signal, r.zonePlan);
            }
            return r;
          });
          if (signal.cancelled) {
            // Discard the partial work: collapse the stroke, then undo it back to pre-generation.
            exec.commitStrokeGroup(strokeStart);
            if (exec.getUndoStackSize() > strokeStart) exec.undo();
            win.__petitResyncObjects?.();
            return;
          }
          exec.commitStrokeGroup(strokeStart);
          win.__petitResyncObjects?.();
          lastGenRegion.current = withRegion.region;
          // Record the replay config for the share exporter: a FULL generation (region null) is
          // exactly reproducible from (seed, config), so the Recovery Poster can carry a tiny
          // procedural-v1 record instead of the whole map. Region-restricted gen depends on prior
          // state → not replayable from blank, so clear it.
          gs.generation = withRegion.region ? undefined : withRegion;
          // Acknowledge with one area-flash: the selected region, or the whole map.
          let cells: { x: number; y: number }[] = withRegion.region ?? [];
          if (cells.length === 0) for (let y = 0; y < gs.template.height; y++) for (let x = 0; x < gs.template.width; x++) cells.push({ x, y });
          win.__petitFlashCommit?.(cells, { terrainMode: true });
          showToast(translate('toast.generated', { n: result.placed }), 'info');
        } finally {
          exec.popSource();
        }
      } finally {
        genSignalRef.current = null;
        setGenerating(false);
        setGenRegion([]);
        setSelectingRegion(false);
      }
    })();
  }, [genRegion, setGenRegion, setSelectingRegion]);

  const onClear = useCallback(() => {
    const gs = useEditorStore.getState().gridState;
    const exec = useEditorStore.getState().commandExecutor;
    if (!gs || !exec) return;
    const strokeStart = exec.getUndoStackSize();
    // Clear TAKES BACK A GENERATION; it is not an erase-everything. Two limits, both from what the
    // last run actually did: its region (a run's `finally` drops the painted one, so the scope is
    // remembered here — without it, clearing right after generating into a region wiped the rest
    // of the map), and the map's own authorship. A cell or object the person made inside that
    // region stays: only what a generator wrote there goes. A map loaded without provenance has no
    // authorship to read, so nothing is spared and Clear scrubs its scope, as it always did.
    const region = genRegion.length > 0 ? genRegion : lastGenRegion.current ?? undefined;
    const prov = exec.getProvenanceTracker();
    const objs = clearAllObjects(gs, (cmd) => exec.execute(cmd), region, (o) => prov.objectAuthor(o.id) === 'human');
    // Objects first: object-blocks-terrain would otherwise reject
    // erasing terrain under tiles/placements.
    const cells = clearAllTerrain(gs, (cmd) => exec.execute(cmd), region, (x, y) => prov.cellAuthor(x, y) === 'human');
    gs.generation = undefined; // a cleared map is no longer a replayable generation
    // One undo step: collapseHistory covers object add/removes as well as cells.
    exec.commitStrokeGroup(strokeStart);
    const win = petitWindow();
    win.__petitClearPreview?.();
    win.__petitResyncObjects?.(); // authoritative reconcile so cleared objects can't linger on screen
    showToast(translate('toast.cleared_all', { cells, objs }), 'info');
  }, [genRegion]);

  return { generating, onGenerate, onClear };
}
