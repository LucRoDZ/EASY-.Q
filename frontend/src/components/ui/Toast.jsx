/**
 * Toast + ToastProvider + useToast — remplace les alert() natifs.
 *
 * Usage :
 *   const toast = useToast();
 *   toast.success('Commande envoyée');
 *   toast.error('Erreur réseau');
 *
 * Stack en bas à droite, auto-dismiss 3s.
 */

import { createContext, useCallback, useContext, useState } from 'react';
import { CheckCircle, AlertCircle, Info, X } from 'lucide-react';

const ToastContext = createContext(null);

const VARIANTS = {
  success: { icon: CheckCircle, classes: 'bg-neutral-900 text-white' },
  error: { icon: AlertCircle, classes: 'bg-red-600 text-white' },
  info: { icon: Info, classes: 'bg-white text-neutral-900 border border-neutral-200' },
};

const AUTO_DISMISS_MS = 3000;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((variant, message) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, variant, message }]);
    setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
  }, [dismiss]);

  const api = {
    success: (msg) => push('success', msg),
    error: (msg) => push('error', msg),
    info: (msg) => push('info', msg),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] space-y-2 max-w-sm" aria-live="polite">
        {toasts.map(({ id, variant, message }) => {
          const { icon: Icon, classes } = VARIANTS[variant] || VARIANTS.info;
          return (
            <div
              key={id}
              role="status"
              className={`flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-lg text-sm ${classes}`}
            >
              <Icon size={16} className="shrink-0" />
              <span className="flex-1">{message}</span>
              <button
                onClick={() => dismiss(id)}
                aria-label="Fermer"
                className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Hors provider (tests, pages isolées) : fallback silencieux sur console
    return {
      success: (m) => console.info('[toast]', m),
      error: (m) => console.error('[toast]', m),
      info: (m) => console.info('[toast]', m),
    };
  }
  return ctx;
}
