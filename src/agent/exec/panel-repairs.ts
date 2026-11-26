/*
 * The repairs that ask something of the harness. The others are the panel's own: they open setup or
 * management, focus the composer or put a notice down.
 */
import { useAgentConnection } from '../connection/store';
import type { RepairAct } from '../core/repair-policy';
import { exportSessionLog, lastOrderText } from '../session/panel-verbs';
import type { PanelRunner } from './runner-host';

/** Runs `act` where the harness has a part in it: a retry files the latest order again while no job
 *  runs, a key to fix is dropped so a new one is asked for, and the raw log is written out. */
export function runRepair(runner: Pick<PanelRunner, 'resend'> | null, act: RepairAct): void {
  if (act === 'try-again') runner?.resend(lastOrderText());
  else if (act === 'fix-key') useAgentConnection.getState().forgetKey();
  else if (act === 'export-log') exportSessionLog();
}
