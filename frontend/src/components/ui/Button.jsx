/**
 * Button — bouton standardisé EASY.Q.
 *
 * variants : primary (noir) | secondary (bordure) | danger | ghost
 * sizes    : sm | md | lg
 */

const VARIANTS = {
  primary: 'bg-black text-white hover:bg-neutral-800',
  secondary: 'bg-white text-neutral-900 border border-neutral-300 hover:border-neutral-500',
  danger: 'bg-red-600 text-white hover:bg-red-700',
  ghost: 'bg-transparent text-neutral-600 hover:bg-neutral-100',
};

const SIZES = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-5 py-2.5 text-sm',
  lg: 'px-6 py-3.5 text-base',
};

export default function Button({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  className = '',
  children,
  ...props
}) {
  return (
    <button
      className={[
        'inline-flex items-center justify-center gap-2 rounded-full font-medium transition-colors',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        VARIANTS[variant] || VARIANTS.primary,
        SIZES[size] || SIZES.md,
        fullWidth ? 'w-full' : '',
        className,
      ].join(' ')}
      {...props}
    >
      {children}
    </button>
  );
}
