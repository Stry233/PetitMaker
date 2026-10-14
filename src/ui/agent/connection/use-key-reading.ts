/*
 * The setup screen's view of `agent/connection/key-reading.ts`: one reading per screen, the endpoint
 * field's draft text and the key field's focus.
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createKeyReading, type ListModels, type SetupEntry } from '../../../agent/panel';
import { useAgentConnection } from '../../../agent/boot';
import { useEndpointDraft } from '../hooks/use-endpoint-draft';

export function useKeyReading({ entry, listModels, onManage, onLeave, focusKey, pictured }: {
  entry: SetupEntry;
  listModels: ListModels;
  onManage?: () => void;
  onLeave?: () => void;
  focusKey: boolean;
  /** Help previews render the screen without issuing provider requests. */
  pictured: boolean;
}) {
  const settings = useAgentConnection();
  const [reading] = useState(() => createKeyReading({
    entry, listModels, pictured, ...(onManage ? { onManage } : {}), ...(onLeave ? { onLeave } : {}),
  }));
  useLayoutEffect(() => {
    reading.setOptions({ listModels, pictured, ...(onManage ? { onManage } : {}), ...(onLeave ? { onLeave } : {}) });
  });
  const state = useSyncExternalStore(reading.subscribe, reading.get);
  // The hand-off to management runs before paint, as the screen it replaces would otherwise flash.
  useLayoutEffect(() => reading.start(), [reading]);
  const url = useEndpointDraft(settings.customBaseUrl);

  const fieldRef = useRef<HTMLInputElement>(null);
  // A screen opened to take a key arrives with the caret in its field.
  const focusOnOpen = useRef(focusKey);
  useEffect(() => { if (focusOnOpen.current) fieldRef.current?.focus(); }, []);
  // A refused key is selected so the next input replaces it.
  useEffect(() => {
    if (!state.refused) return;
    fieldRef.current?.focus();
    fieldRef.current?.select();
  }, [state.refused, state.shakeSeq]);

  function saveEndpoint(): void {
    if (reading.saveEndpoint(url.value)) url.settle();
    else url.refuse();
  }

  return {
    ...state, settings, url, fieldRef, saveEndpoint,
    setPhase: reading.setPhase, setRowOpen: reading.setRowOpen, confirmNow: reading.confirmNow, reenter: reading.reenter,
    chooseByHand: reading.chooseByHand, pickProvider: reading.pickProvider, detectAutomatically: reading.detectAutomatically,
    leave: reading.leave, editKey: reading.editKey, focusField: reading.focusField, blurField: reading.blurField,
  };
}

export type KeyReading = ReturnType<typeof useKeyReading>;
