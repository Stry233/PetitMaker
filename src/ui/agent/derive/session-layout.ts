/* Which surfaces the job zone stands: where each job stands (`agent/panel.ts:jobStanding`), shown
 * through the zone and the panel's own marks. */
import {
  type JobStanding, type JobView, type PanelView, type PanelZone, type TroubleStanding, jobStanding, rewindBlock, troubleStanding,
} from '../../../agent/panel';
import type { BannerClass } from './repair';

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
  /** When the held key came from a sign-in, where it did. */
  signedInAt?: number;
  /** An ask card stands in the record. */
  hasAsk: boolean;
  /** An idle sketch card is on offer. */
  sketch: boolean;
  marking: boolean;
}

export interface SessionLayout extends JobStanding, TroubleStanding {
  /** The keyless rest, with nothing outstanding. */
  showWelcome: boolean;
  /** Setup, the keyless rest or management owns the zone and its foot; the composer stands down. */
  notReady: boolean;
  noticeCls: BannerClass | null;
  storageCls: BannerClass | null;
  /** The idle sketch card stands nearest the composer. */
  dressed: boolean;
  /** Only the past-jobs row stands, so the zone waives its height floor. */
  zoneEmpty: boolean;
}

export function sessionLayout(input: SessionInputs): SessionLayout {
  const { view, connected, zone, otherMap, unknownMap, storageNotice } = input;
  const standing = jobStanding({ ...input, openedSeq: zone.kind === 'record' ? zone.seq : null });
  const { incident, opened, settled, past } = standing;
  const showSetup = zone.kind === 'setup';
  const showWelcome = !connected && !showSetup && !standing.keyCleared;
  const covered = showSetup || showWelcome || zone.kind === 'manage';
  const noticed: readonly JobView[] = settled ? [...past, settled.job] : past;
  // A known mismatch outranks an unknown map identity.
  const noticeCls: BannerClass | null = covered || opened ? null
    : noticed.some((job) => rewindBlock(job, otherMap, unknownMap) === 'other-map') ? 'other-map'
      : noticed.some((job) => rewindBlock(job, otherMap, unknownMap) === 'unknown-map') ? 'unknown-map' : null;
  const storageCls: BannerClass | null = covered || opened || storageNotice == null ? null
    : storageNotice === 'corrupt' ? 'storage-corrupt' : storageNotice === 'lost' ? 'storage-full' : 'storage-pruned';
  const quiet = !covered && !opened && !view.current && !settled && !input.hasAsk && incident === null;
  // A corrupt-data decision owns the rest state until it is answered.
  const dressed = input.sketch && quiet && storageCls !== 'storage-corrupt';
  const rowOnly = quiet && noticeCls === null && past.length > 0 && !dressed;
  return {
    ...standing,
    ...troubleStanding(standing, { connected, ...(input.signedInAt !== undefined ? { signedInAt: input.signedInAt } : {}) }),
    showWelcome,
    notReady: covered,
    noticeCls,
    storageCls,
    dressed,
    zoneEmpty: rowOnly || input.marking,
  };
}
