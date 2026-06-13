/**
 * TipPage — tip selection before Stripe checkout.
 *
 * Route: /menu/:slug/tip?lang=fr&currency=EUR&table=<token>
 * On confirm, navigates to /menu/:slug/checkout with tipAmount added to params.
 */

import { useState } from 'react';
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom';
import { ArrowLeft, Heart } from 'lucide-react';
import { useCart } from '../../context/CartContext';
import { t } from '../../localization/translations';

function formatPrice(amount, currency) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'EUR' }).format(amount);
  } catch {
    return `${amount}`;
  }
}

const TIP_PRESETS = [0, 5, 10, 15];

export default function TipPage() {
  const { slug } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const lang = searchParams.get('lang') || 'fr';
  const currency = searchParams.get('currency') || 'EUR';

  const { total, tableToken: storedTableToken } = useCart();
  const tableToken = searchParams.get('table') || storedTableToken || '';
  const lbl = {
    back: t(lang, 'tip.back'),
    title: t(lang, 'tip.title'),
    subtitle: t(lang, 'tip.subtitle'),
    custom: t(lang, 'tip.custom'),
    confirm: t(lang, 'tip.confirm'),
    subtotal: t(lang, 'tip.subtotal'),
    tip: t(lang, 'tip.tip'),
    total: t(lang, 'tip.total'),
  };

  const [selectedPct, setSelectedPct] = useState(10); // default 10%
  const [customAmount, setCustomAmount] = useState('');
  const [useCustom, setUseCustom] = useState(false);

  const tipAmount = useCustom
    ? Math.max(0, parseFloat(customAmount.replace(',', '.') || '0'))
    : (total * selectedPct) / 100;

  const grandTotal = total + tipAmount;

  const handleConfirm = () => {
    const params = new URLSearchParams({ lang, currency });
    if (tableToken) params.set('table', tableToken);
    // CheckoutPage reads ?tip= as integer cents (parseInt)
    params.set('tip', Math.round(tipAmount * 100).toString());
    navigate(`/menu/${slug}/checkout?${params}`);
  };

  return (
    <div className="min-h-dvh bg-neutral-50">
      <header className="bg-black text-white sticky top-0 z-40">
        <div className="max-w-md mx-auto px-4 py-4 flex items-center justify-between">
          <Link
            to={`/menu/${slug}/cart?lang=${lang}&currency=${currency}${tableToken ? `&table=${tableToken}` : ''}`}
            className="flex items-center gap-2 text-neutral-400 hover:text-white transition-colors text-sm"
          >
            <ArrowLeft className="h-4 w-4" />
            {lbl.back}
          </Link>
          <h1 className="text-base font-semibold">{lbl.title}</h1>
          <div className="w-16" />
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 py-8 space-y-6">
        {/* Icon + subtitle */}
        <div className="text-center">
          <div className="w-14 h-14 bg-neutral-100 rounded-full flex items-center justify-center mx-auto mb-3">
            <Heart className="h-7 w-7 text-neutral-600" />
          </div>
          <p className="text-sm text-neutral-500">{lbl.subtitle}</p>
        </div>

        {/* Preset buttons */}
        <div className="grid grid-cols-2 gap-3">
          {TIP_PRESETS.map((pct) => {
            const label = pct === 0 ? t(lang, 'tip.none') : `${pct} %`;
            const active = !useCustom && selectedPct === pct;
            return (
              <button
                key={pct}
                type="button"
                onClick={() => { setSelectedPct(pct); setUseCustom(false); }}
                className={`flex flex-col items-center py-4 rounded-xl border-2 transition-colors ${
                  active
                    ? 'border-neutral-900 bg-neutral-900 text-white'
                    : 'border-neutral-200 bg-white text-neutral-800 hover:border-neutral-400'
                }`}
              >
                <span className="text-lg font-bold">{label}</span>
                {pct > 0 && (
                  <span className={`text-sm mt-0.5 ${active ? 'text-neutral-300' : 'text-neutral-500'}`}>
                    {formatPrice((total * pct) / 100, currency)}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Custom amount */}
        <div>
          <label className="block text-xs text-neutral-500 mb-1.5 font-medium uppercase tracking-wide">
            {lbl.custom}
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 text-sm">€</span>
            <input
              type="number"
              min="0"
              step="0.50"
              value={customAmount}
              onFocus={() => setUseCustom(true)}
              onChange={(e) => { setCustomAmount(e.target.value); setUseCustom(true); }}
              placeholder="0,00"
              className="w-full pl-8 pr-4 py-3 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900 bg-white"
            />
          </div>
        </div>

        {/* Summary */}
        <div className="bg-white rounded-xl border border-neutral-200 p-5 space-y-2">
          <div className="flex justify-between text-sm text-neutral-600">
            <span>{lbl.subtotal}</span>
            <span>{formatPrice(total, currency)}</span>
          </div>
          <div className="flex justify-between text-sm text-neutral-600">
            <span>{lbl.tip}</span>
            <span>{tipAmount > 0 ? formatPrice(tipAmount, currency) : '—'}</span>
          </div>
          <div className="flex justify-between font-bold text-neutral-900 pt-2 border-t border-neutral-100">
            <span>{lbl.total}</span>
            <span>{formatPrice(grandTotal, currency)}</span>
          </div>
        </div>

        {/* Confirm */}
        <button
          type="button"
          onClick={handleConfirm}
          className="w-full bg-black text-white py-4 rounded-full font-semibold text-lg hover:bg-neutral-800 transition-colors"
        >
          {lbl.confirm} · {formatPrice(grandTotal, currency)}
        </button>
      </main>
    </div>
  );
}
