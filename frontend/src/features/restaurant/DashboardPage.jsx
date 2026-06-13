import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-react';
import DashboardNav from '../../components/DashboardNav';
import {
  Loader2, UtensilsCrossed, QrCode, Upload, Plus,
  ClipboardList, AlertCircle, Languages, Bell, Star, BarChart2, ChefHat,
} from 'lucide-react';
import { api } from '../../api';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(isoStr) {
  try {
    return new Date(isoStr).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

// ─── WaiterCallsBanner ────────────────────────────────────────────────────────

function WaiterCallsBanner({ menu, getToken }) {
  const [calls, setCalls] = useState([]);

  const loadCalls = useCallback(async () => {
    if (!menu?.slug) return;
    try {
      const token = await getToken();
      const data = await api.getWaiterCalls(menu.slug, token);
      setCalls(data.calls || []);
    } catch {
      /* silent — Redis may not be available */
    }
  }, [menu?.slug, getToken]);

  useEffect(() => {
    loadCalls();
    const interval = setInterval(loadCalls, 5_000);
    return () => clearInterval(interval);
  }, [loadCalls]);

  if (calls.length === 0) return null;

  const handleDismiss = async (callId) => {
    const token = await getToken().catch(() => null);
    await api.dismissWaiterCall(menu.slug, callId, token).catch(() => {});
    setCalls((prev) => prev.filter((c) => c.id !== callId));
  };

  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Bell size={16} className="text-neutral-700" />
        <h3 className="font-semibold text-sm text-neutral-900">
          Appels serveur en attente ({calls.length})
        </h3>
      </div>
      <div className="space-y-2">
        {calls.map((call) => (
          <div
            key={call.id}
            className="flex items-center justify-between gap-3 bg-neutral-50 rounded-lg px-3 py-2.5"
          >
            <div className="min-w-0 flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-neutral-900">
                Table {call.table_number}
                {call.table_label ? ` · ${call.table_label}` : ''}
              </span>
              <span className="text-xs text-neutral-500">{call.message}</span>
              <span className="text-xs text-neutral-400">{formatTime(call.timestamp)}</span>
            </div>
            <button
              onClick={() => handleDismiss(call.id)}
              className="text-xs font-medium bg-black text-white rounded-full px-3 py-1 hover:bg-neutral-800 transition-colors shrink-0"
            >
              OK
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── LiveStatsRow ─────────────────────────────────────────────────────────────

function formatEuros(cents) {
  try {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} €`;
  }
}

const ORDER_STATUS_FR = {
  pending: 'En attente',
  confirmed: 'Confirmée',
  in_progress: 'En préparation',
  ready: 'Prête',
  done: 'Servie',
  cancelled: 'Annulée',
};

function LiveStatsRow({ menu, getToken }) {
  const [stats, setStats] = useState(null);

  const load = useCallback(async () => {
    if (!menu?.slug) return;
    try {
      const token = await getToken();
      const data = await api.getLiveStats(menu.slug, token);
      setStats(data);
    } catch {
      /* silent */
    }
  }, [menu?.slug, getToken]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, [load]);

  if (!stats) return null;

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Tables occupées"
          value={`${stats.active_tables} / ${stats.total_tables}`}
          sub="en ce moment"
        />
        <StatCard
          label="Commandes en cours"
          value={stats.pending_orders + stats.in_progress_orders}
          sub={`${stats.ready_orders} prête${stats.ready_orders !== 1 ? 's' : ''} à servir`}
        />
        <StatCard
          label="CA du jour"
          value={formatEuros(stats.today_revenue_cents)}
          sub={`${stats.today_orders_count} commande${stats.today_orders_count !== 1 ? 's' : ''}`}
        />
        <div className={`rounded-xl border p-5 ${stats.waiter_calls_pending > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-neutral-200'}`}>
          <p className="text-xs text-neutral-500 mb-1">Appels en attente</p>
          <p className={`text-2xl font-semibold ${stats.waiter_calls_pending > 0 ? 'text-red-700' : 'text-neutral-900'}`}>
            {stats.waiter_calls_pending}
          </p>
          <p className="text-xs text-neutral-400 mt-1">appels serveur</p>
        </div>
      </div>

      {stats.recent_orders?.length > 0 && (
        <div className="bg-white border border-neutral-200 rounded-xl p-5">
          <h3 className="font-semibold text-sm text-neutral-900 mb-3">Dernières commandes</h3>
          <div className="divide-y divide-neutral-100">
            {stats.recent_orders.map((o) => (
              <div key={o.id} className="py-2.5 flex items-center justify-between gap-3 text-sm">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-neutral-400 text-xs shrink-0">#{o.id}</span>
                  <span className="text-neutral-700">
                    {o.items_count} article{o.items_count !== 1 ? 's' : ''}
                  </span>
                  <span className="text-xs text-neutral-400">{formatTime(o.created_at)}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs bg-neutral-100 text-neutral-600 px-2 py-0.5 rounded-full">
                    {ORDER_STATUS_FR[o.status] || o.status}
                  </span>
                  <span className="font-medium text-neutral-900">{formatEuros(o.total)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// ─── StatCard ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub }) {
  return (
    <div className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 p-5">
      <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-1">{label}</p>
      <p className="text-2xl font-semibold text-neutral-900 dark:text-white">{value}</p>
      {sub && <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1">{sub}</p>}
    </div>
  );
}

// ─── StatusBadge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const map = {
    ready:      'bg-neutral-100 text-neutral-700',
    processing: 'bg-neutral-200 text-neutral-600',
    error:      'bg-neutral-200 text-neutral-500',
  };
  const label = { ready: 'publié', processing: 'traitement…', error: 'erreur' };
  return (
    <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${map[status] || map.ready}`}>
      {label[status] || status}
    </span>
  );
}

// ─── ActiveMenuCard ───────────────────────────────────────────────────────────

function ActiveMenuCard({ menu }) {
  if (!menu) {
    return (
      <div className="bg-white border border-neutral-200 rounded-xl p-5 text-center text-neutral-400 text-sm">
        Aucun menu — <Link to="/upload" className="text-neutral-900 hover:underline">uploader un menu</Link>
      </div>
    );
  }

  const langs = (menu.languages || 'fr').split(',').filter(Boolean);

  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900">{menu.restaurant_name}</h2>
          <p className="text-xs text-neutral-400 mt-0.5">/{menu.slug}</p>
        </div>
        <StatusBadge status={menu.status} />
      </div>

      <div className="flex items-center gap-4 text-sm text-neutral-500 mb-4">
        <span>{menu.section_count} section{menu.section_count !== 1 ? 's' : ''}</span>
        <span>·</span>
        <span>{menu.item_count} plat{menu.item_count !== 1 ? 's' : ''}</span>
        <span>·</span>
        <span className="flex items-center gap-1">
          <Languages size={13} />
          {langs.join(', ').toUpperCase()}
        </span>
      </div>

      <div className="flex flex-wrap gap-3 text-sm">
        <Link
          to={`/menus/${menu.id}/edit`}
          className="text-neutral-900 hover:underline"
        >
          Éditer
        </Link>
        <Link
          to={`/menus/${menu.id}/translate`}
          className="text-neutral-900 hover:underline"
        >
          Traduire
        </Link>
        <Link
          to={`/restaurant/${menu.slug}/settings`}
          className="text-neutral-900 hover:underline"
        >
          Paramètres
        </Link>
        <a
          href={`/menu/${menu.slug}`}
          target="_blank"
          rel="noreferrer"
          className="text-neutral-900 hover:underline"
        >
          Voir le menu ↗
        </a>
      </div>
    </div>
  );
}

// ─── QRCodesCard ──────────────────────────────────────────────────────────────

function QRCodesCard({ menu, getToken }) {
  const [downloading, setDownloading] = useState(false);

  if (!menu) return null;

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const token = await getToken().catch(() => null);
      await api.downloadTableQrPdf(menu.slug, menu.restaurant_name, {}, token);
    } catch {
      /* silent */
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-5">
      <div className="flex items-center gap-2 mb-3">
        <QrCode size={18} className="text-neutral-500" />
        <h3 className="font-semibold text-neutral-900">Codes QR</h3>
      </div>
      <p className="text-sm text-neutral-700 mb-4">
        {menu.table_count > 0
          ? `${menu.table_count} table${menu.table_count !== 1 ? 's' : ''} configurée${menu.table_count !== 1 ? 's' : ''}`
          : 'Aucune table — ajoutez des tables pour générer les QR codes.'}
      </p>
      <div className="flex flex-wrap gap-3">
        {menu.table_count > 0 && (
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="flex items-center gap-2 bg-black text-white rounded-full px-4 py-2 text-sm hover:bg-neutral-800 disabled:opacity-60 transition-colors"
          >
            {downloading ? <Loader2 size={14} className="animate-spin" /> : <QrCode size={14} />}
            Télécharger tous les QR (PDF)
          </button>
        )}
        <Link
          to={`/tables/${menu.slug}`}
          className="flex items-center gap-2 border border-neutral-300 rounded-full px-4 py-2 text-sm hover:border-neutral-500 transition-colors"
        >
          <Plus size={14} />
          Gérer les tables
        </Link>
      </div>
    </div>
  );
}

// ─── ReviewsAnalyticsCard ─────────────────────────────────────────────────────

function ReviewsAnalyticsCard({ menu, getToken }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!menu?.slug) return;
    getToken()
      .then((token) => api.getReviewAnalytics(menu.slug, token))
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [menu?.slug, getToken]);

  if (!menu) return null;
  if (loading) return null;
  if (!data || data.total === 0) return null;

  const npsColor = data.nps_score >= 50
    ? 'text-neutral-900'
    : data.nps_score >= 0
    ? 'text-neutral-600'
    : 'text-neutral-400';

  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <Star size={16} className="text-neutral-500" />
        <h3 className="font-semibold text-neutral-900">Avis clients</h3>
        <span className="ml-auto text-xs text-neutral-400">{data.total} avis</span>
      </div>

      <div className="grid grid-cols-3 gap-3 sm:gap-4 mb-4">
        <div className="text-center">
          <p className="text-2xl font-semibold text-neutral-900">
            {data.average_nps ?? '—'}
          </p>
          <p className="text-xs text-neutral-400 mt-0.5">NPS moyen /10</p>
        </div>
        <div className="text-center">
          <p className={`text-2xl font-semibold ${npsColor}`}>
            {data.nps_score != null ? `${data.nps_score > 0 ? '+' : ''}${data.nps_score}` : '—'}
          </p>
          <p className="text-xs text-neutral-400 mt-0.5">Score NPS</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-semibold text-neutral-900">{data.promoters}</p>
          <p className="text-xs text-neutral-400 mt-0.5">Promoteurs (9-10)</p>
        </div>
      </div>

      <div className="flex gap-2 text-xs mb-4">
        <span className="bg-neutral-100 text-neutral-700 px-2 py-1 rounded-full">
          {data.detractors} détracteurs
        </span>
        <span className="bg-neutral-100 text-neutral-600 px-2 py-1 rounded-full">
          {data.passives} passifs
        </span>
        <span className="bg-neutral-100 text-neutral-700 px-2 py-1 rounded-full">
          {data.promoters} promoteurs
        </span>
      </div>

      {data.recent?.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-neutral-400 uppercase tracking-wider">
            Derniers avis
          </p>
          {data.recent.slice(0, 3).map((review, i) => (
            <div
              key={i}
              className="flex items-start gap-3 bg-neutral-50 rounded-lg px-3 py-2.5"
            >
              <span className="text-sm font-semibold text-neutral-900 shrink-0">
                {review.nps_score}/10
              </span>
              {review.comment && (
                <p className="text-sm text-neutral-600 truncate">{review.comment}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


// ─── QuickActionsCard ─────────────────────────────────────────────────────────

function ActionTile({ to, icon: Icon, label, sub }) {
  return (
    <Link
      to={to}
      className="bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl p-5 hover:border-neutral-400 dark:hover:border-neutral-500 transition-colors flex flex-col gap-2"
    >
      <Icon size={20} className="text-neutral-500 dark:text-neutral-400" />
      <p className="font-medium text-neutral-900 dark:text-white text-sm">{label}</p>
      {sub && <p className="text-xs text-neutral-400 dark:text-neutral-500">{sub}</p>}
    </Link>
  );
}

function KdsTile({ menu, getToken }) {
  const [loading, setLoading] = useState(false);

  async function openKds() {
    if (!menu) return;
    setLoading(true);
    try {
      const authToken = await getToken();
      const { token } = await api.getKdsToken(menu.slug, authToken);
      window.open(`/kds/${menu.slug}?token=${token}`, '_blank', 'noopener');
    } catch {
      window.open(`/kds/${menu.slug}`, '_blank', 'noopener');
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={openKds}
      disabled={!menu || loading}
      className="bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl p-5 hover:border-neutral-400 dark:hover:border-neutral-500 transition-colors flex flex-col gap-2 text-left disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {loading ? <Loader2 size={20} className="text-neutral-500 animate-spin" /> : <ChefHat size={20} className="text-neutral-500 dark:text-neutral-400" />}
      <p className="font-medium text-neutral-900 dark:text-white text-sm">Écran cuisine (KDS)</p>
      <p className="text-xs text-neutral-400 dark:text-neutral-500">Ouvre sur la tablette cuisine</p>
    </button>
  );
}

function QuickActionsCard({ menu, getToken }) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-3">
        Actions rapides
      </h3>
      <div className="grid gap-4 md:grid-cols-3">
        <ActionTile
          to="/upload"
          icon={Upload}
          label="Uploader une nouvelle carte"
          sub="PDF ou image, OCR automatique"
        />
        <ActionTile
          to={menu ? `/tables/${menu.slug}` : '/upload'}
          icon={Plus}
          label="Ajouter des tables"
          sub="Génération QR par table"
        />
        <ActionTile
          to={menu ? `/dashboard/${menu.slug}` : '/dashboard/conversations'}
          icon={ClipboardList}
          label="Voir les conversations"
          sub="Historique chatbot IA"
        />
        <ActionTile
          to={menu ? `/analytics?slug=${menu.slug}` : '/analytics'}
          icon={BarChart2}
          label="Analytiques"
          sub="Revenus, couverts, chatbot"
        />
        <KdsTile menu={menu} getToken={getToken} />
      </div>
    </div>
  );
}

// ─── DashboardPage ────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { getToken } = useAuth();
  const navigate = useNavigate();

  const { data, isLoading: loading, isError } = useQuery({
    queryKey: ['dashboard-menus'],
    queryFn: async () => api.getDashboardMenus(await getToken()),
  });
  const menus = data?.menus || [];
  const error = isError ? 'Impossible de charger le tableau de bord.' : '';

  const activeMenu = menus[0] || null;
  const totalSections = menus.reduce((s, m) => s + (m.section_count || 0), 0);
  const totalItems = menus.reduce((s, m) => s + (m.item_count || 0), 0);
  const totalTables = menus.reduce((s, m) => s + (m.table_count || 0), 0);

  return (
    <div className="min-h-dvh bg-neutral-50 dark:bg-neutral-900">
      {/* Header */}
      <header className="bg-black text-white sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <UtensilsCrossed size={18} />
            <span className="font-semibold">Tableau de bord</span>
          </div>
          <Link to="/upload" className="text-sm text-neutral-300 hover:text-white transition-colors">
            + Nouveau menu
          </Link>
        </div>
        <DashboardNav slug={activeMenu?.slug} />
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8 space-y-6">

        {loading ? (
          <div className="flex items-center gap-2 text-neutral-500">
            <Loader2 size={18} className="animate-spin" /> Chargement…
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 text-neutral-600 bg-white border border-neutral-200 rounded-xl p-4">
            <AlertCircle size={16} /> {error}
          </div>
        ) : menus.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-16 h-16 bg-neutral-100 rounded-2xl flex items-center justify-center mb-6">
              <QrCode size={28} className="text-neutral-400" />
            </div>
            <h2 className="text-xl font-semibold text-neutral-900 mb-2">Aucun menu pour l'instant</h2>
            <p className="text-sm text-neutral-500 max-w-xs mb-8">
              Importez votre carte PDF et notre IA crée votre menu digital en quelques minutes.
            </p>
            <button
              onClick={() => navigate('/onboarding')}
              className="bg-black text-white px-6 py-3 rounded-full font-medium hover:bg-neutral-800 transition-colors"
            >
              Créer mon premier menu
            </button>
          </div>
        ) : (
          <>
            {/* Waiter call notifications */}
            {activeMenu && <WaiterCallsBanner menu={activeMenu} getToken={getToken} />}

            {/* Live widgets */}
            {activeMenu && <LiveStatsRow menu={activeMenu} getToken={getToken} />}

            {/* Stat row (placeholders — remplis Phase 5) */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label="Menus" value={menus.length} sub="total" />
              <StatCard label="Sections" value={totalSections} sub="dans tous les menus" />
              <StatCard label="Plats" value={totalItems} sub="référencés" />
              <StatCard label="Tables" value={totalTables} sub="actives" />
            </div>

            {/* Menu actif */}
            <div>
              <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-3">
                Menu actif
              </h3>
              <ActiveMenuCard menu={activeMenu} />
            </div>

            {/* Autres menus (si > 1) */}
            {menus.length > 1 && (
              <div>
                <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-3">
                  Autres menus ({menus.length - 1})
                </h3>
                <div className="grid gap-3 md:grid-cols-2">
                  {menus.slice(1).map((m) => (
                    <div
                      key={m.id}
                      className="bg-white border border-neutral-200 rounded-xl p-4 flex items-center justify-between"
                    >
                      <div>
                        <p className="font-medium text-neutral-900 text-sm">{m.restaurant_name}</p>
                        <p className="text-xs text-neutral-400 mt-0.5">{m.item_count} plats · {m.section_count} sections</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <StatusBadge status={m.status} />
                        <Link to={`/menus/${m.id}/edit`} className="text-xs text-neutral-900 hover:underline">
                          Éditer
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* QR Codes */}
            {activeMenu && <QRCodesCard menu={activeMenu} getToken={getToken} />}

            {/* Review analytics */}
            {activeMenu && <ReviewsAnalyticsCard menu={activeMenu} getToken={getToken} />}

            {/* Quick actions */}
            <QuickActionsCard menu={activeMenu} getToken={getToken} />
          </>
        )}
      </main>
    </div>
  );
}
