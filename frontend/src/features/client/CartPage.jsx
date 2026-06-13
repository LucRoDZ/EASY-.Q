import { useParams, useSearchParams, Link, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Minus, Plus, Trash2, ArrowLeft, ShoppingBag, CheckCircle, ChefHat } from 'lucide-react';
import { useCart } from '../../context/CartContext';
import { useUserRole } from '../../context/UserRoleContext';
import { useToast } from '../../components/ui/Toast';
import { t } from '../../localization/translations';
import { api } from '../../api';

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

function WaiterOrderConfirmed({ items, total, currency, tableNumber, onNewOrder }) {
  return (
    <div className="min-h-dvh bg-neutral-50 flex flex-col items-center justify-center px-4">
      <div className="bg-white rounded-2xl border border-neutral-200 p-8 max-w-sm w-full text-center shadow-sm">
        <CheckCircle className="w-14 h-14 text-green-500 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-neutral-900 mb-1">Commande envoyée</h2>
        {tableNumber && (
          <p className="text-sm text-neutral-500 mb-5">Table {tableNumber}</p>
        )}

        <div className="text-left space-y-2 mb-5 border-t border-neutral-100 pt-4">
          {items.map((item, i) => (
            <div key={i} className="flex justify-between text-sm">
              <span className="text-neutral-700">{item.quantity}× {item.name}</span>
              <span className="text-neutral-500">{formatPrice(item.price * item.quantity, currency)}</span>
            </div>
          ))}
        </div>

        <div className="flex justify-between font-semibold text-neutral-900 border-t border-neutral-100 pt-3 mb-6">
          <span>Total</span>
          <span>{formatPrice(total, currency)}</span>
        </div>

        <p className="text-xs text-neutral-400 mb-6">
          Le client règle l'addition au comptoir.
        </p>

        <button
          onClick={onNewOrder}
          className="w-full bg-black text-white py-3 rounded-full font-semibold hover:bg-neutral-800 transition-colors"
        >
          Retour aux tables
        </button>
      </div>
    </div>
  );
}

