/**
 * ConfirmDialog — confirmation pour actions destructives (remplace confirm()).
 *
 * Usage :
 *   const [open, setOpen] = useState(false);
 *   <ConfirmDialog
 *     open={open}
 *     title="Supprimer la table ?"
 *     description="Cette action est irréversible."
 *     confirmLabel="Supprimer"
 *     onConfirm={() => { ... }}
 *     onCancel={() => setOpen(false)}
 *   />
 */

import { AlertTriangle } from 'lucide-react';
import Button from './Button';

export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirmer',
  cancelLabel = 'Annuler',
  danger = true,
  onConfirm,
  onCancel,
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center px-4">
      <button
        type="button"
        aria-label="Fermer"
        onClick={onCancel}
        className="absolute inset-0 bg-black/40"
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="relative bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 space-y-4"
      >
        <div className="flex items-start gap-3">
          {danger && (
            <div className="p-2 bg-red-50 rounded-full shrink-0">
              <AlertTriangle size={18} className="text-red-600" />
            </div>
          )}
          <div>
            <h2 id="confirm-dialog-title" className="font-semibold text-neutral-900">
              {title}
            </h2>
            {description && <p className="text-sm text-neutral-500 mt-1">{description}</p>}
          </div>
        </div>
        <div className="flex gap-3 justify-end">
          <Button variant="secondary" size="md" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} size="md" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
