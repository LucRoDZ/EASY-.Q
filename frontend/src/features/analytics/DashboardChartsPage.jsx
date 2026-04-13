/**
 * DashboardChartsPage — analytics dashboard for restaurant owners.
 *
 * Sections:
 *  1. Date range picker (7d / 30d)
 *  2. Summary KPI cards (revenue, covers, avg basket, tips)
 *  3. Daily revenue bar chart (inline SVG)
 *  4. Daily covers bar chart (inline SVG)
 *  5. Chatbot metrics (sessions, messages, avg/session)
 *  6. Top items sold (horizontal bar list)
 *  7. Peak hours heatmap (24h grid)
 *
 * Backend endpoints (already implemented in analytics.py):
 *   GET /api/v1/analytics/summary?slug=&period=
 *   GET /api/v1/analytics/revenue?slug=&period=
 *   GET /api/v1/analytics/covers?slug=&period=
 *   GET /api/v1/analytics/chatbot?slug=&period=
 *   GET /api/v1/analytics/items?slug=&period=
 */

import { useEffect, useState, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  BarChart2, Users, ShoppingBag, MessageSquare,
  TrendingUp, TrendingDown, Minus, ArrowLeft, Loader2,
  UtensilsCrossed, AlertCircle,
} from 'lucide-react';
import { api } from '../../api';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(euros) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(euros);
}

function fmtDelta(delta) {
  if (delta === null || delta === undefined) return null;
  const sign = delta > 0 ? '+' : '';
  return `${sign}${delta}%`;
}

// ---------------------------------------------------------------------------
// Inline bar chart (SVG)
// ---------------------------------------------------------------------------