export default function CartPage() {
  const { slug } = useParams();
  const [searchParams] = useSearchParams();
  const lang = searchParams.get('lang') || 'fr';
  const currency = searchParams.get('currency') || 'EUR';
  const navigate = useNavigate();

  const toast = useToast();
  const { items, updateQuantity, removeItem, total, itemCount, setSlug, clearCart, tableToken: storedTableToken } = useCart();
  const { role } = useUserRole();
  const isWaiter = role === 'waiter';
  const tableToken = searchParams.get('table') || storedTableToken || '';

  const [sending, setSending] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [confirmed, setConfirmed] = useState(null); // { items, total, tableNumber }

  useEffect(() => { setSlug(slug); }, [slug, setSlug]);

  async function handleWaiterOrder() {
    setSending(true);
    try {
      await api.createOrder({
        menu_slug: slug,
        table_token: tableToken || undefined,
        currency: currency.toLowerCase(),
        items: items.map(({ name, price, quantity }) => ({ name, price, quantity })),
      });
      setConfirmed({ items: [...items], total, tableNumber: searchParams.get('tableNumber') });
      clearCart();
    } catch (err) {
      toast.error(`Erreur : ${err.message}`);
    } finally {
      setSending(false);
    }
  }

  async function handleSplitBill() {
    setSplitting(true);
    try {
      const order = await api.createOrder({
        menu_slug: slug,
        table_token: tableToken || undefined,
        currency: currency.toLowerCase(),
        items: items.map(({ name, price, quantity }) => ({ name, price, quantity })),
      });
      navigate(`/menu/${slug}/split?order_id=${order.id}&lang=${lang}`);
    } catch (err) {
      toast.error(`Erreur : ${err.message}`);
    } finally {
      setSplitting(false);
    }
  }

  if (confirmed) {
    return (
      <WaiterOrderConfirmed
        items={confirmed.items}
        total={confirmed.total}
        currency={currency}
        tableNumber={confirmed.tableNumber}
        onNewOrder={() => navigate('/waiter')}
      />
    );
  }

  return (
    <div className="min-h-dvh bg-neutral-50">
      <header className="bg-black text-white sticky top-0 z-40">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link
              to={`/menu/${slug}?lang=${lang}${tableToken ? `&table=${tableToken}` : ''}`}
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
                      aria-label={`${t(lang, 'cart.decreaseQty')} — ${item.name}`}
                      className="w-11 h-11 rounded-full border border-neutral-300 flex items-center justify-center hover:bg-neutral-100 transition-colors"
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                    <span className="w-8 text-center font-medium">{item.quantity}</span>
                    <button
                      onClick={() => updateQuantity(item.name, item.price, item.quantity + 1)}
                      aria-label={`${t(lang, 'cart.increaseQty')} — ${item.name}`}
                      className="w-11 h-11 rounded-full border border-neutral-300 flex items-center justify-center hover:bg-neutral-100 transition-colors"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="w-24 text-right font-semibold text-neutral-900">
                    {formatPrice(item.price * item.quantity, currency)}
                  </div>

                  <button
                    onClick={() => removeItem(item.name, item.price)}
                    aria-label={`${t(lang, 'cart.removeItem')} — ${item.name}`}
                    className="p-3 text-neutral-400 hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="h-5 w-5" />
                  </button>
                </div>
              ))}
            </div>

            <div className="mt-6 bg-white rounded-xl border border-neutral-200 p-5">
              <div className="space-y-2 mb-4 pb-4 border-b border-neutral-100">
                <div className="flex justify-between text-sm text-neutral-600">
                  <span>{itemCount} {itemCount === 1 ? t(lang, 'item') : t(lang, 'items')}</span>
                  <span>{formatPrice(total, currency)}</span>
                </div>
                {!isWaiter && (
                  <>
                    <div className="flex justify-between text-xs text-neutral-400">
                      <span>{t(lang, 'cart.vatFood')}</span>
                      <span>{formatPrice(total * 0.1 / 1.1, currency)}</span>
                    </div>
                    <div className="flex justify-between text-xs text-neutral-400">
                      <span>{t(lang, 'cart.vatAlcohol')}</span>
                      <span>—</span>
                    </div>
                  </>
                )}
              </div>

              <div className="flex justify-between items-center mb-4">
                <span className="font-semibold text-neutral-800">{t(lang, 'total')}</span>
                <p className="text-2xl font-bold text-neutral-900">{formatPrice(total, currency)}</p>
              </div>

              {isWaiter ? (
                <button
                  disabled={items.length === 0 || sending}
                  onClick={handleWaiterOrder}
                  className="w-full bg-black text-white py-4 rounded-full font-semibold text-lg hover:bg-neutral-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  <ChefHat className="w-5 h-5" />
                  {sending ? 'Envoi en cours…' : 'Envoyer en cuisine'}
                </button>
              ) : (
                <>
                  {total < 5 && total > 0 && (
                    <p role="alert" className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
                      {lang === 'fr'
                        ? `Montant minimum : 5,00 €. Il manque ${formatPrice(5 - total, currency)}.`
                        : lang === 'es'
                        ? `Importe mínimo: 5,00 €. Faltan ${formatPrice(5 - total, currency)}.`
                        : `Minimum order: ${formatPrice(5, currency)}. Add ${formatPrice(5 - total, currency)} more.`}
                    </p>
                  )}
                  <button
                    disabled={total < 5}
                    onClick={() => {
                      const params = new URLSearchParams({ lang, currency });
                      if (tableToken) params.set('table', tableToken);
                      navigate(`/menu/${slug}/tip?${params}`);
                    }}
                    className="w-full bg-black text-white py-4 rounded-full font-semibold text-lg hover:bg-neutral-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {t(lang, 'pay')} · {formatPrice(total, currency)}
                  </button>
                  <button
                    type="button"
                    disabled={total < 5 || splitting}
                    onClick={handleSplitBill}
                    className="w-full mt-3 text-sm text-neutral-500 underline hover:text-neutral-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {splitting ? 'Préparation…' : "Partager l'addition"}
                  </button>
                  <div className="mt-4 pt-4 border-t border-neutral-100">
                    <p className="text-xs text-neutral-500 text-center">{t(lang, 'acceptedPayments')}</p>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
