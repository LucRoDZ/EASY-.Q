import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, useUser } from '@clerk/clerk-react';
import { api } from '../../api';
import { useUserRole } from '../../context/UserRoleContext';

const STATUS_LABEL = {
  available: { label: 'Disponible', color: 'bg-green-100 text-green-700' },
  occupied: { label: 'Occupée', color: 'bg-amber-100 text-amber-700' },
  reserved: { label: 'Réservée', color: 'bg-blue-100 text-blue-700' },
};

export default function WaiterPage() {
  const { getToken } = useAuth();
  const { user } = useUser();
  const { menuSlug, loading: roleLoading } = useUserRole();
  const navigate = useNavigate();

  const [tables, setTables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (roleLoading) return; // attendre que le contexte soit prêt
    setError(null);
    if (!menuSlug) {
      setLoading(false);
      setError('Aucun restaurant associé à ce compte. Contactez votre responsable.');
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const token = await getToken();
        const data = await api.listTables(menuSlug, false, token);
        if (!cancelled) setTables(data.tables ?? data ?? []);
      } catch {
        if (!cancelled) setError('Impossible de charger les tables.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [roleLoading, menuSlug, getToken]);

  function handleTableClick(table) {
    navigate(`/menu/${menuSlug}?table=${table.qr_token}`);
  }

  return (
    <div className="min-h-dvh bg-neutral-50">
      <header className="bg-white border-b border-neutral-200 px-4 py-4">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-neutral-900">Mode serveur</h1>
            {user?.firstName && (
              <p className="text-sm text-neutral-500">Bonjour, {user.firstName}</p>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6">
        <p className="text-sm text-neutral-500 mb-4">
          Sélectionnez une table pour passer une commande.
        </p>

        {loading && (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-2 border-neutral-300 border-t-neutral-800 rounded-full animate-spin" />
          </div>
        )}

        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-4">
            {error}
          </div>
        )}

        {!loading && !error && tables.length === 0 && (
          <p className="text-sm text-neutral-500 text-center py-12">
            Aucune table configurée pour ce restaurant.
          </p>
        )}

        <div className="grid grid-cols-2 gap-3">
          {tables.map((table) => {
            const status = STATUS_LABEL[table.status] ?? STATUS_LABEL.available;
            return (
              <button
                key={table.id}
                onClick={() => handleTableClick(table)}
                className="bg-white rounded-xl border border-neutral-200 p-4 text-left hover:border-neutral-400 hover:shadow-sm transition-all active:scale-95"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-2xl font-bold text-neutral-900">{table.number}</span>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${status.color}`}>
                    {status.label}
                  </span>
                </div>
                {table.label && (
                  <p className="text-xs text-neutral-500 mt-1">{table.label}</p>
                )}
                <p className="text-xs text-neutral-400 mt-1">{table.capacity} pers.</p>
              </button>
            );
          })}
        </div>
      </main>
    </div>
  );
}
