/**
 * The tool layer's dependencies over the live editor, built per job so a job edits the map that was
 * live when it started. Every optional member is a tool capability that compiles away silently when
 * dropped, so `tool-deps.test.ts` pins the set. Plan storage stays unwired: the loop keeps the plan
 * as log events.
 */
import { localizedName } from '../../i18n/context';
import { getCatalogItem } from '../../state/catalog';
import { singleSelection } from '../../state/selection';
import { useEditorStore } from '../../state/store';
import { host } from '../../editor/host/host';
import { editAnnotationsOn } from '../../editor/editing/annotation-edit';
import { useAgentConnection } from '../connection/store';
import { callApproved } from '../core/gates';
import { jobUndoFloor } from '../core/job-reads';
import type { AgentToolDeps } from '../tools/deps';
import type { SessionPort } from './session-port';
import { takeMapRegionSnapshot, takeMapSnapshot } from './snapshot';

export function makeToolDeps(opts: { vision: boolean; session: SessionPort }): AgentToolDeps {
  const { session } = opts;
  const { gridState, commandExecutor, region } = useEditorStore.getState();
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
    getState: () => gridState,
    getExecutor: () => commandExecutor,
    editAnnotations: (edit) => editAnnotationsOn(gridState, edit),
    // A job's scope is whatever the user has painted when it starts.
    getRegion: () => region,
    // The tool surface describes one clicked block ("this/it"); it has no vocabulary for a group, so
    // a plural selection reads as none rather than as an arbitrary member.
    getSelectedBlock: () => singleSelection(useEditorStore.getState().selection),
    // The running job's own floor, read live: the checkpoint is appended when its first write runs.
    undoFloor: () => jobUndoFloor(session.log()),
    onFlash: (sets) => host.feedback.flash(sets),
    // The approval is a fact about this call, read off the log's own gate pair. `allow-always` still
    // reads as an AI write: it is a standing session permission, not a press about this edit
    // (`core/gates.ts:callApproved`).
    getProvenanceSource: (toolCallId) => ({
      provider,
      model: authorModel,
      ...(toolCallId !== undefined ? { toolCallId } : {}),
      userApproved: toolCallId !== undefined && callApproved(session.log(), toolCallId),
    }),
    requestExport: (kind) => {
      useEditorStore.getState().openShare(kind === 'json' ? 'keep' : 'friend');
    },
  };
  // Wired only where the armed model can read an image; without them `view_map` degrades to the
  // token grid rather than sending a picture to a model that will refuse it. The region member is
  // the look-closer half of the same capability.
  if (opts.vision) {
    deps.snapshot = takeMapSnapshot;
    deps.snapshotRegion = takeMapRegionSnapshot;
  }
  return deps;
}
