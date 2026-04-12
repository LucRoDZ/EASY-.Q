/**
 * ThankYouPage — payment success screen with NPS survey.
 *
 * Stripe redirects here with:
 *   ?payment_intent=pi_xxx&redirect_status=succeeded&lang=fr
 *
 * Flow:
 *  1. Read redirect_status from URL → show success or error state
 *  2. Animate checkmark
 *  3. Show NPS survey (1–10 scale)
 *  4. If score ≥ 9 → show Google review link
 *  5. POST /api/v1/feedback to store score in AuditLog
 */

import { useEffect, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { CheckCircle, XCircle, Star, ChevronRight, Home, UtensilsCrossed } from 'lucide-react';
import { api } from '../../api';

// ─── NPS Survey ──────────────────────────────────────────────────────────────

function NPSSurvey({ slug, lang, paymentIntentId }) {
  const [score, setScore] = useState(null);
  const [comment, setComment] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (score === null) return;
    setSubmitting(true);
    try {
      await api.submitFeedback({
        slug,
        payment_intent_id: paymentIntentId,
        nps_score: score,
        comment: comment.trim() || null,
        lang,
      });
    } catch {
      // Best-effort — never block the user on feedback submission
    } finally {
      setSubmitting(false);
      setSubmitted(true);
    }
  };

  if (submitted) {
    return (
      <div className="bg-white rounded-xl border border-neutral-200 p-6 text-center">
        <p className="text-neutral-700 font-medium">Merci pour votre retour !</p>
        {score >= 9 && (
          <p className="text-sm text-neutral-500 mt-2">
            Nous serions ravis que vous partagiez votre expérience en ligne.
          </p>
        )}
      </div>
    );
  }

  const labels = {
    fr: {
      question: 'Comment évaluez-vous votre expérience ?',
      low: 'Pas du tout',
      high: 'Excellent',
      placeholder: 'Un commentaire ? (facultatif)',
      submit: 'Envoyer',
    },
    en: {
      question: 'How would you rate your experience?',
      low: 'Not at all',
      high: 'Excellent',
      placeholder: 'Any comments? (optional)',
      submit: 'Submit',
    },
    es: {
      question: '¿Cómo valoraría su experiencia?',
      low: 'Para nada',
      high: 'Excelente',
      placeholder: '¿Algún comentario? (opcional)',
      submit: 'Enviar',
    },
  };
  const t = labels[lang] || labels.fr;

  return (
    <div className="bg-white rounded-xl border border-neutral-200 p-6 space-y-4">
      <p className="font-medium text-neutral-900 text-sm">{t.question}</p>

      {/* Score grid 1-10 */}
      <div className="grid grid-cols-5 gap-2">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
          <button
            key={n}
            onClick={() => setScore(n)}
            className={`h-10 rounded-lg text-sm font-semibold border transition-colors ${
              score === n
                ? 'bg-black text-white border-black'
                : 'bg-white text-neutral-700 border-neutral-200 hover:border-neutral-400'
            }`}
          >
            {n}
          </button>
        ))}
      </div>

      <div className="flex justify-between text-xs text-neutral-400">
        <span>{t.low}</span>
        <span>{t.high}</span>
      </div>

      {/* Comment */}
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder={t.placeholder}
        rows={3}
        className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm text-neutral-800 resize-none focus:outline-none focus:ring-1 focus:ring-neutral-400"
      />

      <button
        onClick={handleSubmit}
        disabled={score === null || submitting}
        className="w-full bg-black text-white rounded-full py-3 text-sm font-medium hover:bg-neutral-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {t.submit}
      </button>

      {/* Show Google review prompt for high scores */}
      {score !== null && score >= 9 && (
        <p className="text-xs text-neutral-500 text-center">
          Excellent ! Vous pouvez aussi nous laisser un avis Google.
        </p>
      )}
    </div>
  );
}

// ─── ThankYouPage ─────────────────────────────────────────────────────────────

