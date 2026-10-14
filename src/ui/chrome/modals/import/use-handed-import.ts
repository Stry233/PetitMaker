import { useEffect, useRef } from 'react';
import { useEditorStore } from '../../../../state/store';
import type { HandedImport } from '../../../../state/slices/shell';

/** Takes a file of `kind` another import surface handed over, once, while `active`; `onFile` reads it
 *  as the window reads one of its own. */
export function useHandedImport(kind: HandedImport['kind'], active: boolean, onFile: (file: File) => void): void {
  const handed = useEditorStore((s) => s.handedImport);
  const read = useRef(onFile);
  read.current = onFile;
  useEffect(() => {
    if (!active || handed?.kind !== kind) return;
    const file = useEditorStore.getState().takeHandedImport(kind);
    if (file) read.current(file);
  }, [kind, active, handed]);
}
