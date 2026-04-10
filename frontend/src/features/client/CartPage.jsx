import { useParams, useSearchParams, Link, useNavigate } from 'react-router-dom';
import { Minus, Plus, Trash2, ArrowLeft, ShoppingBag } from 'lucide-react';
import { useCart } from '../../context/CartContext';
import { t } from '../../localization/translations';

function formatPrice(price, currency) {
  if (price == null) return '';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'EUR',
    }).format(price);
  } catch {
    return `${price}`;
  }
}

export default function CartPage() {
  const { slug } = useParams();
  const [searchParams] = useSearchParams();
  const lang = searchParams.get('lang') || 'fr';
  const currency = searchParams.get('currency') || 'EUR';
  const navigate = useNavigate();

  const { items, updateQuantity, removeItem, total, itemCount } = useCart();

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="bg-black text-white sticky top-0 z-40">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link
              to={`/menu/${slug}?lang=${lang}`}
              className="flex items-center gap-2 text-neutral-400 hover:text-white transition-colors"
            >
              <ArrowLeft className="h-5 w-5" />
              <span className="text-sm">{t(lang, 'menu')}</span>
            </Link>
            <h1 className="text-xl font-semibold tracking-tight">{t(lang, 'yourCart')}</h1>
            <div className="w-16" />
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6">
        {items.length === 0 ? (
          <div className="text-center py-16">
            <ShoppingBag className="h-16 w-16 text-neutral-300 mx-auto mb-4" />
            <p className="text-neutral-500 text-lg mb-6">{t(lang, 'emptyCart')}</p>
            <Link
              to={`/menu/${slug}?lang=${lang}`}
              className="inline-flex items-center gap-2 bg-black text-white px-6 py-3 rounded-full font-medium hover:bg-neutral-800 transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              {t(lang, 'browseMenu')}
            </Link>
          </div>
        ) : (
          <>
            <div className="bg-white rounded-xl border border-neutral-200 divide-y divide-neutral-100">
              {items.map((item, index) => (
                <div key={index} className="p-4 flex items-center gap-4">
                  <div className="flex-1">
                    <h3 className="font-medium text-neutral-900">{item.name}</h3>
                    <p className="text-sm text-neutral-500">{formatPrice(item.price, currency)}</p>
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => updateQuantity(item.name, item.price, item.quantity - 1)}
                      className="w-8 h-8 rounded-full border border-neutral-300 flex items-center justify-center hover:bg-neutral-100 transition-colors"
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                    <span className="w-8 text-center font-medium">{item.quantity}</span>
                    <button
                      onClick={() => updateQuantity(item.name, item.price, item.quantity + 1)}
                      className="w-8 h-8 rounded-full border border-neutral-300 flex items-center justify-center hover:bg-neutral-100 transition-colors"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="w-24 text-right font-semibold text-neutral-900">
                    {formatPrice(item.price * item.quantity, currency)}
                  </div>

                  <button
                    onClick={() => removeItem(item.name, item.price)}
                    className="p-2 text-neutral-400 hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="h-5 w-5" />
                  </button>
                </div>
              ))}
            </div>

            <div className="mt-6 bg-white rounded-xl border border-neutral-200 p-5">
              <div className="flex justify-between items-center mb-4">
                <span className="text-neutral-600">
                  {itemCount} {itemCount === 1 ? t(lang, 'item') : t(lang, 'items')}
                </span>
                <div className="text-right">
                  <span className="text-sm text-neutral-500">{t(lang, 'total')}</span>
                  <p className="text-2xl font-bold text-neutral-900">{formatPrice(total, currency)}</p>
                </div>
              </div>

              <button
                onClick={() => {
                  const tableParam = searchParams.get('table');
                  const params = new URLSearchParams({ lang, currency });
                  if (tableParam) params.set('table', tableParam);
                  navigate(`/menu/${slug}/checkout?${params}`);
                }}
                className="w-full bg-black text-white py-4 rounded-full font-semibold text-lg hover:bg-neutral-800 transition-colors"
              >
                {t(lang, 'pay')} · {formatPrice(total, currency)}
              </button>

              <div className="mt-4 pt-4 border-t border-neutral-100">
                <p className="text-xs text-neutral-500 text-center">{t(lang, 'acceptedPayments')}</p>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