export default function ThankYouPage() {
  const { slug } = useParams();
  const [searchParams] = useSearchParams();
  const lang = searchParams.get('lang') || 'fr';
  const redirectStatus = searchParams.get('redirect_status') || 'succeeded';
  const paymentIntentId = searchParams.get('payment_intent') || null;
  const isSuccess = redirectStatus === 'succeeded';

  const [visible, setVisible] = useState(false);

  // Trigger entrance animation after mount
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 50);
    return () => clearTimeout(t);
  }, []);

  const labels = {
    fr: {
      success_title: 'Paiement confirmé !',
      success_sub: 'Votre commande a été transmise à la cuisine.',
      error_title: 'Paiement non abouti',
      error_sub: 'Votre carte n\'a pas été débitée. Veuillez réessayer.',
      retry: 'Réessayer',
      back_menu: 'Retour au menu',
    },
    en: {
      success_title: 'Payment confirmed!',
      success_sub: 'Your order has been sent to the kitchen.',
      error_title: 'Payment failed',
      error_sub: 'Your card was not charged. Please try again.',
      retry: 'Try again',
      back_menu: 'Back to menu',
    },
    es: {
      success_title: '¡Pago confirmado!',
      success_sub: 'Su pedido ha sido enviado a la cocina.',
      error_title: 'Pago fallido',
      error_sub: 'Su tarjeta no fue cobrada. Por favor, inténtelo de nuevo.',
      retry: 'Reintentar',
      back_menu: 'Volver al menú',
    },
  };
  const t = labels[lang] || labels.fr;

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Header */}
      <header className="bg-black text-white sticky top-0 z-40">
        <div className="max-w-xl mx-auto px-4 h-14 flex items-center gap-3">
          <UtensilsCrossed size={20} />
          <span className="text-lg font-semibold tracking-tight">EASY.Q</span>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 py-12 space-y-6">
        {/* Animated icon + title */}
        <div
          className={`flex flex-col items-center gap-4 transition-all duration-500 ${
            visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
          }`}
        >
          {isSuccess ? (
            <div className="relative">
              {/* Pulse rings */}
              <div className="absolute inset-0 rounded-full bg-neutral-300 animate-ping opacity-40" />
              <div className="absolute inset-0 rounded-full bg-neutral-200 animate-pulse opacity-60" />
              <div className="relative rounded-full bg-neutral-900 p-5 shadow-lg">
                <CheckCircle size={48} className="text-white" strokeWidth={1.5} />
              </div>
            </div>
          ) : (
            <div className="rounded-full bg-red-50 p-5">
              <XCircle size={48} className="text-red-500" strokeWidth={1.5} />
            </div>
          )}

          <div className="text-center">
            <h1 className="text-2xl font-bold text-neutral-900">
              {isSuccess ? t.success_title : t.error_title}
            </h1>
            <p className="text-neutral-500 mt-1 text-sm">
              {isSuccess ? t.success_sub : t.error_sub}
            </p>
          </div>
        </div>

        {/* NPS survey (success only) */}
        {isSuccess && (
          <div
            className={`transition-all duration-500 delay-200 ${
              visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
            }`}
          >
            <NPSSurvey slug={slug} lang={lang} paymentIntentId={paymentIntentId} />
          </div>
        )}

        {/* Navigation */}
        <div
          className={`space-y-3 transition-all duration-500 delay-300 ${
            visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
          }`}
        >
          {!isSuccess && (
            <Link
              to={`/menu/${slug}/checkout?lang=${lang}`}
              className="flex items-center justify-between w-full bg-black text-white rounded-full px-5 py-3.5 font-medium hover:bg-neutral-800 transition-colors"
            >
              <span>{t.retry}</span>
              <ChevronRight size={18} />
            </Link>
          )}

          <Link
            to={`/menu/${slug}?lang=${lang}`}
            className="flex items-center justify-between w-full bg-white text-neutral-900 border border-neutral-200 rounded-full px-5 py-3.5 font-medium hover:bg-neutral-50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Home size={16} className="text-neutral-500" />
              <span>{t.back_menu}</span>
            </div>
            <ChevronRight size={18} className="text-neutral-400" />
          </Link>
        </div>
      </main>
    </div>
  );
}
