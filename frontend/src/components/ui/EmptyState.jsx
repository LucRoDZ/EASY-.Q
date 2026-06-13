/**
 * EmptyState — état vide générique : icône + titre + description + CTA optionnel.
 */

export default function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center px-4">
      {Icon && (
        <div className="w-16 h-16 bg-neutral-100 rounded-2xl flex items-center justify-center mb-5">
          <Icon size={28} className="text-neutral-400" />
        </div>
      )}
      <h2 className="text-lg font-semibold text-neutral-900 mb-1">{title}</h2>
      {description && (
        <p className="text-sm text-neutral-500 max-w-xs mb-6">{description}</p>
      )}
      {action}
    </div>
  );
}
