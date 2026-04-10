import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { Loader2, ShoppingCart, Bell, BellRing, Check, Download } from 'lucide-react';
import { t } from '../../localization/translations';
import { api } from '../../api';
import MenuView, { SearchFilterBar } from '../../components/MenuView';
import ChatWidget from './ChatWidget';
import LanguageSelector from '../../components/LanguageSelector';
import CartSummaryBar from '../../components/CartSummaryBar';
import { useCart } from '../../context/CartContext';

// ─── CategoryNav ──────────────────────────────────────────────────────────────

function CategoryNav({ sections, activeIndex }) {
  const navRef = useRef(null);

  const scrollToSection = (idx) => {
    const el = document.getElementById(`section-${idx}`);
    if (el) {
      const offset = 120; // header + nav height
      const top = el.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top, behavior: 'smooth' });
    }
  };

  // Scroll active tab into view inside the nav bar
  useEffect(() => {
    if (!navRef.current) return;
    const activeBtn = navRef.current.querySelector(`[data-idx="${activeIndex}"]`);
    activeBtn?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [activeIndex]);

  if (!sections || sections.length === 0) return null;

  return (
    <nav
      ref={navRef}
      className="bg-black text-white sticky top-14 z-30 overflow-x-auto scrollbar-hide"
      style={{ scrollbarWidth: 'none' }}
    >
      <div className="flex gap-0 max-w-4xl mx-auto px-4">
        {sections.map((section, idx) => (
          <button
            key={idx}
            data-idx={idx}
            onClick={() => scrollToSection(idx)}
            className={[
              'whitespace-nowrap px-4 py-3 text-sm font-medium border-b-2 transition-colors shrink-0',
              idx === activeIndex
                ? 'border-white text-white'
                : 'border-transparent text-neutral-400 hover:text-neutral-200',
            ].join(' ')}
          >
            {section.title}
          </button>
        ))}
      </div>
    </nav>
  );
}

// ─── MenuPage ─────────────────────────────────────────────────────────────────

