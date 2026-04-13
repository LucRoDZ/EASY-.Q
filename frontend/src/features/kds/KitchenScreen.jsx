/**
 * KitchenScreen — KDS (Kitchen Display System)
 *
 * Dark tablet-optimized UI.
 * Auth: ?token=<KDS_SECRET_TOKEN> in the URL.
 * WebSocket: /api/v1/ws/kds/{slug}?token=...
 *
 * Kanban columns: Pending → In Progress → Ready → Done
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Loader2, Wifi, WifiOff, ChefHat } from 'lucide-react';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COLUMNS = [
  { key: 'pending',     label: 'En attente',   nextStatus: 'in_progress', action: 'Prendre en charge' },
  { key: 'in_progress', label: 'En préparation', nextStatus: 'ready',      action: 'Prêt' },
  { key: 'ready',       label: 'Prêt',          nextStatus: 'done',        action: 'Servir' },
  { key: 'done',        label: 'Servi / Retiré', nextStatus: null,          action: null },
];

// Takeout orders show the pickup number prominently

const WS_BASE = import.meta.env.VITE_WS_URL || 'ws://localhost:8000';
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatElapsed(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m${s > 0 ? ` ${s}s` : ''}`;
}

function OrderTimer({ createdAt, isOverdue }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = new Date(createdAt).getTime();
    const tick = () => {
      const now = Date.now();
      setElapsed(Math.floor((now - start) / 1000));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [createdAt]);

  return (
    <span className={`text-xs font-mono ${elapsed > 900 ? 'text-red-400' : 'text-neutral-400'}`}>
      {formatElapsed(elapsed)}
    </span>
  );
}

function OrderCard({ order, onAdvance }) {
  const items = order.items || [];

  return (
    <div className="bg-neutral-800 rounded-xl p-4 border border-neutral-700 mb-3">
      <div className="flex items-start justify-between mb-3">
        <div>
          <span className="text-xl font-bold text-white">
            {order.table_token
              ? `Table ${order.table_token.slice(0, 6)}`
              : order.pickup_number
              ? `À emporter #${order.pickup_number}`
              : 'À emporter'}
          </span>
          <span className="ml-2 text-xs text-neutral-500">#{order.id}</span>
        </div>
        {order.created_at && (
          <OrderTimer createdAt={order.created_at} isOverdue={order.is_overdue} />
        )}
      </div>

      <ul className="space-y-1 mb-3">
        {items.map((item, i) => (
          <li key={i} className="flex items-baseline gap-2">
            <span className="text-sm font-medium text-white">
              {item.quantity}×
            </span>
            <span className="text-sm text-neutral-300">{item.name}</span>
            {item.notes && (
              <span className="text-xs text-neutral-500 italic">({item.notes})</span>
            )}
          </li>
        ))}
      </ul>

      {order.notes && (
        <p className="text-xs text-neutral-500 mb-3 italic">{order.notes}</p>
      )}

      {onAdvance && (
        <button
          onClick={() => onAdvance(order.id)}
          className="w-full bg-white text-black rounded-full px-3 py-1.5 text-sm font-medium hover:bg-neutral-100 transition-colors"
        >
          {COLUMNS.find((c) => c.key === order.status)?.action || 'Avancer'}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function KitchenScreen() {
  const { slug } = useParams();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';

  const [orders, setOrders] = useState([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const reconnectDelay = useRef(1000);

  // Play a short beep on new orders
  const playAlert = useCallback(() => {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.3);
    } catch {
      // AudioContext may be blocked before user interaction
    }
  }, []);

  const connect = useCallback(() => {
    if (!slug || !token) return;

    const wsUrl = `${WS_BASE}/api/v1/ws/kds/${slug}?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setError('');
      reconnectDelay.current = 1000;
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === 'snapshot') {
          setOrders(msg.orders || []);
        } else if (msg.type === 'new_order') {
          setOrders((prev) => {
            const exists = prev.some((o) => o.id === msg.order.id);
            if (exists) return prev;
            playAlert();
            return [msg.order, ...prev];
          });
        } else if (msg.type === 'status_update') {
          setOrders((prev) =>
            prev.map((o) => (o.id === msg.order.id ? msg.order : o))
          );
        }
      } catch {
        // ignore parse errors
      }
    };

    ws.onclose = (event) => {
      setConnected(false);
      wsRef.current = null;
      if (event.code !== 4401) {
        // Reconnect with exponential backoff (max 30s)
        const delay = Math.min(reconnectDelay.current, 30_000);
        reconnectTimerRef.current = setTimeout(() => {
          reconnectDelay.current = Math.min(delay * 2, 30_000);
          connect();
        }, delay);
      } else {
        setError('Token KDS invalide — vérifiez l\'URL.');
      }
    };

    ws.onerror = () => {
      // onclose will handle reconnect
    };
  }, [slug, token, playAlert]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, [connect]);

  const advanceOrder = useCallback(async (orderId) => {
    const order = orders.find((o) => o.id === orderId);
    if (!order) return;
    const col = COLUMNS.find((c) => c.key === order.status);
    if (!col?.nextStatus) return;

    // Optimistic update
    setOrders((prev) =>
      prev.map((o) =>
        o.id === orderId ? { ...o, status: col.nextStatus } : o
      )
    );

    // Send via WebSocket if connected
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({ type: 'status_update', order_id: orderId, status: col.nextStatus })
      );
    } else {
      // Fallback to REST
      try {
        await fetch(
          `${API_BASE}/api/v1/kds/${slug}/orders/${orderId}/status?token=${encodeURIComponent(token)}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: col.nextStatus }),
          }
        );
      } catch {
        // Revert optimistic update
        setOrders((prev) =>
          prev.map((o) =>
            o.id === orderId ? { ...o, status: order.status } : o
          )
        );
      }
    }
  }, [orders, slug, token]);

  if (!token) {
    return (
      <div className="min-h-screen bg-neutral-900 flex items-center justify-center">
        <div className="text-neutral-400 text-center">
          <ChefHat size={48} className="mx-auto mb-4 opacity-30" />
          <p className="text-lg">Token KDS manquant.</p>
          <p className="text-sm mt-2 text-neutral-600">
            Accédez via <code className="text-neutral-500">/kds/{slug || 'SLUG'}?token=...</code>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-900 text-white flex flex-col">
      {/* Header */}
      <header className="bg-neutral-950 px-4 h-12 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <ChefHat size={16} className="text-neutral-400" />
          <span className="text-sm font-semibold text-white">{slug} — KDS</span>
        </div>
        <div className="flex items-center gap-2">
          {connected ? (
            <Wifi size={14} className="text-neutral-300" />
          ) : (
            <WifiOff size={14} className="text-neutral-500 animate-pulse" />
          )}
          <span className="text-xs text-neutral-500">
            {connected ? 'Connecté' : 'Reconnexion…'}
          </span>
        </div>
      </header>

      {error && (
        <div className="bg-red-900/30 border-b border-red-800 px-4 py-2 text-sm text-red-400">
          {error}
        </div>
      )}

      {!connected && !error && (
        <div className="flex items-center gap-2 px-4 py-2 text-neutral-500 text-sm">
          <Loader2 size={14} className="animate-spin" />
          Connexion au serveur…
        </div>
      )}

      {/* Kanban columns */}
      <div className="flex-1 grid grid-cols-4 gap-4 p-4 overflow-auto">
        {COLUMNS.map((col) => {
          const colOrders = orders.filter((o) => o.status === col.key);
          return (
            <div key={col.key} className="flex flex-col min-h-0">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-neutral-400 uppercase tracking-wide">
                  {col.label}
                </h2>
                {colOrders.length > 0 && (
                  <span className="text-xs bg-neutral-700 text-neutral-300 rounded-full px-2 py-0.5">
                    {colOrders.length}
                  </span>
                )}
              </div>

              <div className="flex-1 overflow-y-auto space-y-0">
                {colOrders.length === 0 ? (
                  <p className="text-xs text-neutral-700 text-center py-8">—</p>
                ) : (
                  colOrders.map((order) => (
                    <OrderCard
                      key={order.id}
                      order={order}
                      onAdvance={col.nextStatus ? advanceOrder : null}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
