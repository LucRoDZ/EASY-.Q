/**
 * ReservePage — formulaire public de réservation de table.
 *
 * Route : /menu/:slug/reserve
 */

import { useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { ArrowLeft, CalendarCheck, CheckCircle, Loader2 } from 'lucide-react';
import { api } from '../../api';

export default function ReservePage() {
  const { slug } = useParams();
  const [searchParams] = useSearchParams();
  const lang = searchParams.get('lang') || 'fr';

  const today = new Date().toISOString().slice(0, 10);

  const [form, setForm] = useState({
    name: '',
    phone: '',
    email: '',
    party_size: 2,
    date: today,
    time: '19:30',
    notes: '',
  });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSending(true);
    setError('');
    try {
      await api.createReservation(slug, {
        ...form,
        party_size: Number(form.party_size),
        email: form.email || null,
        notes: form.notes || null,
      });
      setDone(true);
    } catch (err) {
      setError(err.message || 'Impossible d’envoyer la réservation.');
    } finally {
      setSending(false);
    }
  };

  if (done) {
    return (
      <div className="min-h-dvh bg-neutral-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl border border-neutral-200 p-8 max-w-sm w-full text-center">
          <CheckCircle className="w-14 h-14 text-green-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-neutral-900 mb-2">Demande envoyée !</h2>
          <p className="text-sm text-neutral-500 mb-6">
            {form.date} à {form.time} · {form.party_size} pers.
            <br />Le restaurant vous confirmera rapidement
            {form.email ? ' par email' : ''}.
          </p>
          <Link
            to={`/menu/${slug}?lang=${lang}`}
            className="inline-block bg-black text-white px-6 py-3 rounded-full font-medium hover:bg-neutral-800 transition-colors"
          >
            Retour au menu
          </Link>
        </div>
      </div>
    );
  }

  const inputClass =
    'w-full px-4 py-3 bg-white border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black';

  return (
    <div className="min-h-dvh bg-neutral-50">
      <header className="bg-black text-white sticky top-0 z-40">
        <div className="max-w-md mx-auto px-4 h-14 flex items-center gap-4">
          <Link
            to={`/menu/${slug}?lang=${lang}`}
            className="p-2 -ml-2 hover:bg-neutral-800 rounded-full transition-colors"
            aria-label="Retour au menu"
          >
            <ArrowLeft size={20} />
          </Link>
          <h1 className="text-lg font-semibold tracking-tight">Réserver une table</h1>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 py-8">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="text-center mb-2">
            <div className="w-14 h-14 bg-neutral-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <CalendarCheck className="h-7 w-7 text-neutral-600" />
            </div>
          </div>

          <div>
            <label htmlFor="resa-name" className="block text-sm font-medium text-neutral-700 mb-1.5">Nom *</label>
            <input id="resa-name" required value={form.name} onChange={set('name')} placeholder="Jean Dupont" className={inputClass} />
          </div>

          <div>
            <label htmlFor="resa-phone" className="block text-sm font-medium text-neutral-700 mb-1.5">Téléphone *</label>
            <input id="resa-phone" required type="tel" value={form.phone} onChange={set('phone')} placeholder="+33 6 12 34 56 78" className={inputClass} />
          </div>

          <div>
            <label htmlFor="resa-email" className="block text-sm font-medium text-neutral-700 mb-1.5">Email (pour la confirmation)</label>
            <input id="resa-email" type="email" value={form.email} onChange={set('email')} placeholder="jean@exemple.fr" className={inputClass} />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label htmlFor="resa-date" className="block text-sm font-medium text-neutral-700 mb-1.5">Date *</label>
              <input id="resa-date" required type="date" min={today} value={form.date} onChange={set('date')} className={inputClass} />
            </div>
            <div>
              <label htmlFor="resa-time" className="block text-sm font-medium text-neutral-700 mb-1.5">Heure *</label>
              <input id="resa-time" required type="time" value={form.time} onChange={set('time')} className={inputClass} />
            </div>
            <div>
              <label htmlFor="resa-size" className="block text-sm font-medium text-neutral-700 mb-1.5">Couverts *</label>
              <select id="resa-size" value={form.party_size} onChange={set('party_size')} className={inputClass}>
                {[1, 2, 3, 4, 5, 6, 7, 8, 10, 12].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="resa-notes" className="block text-sm font-medium text-neutral-700 mb-1.5">Remarques</label>
            <textarea
              id="resa-notes"
              rows={2}
              value={form.notes}
              onChange={set('notes')}
              placeholder="Allergies, poussette, terrasse…"
              className={`${inputClass} resize-none`}
            />
          </div>

          {error && (
            <p role="alert" className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</p>
          )}

          <button
            type="submit"
            disabled={sending}
            className="w-full bg-black text-white py-4 rounded-full font-semibold text-lg hover:bg-neutral-800 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            {sending ? <Loader2 size={18} className="animate-spin" /> : <CalendarCheck size={18} />}
            {sending ? 'Envoi…' : 'Réserver'}
          </button>
        </form>
      </main>
    </div>
  );
}
