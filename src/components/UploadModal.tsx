import React, { useState, useRef, useCallback } from 'react';
import { Upload, AlertCircle, X } from 'lucide-react';
import { useExcelProcessor } from '../hooks/useExcelProcessor';
import { fileExists, uploadExcelFile, listExcelFiles } from '../services/storageService';
import { extractDaysFromBuffer, addFileToIndex, type DayIndexEntry } from '../services/daysIndex';
import { validateExcelFormat } from '../utils/excelValidator';
import type { ExcelUploadData } from '../types';
import './UploadModal.css';

type ConflictAction = 'overwrite' | 'rename' | 'cancel';

interface UploadModalProps {
  onClose: () => void;
  onSuccess: (entries: DayIndexEntry[], data: ExcelUploadData, fileName: string) => void;
}

export const UploadModal: React.FC<UploadModalProps> = ({ onClose, onSuccess }) => {
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [error, setError] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [conflict, setConflict] = useState<{ file: File; originalName: string } | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { procesarExcelBuffer } = useExcelProcessor();

  const processAndIndex = useCallback(async (buffer: ArrayBuffer, name: string) => {
    setLoading(true);
    setLoadingMsg(`Procesando ${name} (${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB)…`);
    const data = await procesarExcelBuffer(buffer, name);
    if (data.días.length === 0) {
      throw new Error('El archivo no contiene eventos válidos.');
    }
    setLoadingMsg(`Indexando ${data.días.length} día${data.días.length !== 1 ? 's' : ''}…`);
    const entries: DayIndexEntry[] = extractDaysFromBuffer(buffer, name);
    const list = await listExcelFiles();
    const sf = list.find(f => f.name === name);
    if (sf) {
      await addFileToIndex({ name: sf.name, size: sf.size, updated: sf.updated }, entries);
    }
    onSuccess(entries, data, name);
  }, [procesarExcelBuffer, onSuccess]);

  const handleLocalFile = async (file: File) => {
    setError('');
    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
      setError('Por favor carga un archivo Excel (.xlsx o .xls)');
      return;
    }
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
      setLoadingMsg('Verificando archivo…');
      const exists = await fileExists(file.name);
      if (exists) {
        setLoading(false);
        setLoadingMsg('');
        setConflict({ file, originalName: file.name });
        setRenameValue(file.name.replace(/(\.[^.]+)$/, '_copia$1'));
        return;
      }
      setLoadingMsg(`Subiendo ${file.name}…`);
      await uploadExcelFile(file);
      await processAndIndex(buffer, file.name);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error al subir el archivo.');
      setLoading(false);
      setLoadingMsg('');
    }
  };

  const handleConflict = async (action: ConflictAction) => {
    if (!conflict) return;
    if (action === 'cancel') { setConflict(null); return; }
    const uploadName = action === 'rename' ? renameValue : conflict.originalName;
    setConflict(null);
    setLoading(true);
    try {
      setLoadingMsg(`Subiendo ${uploadName}…`);
      await uploadExcelFile(conflict.file, uploadName);
      const buffer = await conflict.file.arrayBuffer();
      await processAndIndex(buffer, uploadName);
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
    e.preventDefault(); e.stopPropagation(); setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleLocalFile(file);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault(); e.stopPropagation(); setIsDragOver(true);
  };
  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault(); e.stopPropagation(); setIsDragOver(false);
  };

  return (
    <div className="upload-modal-overlay" onClick={loading ? undefined : onClose}>
      <div className="upload-modal" onClick={e => e.stopPropagation()}>
        <button className="upload-modal-close" onClick={onClose} disabled={loading}>
          <X size={18} />
        </button>
        <header className="upload-modal-header">
          <h3>Subir archivo nuevo</h3>
          <p>Excel con eventos del ATS. Se procesará y se indexarán los días automáticamente.</p>
        </header>

        <div
          className={`upload-modal-zone ${isDragOver ? 'drag-over' : ''} ${loading ? 'is-loading' : ''}`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => !loading && fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
        >
          <div className="upload-modal-icon">
            <Upload size={32} strokeWidth={1.5} />
          </div>
          <h4>Arrastra o haz clic</h4>
          <p>.xlsx · .xls</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={handleFileChange}
            disabled={loading}
            className="file-input-hidden"
            aria-hidden="true"
          />
        </div>

        {error && (
          <div className="upload-modal-error" role="alert">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        {loading && (
          <div className="upload-modal-loading">
            <div className="upload-spinner" />
            <span>{loadingMsg || 'Procesando…'}</span>
          </div>
        )}

        {conflict && (
          <div className="upload-modal-conflict">
            <h4>Archivo existente</h4>
            <p>Ya existe <strong>{conflict.originalName}</strong>. ¿Qué hacer?</p>
            <button className="conflict-btn conflict-overwrite" onClick={() => handleConflict('overwrite')}>
              Sobreescribir
            </button>
            <div className="conflict-rename-row">
              <input
                type="text"
                value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
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
        )}
      </div>
    </div>
  );
};
