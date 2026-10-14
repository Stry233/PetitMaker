import { useRef, type ReactNode, type RefObject } from 'react';
import type { JobView, PanelView } from '../../../agent/panel';
import { useT } from '../../../i18n/context';
import type { RegionBounds } from '../../../core/grid/rect';
import { Pill } from '../../primitives/Pill';
import { Banner } from '../desk/Banner';
import { HistoryStrip } from './HistoryStrip';
import { JobTicket, pausedWhere } from './JobTicket';
import type { LaneView } from './Lane';
import { PHASE } from '../derive/phase';
import type { RepairAct } from '../derive/repair';
import type { SessionLayout } from '../derive/session-layout';
import { HoldActions } from '../parts/HoldActions';
import { TICKET_VIGNETTE } from '../composer/region-chip';
import { ResumeCard } from './ResumeCard';
import { TerminalCard, type TerminalVerbs } from './TerminalCard';

/** The record a session stands in the job zone, top to bottom, with every card's own verbs. */
export function SessionRecord({
  view, layout, asks, hasAsk, pinned, sketchbook, modelName, lane, regionShot, undoDepth, rolledBack, busy,
  otherMap, unknownMap, historyOpen, onHistoryOpen, storage, recordShot, recordStamp, verbs, hold,
  onRepair, onOpenRecord, onRollBack, onAskStop,
}: {
  view: PanelView;
  layout: SessionLayout;
  /** The ask cards, already built. */
  asks: ReactNode;
  hasAsk: boolean;
  pinned: boolean;
  sketchbook?: ReactNode;
  modelName?: string;
  lane?: LaneView;
  regionShot?(bounds: RegionBounds, width: number, height: number): ReactNode;
  undoDepth?: number;
  rolledBack: ReadonlySet<number>;
  busy: boolean;
  otherMap?: ReadonlySet<number>;
  unknownMap?: ReadonlySet<number>;
  historyOpen: boolean;
  onHistoryOpen(open: boolean): void;
  /** The storage notice and its own answers. */
  storage: { standing: boolean; onAction(act: RepairAct): void };
  recordShot?(job: JobView): ReactNode;
  recordStamp?(job: JobView): string;
  verbs: TerminalVerbs;
  /** The hold's verbs and the held offer's. */
  hold: { onResume?(): void; onStop(): void; onSetAside?(orderSeq: number): void; note?: string };
  onRepair(act: RepairAct): void;
  onOpenRecord(job: JobView): void;
  onRollBack?(job: JobView): void;
  onAskStop(from: RefObject<HTMLElement | null>): void;
}) {
  const t = useT();
  const cancelTaskRef = useRef<HTMLButtonElement>(null);
  const { keyCleared, offered, settled, incident, standingTrouble } = layout;
  // The hold's verbs follow the ask that produced the hold.
  const holdAfterAsk = PHASE[view.phase].onHold && hasAsk && offered === undefined;
  const current = view.current;
  return (
    <>
      {/* Discard clears corrupt bytes; export keeps both the bytes and their notice. */}
      {layout.storageCls && <Banner cls={layout.storageCls} standing={storage.standing} onAction={storage.onAction} />}
      {layout.noticeCls && <Banner cls={layout.noticeCls} onAction={() => { /* Map-identity notices stay with their records. */ }} />}
      {/* A key-cleared notice precedes the blocked resume card it explains. */}
      {keyCleared && (
        <Banner cls={PHASE[view.phase].atRest ? 'key-cleared' : 'key-clearing'} standing={standingTrouble} onAction={onRepair} />
      )}
      {offered && (
        <ResumeCard
          order={offered.orderText}
          pausemark={pausedWhere(offered, t)}
          {...(hold.note ? { note: hold.note } : {})}
          {...(keyCleared ? { blocked: t('agent.ticket_key_returns'), onFixKey: () => onRepair('fix-key') } : hold.onResume ? { onResume: hold.onResume } : {})}
          {...(hold.onSetAside ? { onSetAside: () => hold.onSetAside!(offered.orderSeq) } : {})}
        />
      )}
      <HistoryStrip
        jobs={layout.past}
        rolledBack={rolledBack}
        open={historyOpen}
        onOpenChange={onHistoryOpen}
        {...(otherMap ? { otherMap } : {})}
        {...(unknownMap ? { unknownMap } : {})}
        {...(undoDepth !== undefined ? { undoDepth } : {})}
        busy={busy}
        onOpen={onOpenRecord}
        {...(onRollBack ? { onRollBack } : {})}
      />
      {/* A resume offer replaces the live ticket for the same job. */}
      {current && !offered && (
        <JobTicket
          job={current}
          live
          held={PHASE[view.phase].frozen}
          streaming={current.saysStreaming === true}
          paused={PHASE[view.phase].onHold}
          {...(lane ? { lane } : {})}
          {...(current.region && regionShot
            ? { regionVignette: regionShot(current.region, TICKET_VIGNETTE.width, TICKET_VIGNETTE.height) }
            : {})}
          busy={busy}
          {...(undoDepth !== undefined ? { undoDepth } : {})}
          {...(verbs.onRewind ? { onRewind: verbs.onRewind } : {})}
          {...(hold.onResume && !holdAfterAsk ? { onResume: hold.onResume } : {})}
          {...(holdAfterAsk ? {} : { onStop: hold.onStop })}
        />
      )}
      {settled && (
        <TerminalCard
          view={view}
          settled={settled}
          rewindable={layout.settledBlocked === undefined}
          rolledBack={rolledBack.has(settled.job.orderSeq)}
          {...(undoDepth !== undefined ? { undoDepth } : {})}
          {...(recordShot ? { recordShot } : {})}
          {...(recordStamp ? { recordStamp } : {})}
          verbs={verbs}
        />
      )}
      {asks}
      {view.phase === 'gated' && (
        <div style={{ display: 'flex', gap: 8, flex: '0 0 auto' }}>
          <Pill ref={cancelTaskRef} data-testid="question-cancel-task" onClick={() => onAskStop(cancelTaskRef)}>
            {t('agent.action_cancel_task')}
          </Pill>
        </div>
      )}
      {holdAfterAsk && <HoldActions ids="hold" {...(hold.onResume ? { onResume: hold.onResume } : {})} onStop={hold.onStop} />}
      {incident && !keyCleared && (
        <Banner cls={incident.cls} {...(modelName !== undefined ? { model: modelName } : {})} standing={standingTrouble} onAction={onRepair} />
      )}
      {/* The idle sketch seat stays nearest the composer, a tall docked zone included. */}
      {layout.dressed && (
        <div data-testid="sketch-seat" style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', marginTop: pinned ? 'auto' : 0 }}>
          {sketchbook}
        </div>
      )}
    </>
  );
}
