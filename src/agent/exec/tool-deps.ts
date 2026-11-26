/**
 * The tool layer's dependencies over the live editor, built per job so a job edits the map that was
 * live when it started, and pictures that map, never what the views show in its place. Every optional member is a tool capability that compiles away silently when
 * dropped, so `tool-deps.test.ts` pins the set. Plan storage stays unwired: the loop keeps the plan
 * as log events.
 */
import { localizedName } from '../../i18n/context';
import { getCatalogItem } from '../../state/catalog';
import { singleSelection } from '../../state/selection';
import { useEditorStore } from '../../state/store';
import { shownMap } from '../../state/map-stand-in';
import { regionOf } from '../../state/editing/region';
import { host } from '../../editor/host/host';
import { listCommands, runCommand } from '../../editor/commands/run';
import { editAnnotationsOn } from '../../editor/editing/annotation-edit';
import { useAgentConnection } from '../connection/store';
import { callApproved } from '../core/gates';
import { jobUndoFloor } from '../core/job-reads';
import type { AgentToolDeps } from '../tools/deps';
import type { SessionPort } from './session-port';
import { takeGroundSnapshot, takeMapRegionSnapshot, takeMapSnapshot } from './snapshot';

export function makeToolDeps(opts: { vision: boolean; session: SessionPort }): AgentToolDeps {
  const { session } = opts;
  const live = useEditorStore.getState();
  const { gridState, commandExecutor } = live;
  // A job's scope is the region the user painted for the assistant when it starts.
  const region = regionOf(live, 'agent');
  // The author of every edit this job makes, read once at launch, so the pair is the connection the
  // requests go out on even if the user changes the model mid-run.
  const { provider, model } = useAgentConnection.getState();
  const authorModel = model[provider] ?? '';
  if (!gridState || !commandExecutor) {
    // The shell only ever stands over a live map; a half-built dependency set would fail mid-job.
    throw new Error('the assistant has no map to work on');
  }
  const deps: AgentToolDeps = {
    catalogName: (id) => {
      const item = getCatalogItem(id);
      return item ? localizedName(item.name, useEditorStore.getState().locale) : undefined;
    },
    interfaceLanguage: () => useEditorStore.getState().locale,
    getState: () => gridState,
    getExecutor: () => commandExecutor,
    editAnnotations: (edit) => editAnnotationsOn(gridState, edit),
    getRegion: () => region,
    // The tool surface describes one clicked block ("this/it"); it has no vocabulary for a group, so
    // a plural selection reads as none rather than as an arbitrary member.
    getSelectedBlock: () => singleSelection(useEditorStore.getState().selection),
    // The running job's own floor, read live: the checkpoint is appended when its first write runs.
    undoFloor: () => jobUndoFloor(session.log()),
    // Its cells flash only while the job's map is the one shown.
    onFlash: (sets) => { if (shownMap(useEditorStore.getState()) === gridState) host.feedback.flash(sets); },
    onMapLeft: (listener) => {
      const left = (st: { gridState: unknown; commandExecutor: unknown }) => st.gridState !== gridState || st.commandExecutor !== commandExecutor;
      if (left(useEditorStore.getState())) { listener(); return () => {}; }
      const off = useEditorStore.subscribe((st) => { if (left(st)) { off(); listener(); } });
      return off;
    },
    // The approval is a fact about this call, read off the log's own gate pair. `allow-always` still
    // reads as an AI write: it is a standing session permission, not a press about this edit
    // (`core/gates.ts:callApproved`).
    getProvenanceSource: (toolCallId) => ({
      provider,
      model: authorModel,
      ...(toolCallId !== undefined ? { toolCallId } : {}),
      userApproved: toolCallId !== undefined && callApproved(session.log(), toolCallId),
    }),
    listAppActions: () => listCommands(),
    runAppAction: (id, args) => runCommand(id, args),
  };
  // Wired only where the armed model can read an image; without them `view_map` degrades to the
  // token grid rather than sending a picture to a model that will refuse it. The region member is
  // the look-closer half of the same capability.
  if (opts.vision) {
    deps.snapshot = (opts) => takeMapSnapshot(gridState, opts?.notes ?? false);
    deps.snapshotRegion = (rect, opts) => takeMapRegionSnapshot(gridState, rect, opts?.notes ?? false);
    deps.snapshotGround = (rect) => takeGroundSnapshot(gridState, rect);
  }
  return deps;
}
