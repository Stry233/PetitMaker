/**
 * The sites each foundation guard (`foundation-guards.test.ts`) still tolerates, per file. Every
 * entry names the surface that still holds the literal or mechanism and shrinks as it moves onto the
 * foundations. Counts are exact: the test fails when a file holds more sites than listed, and when
 * it holds fewer. `GUARD_EXEMPT` names the files a guard does not read for what they are.
 */
export type GuardId = 'hex' | 'colorFunction' | 'shadow' | 'zIndex' | 'radius' | 'resizeObserver' | 'dismissal' | 'motion' | 'spacing';
export interface GuardEntry { count: number; owner: 'shell' | 'modals' | 'foundations'; reason: string }

/** A guard with no entry tolerates no site. */
export const GUARD_ALLOWLIST: Partial<Record<GuardId, Record<string, GuardEntry>>> = {
  spacing: {
    'src/ui/chrome/LegalBar.tsx': { count: 1, owner: 'shell', reason: "a legal view: document spacing it brought from src/legal, not yet on the scale" },
    'src/ui/chrome/modals/about/LegalDocView.tsx': { count: 1, owner: 'modals', reason: "a legal view: document spacing it brought from src/legal, not yet on the scale" },
    'src/ui/primitives/LegalMarkdown.tsx': { count: 1, owner: 'foundations', reason: "a legal view: document spacing it brought from src/legal, not yet on the scale" },
  },
};

/** Files a guard does not read for what they are, per guard, with the reason. */
export const GUARD_EXEMPT: Partial<Record<GuardId, Readonly<Record<string, string>>>> = {
  spacing: {
    'src/ui/shell/units.ts': "the frame's geometry table in design px, measured from the design source; its gaps are not CSS spacing",
  },
  dismissal: {
    'src/ui/help/use-context-help.ts': "the what's-this picker reads keys and holds presses while it inspects; it dismisses nothing",
    'src/ui/chrome/modals/keyboard/KeyboardModal.tsx': 'records the chord a command is rebound to; it dismisses nothing',
    'src/ui/design/focus-source.ts': 'records whether focus came from keyboard or pointer; it dismisses nothing',
    'src/ui/app/use-ui-zoom-shortcut.ts': 'the UI-scale keys, live behind every modal; they dismiss nothing',
    'src/ui/shell/use-editor-shortcuts.ts': 'the global shortcut router; it dismisses nothing',
  },
};
