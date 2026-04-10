/**
 * WaiterCallButton — Fixed FAB (bottom-right) that sends a waiter call.
 *
 * Shows only when the client arrived via a QR table link (tableToken present).
 * Sits above the CartSummaryBar (z-40, bottom-20) when cart has items.
 */

import { useState, useCallback } from 'react';
import { Bell, BellRing, Check, Loader2 } from 'lucide-react';
import { api } from '../../api';
import { t } from '../../localization/translations';
import { useCart } from '../../context/CartContext';

export default function WaiterCallButton({ slug, tableToken, lang = 'fr' }) {
  const [state, setState] = useState('idle'); // 'idle' | 'loading' | 'sent' | 'error'
  const { itemCount } = useCart();

  const handleCall = useCallback(async () => {
    if (state !== 'idle' || !slug || !tableToken) return;
    setState('loading');
    try {
      await api.callWaiter(slug, tableToken, t(lang, 'waiter.callButton'));
      setState('sent');
      setTimeout(() => setState('idle'), 4000);
    } catch {
      setState('error');
      setTimeout(() => setState('idle'), 3000);
    }
  }, [state, slug, tableToken, lang]);

  // Only show when visiting via QR table link
  if (!tableToken) return null;

  // Rise above CartSummaryBar when cart has items
  const bottomClass = itemCount > 0 ? 'bottom-20' : 'bottom-6';

  const bgClass =
    state === 'sent'
      ? 'bg-green-600 hover:bg-green-700'
      : state === 'error'
      ? 'bg-red-600 hover:bg-red-700'
      : 'bg-neutral-800 hover:bg-neutral-700';

  const label =
    state === 'sent'
      ? t(lang, 'waiter.callSent')
      : state === 'error'
      ? t(lang, 'waiter.callError')
      : t(lang, 'waiter.callButton');

  return (
    <div className={`fixed ${bottomClass} left-6 z-40 flex items-center gap-2`}>
      <button
        type="button"
        onClick={handleCall}
        disabled={state === 'loading'}
        aria-label={label}
        title={label}
        className={`flex items-center gap-2 ${bgClass} text-white px-4 py-2.5 rounded-full shadow-lg transition-all text-sm font-medium disabled:opacity-60`}
      >
        {state === 'loading' && <Loader2 size={16} className="animate-spin" />}
        {state === 'sent' && <Check size={16} />}
        {state === 'error' && <BellRing size={16} />}
        {state === 'idle' && <Bell size={16} />}
        <span>{label}</span>
      </button>
    </div>
  );
}
