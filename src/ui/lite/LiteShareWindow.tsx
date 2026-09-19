import { useT } from '../../i18n/context';
import { useEditorStore } from '../../state/store';
import { sendXhsImage, xhsImageActionAvailable, type XhsImageAction } from '../../io/xhs';
import { ModalShell } from '../primitives/ModalShell';
import { windowCard, windowTitle } from '../design/window-skin';
import { ExportPanel } from '../chrome/modals/export/ExportModal';

function deliverImage(image: Blob, action: XhsImageAction): Promise<void> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(image);
  }).then(data => sendXhsImage(data, action));
}

export function LiteShareWindow() {
  const t = useT();
  const open = useEditorStore(s => s.modals.share || s.modals.export);
  const setModal = useEditorStore(s => s.setModal);
  const close = () => { setModal('share', false); setModal('export', false); };
  const deliveries = (['save', 'note'] as const).map(action => ({
    id: action,
    label: t(action === 'save' ? 'lite.save_album' : 'lite.open_note'),
    available: xhsImageActionAvailable(action),
    send: (image: Blob) => deliverImage(image, action),
  }));
  return <ModalShell helpTarget={{ page: 'share' }} open={open} onClose={close} width={980} height={848} maxVwPct={94} maxVhPct={92}
    cardStyle={{ ...windowCard, padding: '24px 26px 20px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }} ariaLabel={t('share.title')}>
    <h2 style={{ ...windowTitle, margin: '0 0 10px' }}>{t('share.title')}</h2>
    {!deliveries.some(delivery => delivery.available) && <p role="status">{t('lite.preview_only')}</p>}
    <ExportPanel open={open} onDone={close} deliveries={deliveries} />
  </ModalShell>;
}
