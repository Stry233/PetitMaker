import { useMemo, useState } from 'react';

/**
 * The custom-endpoint field's text: it follows the stored address until the user types, and returns
 * to following once `settle` reports the edit filed or abandoned.
 */
export function useEndpointDraft(stored: string): {
  value: string;
  bad: boolean;
  edit(next: string): void;
  refuse(): void;
  settle(): void;
} {
  const [draft, setDraft] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const value = draft ?? stored;
  return useMemo(() => ({
    value,
    bad,
    edit: (next: string) => { setDraft(next); setBad(false); },
    refuse: () => setBad(true),
    settle: () => { setDraft(null); setBad(false); },
  }), [value, bad]);
}
