/* What each session phase means to the panel: the loop's own traits (`agent/boot.ts:PHASE_TRAITS`)
 * and how the panel shows the phase. */
import { PHASE_TRAITS } from '../../../agent/boot';
import type { PhaseTraits as LoopTraits, SessionPhase } from '../../../agent/panel';
import type { PaperState } from '../panel-skin';
import type { I18nKey } from '../../../i18n/keys';

interface PhaseTraits extends LoopTraits {
  /** The ticket's progress tape stands still. */
  frozen: boolean;
  /** The desk card's paper. */
  paper: PaperState;
  /** The desk card's status word. Literal keys stay visible to the i18n drift check. */
  word: I18nKey;
}

export const PHASE: Record<SessionPhase, PhaseTraits> = {
  idle: { ...PHASE_TRAITS.idle, frozen: false, paper: 'idle', word: 'agent.dock_idle' },
  thinking: { ...PHASE_TRAITS.thinking, frozen: false, paper: 'think', word: 'agent.dock_thinking' },
  streaming: { ...PHASE_TRAITS.streaming, frozen: false, paper: 'think', word: 'agent.dock_writing' },
  executing: { ...PHASE_TRAITS.executing, frozen: false, paper: 'work', word: 'agent.dock_executing' },
  gated: { ...PHASE_TRAITS.gated, frozen: true, paper: 'ask', word: 'agent.dock_gated' },
  retrying: { ...PHASE_TRAITS.retrying, frozen: true, paper: 'wait', word: 'agent.dock_retry_again' },
  pausing: { ...PHASE_TRAITS.pausing, frozen: true, paper: 'work', word: 'agent.dock_pausing' },
  paused: { ...PHASE_TRAITS.paused, frozen: true, paper: 'wait', word: 'agent.dock_paused' },
  aborted: { ...PHASE_TRAITS.aborted, frozen: false, paper: 'stop', word: 'agent.dock_aborted' },
  incident: { ...PHASE_TRAITS.incident, frozen: false, paper: 'danger', word: 'agent.dock_incident' },
};
