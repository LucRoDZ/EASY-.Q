/**
 * Badge — pastille de statut (table, commande, abonnement…).
 *
 * variants : green | orange | red | blue | neutral
 */

const VARIANTS = {
  green: 'bg-green-100 text-green-700',
  orange: 'bg-amber-100 text-amber-700',
  red: 'bg-red-100 text-red-700',
  blue: 'bg-blue-100 text-blue-700',
  neutral: 'bg-neutral-100 text-neutral-600',
};

export default function Badge({ variant = 'neutral', className = '', children }) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1 text-xs font-medium px-2.5 py-0.5 rounded-full',
        VARIANTS[variant] || VARIANTS.neutral,
        className,
      ].join(' ')}
    >
      {children}
    </span>
  );
}
