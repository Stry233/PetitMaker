import { useEffect } from 'react';

/**
 * Publishes custom properties on the document root for as long as the caller is mounted, for a
 * stylesheet or a surface outside the caller's subtree that cannot read a token module. Each value
 * is rewritten when it changes and removed on unmount. One owner per property.
 */
export function useRootCssVars(vars: Readonly<Record<`--${string}`, string>>): void {
  const key = JSON.stringify(vars);
  useEffect(() => {
    const root = document.documentElement.style;
    const entries = Object.entries(JSON.parse(key) as Record<string, string>);
    for (const [name, value] of entries) root.setProperty(name, value);
    return () => { for (const [name] of entries) root.removeProperty(name); };
  }, [key]);
}
