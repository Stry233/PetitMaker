/**
 * dock-state.ts — pure derivation of the dock's one live tile (spec §UI.3).
 *
 * The dock is the single always-visible status surface between the header row
 * and the site log: its background color IS the state, segments show known
 * blueprint stages, stripes mean indeterminate work, and "May I?" approval
 * chips live right inside it. This module derives WHAT the dock shows;
 * Dock.tsx owns HOW it flips between states.
 *
 * Precedence (prototype dockState(), verbatim):
 *   gate > blueprint-draft ask > sketches ask > paused > running blueprint >
 *   thinking > running (small job) > idle vitals.
 */
import type { BlueprintEntry, VerbIcon, Vitals } from '../../agent/session';
import { colors } from '../design/styles';
import { FIELD_DEEP } from './atoms';

export type DockKind = 'idle' | 'think' | 'work' | 'ask' | 'gate' | 'wait';

export type DockChipAct = 'allow' | 'allow-all' | 'deny';
export interface DockChip { label: string; cls: 'yes' | '' | 'no'; act: DockChipAct }

export interface DockView {
  kind: DockKind;
  icon: VerbIcon;
  title?: string;
  sub?: string;
  right?: string;
  segs?: [number, number];
  stripes?: boolean;
  vitals?: boolean;
  chips?: DockChip[];
  /** Change discriminator: same kind + different key = content crossfade. */
  key: string;
}

/** State-colored backgrounds (prototype DOCK_BG; ask and gate share pale). */
export const DOCK_BG: Record<DockKind, string> = {
  idle: colors.surfaceSecondary, // #F3EEE8 field
  think: FIELD_DEEP,
  work: colors.tileGreen,        // #CED779 — green so the yellow stripes never sit on yellow
  ask: colors.tilePaleYellow,    // #FFE196
  gate: colors.tilePaleYellow,
  wait: colors.utilTaupe,        // #CFC7B7
};

/** Fixed per-stage glyphs for a running blueprint (prototype STAGE_ICONS). */
export const STAGE_ICONS: readonly VerbIcon[] = ['terrain', 'water', 'build', 'flower'];

type Translator = (key: string, params?: Record<string, string | number>) => string;

export interface DockInput {
  /** A "May I?" step awaiting the user's answer. */
  gate: { sub: string } | null;
  /** A drafted blueprint awaiting "Looks right, go". */
  waitingGate: boolean;
  /** Sketches on the table awaiting a pick. */
  waitingPick: boolean;
  /** The live blueprint (first bp entry that is not done and not undone). */
  bp?: BlueprintEntry | null;
  running: boolean;
  thinking: boolean;
  vitals: Vitals;
}

function keyed(v: Omit<DockView, 'key'>): DockView {
  return { ...v, key: [v.kind, v.title ?? '', v.sub ?? '', v.segs ? v.segs.join('/') : ''].join('|') };
}

export function deriveDock(s: DockInput, t: Translator): DockView {
  if (s.gate) {
    return keyed({
      kind: 'gate',
      icon: 'build',
      title: t('agent2.may_i'),
      sub: s.gate.sub,
      chips: [
        { label: t('agent2.allow'), cls: 'yes', act: 'allow' },
        { label: t('agent2.always'), cls: '', act: 'allow-all' },
        { label: t('agent2.skip'), cls: 'no', act: 'deny' },
      ],
    });
  }
  if (s.waitingGate) {
    return keyed({ kind: 'ask', icon: 'plan', title: t('agent2.dock_drafted'), sub: t('agent2.dock_review') });
  }
  if (s.waitingPick) {
    return keyed({ kind: 'ask', icon: 'terrain', title: t('agent2.dock_sketches'), sub: t('agent2.dock_pick') });
  }
  const bp = s.bp && !s.bp.done && !s.bp.undone ? s.bp : null;
  if (bp && bp.paused) {
    return keyed({ kind: 'wait', icon: 'plan', title: t('agent2.dock_paused'), sub: bp.goal });
  }
  if (bp && !bp.draft && s.running) {
    const i = Math.max(bp.currentIdx, 0);
    return keyed({
      kind: 'work',
      icon: STAGE_ICONS[i] ?? 'build',
      title: bp.stages[i] ?? '',
      sub: bp.now || (bp.helpers && bp.helpers.length ? t('agent2.dock_helpers') : ''),
      right: `${bp.doneCount}/${bp.stages.length}`,
      segs: [bp.doneCount, bp.stages.length],
    });
  }
  if (s.thinking) {
    return keyed({ kind: 'think', icon: 'eval', title: t('agent2.dock_thinking'), sub: t('agent2.dock_walking'), stripes: true });
  }
  if (s.running) {
    return keyed({ kind: 'work', icon: 'build', title: t('agent2.dock_onit'), sub: t('agent2.dock_smalljob'), stripes: true });
  }
  const v = s.vitals;
  return { kind: 'idle', icon: 'eval', vitals: true, key: `idle${v.water}.${v.tree}.${v.build}.${v.flower}` };
}
