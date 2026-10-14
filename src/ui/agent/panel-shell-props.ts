import type { ReactNode } from 'react';
import type { AskRecord, GateOption, JobView, LiveConnection, PanelView } from '../../agent/panel';
import type { RegionBounds } from '../../core/grid/rect';
import type { DockSide } from '../shell/panel-frame';
import type { Checkpoint } from './record/ticket-parts';
import type { LaneView } from './record/Lane';
import type { RepairAct } from './derive/repair';
import type { PanelZone } from './derive/zone';

/** The projection and the shell's own state: what is shown, and whether the panel is open. */
export interface PanelViewProps {
  view: PanelView;
  /** Runner activity; inferred from the phase when omitted. */
  running?: boolean;
  /** Whether the panel is open; management and an opened record close with it. */
  open?: boolean;
  /** Counts the panel's openings, so a reopening during the close finds them closed too. */
  visit?: number;
  /** The zone a standalone mount opens on; the panel moves it from there itself. */
  initialZone?: PanelZone;
  /** Clock override used by deterministic mounts. */
  now?: number;
  /** Maximum height supplied by the surrounding frame. */
  maxHeight?: string;
  /** Current map name for the status card's metadata. */
  mapName?: string;
  /** Ephemeral helper progress, kept outside the replayable PanelView. */
  lane?: LaneView;
  /** Optional idle sketch card, already rendered by the caller. */
  sketchbook?: ReactNode;
  /** External composer fill; seq distinguishes repeated identical text. */
  fill?: { text: string; seq: number };
  /** Whether CharacterHost owns the live character outside this tree. */
  hosted?: boolean;
}

/** The connection the panel runs on. */
export interface PanelConnectionProps {
  /** Whether a credential is available. */
  connected: boolean;
  /** Whether the credential, endpoint and model form a usable connection. */
  ready?: boolean;
  /** Armed provider display name. */
  providerName?: string;
  /** Armed model display name. */
  modelName?: string;
  /** Connection captured by the running job. */
  liveConnection?: LiveConnection;
  connectionMeta?: string;
}

/** The records: which are filed, cleared or belong to another map, and how storage holds them. */
export interface PanelRecordProps {
  /** Live undo depth used to identify rolled-back jobs. */
  undoDepth?: number;
  /** Settled records filed into history. */
  filed?: ReadonlySet<number>;
  /** Record identities removed from both the active card and history. */
  cleared?: ReadonlySet<number>;
  /** Records tied to another known map. */
  otherMap?: ReadonlySet<number>;
  /** Records with no map identity. */
  unknownMap?: ReadonlySet<number>;
  /** Whether the session is an untouched restoration. */
  restored?: boolean;
  /** Session-storage health reported by the store. */
  storageNotice?: 'pruned' | 'lost' | 'corrupt' | null;
}

/** The painted region a job works inside. */
export interface PanelRegionProps {
  /** Live painted region. Running tickets retain their own captured JobView region. */
  bounds?: RegionBounds | null;
  /** Whether the map is currently selecting a region. */
  marking?: boolean;
  /** Cell count affected by the open gate. */
  gateCells?: number;
  onMarkRegion?(): void;
  onClearRegion?(): void;
}

/** Where the panel stands: floating, or docked to one side. */
export interface PanelDockProps {
  /** Whether the panel fills a side region instead of floating over the map. */
  pinned?: boolean;
  /** Dock side, read only while pinned. */
  dockSide?: DockSide;
  /** Intermediate dock-transition state; folded is hidden beneath the covering sheet. */
  away?: 'leaving' | 'folded';
  /** Whether the current viewport is too narrow to dock. */
  pinBlocked?: boolean;
  onTogglePin?(): void;
  onSwitchSide?(): void;
  /** Hides the panel without changing runner state. */
  onCollapse?(): void;
}

/** Every verb the panel routes out to the runner and the record store. */
export interface PanelVerbProps {
  onSend(text: string): void;
  onStop(): void;
  onPause(): void;
  onResume?(): void;
  /** `words` carries a quick answer or selected option back as user guidance. */
  onGateAnswer(gateId: string, answer: 'allow' | 'skip' | 'words', words?: string): void;
  onRetryNow?(): void;
  /** A repair from the desk card, a banner or a held offer, after the panel took its own part. */
  onRepair?(act: RepairAct): void;
  onRecallSteer?(steerSeq: number): void;
  onRewind?(checkpoint: Checkpoint): void;
  onRollBack?(job: JobView): void;
  onRewindAll?(job: JobView): void;
  onKeepGoing?(job: JobView): void;
  /** Settles and files a currently held job. */
  onSetAside?(orderSeq: number): void;
  onFileAway?(orderSeq: number): void;
  onClearRecord?(orderSeq: number): void;
  onClearJobs?(): void;
  onDismissStorage?(): void;
}

/** Map pictures the renderer owner draws for the panel. */
export interface PanelPictureProps {
  /** Per-ask map thumbnail. */
  gateThumb?(ask: AskRecord): ReactNode;
  /** Per-option map thumbnail. */
  optionThumb?(option: GateOption): ReactNode;
  /** Captures a live map region at the requested size. */
  regionShot?(bounds: RegionBounds, width: number, height: number): ReactNode;
  /** Captures a settled build for its receipt. */
  recordShot?(job: JobView): ReactNode;
  recordStamp?(job: JobView): string;
}

/** What the panel is handed, by group: the projection, its connection, records, region, dock,
 *  verbs and pictures. */
export interface PanelShellProps {
  panel: PanelViewProps;
  connection: PanelConnectionProps;
  records?: PanelRecordProps;
  region?: PanelRegionProps;
  dock?: PanelDockProps;
  verbs: PanelVerbProps;
  pictures?: PanelPictureProps;
}
