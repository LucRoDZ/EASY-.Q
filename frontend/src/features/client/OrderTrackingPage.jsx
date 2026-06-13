/**
 * OrderTrackingPage — suivi de commande temps réel (style Sunday).
 *
 * Route : /menu/:slug/order/:orderId
 * WebSocket : /api/v1/ws/order/:orderId?token=<tableToken>
 * Reçoit {type: "snapshot"|"status_update", order: {...}} et met à jour le stepper.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ChefHat, CheckCircle, PartyPopper, Loader2, Plus, UtensilsCrossed } from 'lucide-react';
import { useCart } from '../../context/CartContext';
import WaiterCallButton from './WaiterCallButton';

const WS_BASE = import.meta.env.VITE_WS_URL || 'ws://localhost:8000';

const STEPS = [
  { key: 'preparing', statuses: ['pending', 'confirmed', 'in_progress'], icon: ChefHat },
  { key: 'ready', statuses: ['ready'], icon: CheckCircle },
  { key: 'served', statuses: ['done'], icon: PartyPopper },
];

const LABELS = {
  fr: {
    title: 'Suivi de commande',
    preparing: 'En cuisine',
    ready: 'Prêt',
    served: 'Servi',
    readyBanner: 'Votre commande est prête !',
    items: 'Votre commande',
    addItems: 'Ajouter des plats',
    elapsed: 'Commandé il y a',
    connecting: 'Connexion…',
    cancelled: 'Commande annulée',
  },
  en: {
    title: 'Order tracking',
    preparing: 'In the kitchen',
    ready: 'Ready',
    served: 'Served',
    readyBanner: 'Your order is ready!',
    items: 'Your order',
    addItems: 'Add more items',
    elapsed: 'Ordered',
    connecting: 'Connecting…',
    cancelled: 'Order cancelled',
  },
  es: {
    title: 'Seguimiento del pedido',
    preparing: 'En cocina',
    ready: 'Listo',
    served: 'Servido',
    readyBanner: '¡Su pedido está listo!',
    items: 'Su pedido',
    addItems: 'Añadir platos',
    elapsed: 'Pedido hace',
    connecting: 'Conectando…',
    cancelled: 'Pedido cancelado',
  },
};

function activeStepIndex(status) {
  const idx = STEPS.findIndex((s) => s.statuses.includes(status));
  return idx === -1 ? 0 : idx;
}

function ElapsedTimer({ createdAt, label }) {
  const [elapsed, setElapsed] = useState('');

  useEffect(() => {
    if (!createdAt) return;
    const start = new Date(createdAt).getTime();
    const tick = () => {
      const sec = Math.max(0, Math.floor((Date.now() - start) / 1000));
      setElapsed(sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)} min`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [createdAt]);

  if (!createdAt) return null;
  return (
    <p className="text-xs text-neutral-400 text-center">{label} {elapsed}</p>
  );
}

export default function OrderTrackingPage() {
  const { slug, orderId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const lang = searchParams.get('lang') || 'fr';
  const t = LABELS[lang] || LABELS.fr;

  const { tableToken: storedTableToken, setSlug } = useCart();
  const tableToken = searchParams.get('table') || storedTableToken || '';

  useEffect(() => { setSlug(slug); }, [slug, setSlug]);

  const [order, setOrder] = useState(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');

  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const reconnectDelay = useRef(1000);

  const connect = useCallback(() => {
    if (!orderId) return;
    const params = tableToken ? `?token=${encodeURIComponent(tableToken)}` : '';
    const ws = new WebSocket(`${WS_BASE}/api/v1/ws/order/${orderId}${params}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setError('');
      reconnectDelay.current = 1000;
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if ((msg.type === 'snapshot' || msg.type === 'status_update') && msg.order) {
          setOrder(msg.order);
        }
      } catch {
        // ignore parse errors
      }
    };

    ws.onclose = (event) => {
      setConnected(false);
      wsRef.current = null;
      if (event.code === 4403 || event.code === 4404) {
        setError(event.code === 4404 ? 'Commande introuvable.' : 'Accès refusé.');
        return;
      }
      const delay = Math.min(reconnectDelay.current, 30_000);
      reconnectTimerRef.current = setTimeout(() => {
        reconnectDelay.current = Math.min(delay * 2, 30_000);
        connect();
      }, delay);
    };

    ws.onerror = () => {
      // onclose gère la reconnexion
    };
  }, [orderId, tableToken]);

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

  const status = order?.status || 'pending';
  const isCancelled = status === 'cancelled';
  const stepIdx = activeStepIndex(status);
  const isReady = status === 'ready';
  const stepLabels = [t.preparing, t.ready, t.served];

  return (
    <div className="min-h-dvh bg-neutral-50 pb-24">
      <header className="bg-black text-white sticky top-0 z-40">
        <div className="max-w-xl mx-auto px-4 h-14 flex items-center gap-3">
          <UtensilsCrossed size={20} />
          <h1 className="text-lg font-semibold tracking-tight">{t.title}</h1>
          {order?.table_number && (
            <span className="ml-auto text-sm text-neutral-400">
              Table {order.table_number}
            </span>
          )}
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 py-8 space-y-6">
        {error ? (
          <p role="alert" className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm text-center">
            {error}
          </p>
        ) : !order ? (
          <div className="flex items-center justify-center gap-2 py-16 text-neutral-500">
            <Loader2 size={20} className="animate-spin" />
            <span className="text-sm">{t.connecting}</span>
          </div>
        ) : isCancelled ? (
          <p role="alert" className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm text-center">
            {t.cancelled}
          </p>
        ) : (
          <>
            {/* Bannière "prêt" */}
            {isReady && (
              <div className="bg-neutral-900 text-white rounded-2xl p-5 text-center animate-pulse">
                <PartyPopper size={28} className="mx-auto mb-2" />
                <p className="font-semibold text-lg">{t.readyBanner}</p>
              </div>
            )}

            {/* Stepper */}
            <div className="bg-white rounded-xl border border-neutral-200 p-6">
              <div className="flex items-center">
                {STEPS.map((step, i) => {
                  const Icon = step.icon;
                  const active = i === stepIdx;
                  const passed = i < stepIdx;
                  return (
                    <div key={step.key} className="flex-1 flex items-center last:flex-none">
                      <div className="flex flex-col items-center gap-2">
                        <div
                          className={`w-12 h-12 rounded-full flex items-center justify-center border-2 transition-colors ${
                            active
                              ? 'bg-black border-black text-white'
                              : passed
                              ? 'bg-neutral-900 border-neutral-900 text-white'
                              : 'bg-white border-neutral-200 text-neutral-300'
                          }`}
                        >
                          <Icon size={20} className={active && !isReady ? 'animate-bounce motion-reduce:animate-none' : ''} />
                        </div>
                        <span
                          className={`text-xs font-medium ${
                            active ? 'text-neutral-900' : passed ? 'text-neutral-600' : 'text-neutral-300'
                          }`}
                        >
                          {stepLabels[i]}
                        </span>
                      </div>
                      {i < STEPS.length - 1 && (
                        <div className={`flex-1 h-0.5 mx-2 mb-6 ${passed ? 'bg-neutral-900' : 'bg-neutral-200'}`} />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <ElapsedTimer createdAt={order.created_at} label={t.elapsed} />

            {/* Articles */}
            <div className="bg-white rounded-xl border border-neutral-200 p-6">
              <h2 className="font-semibold text-neutral-900 mb-3 text-sm">{t.items}</h2>
              <ul className="divide-y divide-neutral-100">
                {(order.items || []).map((item, i) => (
                  <li key={i} className="py-2.5 flex items-baseline gap-2 text-sm">
                    <span className="font-medium text-neutral-900">{item.quantity}×</span>
                    <span className="text-neutral-700">{item.name}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Actions */}
            <button
              onClick={() => navigate(`/menu/${slug}?lang=${lang}${tableToken ? `&table=${tableToken}` : ''}`)}
              className="w-full flex items-center justify-center gap-2 bg-white text-neutral-900 border border-neutral-200 rounded-full py-3.5 font-medium hover:bg-neutral-50 transition-colors"
            >
              <Plus size={16} />
              {t.addItems}
            </button>

            {!connected && (
              <p className="text-xs text-neutral-400 text-center flex items-center justify-center gap-1.5">
                <Loader2 size={12} className="animate-spin" /> {t.connecting}
              </p>
            )}
          </>
        )}
      </main>

      {/* FAB appel serveur */}
      {tableToken && <WaiterCallButton slug={slug} tableToken={tableToken} lang={lang} />}
    </div>
  );
}
