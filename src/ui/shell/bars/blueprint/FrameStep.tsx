/**
 * Blueprint mode's frame step: the region bar with the rectangle tool only, standing in the strip's
 * place while a frame is drawn. Its line says why the frame cannot be saved, in the capture's own
 * terms; Done opens the save step and Cancel is Escape, which backs out of the step while it is the newest state.
 */
import { useT } from '../../../../i18n/context';
import type { I18nKey } from '../../../../i18n/keys';
import { BLUEPRINT_MAX_SIDE, frameRefusal, type CaptureRefusal } from '../../../../editor/editing/blueprint';
import { backOut } from '../../../../editor/back/back-out';
import { useEditorStore } from '../../../../state/store';
import { regionOf } from '../../../../state/editing/region';
import { useMapDerived } from '../../../session/use-map-derived';
import { useRunCommand } from '../../use-shell-commands';
import { ScopeScreen } from '../generate/ScopeScreen';

const REFUSAL: Record<CaptureRefusal, I18nKey> = {
  'too-big': 'blueprint.frame_too_big',
  'too-small': 'blueprint.frame_too_small',
  landmark: 'blueprint.frame_landmark',
  empty: 'blueprint.frame_empty',
};

export function FrameStep() {
  const t = useT();
  const run = useRunCommand();
  const region = useEditorStore((s) => regionOf(s, 'blueprint'));
  const refusal = useMapDerived(() => (region.length > 0 ? frameRefusal(region) : null), [region]);
  const limit = region.length === 0 ? t('blueprint.frame_draw')
    : refusal === null ? null : t(REFUSAL[refusal], { n: BLUEPRINT_MAX_SIDE });
  return <ScopeScreen limit={limit} help={{ page: 'blueprint-save', anchor: 'bpsave-frame' }} onDone={() => run('blueprints.frame_done')} onCancel={() => { backOut(); }} />;
}
