import { useT } from '../../../../i18n/context';
import { helpTargetAttr } from '../../../session/help-targets';
import { SMART } from '../smart-menu';
import { ToolPill } from '../ToolPill';
import { useRunCommand } from '../../use-shell-commands';

export function SmartBuild({ centre, active }: { centre: number; active: boolean }) {
  const t = useT();
  const run = useRunCommand();
  return <div {...helpTargetAttr('smart')}>
    <ToolPill glyph={SMART.cellGlyph} label={t('smart.build')}
      commandId={SMART.commandId} active={active} centre={centre} onSelect={() => run(SMART.commandId)}/>
  </div>;
}
