/*
 * The one builder of a `ToolHost`: the tool manager, the Help figures' pictured editor and the test
 * contexts all wrap a grid and its executor through here, so a tool sees the same doors in each.
 * The store-bound channels (locale, toasts, held keys, the annotation slice) arrive as arguments;
 * without them the host is headless: messages go nowhere, no modifier is held, nothing draws.
 */
import type { GridState } from '../../../core/model/types';
import type { CommandExecutor } from '../../../core/commands/command-executor';
import type { Translate } from '../../../i18n/keys';
import type { EditorView, ToolOverlay, ViewProjection } from './view-seam';
import type { NoticeTone, Tool, ToolContext, ToolHost, ToolModifiers } from './types';
import type { GridId } from '../../../core/grid/grids';
import type { MacroChannel, MacroOffThread } from '../../macros/context';
import { CurveSessions, type CurveChannel } from '../paint/curve-session';
import type { AnnotationChannels, AnnotationEditVerbs } from '../annotate/channel';

/** The feature channels a host carries beside the base contract, each declared by the feature that
 *  reads it; a tool names the ones it reads in its context type. */
export type ToolChannels = MacroChannel & AnnotationChannels & CurveChannel;

/** The context the tool manager hands every tool: the base context and every channel. */
export type HostedToolContext = ToolContext & ToolChannels;

/** A tool as the tool manager holds it: any grid, the hosted context. */
export type HostedTool = Tool<GridId, HostedToolContext>;

export interface ToolHostDeps {
  state: GridState;
  executor: CommandExecutor;
  /** The view on screen, asked at every access. Absent or null draws nowhere. */
  view?: () => EditorView | null;
  t?: Translate;
  notify?: (text: string, tone: NoticeTone) => void;
  modifiers?: ToolModifiers;
  setDisplayLayer?: (layer: number | null) => void;
  reportGroundClipped?: () => void;
  annotationEdit?: AnnotationEditVerbs;
  tagLabel?: AnnotationChannels['tagLabel'];
  /** Off-thread macro runners for the host's macro context; absent, macros run in-process. */
  offThread?: MacroOffThread;
  /** The editor's curve adjust phase; absent, the host keeps its own. */
  curve?: CurveSessions;
}

const noop = (): void => {};

/** The overlay of a host with no view: every request is dropped. */
export const HEADLESS_OVERLAY: ToolOverlay = {
  showGhost: noop, showGhostSpans: noop, clearGhost: noop, showCurveFootprint: noop, clearCurveFootprint: noop,
  showSelection: noop, clearSelection: noop, showHover: noop, clearHover: noop, flashCommit: noop,
  showBuildableRegion: noop, clearBuildableRegion: noop, pulseBuildableRegion: noop, showPath: noop, clearPath: noop,
  showBand: noop, clearBand: noop, showPlacementGhost: noop, showObjectMove: noop, showGroupPlacementGhost: noop,
};

const NO_MODIFIERS: ToolModifiers = { constrain: false, multiSelect: false };

const HEADLESS_ANNOTATION_EDIT: AnnotationEditVerbs = {
  begin: noop, apply: noop, add: noop, remove: noop, select: noop, setDraft: noop, commitDraft: () => false,
};

export function createToolHost(deps: ToolHostDeps): ToolHost & ToolChannels {
  const { state, executor } = deps;
  const registry = executor.getRegistry();
  return {
    state: state,
    get viewport(): ViewProjection | null {
      return deps.view?.()?.projection ?? null;
    },
    get overlay(): ToolOverlay {
      return deps.view?.()?.overlay ?? HEADLESS_OVERLAY;
    },
    execute: (cmd) => executor.execute(cmd),
    beginStroke: () => executor.beginStroke(),
    validateCommand: (cmd) => executor.validatePre(cmd),
    registry,
    historyDepth: () => executor.historyDepth(),
    t: deps.t ?? ((key) => key),
    notify: deps.notify ?? noop,
    modifiers: deps.modifiers ?? NO_MODIFIERS,
    setDisplayLayer: deps.setDisplayLayer ?? noop,
    plopObject: (id) => deps.view?.()?.plopObject(id),
    reportGroundClipped: deps.reportGroundClipped,
    macroContext: { state, executor, registry, offThread: deps.offThread },
    annotationEdit: deps.annotationEdit ?? HEADLESS_ANNOTATION_EDIT,
    tagLabel: deps.tagLabel ?? ((tag) => tag),
    curve: deps.curve ?? new CurveSessions(),
  };
}
