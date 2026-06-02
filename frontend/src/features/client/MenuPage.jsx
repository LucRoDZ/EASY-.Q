import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { Loader2, ShoppingCart, Bell, BellRing, Check, Download, X } from 'lucide-react';
import { t } from '../../localization/translations';
import { api } from '../../api';
import MenuView, { SearchFilterBar } from '../../components/MenuView';
import ChatWidget from './ChatWidget';
import WaiterCallButton from './WaiterCallButton';
import LanguageSelector from '../../components/LanguageSelector';
import CartSummaryBar from '../../components/CartSummaryBar';
import { useCart } from '../../context/CartContext';

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function MenuSkeleton() {
  return (
    <div className="min-h-dvh bg-neutral-50">
      <div className="bg-black h-14" />
      <div className="bg-neutral-800 h-11" />
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        <div className="h-10 bg-neutral-200 rounded-xl animate-pulse motion-reduce:animate-none" />
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-white rounded-xl border border-neutral-200 p-6 space-y-4 animate-pulse motion-reduce:animate-none">
            <div className="h-5 w-32 bg-neutral-200 rounded" />
            {[1, 2, 3].map((j) => (
              <div key={j} className="flex justify-between py-4 border-b border-neutral-100 last:border-b-0">
                <div className="space-y-2 flex-1">
                  <div className="h-4 w-40 bg-neutral-200 rounded" />
                  <div className="h-3 w-56 bg-neutral-100 rounded" />
                </div>
                <div className="h-9 w-20 bg-neutral-200 rounded-full ml-4 shrink-0" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── CategoryNav ──────────────────────────────────────────────────────────────

function CategoryNav({ sections, activeIndex, lang }) {
  const navRef = useRef(null);

  const scrollToSection = (idx) => {
    const el = document.getElementById(`section-${idx}`);
    // scroll-margin-top on the section handles the sticky header offset
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  useEffect(() => {
    if (!navRef.current) return;
    const activeBtn = navRef.current.querySelector(`[data-idx="${activeIndex}"]`);
    activeBtn?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [activeIndex]);

  if (!sections || sections.length === 0) return null;

  return (
    <nav
      ref={navRef}
      aria-label={t(lang, 'menu.categories')}
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
  const { itemCount, setSlug } = useCart();

  useEffect(() => { setSlug(slug); }, [slug, setSlug]);

  const lang = searchParams.get('lang') || 'fr';
  const tableToken = searchParams.get('table') || '';

  const [menu, setMenu] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const [activeSection, setActiveSection] = useState(0);
  const [googleRating, setGoogleRating] = useState(null);

  const [waiterState, setWaiterState] = useState('idle');

  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilters, setActiveFilters] = useState([]);

  const [installPrompt, setInstallPrompt] = useState(null);
  const [installBannerVisible, setInstallBannerVisible] = useState(false);

  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
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
    setMenu(null);
    api.getMenu(slug, lang)
      .then(setMenu)
      .catch(() => setError(t(lang, 'menu.notFound')))
      .finally(() => setLoading(false));
  }, [slug, lang, retryKey]);

  useEffect(() => {
    if (!slug) return;
    api.getGoogleRating(slug)
      .then((data) => { if (data?.rating) setGoogleRating(data); })
      .catch(() => {});
  }, [slug]);

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

  if (loading) return <MenuSkeleton />;

  if (error || !menu) {
    return (
      <div className="min-h-dvh bg-neutral-50 flex flex-col items-center justify-center gap-4">
        <p className="text-neutral-600">{error || t(lang, 'menu.notFound')}</p>
        <button
          type="button"
          onClick={() => setRetryKey((k) => k + 1)}
          className="px-4 py-2 bg-black text-white text-sm font-medium rounded-full hover:bg-neutral-800 transition-colors"
        >
          {t(lang, 'menu.retry')}
        </button>
      </div>
    );
  }

  const cartUrl = `/menu/${slug}/cart?lang=${lang}&currency=${menu.currency || 'EUR'}`;

  return (
    <div className="min-h-dvh bg-neutral-50 pb-24">

      {/* ── Sticky Header ── */}
      <header className="bg-black text-white sticky top-0 z-40">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight truncate">
              {menu.restaurant_name}
            </h1>
            <div className="flex items-center gap-2 mt-0.5">
              {googleRating && (
                <a
                  href={`https://search.google.com/local/writereview?placeid=${encodeURIComponent(googleRating.place_id || '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-yellow-400 hover:text-yellow-300 transition-colors"
                  title="Avis Google"
                >
                  <span>★</span>
                  <span className="font-medium">{googleRating.rating.toFixed(1)}</span>
                  {googleRating.user_ratings_total > 0 && (
                    <span className="text-neutral-400">({googleRating.user_ratings_total})</span>
                  )}
                </a>
              )}
              {tableToken && (
                <p className="text-xs text-neutral-400 leading-none">
                  Table {tableToken.length > 8 ? tableToken.slice(0, 8) + '…' : tableToken}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <LanguageSelector
              current={lang}
              available={menu.available_languages}
              onChange={handleLanguageChange}
            />

            {tableToken && (
              <button
                onClick={handleCallWaiter}
                disabled={waiterState === 'loading'}
                className={`p-3 rounded-full transition-colors ${
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
                {waiterState === 'loading' && <Loader2 size={20} className="animate-spin motion-reduce:animate-none" />}
                {waiterState === 'sent' && <Check size={20} />}
                {waiterState === 'error' && <BellRing size={20} />}
                {waiterState === 'idle' && <Bell size={20} />}
              </button>
            )}

            <Link
              to={cartUrl}
              className="relative p-3 hover:bg-neutral-800 rounded-full transition-colors"
              aria-label={t(lang, 'cart')}
            >
              <ShoppingCart size={20} />
              {itemCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 bg-white text-black text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center leading-none">
                  {itemCount}
                </span>
              )}
            </Link>
          </div>
        </div>
      </header>

      {/* ── Category nav ── */}
      <CategoryNav sections={menu.sections} activeIndex={activeSection} lang={lang} />

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

      {/* ── Waiter call FAB ── */}
      <WaiterCallButton slug={slug} tableToken={tableToken} lang={lang} />

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
            className="p-2 text-neutral-400 hover:text-neutral-700 rounded-full transition-colors shrink-0"
            aria-label="Fermer"
          >
            <X className="h-4 w-4" />
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
