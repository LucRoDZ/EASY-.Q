/**
 * ReservationsPage — gestion des réservations (owner).
 *
 * Route : /reservations/:slug
 * Sélecteur de date + liste du jour avec actions confirmer / installer / annuler / no-show.
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '@clerk/clerk-react';
import { CalendarCheck, Loader2, AlertCircle, Users, Phone } from 'lucide-react';
import { api } from '../../api';

const STATUS_META = {
  pending: { label: 'En attente', color: 'bg-amber-100 text-amber-700' },
  confirmed: { label: 'Confirmée', color: 'bg-green-100 text-green-700' },
  seated: { label: 'Installée', color: 'bg-blue-100 text-blue-700' },
  cancelled: { label: 'Annulée', color: 'bg-neutral-100 text-neutral-400' },
  no_show: { label: 'No-show', color: 'bg-red-100 text-red-700' },
};

const ACTIONS = {
  pending: [
    { status: 'confirmed', label: 'Confirmer', primary: true },
    { status: 'cancelled', label: 'Annuler' },
  ],
  confirmed: [
    { status: 'seated', label: 'Installer', primary: true },
    { status: 'no_show', label: 'No-show' },
    { status: 'cancelled', label: 'Annuler' },
  ],
  seated: [],
  cancelled: [],
  no_show: [],
};

export default function ReservationsPage() {
  const { slug } = useParams();
  const { getToken } = useAuth();

  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [reservations, setReservations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const token = await getToken();
      const data = await api.listReservations(slug, date, token);
      setReservations(data.reservations ?? []);
    } catch {
      setError('Impossible de charger les réservations.');
    } finally {
      setLoading(false);
    }
  }, [slug, date, getToken]);

  useEffect(() => { load(); }, [load]);

  async function handleAction(reservation, status) {
    try {
      const token = await getToken();
      await api.updateReservation(slug, reservation.id, status, token);
      await load();
    } catch {
      // le rechargement suivant rattrapera
    }
  }

  const totalCovers = reservations
    .filter((r) => ['pending', 'confirmed', 'seated'].includes(r.status))
    .reduce((s, r) => s + r.party_size, 0);

  return (
    <div className="min-h-dvh bg-neutral-50">
      <header className="bg-black text-white sticky top-0 z-40">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CalendarCheck size={18} />
            <span className="font-semibold">Réservations</span>
          </div>
          <Link to="/restaurant/dashboard" className="text-sm text-neutral-300 hover:text-white transition-colors">
            ← Tableau de bord
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-5">
        <div className="flex items-center gap-4 flex-wrap">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            aria-label="Date des réservations"
            className="px-4 py-2.5 bg-white border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black"
          />
          <span className="flex items-center gap-1.5 text-sm text-neutral-500">
            <Users size={14} />
            {totalCovers} couvert{totalCovers !== 1 ? 's' : ''} attendus
          </span>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-neutral-500 py-8">
            <Loader2 size={18} className="animate-spin" /> Chargement…
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 text-sm text-red-600 bg-white border border-neutral-200 rounded-xl p-4">
            <AlertCircle size={16} /> {error}
          </div>
        ) : reservations.length === 0 ? (
          <p className="text-sm text-neutral-500 text-center py-16">
            Aucune réservation pour cette date.
          </p>
        ) : (
          <div className="bg-white rounded-xl border border-neutral-200 divide-y divide-neutral-100">
            {reservations.map((r) => {
              const meta = STATUS_META[r.status] || STATUS_META.pending;
              return (
                <div key={r.id} className="p-4 flex items-center gap-4 flex-wrap">
                  <span className="text-lg font-bold text-neutral-900 tabular-nums w-14">{r.time}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-neutral-900 text-sm">{r.name}</p>
                    <p className="text-xs text-neutral-500 flex items-center gap-2 flex-wrap mt-0.5">
                      <span className="flex items-center gap-1"><Users size={11} /> {r.party_size}</span>
                      <a href={`tel:${r.phone}`} className="flex items-center gap-1 hover:text-neutral-800">
                        <Phone size={11} /> {r.phone}
                      </a>
                      {r.notes && <span className="italic">« {r.notes} »</span>}
                    </p>
                  </div>
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full shrink-0 ${meta.color}`}>
                    {meta.label}
                  </span>
                  <div className="flex gap-2 shrink-0">
                    {(ACTIONS[r.status] || []).map(({ status, label, primary }) => (
                      <button
                        key={status}
                        onClick={() => handleAction(r, status)}
                        className={`text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
                          primary
                            ? 'bg-black text-white hover:bg-neutral-800'
                            : 'border border-neutral-300 text-neutral-600 hover:bg-neutral-50'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
