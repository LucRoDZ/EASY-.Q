/**
 * AdminDashboardPage — superadmin backoffice.
 *
 * Tabs:
 *  1. Overview  — global KPI cards
 *  2. Restaurants — list with plan badge + suspend action
 *  3. Subscriptions — all subscription records
 *  4. Audit Logs — paginated log viewer with filters
 */

import { useEffect, useState, useCallback } from 'react';
import {
  Loader2, LayoutDashboard, Store, CreditCard,
  ScrollText, RefreshCw, ChevronLeft, ChevronRight,
  Search, AlertCircle, Lock,
} from 'lucide-react';
import { api } from '../../api';

const TOKEN_KEY = 'admin_clerk_token';

function useAdminToken() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || '');
  const save = (t) => { localStorage.setItem(TOKEN_KEY, t); setToken(t); };
  const clear = () => { localStorage.removeItem(TOKEN_KEY); setToken(''); };
  return [token, save, clear];
}

function TokenGate({ children }) {
  const [token, saveToken] = useAdminToken();
  const [input, setInput] = useState('');

  if (token) return children;

  return (
    <div className="min-h-dvh bg-neutral-50 flex items-center justify-center px-4">
      <div className="bg-white border border-neutral-200 rounded-xl p-8 w-full max-w-sm space-y-4">
        <div className="flex items-center gap-2 text-neutral-900">
          <Lock size={18} />
          <span className="font-semibold">Accès admin</span>
        </div>
        <p className="text-sm text-neutral-500">Entrez votre token Clerk (JWT Bearer).</p>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={4}
          placeholder="eyJ..."
          className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-xs font-mono resize-none focus:outline-none focus:border-neutral-400"
        />
        <button
          onClick={() => saveToken(input.trim())}
          disabled={!input.trim()}
          className="w-full bg-black text-white rounded-full py-2 text-sm hover:bg-neutral-800 disabled:opacity-40"
        >
          Confirmer
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared UI primitives
// ---------------------------------------------------------------------------

function KpiCard({ label, value, sub }) {
  return (
    <div className="bg-white rounded-xl border border-neutral-200 p-5">
      <p className="text-2xl font-semibold text-neutral-900">{value ?? '—'}</p>
      <p className="text-sm text-neutral-500 mt-0.5">{label}</p>
      {sub && <p className="text-xs text-neutral-400 mt-1">{sub}</p>}
    </div>
  );
}

function PlanBadge({ plan }) {
  return plan === 'pro' ? (
    <span className="bg-black text-white text-xs rounded-full px-2 py-0.5 font-medium">Pro</span>
  ) : (
    <span className="bg-neutral-100 text-neutral-600 text-xs rounded-full px-2 py-0.5 font-medium">Free</span>
  );
}

function StatusBadge({ status }) {
  const active = status === 'active';
  return (
    <span className={`text-xs rounded-full px-2 py-0.5 font-medium ${active ? 'bg-neutral-100 text-neutral-700' : 'bg-neutral-200 text-neutral-400'}`}>
      {active ? 'Actif' : 'Suspendu'}
    </span>
  );
}

function EmptyState({ message }) {
  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-10 text-center text-sm text-neutral-400">
      {message}
    </div>
  );
}

function LoadingSpinner() {
  return (
    <div className="flex items-center gap-2 text-neutral-500 py-8">
      <Loader2 size={18} className="animate-spin" />
      Chargement…
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Overview
// ---------------------------------------------------------------------------

function OverviewTab({ token }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getAdminStats(token).then(setStats).finally(() => setLoading(false));
  }, [token]);

  if (loading) return <LoadingSpinner />;
  if (!stats) return <EmptyState message="Impossible de charger les statistiques." />;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <KpiCard label="Restaurants" value={stats.total_restaurants} sub={`${stats.active_restaurants} actifs`} />
      <KpiCard label="Abonnés Pro" value={stats.pro_subscriptions} sub={`${stats.free_subscriptions} Free`} />
      <KpiCard label="Revenu total" value={`${stats.total_revenue_eur.toFixed(2)} €`} sub="paiements réussis" />
      <KpiCard label="Commandes" value={stats.total_orders} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Restaurants
// ---------------------------------------------------------------------------

function RestaurantsTab({ token }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(null); // slug being confirmed
  const [updating, setUpdating] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api.getAdminRestaurants(token).then(setData).finally(() => setLoading(false));
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const handleToggleStatus = async (slug, currentStatus) => {
    const next = currentStatus === 'published' ? 'draft' : 'published';
    setUpdating(slug);
    setConfirming(null);
    try {
      await api.patchAdminRestaurantStatus(slug, next, token);
      setData((prev) => ({
        ...prev,
        restaurants: prev.restaurants.map((r) =>
          r.slug === slug ? { ...r, publish_status: next } : r
        ),
      }));
    } finally {
      setUpdating(null);
    }
  };

  if (loading) return <LoadingSpinner />;
  if (!data) return <EmptyState message="Aucun restaurant." />;

  const restaurants = data.restaurants || [];

  return (
    <div className="space-y-4">
      <p className="text-xs text-neutral-400">{restaurants.length} restaurant{restaurants.length !== 1 ? 's' : ''}</p>

      {restaurants.length === 0 ? (
        <EmptyState message="Aucun restaurant enregistré." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {restaurants.map((r) => (
            <div
              key={r.slug}
              className="bg-white border border-neutral-200 rounded-xl p-5 hover:border-neutral-400 transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-neutral-900 truncate">{r.restaurant_name || r.slug}</p>
                  <p className="text-xs text-neutral-400 mt-0.5 font-mono">{r.slug}</p>
                  <p className="text-xs text-neutral-400 mt-1">
                    Créé le {r.created_at ? new Date(r.created_at).toLocaleDateString('fr-FR') : '—'}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <PlanBadge plan={r.plan} />
                  <StatusBadge status={r.publish_status} />
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between">
                <div className="flex gap-1.5">
                  {(r.languages || []).map((lang) => (
                    <span key={lang} className="text-xs bg-neutral-50 border border-neutral-200 rounded px-1.5 py-0.5 text-neutral-500 uppercase">
                      {lang}
                    </span>
                  ))}
                </div>

                {confirming === r.slug ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-neutral-500">Confirmer ?</span>
                    <button
                      onClick={() => handleToggleStatus(r.slug, r.publish_status)}
                      disabled={updating === r.slug}
                      className="text-xs border border-neutral-900 text-neutral-900 rounded-full px-3 py-1 hover:bg-neutral-900 hover:text-white transition-colors disabled:opacity-50"
                    >
                      {updating === r.slug ? <Loader2 size={12} className="animate-spin" /> : 'Oui'}
                    </button>
                    <button
                      onClick={() => setConfirming(null)}
                      className="text-xs border border-neutral-200 text-neutral-500 rounded-full px-3 py-1 hover:bg-neutral-50 transition-colors"
                    >
                      Non
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirming(r.slug)}
                    className="text-xs border border-neutral-200 rounded-full px-3 py-1 text-neutral-600 hover:border-neutral-400 transition-colors"
                  >
                    {r.publish_status === 'published' ? 'Suspendre' : 'Réactiver'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Subscriptions
// ---------------------------------------------------------------------------

function SubscriptionsTab({ token }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getAdminSubscriptions(token).then(setData).finally(() => setLoading(false));
  }, [token]);

  if (loading) return <LoadingSpinner />;

  const subs = data?.subscriptions || [];

  return (
    <div className="space-y-3">
      <p className="text-xs text-neutral-400">{subs.length} abonnement{subs.length !== 1 ? 's' : ''}</p>
      {subs.length === 0 ? (
        <EmptyState message="Aucun abonnement enregistré." />
      ) : (
        <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-neutral-50 border-b border-neutral-200">
                <tr>
                  {['Restaurant', 'Plan', 'Statut', 'Fin période', 'Créé le'].map((h) => (
                    <th key={h} className="text-left text-xs text-neutral-500 font-medium px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {subs.map((s) => (
                  <tr key={s.id} className="hover:bg-neutral-50">
                    <td className="px-4 py-3 font-mono text-xs text-neutral-600">{s.restaurant_id}</td>
                    <td className="px-4 py-3"><PlanBadge plan={s.plan} /></td>
                    <td className="px-4 py-3"><StatusBadge status={s.status} /></td>
                    <td className="px-4 py-3 text-xs text-neutral-400">
                      {s.current_period_end
                        ? new Date(s.current_period_end).toLocaleDateString('fr-FR')
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-neutral-400">
                      {s.created_at ? new Date(s.created_at).toLocaleDateString('fr-FR') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Audit Logs
// ---------------------------------------------------------------------------

const PAGE_SIZE = 50;

function AuditLogsTab({ token }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ action: '', resource_type: '', resource_id: '' });
  const [offset, setOffset] = useState(0);

  const load = useCallback(() => {
    setLoading(true);
    api.getAdminAuditLogs(token, { ...filters, limit: PAGE_SIZE, offset })
      .then(setData)
      .finally(() => setLoading(false));
  }, [token, filters, offset]);

  useEffect(() => { load(); }, [load]);

  const handleFilterChange = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setOffset(0);
  };

  const logs = data?.logs || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  const formatDate = (iso) => {
    try {
      return new Date(iso).toLocaleString('fr-FR', {
        day: '2-digit', month: '2-digit', year: '2-digit',
        hour: '2-digit', minute: '2-digit',
      });
    } catch { return iso || '—'; }
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input
            type="text"
            value={filters.action}
            onChange={(e) => handleFilterChange('action', e.target.value)}
            placeholder="Filtrer par action…"
            className="w-full pl-8 pr-3 py-2 bg-white border border-neutral-200 rounded-xl text-sm placeholder-neutral-400 focus:outline-none focus:ring-1 focus:ring-neutral-400"
          />
        </div>
        <input
          type="text"
          value={filters.resource_type}
          onChange={(e) => handleFilterChange('resource_type', e.target.value)}
          placeholder="Type de ressource…"
          className="w-full sm:w-48 px-3 py-2 bg-white border border-neutral-200 rounded-xl text-sm placeholder-neutral-400 focus:outline-none focus:ring-1 focus:ring-neutral-400"
        />
        <input
          type="text"
          value={filters.resource_id}
          onChange={(e) => handleFilterChange('resource_id', e.target.value)}
          placeholder="ID ressource…"
          className="w-full sm:w-40 px-3 py-2 bg-white border border-neutral-200 rounded-xl text-sm placeholder-neutral-400 focus:outline-none focus:ring-1 focus:ring-neutral-400"
        />
        <button
          onClick={load}
          className="p-2 border border-neutral-200 rounded-xl text-neutral-500 hover:bg-neutral-50 transition-colors"
          title="Rafraîchir"
        >
          <RefreshCw size={15} />
        </button>
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : logs.length === 0 ? (
        <EmptyState message="Aucun événement correspondant." />
      ) : (
        <>
          <p className="text-xs text-neutral-400">{total} événement{total !== 1 ? 's' : ''}</p>
          <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="bg-neutral-50 border-b border-neutral-200">
                  <tr>
                    {['Date', 'Acteur', 'Action', 'Ressource', 'ID'].map((h) => (
                      <th key={h} className="text-left text-xs text-neutral-500 font-medium px-4 py-3">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {logs.map((log) => (
                    <tr key={log.id} className="hover:bg-neutral-50">
                      <td className="px-4 py-2.5 text-xs text-neutral-400 whitespace-nowrap">{formatDate(log.created_at)}</td>
                      <td className="px-4 py-2.5 text-xs text-neutral-600">{log.actor_type}{log.actor_id ? `/${log.actor_id.slice(0, 8)}` : ''}</td>
                      <td className="px-4 py-2.5 text-xs font-mono text-neutral-800">{log.action}</td>
                      <td className="px-4 py-2.5 text-xs text-neutral-400">{log.resource_type || '—'}</td>
                      <td className="px-4 py-2.5 text-xs font-mono text-neutral-400">{log.resource_id || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-xs text-neutral-400">Page {currentPage} / {totalPages}</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                  disabled={offset === 0}
                  className="p-1.5 border border-neutral-200 rounded-lg text-neutral-500 hover:bg-neutral-50 disabled:opacity-40"
                >
                  <ChevronLeft size={15} />
                </button>
                <button
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                  disabled={offset + PAGE_SIZE >= total}
                  className="p-1.5 border border-neutral-200 rounded-lg text-neutral-500 hover:bg-neutral-50 disabled:opacity-40"
                >
                  <ChevronRight size={15} />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

const TABS = [
  { id: 'overview',       label: 'Vue d\'ensemble', icon: LayoutDashboard },
  { id: 'restaurants',    label: 'Restaurants',      icon: Store },
  { id: 'subscriptions',  label: 'Abonnements',      icon: CreditCard },
  { id: 'audit-logs',     label: 'Audit Logs',       icon: ScrollText },
];

export default function AdminDashboardPage() {
  const [activeTab, setActiveTab] = useState('overview');
  const [token, , clearToken] = useAdminToken();

  return (
    <TokenGate>
      <div className="min-h-dvh bg-neutral-50">
        {/* Header */}
        <header className="bg-black text-white sticky top-0 z-40">
          <div className="max-w-5xl mx-auto px-4 h-14 flex items-center gap-3">
            <AlertCircle size={18} className="text-neutral-400" />
            <span className="font-semibold">Admin</span>
            <span className="text-neutral-500 text-sm hidden sm:inline">· Backoffice superadmin</span>
            <button
              onClick={clearToken}
              className="ml-auto text-xs text-neutral-400 hover:text-white transition-colors"
            >
              Déconnexion
            </button>
          </div>
        </header>

        {/* Tab nav */}
        <div className="border-b border-neutral-200 bg-white sticky top-14 z-30">
          <div className="max-w-5xl mx-auto px-4 flex gap-0 overflow-x-auto">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`flex items-center gap-1.5 px-4 py-3 text-sm border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === id
                    ? 'border-black text-neutral-900 font-medium'
                    : 'border-transparent text-neutral-500 hover:text-neutral-700'
                }`}
              >
                <Icon size={14} />
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <main className="max-w-5xl mx-auto px-4 py-8">
          {activeTab === 'overview'      && <OverviewTab token={token} />}
          {activeTab === 'restaurants'   && <RestaurantsTab token={token} />}
          {activeTab === 'subscriptions' && <SubscriptionsTab token={token} />}
          {activeTab === 'audit-logs'    && <AuditLogsTab token={token} />}
        </main>
      </div>
    </TokenGate>
  );
}
