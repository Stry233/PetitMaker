import { useCallback, useEffect } from 'react';
import { offerSmartBuild, toggleSmartMacro } from '../../../../editor/commands/smart-build';
import { useT } from '../../../../i18n/context';
import { helpTargetAttr } from '../../../session/help-targets';
import { useUiPreview } from '../../../design/preview';
import { SMART, SMART_MENU } from '../smart-menu';
import { ToolPill } from '../ToolPill';
import type { ContentType } from '../../../../state/editing/edit-mode';

export function SmartBuild({ surface, centre, active }: {
  surface: ContentType; centre: number; active: boolean;
}) {
  const t = useT();
  const action = SMART_MENU[surface][0]!;
  const pictured = useUiPreview();
  const press = useCallback(() => toggleSmartMacro(action.id), [action.id]);
  useEffect(() => pictured ? undefined : offerSmartBuild(press), [press, pictured]);

  return <div {...helpTargetAttr('smart')}>
    <ToolPill glyph={SMART.cellGlyph} label={t('smart.build')}
      commandId={SMART.commandId} active={active} centre={centre} onSelect={press}/>
  </div>;
}
