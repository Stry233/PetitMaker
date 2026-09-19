import { useCallback, useEffect } from 'react';
import { offerSmartBuild } from '../../../core/runtime/smart-build';
import { useT } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { helpTargetAttr } from '../../chrome/modals/help/targets';
import { useUiPreview } from '../../primitives/ui-preview';
import { SMART, SMART_MENU } from './smart-menu';
import { ToolPill } from './ToolPill';
import type { TerrainSurface } from './terrain-cells';

export function SmartBuild({ surface, centre, active }: {
  surface: TerrainSurface; centre: number; active: boolean;
}) {
  const t = useT();
  const setEditMode = useEditorStore(s => s.setEditMode);
  const action = SMART_MENU[surface][0]!;
  const pictured = useUiPreview();
  const press = useCallback(() => setEditMode(useEditorStore.getState().editMode.tool === 'smart'
    ? { tool: 'none' } : { tool: 'smart', macro: action.id }), [setEditMode, action.id]);
  useEffect(() => pictured ? undefined : offerSmartBuild(press), [press, pictured]);

  return <div {...helpTargetAttr('smart')}>
    <ToolPill glyph={SMART.cellGlyph} label={t('smart.build')}
      commandId={SMART.commandId} active={active} centre={centre} onSelect={press}/>
  </div>;
}