function BarChart({ data, valueKey, labelKey = 'date', color = '#111827', height = 120 }) {
  if (!data?.length) {
    return <div className="h-28 flex items-center justify-center text-xs text-neutral-400">Aucune donnée</div>;
  }

  const values = data.map((d) => d[valueKey] ?? 0);
  const maxVal = Math.max(...values, 0.01);
  const barWidth = Math.max(4, Math.floor(480 / data.length) - 3);
  const gap = Math.max(2, Math.floor(480 / data.length) - barWidth);
  const totalWidth = data.length * (barWidth + gap) - gap;

  // Format date label: "2026-04-07" → "7/4"
  const shortLabel = (label) => {
    try {
      const parts = label.split('-');
      return `${parseInt(parts[2])}/${parseInt(parts[1])}`;
    } catch {
      return label;
    }
  };

  const labelStep = data.length > 14 ? Math.ceil(data.length / 7) : 1;

  return (
    <svg viewBox={`0 0 ${totalWidth} ${height + 20}`} className="w-full" style={{ height: height + 20 }}>
      {data.map((d, i) => {
        const val = d[valueKey] ?? 0;
        const barH = maxVal > 0 ? Math.max(2, (val / maxVal) * height) : 2;
        const x = i * (barWidth + gap);
        const y = height - barH;
        const showLabel = i % labelStep === 0;

        return (
          <g key={i}>
            <rect
              x={x}
              y={y}
              width={barWidth}
              height={barH}
              rx={2}
              fill={color}
              opacity={0.85}
            />
            {showLabel && (
              <text
                x={x + barWidth / 2}
                y={height + 14}
                textAnchor="middle"
                fontSize={9}
                fill="#9ca3af"
              >
                {shortLabel(d[labelKey] ?? '')}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// KPI Card
// ---------------------------------------------------------------------------

function KpiCard({ icon: Icon, label, value, delta, sub }) {
  const DeltaIcon = delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;
  const deltaColor = delta > 0 ? 'text-neutral-700' : delta < 0 ? 'text-neutral-400' : 'text-neutral-400';

  return (
    <div className="bg-white rounded-xl border border-neutral-200 p-5">
      <div className="flex items-center gap-2 mb-3">
        <Icon size={16} className="text-neutral-400" />
        <p className="text-xs text-neutral-500">{label}</p>
      </div>
      <p className="text-2xl font-semibold text-neutral-900 leading-none">{value}</p>
      {sub && <p className="text-xs text-neutral-400 mt-1">{sub}</p>}
      {delta !== null && delta !== undefined && (
        <div className={`flex items-center gap-1 mt-2 text-xs font-medium ${deltaColor}`}>
          <DeltaIcon size={12} />
          <span>{fmtDelta(delta)} vs période précédente</span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section wrapper
// ---------------------------------------------------------------------------

function Section({ title, children }) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-3">
        {title}
      </h3>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top items
// ---------------------------------------------------------------------------

function TopItemsCard({ items }) {
  if (!items?.length) {
    return (
      <div className="bg-white rounded-xl border border-neutral-200 p-5 text-sm text-neutral-400 text-center">
        Aucune donnée de vente sur cette période.
      </div>
    );
  }

  const maxQty = Math.max(...items.map((i) => i.quantity ?? i.count ?? 0), 1);

  return (
    <div className="bg-white rounded-xl border border-neutral-200 divide-y divide-neutral-100">
      {items.slice(0, 10).map((item, i) => {
        const qty = item.quantity ?? item.count ?? 0;
        const pct = Math.round((qty / maxQty) * 100);
        return (
          <div key={i} className="px-5 py-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium text-neutral-900 truncate max-w-[60%]">
                {item.name}
              </span>
              <span className="text-xs text-neutral-500 shrink-0">
                {qty}× · {fmt(item.revenue ?? 0)}
              </span>
            </div>
            <div className="w-full bg-neutral-100 rounded-full h-1.5">
              <div
                className="bg-neutral-800 h-1.5 rounded-full"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chatbot stats
// ---------------------------------------------------------------------------

function ChatbotCard({ data }) {
  if (!data) return null;

  const stats = [
    { label: 'Sessions', value: data.total_sessions ?? 0 },
    { label: 'Messages', value: data.total_messages ?? 0 },
    { label: 'Moy. messages/session', value: data.avg_messages_per_session ?? 0 },
  ];

  return (
    <div className="bg-white rounded-xl border border-neutral-200 divide-y divide-neutral-100">
      {stats.map((s) => (
        <div key={s.label} className="flex items-center justify-between px-5 py-3.5">
          <span className="text-sm text-neutral-600">{s.label}</span>
          <span className="text-sm font-semibold text-neutral-900">{s.value}</span>
        </div>
      ))}

      {data.daily_sessions?.length > 0 && (
        <div className="px-5 py-4">
          <p className="text-xs text-neutral-400 mb-3">Sessions quotidiennes</p>
          <BarChart
            data={data.daily_sessions}
            valueKey="sessions"
            color="#6b7280"
            height={80}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Peak hours heatmap
// ---------------------------------------------------------------------------

function PeakHoursHeatmap({ heatmap }) {
  if (!heatmap) return null;

  const maxVal = Math.max(...Object.values(heatmap).map(Number), 1);

  return (
    <div className="bg-white rounded-xl border border-neutral-200 p-5">
      <p className="text-xs text-neutral-400 mb-4">Commandes par heure</p>
      <div className="grid grid-cols-12 gap-1">
        {Array.from({ length: 24 }, (_, h) => {
          const val = Number(heatmap[String(h)] ?? 0);
          const opacity = maxVal > 0 ? Math.max(0.08, val / maxVal) : 0.08;
          return (
            <div key={h} className="flex flex-col items-center gap-1">
              <div
                className="w-full rounded aspect-square"
                style={{ background: `rgba(17,24,39,${opacity})` }}
                title={`${h}h: ${val} commandes`}
              />
              {h % 4 === 0 && (
                <span className="text-[9px] text-neutral-400">{h}h</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Period picker
// ---------------------------------------------------------------------------

function PeriodPicker({ period, onChange }) {
  const options = [
    { value: '7d', label: '7 jours' },
    { value: '30d', label: '30 jours' },
  ];

  return (
    <div className="flex rounded-full border border-neutral-200 overflow-hidden bg-white text-sm">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`px-4 py-1.5 transition-colors ${
            period === o.value
              ? 'bg-black text-white'
              : 'text-neutral-600 hover:bg-neutral-50'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function DashboardChartsPage() {
  const [searchParams] = useSearchParams();
  const slug = searchParams.get('slug') || '';
  const [period, setPeriod] = useState('7d');

  const [summary, setSummary] = useState(null);
  const [revenue, setRevenue] = useState(null);
  const [covers, setCovers] = useState(null);
  const [chatbot, setChatbot] = useState(null);
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!slug) {
      setError('Aucun restaurant sélectionné. Passez le paramètre ?slug= dans l\'URL.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [sumData, revData, covData, chatData, itemData] = await Promise.all([
        api.getAnalyticsSummary(slug, period),
        api.getAnalyticsRevenue(slug, period),
        fetch(`/api/v1/analytics/covers?slug=${encodeURIComponent(slug)}&period=${period}`).then((r) => r.json()),
        api.getAnalyticsChatbot(slug, period),
        api.getAnalyticsItems(slug, period),
      ]);
      setSummary(sumData);
      setRevenue(revData);
      setCovers(covData);
      setChatbot(chatData);
      setItems(itemData);
    } catch (err) {
      setError(err.message || 'Erreur lors du chargement des données.');
    } finally {
      setLoading(false);
    }
  }, [slug, period]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Header */}
      <header className="bg-black text-white sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/restaurant/dashboard" className="text-neutral-400 hover:text-white transition-colors">
              <ArrowLeft size={18} />
            </Link>
            <div className="flex items-center gap-2">
              <BarChart2 size={18} />
              <span className="font-semibold">Analytiques</span>
            </div>
            {slug && (
              <span className="text-neutral-400 text-sm hidden sm:block">· {slug}</span>
            )}
          </div>
          <PeriodPicker period={period} onChange={setPeriod} />
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8 space-y-8">

        {loading && (
          <div className="flex items-center justify-center py-16 text-neutral-500 gap-2">
            <Loader2 size={18} className="animate-spin" />
            Chargement des données…
          </div>
        )}

        {error && !loading && (
          <div className="flex items-center gap-2 bg-white border border-neutral-200 rounded-xl p-5 text-neutral-600">
            <AlertCircle size={16} className="shrink-0 text-neutral-400" />
            <p className="text-sm">{error}</p>
          </div>
        )}

        {!loading && !error && summary && (
          <>
            {/* KPI Cards */}
            <Section title="Vue d'ensemble">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <KpiCard
                  icon={TrendingUp}
                  label="Chiffre d'affaires"
                  value={fmt(summary.revenue ?? 0)}
                  delta={summary.revenue_delta_pct}
                />
                <KpiCard
                  icon={Users}
                  label="Couverts"
                  value={summary.covers ?? 0}
                  sub="tables uniques payées"
                />
                <KpiCard
                  icon={UtensilsCrossed}
                  label="Panier moyen"
                  value={fmt(summary.avg_basket ?? 0)}
                />
                <KpiCard
                  icon={ShoppingBag}
                  label="Pourboires"
                  value={fmt(summary.tips_total ?? 0)}
                />
              </div>
            </Section>

            {/* Revenue chart */}
            {revenue?.daily?.length > 0 && (
              <Section title="Revenus quotidiens">
                <div className="bg-white rounded-xl border border-neutral-200 p-5">
                  <BarChart
                    data={revenue.daily}
                    valueKey="revenue"
                    color="#111827"
                    height={140}
                  />
                  <div className="flex items-center justify-between mt-2 text-xs text-neutral-400">
                    <span>
                      Max :{' '}
                      {fmt(Math.max(...revenue.daily.map((d) => d.revenue ?? 0)))}
                    </span>
                    <span>
                      Total : {fmt(revenue.daily.reduce((s, d) => s + (d.revenue ?? 0), 0))}
                    </span>
                  </div>
                </div>
              </Section>
            )}

            {/* Covers chart */}
            {covers?.daily?.length > 0 && (
              <Section title="Couverts quotidiens">
                <div className="bg-white rounded-xl border border-neutral-200 p-5">
                  <BarChart
                    data={covers.daily}
                    valueKey="covers"
                    color="#6b7280"
                    height={100}
                  />
                </div>
              </Section>
            )}

            {/* Chatbot */}
            <Section title="Chatbot IA">
              <ChatbotCard data={chatbot} />
            </Section>

            {/* Top items */}
            <Section title="Plats les plus vendus">
              <TopItemsCard items={items?.items ?? summary?.top_items} />
            </Section>

            {/* Heatmap */}
            {summary?.hourly_heatmap && (
              <Section title="Heures de pointe">
                <PeakHoursHeatmap heatmap={summary.hourly_heatmap} />
              </Section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
