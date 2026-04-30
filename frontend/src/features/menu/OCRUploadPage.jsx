import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Upload, X, FileText, AlertCircle, CheckCircle2 } from 'lucide-react';
import { api } from '../../api';

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB
const ACCEPTED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 90; // 3 minutes

function formatFileSize(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function OCRUploadPage() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const pollRef = useRef(null);

  const [file, setFile] = useState(null);
  const [restaurantName, setRestaurantName] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [menuId, setMenuId] = useState(null);
  const [ocrStatus, setOcrStatus] = useState(''); // "processing" | "ready" | "error"
  const [ocrError, setOcrError] = useState('');

  // Cleanup poll on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const validateFile = (f) => {
    if (!ACCEPTED_TYPES.includes(f.type)) {
      return 'Seuls les fichiers PDF, JPEG, PNG ou WebP sont acceptés.';
    }
    if (f.size > MAX_FILE_SIZE) {
      return `Fichier trop volumineux — max 20 MB (actuel: ${formatFileSize(f.size)})`;
    }
    return null;
  };

  const handleFileSelect = useCallback((f) => {
    const err = validateFile(f);
    if (err) {
      setUploadError(err);
      return;
    }
    setUploadError('');
    setFile(f);
    if (!restaurantName && f.name) {
      const base = f.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
      setRestaurantName(base.charAt(0).toUpperCase() + base.slice(1));
    }
  }, [restaurantName]);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFileSelect(f);
  }, [handleFileSelect]);

  const onDragOver = (e) => { e.preventDefault(); setDragOver(true); };
  const onDragLeave = () => setDragOver(false);

  const startPolling = (id) => {
    let attempts = 0;
    pollRef.current = setInterval(async () => {
      attempts++;
      if (attempts > MAX_POLL_ATTEMPTS) {
        clearInterval(pollRef.current);
        setOcrStatus('error');
        setOcrError("L'OCR a pris trop de temps. Veuillez réessayer.");
        return;
      }
      try {
        const data = await api.getMenuStatus(id);
        setOcrStatus(data.status);
        if (data.status === 'ready') {
          clearInterval(pollRef.current);
          navigate(`/menus/${id}/edit`);
        } else if (data.status === 'error') {
          clearInterval(pollRef.current);
          setOcrError(data.ocr_error || "Échec de l'OCR. Veuillez réessayer.");
        }
      } catch {
        // network glitch — keep polling
      }
    }, POLL_INTERVAL_MS);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) { setUploadError('Veuillez sélectionner un fichier.'); return; }
    if (!restaurantName.trim()) { setUploadError('Veuillez saisir le nom du restaurant.'); return; }

    setUploading(true);
    setUploadError('');

    try {
      const result = await api.uploadMenuAsync(restaurantName.trim(), file);
      setMenuId(result.menu_id);
      setOcrStatus(result.status);

      if (result.status === 'ready') {
        navigate(`/menus/${result.menu_id}/edit`);
      } else {
        startPolling(result.menu_id);
      }
    } catch (err) {
      setUploadError(err.message || "Échec de l'upload. Veuillez réessayer.");
      setUploading(false);
    }
  };

  const isProcessing = uploading || ocrStatus === 'processing';

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Header */}
      <header className="bg-black text-white sticky top-0 z-40">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-lg font-semibold tracking-tight">EASY.Q — Importer un menu</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-10">
        <div className="bg-white rounded-xl shadow-sm border border-neutral-200 p-8">
          <h2 className="text-xl font-semibold text-neutral-900 mb-1">
            Importer votre carte
          </h2>
          <p className="text-sm text-neutral-500 mb-6">
            Déposez un PDF ou une image de votre menu. L'IA extraira automatiquement les plats, prix et allergènes.
          </p>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Restaurant name */}
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1.5">
                Nom du restaurant
              </label>
              <input
                type="text"
                value={restaurantName}
                onChange={(e) => setRestaurantName(e.target.value)}
                placeholder="Ex: Le Petit Bistrot"
                disabled={isProcessing}
                className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent disabled:bg-neutral-50 disabled:text-neutral-400"
              />
            </div>

            {/* Drop zone */}
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1.5">
                Fichier menu (PDF, JPEG, PNG, WebP — max 20 MB)
              </label>
              <button
                type="button"
                disabled={isProcessing}
                onClick={() => fileInputRef.current?.click()}
                onDrop={onDrop}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                className={[
                  'w-full border-2 border-dashed rounded-lg p-8 text-center transition-colors',
                  dragOver
                    ? 'border-neutral-700 bg-neutral-50'
                    : 'border-neutral-200 bg-white hover:border-neutral-400',
                  isProcessing ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
                ].join(' ')}
              >
                {file ? (
                  <div className="flex items-center justify-center gap-3">
                    <FileText className="h-8 w-8 text-neutral-500 shrink-0" />
                    <div className="text-left">
                      <p className="text-sm font-medium text-neutral-800 truncate max-w-xs">{file.name}</p>
                      <p className="text-xs text-neutral-400">{formatFileSize(file.size)}</p>
                    </div>
                    {!isProcessing && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setFile(null); setUploadError(''); }}
                        className="ml-2 text-neutral-400 hover:text-neutral-600"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ) : (
                  <div>
                    <Upload className="h-10 w-10 text-neutral-300 mx-auto mb-3" />
                    <p className="text-sm text-neutral-600 font-medium">
                      Glissez-déposez ou <span className="underline">parcourir</span>
                    </p>
                    <p className="text-xs text-neutral-400 mt-1">PDF · JPEG · PNG · WebP</p>
                  </div>
                )}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.webp"
                className="hidden"
                onChange={(e) => { if (e.target.files?.[0]) handleFileSelect(e.target.files[0]); }}
              />
            </div>

            {/* Error */}
            {uploadError && (
              <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2.5">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                {uploadError}
              </div>
            )}

            {/* OCR progress */}
            {ocrStatus === 'processing' && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-neutral-600">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Extraction du menu en cours (IA Gemini)…
                </div>
                {/* indeterminate progress bar */}
                <div className="h-1.5 bg-neutral-100 rounded-full overflow-hidden">
                  <div className="h-full bg-neutral-800 rounded-full animate-pulse w-2/3" />
                </div>
              </div>
            )}

            {/* OCR error */}
            {ocrStatus === 'error' && (
              <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2.5">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                {ocrError}
              </div>
            )}

            {/* OCR ready (edge: cached hit, redirect pending) */}
            {ocrStatus === 'ready' && (
              <div className="flex items-center gap-2 text-sm text-neutral-700">
                <CheckCircle2 className="h-4 w-4 text-neutral-600" />
                Menu extrait — redirection…
              </div>
            )}

            {/* Submit */}
            {!isProcessing && ocrStatus !== 'error' && (
              <button
                type="submit"
                disabled={!file || !restaurantName.trim()}
                className="w-full bg-black text-white rounded-full py-2.5 text-sm font-medium hover:bg-neutral-800 disabled:bg-neutral-200 disabled:text-neutral-400 transition-colors"
              >
                Importer et analyser
              </button>
            )}

            {/* Retry after error */}
            {ocrStatus === 'error' && (
              <button
                type="button"
                onClick={() => { setOcrStatus(''); setOcrError(''); setMenuId(null); setFile(null); }}
                className="w-full bg-black text-white rounded-full py-2.5 text-sm font-medium hover:bg-neutral-800 transition-colors"
              >
                Réessayer
              </button>
            )}
          </form>
        </div>
      </main>
    </div>
  );
}
