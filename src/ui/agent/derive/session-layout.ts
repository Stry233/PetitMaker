/* Which surfaces the job zone stands, read off the session, the zone and the panel's own marks. */
import type { JobView, PanelView } from '../../../agent/panel';
import { keyGone } from './desk-face';
import { PHASE } from './phase';
import type { BannerClass } from './repair';
import { terminal, trouble, type TerminalShape } from './terminal';
import type { PanelZone } from './zone';

export interface SessionInputs {
  view: PanelView;
  connected: boolean;
  zone: PanelZone;
  filed: ReadonlySet<number>;
  cleared: ReadonlySet<number>;
  otherMap?: ReadonlySet<number>;
  unknownMap?: ReadonlySet<number>;
  /** The session is an untouched restoration. */
  restored: boolean;
  storageNotice?: 'pruned' | 'lost' | 'corrupt' | null;
  /** The incident the user demoted, by its job's order seq. */
  dismissed: number | null;
  /** An ask card stands in the record. */
  hasAsk: boolean;
  /** An idle sketch card is on offer. */
  sketch: boolean;
  marking: boolean;
}

export interface SessionLayout {
  /** The current job, or the newest settled one when the seat is empty. */
  owedJob?: JobView;
  /** A keyless session keeps its unfiled job and that job's repair in view. */
  keyCleared: boolean;
  /** The keyless rest, with nothing outstanding. */
  showWelcome: boolean;
  /** Setup, the keyless rest or management owns the zone and its foot; the composer stands down. */
  notReady: boolean;
  incident: ReturnType<typeof trouble>;
  /** The incident is demoted to its standing strip. */
  standingTrouble: boolean;
  /** A restored pause offered for resumption, or a key-cleared job offered for repair. */
  offered?: JobView;
  /** An opened past record replacing the zone. */
  opened?: JobView;
  /** The settled record standing as a card, and which card. */
  settled: { job: JobView; shape: TerminalShape } | null;
  /** The history the strip lists. */
  past: readonly JobView[];
  /** Why the standing record may not rewind this map, where it may not. */
  settledBlocked?: 'other-map' | 'unknown-map';
  noticeCls: BannerClass | null;
  storageCls: BannerClass | null;
  /** The idle sketch card stands nearest the composer. */
  dressed: boolean;
  /** Only the past-jobs row stands, so the zone waives its height floor. */
  zoneEmpty: boolean;
}

export function sessionLayout(input: SessionInputs): SessionLayout {
  const { view, connected, zone, filed, cleared, otherMap, unknownMap, storageNotice } = input;
  const owedJob = view.current ?? view.jobs[view.jobs.length - 1];
  const keyCleared = owedJob !== undefined && keyGone(view, connected, owedJob.errorCls) && !filed.has(owedJob.orderSeq);
  const showSetup = zone.kind === 'setup';
  const showWelcome = !connected && !showSetup && !keyCleared;
  const covered = showSetup || showWelcome || zone.kind === 'manage';
  const incident = trouble(view);
  const offered = keyCleared
    ? (PHASE[view.phase].atRest ? owedJob : undefined)
    : input.restored && view.phase === 'paused' ? view.current : undefined;
  const opened = zone.kind !== 'record' || view.current ? undefined : view.jobs.find((job) => job.orderSeq === zone.seq);
  const settled = opened ? null : terminal(view, filed, offered);
  const past = view.jobs.filter((job) => job !== settled?.job && job !== offered && !cleared.has(job.orderSeq));
  const blockedFor = (job: JobView): 'other-map' | 'unknown-map' | undefined => (
    otherMap?.has(job.orderSeq) === true ? 'other-map' : unknownMap?.has(job.orderSeq) === true ? 'unknown-map' : undefined);
  const noticed = settled ? [...past, settled.job] : past;
  // A known mismatch outranks an unknown map identity.
  const noticeCls: BannerClass | null = covered || opened ? null
    : noticed.some((job) => blockedFor(job) === 'other-map') ? 'other-map'
      : noticed.some((job) => blockedFor(job) === 'unknown-map') ? 'unknown-map' : null;
  const storageCls: BannerClass | null = covered || opened || storageNotice == null ? null
    : storageNotice === 'corrupt' ? 'storage-corrupt' : storageNotice === 'lost' ? 'storage-full' : 'storage-pruned';
  const quiet = !covered && !opened && !view.current && !settled && !input.hasAsk && incident === null;
  // A corrupt-data decision owns the rest state until it is answered.
  const dressed = input.sketch && quiet && storageCls !== 'storage-corrupt';
  const rowOnly = quiet && noticeCls === null && past.length > 0 && !dressed;
  return {
    ...(owedJob ? { owedJob } : {}),
    keyCleared,
    showWelcome,
    notReady: covered,
    incident,
    standingTrouble: incident !== null && incident.seq === input.dismissed,
    ...(offered ? { offered } : {}),
    ...(opened ? { opened } : {}),
    settled,
    past,
    ...(settled && blockedFor(settled.job) ? { settledBlocked: blockedFor(settled.job)! } : {}),
    noticeCls,
    storageCls,
    dressed,
    zoneEmpty: rowOnly || input.marking,
  };
}
