/** Builders and the render wrapper the assistant panel's tests share. */
import type { ReactElement, ReactNode } from 'react';
import { render } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import type { JobView, PanelView } from '../../agent/panel';
import { I18nProvider } from '../../i18n/context';
import type {
  PanelConnectionProps, PanelDockProps, PanelPictureProps, PanelRecordProps, PanelRegionProps, PanelShellProps,
  PanelVerbProps, PanelViewProps,
} from '../../ui/agent/panel-shell-props';

/** Locale context under reduced motion, so every transition lands on its first frame. */
export function Wrapper({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="always">
      <I18nProvider>{children}</I18nProvider>
    </MotionConfig>
  );
}

export function renderWithI18n(node: ReactElement) {
  return render(node, { wrapper: Wrapper });
}

/** An idle panel view with no jobs. */
export function makeView(over: Partial<PanelView> = {}): PanelView {
  return {
    phase: 'idle',
    jobs: [],
    queuedSteers: [],
    vitals: { cells: 0, objects: 0, reverts: 0, jobs: 0 },
    suggestion: null,
    lastEventAt: 0,
    ...over,
  };
}

/** A job with an order and nothing recorded yet. */
export function makeJob(over: Partial<JobView> = {}): JobView {
  return {
    orderSeq: 1, orderText: 'build a village', orderAt: 0,
    asks: [], ops: [], steerNotes: [], checkpoints: [], stamps: [], celebrate: false, skills: [],
    ...over,
  };
}

/** Every member of every `PanelShell` group in one record, the shape a test writes a mount in. */
export type FlatPanelProps = PanelViewProps & PanelConnectionProps & PanelRecordProps & PanelRegionProps
  & PanelDockProps & PanelVerbProps & PanelPictureProps;

/** The group each flat member belongs to; the mapped type fails to compile when a group gains a member. */
const GROUP_OF: { [K in keyof FlatPanelProps]-?: keyof PanelShellProps } = {
  view: 'panel', running: 'panel', open: 'panel', visit: 'panel', initialZone: 'panel', now: 'panel',
  maxHeight: 'panel', mapName: 'panel', lane: 'panel', sketchbook: 'panel', fill: 'panel', hosted: 'panel',
  connected: 'connection', ready: 'connection', providerName: 'connection', modelName: 'connection',
  liveConnection: 'connection', connectionMeta: 'connection',
  undoDepth: 'records', filed: 'records', cleared: 'records', otherMap: 'records', unknownMap: 'records',
  restored: 'records', storageNotice: 'records',
  bounds: 'region', marking: 'region', gateCells: 'region', onMarkRegion: 'region', onClearRegion: 'region',
  pinned: 'dock', dockSide: 'dock', away: 'dock', pinBlocked: 'dock', onTogglePin: 'dock', onSwitchSide: 'dock',
  onCollapse: 'dock',
  onSend: 'verbs', onStop: 'verbs', onPause: 'verbs', onResume: 'verbs', onGateAnswer: 'verbs', onRetryNow: 'verbs',
  onRepair: 'verbs', onRecallSteer: 'verbs', onRewind: 'verbs', onRollBack: 'verbs', onRewindAll: 'verbs',
  onKeepGoing: 'verbs', onSetAside: 'verbs', onFileAway: 'verbs', onClearRecord: 'verbs', onClearJobs: 'verbs',
  onDismissStorage: 'verbs',
  gateThumb: 'pictures', optionThumb: 'pictures', regionShot: 'pictures', recordShot: 'pictures',
  recordStamp: 'pictures',
};

/** `PanelShell`'s grouped props from one flat record. */
export function panelProps(flat: FlatPanelProps): PanelShellProps {
  const groups: Partial<Record<keyof PanelShellProps, Record<string, unknown>>> = {};
  for (const [key, value] of Object.entries(flat)) {
    const group = GROUP_OF[key as keyof FlatPanelProps];
    if (!group) throw new Error(`panelProps: no PanelShell group holds ${key}`);
    (groups[group] ??= {})[key] = value;
  }
  return groups as unknown as PanelShellProps;
}

/** The flat record a grouped mount carries, for a test reading what the panel was handed. */
export function flatPanelProps(props: PanelShellProps): FlatPanelProps {
  return { ...props.panel, ...props.connection, ...props.records, ...props.region, ...props.dock, ...props.verbs, ...props.pictures };
}
