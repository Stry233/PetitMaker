import type { Ref } from 'react';
import type { JobView, LiveConnection, SetupEntry } from '../../../agent/panel';
import { cueCharacter } from '../character/intent';
import { DreamOffice } from '../desk/DreamOffice';
import { ManageScreen } from '../connection/ManageScreen';
import type { ZoneEvent } from '../derive/zone';
import { SetupScreen, type SetupHandle } from '../connection/SetupScreen';
import type { SetupFace } from '../connection/setup-parts';
import { OpenedRecord } from './TerminalCard';

/** Which screen replaces the session record in the job zone, if one does. */
export type ZoneScreenKind =
  | { kind: 'setup'; entry: SetupEntry; focusKey: boolean }
  | { kind: 'welcome' }
  | { kind: 'manage' }
  | { kind: 'record'; job: JobView };

/** The setup, keyless rest, management or opened-record screen standing in the job zone. */
export function ZoneScreen({
  screen, setupRef, pictured, pinned, jobCount, running, phase, liveConnection, recordStamp, rolledBack,
  dispatch, onSetupFace, onClearJobs, onStop, onPause, onCloseRecord, onClearRecord,
}: {
  screen: ZoneScreenKind;
  setupRef: Ref<SetupHandle>;
  /** A Help figure, which never drives the live character. */
  pictured: boolean;
  pinned: boolean;
  /** The records a clear would still remove. */
  jobCount: number;
  running: boolean;
  phase: string;
  liveConnection?: LiveConnection;
  recordStamp?(job: JobView): string;
  rolledBack: ReadonlySet<number>;
  dispatch(event: ZoneEvent): void;
  onSetupFace(face: SetupFace | null): void;
  onClearJobs?(): void;
  onStop(): void;
  onPause(): void;
  onCloseRecord(): void;
  onClearRecord?(orderSeq: number): void;
}) {
  switch (screen.kind) {
    case 'setup':
      return (
        <SetupScreen
          ref={setupRef}
          key={screen.entry}
          entry={screen.entry}
          focusKey={screen.focusKey}
          onDone={() => dispatch({ type: 'setup-done' })}
          onFace={onSetupFace}
          onManage={() => dispatch({ type: 'setup-to-manage' })}
          onLeave={() => dispatch({ type: 'setup-done' })}
        />
      );
    case 'welcome':
      return (
        <DreamOffice
          onConnect={() => {
            if (!pictured) { cueCharacter({ kind: 'acknowledge' }); cueCharacter({ kind: 'wake' }); }
            dispatch({ type: 'setup', entry: 'key' });
          }}
          pinned={pinned}
        />
      );
    case 'manage':
      return (
        <ManageScreen
          jobCount={jobCount}
          stoppable={running || phase === 'retrying' || phase === 'gated'}
          parkable={phase === 'retrying'}
          onDone={() => dispatch({ type: 'manage-done' })}
          onNeedKey={() => dispatch({ type: 'setup', entry: 'key' })}
          {...(onClearJobs ? { onClearJobs } : {})}
          onStopJob={onStop}
          onSetAside={onPause}
          {...(liveConnection ? { liveConnection } : {})}
        />
      );
    case 'record':
      return (
        <OpenedRecord
          job={screen.job}
          rolledBack={rolledBack.has(screen.job.orderSeq)}
          {...(recordStamp ? { stamp: recordStamp(screen.job) } : {})}
          onBack={onCloseRecord}
          {...(onClearRecord ? { onClear: onClearRecord } : {})}
        />
      );
  }
}
