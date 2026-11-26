/* The manage card's view of `agent/connection/endpoint-reading.ts`: one reading per card. */
import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { createEndpointReading, type ListModels } from '../../../agent/panel';

export function useEndpointReading({ listModels, onFiled }: { listModels: ListModels; onFiled: () => void }) {
  const [reading] = useState(() => createEndpointReading({ listModels, onFiled }));
  useLayoutEffect(() => { reading.setOptions({ listModels, onFiled }); });
  const state = useSyncExternalStore(reading.subscribe, reading.get);
  useEffect(() => reading.start(), [reading]);
  return { ...state, edit: reading.edit, confirm: reading.confirm, refresh: reading.refresh };
}
