/*
 * useMapFileIO.ts — the map file-IO handlers (export / import / image export)
 * extracted from App.tsx. handleExport now just opens the ExportJsonModal
 * (section-picker) — the actual serialize+download logic lives in
 * ui/chrome/export/ExportJsonModal.tsx, since the modal needs live control
 * over which optional sections (notes/generation/history/session/stats/
 * catalogInfo) are included. handleImport drives the unified ImportModal;
 * handleImage opens the image-export modal. Behaviour of import/image is
 * unchanged from before.
 */
import { useCallback } from 'react';
import { useEditorStore } from '../../state/store';

export interface MapFileIO {
  handleExport: () => void;
  handleImport: () => void;
  handleImage: () => void;
}

export function useMapFileIO(): MapFileIO {
  const setExportJsonModalOpen = useEditorStore((s) => s.setExportJsonModalOpen);
  const handleExport = useCallback(() => { setExportJsonModalOpen(true); }, [setExportJsonModalOpen]);

  // Import now opens the unified ImportModal (an image PNG with embedded map data, or a
  // legacy .json) which runs the same loadMap path. Drag/drop + paste live there.
  const setImportModalOpen = useEditorStore((s) => s.setImportModalOpen);
  const handleImport = useCallback(() => { setImportModalOpen(true); }, [setImportModalOpen]);

  const setExportModalOpen = useEditorStore((s) => s.setExportModalOpen);
  const handleImage = useCallback(() => { setExportModalOpen(true); }, [setExportModalOpen]);

  return { handleExport, handleImport, handleImage };
}
