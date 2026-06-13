/**
 * WaiterPage v2 — vue serveur temps réel.
 *
 * Section 1 : appels serveur en attente (polling 10s + son d'alerte)
 * Section 2 : grille de tables avec badges commandes/appels
 * Clic sur une table → panneau détail (commandes actives, commander, clôturer)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, useUser } from '@clerk/clerk-react';
import { Bell, ChefHat, CheckCircle, Loader2, X, ShoppingBag, Lock } from 'lucide-react';
import { api } from '../../api';
import { useUserRole } from '../../context/UserRoleContext';

const POLL_INTERVAL_MS = 10_000; // fallback quand le WebSocket est déconnecté
const WS_BASE = import.meta.env.VITE_WS_URL || 'ws://localhost:8000';

const STATUS_LABEL = {
  available: { label: 'Disponible', color: 'bg-green-100 text-green-700' },
  occupied: { label: 'Occupée', color: 'bg-amber-100 text-amber-700' },
  reserved: { label: 'Réservée', color: 'bg-blue-100 text-blue-700' },
};

const ORDER_STATUS_LABEL = {
  pending: { label: 'En attente', color: 'bg-neutral-100 text-neutral-600' },
  confirmed: { label: 'Confirmée', color: 'bg-blue-100 text-blue-700' },
  in_progress: { label: 'En préparation', color: 'bg-amber-100 text-amber-700' },
  ready: { label: 'Prête', color: 'bg-green-100 text-green-700' },
  done: { label: 'Servie', color: 'bg-neutral-100 text-neutral-400' },
  cancelled: { label: 'Annulée', color: 'bg-red-100 text-red-600' },
};

function elapsedLabel(isoTimestamp) {
  if (!isoTimestamp) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(isoTimestamp).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)} min`;
}

function formatPrice(cents, currency = 'EUR') {
  try {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} €`;
  }
}

// ─── Panneau détail table ────────────────────────────────────────────────────

function TableDetailPanel({ table, menuSlug, getToken, onClose, onTableClosed }) {
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const data = await api.listOrdersByTable(table.qr_token, token);
        const active = (Array.isArray(data) ? data : []).filter(
          (o) => !['done', 'cancelled'].includes(o.status)
        );
        if (!cancelled) setOrders(active);
      } catch {
        if (!cancelled) setError('Impossible de charger les commandes.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [table.qr_token, getToken]);

  async function handleCloseTable() {
    setClosing(true);
    try {
      const token = await getToken();
      await api.updateTable(table.id, { status: 'available' }, token);
      onTableClosed();
    } catch {
      setError('Impossible de clôturer la table.');
      setClosing(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <button
        type="button"
        aria-label="Fermer"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <div className="relative bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[85dvh] overflow-y-auto p-5 shadow-xl">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-neutral-900">Table {table.number}</h2>
            {table.label && <p className="text-sm text-neutral-500">{table.label}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Fermer le panneau"
            className="p-2 text-neutral-400 hover:text-neutral-700 rounded-full transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-neutral-400" />
          </div>
        ) : (
          <>
            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
                {error}
              </p>
            )}

            <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-2">
              Commandes actives
            </h3>
            {orders.length === 0 ? (
              <p className="text-sm text-neutral-400 py-4 text-center">
                Aucune commande en cours.
              </p>
            ) : (
              <div className="space-y-3 mb-4">
                {orders.map((order) => {
                  const st = ORDER_STATUS_LABEL[order.status] ?? ORDER_STATUS_LABEL.pending;
                  return (
                    <div key={order.id} className="border border-neutral-200 rounded-xl p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-neutral-400">#{order.id}</span>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${st.color}`}>
                          {st.label}
                        </span>
                      </div>
                      <ul className="text-sm text-neutral-700 space-y-0.5">
                        {(order.items || []).map((item, i) => (
                          <li key={i}>{item.quantity}× {item.name}</li>
                        ))}
                      </ul>
                      <p className="text-right text-sm font-semibold text-neutral-900 mt-2">
                        {formatPrice(order.total, (order.currency || 'eur').toUpperCase())}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="space-y-2 mt-4">
              <button
                onClick={() => navigate(`/menu/${menuSlug}?table=${table.qr_token}&tableNumber=${encodeURIComponent(table.number)}`)}
                className="w-full bg-black text-white py-3 rounded-full font-semibold hover:bg-neutral-800 transition-colors flex items-center justify-center gap-2"
              >
                <ShoppingBag className="w-4 h-4" />
                Commander pour cette table
              </button>
              <button
                onClick={handleCloseTable}
                disabled={closing}
                className="w-full border border-neutral-300 text-neutral-700 py-3 rounded-full font-medium hover:bg-neutral-50 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <Lock className="w-4 h-4" />
                {closing ? 'Clôture…' : 'Clôturer la table'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── WaiterPage ──────────────────────────────────────────────────────────────

export default function WaiterPage() {
  const { getToken } = useAuth();
  const { user } = useUser();
  const { menuSlug, loading: roleLoading } = useUserRole();

  // getToken peut changer d'identité à chaque render (Clerk) — on le stabilise
  // pour ne pas relancer l'effet de polling en boucle.
  const getTokenRef = useRef(getToken);
  useEffect(() => { getTokenRef.current = getToken; });
  const stableGetToken = useCallback((...args) => getTokenRef.current(...args), []);

  const [tables, setTables] = useState([]);
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedTable, setSelectedTable] = useState(null);
  const [callActionId, setCallActionId] = useState(null);

  const knownCallIdsRef = useRef(new Set());
  const firstLoadRef = useRef(true);
  const wsConnectedRef = useRef(false);

  // Son d'alerte sur nouvel appel (même pattern que le KDS)
  const playAlert = useCallback(() => {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 660;
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.4);
    } catch {
      // AudioContext peut être bloqué avant interaction utilisateur
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!menuSlug) return;
    const token = await stableGetToken();
    const [summaryRes, callsRes] = await Promise.allSettled([
      api.getTablesSummary(menuSlug, token),
      api.getWaiterCalls(menuSlug, token),
    ]);

    if (summaryRes.status === 'fulfilled') {
      setTables(summaryRes.value.tables ?? []);
    } else if (firstLoadRef.current) {
      throw summaryRes.reason;
    }

    if (callsRes.status === 'fulfilled') {
      const newCalls = callsRes.value.calls ?? [];
      const known = knownCallIdsRef.current;
      const hasNew = newCalls.some((c) => !known.has(c.id));
      if (hasNew && !firstLoadRef.current) playAlert();
      knownCallIdsRef.current = new Set(newCalls.map((c) => c.id));
      setCalls(newCalls);
    }
    firstLoadRef.current = false;
  }, [menuSlug, stableGetToken, playAlert]);

  useEffect(() => {
    if (roleLoading) return;
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
        await refresh();
      } catch {
        if (!cancelled) setError('Impossible de charger les tables.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    // Polling de secours — inactif tant que le WebSocket est connecté
    const id = setInterval(() => {
      if (!wsConnectedRef.current) refresh().catch(() => {});
    }, POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [roleLoading, menuSlug, refresh]);

  // WebSocket temps réel : appels serveur + commandes prêtes / nouvelles
  useEffect(() => {
    if (roleLoading || !menuSlug || typeof WebSocket === 'undefined') return;

    let ws = null;
    let closed = false;
    let reconnectTimer = null;
    let delay = 1000;

    const connect = () => {
      if (closed) return;
      ws = new WebSocket(`${WS_BASE}/api/v1/ws/waiter/${menuSlug}`);

      ws.onopen = async () => {
        try {
          const token = await stableGetToken();
          ws.send(JSON.stringify({ token }));
        } catch {
          ws.close();
        }
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'connected') {
            wsConnectedRef.current = true;
            delay = 1000;
            return;
          }
          if (msg.type === 'waiter_call') {
            playAlert();
            refresh().catch(() => {});
          } else if (msg.type === 'order_ready' || msg.type === 'new_order') {
            refresh().catch(() => {});
          }
        } catch {
          // ignore parse errors
        }
      };

      ws.onclose = () => {
        wsConnectedRef.current = false;
        if (!closed) {
          reconnectTimer = setTimeout(connect, delay);
          delay = Math.min(delay * 2, 30_000);
        }
      };

      ws.onerror = () => {
        // onclose gère la reconnexion
      };
    };

    connect();
    return () => {
      closed = true;
      wsConnectedRef.current = false;
      clearTimeout(reconnectTimer);
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
    };
  }, [roleLoading, menuSlug, stableGetToken, refresh, playAlert]);

  async function handleCallAction(callId, status) {
    setCallActionId(callId);
    try {
      const token = await stableGetToken();
      await api.updateWaiterCallStatus(menuSlug, callId, status, token);
      await refresh();
    } catch {
      // best-effort : le polling rattrapera
    } finally {
      setCallActionId(null);
    }
  }

  const pendingCalls = calls.filter((c) => (c.status ?? 'pending') !== 'resolved');

  return (
    <div className="min-h-dvh bg-neutral-50 dark:bg-neutral-900">
      <header className="bg-white dark:bg-neutral-800 border-b border-neutral-200 dark:border-neutral-700 px-4 py-4">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-neutral-900 dark:text-white">Mode serveur</h1>
            {user?.firstName && (
              <p className="text-sm text-neutral-500 dark:text-neutral-400">Bonjour, {user.firstName}</p>
            )}
          </div>
          {pendingCalls.length > 0 && (
            <span className="flex items-center gap-1.5 bg-red-100 text-red-700 text-sm font-semibold px-3 py-1 rounded-full">
              <Bell className="w-4 h-4" />
              {pendingCalls.length}
            </span>
          )}
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6">
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

        {!loading && !error && (
          <>
            {/* ── Section 1 : appels en attente ── */}
            {pendingCalls.length > 0 && (
              <section className="mb-6" aria-label="Appels serveur en attente">
                <h2 className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-2">
                  Appels en attente
                </h2>
                <div className="space-y-2">
                  {pendingCalls.map((call) => {
                    const acknowledged = call.status === 'acknowledged';
                    return (
                      <div
                        key={call.id}
                        className={`bg-white rounded-xl border p-4 flex items-center gap-3 ${
                          acknowledged ? 'border-neutral-200' : 'border-red-300'
                        }`}
                      >
                        <div className={`p-2 rounded-full ${acknowledged ? 'bg-neutral-100 text-neutral-500' : 'bg-red-100 text-red-600'}`}>
                          <Bell className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-neutral-900 text-sm">
                            Table {call.table_number}
                            {call.table_label && (
                              <span className="font-normal text-neutral-500"> · {call.table_label}</span>
                            )}
                          </p>
                          <p className="text-xs text-neutral-500 truncate">
                            {call.message} · il y a {elapsedLabel(call.timestamp)}
                          </p>
                        </div>
                        {acknowledged ? (
                          <button
                            onClick={() => handleCallAction(call.id, 'resolved')}
                            disabled={callActionId === call.id}
                            className="shrink-0 flex items-center gap-1 text-green-700 bg-green-50 border border-green-200 text-xs font-medium px-3 py-2 rounded-full hover:bg-green-100 transition-colors disabled:opacity-50"
                          >
                            <CheckCircle className="w-3.5 h-3.5" />
                            Résolu
                          </button>
                        ) : (
                          <button
                            onClick={() => handleCallAction(call.id, 'acknowledged')}
                            disabled={callActionId === call.id}
                            className="shrink-0 bg-black text-white text-xs font-medium px-3 py-2 rounded-full hover:bg-neutral-800 transition-colors disabled:opacity-50"
                          >
                            Prendre en charge
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* ── Section 2 : grille de tables ── */}
            <p className="text-sm text-neutral-500 mb-4">
              Sélectionnez une table pour voir le détail ou commander.
            </p>

            {tables.length === 0 && (
              <p className="text-sm text-neutral-500 text-center py-12">
                Aucune table configurée pour ce restaurant.
              </p>
            )}

            <div className="grid grid-cols-2 gap-3">
              {tables.map((table) => {
                const status = STATUS_LABEL[table.status] ?? STATUS_LABEL.available;
                const hasCall = (table.pending_calls ?? 0) > 0;
                const inProgress = (table.in_progress_orders ?? 0) + (table.pending_orders ?? 0);
                const ready = table.ready_orders ?? 0;
                return (
                  <button
                    key={table.id}
                    onClick={() => setSelectedTable(table)}
                    className={`relative bg-white dark:bg-neutral-800 rounded-xl border p-4 text-left hover:border-neutral-400 hover:shadow-sm transition-all active:scale-95 ${
                      hasCall ? 'border-red-300 dark:border-red-700' : 'border-neutral-200 dark:border-neutral-700'
                    }`}
                  >
                    {hasCall && (
                      <span
                        title="Appel serveur en attente"
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center"
                      >
                        <Bell className="w-3 h-3" />
                      </span>
                    )}
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-2xl font-bold text-neutral-900 dark:text-white">{table.number}</span>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${status.color}`}>
                        {status.label}
                      </span>
                    </div>
                    {table.label && (
                      <p className="text-xs text-neutral-500 mt-1">{table.label}</p>
                    )}
                    <p className="text-xs text-neutral-400 mt-1">{table.capacity} pers.</p>
                    {(inProgress > 0 || ready > 0) && (
                      <div className="flex gap-1.5 mt-2">
                        {inProgress > 0 && (
                          <span className="flex items-center gap-1 text-xs font-medium bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                            <ChefHat className="w-3 h-3" />
                            {inProgress}
                          </span>
                        )}
                        {ready > 0 && (
                          <span className="flex items-center gap-1 text-xs font-medium bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                            <CheckCircle className="w-3 h-3" />
                            {ready}
                          </span>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </main>

      {selectedTable && (
        <TableDetailPanel
          table={selectedTable}
          menuSlug={menuSlug}
          getToken={stableGetToken}
          onClose={() => setSelectedTable(null)}
          onTableClosed={() => {
            setSelectedTable(null);
            refresh().catch(() => {});
          }}
        />
      )}
    </div>
  );
}
