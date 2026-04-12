/**
 * SplitBillPage — split the cart total equally across N people.
 *
 * Flow:
 *  1. User selects number of people (2–8)
 *  2. Per-person amount is displayed
 *  3. Each person taps "Pay my share" → Stripe PaymentElement appears
 *  4. On payment → redirect to ThankYouPage
 *
 * URL: /menu/:slug/split?lang=fr&currency=EUR&table=<token>
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams, Link, useNavigate } from 'react-router-dom';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { Loader2, ArrowLeft, Users, Minus, Plus, Lock, SplitSquareHorizontal } from 'lucide-react';
import { useCart } from '../../context/CartContext';
import { api } from '../../api';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatCents(cents, currency = 'EUR') {
  try {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

function formatEuros(euros, currency = 'EUR') {
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

function SplitPaymentForm({ amount, currency, slug, lang, personIndex, totalPersons }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setSubmitting(true);
    setErrorMsg('');

    const returnUrl = `${window.location.origin}/menu/${slug}/thank-you?lang=${lang}&split=1&person=${personIndex}&of=${totalPersons}`;

    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: returnUrl },
    });

    if (error) {
      setErrorMsg(error.message || 'Paiement refusé');
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="bg-white rounded-xl border border-neutral-200 p-6">
        <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-4">
          Personne {personIndex} · {formatCents(amount, currency)}
        </p>
        <PaymentElement
          options={{ layout: 'tabs', wallets: { applePay: 'auto', googlePay: 'auto' } }}
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
        {submitting ? <Loader2 size={18} className="animate-spin" /> : <Lock size={16} />}
        {submitting ? 'Traitement…' : `Payer ${formatCents(amount, currency)}`}
      </button>
    </form>
  );
}

// ─── SplitSetup (pick # persons) ─────────────────────────────────────────────

function SplitSetup({ numPersons, setNumPersons, perPersonAmount, total, currency }) {
  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-neutral-200 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-neutral-500">Total de l&apos;addition</p>
          <p className="font-semibold text-neutral-900 text-lg">{formatEuros(total, currency)}</p>
        </div>

        <div className="border-t border-neutral-100 pt-4">
          <p className="text-sm font-medium text-neutral-700 mb-3">Nombre de personnes</p>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setNumPersons((n) => Math.max(2, n - 1))}
              disabled={numPersons <= 2}
              className="w-10 h-10 rounded-full border border-neutral-200 flex items-center justify-center hover:bg-neutral-50 disabled:opacity-30 transition-colors"
            >
              <Minus size={16} />
            </button>
            <div className="flex-1 text-center">
              <span className="text-3xl font-bold text-neutral-900">{numPersons}</span>
              <p className="text-xs text-neutral-400 mt-0.5">personnes</p>
            </div>
            <button
              onClick={() => setNumPersons((n) => Math.min(8, n + 1))}
              disabled={numPersons >= 8}
              className="w-10 h-10 rounded-full border border-neutral-200 flex items-center justify-center hover:bg-neutral-50 disabled:opacity-30 transition-colors"
            >
              <Plus size={16} />
            </button>
          </div>
        </div>

        <div className="bg-neutral-50 rounded-lg px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-neutral-600">
            <Users size={14} />
            <span>Par personne</span>
          </div>
          <span className="font-bold text-neutral-900 text-lg">{formatCents(perPersonAmount, currency)}</span>
        </div>
      </div>
    </div>
  );
}

// ─── SplitBillPage ────────────────────────────────────────────────────────────

export default function SplitBillPage() {
  const { slug } = useParams();
  const [searchParams] = useSearchParams();
  const lang = searchParams.get('lang') || 'fr';
  const currency = searchParams.get('currency') || 'EUR';
  const tableToken = searchParams.get('table') || null;

  const { items, total } = useCart();
  const navigate = useNavigate();

  const [numPersons, setNumPersons] = useState(2);
  const [currentPerson, setCurrentPerson] = useState(1);
  const [step, setStep] = useState('setup'); // 'setup' | 'paying'

  const [stripePromise, setStripePromise] = useState(null);
  const [clientSecret, setClientSecret] = useState('');
  const [intentAmount, setIntentAmount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Redirect if cart is empty
  useEffect(() => {
    if (items.length === 0) {
      navigate(`/menu/${slug}/cart?lang=${lang}&currency=${currency}`);
    }
  }, [items.length, slug, lang, currency, navigate]);

  // Calculate per-person amount locally (for display)
  const totalCents = Math.round(total * 100);
  const perPersonCents = Math.floor(totalCents / numPersons);
  // Last person gets remainder
  const thisPersonCents = currentPerson >= numPersons
    ? totalCents - perPersonCents * (numPersons - 1)
    : perPersonCents;

  const startPayment = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { publishable_key } = await api.getStripeConfig();
      if (!publishable_key) throw new Error('Stripe non configuré');
      setStripePromise(loadStripe(publishable_key));

      const cartItems = items.map((i) => ({
        name: i.name,
        price: i.price,
        quantity: i.quantity,
      }));
      const intent = await api.createPaymentIntent(
        slug,
        cartItems,
        0,
        currency.toLowerCase(),
        tableToken,
        numPersons,
        currentPerson,
      );
      setClientSecret(intent.client_secret);
      setIntentAmount(intent.amount);
      setStep('paying');
    } catch (err) {
      setError(err.message || 'Erreur de paiement');
    } finally {
      setLoading(false);
    }
  }, [slug, items, currency, tableToken, numPersons, currentPerson]);

  const cartUrl = `/menu/${slug}/cart?lang=${lang}&currency=${currency}`;

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Header */}
      <header className="bg-black text-white sticky top-0 z-40">
        <div className="max-w-xl mx-auto px-4 h-14 flex items-center gap-4">
          <Link
            to={step === 'paying' ? '#' : cartUrl}
            onClick={step === 'paying' ? (e) => { e.preventDefault(); setStep('setup'); setClientSecret(''); } : undefined}
            className="p-2 -ml-2 hover:bg-neutral-800 rounded-full transition-colors"
            aria-label="Retour"
          >
            <ArrowLeft size={20} />
          </Link>
          <div className="flex items-center gap-2">
            <SplitSquareHorizontal size={18} />
            <h1 className="text-lg font-semibold tracking-tight">Partager l&apos;addition</h1>
          </div>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 py-6 space-y-4">

        {/* Progress indicator */}
        {step === 'paying' && (
          <div className="flex items-center gap-2 bg-white rounded-xl border border-neutral-200 p-4">
            <Users size={16} className="text-neutral-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-neutral-900">
                Personne {currentPerson} sur {numPersons}
              </p>
              <p className="text-xs text-neutral-400 truncate">
                Chacun paie sa part séparément
              </p>
            </div>
            <div className="flex gap-1 shrink-0">
              {Array.from({ length: numPersons }, (_, i) => (
                <div
                  key={i}
                  className={`w-2 h-2 rounded-full ${
                    i + 1 < currentPerson
                      ? 'bg-neutral-900'
                      : i + 1 === currentPerson
                      ? 'bg-neutral-600 ring-2 ring-offset-1 ring-neutral-400'
                      : 'bg-neutral-200'
                  }`}
                />
              ))}
            </div>
          </div>
        )}

        {/* Setup step */}
        {step === 'setup' && (
          <>
            <SplitSetup
              numPersons={numPersons}
              setNumPersons={setNumPersons}
              perPersonCents={perPersonCents}
              perPersonAmount={perPersonCents}
              total={total}
              currency={currency}
            />

            {error && (
              <p className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</p>
            )}

            <button
              onClick={startPayment}
              disabled={loading}
              className="w-full bg-black text-white rounded-full py-3.5 font-medium hover:bg-neutral-800 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
            >
              {loading ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <Users size={16} />
              )}
              {loading
                ? 'Initialisation…'
                : `Personne 1 — payer ${formatCents(perPersonCents, currency)}`}
            </button>
          </>
        )}

        {/* Paying step */}
        {step === 'paying' && clientSecret && stripePromise && (
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
            <SplitPaymentForm
              amount={intentAmount}
              currency={currency}
              slug={slug}
              lang={lang}
              personIndex={currentPerson}
              totalPersons={numPersons}
            />
          </Elements>
        )}

        {step === 'paying' && !clientSecret && !loading && (
          <div className="flex items-center justify-center py-12 gap-2 text-neutral-500">
            <Loader2 size={20} className="animate-spin" />
            <span className="text-sm">Initialisation…</span>
          </div>
        )}

      </main>
    </div>
  );
}
