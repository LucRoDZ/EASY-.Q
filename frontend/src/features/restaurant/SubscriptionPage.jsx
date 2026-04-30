/**
 * SubscriptionPage — manage Pro subscription (upgrade or access Stripe billing portal).
 *
 * Accessed at: /restaurant/subscription?restaurant_id=<id>
 *
 * Flow:
 *  1. Load current subscription status
 *  2. Free plan → show upgrade CTA (redirects to Stripe Checkout)
 *  3. Pro plan  → show current status + "Manage billing" (Stripe Customer Portal)
 */

import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Loader2, CheckCircle, ArrowLeft, Zap, CreditCard } from 'lucide-react';
import { api } from '../../api';

const PRO_FEATURES = [
  'Menus illimités',
  'Chatbot IA illimité',
  'Paiement à table (Stripe)',
  'Analytics & rapports',
  'Tables illimitées + QR codes PDF',
  'Commandes KDS cuisine',
  'Avis Google & NPS',
  'Split bill & pourboire',
  'Support prioritaire',
];

export default function SubscriptionPage() {
  const [searchParams] = useSearchParams();
  const restaurantId = searchParams.get('restaurant_id') || '';

  const [sub, setSub] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!restaurantId) {
      setLoading(false);
      return;
    }
    api.getSubscription(restaurantId)
      .then(setSub)
      .catch(() => setSub(null))
      .finally(() => setLoading(false));
  }, [restaurantId]);

  const isPro = sub?.plan === 'pro' && sub?.status === 'active';

  const handleUpgrade = async () => {
    if (!restaurantId) return;
    setActionLoading(true);
    setError('');
    try {
      const data = await api.createSubscriptionCheckout(restaurantId);
      if (data.already_pro) {
        setSub((s) => ({ ...s, plan: 'pro', status: 'active' }));
        return;
      }
      if (data.checkout_url) window.location.href = data.checkout_url;
    } catch (err) {
      setError(err.message || 'Une erreur est survenue.');
    } finally {
      setActionLoading(false);
    }
  };

  const handlePortal = async () => {
    if (!restaurantId) return;
    setActionLoading(true);
    setError('');
    try {
      const data = await api.createSubscriptionPortal(restaurantId);
      if (data.portal_url) window.location.href = data.portal_url;
    } catch (err) {
      setError(err.message || 'Une erreur est survenue.');
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Header */}
      <header className="bg-black text-white sticky top-0 z-40">
        <div className="max-w-xl mx-auto px-4 h-14 flex items-center gap-4">
          <Link
            to="/restaurant/dashboard"
            className="p-2 -ml-2 hover:bg-neutral-800 rounded-full transition-colors"
            aria-label="Retour"
          >
            <ArrowLeft size={20} />
          </Link>
          <h1 className="text-lg font-semibold tracking-tight">Abonnement</h1>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 py-8 space-y-6">
        {loading ? (
          <div className="flex items-center justify-center py-16 gap-2 text-neutral-500">
            <Loader2 size={20} className="animate-spin" />
            <span className="text-sm">Chargement…</span>
          </div>
        ) : !restaurantId ? (
          <div className="bg-white rounded-xl border border-neutral-200 p-6 text-center">
            <p className="text-neutral-500 text-sm">
              Restaurant ID manquant. Accédez à cette page depuis votre tableau de bord.
            </p>
          </div>
        ) : (
          <>
            {/* Current plan badge */}
            <div className="bg-white rounded-xl border border-neutral-200 p-6 flex items-center justify-between">
              <div>
                <p className="text-xs text-neutral-500 uppercase tracking-wide mb-1">Plan actuel</p>
                <p className="text-xl font-bold text-neutral-900">
                  {isPro ? 'Pro' : 'Gratuit'}
                </p>
                {sub?.current_period_end && isPro && (
                  <p className="text-xs text-neutral-400 mt-1">
                    Renouvellement le{' '}
                    {new Date(sub.current_period_end).toLocaleDateString('fr-FR')}
                  </p>
                )}
              </div>
              <div
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  isPro
                    ? 'bg-neutral-900 text-white'
                    : 'bg-neutral-100 text-neutral-600'
                }`}
              >
                {isPro ? 'Actif' : 'Gratuit'}
              </div>
            </div>

            {/* Pro features list */}
            {!isPro && (
              <div className="bg-white rounded-xl border border-neutral-200 p-6 space-y-4">
                <div className="flex items-center gap-2">
                  <Zap size={18} className="text-neutral-700" />
                  <h2 className="font-semibold text-neutral-900">Passer au plan Pro — 49 €/mois</h2>
                </div>
                <ul className="space-y-2">
                  {PRO_FEATURES.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-neutral-700">
                      <CheckCircle size={15} className="mt-0.5 shrink-0 text-neutral-500" />
                      {f}
                    </li>
                  ))}
                </ul>

                {error && (
                  <p className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-lg">{error}</p>
                )}

                <button
                  onClick={handleUpgrade}
                  disabled={actionLoading}
                  className="w-full bg-black text-white rounded-full py-3.5 font-medium hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                >
                  {actionLoading ? (
                    <Loader2 size={18} className="animate-spin" />
                  ) : (
                    <Zap size={16} />
                  )}
                  {actionLoading ? 'Redirection…' : 'Passer au Pro'}
                </button>
              </div>
            )}

            {/* Pro: manage billing */}
            {isPro && (
              <div className="bg-white rounded-xl border border-neutral-200 p-6 space-y-4">
                <div className="flex items-center gap-2">
                  <CreditCard size={18} className="text-neutral-700" />
                  <h2 className="font-semibold text-neutral-900">Gérer la facturation</h2>
                </div>
                <p className="text-sm text-neutral-500">
                  Mettez à jour votre carte, téléchargez vos factures ou annulez votre abonnement
                  depuis le portail Stripe.
                </p>

                {error && (
                  <p className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-lg">{error}</p>
                )}

                <button
                  onClick={handlePortal}
                  disabled={actionLoading}
                  className="w-full bg-black text-white rounded-full py-3.5 font-medium hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                >
                  {actionLoading ? (
                    <Loader2 size={18} className="animate-spin" />
                  ) : (
                    <CreditCard size={16} />
                  )}
                  {actionLoading ? 'Redirection…' : 'Gérer mon abonnement'}
                </button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
