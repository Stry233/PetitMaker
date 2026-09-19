import { useEffect } from 'react';
import { comboFromEvent, effectiveCombo, useKeybinds } from '../../../../core/runtime/keybindings';
import { useEditorStore } from '../../../../state/store';
import { inheritedHelpTarget } from '../../../primitives/help-target';
import { openHelp } from './targets';
import type { HelpPageId } from './page-schema';

/** Context help remains available inside dialogs; picking never executes the underlying control. */
export function useContextHelp(): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const state = useEditorStore.getState();
      if (state.tourRunning || state.portraitBlocked || event.isComposing) return;
      if (document.querySelector('[data-shortcut-recording="true"]')) return;
      const combo = effectiveCombo(useKeybinds.getState().overrides, 'app.whats_this');
      const target = event.target instanceof HTMLElement ? event.target : null;
      const editing = target?.isContentEditable || target?.closest('input, textarea, select');
      const inputSafe = /^F\d+$/.test(event.key) || ((event.ctrlKey || event.metaKey) && !event.getModifierState('AltGraph'));
      const matches = combo && comboFromEvent(event) === combo && (!editing || inputSafe);
      if (!state.whatsThis && !matches) return;
      if (state.whatsThis && target?.closest('[data-testid="whats-this-layer"]') && (event.key === 'Enter' || event.key === ' ')) return;
      event.stopImmediatePropagation();
      if (event.key === 'Tab' && state.whatsThis) return;
      event.preventDefault();
      if (event.repeat) return;
      if (matches) {
        state.setWhatsThis(!state.whatsThis);
        if (!state.whatsThis && state.modals.help) state.setModal('help', false);
      } else if (event.key === 'Escape') state.setWhatsThis(false);
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
