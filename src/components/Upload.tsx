import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Upload, AlertCircle, FileSpreadsheet, FolderOpen, Loader, RefreshCw, X } from 'lucide-react';
import { useExcelProcessor } from '../hooks/useExcelProcessor';
import type { ExcelUploadData } from '../types';
import { listExcelFiles, fileExists, uploadExcelFile, downloadExcelFile } from '../services/storageService';
import type { StorageFile } from '../services/storageService';
import { validateExcelFormat } from '../utils/excelValidator';
import './Upload.css';

interface UploadProps {
  onDataLoaded: (data: ExcelUploadData) => void;
  onLogout: () => void;
  embedded?: boolean;
}

type ConflictAction = 'overwrite' | 'rename' | 'cancel';

interface ConflictState {
  file: File;
  originalName: string;
}

export const UploadComponent: React.FC<UploadProps> = ({ onDataLoaded, onLogout, embedded }) => {
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [error, setError] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { procesarExcel } = useExcelProcessor();

  // Storage files
  const [storageFiles, setStorageFiles] = useState<StorageFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(true);
  const [storageError, setStorageError] = useState('');

  // Conflict dialog
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Load files from storage on mount
  const refreshFiles = useCallback(async () => {
    setLoadingFiles(true);
    setStorageError('');
    try {
      const files = await listExcelFiles();
      setStorageFiles(files);
    } catch (err) {
      console.error('Error loading files:', err);
      setStorageError(err instanceof Error ? err.message : 'Error al cargar archivos del servidor');
    } finally {
      setLoadingFiles(false);
    }
  }, []);

  useEffect(() => { refreshFiles(); }, [refreshFiles]);

  // Process a file (from local or from storage download)
  const processBuffer = async (buffer: ArrayBuffer, name: string) => {
    setError('');
    setLoading(true);
    setLoadingMsg(`Procesando ${name}…`);
    try {
      const file = new File([buffer], name);
      const data = await procesarExcel(file);
      if (data.días.length === 0) {
        setError('El archivo no contiene eventos válidos.');
        return;
      }
      onDataLoaded(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error al procesar el archivo.');
    } finally {
      setLoading(false);
      setLoadingMsg('');
    }
  };

  // Handle selecting a file from Storage
  const handleSelectStorageFile = async (sf: StorageFile) => {
    setError('');
    setLoading(true);
    setLoadingMsg(`Descargando ${sf.name}…`);
    try {
      const buffer = await downloadExcelFile(sf.fullPath);
      await processBuffer(buffer, sf.name);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error al descargar el archivo.');
      setLoading(false);
      setLoadingMsg('');
    }
  };

  // Handle uploading a new local file
  const handleLocalFile = async (file: File) => {
    setError('');
    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
      setError('Por favor carga un archivo Excel (.xlsx o .xls)');
      return;
    }

    // Validate format BEFORE uploading
    setLoading(true);
    setLoadingMsg('Validando formato…');
    try {
      const buffer = await file.arrayBuffer();
      const validation = validateExcelFormat(buffer);
      if (!validation.valid) {
        setError(validation.error);
        setLoading(false);
        setLoadingMsg('');
        return;
      }

      // Check if exists in storage
      setLoadingMsg('Verificando archivo…');
      const exists = await fileExists(file.name);
      if (exists) {
        setLoading(false);
        setLoadingMsg('');
        setConflict({ file, originalName: file.name });
        setRenameValue(file.name.replace(/(\.[^.]+)$/, '_copia$1'));
        return;
      }

      // Upload and process
      setLoadingMsg(`Subiendo ${file.name}…`);
      await uploadExcelFile(file);
      await refreshFiles();
      await processBuffer(buffer, file.name);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error al subir el archivo.');
      setLoading(false);
      setLoadingMsg('');
    }
  };

  // Handle conflict resolution
  const handleConflict = async (action: ConflictAction) => {
    if (!conflict) return;

    if (action === 'cancel') {
      setConflict(null);
      return;
    }

    setConflict(null);
    setLoading(true);

    try {
      const uploadName = action === 'rename' ? renameValue : conflict.originalName;
      setLoadingMsg(`Subiendo ${uploadName}…`);
      await uploadExcelFile(conflict.file, uploadName);
      await refreshFiles();
      const buffer = await conflict.file.arrayBuffer();
      await processBuffer(buffer, uploadName);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error al subir el archivo.');
      setLoading(false);
      setLoadingMsg('');
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleLocalFile(file);
  };

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleLocalFile(file);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault(); e.stopPropagation(); setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault(); e.stopPropagation(); setIsDragOver(false);
  }, []);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (iso: string) => {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('es-MX', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className={`upload-container ${embedded ? 'upload-embedded' : ''}`}>
      {!embedded && (
        <nav className="upload-nav">
          <div className="upload-nav-brand">
            <FileSpreadsheet size={22} />
            <span>STC Operación</span>
          </div>
          <button onClick={onLogout} className="logout-btn" aria-label="Cerrar sesión">
            Cerrar Sesión
          </button>
        </nav>
      )}

      <div className="upload-content">
        <div className="upload-card upload-card-wide">
          <div className="upload-card-header">
            <h1>Archivos de Operación</h1>
            <p>Selecciona un archivo existente o carga uno nuevo</p>
          </div>

          <div className="upload-two-panel">
            {/* Left: Storage files */}
            <div className="storage-panel">
              <div className="storage-panel-header">
                <h2><FolderOpen size={16} /> Archivos en servidor</h2>
                <button className="refresh-btn" onClick={refreshFiles} disabled={loadingFiles} title="Refrescar">
                  <RefreshCw size={14} className={loadingFiles ? 'spin' : ''} />
                </button>
              </div>

              {loadingFiles ? (
                <div className="storage-loading">
                  <Loader size={20} className="spin" />
                  <span>Cargando archivos…</span>
                </div>
              ) : storageError ? (
                <div className="upload-error" style={{ margin: 0 }}>
                  <AlertCircle size={16} />
                  <span>{storageError}</span>
                </div>
              ) : storageFiles.length === 0 ? (
                <div className="storage-empty">
                  <p>No hay archivos en el servidor</p>
                </div>
              ) : (
                <div className="storage-file-list">
                  {storageFiles.map(sf => (
                    <button
                      key={sf.fullPath}
                      className="storage-file-item"
                      onClick={() => handleSelectStorageFile(sf)}
                      disabled={loading}
                    >
                      <FileSpreadsheet size={18} className="sf-icon" />
                      <div className="sf-info">
                        <span className="sf-name">{sf.name}</span>
                        <span className="sf-meta">{formatSize(sf.size)} · {formatDate(sf.updated)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Right: Upload zone */}
            <div className="upload-panel">
              <div
                className={`upload-zone ${isDragOver ? 'drag-over' : ''} ${loading ? 'is-loading' : ''}`}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onClick={() => fileInputRef.current?.click()}
                role="button"
                tabIndex={0}
                aria-label="Subir archivo nuevo"
              >
                <div className="upload-zone-icon">
                  <Upload size={32} strokeWidth={1.5} />
                </div>
                <h2>Subir archivo nuevo</h2>
                <p>Arrastra o haz clic para seleccionar</p>
                <span className="upload-zone-formats">.xlsx · .xls</span>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleFileChange}
                  disabled={loading}
                  className="file-input-hidden"
                  id="file-input"
                  aria-hidden="true"
                />
              </div>
            </div>
          </div>

          {error && (
            <div className="upload-error" role="alert">
              <AlertCircle size={18} />
              <span>{error}</span>
            </div>
          )}

          {loading && (
            <div className="upload-loading">
              <div className="upload-spinner" />
              <div className="upload-loading-text">
                <p className="upload-loading-title">{loadingMsg || 'Procesando…'}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Conflict dialog */}
      {conflict && (
        <div className="conflict-overlay">
          <div className="conflict-dialog">
            <button className="conflict-close" onClick={() => setConflict(null)}><X size={18} /></button>
            <h3>Archivo existente</h3>
            <p>Ya existe un archivo con el nombre <strong>{conflict.originalName}</strong>.</p>
            <p>¿Qué deseas hacer?</p>

            <div className="conflict-actions">
              <button className="conflict-btn conflict-overwrite" onClick={() => handleConflict('overwrite')}>
                Sobreescribir
              </button>
              <div className="conflict-rename-row">
                <input
                  type="text"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  className="conflict-rename-input"
                />
                <button className="conflict-btn conflict-rename" onClick={() => handleConflict('rename')}>
                  Guardar con este nombre
                </button>
              </div>
              <button className="conflict-btn conflict-cancel" onClick={() => handleConflict('cancel')}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
