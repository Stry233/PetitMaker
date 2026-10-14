/*
 * The column's one runner, kept by `agent/exec/runner-host.ts`; this hook hands it the render's
 * connection, editor and locale and re-renders when a capability answer arrives.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { ArmedConnection } from '../../../agent/boot';
import { createRunnerHost, type PanelRunner } from '../../../agent/panel-runtime';
import { useEditorStore } from '../../../state/store';
import { useLocale } from '../../../i18n/context';

export type { PanelRunner };

export function usePanelRunner(armed: ArmedConnection, model: string, connected: boolean): PanelRunner | null {
  const [host] = useState(createRunnerHost);
  const executor = useEditorStore((s) => s.commandExecutor);
  // The editor locale seeds assistant language when the order has no clear language.
  const uiLocale = useLocale();
  useSyncExternalStore(host.subscribe, host.version);
  const inputs = { armed, model, connected, executor, uiLocale };
  const runner = host.runner(inputs);
  useEffect(() => { host.sync(inputs); });
  // Key revocation stops live work before clearing the credential.
  useEffect(() => (runner ? host.attach() : undefined), [host, runner]);
  return runner;
}
