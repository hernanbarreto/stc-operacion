import React, { useState, useEffect, useCallback } from 'react';
import { X, FileSpreadsheet, Trash2, RefreshCw, AlertCircle, Loader } from 'lucide-react';
import { listExcelFiles, deleteExcelFile, type StorageFile } from '../services/storageService';
import { removeFileFromIndex, rescanStorage, type RescanProgress } from '../services/daysIndex';
import './FilesModal.css';

interface FilesModalProps {
  onClose: () => void;
  onIndexChanged: () => void;
}

export const FilesModal: React.FC<FilesModalProps> = ({ onClose, onIndexChanged }) => {
  const [files, setFiles] = useState<StorageFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<StorageFile | null>(null);
  const [rescanning, setRescanning] = useState(false);
  const [rescanMsg, setRescanMsg] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const list = await listExcelFiles();
      setFiles(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al listar archivos');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleDelete = async (sf: StorageFile) => {
    setBusyPath(sf.fullPath);
    setError('');
    try {
      await deleteExcelFile(sf.fullPath);
      await removeFileFromIndex(sf.name);
      setConfirmDelete(null);
      await refresh();
      onIndexChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al borrar');
    } finally {
      setBusyPath(null);
    }
  };

  const handleRescan = async () => {
    setRescanning(true);
    setError('');
    setRescanMsg('Iniciando…');
    try {
      await rescanStorage((p: RescanProgress) => {
        if (p.phase === 'list') setRescanMsg('Listando archivos…');
        else if (p.phase === 'load-index') setRescanMsg('Leyendo índice…');
        else if (p.phase === 'process') setRescanMsg(`[${p.current}/${p.total}] Indexando ${p.fileName}…`);
        else if (p.phase === 'save') setRescanMsg('Guardando índice…');
        else if (p.phase === 'done') setRescanMsg('Listo');
      });
      onIndexChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al reescanear');
    } finally {
      setRescanning(false);
      setRescanMsg('');
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };
  const formatDate = (iso: string) => iso
    ? new Date(iso).toLocaleDateString('es-MX', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <div className="files-modal-overlay" onClick={busyPath ? undefined : onClose}>
      <div className="files-modal" onClick={e => e.stopPropagation()}>
        <button className="files-modal-close" onClick={onClose} disabled={!!busyPath}>
          <X size={18} />
        </button>
        <header className="files-modal-header">
          <h3>Archivos en servidor</h3>
          <div className="files-modal-header-actions">
            <button className="files-action-btn" onClick={refresh} disabled={loading || !!busyPath || rescanning} title="Refrescar lista">
              <RefreshCw size={14} className={loading ? 'spin' : ''} />
            </button>
            <button
              className="files-action-btn files-action-btn-primary"
              onClick={handleRescan}
              disabled={loading || !!busyPath || rescanning}
              title="Procesa archivos nuevos o modificados y actualiza el índice"
            >
              {rescanning ? 'Reescaneando…' : 'Reescanear'}
            </button>
          </div>
        </header>

        <p className="files-modal-help">
          Lista de archivos Excel en el servidor. Borrar elimina el archivo y sus días del calendario.
        </p>

        {error && (
          <div className="files-modal-error">
            <AlertCircle size={14} />
            <span>{error}</span>
          </div>
        )}

        {rescanning && (
          <div className="files-modal-loading" style={{ padding: '12px 0' }}>
            <Loader size={16} className="spin" />
            <span>{rescanMsg}</span>
          </div>
        )}

        {loading ? (
          <div className="files-modal-loading">
            <Loader size={20} className="spin" />
            <span>Cargando archivos…</span>
          </div>
        ) : files.length === 0 ? (
          <div className="files-modal-empty">
            <p>No hay archivos en el servidor.</p>
          </div>
        ) : (
          <ul className="files-list">
            {files.map(sf => {
              const isBusy = busyPath === sf.fullPath;
              return (
                <li key={sf.fullPath} className={`files-list-item ${isBusy ? 'busy' : ''}`}>
                  <FileSpreadsheet size={18} className="fl-icon" />
                  <div className="fl-info">
                    <span className="fl-name">{sf.name}</span>
                    <span className="fl-meta">{formatSize(sf.size)} · {formatDate(sf.updated)}</span>
                  </div>
                  {isBusy ? (
                    <span className="fl-busy">Borrando…</span>
                  ) : (
                    <div className="fl-actions">
                      <button
                        className="fl-btn fl-btn-danger"
                        onClick={() => setConfirmDelete(sf)}
                        disabled={!!busyPath}
                        title="Borrar archivo"
                      >
                        <Trash2 size={13} />
                        <span>Borrar</span>
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {confirmDelete && (
          <div className="files-confirm-overlay" onClick={() => !busyPath && setConfirmDelete(null)}>
            <div className="files-confirm" onClick={e => e.stopPropagation()}>
              <h4>Borrar archivo</h4>
              <p>
                Vas a borrar <strong>{confirmDelete.name}</strong> y todos los días que aporta al
                calendario. Esta acción no se puede deshacer.
              </p>
              <div className="files-confirm-actions">
                <button className="conflict-btn conflict-cancel" onClick={() => setConfirmDelete(null)} disabled={!!busyPath}>
                  Cancelar
                </button>
                <button className="conflict-btn conflict-overwrite" onClick={() => handleDelete(confirmDelete)} disabled={!!busyPath}>
                  {busyPath ? 'Borrando…' : 'Borrar'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
