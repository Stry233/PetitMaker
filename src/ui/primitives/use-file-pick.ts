/*
 * Choosing a file without a field of its own: `pick` opens the system's chooser on a hidden input the
 * caller renders once (`<input {...input} />`, its test id beside), and a chosen file reaches `onFile`.
 * The input empties before each choosing, so choosing the file just chosen again reports it again.
 */
import { useRef, type ChangeEvent } from 'react';

/** Whether a drag carries files, rather than text or an element dragged within the page. */
export function carriesFiles(e: { dataTransfer: DataTransfer | null }): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files');
}

export function useFilePick({ accept, onFile }: { accept: string; onFile: (file: File) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const pick = (): void => {
    const el = ref.current;
    if (!el) return;
    el.value = '';
    el.click();
  };
  const input = {
    ref, type: 'file', hidden: true, accept,
    onChange: (e: ChangeEvent<HTMLInputElement>) => { const file = e.currentTarget.files?.[0]; if (file) onFile(file); },
  } as const;
  return { pick, input };
}
