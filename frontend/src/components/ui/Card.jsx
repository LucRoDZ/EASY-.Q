/**
 * Card — conteneur blanc arrondi standard du design system.
 */

export default function Card({ className = '', padding = 'p-5', children, ...props }) {
  return (
    <div
      className={['bg-white rounded-xl border border-neutral-200', padding, className].join(' ')}
      {...props}
    >
      {children}
    </div>
  );
}
