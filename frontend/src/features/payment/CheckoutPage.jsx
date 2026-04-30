/**
 * CheckoutPage — Stripe Elements checkout for cart payment.
 *
 * Flow:
 *  1. Load Stripe.js (lazy) + fetch publishable key from /api/v1/payments/config
 *  2. POST /api/v1/payments/intent → get client_secret
 *  3. Render PaymentElement inside <Elements> provider
 *  4. On submit → stripe.confirmPayment() → redirect to /menu/:slug/thank-you
 */

import { useEffect, useState, useCallback } from 'react';
import { useParams, useSearchParams, Link, useNavigate } from 'react-router-dom';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { Loader2, ArrowLeft, ShoppingBag, Lock } from 'lucide-react';
import { useCart } from '../../context/CartContext';
import { api } from '../../api';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatPrice(cents, currency = 'EUR') {
  try {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

function formatPriceEuros(euros, currency = 'EUR') {
  try {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(euros);
  } catch {
    return `${euros.toFixed(2)} ${currency.toUpperCase()}`;
  }
}

// ─── PaymentForm (inner — must be inside <Elements>) ─────────────────────────

function PaymentForm({ amount, currency, slug, lang, onSuccess }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setSubmitting(true);
    setErrorMsg('');

    const returnUrl = `${window.location.origin}/menu/${slug}/thank-you?lang=${lang}`;

    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: returnUrl },
    });

    if (error) {
      setErrorMsg(error.message || 'Paiement refusé');
      setSubmitting(false);
    }
    // On success Stripe redirects to return_url automatically
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="bg-white rounded-xl border border-neutral-200 p-6">
        <h2 className="font-semibold text-neutral-900 mb-4 text-sm">
          Informations de paiement
        </h2>
        <PaymentElement
          options={{
            layout: 'tabs',
            wallets: { applePay: 'auto', googlePay: 'auto' },
          }}
        />
      </div>

      {errorMsg && (
        <p className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm">{errorMsg}</p>
      )}

      <button
        type="submit"
        disabled={!stripe || submitting}
        className="w-full bg-black text-white rounded-full py-3.5 font-medium hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
      >
        {submitting ? (
          <Loader2 size={18} className="animate-spin" />
        ) : (
          <Lock size={16} />
        )}
        {submitting ? 'Traitement…' : `Payer ${formatPrice(amount, currency)}`}
      </button>

      <p className="text-center text-xs text-neutral-400">
        Paiement sécurisé · Propulsé par Stripe
      </p>
    </form>
  );
}

// ─── CheckoutPage ─────────────────────────────────────────────────────────────

export default function CheckoutPage() {
  const { slug } = useParams();
  const [searchParams] = useSearchParams();
  const lang = searchParams.get('lang') || 'fr';
  const currency = searchParams.get('currency') || 'EUR';
  const tableToken = searchParams.get('table') || null;
  const tipCents = Math.max(0, parseInt(searchParams.get('tip') || '0', 10));

  const { items, total } = useCart();
  const navigate = useNavigate();

  const [stripePromise, setStripePromise] = useState(null);
  const [clientSecret, setClientSecret] = useState('');
  const [intentAmount, setIntentAmount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Redirect to cart if cart is empty
  useEffect(() => {
    if (items.length === 0) {
      navigate(`/menu/${slug}/cart?lang=${lang}&currency=${currency}`);
    }
  }, [items.length, slug, lang, currency, navigate]);

  const initialise = useCallback(async () => {
    if (items.length === 0) return;
    setLoading(true);
    setError('');
    try {
      // 1. Load Stripe publishable key
      const { publishable_key } = await api.getStripeConfig();
      if (!publishable_key) throw new Error('Stripe non configuré');
      setStripePromise(loadStripe(publishable_key));

      // 2. Create PaymentIntent
      const cartItems = items.map((i) => ({
        name: i.name,
        price: i.price,
        quantity: i.quantity,
      }));
      const intent = await api.createPaymentIntent(
        slug,
        cartItems,
        tipCents / 100, // convert cents → euros for the backend
        currency.toLowerCase(),
        tableToken,
      );
      setClientSecret(intent.client_secret);
      setIntentAmount(intent.amount);
    } catch (err) {
      setError(err.message || 'Erreur de paiement');
    } finally {
      setLoading(false);
    }
  }, [slug, items, currency, tableToken, tipCents]);

  useEffect(() => {
    initialise();
  }, [initialise]);

  const cartUrl = `/menu/${slug}/cart?lang=${lang}&currency=${currency}`;

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Header */}
      <header className="bg-black text-white sticky top-0 z-40">
        <div className="max-w-xl mx-auto px-4 h-14 flex items-center gap-4">
          <Link
            to={cartUrl}
            className="p-2 -ml-2 hover:bg-neutral-800 rounded-full transition-colors"
            aria-label="Retour au panier"
          >
            <ArrowLeft size={20} />
          </Link>
          <h1 className="text-lg font-semibold tracking-tight">Paiement</h1>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 py-6 space-y-4">

        {/* Order summary */}
        <div className="bg-white rounded-xl border border-neutral-200 p-6">
          <h2 className="font-semibold text-neutral-900 mb-4 text-sm flex items-center gap-2">
            <ShoppingBag size={16} className="text-neutral-500" />
            Récapitulatif
          </h2>
          <div className="divide-y divide-neutral-100">
            {items.map((item, i) => (
              <div key={i} className="flex items-center justify-between py-3 gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-neutral-900 text-sm truncate">{item.name}</p>
                  {item.quantity > 1 && (
                    <p className="text-xs text-neutral-400">× {item.quantity}</p>
                  )}
                </div>
                <p className="font-medium text-neutral-900 shrink-0">
                  {formatPriceEuros(item.price * item.quantity, currency)}
                </p>
              </div>
            ))}
          </div>
          {tipCents > 0 && (
            <div className="flex justify-between items-center py-2 text-sm text-neutral-500">
              <span>Pourboire</span>
              <span>{formatPrice(tipCents, currency)}</span>
            </div>
          )}
          <div className="pt-3 border-t border-neutral-200 flex justify-between items-center">
            <span className="text-sm text-neutral-500">Total</span>
            <span className="font-semibold text-neutral-900 text-lg">
              {intentAmount > 0
                ? formatPrice(intentAmount, currency)
                : formatPrice(Math.round(total * 100) + tipCents, currency)}
            </span>
          </div>
        </div>

        {/* Stripe form or states */}
        {loading ? (
          <div className="flex items-center justify-center py-12 gap-2 text-neutral-500">
            <Loader2 size={20} className="animate-spin" />
            <span className="text-sm">Initialisation du paiement…</span>
          </div>
        ) : error ? (
          <div className="space-y-3">
            <p className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</p>
            <button
              onClick={initialise}
              className="w-full bg-black text-white rounded-full py-3 font-medium hover:bg-neutral-800 transition-colors"
            >
              Réessayer
            </button>
          </div>
        ) : clientSecret && stripePromise ? (
          <Elements
            stripe={stripePromise}
            options={{
              clientSecret,
              appearance: {
                theme: 'stripe',
                variables: {
                  colorPrimary: '#000000',
                  colorBackground: '#ffffff',
                  fontFamily: 'system-ui, sans-serif',
                  borderRadius: '8px',
                },
              },
            }}
          >
            <PaymentForm
              amount={intentAmount}
              currency={currency}
              slug={slug}
              lang={lang}
            />
          </Elements>
        ) : null}
      </main>
    </div>
  );
}
