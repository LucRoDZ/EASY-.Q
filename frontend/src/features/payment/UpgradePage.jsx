/**
 * UpgradePage — Freemium vs Pro plan comparison + Stripe Checkout CTA.
 */

import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Check, ArrowLeft, Loader2, Zap } from 'lucide-react';
import { api } from '../../api';

const FREE_FEATURES = [
  '1 menu digital QR',
  'Chatbot IA (limité à 100 messages/mois)',
  'Traduction automatique (FR/EN/ES)',
  'Jusqu\'à 5 tables',
  'Support communautaire',
];

const PRO_FEATURES = [
  'Menus illimités',
  'Chatbot IA illimité',
  'Paiement à table (Stripe)',
  'Analytics & rapports',
  'Tables illimitées + QR codes PDF',
  'Commandes KDS cuisine',
  'Avis Google & NPS',
  'Split bill & pourboire',
  'Export comptable CSV',
  'Support prioritaire',
];

export default function UpgradePage() {
  const [searchParams] = useSearchParams();
  const restaurantId = searchParams.get('restaurant_id') || '';
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleUpgrade = async () => {
    if (!restaurantId) {
      setError('Restaurant ID manquant — accédez à cette page depuis votre tableau de bord.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await api.createSubscriptionCheckout(restaurantId, email);
      if (data.already_pro) {
        window.location.href = '/restaurant/dashboard';
        return;
      }
      if (data.checkout_url) {
        window.location.href = data.checkout_url;
      }
    } catch (err) {
      setError(err.message || 'Une erreur est survenue. Réessayez.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Header */}
      <header className="bg-black text-white sticky top-0 z-40">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center gap-3">
          <Link to="/restaurant/dashboard" className="text-neutral-400 hover:text-white transition-colors">
            <ArrowLeft size={18} />
          </Link>
          <span className="font-semibold">Passer à Pro</span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-12">
        {/* Hero */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-1.5 bg-black text-white text-xs font-medium rounded-full px-3 py-1 mb-4">
            <Zap size={11} />
            EASY.Q Pro
          </div>
          <h1 className="text-3xl font-semibold text-neutral-900 mb-3">
            Tout ce dont votre restaurant a besoin
          </h1>
          <p className="text-neutral-500 max-w-lg mx-auto">
            Passez à Pro et accédez à toutes les fonctionnalités : paiement à table,
            analytics avancés, KDS cuisine, et plus encore.
          </p>
        </div>

        {/* Plans comparison */}
        <div className="grid md:grid-cols-2 gap-6 mb-10">
          {/* Free */}
          <div className="bg-white rounded-xl border border-neutral-200 p-6">
            <div className="mb-5">
              <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-1">Gratuit</p>
              <p className="text-3xl font-semibold text-neutral-900">0 €</p>
              <p className="text-sm text-neutral-400 mt-0.5">Pour toujours</p>
            </div>
            <ul className="space-y-2.5 mb-6">
              {FREE_FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-neutral-600">
                  <Check size={14} className="text-neutral-400 mt-0.5 shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
            <button
              disabled
              className="w-full py-2.5 border border-neutral-200 rounded-full text-sm text-neutral-400 cursor-default"
            >
              Plan actuel
            </button>
          </div>

          {/* Pro */}
          <div className="bg-black rounded-xl p-6 text-white relative overflow-hidden">
            <div className="mb-5">
              <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-1">Pro</p>
              <div className="flex items-baseline gap-1">
                <p className="text-3xl font-semibold">49 €</p>
                <p className="text-neutral-400 text-sm">/mois</p>
              </div>
              <p className="text-sm text-neutral-400 mt-0.5">Annulable à tout moment</p>
            </div>
            <ul className="space-y-2.5 mb-6">
              {PRO_FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-neutral-200">
                  <Check size={14} className="text-white mt-0.5 shrink-0" />
                  {f}
                </li>
              ))}
            </ul>

            {/* Email input */}
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Votre email (pour la facture)"
              className="w-full mb-3 px-4 py-2.5 bg-neutral-900 border border-neutral-700 rounded-xl text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-neutral-500"
            />

            {error && (
              <p className="text-xs text-neutral-300 mb-3">{error}</p>
            )}

            <button
              onClick={handleUpgrade}
              disabled={loading}
              className="w-full py-3 bg-white text-black rounded-full text-sm font-semibold hover:bg-neutral-100 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  Redirection…
                </>
              ) : (
                'Passer à Pro — 49 €/mois'
              )}
            </button>
          </div>
        </div>

        {/* FAQ */}
        <div className="bg-white border border-neutral-200 rounded-xl p-6 space-y-4 max-w-2xl mx-auto">
          <h2 className="text-sm font-semibold text-neutral-900">Questions fréquentes</h2>
          {[
            ['Puis-je annuler à tout moment ?', 'Oui. Annulez depuis le portail de facturation Stripe, sans engagement.'],
            ['Y a-t-il un essai gratuit ?', 'Vous pouvez utiliser le plan Gratuit aussi longtemps que vous le souhaitez. Passez à Pro quand vous êtes prêt.'],
            ['Le paiement est-il sécurisé ?', 'Oui. Le paiement est géré par Stripe. Vos informations bancaires ne passent jamais par nos serveurs.'],
          ].map(([q, a]) => (
            <div key={q}>
              <p className="text-sm font-medium text-neutral-800">{q}</p>
              <p className="text-sm text-neutral-500 mt-0.5">{a}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
