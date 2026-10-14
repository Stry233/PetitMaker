import { useWindow } from '../chrome/modals/use-window';
import { useT } from '../../i18n/context';
import { deliverToXiaohongshu, xiaohongshuImageActionAvailable } from '../../editor/export/xiaohongshu';
import { ModalShell, useModalEntered } from '../primitives/ModalShell';
import { WindowHeader, windowFrame } from '../primitives/Window';
import { ExportPanel } from '../chrome/modals/export/ExportModal';

export function LiteShareWindow() {
  const t = useT();
  const { open, close } = useWindow('share');
  const deliveries = (['save', 'note'] as const).map(action => ({
    id: action,
    label: t(action === 'save' ? 'lite.save_album' : 'lite.open_note'),
    available: xiaohongshuImageActionAvailable(action),
    send: (image: Blob) => deliverToXiaohongshu(image, action),
  }));
  const { entered, onEntered } = useModalEntered(open);
  return <ModalShell helpTarget={{ page: 'share' }} open={open} onClose={close} onEntered={onEntered} size="workspace"
    cardStyle={{ ...windowFrame, overflow: 'hidden' }} ariaLabel={t('share.title')}>
    <WindowHeader title={<h2 style={{ margin: 0, font: 'inherit' }}>{t('share.title')}</h2>} reserve close={{ label: t('hint.close'), onPress: close }} style={{ marginBottom: 10 }} />
    {!deliveries.some(delivery => delivery.available) && <p role="status">{t('lite.preview_only')}</p>}
    <ExportPanel open={open} entered={entered} onDone={close} deliveries={deliveries} />
  </ModalShell>;
}
