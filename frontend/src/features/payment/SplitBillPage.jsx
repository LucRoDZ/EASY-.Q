/**
 * SplitBillPage — partager l'addition en N parts égales.
 *
 * Route : /menu/:slug/split?order_id=...
 * Crée N PaymentIntents via POST /api/v1/payments/split, puis affiche un lien
 * de paiement par convive (partage natif ou copie dans le presse-papier).
 */

import { useState } from 'react';
import { useParams, useSearchParams, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Users, Share2, Copy, Check, Loader2, CreditCard } from 'lucide-react';
import { api } from '../../api';

function formatPrice(cents, currency = 'EUR') {
  try {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} €`;
  }
}

export default function SplitBillPage() {
  const { slug } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const lang = searchParams.get('lang') || 'fr';
  const orderId = parseInt(searchParams.get('order_id') || '0', 10);

  const [parts, setParts] = useState(2);
  const [result, setResult] = useState(null); // {total, currency, parts: [...]}
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copiedPart, setCopiedPart] = useState(null);

  const buildPayUrl = (part) => {
    const params = new URLSearchParams({
      lang,
      secret: part.client_secret,
      amount: String(part.amount),
      order_id: String(orderId),
    });
    return `${window.location.origin}/menu/${slug}/checkout?${params}`;
  };

  const handleGenerate = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.createSplitPayments(orderId, parts);
      setResult(data);
    } catch (err) {
      setError(err.message || 'Impossible de partager l’addition.');
    } finally {
      setLoading(false);
    }
  };

  const handleShare = async (part) => {
    const url = buildPayUrl(part);
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Partager l’addition',
          text: `Votre part : ${formatPrice(part.amount, result.currency)}`,
          url,
        });
        return;
      } catch {
        // utilisateur a annulé — fallback copie
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopiedPart(part.part);
      setTimeout(() => setCopiedPart(null), 2000);
    } catch {
      setError('Impossible de copier le lien.');
    }
  };

  if (!orderId) {
    return (
      <div className="min-h-dvh bg-neutral-50 flex items-center justify-center px-4">
        <p className="text-neutral-500 text-sm">
          Commande introuvable. <Link to={`/menu/${slug}`} className="underline">Retour au menu</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-neutral-50">
      <header className="bg-black text-white sticky top-0 z-40">
        <div className="max-w-md mx-auto px-4 h-14 flex items-center gap-4">
          <Link
            to={`/menu/${slug}/cart?lang=${lang}`}
            className="p-2 -ml-2 hover:bg-neutral-800 rounded-full transition-colors"
            aria-label="Retour"
          >
            <ArrowLeft size={20} />
          </Link>
          <h1 className="text-lg font-semibold tracking-tight">Partager l’addition</h1>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 py-8 space-y-6">
        {!result ? (
          <>
            <div className="text-center">
              <div className="w-14 h-14 bg-neutral-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <Users className="h-7 w-7 text-neutral-600" />
              </div>
              <p className="text-sm text-neutral-500">
                Combien de personnes partagent l’addition ?
              </p>
            </div>

            <div className="grid grid-cols-4 gap-3">
              {[2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setParts(n)}
                  className={`py-4 rounded-xl border-2 text-xl font-bold transition-colors ${
                    parts === n
                      ? 'border-neutral-900 bg-neutral-900 text-white'
                      : 'border-neutral-200 bg-white text-neutral-800 hover:border-neutral-400'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>

            {error && (
              <p role="alert" className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</p>
            )}

            <button
              onClick={handleGenerate}
              disabled={loading}
              className="w-full bg-black text-white py-4 rounded-full font-semibold text-lg hover:bg-neutral-800 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 size={18} className="animate-spin" /> : <Users size={18} />}
              {loading ? 'Création…' : `Diviser en ${parts}`}
            </button>
          </>
        ) : (
          <>
            <div className="bg-white rounded-xl border border-neutral-200 p-5 text-center">
              <p className="text-xs text-neutral-500 uppercase tracking-wide mb-1">Total de l’addition</p>
              <p className="text-2xl font-bold text-neutral-900">
                {formatPrice(result.total, result.currency)}
              </p>
              <p className="text-sm text-neutral-500 mt-1">
                {result.parts.length} parts de {formatPrice(result.parts[0].amount, result.currency)}
              </p>
            </div>

            <div className="space-y-3">
              {result.parts.map((part) => (
                <div
                  key={part.part}
                  className="bg-white rounded-xl border border-neutral-200 p-4 flex items-center gap-3"
                >
                  <span className="w-9 h-9 bg-neutral-100 rounded-full flex items-center justify-center font-bold text-neutral-700 shrink-0">
                    {part.part}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-neutral-900">
                      {formatPrice(part.amount, result.currency)}
                    </p>
                    <p className="text-xs text-neutral-400">Convive {part.part}</p>
                  </div>
                  <button
                    onClick={() => handleShare(part)}
                    aria-label={`Partager le lien de la part ${part.part}`}
                    className="flex items-center gap-1.5 border border-neutral-200 text-neutral-700 text-xs font-medium px-3 py-2 rounded-full hover:border-neutral-400 transition-colors shrink-0"
                  >
                    {copiedPart === part.part ? <Check size={13} className="text-green-600" /> : navigator.share ? <Share2 size={13} /> : <Copy size={13} />}
                    {copiedPart === part.part ? 'Copié !' : 'Partager'}
                  </button>
                  {part.part === 1 && (
                    <button
                      onClick={() => navigate(buildPayUrl(part).replace(window.location.origin, ''))}
                      className="flex items-center gap-1.5 bg-black text-white text-xs font-medium px-3 py-2 rounded-full hover:bg-neutral-800 transition-colors shrink-0"
                    >
                      <CreditCard size={13} />
                      Payer
                    </button>
                  )}
                </div>
              ))}
            </div>

            <p className="text-xs text-neutral-400 text-center">
              Chaque convive ouvre son lien et paie sa part. La commande part en cuisine
              une fois toutes les parts réglées.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
