/**
 * CartSummaryBar — sticky bottom bar shown when cart has items.
 *
 * Usage:
 *   <CartSummaryBar slug={slug} lang={lang} currency="EUR" />
 *
 * Spec: sticky bottom-0 bg-black text-white px-4 py-3
 *       "{n} article(s) · {total}€  →  Voir le panier"
 */

import { Link } from 'react-router-dom';
import { ShoppingCart } from 'lucide-react';
import { useCart } from '../context/CartContext';

function formatPrice(amount, currency = 'EUR') {
  try {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} €`;
  }
}

export default function CartSummaryBar({ slug, lang = 'en', currency = 'EUR' }) {
  const { itemCount, total } = useCart();

  if (itemCount === 0) return null;

  const cartUrl = `/menu/${slug}/cart?lang=${lang}&currency=${currency}`;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-30 bg-black text-white px-4 py-3 safe-area-inset-bottom">
      <Link
        to={cartUrl}
        className="max-w-4xl mx-auto flex items-center justify-between gap-4"
      >
        <div className="flex items-center gap-3">
          <div className="relative">
            <ShoppingCart size={20} />
            <span className="absolute -top-2 -right-2 bg-white text-black text-xs font-bold w-4 h-4 rounded-full flex items-center justify-center leading-none">
              {itemCount}
            </span>
          </div>
          <span className="text-sm font-medium">
            {itemCount} article{itemCount > 1 ? 's' : ''}
            <span className="text-neutral-400 mx-2">·</span>
            {formatPrice(total, currency)}
          </span>
        </div>
        <span className="text-sm font-semibold flex items-center gap-1 whitespace-nowrap">
          Voir le panier →
        </span>
      </Link>
    </div>
  );
}