export default function MenuPage() {
  const { slug } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { itemCount } = useCart();

  const lang = searchParams.get('lang') || 'fr';
  const tableToken = searchParams.get('table') || '';

  const [menu, setMenu] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeSection, setActiveSection] = useState(0);

  // Waiter call state
  const [waiterState, setWaiterState] = useState('idle'); // 'idle' | 'loading' | 'sent' | 'error'

  // Search & filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilters, setActiveFilters] = useState([]);

  // PWA install prompt
  const [installPrompt, setInstallPrompt] = useState(null);
  const [installBannerVisible, setInstallBannerVisible] = useState(false);

  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
      // Show banner after a short delay — avoid overwhelming on first load
      setTimeout(() => setInstallBannerVisible(true), 3000);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') {
      setInstallPrompt(null);
    }
    setInstallBannerVisible(false);
  };

  const handleToggleFilter = useCallback((filterId) => {
    setActiveFilters((prev) =>
      prev.includes(filterId) ? prev.filter((f) => f !== filterId) : [...prev, filterId]
    );
  }, []);

  // ── Load menu ──────────────────────────────────────────────────────────────

  useEffect(() => {
    setLoading(true);
    setError('');
    api.getMenu(slug, lang)
      .then(setMenu)
      .catch(() => setError('Menu introuvable'))
      .finally(() => setLoading(false));
  }, [slug, lang]);

  // ── IntersectionObserver for CategoryNav active state ──────────────────────

  useEffect(() => {
    if (!menu) return;
    const sections = menu.sections || [];
    if (sections.length === 0) return;

    const observers = [];
    const visibleMap = new Map();

    const pick = () => {
      let first = sections.length;
      visibleMap.forEach((visible, idx) => {
        if (visible && idx < first) first = idx;
      });
      setActiveSection(first < sections.length ? first : 0);
    };

    sections.forEach((_, idx) => {
      const el = document.getElementById(`section-${idx}`);
      if (!el) return;
      const obs = new IntersectionObserver(
        ([entry]) => {
          visibleMap.set(idx, entry.isIntersecting);
          pick();
        },
        { rootMargin: '-20% 0px -60% 0px', threshold: 0 }
      );
      obs.observe(el);
      observers.push(obs);
    });

    return () => observers.forEach((o) => o.disconnect());
  }, [menu]);

  const handleLanguageChange = useCallback(
    (newLang) => {
      const params = { lang: newLang };
      if (tableToken) params.table = tableToken;
      setSearchParams(params);
    },
    [setSearchParams, tableToken]
  );

  const handleCallWaiter = useCallback(async () => {
    if (waiterState !== 'idle' || !slug) return;
    setWaiterState('loading');
    try {
      await api.callWaiter(slug, tableToken, t(lang, 'waiter.callButton'));
      setWaiterState('sent');
      setTimeout(() => setWaiterState('idle'), 3000);
    } catch {
      setWaiterState('error');
      setTimeout(() => setWaiterState('idle'), 3000);
    }
  }, [waiterState, slug, tableToken, lang]);

  // ── States ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-50 flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-neutral-400" />
      </div>
    );
  }

  if (error || !menu) {
    return (
      <div className="min-h-screen bg-neutral-50 flex items-center justify-center">
        <p className="text-neutral-600">{error || 'Menu introuvable'}</p>
      </div>
    );
  }

  const cartUrl = `/menu/${slug}/cart?lang=${lang}&currency=${menu.currency || 'EUR'}`;

  return (
    <div className="min-h-screen bg-neutral-50 pb-24">

      {/* ── Sticky Header ── */}
      <header className="bg-black text-white sticky top-0 z-40">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight truncate">
              {menu.restaurant_name}
            </h1>
            {tableToken && (
              <p className="text-xs text-neutral-400 leading-none mt-0.5">
                Table {tableToken.length > 8 ? tableToken.slice(0, 8) + '…' : tableToken}
              </p>
            )}
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <LanguageSelector
              current={lang}
              available={menu.available_languages}
              onChange={handleLanguageChange}
            />

            {/* Call waiter button — only shown when arriving via QR table link */}
            {tableToken && (
              <button
                onClick={handleCallWaiter}
                disabled={waiterState === 'loading'}
                className={`p-2 rounded-full transition-colors ${
                  waiterState === 'sent'
                    ? 'text-green-400'
                    : waiterState === 'error'
                    ? 'text-red-400'
                    : 'hover:bg-neutral-800'
                }`}
                aria-label={t(lang, 'waiter.callButton')}
                title={
                  waiterState === 'sent'
                    ? t(lang, 'waiter.callSent')
                    : waiterState === 'error'
                    ? t(lang, 'waiter.callError')
                    : t(lang, 'waiter.callButton')
                }
              >
                {waiterState === 'loading' && <Loader2 size={20} className="animate-spin" />}
                {waiterState === 'sent' && <Check size={20} />}
                {waiterState === 'error' && <BellRing size={20} />}
                {waiterState === 'idle' && <Bell size={20} />}
              </button>
            )}

            <Link
              to={cartUrl}
              className="relative p-2 hover:bg-neutral-800 rounded-full transition-colors"
              aria-label="Panier"
            >
              <ShoppingCart size={20} />
              {itemCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-white text-black text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center leading-none">
                  {itemCount}
                </span>
              )}
            </Link>
          </div>
        </div>
      </header>

      {/* ── Category nav ── */}
      <CategoryNav sections={menu.sections} activeIndex={activeSection} />

      {/* ── Menu content ── */}
      <main className="max-w-4xl mx-auto px-4 py-6">
        <SearchFilterBar
          query={searchQuery}
          onQueryChange={setSearchQuery}
          activeFilters={activeFilters}
          onToggleFilter={handleToggleFilter}
          lang={lang}
        />
        <MenuView
          sections={menu.sections}
          wines={menu.wines}
          currency={menu.currency}
          lang={lang}
          query={searchQuery}
          activeFilters={activeFilters}
        />
      </main>

      {/* ── Add to Home Screen banner ── */}
      {installBannerVisible && (
        <div className="fixed bottom-20 left-4 right-4 z-40 max-w-sm mx-auto bg-white border border-neutral-200 rounded-2xl shadow-lg p-4 flex items-center gap-3">
          <div className="flex-1">
            <p className="text-sm font-semibold text-neutral-900">Ajouter à l&apos;écran d&apos;accueil</p>
            <p className="text-xs text-neutral-500 mt-0.5">Accédez au menu rapidement sans navigateur.</p>
          </div>
          <button
            type="button"
            onClick={handleInstall}
            className="flex items-center gap-1.5 bg-black text-white text-xs font-medium px-3 py-2 rounded-full hover:bg-neutral-800 transition-colors shrink-0"
          >
            <Download className="h-3.5 w-3.5" />
            Installer
          </button>
          <button
            type="button"
            onClick={() => setInstallBannerVisible(false)}
            className="text-neutral-400 hover:text-neutral-700 text-lg leading-none shrink-0"
            aria-label="Fermer"
          >
            ×
          </button>
        </div>
      )}

      {/* ── Chat FAB ── */}
      <ChatWidget
        slug={slug}
        lang={lang}
        menuItems={[
          ...(menu.sections?.flatMap((s) => s.items) || []),
          ...(menu.wines || []),
        ]}
      />

      {/* ── Cart summary bar ── */}
      <CartSummaryBar slug={slug} lang={lang} currency={menu.currency || 'EUR'} />
    </div>
  );
}
