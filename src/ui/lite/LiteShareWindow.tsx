import { useEffect, useState } from 'react';
import { useWindow } from '../chrome/modals/use-window';
import { useT } from '../../i18n/context';
import { HOST_DELIVERIES, HOST_FOOTER_MARK, HOST_MAP_LINK } from '../../editor/export/host-deliveries';
import { ModalShell, useModalEntered } from '../primitives/ModalShell';
import { WindowHeader, windowFrame } from '../primitives/Window';
import { ExportPanel } from '../chrome/modals/export/ExportModal';

export function LiteShareWindow() {
  const t = useT();
  const { open, close } = useWindow('share');
  const deliveries = HOST_DELIVERIES.map(({ id, labelKey, available, send }) => ({ id, label: t(labelKey), available: available(), send }));
  // The container answers whether it shares links asynchronously; the button waits for a yes.
  const [linkOffered, setLinkOffered] = useState(false);
  useEffect(() => {
    let live = true;
    if (open && HOST_MAP_LINK) void HOST_MAP_LINK.offered().then((yes) => { if (live) setLinkOffered(yes); });
    return () => { live = false; };
  }, [open]);
  const link = HOST_MAP_LINK && linkOffered ? { label: t(HOST_MAP_LINK.labelKey), share: HOST_MAP_LINK.share } : undefined;
  const { entered, onEntered } = useModalEntered(open);
  return <ModalShell helpTarget={{ page: 'share' }} open={open} onClose={close} onEntered={onEntered} size="workspace"
    cardStyle={{ ...windowFrame, overflow: 'hidden' }} ariaLabel={t('share.title')}>
    <WindowHeader title={t('share.title')} reserve close={{ label: t('hint.close'), onPress: close }} style={{ marginBottom: 10 }} />
    <ExportPanel open={open} entered={entered} onDone={close} deliveries={deliveries} link={link} mark={HOST_FOOTER_MARK ?? undefined} />
  </ModalShell>;
}
