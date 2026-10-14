import { useEffect } from 'react';
import { comboFromEvent } from '../../platform/input/combo';
import { effectiveCombo } from '../../state/keymap/resolve';
import { useKeybinds } from '../../state/keymap/store';
import { useEditorStore } from '../../state/store';
import { inheritedHelpTarget } from '../primitives/help-target';
import { openHelp } from '../session/help-targets';
import type { HelpPageId } from './page-schema';
import { isTextEntry } from '../../platform/input/text-entry';

const toggleWhatsThis = () => useEditorStore.getState().toggleWhatsThis();
const endWhatsThis = () => useEditorStore.getState().setWhatsThis(false);

/** Context help remains available inside dialogs; picking never executes the underlying control. */
export function useContextHelp(): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const state = useEditorStore.getState();
      if (state.tourRunning || state.portraitBlocked || event.isComposing) return;
      if (useKeybinds.getState().recording) return;
      const combo = effectiveCombo(useKeybinds.getState().overrides, 'app.whats_this');
      const target = event.target instanceof HTMLElement ? event.target : null;
      const editing = isTextEntry(target);
      const inputSafe = /^F\d+$/.test(event.key) || ((event.ctrlKey || event.metaKey) && !event.getModifierState('AltGraph'));
      const matches = combo && comboFromEvent(event) === combo && (!editing || inputSafe);
      if (!state.whatsThis && !matches) return;
      if (state.whatsThis && target?.closest('[data-testid="whats-this-layer"]') && (event.key === 'Enter' || event.key === ' ')) return;
      event.stopImmediatePropagation();
      if (event.key === 'Tab' && state.whatsThis) return;
      event.preventDefault();
      if (event.repeat) return;
      if (matches) toggleWhatsThis();
      else if (event.key === 'Escape') endWhatsThis();
      else if (event.key === 'Enter' || event.key === ' ') {
        const help = inheritedHelpTarget(document.activeElement);
        if (help) openHelp(help.page as HelpPageId, help.anchor);
      }
    };
    const onPress = (event: PointerEvent) => {
      if (!useEditorStore.getState().whatsThis) return;
      // Outside-dismiss listeners must leave the inspected menu or draft in place.
      event.stopImmediatePropagation();
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onPress, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onPress, true);
    };
  }, []);
}
