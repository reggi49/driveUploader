'use client';

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';

type UploadStatus = 'idle' | 'uploading' | 'success' | 'error';

type BackendDebug = {
  folderId?: string;
  folderCheck?: { id?: string; name?: string; trashed?: boolean } | null;
  projectId?: string;
  clientEmail?: string;
  sessionCreatedAt?: string;
  fileType?: string;
};

type UploadSessionResponse = {
  uploadUrl: string;
  folderId?: string;
  error?: string;
  details?: unknown;
  debug?: BackendDebug;
};

type FolderItem = {
  id: string;
  name: string;
};

type FileEntry = {
  id: string;
  file: File;
  status: UploadStatus;
  progress: number;
  error?: string;
};

const formatBytes = (bytes: number) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
};

export default function FileUploader() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [isUploadingBatch, setIsUploadingBatch] = useState(false);
  const [message, setMessage] = useState('');
  const [backendDebug, setBackendDebug] = useState<BackendDebug | null>(null);
  const lastUploadUrlRef = useRef<string>('');
  const lastProgressRef = useRef(0);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [foldersLoading, setFoldersLoading] = useState(false);
  const [foldersError, setFoldersError] = useState('');
  const [selectedFolderId, setSelectedFolderId] = useState('');
  const [newFolderName, setNewFolderName] = useState('');
  const [resolvedFolderId, setResolvedFolderId] = useState('');
  const [debugInfo, setDebugInfo] = useState({
    contentType: '',
    sessionRequestedAt: '',
    sessionReceivedAt: '',
    uploadStartedAt: '',
    uploadFinishedAt: '',
    uploadUrl: '',
    uploadUrlReused: false
  });

  useEffect(() => {
    let active = true;

    const loadFolders = async () => {
      try {
        setFoldersLoading(true);
        setFoldersError('');
        const response = await fetch('/api/folders');
        const payload = (await response.json().catch(() => ({}))) as {
          folders?: FolderItem[];
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error || 'Failed to load folders.');
        }

        if (active) {
          setFolders(payload.folders || []);
        }
      } catch (error) {
        if (active) {
          const messageText = error instanceof Error ? error.message : 'Failed to load folders.';
          setFoldersError(messageText);
        }
      } finally {
        if (active) {
          setFoldersLoading(false);
        }
      }
    };

    void loadFolders();

    return () => {
      active = false;
    };
  }, []);

  const createFileEntry = (file: File): FileEntry => {
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    return {
      id,
      file,
      status: 'idle',
      progress: 0
    };
  };

  const addFiles = (fileList: FileList | File[]) => {
    const next = Array.from(fileList).map(createFileEntry);
    if (next.length === 0) return;
    setFiles((prev) => [...prev, ...next]);
  };

  const updateFile = useCallback((id: string, updates: Partial<FileEntry>) => {
    setFiles((prev) => prev.map((entry) => (entry.id === id ? { ...entry, ...updates } : entry)));
  }, []);

  const resetState = () => {
    setMessage('');
    setBackendDebug(null);
    lastProgressRef.current = 0;
    setDebugInfo({
      contentType: '',
      sessionRequestedAt: '',
      sessionReceivedAt: '',
      uploadStartedAt: '',
      uploadFinishedAt: '',
      uploadUrl: '',
      uploadUrlReused: false
    });
  };

  const createUploadSession = async (
    file: File,
    destination?: { folderId?: string; newFolderName?: string }
  ) => {
    setDebugInfo((prev) => ({
      ...prev,
      contentType: file.type || 'application/octet-stream',
      sessionRequestedAt: new Date().toISOString()
    }));

    const rawNewFolderName =
      destination && Object.prototype.hasOwnProperty.call(destination, 'newFolderName')
        ? destination.newFolderName
        : newFolderName;
    const trimmedNewFolderName = (rawNewFolderName ?? '').trim();
    const folderIdToSend =
      trimmedNewFolderName.length > 0
        ? undefined
        : (destination?.folderId ?? selectedFolderId || undefined);

    const response = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: file.name,
        fileType: file.type || 'application/octet-stream',
        fileSize: file.size,
        folderId: folderIdToSend,
        newFolderName: trimmedNewFolderName || undefined
      })
    });

    const payload = (await response.json().catch(() => ({}))) as UploadSessionResponse;

    if (!response.ok) {
      throw new Error(payload.error || 'Failed to create upload session.');
    }

    if (!payload.uploadUrl) {
      throw new Error('Missing uploadUrl from server.');
    }

    setBackendDebug(payload.debug ?? null);

    setDebugInfo((prev) => ({
      ...prev,
      uploadUrl: payload.uploadUrl,
      sessionReceivedAt: new Date().toISOString(),
      uploadUrlReused: payload.uploadUrl === lastUploadUrlRef.current
    }));

    lastUploadUrlRef.current = payload.uploadUrl;

    if (payload.folderId && trimmedNewFolderName) {
      setResolvedFolderId(payload.folderId);
    }

    return { uploadUrl: payload.uploadUrl, folderId: payload.folderId };
  };

  const uploadWithXhr = (uploadUrl: string, entry: FileEntry) => {
    return new Promise<void>((resolve, reject) => {
      const { file, id } = entry;
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', uploadUrl, true);
      
      // 1. DISABLE COOKIES (Mandatory to avoid 403)
      xhr.withCredentials = false; 

      // 2. MIME TYPE TRICK: Send as 'application/octet-stream' (raw data).
      // This prevents Browser & Google matching strict mime-types.
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');

      setDebugInfo((prev) => ({
        ...prev,
        uploadStartedAt: new Date().toISOString()
      }));

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const percent = Math.round((event.loaded / event.total) * 100);
          lastProgressRef.current = percent;
          updateFile(id, { progress: percent });
        }
      };

      xhr.onerror = () => {
        setDebugInfo((prev) => ({
          ...prev,
          uploadFinishedAt: new Date().toISOString()
        }));

        if (lastProgressRef.current >= 100) {
          updateFile(id, { status: 'success', progress: 100, error: undefined });
          resolve();
          return;
        }

        // Pure network error (internet lost or hard CORS block)
        console.error('Network Error (xhr.status=0)');
        updateFile(id, { status: 'error', error: 'Network error: CORS blocked or connection lost.' });
        setMessage('Network error: CORS blocked or connection lost.');
        reject(new Error('Network error.'));
      };

      xhr.onload = () => {
        setDebugInfo((prev) => ({
          ...prev,
          uploadFinishedAt: new Date().toISOString()
        }));

        // Status 200-399 = Success
        if (xhr.status >= 200 && xhr.status < 400) {
          updateFile(id, { status: 'success', progress: 100, error: undefined });
          resolve();
          return;
        }

        // Catch detailed Google error
        console.error('Google Upload Failed:', xhr.status, xhr.responseText);
        updateFile(id, { status: 'error', error: `Upload failed: Server returned ${xhr.status}` });
        setMessage(`Upload failed: Server returned ${xhr.status}`);
        reject(new Error(xhr.responseText || 'Upload failed.'));
      };

      xhr.send(file);
    });
  };

  const handleUploadAll = async () => {
    if (files.length === 0 || isUploadingBatch) return;

    resetState();
    setIsUploadingBatch(true);
    setMessage('');

    let batchFolderId = resolvedFolderId;
    const trimmedNewFolderName = newFolderName.trim();

    for (const entry of files) {
      if (entry.status === 'success') {
        continue;
      }

      updateFile(entry.id, { status: 'uploading', progress: 0, error: undefined });
      lastProgressRef.current = 0;

      const destination =
        trimmedNewFolderName.length > 0
          ? batchFolderId
            ? { folderId: batchFolderId, newFolderName: '' }
            : { newFolderName: trimmedNewFolderName }
          : selectedFolderId
            ? { folderId: selectedFolderId, newFolderName: '' }
            : undefined;

      try {
        const session = await createUploadSession(entry.file, destination);
        if (trimmedNewFolderName.length > 0 && !batchFolderId && session.folderId) {
          batchFolderId = session.folderId;
          setResolvedFolderId(session.folderId);
        }
        await uploadWithXhr(session.uploadUrl, entry);
      } catch (error) {
        const messageText = error instanceof Error ? error.message : 'Upload failed.';
        updateFile(entry.id, { status: 'error', error: messageText });
        setMessage(messageText);
      }
    }

    setIsUploadingBatch(false);
  };

  const handleFileSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files;
    if (!selected || selected.length === 0) return;
    addFiles(selected);
    event.target.value = '';
  };

  const handleDrag = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (event.type === 'dragenter' || event.type === 'dragover') {
      setIsDragging(true);
    } else if (event.type === 'dragleave') {
      setIsDragging(false);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);

    const dropped = event.dataTransfer.files;
    if (dropped && dropped.length > 0) {
      addFiles(dropped);
    }
  };

  const parseTime = (iso: string) => (iso ? Date.parse(iso) : null);
  const sessionRequestedMs = parseTime(debugInfo.sessionRequestedAt);
  const sessionReceivedMs = parseTime(debugInfo.sessionReceivedAt);
  const uploadStartedMs = parseTime(debugInfo.uploadStartedAt);
  const uploadFinishedMs = parseTime(debugInfo.uploadFinishedAt);

  const sessionRttMs =
    sessionRequestedMs && sessionReceivedMs ? sessionReceivedMs - sessionRequestedMs : null;
  const uploadDelayMs =
    sessionReceivedMs && uploadStartedMs ? uploadStartedMs - sessionReceivedMs : null;
  const uploadDurationMs =
    uploadStartedMs && uploadFinishedMs ? uploadFinishedMs - uploadStartedMs : null;

  const formatDuration = (ms: number | null) => {
    if (ms === null) return '—';
    if (ms < 1000) return `${ms} ms`;
    return `${(ms / 1000).toFixed(2)} s`;
  };

  const statusDotClass = (fileStatus: UploadStatus) => {
    switch (fileStatus) {
      case 'success':
        return 'bg-emerald-400';
      case 'error':
        return 'bg-rose-400';
      case 'uploading':
        return 'bg-sky-400';
      default:
        return 'bg-slate-400';
    }
  };

  const isNewFolderActive = newFolderName.trim().length > 0;
  const overallStatus: UploadStatus = isUploadingBatch
    ? 'uploading'
    : files.length === 0
      ? 'idle'
      : files.some((entry) => entry.status === 'error')
        ? 'error'
        : files.every((entry) => entry.status === 'success')
          ? 'success'
          : 'idle';
  const canUpload = files.length > 0 && !isUploadingBatch;

  return (
    <section className="rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl shadow-black/40 backdrop-blur">
      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Existing folder</p>
          <select
            className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
            value={selectedFolderId}
            onChange={(event) => {
              setSelectedFolderId(event.target.value);
              if (event.target.value) {
                setNewFolderName('');
                setResolvedFolderId('');
              }
            }}
            disabled={isNewFolderActive || isUploadingBatch || foldersLoading}
          >
            <option value="">Upload to root folder</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </select>
          {foldersLoading && <p className="text-xs text-slate-400">Loading folders…</p>}
          {foldersError && <p className="text-xs text-rose-300">{foldersError}</p>}
        </div>
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Create new folder</p>
          <input
            type="text"
            className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
            placeholder="Optional: New folder name"
            value={newFolderName}
            onChange={(event) => {
              setNewFolderName(event.target.value);
              setResolvedFolderId('');
              if (event.target.value.trim().length > 0) {
                setSelectedFolderId('');
              }
            }}
            disabled={isUploadingBatch}
          />
          <p className="text-xs text-slate-500">
            If filled, the file will be uploaded into the new folder.
          </p>
        </div>
      </div>

      <div
        className={`mt-8 flex min-h-[280px] flex-col items-center justify-center gap-6 rounded-2xl border border-dashed px-6 py-10 text-center transition ${
          isDragging ? 'border-cyan-300/70 bg-cyan-400/10' : 'border-white/15 bg-white/5'
        }`}
        onDragEnter={handleDrag}
        onDragOver={handleDrag}
        onDragLeave={handleDrag}
        onDrop={handleDrop}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileSelect}
          disabled={isUploadingBatch}
        />
        <div className="space-y-3">
          <p className="text-lg font-medium text-white">Drop your files here</p>
          <p className="text-sm text-slate-300">
            Large files are sent directly to Google Drive using a resumable upload session.
          </p>
        </div>
        <button
          type="button"
          className="rounded-full border border-white/20 bg-white/10 px-6 py-2 text-sm font-semibold text-white transition hover:border-white/40 hover:bg-white/20"
          onClick={() => inputRef.current?.click()}
          disabled={isUploadingBatch}
        >
          {isUploadingBatch ? 'Uploading...' : 'Select files'}
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="rounded-full border border-emerald-400/40 bg-emerald-500/20 px-6 py-2 text-sm font-semibold text-emerald-100 transition hover:border-emerald-300/60 hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-400"
          onClick={handleUploadAll}
          disabled={!canUpload}
        >
          {isUploadingBatch ? 'Uploading...' : 'Upload All'}
        </button>
        <span className="text-xs uppercase tracking-[0.2em] text-slate-400">
          {files.length} file{files.length === 1 ? '' : 's'} selected
        </span>
      </div>

      <div className="mt-6 space-y-4">
        <div className="flex items-center justify-between text-sm text-slate-300">
          <span className="font-mono text-xs uppercase tracking-[0.2em]">Upload status</span>
          <span className="text-xs uppercase tracking-[0.2em]">
            {overallStatus === 'idle' && 'Waiting'}
            {overallStatus === 'uploading' && 'Uploading'}
            {overallStatus === 'success' && 'Complete'}
            {overallStatus === 'error' && 'Error'}
          </span>
        </div>

        <div className="space-y-3">
          {files.length === 0 ? (
            <p className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-400">
              No files selected yet. Add files above, then click Upload All.
            </p>
          ) : (
            files.map((entry) => (
              <div key={entry.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <span
                      className={`mt-1 h-2.5 w-2.5 rounded-full ${statusDotClass(entry.status)}`}
                    />
                    <div>
                      <p className="text-sm text-white">{entry.file.name}</p>
                      <p className="text-xs text-slate-400">{formatBytes(entry.file.size)}</p>
                    </div>
                  </div>
                  <span className="text-xs uppercase tracking-[0.2em] text-slate-400">
                    {entry.status}
                  </span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-sky-400 to-emerald-400 transition-all"
                    style={{ width: `${entry.progress}%` }}
                  />
                </div>
                {entry.error && entry.status === 'error' && (
                  <p className="mt-2 text-xs text-rose-300">{entry.error}</p>
                )}
              </div>
            ))
          )}
        </div>

        {message && (
          <p
            className={`rounded-xl border px-4 py-3 text-sm ${
              overallStatus === 'success'
                ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-100'
                : 'border-rose-400/40 bg-rose-500/10 text-rose-100'
            }`}
          >
            {message}
          </p>
        )}

        <div className="rounded-2xl border border-white/10 bg-black/30 p-4 text-xs text-slate-200">
          <p className="font-mono uppercase tracking-[0.2em] text-slate-400">Debug panel</p>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <div>
              <span className="text-slate-400">Content-Type:</span> {debugInfo.contentType || '—'}
            </div>
            <div>
              <span className="text-slate-400">Upload URL:</span>{' '}
              <span className="break-all">{debugInfo.uploadUrl || '—'}</span>
            </div>
            <div>
              <span className="text-slate-400">Upload URL reused:</span>{' '}
              {debugInfo.uploadUrl ? (debugInfo.uploadUrlReused ? 'Yes' : 'No') : '—'}
            </div>
            <div>
              <span className="text-slate-400">Session RTT:</span> {formatDuration(sessionRttMs)}
            </div>
            <div>
              <span className="text-slate-400">Upload delay:</span> {formatDuration(uploadDelayMs)}
            </div>
            <div>
              <span className="text-slate-400">Upload duration:</span> {formatDuration(uploadDurationMs)}
            </div>
            <div>
              <span className="text-slate-400">Session requested:</span>{' '}
              {debugInfo.sessionRequestedAt || '—'}
            </div>
            <div>
              <span className="text-slate-400">Session received:</span>{' '}
              {debugInfo.sessionReceivedAt || '—'}
            </div>
            <div>
              <span className="text-slate-400">Upload started:</span>{' '}
              {debugInfo.uploadStartedAt || '—'}
            </div>
            <div>
              <span className="text-slate-400">Upload finished:</span>{' '}
              {debugInfo.uploadFinishedAt || '—'}
            </div>
            <div>
              <span className="text-slate-400">Folder ID:</span> {backendDebug?.folderId || '—'}
            </div>
            <div>
              <span className="text-slate-400">Folder name:</span>{' '}
              {backendDebug?.folderCheck?.name || '—'}
            </div>
            <div>
              <span className="text-slate-400">Backend fileType:</span>{' '}
              {backendDebug?.fileType || '—'}
            </div>
            <div>
              <span className="text-slate-400">Service account:</span>{' '}
              {backendDebug?.clientEmail || '—'}
            </div>
            <div>
              <span className="text-slate-400">Session created (server):</span>{' '}
              {backendDebug?.sessionCreatedAt || '—'}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
